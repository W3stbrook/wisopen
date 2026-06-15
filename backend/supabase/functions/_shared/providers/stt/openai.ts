import type { SttProvider, SttProviderOptions, SttSession, SttEvent } from '../types.ts';
import { createEventQueue, pcm16Seconds, concatBytes, pcm16ToWav } from '../../util.ts';

/**
 * Injected buffered transcription: receives a complete WAV blob, returns text.
 * The Deno wiring calls openai `client.audio.transcriptions.create({file, model:'gpt-4o-transcribe'})`.
 * (transcriptions.create is file-based — no live partials; spec amendment 4.)
 */
export type Transcribe = (
  wav: Uint8Array,
  opts: { lang?: string | null },
) => Promise<{ text: string }>;

/** OpenAI STT adapter — buffered (final only). */
export class OpenAiStt implements SttProvider {
  readonly id = 'openai';
  readonly mode = 'buffered' as const;
  constructor(private readonly transcribe: Transcribe) {}

  openSession(opts: SttProviderOptions): SttSession {
    const out = createEventQueue<SttEvent>();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let ended = false; // end() is idempotent — avoids a second billable transcription
    const transcribe = this.transcribe; // capture: `this` inside the returned object is not the class
    // OpenAI's upload limit is 25 MB; cap under it (incl. WAV header/multipart headroom).
    const MAX_BYTES = 24 * 1024 * 1024;

    return {
      pushAudio(frame: Uint8Array) {
        if (ended) return;
        chunks.push(frame);
        bytes += frame.byteLength;
      },
      end() {
        if (ended) return;
        ended = true;
        (async () => {
          try {
            if (bytes > MAX_BYTES) {
              out.push({
                kind: 'error',
                message: 'recording too long for the buffered OpenAI provider; use a streaming provider',
              });
              return;
            }
            const wav = pcm16ToWav(concatBytes(chunks), opts.sampleRate);
            const { text } = await transcribe(wav, { lang: opts.lang });
            out.push({ kind: 'final', text: text.trim(), audioSeconds: pcm16Seconds(bytes, opts.sampleRate) });
          } catch (err) {
            console.error('openai stt error', err);
            out.push({ kind: 'error', message: 'transcription failed' });
          } finally {
            out.close();
          }
        })();
      },
      events: () => out.iterate(),
    };
  }
}
