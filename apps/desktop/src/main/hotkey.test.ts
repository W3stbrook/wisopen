import { describe, it, expect, vi } from 'vitest';
import { parseCombo, comboMatches, HotkeyManager } from './hotkey.js';
import { UiohookKey } from 'uiohook-napi';

const ev = (over: Partial<{ keycode: number; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
  keycode: 0,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
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
    down(ev({ keycode: UiohookKey.F13 })); // repeat down should not re-fire
    expect(onStart).toHaveBeenCalledTimes(1);
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
    up(ev({ keycode: UiohookKey.F13 }));
    expect(onStop).not.toHaveBeenCalled();
    down(ev({ keycode: UiohookKey.F13 }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
