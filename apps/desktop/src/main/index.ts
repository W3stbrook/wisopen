import { app, session as electronSession, Tray } from 'electron';
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
import { initUpdater } from './updater.js';

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

    const session = new Session({
      getJwt: () => api.getJwt(),
      callFormat: (req) => api.callFormat(req),
      getSettings: () => store.getSettings(),
      getSnippets: () => store.getCache().snippets,
      getDictionary: () => store.getCache().dictionary.filter((t) => t.enabled).map((t) => t.term),
      overlay: (state, extra) => windows.overlayState(state, extra),
      engineCommand: (cmd) => windows.engineCommand(cmd),
      inject: (text, mode) => injectText(text, mode),
      addHistory: (d) => void store.addHistory(d),
      supabaseUrl: cfg.supabaseUrl,
      sampleRate: cfg.sampleRate,
    });

    registerIpc({ api, store, session, windows });

    // global push-to-talk hotkey (needs macOS Input Monitoring; may throw if denied)
    const settings = store.getSettings();
    const hotkey = new HotkeyManager(
      () => void session.start(),
      () => session.stop(),
    );
    hotkey.setKey(settings.pttKey, settings.pttMode);
    if (process.env.WISOPEN_TEST_HOOKS !== '1') {
      try {
        hotkey.start();
      } catch (e) {
        console.warn('[hotkey] could not start global hook (permission?):', e);
      }
    }

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

    tray = createTray(windows, session);
    initUpdater(cfg.updateFeedUrl);

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

    // onboarding if not signed in
    const status = await api.status();
    if (!status.signedIn) windows.showOnboarding();
  });

  // tray app: keep running when all windows are closed
  app.on('window-all-closed', () => {
    /* stay alive in the tray */
  });
}
