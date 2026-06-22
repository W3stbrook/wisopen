import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCombo, comboMatches, formatCombo, HotkeyManager, HOLD_DELAY_MS, DOUBLE_TAP_MS } from './hotkey.js';
import { UiohookKey } from 'uiohook-napi';

const ev = (over: Partial<{ keycode: number; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
  keycode: 0,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe('formatCombo', () => {
  it('formats a single key', () => {
    expect(formatCombo(ev({ keycode: UiohookKey.F13 }))).toBe('F13');
  });
  it('formats a chord', () => {
    expect(formatCombo(ev({ keycode: UiohookKey.Space, ctrlKey: true }))).toBe('Ctrl+Space');
  });
  it('ignores modifier-only presses', () => {
    expect(formatCombo(ev({ keycode: UiohookKey.Ctrl, ctrlKey: true }))).toBeNull();
  });
});

describe('parseCombo', () => {
  it('parses a single key', () => {
    expect(parseCombo('F13')).toEqual({ keycode: UiohookKey.F13, ctrl: false, meta: false, alt: false, shift: false });
  });
  it('parses a chord with modifier aliases', () => {
    expect(parseCombo('Ctrl+Space')).toMatchObject({ keycode: UiohookKey.Space, ctrl: true });
    expect(parseCombo('Cmd+Shift+A')).toMatchObject({ keycode: UiohookKey.A, meta: true, shift: true });
  });
  it('returns null for unknown key or empty', () => {
    expect(parseCombo('Nope')).toBeNull();
    expect(parseCombo('')).toBeNull();
  });
});

describe('comboMatches', () => {
  const combo = parseCombo('Ctrl+Space')!;
  it('matches when key + required modifier are present', () => {
    expect(comboMatches(combo, ev({ keycode: UiohookKey.Space, ctrlKey: true }))).toBe(true);
  });
  it('does not match without the modifier', () => {
    expect(comboMatches(combo, ev({ keycode: UiohookKey.Space, ctrlKey: false }))).toBe(false);
  });
  it('ignores extra modifiers being pressed', () => {
    expect(comboMatches(combo, ev({ keycode: UiohookKey.Space, ctrlKey: true, shiftKey: true }))).toBe(true);
  });
});

describe('HotkeyManager (hold)', () => {
  it('fires start on key-down once and stop on key-up', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const m = new HotkeyManager(onStart, onStop);
    m.setKey('F13', 'hold');
    const down = (m as unknown as { handleDown: (e: unknown) => void }).handleDown;
    const up = (m as unknown as { handleUp: (e: unknown) => void }).handleUp;
    down(ev({ keycode: UiohookKey.F13 }));
    expect(onStart).toHaveBeenCalledTimes(1);
    down(ev({ keycode: UiohookKey.F13 })); // repeat down should not re-fire
    up(ev({ keycode: UiohookKey.F13 }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('chord stops when the modifier is released', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const m = new HotkeyManager(onStart, onStop);
    m.setKey('Ctrl+Space', 'hold');
    const down = (m as unknown as { handleDown: (e: unknown) => void }).handleDown;
    const up = (m as unknown as { handleUp: (e: unknown) => void }).handleUp;
    down(ev({ keycode: UiohookKey.Space, ctrlKey: true }));
    expect(onStart).toHaveBeenCalledTimes(1);
    up(ev({ keycode: UiohookKey.Space, ctrlKey: false })); // ctrl released first
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('HotkeyManager (hybrid)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts hold-PTT after the hold delay', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const m = new HotkeyManager(onStart, onStop);
    m.setKey('F13', 'hybrid');
    const down = (m as unknown as { handleDown: (e: unknown) => void }).handleDown;
    const up = (m as unknown as { handleUp: (e: unknown) => void }).handleUp;
    down(ev({ keycode: UiohookKey.F13 }));
    expect(onStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOLD_DELAY_MS);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]?.length ?? 0).toBe(0);
    up(ev({ keycode: UiohookKey.F13 }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('double-tap enters hands-free until the next press', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const m = new HotkeyManager(onStart, onStop);
    m.setKey('F13', 'hybrid');
    const down = (m as unknown as { handleDown: (e: unknown) => void }).handleDown;
    const up = (m as unknown as { handleUp: (e: unknown) => void }).handleUp;
    down(ev({ keycode: UiohookKey.F13 }));
    up(ev({ keycode: UiohookKey.F13 }));
    vi.advanceTimersByTime(50);
    down(ev({ keycode: UiohookKey.F13 }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ handsFree: true });
    up(ev({ keycode: UiohookKey.F13 }));
    expect(onStop).not.toHaveBeenCalled();
    down(ev({ keycode: UiohookKey.F13 }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('does not treat slow second taps as double-tap', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const m = new HotkeyManager(onStart, onStop);
    m.setKey('F13', 'hybrid');
    const down = (m as unknown as { handleDown: (e: unknown) => void }).handleDown;
    const up = (m as unknown as { handleUp: (e: unknown) => void }).handleUp;
    down(ev({ keycode: UiohookKey.F13 }));
    up(ev({ keycode: UiohookKey.F13 }));
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 50);
    down(ev({ keycode: UiohookKey.F13 }));
    vi.advanceTimersByTime(HOLD_DELAY_MS);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]?.length ?? 0).toBe(0);
  });
});

describe('HotkeyManager (toggle)', () => {
  it('flips on each key-down; key-up is a no-op', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const m = new HotkeyManager(onStart, onStop);
    m.setKey('F13', 'toggle');
    const down = (m as unknown as { handleDown: (e: unknown) => void }).handleDown;
    const up = (m as unknown as { handleUp: (e: unknown) => void }).handleUp;
    down(ev({ keycode: UiohookKey.F13 }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ handsFree: true });
    up(ev({ keycode: UiohookKey.F13 }));
    expect(onStop).not.toHaveBeenCalled();
    down(ev({ keycode: UiohookKey.F13 }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
