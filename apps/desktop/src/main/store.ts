// Local persistence: a single JSON file under userData. Holds settings, cached
// snippets/dictionary/modes, local history, and the encrypted refresh-token blob
// (base64 of the safeStorage ciphertext). No native deps — Node-testable.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { AppSettings, Snippet, DictionaryTerm, Mode } from '@wisopen/shared';
import { DEFAULT_SETTINGS } from '@wisopen/shared';

export interface HistoryItem {
  id: string;
  raw: string;
  final: string;
  lang: string | null;
  audio_seconds: number;
  created_at: number;
}

interface StoreData {
  settings: Partial<AppSettings>;
  secretB64: string | null;
  cache: { snippets: Snippet[]; dictionary: DictionaryTerm[]; modes: Mode[] };
  history: HistoryItem[];
}

const EMPTY: StoreData = {
  settings: {},
  secretB64: null,
  cache: { snippets: [], dictionary: [], modes: [] },
  history: [],
};

export class Store {
  private data: StoreData;
  constructor(private readonly path: string) {
    this.data = this.read();
  }

  private read(): StoreData {
    try {
      if (existsSync(this.path)) {
        return { ...EMPTY, ...(JSON.parse(readFileSync(this.path, 'utf8')) as StoreData) };
      }
    } catch {
      /* corrupt file -> start fresh */
    }
    return structuredClone(EMPTY);
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path); // atomic-ish
  }

  getSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.data.settings };
  }
  setSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch };
    this.write();
    return this.getSettings();
  }

  getSecretB64(): string | null {
    return this.data.secretB64;
  }
  setSecretB64(b64: string | null): void {
    this.data.secretB64 = b64;
    this.write();
  }

  getCache(): StoreData['cache'] {
    return this.data.cache;
  }
  setCache(patch: Partial<StoreData['cache']>): void {
    this.data.cache = { ...this.data.cache, ...patch };
    this.write();
  }

  getHistory(limit = 100): HistoryItem[] {
    return this.data.history.slice(0, limit);
  }
  addHistory(d: { raw: string; final: string; audioSeconds: number; lang: string | null }): HistoryItem {
    const item: HistoryItem = {
      id: randomUUID(),
      raw: d.raw,
      final: d.final,
      lang: d.lang,
      audio_seconds: d.audioSeconds,
      created_at: Date.now(),
    };
    this.data.history.unshift(item);
    if (this.data.history.length > 500) this.data.history.length = 500;
    this.write();
    return item;
  }
}
