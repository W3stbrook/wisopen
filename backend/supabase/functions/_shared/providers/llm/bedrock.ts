import type { LlmProvider, LlmProviderOptions, LlmResult } from '../types.ts';
import { normalizeBedrockUsage } from '../../usage.ts';

/** Mirrors a Bedrock `ConverseCommand` send (the slice we use). Injected for testability. */
export type Converse = (input: {
  modelId: string;
  system?: { text: string }[];
  messages: { role: 'user' | 'assistant'; content: { text: string }[] }[];
  inferenceConfig?: { maxTokens?: number; temperature?: number };
}) => Promise<{
  output?: { message?: { content?: { text?: string }[] } };
  usage?: { inputTokens?: number; outputTokens?: number };
}>;

/** AWS Bedrock Converse adapter. content is a block array; system is top-level (verified). */
export class BedrockLlm implements LlmProvider {
  readonly id = 'bedrock';
  constructor(
    private readonly converse: Converse,
    private readonly modelId: string,
  ) {}

  async complete(system: string, user: string, opts?: LlmProviderOptions): Promise<LlmResult> {
    const resp = await this.converse({
      modelId: this.modelId,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: {
        maxTokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0.2,
      },
    });
    const text = resp.output?.message?.content?.[0]?.text ?? '';
    const { tokensIn, tokensOut } = normalizeBedrockUsage(resp.usage);
    return { text, tokensIn, tokensOut, model: this.modelId };
  }
}
