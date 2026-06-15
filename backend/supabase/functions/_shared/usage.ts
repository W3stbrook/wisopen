// Usage-token normalization (spec amendment 5): three providers, three field shapes.
// Pure helpers — unit-tested in Node.

export interface NormalizedTokens {
  tokensIn: number;
  tokensOut: number;
}

/** OpenAI Chat Completions: prompt_tokens / completion_tokens. */
export function normalizeOpenAiChatUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined | null,
): NormalizedTokens {
  return { tokensIn: usage?.prompt_tokens ?? 0, tokensOut: usage?.completion_tokens ?? 0 };
}

/** OpenAI Responses API: input_tokens / output_tokens. */
export function normalizeOpenAiResponsesUsage(
  usage: { input_tokens?: number; output_tokens?: number } | undefined | null,
): NormalizedTokens {
  return { tokensIn: usage?.input_tokens ?? 0, tokensOut: usage?.output_tokens ?? 0 };
}

/** Bedrock Converse: inputTokens / outputTokens. */
export function normalizeBedrockUsage(
  usage: { inputTokens?: number; outputTokens?: number } | undefined | null,
): NormalizedTokens {
  return { tokensIn: usage?.inputTokens ?? 0, tokensOut: usage?.outputTokens ?? 0 };
}

export interface UsageRow {
  user_id: string;
  kind: 'stt' | 'llm';
  provider: string;
  model: string | null;
  audio_seconds?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
}

// Rough public list prices (USD); adjust as pricing changes. LLM = $/1K tokens, STT = $/audio-second.
const PRICES: Record<string, { in?: number; out?: number; audioSec?: number }> = {
  'openai-compatible': { in: 0.00015, out: 0.0006 }, // ~gpt-4o-mini
  bedrock: { in: 0.003, out: 0.015 }, // ~claude-3.5-sonnet
  'aws-transcribe': { audioSec: 0.0004 },
  openai: { audioSec: 0.0001 },
  mock: {},
  raw: {},
};

/** Estimate the USD cost of a usage row from token/audio counts. */
export function estimateCost(row: UsageRow): number {
  const p = PRICES[row.provider] ?? {};
  let c = 0;
  if (row.tokens_in && p.in) c += (row.tokens_in / 1000) * p.in;
  if (row.tokens_out && p.out) c += (row.tokens_out / 1000) * p.out;
  if (row.audio_seconds && p.audioSec) c += row.audio_seconds * p.audioSec;
  return Math.round(c * 1e6) / 1e6;
}

/** Insert a usage_events row. `insert` is injected (a supabase admin client method) for testability. */
export async function logUsage(
  insert: (table: string, row: Record<string, unknown>) => PromiseLike<{ error: unknown }>,
  row: UsageRow,
): Promise<void> {
  const { error } = await insert('usage_events', { ...row, cost_estimate: estimateCost(row) });
  if (error) {
    // best-effort metering — never fail the request because logging failed
    console.error('usage log failed', error);
  }
}
