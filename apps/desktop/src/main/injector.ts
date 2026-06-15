// Inserts text into the focused app. Default = clipboard paste with save/restore
// (clipboard accessed in main; renderer clipboard is deprecated in Electron 40).
// Falls back to leaving text on the clipboard if the paste keystroke fails.
import { clipboard } from 'electron';
import { keyboard, Key } from '@nut-tree-fork/nut-js';

keyboard.config.autoDelayMs = 0;

export type InjectResult = 'pasted' | 'typed' | 'clipboard';

export async function injectText(
  text: string,
  mode: 'paste' | 'keystroke' = 'paste',
): Promise<InjectResult> {
  if (!text) return 'clipboard';

  if (mode === 'keystroke') {
    try {
      await keyboard.type(text);
      return 'typed';
    } catch {
      clipboard.writeText(text);
      return 'clipboard';
    }
  }

  const prev = clipboard.readText();
  clipboard.writeText(text);
  try {
    const mod = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl;
    await keyboard.pressKey(mod, Key.V);
    await keyboard.releaseKey(mod, Key.V);
    // restore the user's clipboard shortly after the paste lands
    setTimeout(() => {
      try {
        clipboard.writeText(prev);
      } catch {
        /* ignore */
      }
    }, 400);
    return 'pasted';
  } catch {
    // leave the dictated text on the clipboard so the user can paste manually
    return 'clipboard';
  }
}
