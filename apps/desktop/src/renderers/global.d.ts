import type {
  IpcInvokeChannel,
  IpcSend,
  IpcSendChannel,
  IpcEvents,
  IpcEventChannel,
} from '@wisopen/shared';

declare global {
  interface Window {
    wisopen: {
      invoke<T = unknown>(channel: IpcInvokeChannel, ...args: unknown[]): Promise<T>;
      send<C extends IpcSendChannel>(channel: C, payload: IpcSend[C]): void;
      on<C extends IpcEventChannel>(channel: C, cb: (payload: IpcEvents[C]) => void): () => void;
    };
  }
}

export {};
