// Encrypts sensitive strings with Electron safeStorage (OS keychain/DPAPI backed),
// persisting the ciphertext (base64) via the JSON Store. (spec amendment 2)
import { safeStorage } from 'electron';
import type { Store } from './store.js';

export class SecretStore {
  constructor(private readonly store: Store) {}

  available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  set(plain: string | null): void {
    if (plain === null) {
      this.store.setSecretB64(null);
      return;
    }
    if (!this.available()) {
      // Don't persist secrets in plaintext. User will re-auth next launch.
      console.warn('[secrets] safeStorage unavailable — refresh token not persisted');
      this.store.setSecretB64(null);
      return;
    }
    this.store.setSecretB64(safeStorage.encryptString(plain).toString('base64'));
  }

  get(): string | null {
    const b64 = this.store.getSecretB64();
    if (!b64 || !this.available()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch {
      return null;
    }
  }
}

/**
 * supabase-js storage adapter backed by SecretStore. supabase-js keeps the whole
 * session (incl. refresh token) under one or more keys; we keep them in one
 * encrypted blob.
 */
export class SecretSessionStorage {
  constructor(private readonly secret: SecretStore) {}
  private read(): Record<string, string> {
    const s = this.secret.get();
    try {
      return s ? (JSON.parse(s) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  private writeMap(m: Record<string, string>): void {
    this.secret.set(JSON.stringify(m));
  }
  getItem(key: string): string | null {
    return this.read()[key] ?? null;
  }
  setItem(key: string, value: string): void {
    const m = this.read();
    m[key] = value;
    this.writeMap(m);
  }
  removeItem(key: string): void {
    const m = this.read();
    delete m[key];
    this.writeMap(m);
  }
}
