// Push-to-talk via uiohook-napi keydown/keyup (globalShortcut has no keyup).
// Default F13 (mac) / Ctrl+Space (win). Fn is NOT supported by uiohook (amendment 1).
import { uIOhook, UiohookKey } from 'uiohook-napi';

export interface Combo {
  keycode: number;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

interface UiEvent {
  keycode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Parse "F13" or "Ctrl+Space" / "Cmd+Shift+D" into a Combo (null if the key is unknown). */
export function parseCombo(spec: string): Combo | null {
  const parts = spec.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const keyName = parts[parts.length - 1] as string;
  const keycode = (UiohookKey as Record<string, number>)[keyName];
  if (keycode === undefined) return null;
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  return {
    keycode,
    ctrl: mods.includes('ctrl') || mods.includes('control'),
    meta: mods.includes('cmd') || mods.includes('meta') || mods.includes('command'),
    alt: mods.includes('alt') || mods.includes('option'),
    shift: mods.includes('shift'),
  };
}

export function comboMatches(combo: Combo, e: UiEvent): boolean {
  return (
    e.keycode === combo.keycode &&
    (!combo.ctrl || e.ctrlKey) &&
    (!combo.meta || e.metaKey) &&
    (!combo.alt || e.altKey) &&
    (!combo.shift || e.shiftKey)
  );
}

export class HotkeyManager {
  private combo: Combo | null = null;
  private mode: 'hold' | 'toggle' = 'hold';
  private active = false;
  private started = false;

  constructor(
    private readonly onStart: () => void,
    private readonly onStop: () => void,
  ) {}

  setKey(spec: string, mode: 'hold' | 'toggle' = 'hold'): boolean {
    const c = parseCombo(spec);
    this.combo = c;
    this.mode = mode;
    return c !== null;
  }

  private handleDown = (e: UiEvent): void => {
    if (!this.combo) return;
    if (!comboMatches(this.combo, e)) return;
    if (this.mode === 'toggle') {
      this.active = !this.active;
      this.active ? this.onStart() : this.onStop();
    } else if (!this.active) {
      this.active = true;
      this.onStart();
    }
  };

  private handleUp = (e: UiEvent): void => {
    if (!this.combo || this.mode === 'toggle') return;
    if (this.active && e.keycode === this.combo.keycode) {
      this.active = false;
      this.onStop();
    }
  };

  start(): void {
    if (this.started) return;
    uIOhook.on('keydown', this.handleDown);
    uIOhook.on('keyup', this.handleUp);
    uIOhook.start();
    this.started = true;
  }

  stop(): void {
    if (!this.started) return;
    uIOhook.removeListener('keydown', this.handleDown);
    uIOhook.removeListener('keyup', this.handleUp);
    uIOhook.stop();
    this.started = false;
    this.active = false;
  }
}
