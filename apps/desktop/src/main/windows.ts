import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { OverlayState } from '@wisopen/shared';

const preload = join(__dirname, '../preload/index.js');
const devUrl = process.env.ELECTRON_RENDERER_URL;

function load(win: BrowserWindow, name: string): void {
  if (devUrl) void win.loadURL(`${devUrl}/${name}/index.html`);
  else void win.loadFile(join(__dirname, `../renderer/${name}/index.html`));
}

export class Windows {
  engine: BrowserWindow | null = null;
  overlay: BrowserWindow | null = null;
  settings: BrowserWindow | null = null;
  onboarding: BrowserWindow | null = null;

  createEngine(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { preload, sandbox: false, contextIsolation: true },
    });
    load(win, 'engine');
    this.engine = win;
    return win;
  }

  createOverlay(): BrowserWindow {
    const win = new BrowserWindow({
      width: 280,
      height: 64,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: { preload, sandbox: false, contextIsolation: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    load(win, 'overlay');
    this.overlay = win;
    return win;
  }

  private positionOverlay(): void {
    if (!this.overlay) return;
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y, width, height } = display.workArea;
    const size = this.overlay.getSize();
    const w = size[0] ?? 280;
    const h = size[1] ?? 64;
    this.overlay.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height - h - 80));
  }

  overlayState(state: OverlayState, extra?: { partial?: string; message?: string; level?: number }): void {
    if (!this.overlay) return;
    if (state === 'idle') {
      this.overlay.hide();
      return;
    }
    this.positionOverlay();
    if (!this.overlay.isVisible()) this.overlay.showInactive();
    this.overlay.webContents.send('overlay:state', { state, ...extra });
    if (state === 'done') {
      setTimeout(() => this.overlay?.hide(), 900);
    }
  }

  engineCommand(cmd: unknown): void {
    this.engine?.webContents.send('engine:command', cmd);
  }

  send(channel: string, payload: unknown): void {
    for (const w of [this.settings, this.onboarding, this.overlay]) {
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    }
  }

  showSettings(): void {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.show();
      this.settings.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 880,
      height: 640,
      title: 'Wisopen',
      webPreferences: { preload, sandbox: false, contextIsolation: true },
    });
    load(win, 'settings');
    this.settings = win;
  }

  showOnboarding(): void {
    if (this.onboarding && !this.onboarding.isDestroyed()) {
      this.onboarding.show();
      this.onboarding.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 560,
      height: 640,
      title: 'Welcome to Wisopen',
      webPreferences: { preload, sandbox: false, contextIsolation: true },
    });
    load(win, 'onboarding');
    this.onboarding = win;
  }
}
