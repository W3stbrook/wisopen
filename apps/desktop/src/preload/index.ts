// Context-isolated bridge. Exposes a contract-typed IPC surface on window.wisopen.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  IpcInvokeChannel,
  IpcSend,
  IpcSendChannel,
  IpcEvents,
  IpcEventChannel,
} from '@wisopen/shared';

const api = {
  invoke<T = unknown>(channel: IpcInvokeChannel, ...args: unknown[]): Promise<T> {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },
  send<C extends IpcSendChannel>(channel: C, payload: IpcSend[C]): void {
    ipcRenderer.send(channel, payload);
  },
  on<C extends IpcEventChannel>(channel: C, cb: (payload: IpcEvents[C]) => void): () => void {
    const listener = (_e: unknown, payload: unknown): void => cb(payload as IpcEvents[C]);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('wisopen', api);

export type WisopenBridge = typeof api;
