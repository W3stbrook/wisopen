import { describe, it, expect } from 'vitest';
import { downsampleTo16k, floatToInt16, clampInt16, int16ToBase64 } from './resample.js';

describe('clampInt16', () => {
  it('maps [-1,1] to full int16 range and clamps overflow', () => {
    expect(clampInt16(0)).toBe(0);
    expect(clampInt16(1)).toBe(32767);
    expect(clampInt16(-1)).toBe(-32768);
    expect(clampInt16(2)).toBe(32767);
    expect(clampInt16(-2)).toBe(-32768);
  });
});

describe('downsampleTo16k', () => {
  it('passes through when already 16k', () => {
    const out = downsampleTo16k(new Float32Array([0, 0.5, -0.5]), 16000);
    expect(out.length).toBe(3);
    expect(out[1]).toBe(clampInt16(0.5));
  });
  it('halves length from 32k to 16k', () => {
    const input = new Float32Array(320);
    const out = downsampleTo16k(input, 32000);
    expect(out.length).toBe(160);
  });
  it('reduces 48k to 16k by ~1/3', () => {
    const out = downsampleTo16k(new Float32Array(480), 48000);
    expect(out.length).toBe(160);
  });
});

describe('floatToInt16 + base64', () => {
  it('round-trips length through base64 (2 bytes per sample)', () => {
    const pcm = floatToInt16(new Float32Array(100));
    const b64 = int16ToBase64(pcm);
    expect(Buffer.from(b64, 'base64').byteLength).toBe(200);
  });
});
