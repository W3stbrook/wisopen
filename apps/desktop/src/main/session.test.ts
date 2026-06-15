import { describe, it, expect, vi } from 'vitest';
import { Session, type SessionDeps } from './session.js';
import { DEFAULT_SETTINGS, type Snippet } from '@wisopen/shared';

function makeDeps(over: Partial<SessionDeps> = {}): { deps: SessionDeps; log: string[]; injected: string[] } {
  const log: string[] = [];
  const injected: string[] = [];
  const snippets: Snippet[] = [
    { id: '1', user_id: 'u', trigger: 'world', expansion: 'WORLD', enabled: true, match_mode: 'phrase', created_at: '' },
  ];
  const deps: SessionDeps = {
    getJwt: async () => 'jwt-123',
    callFormat: async (req) => ({ final_text: `Hello ${req.transcript}.`, tokens_in: 1, tokens_out: 1, provider: 'mock', model: 'm' }),
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    getSnippets: () => snippets,
    getDictionary: () => [],
    overlay: (state) => log.push(`overlay:${state}`),
    engineCommand: (c) => log.push(`engine:${c.cmd}`),
    inject: async (text) => {
      injected.push(text);
      return 'pasted';
    },
    addHistory: () => log.push('history'),
    supabaseUrl: 'http://localhost',
    sampleRate: 16000,
    watchdogMs: 1000,
    ...over,
  };
  return { deps, log, injected };
}

describe('Session orchestration', () => {
  it('runs hotkey -> engine start -> partial -> final -> format -> expand -> inject -> history', async () => {
    const { deps, log, injected } = makeDeps();
    const s = new Session(deps);
    await s.start();
    s.onPartial('hello wo');
    await s.onFinal({ text: 'world', audioSeconds: 1.2 });

    expect(log).toEqual([
      'overlay:listening',
      'engine:start',
      'overlay:transcribing',
      'overlay:polishing',
      'overlay:inserting',
      'overlay:done',
      'history',
    ]);
    // format produced "Hello world." then snippet expanded world->WORLD
    expect(injected).toEqual(['Hello WORLD.']);
  });

  it('errors to overlay when not signed in', async () => {
    const { deps, log } = makeDeps({ getJwt: async () => null });
    const s = new Session(deps);
    await s.start();
    expect(log).toEqual(['overlay:error']);
  });

  it('falls back to overlay error if format throws', async () => {
    const { deps, log } = makeDeps({
      callFormat: async () => {
        throw new Error('boom');
      },
    });
    const s = new Session(deps);
    await s.start();
    await s.onFinal({ text: 'x', audioSeconds: 1 });
    expect(log).toContain('overlay:error');
  });

  it('onError clears busy so a later dictation can start (engine-close recovery)', async () => {
    const { deps, log } = makeDeps();
    const s = new Session(deps);
    await s.start();
    s.onError('stt connection closed'); // engine closed without a final
    expect(log).toContain('overlay:error');
    log.length = 0;
    await s.start(); // must not be stuck busy
    expect(log).toContain('engine:start');
    s.onError('cleanup'); // settle so no watchdog timer lingers past the test
  });

  it('does not save history when disabled', async () => {
    const { deps, log } = makeDeps({ getSettings: () => ({ ...DEFAULT_SETTINGS, saveHistory: false }) });
    const s = new Session(deps);
    await s.start();
    await s.onFinal({ text: 'world', audioSeconds: 1 });
    expect(log).not.toContain('history');
  });
});
