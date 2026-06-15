// Context-isolated bridge. Exposes a minimal generic IPC surface on window.wisopen.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },
  send(channel: string, payload?: unknown): void {
    ipcRenderer.send(channel, payload);
  },
  on(channel: string, cb: (payload: unknown) => void): () => void {
    const listener = (_e: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('wisopen', api);

export type WisopenBridge = typeof api;
