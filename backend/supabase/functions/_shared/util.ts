// Small runtime-agnostic helpers (work in both Deno edge runtime and Node tests).

/** Single-consumer async event queue: push events, close when done, iterate. */
export function createEventQueue<T>() {
  const buffer: T[] = [];
  let resolveNext: ((v: IteratorResult<T>) => void) | null = null;
  let closed = false;
  return {
    push(v: T) {
      if (closed) return;
      if (resolveNext) {
        resolveNext({ value: v, done: false });
        resolveNext = null;
      } else {
        buffer.push(v);
      }
    },
    close() {
      closed = true;
      if (resolveNext) {
        resolveNext({ value: undefined as unknown as T, done: true });
        resolveNext = null;
      }
    },
    async *iterate(): AsyncGenerator<T> {
      while (true) {
        if (buffer.length) {
          yield buffer.shift() as T;
          continue;
        }
        if (closed) return;
        const r = await new Promise<IteratorResult<T>>((res) => {
          resolveNext = res;
        });
        if (r.done) return;
        yield r.value;
      }
    },
  };
}

/** audio seconds from PCM16 mono byte count. */
export function pcm16Seconds(bytes: number, sampleRate: number): number {
  return Math.round((bytes / 2 / sampleRate) * 100) / 100;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin);
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Wrap raw PCM16 mono little-endian samples in a minimal 44-byte WAV header. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.byteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true); // PCM fmt chunk size
  dv.setUint16(20, 1, true); // audio format = PCM
  dv.setUint16(22, numChannels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  dv.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}
