import type { LlmProvider, LlmProviderOptions, LlmResult } from '../types.ts';
import { normalizeOpenAiChatUsage } from '../../usage.ts';

/** Mirrors openai `client.chat.completions.create` (the slice we use). Injected for testability. */
export type ChatCreate = (args: {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  max_completion_tokens?: number;
}) => Promise<{
  choices: { message: { content: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}>;

/** OpenAI Chat Completions adapter — also covers Tensorix & any OpenAI-compatible endpoint. */
export class OpenAiCompatibleLlm implements LlmProvider {
  readonly id = 'openai-compatible';
  constructor(
    private readonly chatCreate: ChatCreate,
    private readonly model: string,
  ) {}

  async complete(system: string, user: string, opts?: LlmProviderOptions): Promise<LlmResult> {
    const resp = await this.chatCreate({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: opts?.temperature ?? 0.2,
      ...(opts?.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}),
    });
    const text = resp.choices?.[0]?.message?.content ?? '';
    const { tokensIn, tokensOut } = normalizeOpenAiChatUsage(resp.usage);
    return { text, tokensIn, tokensOut, model: this.model };
  }
}
