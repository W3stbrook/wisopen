// Provider abstraction — implemented in the backend edge functions (Deno mirrors these).
// Kept in shared so the client and tests reason about the same shapes.

export interface SttPartial {
  kind: 'partial';
  text: string;
}
export interface SttFinal {
  kind: 'final';
  text: string;
  audioSeconds: number;
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

/** A live transcription session. Audio frames pushed in; events come out. */
export interface SttSession {
  /** push a PCM16 mono little-endian frame */
  pushAudio(frame: Uint8Array): void;
  /** signal end of utterance (idempotent); the final/error event arrives via events() */
  end(): void;
  /** async iterator of partial/final/error events */
  events(): AsyncIterable<SttEvent>;
}

export interface SttProviderOptions {
  sampleRate: number;
  lang?: string | null;
  dictionary?: string[];
}

export interface SttProvider {
  readonly id: string;
  /** 'streaming' emits partials+final; 'buffered' emits final only at end */
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
  complete(
    system: string,
    user: string,
    opts?: LlmProviderOptions,
  ): Promise<LlmResult>;
}
