// `stt-stream` — STT proxy over WebSocket. WS upgrades bypass the gateway JWT check,
// so we authenticate the token INSIDE the function (spec amendment 3). The token is
// passed via the `Sec-WebSocket-Protocol: jwt-<token>` subprotocol (preferred; avoids
// leaking the token into URLs/logs) or `?jwt=` (legacy fallback).
import { getSttProvider } from '../_shared/providers/index.ts';
import { verifyJwt, adminClient } from '../_shared/auth.ts';
import { logUsage } from '../_shared/usage.ts';
import { base64ToBytes } from '../_shared/util.ts';
import type { SttSession, SttProvider } from '../_shared/providers/types.ts';

// Hard cap on buffered/streamed audio per session: ~3 min @ 16 kHz PCM16 mono.
const MAX_STT_BYTES = 16000 * 2 * 180;

Deno.serve(async (req: Request) => {
  if ((req.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const proto = req.headers.get('sec-websocket-protocol');
  let token = '';
  if (proto && proto.startsWith('jwt-')) token = proto.slice('jwt-'.length);
  if (!token) token = new URL(req.url).searchParams.get('jwt') ?? '';
  const user = await verifyJwt(token);

  // echo the subprotocol back per the WS spec when the client offered one
  const { socket, response } = Deno.upgradeWebSocket(
    req,
    proto && proto.startsWith('jwt-') ? { protocol: proto } : undefined,
  );

  const send = (obj: unknown): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
  };

  if (!user) {
    socket.onopen = () => socket.close(1008, 'unauthorized');
    return response;
  }

  let provider: SttProvider | null = null;
  let session: SttSession | null = null;
  let configured = false;
  const buffered: Uint8Array[] = [];
  let pendingEnd = false;
  let totalBytes = 0;

  socket.onopen = () => send({ t: 'ready' });

  socket.onmessage = async (e: MessageEvent) => {
    let msg: { t: string; [k: string]: unknown };
    try {
      msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
    } catch {
      return;
    }

    if (msg.t === 'config') {
      if (configured) return; // re-config would leak a second session/consumer
      configured = true;
      const sampleRate = (msg.sampleRate as number) ?? 16000;
      const lang = (msg.lang as string | null) ?? null;
      const dictionary = (msg.dictionary as string[]) ?? [];
      provider = await getSttProvider();
      session = provider.openSession({ sampleRate, lang, dictionary });

      // consume provider events
      (async () => {
        try {
          for await (const ev of session!.events()) {
            if (ev.kind === 'partial') {
              send({ t: 'partial', text: ev.text });
            } else if (ev.kind === 'error') {
              send({ t: 'error', message: ev.message });
            } else if (ev.kind === 'cancelled') {
              send({ t: 'cancelled', reason: ev.reason });
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
          console.error('stt-stream consumer error', err);
          send({ t: 'error', message: 'stream error' });
        }
      })();

      // flush any audio/end that arrived before the session existed
      for (const f of buffered) session.pushAudio(f);
      buffered.length = 0;
      if (pendingEnd) session.end();
    } else if (msg.t === 'audio') {
      const bytes = base64ToBytes(msg.pcm as string);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_STT_BYTES) {
        send({ t: 'error', message: 'recording too long' });
        socket.close(1009, 'audio too large');
        return;
      }
      if (session) session.pushAudio(bytes);
      else buffered.push(bytes);
    } else if (msg.t === 'end') {
      if (session) session.end();
      else pendingEnd = true;
    }
  };

  socket.onclose = () => session?.end();
  socket.onerror = () => session?.end();

  return response;
});
