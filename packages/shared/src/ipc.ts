// Typed IPC contract between Electron main and renderers.
// `invoke` channels are request/response; `event` channels are main -> renderer pushes.

import type { AppSettings, Snippet, DictionaryTerm, Mode, HistoryItem } from './domain.js';

export type OverlayState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'polishing'
  | 'inserting'
  | 'done'
  | 'cancelled'
  | 'error';

export interface AuthStatus {
  signedIn: boolean;
  email: string | null;
  userId: string | null;
}

/** renderer -> main, request/response (ipcRenderer.invoke / ipcMain.handle) */
export interface IpcInvoke {
  'auth:status': () => AuthStatus;
  'auth:signInPassword': (p: { email: string; password: string }) => AuthStatus;
  'auth:signUpPassword': (p: { email: string; password: string }) => AuthStatus;
  'auth:signInOtp': (p: { email: string }) => { sent: boolean };
  'auth:signOut': () => AuthStatus;
  'auth:getJwt': () => { jwt: string | null; supabaseUrl: string };

  'hotkey:capture': () => { combo: string };
  'app:showOnboarding': () => void;
  'app:showSettings': (p?: { view?: string }) => void;

  'settings:get': () => AppSettings;
  'settings:set': (patch: Partial<AppSettings>) => AppSettings;

  'data:listSnippets': () => Snippet[];
  'data:upsertSnippet': (s: Partial<Snippet> & { trigger: string; expansion: string }) => Snippet;
  'data:deleteSnippet': (id: string) => void;
  'data:listDictionary': () => DictionaryTerm[];
  'data:upsertTerm': (t: Partial<DictionaryTerm> & { term: string }) => DictionaryTerm;
  'data:deleteTerm': (id: string) => void;
  'data:listModes': () => Mode[];
  'data:upsertMode': (m: Partial<Mode> & { name: string; prompt_template: string }) => Mode;
  'data:deleteMode': (id: string) => void;
  'data:listHistory': (p: { limit: number }) => HistoryItem[];

  'perms:status': () => { microphone: string; accessibility: boolean; inputMonitoring: boolean };
  'perms:requestMicrophone': () => boolean;
  'perms:openSettingsPane': (pane: 'microphone' | 'accessibility' | 'input-monitoring') => void;

  'dictation:start': () => void;
  'dictation:stop': () => void;

  'update:install': () => void; // quit + apply a downloaded update now
  'update:check': () => void; // manual "check for updates"
}

/** renderer -> main, fire-and-forget (ipcRenderer.send / ipcMain.on) */
export interface IpcSend {
  'engine:partial': { text: string };
  'engine:final': { text: string; audioSeconds: number };
  'engine:level': { level: number };
  'engine:error': { message: string };
  'engine:noSpeech': Record<string, never>;
}

export type UpdateState = 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error';

/** main -> renderer pushes (ipcRenderer.on) */
export interface IpcEvents {
  'overlay:state': { state: OverlayState; partial?: string; message?: string };
  'overlay:level': { level: number };
  'auth:changed': AuthStatus;
  'update:status': { state: UpdateState; version?: string; percent?: number; message?: string };
  'settings:navigate': { view: string };
  'engine:command': {
    cmd: 'start' | 'stop';
    jwt: string;
    supabaseUrl: string;
    sampleRate: number;
    lang: string | null;
    dictionary: string[];
  };
}

export type IpcInvokeChannel = keyof IpcInvoke;
export type IpcSendChannel = keyof IpcSend;
export type IpcEventChannel = keyof IpcEvents;
