import { app, session as electronSession, nativeImage, Tray } from 'electron';
import { join, resolve } from 'node:path';
import { expandSnippets, type Snippet } from '@wisopen/shared';
import { getConfig } from './config.js';
import { Store } from './store.js';
import { SecretStore } from './secrets.js';
import { ApiClient } from './auth.js';
import { Windows } from './windows.js';
import { Session } from './session.js';
import { HotkeyManager } from './hotkey.js';
import { injectText } from './injector.js';
import { registerIpc } from './ipc.js';
import { createTray } from './tray.js';
import { initUpdater, quitAndInstall, check as checkForUpdates } from './updater.js';

let tray: Tray | null = null;
let pendingDeepLink: string | null = null;
// Single open-url sink: buffers before ready, handles after (no double registration).
let deepLinkSink: (url: string) => void = (url) => {
  pendingDeepLink = url;
};

function extractCode(url: string): string | null {
  try {
    return new URL(url).searchParams.get('code');
  } catch {
    return null;
  }
}

async function handleDeepLink(api: ApiClient, windows: Windows, url: string): Promise<void> {
  const code = extractCode(url);
  if (!code) return;
  try {
    await api.exchangeCode(code);
    windows.send('auth:changed', await api.status());
  } catch (e) {
    console.error('[deeplink] exchange failed', e);
  }
}

// single instance — required for Windows/Linux deep-link delivery via second-instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.defaultApp) {
    // dev: relaunch electron with the app entry script so the real app handles the link
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('wisopen', process.execPath, [resolve(process.argv[1] ?? '')]);
    }
  } else {
    app.setAsDefaultProtocolClient('wisopen');
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    deepLinkSink(url);
  });

  app.whenReady().then(async () => {
    // allow microphone access in the engine renderer
    electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media');
    });

    const cfg = getConfig();
    const store = new Store(join(app.getPath('userData'), 'wisopen.json'));
    const secret = new SecretStore(store);
    const api = new ApiClient(secret);
    const windows = new Windows();
    windows.createEngine();
    windows.createOverlay();

    let session!: Session;
    const hotkey = new HotkeyManager(
      (opts) => void session.start(opts),
      () => session.stop(),
    );
    session = new Session({
      getJwt: () => api.getJwt(),
      callFormat: (req) => api.callFormat(req),
      getSettings: () => store.getSettings(),
      getSnippets: () => store.getCache().snippets,
      getDictionary: () =>
        store
          .getCache()
          .dictionary.filter((t) => t.enabled)
          .map((t) =>
            t.sounds_like && t.sounds_like.length
              ? `${t.term} (also heard as: ${t.sounds_like.join(', ')})`
              : t.term,
          ),
      overlay: (state, extra) => windows.overlayState(state, extra),
      engineCommand: (cmd) => windows.engineCommand(cmd),
      inject: (text, mode) => injectText(text, mode),
      addHistory: (d) => {
        store.addHistory(d);
        // also persist server-side (RLS) for cross-device history
        void api.insertDictation({
          raw_transcript: d.raw,
          final_text: d.final,
          mode_id: store.getSettings().defaultModeId,
          lang: d.lang,
          audio_seconds: d.audioSeconds,
        });
      },
      supabaseUrl: cfg.supabaseUrl,
      sampleRate: cfg.sampleRate,
      onIdle: () => hotkey.releaseActiveState(),
    });

    // populate the local cache (snippets/dictionary/modes) so the dictation loop has
    // data before the user opens Settings, and refresh it whenever auth changes.
    const refreshCache = async (): Promise<void> => {
      try {
        const [snippets, dictionary, modes] = await Promise.all([
          api.listSnippets(),
          api.listDictionary(),
          api.listModes(),
        ]);
        store.setCache({ snippets, dictionary, modes });
      } catch (e) {
        console.warn('[cache] refresh failed', e);
      }
    };
    api.onChange((s) => {
      windows.send('auth:changed', s);
      if (s.signedIn) void refreshCache();
    });

    // global push-to-talk hotkey (needs macOS Input Monitoring; may throw if denied)
    const settings = store.getSettings();
    hotkey.setKey(settings.pttKey, settings.pttMode);
    if (process.env.WISOPEN_TEST_HOOKS !== '1') {
      try {
        hotkey.start();
      } catch (e) {
        console.warn('[hotkey] could not start global hook (permission?):', e);
      }
    }

    registerIpc({
      api,
      store,
      session,
      windows,
      hotkey,
      update: { install: quitAndInstall, check: checkForUpdates },
    });

    // E2E test seam (no GUI/OS-permission side effects): exercise the app-level
    // format + snippet-expansion path against the live backend.
    if (process.env.WISOPEN_TEST_HOOKS === '1') {
      (globalThis as Record<string, unknown>).__wisopenTest = {
        authStatus: () => api.status(),
        formatLoop: async (args: { transcript: string; snippets: Snippet[] }) => {
          const resp = await api.callFormat({
            transcript: args.transcript,
            mode_id: store.getSettings().defaultModeId,
          });
          return expandSnippets(resp.final_text, args.snippets);
        },
      };
    }

    const trayCtl = createTray(windows, session, () => quitAndInstall());
    tray = trayCtl.tray;
    initUpdater((s) => {
      windows.send('update:status', s);
      if (s.state === 'ready' && s.version) trayCtl.setUpdateReady(s.version);
    });

    // route all future deep links straight to the handler; flush any captured before ready
    deepLinkSink = (url) => void handleDeepLink(api, windows, url);
    if (pendingDeepLink) {
      deepLinkSink(pendingDeepLink);
      pendingDeepLink = null;
    }
    app.on('second-instance', (_e, argv) => {
      const url = argv.find((a) => a.startsWith('wisopen://'));
      if (url) void handleDeepLink(api, windows, url);
      else windows.showSettings(); // relaunch with no link -> resurface the UI (Windows)
    });
    app.on('activate', () => windows.showSettings()); // macOS dock/relaunch recovery

    // onboarding if not signed in; otherwise warm the cache for the dictation loop
    const status = await api.status();
    if (status.signedIn) {
      void refreshCache();
      windows.showSettings();
    } else {
      windows.showOnboarding();
    }

    // Dev builds show in the Dock; production is menu-bar-only (LSUIElement). Set the
    // Wisopen icon so the dev Dock/app-switcher shows the brand mark, not Electron's.
    // (Packaged macOS uses build/icon.icns automatically.)
    if (!app.isPackaged && process.platform === 'darwin') {
      try {
        const dockIcon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'));
        if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
      } catch {
        /* icon is cosmetic in dev — ignore load failures */
      }
      app.dock?.show();
    }
  });

  // tray app: keep running when all windows are closed
  app.on('window-all-closed', () => {
    /* stay alive in the tray */
  });
}
