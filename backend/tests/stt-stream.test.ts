import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { liveStack, makeUser, FUNCTIONS_URL } from './_env.ts';

function wsUrl(jwt: string): string {
  return `${FUNCTIONS_URL.replace(/^http/, 'ws')}/stt-stream?jwt=${encodeURIComponent(jwt)}`;
}

function silentFrame(): string {
  // 0.1s of PCM16 @16k silence, base64-encoded
  return Buffer.from(new Uint8Array(3200)).toString('base64');
}

describe.runIf(liveStack)('stt-stream edge function (live stack, mock STT)', () => {
  it('streams partials then a final and logs an stt usage event', async () => {
    const u = await makeUser();
    const msgs: { t: string; [k: string]: unknown }[] = [];
    const final = await new Promise<{ t: string; text: string }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl(u.jwt));
      const timer = setTimeout(() => reject(new Error('timeout')), 15000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'config', sampleRate: 16000 }));
        for (let i = 0; i < 12; i++) ws.send(JSON.stringify({ t: 'audio', pcm: silentFrame() }));
        ws.send(JSON.stringify({ t: 'end' }));
      });
      ws.on('message', (data) => {
        const m = JSON.parse(data.toString());
        msgs.push(m);
        if (m.t === 'final') {
          clearTimeout(timer);
          ws.close();
          resolve(m);
        }
      });
      ws.on('error', reject);
    });

    expect(msgs[0]?.t).toBe('ready');
    expect(msgs.some((m) => m.t === 'partial')).toBe(true);
    expect(final.text.length).toBeGreaterThan(0);

    const usage = await u.client.from('usage_events').select('*').eq('kind', 'stt');
    expect(usage.data?.length).toBeGreaterThanOrEqual(1);
  });

  it('closes the socket for an invalid jwt without a final', async () => {
    const closed = await new Promise<number>((resolve) => {
      const ws = new WebSocket(wsUrl('invalid-token'));
      ws.on('close', (code) => resolve(code));
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.t === 'final') resolve(-1); // should not happen
      });
      ws.on('error', () => resolve(-2));
    });
    expect(closed).not.toBe(-1);
  });
});
