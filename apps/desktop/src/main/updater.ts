// Auto-update via electron-updater. Reads its feed from the publish config baked into
// the packaged app (GitHub Releases — see electron-builder.yml). Auto-downloads new
// versions and installs them on quit; the user can also restart immediately.
// No-op in dev (autoUpdater only works in a packaged build).
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '@wisopen/shared';

export interface UpdateStatus {
  state: UpdateState;
  version?: string;
  percent?: number;
  message?: string;
}

const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // every 3 hours

let interval: ReturnType<typeof setInterval> | null = null;

export function initUpdater(onStatus: (s: UpdateStatus) => void): void {
  if (!app.isPackaged) return; // dev: nothing to update

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => onStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => onStatus({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => onStatus({ state: 'none' }));
  autoUpdater.on('download-progress', (p) =>
    onStatus({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (i) => onStatus({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) =>
    onStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
  );

  void check();
  interval = setInterval(check, CHECK_INTERVAL_MS);
}

export function check(): void {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch((e) => console.warn('[updater] check failed', e));
}

/** Quit and apply the downloaded update immediately. */
export function quitAndInstall(): void {
  if (interval) clearInterval(interval);
  autoUpdater.quitAndInstall();
}
