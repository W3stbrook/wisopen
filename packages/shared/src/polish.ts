/** Heuristic: does this transcript need an LLM polish pass? (FreeFlow-style fast path) */
export function needsLlmPolish(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b(um+|uh+|er+|ah+|hmm+|like|you know)\b/i.test(t)) return true;
  if (/\b(no wait|actually|i mean|sorry|scratch that)\b/i.test(t)) return true;
  if (t.includes('\n')) return true;
  if ((t.match(/[.!?]/g) ?? []).length >= 2 && t.length > 80) return true;
  if (/[A-Z]{3,}/.test(t) && t.length > 40) return true; // likely proper nouns / acronyms need care
  return false;
}

/** Lightweight local cleanup when skipping the LLM (capitalize, trim). */
export function quickPolish(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
