// Push-to-talk via uiohook-napi keydown/keyup (globalShortcut has no keyup).
// Default F13 (mac) / Ctrl+Space (win). Fn is NOT supported by uiohook (amendment 1).
import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { PttMode } from '@wisopen/shared';

export interface Combo {
  keycode: number;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface UiEvent {
  keycode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface HotkeyStartOptions {
  handsFree?: boolean;
}

/** ms between two taps to count as double-tap (hands-free). */
export const DOUBLE_TAP_MS = 400;
/** ms to wait before starting hold-PTT (lets double-tap win). */
export const HOLD_DELAY_MS = 250;

const MODIFIER_KEY_NAMES = new Set([
  'Ctrl',
  'Control',
  'LeftControl',
  'RightControl',
  'Meta',
  'LeftMeta',
  'RightMeta',
  'Command',
  'Alt',
  'LeftAlt',
  'RightAlt',
  'Option',
  'Shift',
  'LeftShift',
  'RightShift',
]);

/** keycode → uiohook name (first alias wins). */
const KEYCODE_TO_NAME = ((): Map<number, string> => {
  const map = new Map<number, string>();
  for (const [name, code] of Object.entries(UiohookKey)) {
    if (typeof code !== 'number' || MODIFIER_KEY_NAMES.has(name)) continue;
    if (!map.has(code)) map.set(code, name);
  }
  return map;
})();

/** Turn a keydown event into a parseable combo string (e.g. `Ctrl+Space`, `F13`). */
export function formatCombo(e: UiEvent): string | null {
  const keyName = KEYCODE_TO_NAME.get(e.keycode);
  if (!keyName || MODIFIER_KEY_NAMES.has(keyName)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(keyName);
  return parts.join('+');
}

/** Wait for the next non-modifier key chord (uiohook must already be running). */
export function captureNextCombo(timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const onDown = (e: UiEvent): void => {
      const combo = formatCombo(e);
      if (!combo || parseCombo(combo) === null) return;
      cleanup();
      resolve(combo);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out — press a key within 15 seconds.'));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      uIOhook.removeListener('keydown', onDown);
    };
    uIOhook.on('keydown', onDown);
  });
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

function comboReleased(combo: Combo, e: UiEvent): boolean {
  return (
    e.keycode === combo.keycode ||
    (combo.ctrl && !e.ctrlKey) ||
    (combo.meta && !e.metaKey) ||
    (combo.alt && !e.altKey) ||
    (combo.shift && !e.shiftKey)
  );
}

export class HotkeyManager {
  private combo: Combo | null = null;
  private mode: PttMode = 'hybrid';
  private holdActive = false;
  private handsFreeActive = false;
  private toggleActive = false;
  private keyPressed = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private doubleTapTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingDoubleTap = false;
  private started = false;

  constructor(
    private readonly onStart: (opts?: HotkeyStartOptions) => void,
    private readonly onStop: () => void,
  ) {}

  setKey(spec: string, mode: PttMode = 'hybrid'): boolean {
    const c = parseCombo(spec);
    this.combo = c;
    this.mode = mode;
    return c !== null;
  }

  isHandsFree(): boolean {
    return this.handsFreeActive;
  }

  private clearHoldTimer(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private clearDoubleTapTimer(): void {
    if (this.doubleTapTimer) {
      clearTimeout(this.doubleTapTimer);
      this.doubleTapTimer = null;
    }
  }

  releaseActiveState(): void {
    this.holdActive = false;
    this.handsFreeActive = false;
    this.toggleActive = false;
    this.keyPressed = false;
    this.awaitingDoubleTap = false;
    this.clearHoldTimer();
    this.clearDoubleTapTimer();
  }

  private resetSessionFlags(): void {
    this.releaseActiveState();
  }

  private handleDown = (e: UiEvent): void => {
    if (!this.combo || !comboMatches(this.combo, e)) return;

    if (this.mode === 'toggle') {
      this.toggleActive = !this.toggleActive;
      this.toggleActive ? this.onStart({ handsFree: true }) : this.onStop();
      return;
    }

    // hands-free (from double-tap): single press ends the session
    if (this.handsFreeActive) {
      this.handsFreeActive = false;
      this.onStop();
      return;
    }

    if (this.keyPressed) return;
    this.keyPressed = true;

    if (this.mode === 'hybrid') {
      if (this.awaitingDoubleTap) {
        this.clearDoubleTapTimer();
        this.awaitingDoubleTap = false;
        this.handsFreeActive = true;
        this.onStart({ handsFree: true });
        return;
      }
      this.clearHoldTimer();
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (this.keyPressed && !this.handsFreeActive && !this.holdActive) {
          this.holdActive = true;
          this.onStart();
        }
      }, HOLD_DELAY_MS);
      return;
    }

    // plain hold — start immediately
    if (!this.holdActive) {
      this.holdActive = true;
      this.onStart();
    }
  };

  private handleUp = (e: UiEvent): void => {
    if (!this.combo || this.mode === 'toggle' || this.handsFreeActive) return;
    if (!comboReleased(this.combo, e)) return;

    this.keyPressed = false;
    this.clearHoldTimer();

    if (this.mode === 'hybrid') {
      if (this.holdActive) {
        this.holdActive = false;
        this.onStop();
      } else {
        this.awaitingDoubleTap = true;
        this.clearDoubleTapTimer();
        this.doubleTapTimer = setTimeout(() => {
          this.doubleTapTimer = null;
          this.awaitingDoubleTap = false;
        }, DOUBLE_TAP_MS);
      }
      return;
    }

    if (this.holdActive) {
      this.holdActive = false;
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
    this.resetSessionFlags();
  }
}
