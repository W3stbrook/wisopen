// `stt-stream` — STT proxy over WebSocket. WS upgrades bypass the gateway JWT check,
// so we authenticate the `?jwt=` query param INSIDE the function (spec amendment 3),
// then relay audio frames to the configured STT provider and stream partials/final back.
import { getSttProvider } from '../_shared/providers/index.ts';
import { verifyJwt, adminClient } from '../_shared/auth.ts';
import { logUsage } from '../_shared/usage.ts';
import { base64ToBytes } from '../_shared/util.ts';
import type { SttSession, SttProvider } from '../_shared/providers/types.ts';

Deno.serve(async (req: Request) => {
  if ((req.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const url = new URL(req.url);
  // JWT via query param (browsers/Electron WS cannot set custom headers) or subprotocol
  let token = url.searchParams.get('jwt') ?? '';
  const proto = req.headers.get('sec-websocket-protocol');
  if (!token && proto?.startsWith('jwt-')) token = proto.slice('jwt-'.length);
  const user = await verifyJwt(token);

  const { socket, response } = Deno.upgradeWebSocket(req);

  const send = (obj: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
  };

  if (!user) {
    socket.onopen = () => socket.close(1008, 'unauthorized');
    return response;
  }

  let provider: SttProvider | null = null;
  let session: SttSession | null = null;

  socket.onopen = () => send({ t: 'ready' });

  socket.onmessage = async (e: MessageEvent) => {
    let msg: { t: string; [k: string]: unknown };
    try {
      msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
    } catch {
      return;
    }

    if (msg.t === 'config') {
      const sampleRate = (msg.sampleRate as number) ?? 16000;
      const lang = (msg.lang as string | null) ?? null;
      const dictionary = (msg.dictionary as string[]) ?? [];
      provider = await getSttProvider();
      session = provider.openSession({ sampleRate, lang, dictionary });
      (async () => {
        try {
          for await (const ev of session!.events()) {
            if (ev.kind === 'partial') {
              send({ t: 'partial', text: ev.text });
            } else {
              const audioSeconds = ev.audioSeconds ?? 0;
              send({ t: 'final', text: ev.text, audioSeconds });
              const admin = adminClient();
              await logUsage(
                (table, row) => admin.from(table).insert(row).then(({ error }) => ({ error })),
                {
                  user_id: user.userId,
                  kind: 'stt',
                  provider: provider!.id,
                  model: null,
                  audio_seconds: audioSeconds,
                },
              );
            }
          }
        } catch (err) {
          send({ t: 'error', message: String(err instanceof Error ? err.message : err) });
        }
      })();
    } else if (msg.t === 'audio' && session) {
      session.pushAudio(base64ToBytes(msg.pcm as string));
    } else if (msg.t === 'end' && session) {
      session.end();
    }
  };

  socket.onclose = () => {
    session?.end();
  };
  socket.onerror = () => {
    session?.end();
  };

  return response;
});
