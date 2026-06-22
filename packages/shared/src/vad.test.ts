import { describe, it, expect } from 'vitest';
import { isSpeechLevel, pcm16HasSpeech, SPEECH_RMS_THRESHOLD, PCM16_SPEECH_RMS_THRESHOLD } from './vad.js';

describe('vad', () => {
  it('detects speech from float RMS', () => {
    expect(isSpeechLevel(SPEECH_RMS_THRESHOLD - 0.001)).toBe(false);
    expect(isSpeechLevel(SPEECH_RMS_THRESHOLD + 0.001)).toBe(true);
  });

  it('detects speech in PCM16 buffers', () => {
    const silence = new Uint8Array(3200);
    expect(pcm16HasSpeech(silence)).toBe(false);

    const speech = new Uint8Array(3200);
    const view = new DataView(speech.buffer);
    for (let i = 0; i < speech.byteLength / 2; i++) {
      view.setInt16(i * 2, 2000, true);
    }
    expect(pcm16HasSpeech(speech)).toBe(true);
    expect(pcm16HasSpeech(speech, PCM16_SPEECH_RMS_THRESHOLD)).toBe(true);
  });
});
