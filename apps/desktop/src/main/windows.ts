import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { OverlayState } from '@wisopen/shared';

const preload = join(__dirname, '../preload/index.js');
const devUrl = process.env.ELECTRON_RENDERER_URL;

function load(win: BrowserWindow, name: string): void {
  if (devUrl) void win.loadURL(`${devUrl}/${name}/index.html`);
  else void win.loadFile(join(__dirname, `../renderer/${name}/index.html`));
}

/** Deny new-window and external navigation on a window (defense-in-depth, sandbox:false). */
function harden(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

export class Windows {
  engine: BrowserWindow | null = null;
  overlay: BrowserWindow | null = null;
  settings: BrowserWindow | null = null;
  onboarding: BrowserWindow | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  createEngine(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { preload, sandbox: false, contextIsolation: true },
    });
    harden(win);
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
    harden(win);
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

  overlayState(state: OverlayState, extra?: { partial?: string; message?: string }): void {
    if (!this.overlay) return;
    // any new transition cancels a pending auto-hide so it can't hide a fresh overlay
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (state === 'idle') {
      this.overlay.hide();
      return;
    }
    this.overlay.setSize(state === 'error' ? 340 : 280, state === 'error' ? 72 : 64);
    this.positionOverlay();
    if (!this.overlay.isVisible()) this.overlay.showInactive();
    this.overlay.webContents.send('overlay:state', { state, ...extra });
    // Auto-hide timing per design tokens (motion.overlay-*).
    const hideMs = state === 'done' ? 1200 : state === 'cancelled' ? 1600 : state === 'error' ? 4000 : null;
    if (hideMs !== null) {
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        this.overlay?.webContents.send('overlay:state', { state: 'idle' });
        this.overlay?.hide();
      }, hideMs);
    }
  }

  /** Mic-level meter update only — never touches overlay state or position (#10). */
  overlayLevel(level: number): void {
    if (this.overlay && this.overlay.isVisible()) {
      this.overlay.webContents.send('overlay:level', { level });
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

  showSettings(view?: string): void {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.show();
      this.settings.focus();
      if (view) this.settings.webContents.send('settings:navigate', { view });
      return;
    }
    const win = new BrowserWindow({
      width: 720,
      height: 700,
      minWidth: 640,
      minHeight: 560,
      title: 'Wisopen',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
      webPreferences: { preload, sandbox: false, contextIsolation: true },
    });
    harden(win);
    load(win, 'settings');
    this.settings = win;
    if (view) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('settings:navigate', { view });
      });
    }
  }

  showOnboarding(): void {
    if (this.onboarding && !this.onboarding.isDestroyed()) {
      this.onboarding.show();
      this.onboarding.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 480,
      height: 680,
      minWidth: 440,
      minHeight: 600,
      resizable: true,
      title: 'Welcome to Wisopen',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
      webPreferences: { preload, sandbox: false, contextIsolation: true },
    });
    harden(win);
    load(win, 'onboarding');
    this.onboarding = win;
  }
}
