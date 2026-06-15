import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wisopen-store-'));
  path = join(dir, 'wisopen.json');
});

describe('Store', () => {
  it('returns defaults then merges a settings patch', () => {
    const s = new Store(path);
    expect(s.getSettings().pttKey).toBe('F13');
    const next = s.setSettings({ pttKey: 'RightControl', injectionMode: 'keystroke' });
    expect(next.pttKey).toBe('RightControl');
    // persisted: a fresh Store reads it back
    expect(new Store(path).getSettings().injectionMode).toBe('keystroke');
  });

  it('recovers from a corrupt file by starting empty', () => {
    writeFileSync(path, '{not valid json');
    const s = new Store(path);
    expect(s.getSettings().pttKey).toBe('F13'); // defaults, no throw
  });

  it('addHistory unshifts newest-first, caps at 500, getHistory slices', () => {
    const s = new Store(path);
    for (let i = 0; i < 510; i++) s.addHistory({ raw: `r${i}`, final: `f${i}`, audioSeconds: 1, lang: 'en' });
    const all = s.getHistory(1000);
    expect(all.length).toBe(500); // capped
    expect(all[0]!.final).toBe('f509'); // newest first
    expect(s.getHistory(5).length).toBe(5);
    expect(s.getHistory(5)[0]!.id).toBeTypeOf('string');
  });

  it('stores and clears the secret blob', () => {
    const s = new Store(path);
    expect(s.getSecretB64()).toBeNull();
    s.setSecretB64('Y2lwaGVy');
    expect(new Store(path).getSecretB64()).toBe('Y2lwaGVy');
    s.setSecretB64(null);
    expect(s.getSecretB64()).toBeNull();
  });
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
