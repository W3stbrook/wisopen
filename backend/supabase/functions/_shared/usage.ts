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

/** Insert a usage_events row. `insert` is injected (a supabase admin client method) for testability. */
export async function logUsage(
  insert: (table: string, row: Record<string, unknown>) => Promise<{ error: unknown }>,
  row: UsageRow,
): Promise<void> {
  const { error } = await insert('usage_events', { ...row });
  if (error) {
    // best-effort metering — never fail the request because logging failed
    console.error('usage log failed', error);
  }
}
