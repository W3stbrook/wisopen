// Typed IPC contract between Electron main and renderers.
// `invoke` channels are request/response; `event` channels are main -> renderer pushes.

import type { AppSettings, Snippet, DictionaryTerm, Mode, Dictation } from './domain.js';

export type OverlayState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'polishing'
  | 'inserting'
  | 'done'
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
  'auth:signInOtp': (p: { email: string }) => { sent: boolean };
  'auth:signOut': () => void;
  'auth:getJwt': () => { jwt: string | null; supabaseUrl: string };

  'settings:get': () => AppSettings;
  'settings:set': (patch: Partial<AppSettings>) => AppSettings;

  'data:listSnippets': () => Snippet[];
  'data:upsertSnippet': (s: Partial<Snippet> & { trigger: string; expansion: string }) => Snippet;
  'data:deleteSnippet': (id: string) => void;
  'data:listDictionary': () => DictionaryTerm[];
  'data:upsertTerm': (t: Partial<DictionaryTerm> & { term: string }) => DictionaryTerm;
  'data:deleteTerm': (id: string) => void;
  'data:listModes': () => Mode[];
  'data:listHistory': (p: { limit: number }) => Dictation[];

  'perms:status': () => { microphone: string; accessibility: boolean; inputMonitoring: boolean };
  'perms:requestMicrophone': () => boolean;
  'perms:openSettingsPane': (pane: 'microphone' | 'accessibility' | 'input-monitoring') => void;

  'dictation:start': () => void;
  'dictation:stop': () => void;

  // engine renderer -> main
  'engine:partial': (p: { text: string }) => void;
  'engine:final': (p: { text: string; audioSeconds: number }) => void;
  'engine:level': (p: { level: number }) => void;
  'engine:error': (p: { message: string }) => void;
}

/** main -> renderer pushes (ipcRenderer.on) */
export interface IpcEvents {
  'overlay:state': { state: OverlayState; partial?: string; level?: number; message?: string };
  'auth:changed': AuthStatus;
  'engine:command': { cmd: 'start' | 'stop'; jwt: string; supabaseUrl: string; sampleRate: number };
  'dictation:result': { final: string };
}

export type IpcInvokeChannel = keyof IpcInvoke;
export type IpcEventChannel = keyof IpcEvents;
