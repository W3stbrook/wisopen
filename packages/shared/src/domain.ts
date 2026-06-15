// Domain types — mirror the Postgres schema (spec §6.1). Used across client + tests.

export type UiLanguage = 'en' | 'it';

export interface Profile {
  id: string;
  display_name: string | null;
  plan: string;
  ui_language: UiLanguage;
  settings: Record<string, unknown>;
  created_at: string;
}

export type SnippetMatchMode = 'phrase' | 'exact' | 'regex';

export interface Snippet {
  id: string;
  user_id: string;
  trigger: string;
  expansion: string;
  enabled: boolean;
  match_mode: SnippetMatchMode;
  created_at: string;
}

export interface DictionaryTerm {
  id: string;
  user_id: string;
  term: string;
  sounds_like: string[];
  enabled: boolean;
  created_at: string;
}

export interface Mode {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  prompt_template: string;
  is_system: boolean;
  is_default: boolean;
  created_at: string;
}

export interface Dictation {
  id: string;
  user_id: string;
  raw_transcript: string;
  final_text: string;
  mode_id: string | null;
  app_context: string | null;
  lang: string | null;
  audio_seconds: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

/** Local (client-side) dictation history entry — lighter than the server `Dictation` row. */
export interface HistoryItem {
  id: string;
  raw: string;
  final: string;
  lang: string | null;
  audio_seconds: number;
  created_at: number;
}

export type UsageKind = 'stt' | 'llm';
export type ProviderId =
  | 'aws-transcribe'
  | 'openai'
  | 'bedrock'
  | 'openai-compatible'
  | 'tensorix'
  | 'mock'
  | 'raw'; // Raw mode = no LLM call (passthrough)

export interface UsageEvent {
  id: string;
  user_id: string;
  kind: UsageKind;
  provider: ProviderId;
  model: string | null;
  audio_seconds: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_estimate: number | null;
  created_at: string;
}

/** Locally-stored, user-tunable app settings (mirrored, not all server-synced). */
export interface AppSettings {
  pttKey: string; // uiohook key name, default 'F13' (mac) / configured combo (win)
  pttMode: 'hold' | 'toggle';
  defaultModeId: string | null;
  injectionMode: 'paste' | 'keystroke';
  uiLanguage: UiLanguage;
  audioDeviceId: string | null;
  saveHistory: boolean;
}

/** Spec default: F13 on macOS, Ctrl+Space on Windows. Evaluated in the main process. */
export function defaultPttKey(
  platform: string = typeof process !== 'undefined' ? process.platform : 'darwin',
): string {
  return platform === 'win32' ? 'Ctrl+Space' : 'F13';
}

export const DEFAULT_SETTINGS: AppSettings = {
  pttKey: defaultPttKey(),
  pttMode: 'hold',
  defaultModeId: null,
  injectionMode: 'paste',
  uiLanguage: 'en',
  audioDeviceId: null,
  saveHistory: true,
};
