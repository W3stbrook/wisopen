/** RMS threshold on normalized float samples in [-1, 1]. */
export const SPEECH_RMS_THRESHOLD = 0.008;

/** RMS threshold on PCM16 mono samples (approx. SPEECH_RMS_THRESHOLD × 32768). */
export const PCM16_SPEECH_RMS_THRESHOLD = 350;

export function isSpeechLevel(rms: number): boolean {
  return rms >= SPEECH_RMS_THRESHOLD;
}

/** True when PCM16 LE mono audio contains speech above the RMS threshold. */
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
