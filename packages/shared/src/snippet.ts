// Deterministic shortcut expansion. Applied client-side AFTER the LLM polish pass so the
// model can never mangle URLs (spec §7.3). Single left-to-right, non-overlapping, longest-first scan.

import type { Snippet } from './domain.js';

interface Compiled {
  regex: RegExp;
  expansion: string;
  triggerLen: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(s: Snippet): Compiled | null {
  try {
    if (s.match_mode === 'regex') {
      // user-provided pattern; force global so lastIndex scanning works
      return { regex: new RegExp(s.trigger, 'gi'), expansion: s.expansion, triggerLen: s.trigger.length };
    }
    // phrase / exact: word-boundary, internal whitespace flexible
    const body = escapeRegExp(s.trigger.trim()).replace(/\s+/g, '\\s+');
    const flags = s.match_mode === 'exact' ? 'g' : 'gi';
    return { regex: new RegExp(`\\b${body}\\b`, flags), expansion: s.expansion, triggerLen: s.trigger.length };
  } catch {
    // invalid regex trigger -> skip this snippet rather than throw
    return null;
  }
}

/**
 * Replace enabled snippet triggers in `text` with their expansions.
 * - case-insensitive by default ('phrase'); 'exact' is case-sensitive; 'regex' is a pattern.
 * - word-boundary matching for phrase/exact (no mid-word hits).
 * - longest trigger wins at any given position; expansions are never re-scanned.
 */
export function expandSnippets(text: string, snippets: Snippet[]): string {
  const compiled = snippets
    .filter((s) => s.enabled)
    .map((s) => ({ s, c: compile(s) }))
    .filter((x): x is { s: Snippet; c: Compiled } => x.c !== null)
    .sort((a, b) => b.c.triggerLen - a.c.triggerLen)
    .map((x) => x.c);

  if (compiled.length === 0) return text;

  let out = '';
  let i = 0;
  while (i < text.length) {
    let best: { start: number; end: number; expansion: string } | null = null;
    for (const c of compiled) {
      c.regex.lastIndex = i;
      const m = c.regex.exec(text);
      if (!m) continue;
      const start = m.index;
      const len = m[0].length;
      if (len === 0) continue;
      if (
        best === null ||
        start < best.start ||
        (start === best.start && len > best.end - best.start)
      ) {
        best = { start, end: start + len, expansion: c.expansion };
      }
    }
    if (best === null) break;
    out += text.slice(i, best.start) + best.expansion;
    i = best.end;
  }
  out += text.slice(i);
  return out;
}
