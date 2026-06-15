declare global {
  interface Window {
    wisopen: {
      invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
      send(channel: string, payload?: unknown): void;
      on(channel: string, cb: (payload: unknown) => void): () => void;
    };
  }
}

export {};
