import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Electron safeStorage with a reversible fake cipher.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}));

import { SecretStore, SecretSessionStorage } from './secrets.js';

// Minimal in-memory Store stand-in (only the secret-blob methods are used).
class FakeStore {
  private b64: string | null = null;
  getSecretB64(): string | null {
    return this.b64;
  }
  setSecretB64(v: string | null): void {
    this.b64 = v;
  }
}

describe('SecretStore', () => {
  let store: FakeStore;
  let secret: SecretStore;
  beforeEach(() => {
    store = new FakeStore();
    secret = new SecretStore(store as never);
  });

  it('encrypts on set and decrypts on get (round-trip)', () => {
    secret.set('refresh-token-xyz');
    // stored value is base64 ciphertext, not plaintext
    const stored = store.getSecretB64();
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored as string, 'base64').toString('utf8')).toBe('enc:refresh-token-xyz');
    expect(secret.get()).toBe('refresh-token-xyz');
  });

  it('clears on set(null)', () => {
    secret.set('x');
    secret.set(null);
    expect(secret.get()).toBeNull();
  });
});

describe('SecretSessionStorage (supabase storage adapter)', () => {
  it('get/set/remove via the encrypted blob', () => {
    const storage = new SecretSessionStorage(new SecretStore(new FakeStore() as never));
    expect(storage.getItem('wisopen-auth')).toBeNull();
    storage.setItem('wisopen-auth', '{"session":1}');
    expect(storage.getItem('wisopen-auth')).toBe('{"session":1}');
    storage.removeItem('wisopen-auth');
    expect(storage.getItem('wisopen-auth')).toBeNull();
  });
});
