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
    const transcribe = this.transcribe; // capture: `this` inside the returned object is not the class

    return {
      pushAudio(frame: Uint8Array) {
        chunks.push(frame);
        bytes += frame.byteLength;
      },
      end() {
        (async () => {
          try {
            const wav = pcm16ToWav(concatBytes(chunks), opts.sampleRate);
            const { text } = await transcribe(wav, { lang: opts.lang });
            out.push({ kind: 'final', text: text.trim(), audioSeconds: pcm16Seconds(bytes, opts.sampleRate) });
          } catch (err) {
            out.push({ kind: 'final', text: '', audioSeconds: pcm16Seconds(bytes, opts.sampleRate) });
            console.error('openai stt error', err);
          } finally {
            out.close();
          }
        })();
      },
      events: () => out.iterate(),
    };
  }
}
