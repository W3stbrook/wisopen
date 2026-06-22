// OpenAI Realtime API — streaming transcription (live partials while speaking).
// Connects only after speech is detected so silent sessions never hit the API.
import type { SttProvider, SttProviderOptions, SttSession, SttEvent } from '../types.ts';
import { createEventQueue, pcm16Seconds, bytesToBase64 } from '../../util.ts';
import { pcm16HasSpeech } from '../../vad.ts';

type RealtimeMsg = Record<string, unknown>;

export class OpenAiRealtimeStt implements SttProvider {
  readonly id = 'openai-realtime';
  readonly mode = 'streaming' as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  openSession(opts: SttProviderOptions): SttSession {
    const audioQ = createEventQueue<Uint8Array>();
    const out = createEventQueue<SttEvent>();
    let ended = false;

    (async () => {
      const preConnect: Uint8Array[] = [];
      let hadSpeech = false;
      let totalBytes = 0;
      let ws: WebSocket | null = null;
      let latest = '';

      const send = (obj: RealtimeMsg): void => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
      };

      const connect = async (): Promise<void> => {
        const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.model)}`;
        const socket = new WebSocket(url, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        });

        await new Promise<void>((resolve, reject) => {
          socket.onopen = () => resolve();
          socket.onerror = () => reject(new Error('realtime connection failed'));
          setTimeout(() => reject(new Error('realtime connection timeout')), 12_000);
        });

        socket.onmessage = (ev) => {
          let msg: RealtimeMsg;
          try {
            msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
          } catch {
            return;
          }
          const type = msg.type as string;
          if (type === 'conversation.item.input_audio_transcription.delta') {
            const delta = (msg.delta as string) ?? '';
            if (delta) {
              latest += delta;
              out.push({ kind: 'partial', text: latest.trim() });
            }
          } else if (type === 'conversation.item.input_audio_transcription.completed') {
            const transcript = (msg.transcript as string) ?? '';
            if (transcript.trim()) latest = transcript.trim();
          }
        };

        ws = socket;
        send({
          type: 'session.update',
          session: {
            modalities: ['text'],
            input_audio_format: 'pcm16',
            input_audio_transcription: { model: 'gpt-4o-transcribe' },
            turn_detection: null,
          },
        });
        for (const frame of preConnect) {
          send({ type: 'input_audio_buffer.append', audio: bytesToBase64(frame) });
        }
        preConnect.length = 0;
      };

      try {
        for await (const frame of audioQ.iterate()) {
          totalBytes += frame.byteLength;
          if (!hadSpeech) {
            preConnect.push(frame);
            if (pcm16HasSpeech(frame)) {
              hadSpeech = true;
              await connect();
            }
            continue;
          }
          send({ type: 'input_audio_buffer.append', audio: bytesToBase64(frame) });
        }

        if (!hadSpeech) {
          out.push({ kind: 'cancelled', reason: 'no_speech' });
          out.close();
          return;
        }

        send({ type: 'input_audio_buffer.commit' });
        await new Promise((r) => setTimeout(r, 500));

        const text = latest.trim();
        if (text) {
          out.push({ kind: 'final', text, audioSeconds: pcm16Seconds(totalBytes, opts.sampleRate) });
        } else {
          out.push({ kind: 'cancelled', reason: 'no_speech' });
        }
        out.close();
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.error('openai-realtime error', err);
        out.push({ kind: 'error', message: 'realtime transcription failed' });
        out.close();
      }
    })();

    return {
      pushAudio(frame: Uint8Array) {
        if (ended) return;
        audioQ.push(frame);
      },
      end() {
        if (ended) return;
        ended = true;
        audioQ.close();
      },
      events: () => out.iterate(),
    };
  }
}
