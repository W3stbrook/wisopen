// Pure DSP: linear-resample Float32 mic samples to 16 kHz PCM16. Unit-tested.

export function clampInt16(sample: number): number {
  const v = Math.max(-1, Math.min(1, sample));
  return Math.round(v < 0 ? v * 0x8000 : v * 0x7fff);
}

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = clampInt16(input[i] as number);
  return out;
}

/** Linear-interpolation resample from `inRate` to 16000 Hz, returning PCM16. */
export function downsampleTo16k(input: Float32Array, inRate: number): Int16Array {
  const outRate = 16000;
  if (inRate === outRate) return floatToInt16(input);
  const ratio = inRate / outRate;
  const outLen = Math.max(0, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    const sample = (input[i0] as number) * (1 - frac) + (input[i1] as number) * frac;
    out[i] = clampInt16(sample);
  }
  return out;
}

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
