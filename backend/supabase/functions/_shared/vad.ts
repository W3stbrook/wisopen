/** Mirrors packages/shared/src/vad.ts for the isolated Deno bundle. */

export const PCM16_SPEECH_RMS_THRESHOLD = 350;

export function pcm16HasSpeech(bytes: Uint8Array, threshold = PCM16_SPEECH_RMS_THRESHOLD): boolean {
  if (bytes.byteLength < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength >> 1;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true);
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / n) >= threshold;
}
