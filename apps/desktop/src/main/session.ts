// Orchestrates one dictation: hotkey -> engine(STT) -> format(LLM) -> snippet
// expansion -> injection -> history. Dependencies are injected so this is unit-testable
// without Electron.
import { expandSnippets } from '@wisopen/shared';
import type {
  AppSettings,
  FormatResponse,
  OverlayState,
  Snippet,
} from '@wisopen/shared';

export interface SessionDeps {
  getJwt: () => Promise<string | null>;
  callFormat: (req: {
    transcript: string;
    mode_id: string | null;
    lang?: string | null;
    dictionary?: string[];
  }) => Promise<FormatResponse>;
  getSettings: () => AppSettings;
  getSnippets: () => Snippet[];
  getDictionary: () => string[];
  overlay: (state: OverlayState, extra?: { partial?: string; message?: string }) => void;
  engineCommand: (cmd: { cmd: 'start' | 'stop'; jwt: string; supabaseUrl: string; sampleRate: number }) => void;
  inject: (text: string, mode: 'paste' | 'keystroke') => Promise<string>;
  addHistory: (d: { raw: string; final: string; audioSeconds: number; lang: string | null }) => void;
  onResult?: (final: string) => void;
  supabaseUrl: string;
  sampleRate: number;
}

export class Session {
  private busy = false;
  private snippetsSnapshot: Snippet[] = [];
  constructor(private readonly deps: SessionDeps) {}

  async start(): Promise<void> {
    if (this.busy) return;
    const jwt = await this.deps.getJwt();
    if (!jwt) {
      this.deps.overlay('error', { message: 'Not signed in' });
      return;
    }
    this.busy = true;
    this.snippetsSnapshot = this.deps.getSnippets();
    this.deps.overlay('listening');
    this.deps.engineCommand({
      cmd: 'start',
      jwt,
      supabaseUrl: this.deps.supabaseUrl,
      sampleRate: this.deps.sampleRate,
    });
  }

  stop(): void {
    if (!this.busy) return;
    this.deps.engineCommand({ cmd: 'stop', jwt: '', supabaseUrl: this.deps.supabaseUrl, sampleRate: this.deps.sampleRate });
  }

  onPartial(text: string): void {
    if (!this.busy) return;
    this.deps.overlay('transcribing', { partial: text });
  }

  async onFinal(payload: { text: string; audioSeconds: number }): Promise<void> {
    if (!this.busy) return;
    const settings = this.deps.getSettings();
    try {
      this.deps.overlay('polishing');
      const resp = await this.deps.callFormat({
        transcript: payload.text,
        mode_id: settings.defaultModeId,
        lang: settings.uiLanguage,
        dictionary: this.deps.getDictionary(),
      });
      const expanded = expandSnippets(resp.final_text, this.snippetsSnapshot);
      this.deps.overlay('inserting');
      await this.deps.inject(expanded, settings.injectionMode);
      this.deps.overlay('done');
      if (settings.saveHistory) {
        this.deps.addHistory({
          raw: payload.text,
          final: expanded,
          audioSeconds: payload.audioSeconds,
          lang: settings.uiLanguage,
        });
      }
      this.deps.onResult?.(expanded);
    } catch (e) {
      this.deps.overlay('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy = false;
    }
  }

  onError(message: string): void {
    this.deps.overlay('error', { message });
    this.busy = false;
  }
}
