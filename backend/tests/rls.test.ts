import { describe, it, expect } from 'vitest';
import { liveStack, makeUser, anonClient } from './_env.ts';

describe.runIf(liveStack)('RLS (live stack)', () => {
  it('isolates snippets per user and blocks spoofed user_id', async () => {
    const a = await makeUser();
    const b = await makeUser();

    // A inserts a snippet (user_id defaults to auth.uid())
    const ins = await a.client
      .from('snippets')
      .insert({ user_id: a.userId, trigger: 'my linkedin', expansion: 'https://x' })
      .select();
    expect(ins.error).toBeNull();
    expect(ins.data).toHaveLength(1);

    // A sees it
    const aSees = await a.client.from('snippets').select('*');
    expect(aSees.data?.length).toBe(1);

    // B sees none of A's rows
    const bSees = await b.client.from('snippets').select('*');
    expect(bSees.data?.length ?? 0).toBe(0);

    // anon sees none
    const anonSees = await anonClient().from('snippets').select('*');
    expect(anonSees.data?.length ?? 0).toBe(0);

    // A cannot insert a row owned by B (RLS WITH CHECK) -> 42501
    const spoof = await a.client
      .from('snippets')
      .insert({ user_id: b.userId, trigger: 'spoof', expansion: 'x' });
    expect(spoof.error?.code).toBe('42501');
  });

  it('exposes the 5 seeded system modes to any user', async () => {
    const u = await makeUser();
    const { data } = await u.client.from('modes').select('*').eq('is_system', true);
    expect(data?.length).toBe(5);
    expect(data?.some((m) => m.is_default)).toBe(true);
  });
});
