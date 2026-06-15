import type { SttProvider, SttProviderOptions, SttSession, SttEvent } from '../types.ts';
import { createEventQueue, pcm16Seconds } from '../../util.ts';

const CANNED =
  'this is a mock transcription um it shows the whole dictation loop working end to end without any real provider key';

/**
 * Streaming mock STT. Emits a few growing partials as audio arrives, then a
 * final with canned text on end(). Audio content is ignored; audioSeconds is
 * computed from the byte count so usage metering is demonstrable.
 */
export class MockStt implements SttProvider {
  readonly id = 'mock';
  readonly mode = 'streaming' as const;

  openSession(opts: SttProviderOptions): SttSession {
    const q = createEventQueue<SttEvent>();
    let bytes = 0;
    let frames = 0;
    const words = CANNED.split(' ');
    let emittedWords = 0;

    return {
      pushAudio(frame: Uint8Array) {
        bytes += frame.byteLength;
        frames += 1;
        // every ~3 frames, grow the partial by a couple of words
        if (frames % 3 === 0 && emittedWords < words.length) {
          emittedWords = Math.min(words.length, emittedWords + 2);
          q.push({ kind: 'partial', text: words.slice(0, emittedWords).join(' ') });
        }
      },
      end() {
        q.push({ kind: 'final', text: CANNED, audioSeconds: pcm16Seconds(bytes, opts.sampleRate) });
        q.close();
      },
      events: () => q.iterate(),
    };
  }
}
