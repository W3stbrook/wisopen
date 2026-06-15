import { describe, it, expect } from 'vitest';
import { expandSnippets } from './snippet.js';
import type { Snippet } from './domain.js';

function snip(p: Partial<Snippet> & { trigger: string; expansion: string }): Snippet {
  return {
    id: p.id ?? p.trigger,
    user_id: 'u1',
    trigger: p.trigger,
    expansion: p.expansion,
    enabled: p.enabled ?? true,
    match_mode: p.match_mode ?? 'phrase',
    created_at: '2026-06-15',
  };
}

describe('expandSnippets', () => {
  const linkedin = snip({ trigger: 'my linkedin', expansion: 'https://linkedin.com/in/luca' });

  it('returns text unchanged when no snippets', () => {
    expect(expandSnippets('hello world', [])).toBe('hello world');
  });

  it('expands a phrase trigger', () => {
    expect(expandSnippets('send him my linkedin please', [linkedin])).toBe(
      'send him https://linkedin.com/in/luca please',
    );
  });

  it('matches case-insensitively (LLM may re-case)', () => {
    expect(expandSnippets('Send him My LinkedIn.', [linkedin])).toBe(
      'Send him https://linkedin.com/in/luca.',
    );
  });

  it('respects word boundaries (no mid-word match)', () => {
    const my = snip({ trigger: 'my', expansion: 'X' });
    expect(expandSnippets('summary mystery my', [my])).toBe('summary mystery X');
  });

  it('skips disabled snippets', () => {
    expect(expandSnippets('my linkedin', [{ ...linkedin, enabled: false }])).toBe('my linkedin');
  });

  it('prefers the longest trigger at a position', () => {
    const short = snip({ trigger: 'linkedin', expansion: 'SHORT' });
    const long = snip({ trigger: 'my linkedin', expansion: 'LONG' });
    expect(expandSnippets('my linkedin', [short, long])).toBe('LONG');
    expect(expandSnippets('the linkedin page', [short, long])).toBe('the SHORT page');
  });

  it('never re-scans an inserted expansion', () => {
    // expansion contains the trigger of another snippet; must not cascade
    const a = snip({ trigger: 'home', expansion: 'my home page' });
    const b = snip({ trigger: 'page', expansion: 'XXX' });
    // 'page' appears only inside a's expansion -> should NOT be replaced
    expect(expandSnippets('go home', [a, b])).toBe('go my home page');
  });

  it('replaces multiple occurrences', () => {
    expect(expandSnippets('my linkedin and my linkedin', [linkedin])).toBe(
      'https://linkedin.com/in/luca and https://linkedin.com/in/luca',
    );
  });

  it('exact mode is case-sensitive', () => {
    const api = snip({ trigger: 'API', expansion: '<api>', match_mode: 'exact' });
    expect(expandSnippets('the api and the API', [api])).toBe('the api and the <api>');
  });

  it('regex mode uses the trigger as a pattern', () => {
    const phone = snip({ trigger: '\\d{3}-\\d{4}', expansion: '<redacted>', match_mode: 'regex' });
    expect(expandSnippets('call 555-1234 now', [phone])).toBe('call <redacted> now');
  });

  it('ignores an invalid regex trigger instead of throwing', () => {
    const bad = snip({ trigger: '([', expansion: 'X', match_mode: 'regex' });
    expect(expandSnippets('test [ text', [bad])).toBe('test [ text');
  });
});
