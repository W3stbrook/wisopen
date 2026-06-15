// Wires the IPC contract (packages/shared ipc.ts) to the main-process modules.
import { ipcMain } from 'electron';
import type { IpcInvoke, IpcInvokeChannel } from '@wisopen/shared';
import type { ApiClient } from './auth.js';
import type { Store } from './store.js';
import type { Session } from './session.js';
import type { Windows } from './windows.js';
import { getConfig } from './config.js';
import { permStatus, requestMicrophone, openSettingsPane } from './permissions.js';

export interface IpcContext {
  api: ApiClient;
  store: Store;
  session: Session;
  windows: Windows;
  update: { install: () => void; check: () => void };
}

export function registerIpc(ctx: IpcContext): void {
  const { api, store, session, windows } = ctx;
  const h = <C extends IpcInvokeChannel>(
    channel: C,
    fn: (...args: Parameters<IpcInvoke[C]>) => ReturnType<IpcInvoke[C]> | Promise<Awaited<ReturnType<IpcInvoke[C]>>>,
  ): void => {
    ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...(args as unknown[])));
  };

  // auth
  h('auth:status', () => api.status());
  h('auth:signInPassword', (p) => {
    const { email, password } = p as { email: string; password: string };
    return api.signInPassword(email, password);
  });
  h('auth:signUpPassword', (p) => {
    const { email, password } = p as { email: string; password: string };
    return api.signUpPassword(email, password);
  });
  h('auth:signInOtp', (p) => api.signInOtp((p as { email: string }).email));
  h('auth:signOut', () => api.signOut());
  h('auth:getJwt', async () => ({ jwt: await api.getJwt(), supabaseUrl: getConfig().supabaseUrl }));

  // settings
  h('settings:get', () => store.getSettings());
  h('settings:set', (patch) => store.setSettings(patch));

  // data CRUD (RLS) + refresh local cache for fast snippet expansion
  h('data:listSnippets', async () => {
    const s = await api.listSnippets();
    store.setCache({ snippets: s });
    return s;
  });
  h('data:upsertSnippet', async (s) => {
    const row = await api.upsertSnippet(s as never);
    store.setCache({ snippets: await api.listSnippets() });
    return row;
  });
  h('data:deleteSnippet', async (id) => {
    await api.deleteSnippet(id as string);
    store.setCache({ snippets: await api.listSnippets() });
  });
  h('data:listDictionary', async () => {
    const d = await api.listDictionary();
    store.setCache({ dictionary: d });
    return d;
  });
  h('data:upsertTerm', async (t) => {
    const row = await api.upsertTerm(t as never);
    store.setCache({ dictionary: await api.listDictionary() });
    return row;
  });
  h('data:deleteTerm', async (id) => {
    await api.deleteTerm(id as string);
    store.setCache({ dictionary: await api.listDictionary() });
  });
  h('data:listModes', async () => {
    const m = await api.listModes();
    store.setCache({ modes: m });
    return m;
  });
  h('data:upsertMode', async (m) => {
    const row = await api.upsertMode(m as never);
    store.setCache({ modes: await api.listModes() });
    return row;
  });
  h('data:deleteMode', async (id) => {
    await api.deleteMode(id as string);
    store.setCache({ modes: await api.listModes() });
  });
  h('data:listHistory', (p) => store.getHistory((p as { limit: number }).limit));

  // permissions
  h('perms:status', () => permStatus());
  h('perms:requestMicrophone', () => requestMicrophone());
  h('perms:openSettingsPane', (pane) =>
    openSettingsPane(pane as 'microphone' | 'accessibility' | 'input-monitoring'),
  );

  // dictation control (from UI or hotkey)
  h('dictation:start', () => session.start());
  h('dictation:stop', () => session.stop());

  // auto-update
  h('update:install', () => ctx.update.install());
  h('update:check', () => ctx.update.check());

  // engine renderer -> main (fire-and-forget)
  ipcMain.on('engine:partial', (_e, p: { text: string }) => session.onPartial(p.text));
  ipcMain.on('engine:final', (_e, p: { text: string; audioSeconds: number }) => void session.onFinal(p));
  ipcMain.on('engine:error', (_e, p: { message: string }) => session.onError(p.message));
  ipcMain.on('engine:level', (_e, p: { level: number }) => windows.overlayLevel(p.level));
}
