// Auto-update via electron-updater. No-op unless a generic feed URL is configured.
import { autoUpdater } from 'electron-updater';

export function initUpdater(feedUrl?: string): void {
  if (!feedUrl) return;
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  autoUpdater.checkForUpdatesAndNotify().catch((e) => {
    console.warn('[updater]', e);
  });
}
