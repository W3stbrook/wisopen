// Provider interfaces — self-contained for the Deno edge runtime (mirrors
// packages/shared/src/providers.ts; kept standalone because edge functions are
// bundled in isolation and cannot import the workspace package).

// Mirror of packages/shared/src/providers.ts (kept standalone for the isolated Deno
// bundle). Keep field-for-field in sync; CI `deno check` guards against drift.
export interface SttPartial {
  kind: 'partial';
  text: string;
}
export interface SttFinal {
  kind: 'final';
  text: string;
  audioSeconds?: number;
}
export interface SttErrorEvent {
  kind: 'error';
  message: string;
}
export interface SttCancelled {
  kind: 'cancelled';
  reason: 'no_speech';
}
export type SttEvent = SttPartial | SttFinal | SttErrorEvent | SttCancelled;

export interface SttSession {
  pushAudio(frame: Uint8Array): void;
  /** idempotent: may be called more than once (e.g. on 'end' and on socket close) */
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
