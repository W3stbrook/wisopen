// Cross-tier wire DTOs: the `format` HTTP contract and the `stt-stream` WS message protocol.

import type { ProviderId } from './domain.js';

/** POST /functions/v1/format request body. */
export interface FormatRequest {
  transcript: string;
  mode_id: string | null;
  lang?: string | null;
  /** Dictionary terms passed inline so the function need not query (it can also query w/ caller RLS). */
  dictionary?: string[];
}

/** POST /functions/v1/format response body. */
export interface FormatResponse {
  final_text: string;
  tokens_in: number;
  tokens_out: number;
  provider: ProviderId;
  model: string | null;
}

// ---- stt-stream WebSocket protocol ----
// Client connects to ws://<host>/functions/v1/stt-stream and passes the Supabase
// access token via the Sec-WebSocket-Protocol subprotocol: `jwt-<access_token>`.

/** Sent by the client (Electron engine renderer) over the WS. */
export type SttClientMsg =
  | { t: 'config'; sampleRate: number; lang?: string | null; dictionary?: string[] }
  | { t: 'audio'; /** base64 PCM16 little-endian mono frame */ pcm: string }
  | { t: 'end' };

/** Sent by the backend (stt-stream edge function) over the WS. */
export type SttServerMsg =
  | { t: 'ready' }
  | { t: 'partial'; text: string }
  | { t: 'final'; text: string; audioSeconds: number }
  | { t: 'error'; message: string; code?: string };
