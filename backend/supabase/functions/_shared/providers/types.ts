// Provider interfaces — self-contained for the Deno edge runtime (mirrors
// packages/shared/src/providers.ts; kept standalone because edge functions are
// bundled in isolation and cannot import the workspace package).

export interface SttEvent {
  kind: 'partial' | 'final';
  text: string;
  audioSeconds?: number;
}

export interface SttSession {
  pushAudio(frame: Uint8Array): void;
  end(): void;
  events(): AsyncIterable<SttEvent>;
}

export interface SttProviderOptions {
  sampleRate: number;
  lang?: string | null;
  dictionary?: string[];
}

export interface SttProvider {
  readonly id: string;
  readonly mode: 'streaming' | 'buffered';
  openSession(opts: SttProviderOptions): SttSession;
}

export interface LlmResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string | null;
}

export interface LlmProviderOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly id: string;
  complete(system: string, user: string, opts?: LlmProviderOptions): Promise<LlmResult>;
}
