import type { LlmProvider, LlmProviderOptions, LlmResult } from '../types.ts';

/**
 * Deterministic mock LLM. Makes the whole app run end-to-end with no real key:
 * applies light, visible cleanup (collapse whitespace, strip common filler,
 * capitalize first letter, ensure terminal punctuation) so the "polish" step
 * demonstrably changes the text.
 */
export class MockLlm implements LlmProvider {
  readonly id = 'mock';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async complete(_system: string, user: string, _opts?: LlmProviderOptions): Promise<LlmResult> {
    const transcript = extractTranscript(user);
    const polished = mockPolish(transcript);
    return {
      text: polished,
      tokensIn: roughTokens(user),
      tokensOut: roughTokens(polished),
      model: 'mock-polish-1',
    };
  }
}

/** The format function passes the transcript inside the user turn after a marker. */
function extractTranscript(user: string): string {
  const idx = user.lastIndexOf('Transcript:');
  return (idx >= 0 ? user.slice(idx + 'Transcript:'.length) : user).trim();
}

const FILLER = /\b(um+|uh+|er+|like|you know|i mean|sort of|kind of)\b[,]?/gi;

export function mockPolish(text: string): string {
  let t = text.replace(FILLER, '');
  t = t.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  if (t.length === 0) return t;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

function roughTokens(s: string): number {
  return Math.max(1, Math.round(s.trim().split(/\s+/).filter(Boolean).length * 1.3));
}
