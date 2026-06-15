import { describe, it, expect } from 'vitest';
import { liveStack, makeUser, FUNCTIONS_URL, ANON } from './_env.ts';

describe.runIf(liveStack)('format edge function (live stack)', () => {
  it('polishes the transcript and logs an llm usage event (provider-agnostic)', async () => {
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
    // works against mock OR a real provider: polished, non-empty, filler removed
    expect(typeof json.final_text).toBe('string');
    expect(json.final_text.length).toBeGreaterThan(0);
    expect(json.final_text.toLowerCase()).not.toContain(' um ');
    expect(typeof json.provider).toBe('string');

    // a real LLM provider logs usage (Raw passthrough would not — default mode is 'Clean')
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

  it('returns 400 for an empty transcript', async () => {
    const u = await makeUser();
    const res = await fetch(`${FUNCTIONS_URL}/format`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u.jwt}`, apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: '', mode_id: null }),
    });
    expect(res.status).toBe(400);
  });
});
