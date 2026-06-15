import type { SttProvider, SttProviderOptions, SttSession, SttEvent } from '../types.ts';
import { createEventQueue, pcm16Seconds } from '../../util.ts';

/** One transcript result (subset of AWS shape; all optional per SDK types). */
export interface AwsResult {
  ResultId?: string;
  IsPartial?: boolean;
  Alternatives?: { Transcript?: string }[];
}
export interface AwsTranscriptEvent {
  TranscriptEvent?: { Transcript?: { Results?: AwsResult[] } };
}

/**
 * Injected streaming call: given audio frames (async iterable), returns the
 * provider's TranscriptResultStream (async iterable of TranscriptEvents).
 * The Deno wiring builds the real TranscribeStreamingClient + StartStreamTranscriptionCommand.
 */
export type StartTranscription = (
  opts: { sampleRate: number; lang?: string | null; dictionary?: string[] },
  audio: AsyncIterable<Uint8Array>,
) => AsyncIterable<AwsTranscriptEvent>;

/** AWS Transcribe streaming adapter. Emits growing partials; finalizes per ResultId (IsPartial:false). */
export class AwsTranscribeStt implements SttProvider {
  readonly id = 'aws-transcribe';
  readonly mode = 'streaming' as const;
  constructor(private readonly start: StartTranscription) {}

  openSession(opts: SttProviderOptions): SttSession {
    const audioQ = createEventQueue<Uint8Array>();
    const out = createEventQueue<SttEvent>();
    let bytes = 0;
    const committed: string[] = [];
    const finalizedIds = new Set<string>(); // dedup: AWS re-emits a ResultId until IsPartial:false

    (async () => {
      try {
        const stream = this.start(
          { sampleRate: opts.sampleRate, lang: opts.lang, dictionary: opts.dictionary },
          audioQ.iterate(),
        );
        for await (const ev of stream) {
          const results = ev.TranscriptEvent?.Transcript?.Results ?? [];
          for (const r of results) {
            const text = (r.Alternatives?.[0]?.Transcript ?? '').trim();
            if (r.IsPartial) {
              out.push({ kind: 'partial', text: [...committed, text].join(' ').trim() });
            } else if (text) {
              const id = r.ResultId ?? `seg-${committed.length}`;
              if (finalizedIds.has(id)) continue; // already committed this segment
              finalizedIds.add(id);
              committed.push(text);
              out.push({ kind: 'partial', text: committed.join(' ').trim() });
            }
          }
        }
        out.push({
          kind: 'final',
          text: committed.join(' ').trim(),
          audioSeconds: pcm16Seconds(bytes, opts.sampleRate),
        });
        out.close();
      } catch (err) {
        out.push({ kind: 'final', text: committed.join(' ').trim(), audioSeconds: pcm16Seconds(bytes, opts.sampleRate) });
        out.close();
        console.error('aws-transcribe stream error', err);
      }
    })();

    return {
      pushAudio(frame: Uint8Array) {
        bytes += frame.byteLength;
        audioQ.push(frame);
      },
      end() {
        audioQ.close();
      },
      events: () => out.iterate(),
    };
  }
}
