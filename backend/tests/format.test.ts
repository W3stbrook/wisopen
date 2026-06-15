import { describe, it, expect } from 'vitest';
import { liveStack, makeUser, FUNCTIONS_URL, ANON } from './_env.ts';

describe.runIf(liveStack)('format edge function (live stack, mock LLM)', () => {
  it('polishes the transcript and logs an llm usage event', async () => {
    const u = await makeUser();
    const res = await fetch(`${FUNCTIONS_URL}/format`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${u.jwt}`,
        apikey: ANON,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript: 'um hello world you know', mode_id: null }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    // mock LLM: strips filler, capitalizes, adds period
    expect(json.final_text).toBe('Hello world.');
    expect(json.provider).toBe('mock');

    // usage_events row written
    const usage = await u.client.from('usage_events').select('*').eq('kind', 'llm');
    expect(usage.data?.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a request with no/invalid JWT', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/format`, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid', apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: 'hi', mode_id: null }),
    });
    expect(res.status).toBe(401);
  });
});
