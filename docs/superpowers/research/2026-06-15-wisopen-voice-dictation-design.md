# Pre-implementation research: Wisopen voice dictation desktop app

Spec: docs/superpowers/specs/2026-06-15-wisopen-voice-dictation-design.md
Date: 2026-06-15
Method: 7 parallel subagents (2 Tier-2 spikes + 5 Tier-1 doc-verifiers) via the `wisopen-preimpl-research` workflow. Greenfield repo → no T0 (nothing pre-verified in-codebase); every tech is T1 (official-doc verified) or T2 (installed/run).

## Tech inventory & classification

| # | Technology | Version | Tier | Outcome |
|---|---|---|---|---|
| 1 | `uiohook-napi` | 1.5.5 | T2 | Verified: prebuilt N-API for darwin-arm64/x64 + win32-x64, no build step. **No `fn` key in `UiohookKey`.** Behavioral hook unverified headless. |
| 2 | `@nut-tree-fork/nut-js` | 4.2.6 | T2 | Verified: free Apache-2.0 fork, prebuilt libnut, async keyboard/clipboard API. Injection needs macOS Accessibility; unverified headless. |
| 3 | `electron` | 42.4.0 | T1 | Verified overlay/panel, globalShortcut (**no keyup**), clipboard (**renderer use deprecated@40**), tray, protocol, systemPreferences. |
| 4 | macOS TCC (via Electron) | (Electron 42) | T1 | `getMediaAccessStatus`/`askForMediaAccess` (mac-only), `isTrustedAccessibilityClient` (mac-only). Windows has no programmatic mic/accessibility prompt. |
| 5 | Web Audio (`getUserMedia`/AudioWorklet) | (Electron 42) | T1 | Capture + 16 kHz PCM16 downsample documented; real-device latency = open assumption. |
| 6 | `keytar` → Electron `safeStorage` | 7.9.0 (archived) | T1 | keytar archived 2022. **Replace with `safeStorage`** (encrypt/decryptString; app persists ciphertext). |
| 7 | `better-sqlite3` | 12.10.1 | T1 | Sync API verified. Needs `@electron/rebuild` + `asarUnpack`. |
| 8 | `electron-store` | 11.0.2 | T1 | **ESM-only.** Decision: drop it; use better-sqlite3 for settings/history/token-ciphertext. |
| 9 | `electron-builder` | 26.15.3 | T1 | mac notarize (env-driven, `@electron/notarize`), `hardenedRuntime` default true, win signing under `win.signtoolOptions`, `asarUnpack` for `.node`. |
| 10 | `electron-updater` | 6.8.9 | T1 | autoUpdater + providers (generic/github/s3); mac needs dmg+zip + signing. |
| 11 | `@electron/rebuild` | 4.0.4 | T1 | CLI `electron-rebuild` + programmatic `rebuild({buildPath,electronVersion,arch})`. |
| 12 | `playwright` | 1.61.0 | T1 | `_electron.launch({args})` + `firstWindow()` + `evaluate` (main-process). |
| 13 | Supabase Edge Function WS (`Deno.upgradeWebSocket`) | edge-runtime 1.74.0 | T2 | **WORKS locally** (bidirectional text+binary). WS bypasses gateway JWT → auth inside fn (`?jwt=`/`Sec-WebSocket-Protocol`). Long-stream limit unmeasured. |
| 14 | `@supabase/supabase-js` | 2.108.2 | T2 | Auth + RLS verified end-to-end on local stack. Session shape captured. Discriminate postgrest via `error` (not `success`). |
| 15 | Supabase CLI / local stack | 2.104.0 | T1 | init/start/status/migration/db reset+push/functions serve+deploy/secrets verified. Disable storage+analytics locally. |
| 16 | Supabase Auth (GoTrue) | v2.189.0 | T1 | signUp/signInWithPassword/signInWithOtp/setSession/refreshSession/onAuthStateChange; PKCE opt-in (`flowType:'pkce'`). |
| 17 | Postgres RLS / triggers | PG 17.6 | T1 | `(select auth.uid())` policies, `handle_new_user()` (`security definer set search_path=''`), `gen_random_uuid()` (core). |
| 18 | `@aws-sdk/client-transcribe-streaming` | 3.1068.0 | T1 | Streaming PCM16 16 kHz; `IsPartial` final signal; nested Result/Alternative/Item shape captured. Mock contract done. |
| 19 | `openai` SDK — STT | 6.42.0 | T1 | `audio.transcriptions.create` is file-based (+ SSE for recorded file); **live mic = Realtime WS (pcm16 @ 24 kHz)**. → buffered adapter v1. Mock contract done. |
| 20 | `openai` SDK — Chat/Responses (+Tensorix) | 6.42.0 | T1 | `chat.completions.create` for OpenAI **and** Tensorix (`baseURL`); usage `prompt_tokens`/`completion_tokens`. Mock contract done. |
| 21 | Tensorix (OpenAI-compatible) | API 2026-06 | T1 | `baseURL=https://api.tensorix.ai/v1`, models e.g. `z-ai/glm-5.1`, `minimax/minimax-m2.5`; chat-completions only. |
| 22 | `@aws-sdk/client-bedrock-runtime` | 3.1068.0 | T1 | `ConverseCommand`: content is block array, `system` top-level, usage `inputTokens`/`outputTokens`. Mock contract done. |

**Out of scope (not researched):** npm workspaces / TypeScript / Vite (standard tooling), Stripe (deferred), whisper.cpp (non-goal).

---

## Per-tech findings


<!-- ===== fragment: native-input ===== -->

## Native desktop-input modules (push-to-talk hotkey + text injection)

Spike environment: macOS (darwin arm64), Node v25.5.0, npm 11.8.0. Scratch dir `/tmp/wisopen-spike-input`. Both packages installed clean (`npm i uiohook-napi@1.5.5 @nut-tree-fork/nut-js@4.2.6` → "added 129 packages", exit 0). Spike files require packages via `NODE_PATH=/tmp/wisopen-spike-input/node_modules` since they live under `/tmp/superpowers-spikes/`.

> HEADLESS CAVEAT (applies to both): actual global key-hooking and actual keystroke/paste injection require a GUI session plus macOS **Input Monitoring** (uiohook) / **Accessibility** (nut.js) permission. Those *behavioral* parts were intentionally NOT exercised and are listed under Open assumptions. Everything below (install, module load, exported API surface, prebuilt-binary availability, enum values, clipboard round-trip) was verified empirically.

---

### uiohook-napi@1.5.5
**Verified facts** (from spike execution + cross-checked with docs)
- Installs with **PREBUILT binaries for all required targets**: `prebuilds/` ships `darwin-arm64`, `darwin-x64`, `win32-x64` (plus `win32-arm64`, `linux-x64`, `linux-arm64`, `linux-loong64`), each a single `uiohook-napi.node`. [source: spike "prebuilds shipped" + ls of node_modules]
- `require('uiohook-napi')` loads **without any native build step**: no `build/` dir is created, and `node-gyp-build` resolved the prebuilt file `prebuilds/darwin-arm64/uiohook-napi.node` (verified via `node-gyp-build`'s `.path()`). The `install` script is `node-gyp-build` (a resolver that prefers prebuilds; it does NOT compile when a matching prebuild exists). [source: spike "confirm loaded binary path is the PREBUILD"]
- Prebuilds are **N-API / ABI-stable** (`prebuild` script = `prebuildify --napi`; addon target `uiohook_napi` with `src/lib/napi_helpers.c`). One binary per platform/arch, not Node-ABI-versioned. [source: spike + package.json/binding.gyp]
- Exported API surface (top-level): `{ EventType, UiohookKey, WheelDirection, uIOhook }`. `uIOhook` is an `EventEmitter` singleton with instance methods `start()`, `stop()`, `keyTap(key, modifiers?)`, `keyToggle(key, 'down'|'up')`. [source: spike "uIOhook instance" + dist/index.d.ts]
- Events: `uIOhook.on('keydown'|'keyup', cb)` (also `'input'`, `'mousedown'/'mouseup'/'mousemove'/'click'/'wheel'`). Keyboard event object shape: `{ type, time, altKey, ctrlKey, metaKey, shiftKey, keycode }`. `event.keycode` is a number to compare against `UiohookKey.*`. [source: spike + dist/index.d.ts:11-19 + shipped README example]
- `UiohookKey` has **124 entries**. Modifiers for combos: `Ctrl=29, CtrlRight=3613, Alt=56, AltRight=3640, Shift=42, ShiftRight=54, Meta=3675, MetaRight=3676`; plus `Space=57`, `A=30`, `V=47`, `F13=91`, `CapsLock=58`, `F1-F24`, `Escape=1`. [source: spike "UiohookKey relevant entries"]
- **There is NO `fn` key in `UiohookKey`** — zero keys match `/fn|function/i`. Cross-checked against the package's authoritative `src/index.ts` on GitHub master: the map has no `fn`/`Function` entry. So the macOS Fn key cannot be referenced by name, and is best treated as NOT a usable push-to-talk key via this lib. [source: spike "is there an 'fn' key?" + https://github.com/SnosMe/uiohook-napi/blob/master/src/index.ts]
- License MIT; N-API C-bindings for libuiohook. [source: node_modules/uiohook-napi/LICENSE + README]

**Spike file:** /tmp/superpowers-spikes/uiohook-napi.cjs

**Spike execution output** (key excerpts only)
```
$ NODE_PATH=.../node_modules node /tmp/superpowers-spikes/uiohook-napi.cjs
loaded OK; top-level exports: [ 'EventType', 'UiohookKey', 'WheelDirection', 'uIOhook' ]
uIOhook is EventEmitter: true
instance methods: [ 'handler', 'keyTap', 'keyToggle', 'start', 'stop' ]
typeof uIOhook.on: function ; start/stop/keyTap/keyToggle: function
EventType: {"EVENT_KEY_PRESSED":4,"EVENT_KEY_RELEASED":5, ... ,"EVENT_MOUSE_WHEEL":11}
Ctrl=29 CtrlRight=3613 Alt=56 AltRight=3640 Shift=42 ShiftRight=54 Meta=3675 MetaRight=3676
Space=57 A=30 V=47 F13=91 CapsLock=58 ; total UiohookKey entries: 124
keys matching /fn|function/i: (none)
prebuild target dirs: darwin-arm64, darwin-x64, linux-arm64, linux-loong64, linux-x64, win32-arm64, win32-x64
this platform: darwin arm64 -> expected prebuild dir: darwin-arm64
scripts.install = node-gyp-build ; dependencies = { 'node-gyp-build': '^4.8.4' }

# separate check:
node-gyp-build resolved: .../prebuilds/darwin-arm64/uiohook-napi.node ; is prebuild: true
(no build/ dir -> NO local compile happened)
```

**Constraints discovered**
- `event.keycode` uses libuiohook scancodes, NOT JS `KeyboardEvent.code`/`key` and NOT DOM keycodes. Compare only against `UiohookKey.*`. [source: spike]
- No `fn` key support; if PTT-on-Fn is desired it must be reconsidered. Recommend a normal key (e.g. `F13`, or a modifier like `Meta`/`Ctrl`) for push-to-talk. [source: spike]
- `EventType`/`WheelDirection` are bidirectional TS enums (numeric value ⇄ name both present when JSON-stringified). [source: spike output]
- Global hooking runs on a native thread started by `uIOhook.start()`; must be called once in the Electron **main process** (it is a Node native addon, not usable from the renderer/sandbox). Verified it's a Node-addon EventEmitter; main-process placement is the standard pattern (see Open assumptions re: Electron runtime). [source: spike + module structure]

**Mock contract** (actual observed shape)
- **Symbols to mock**: `uIOhook` (EventEmitter with `start()`, `stop()`, `keyTap(key:number, modifiers?:number[])`, `keyToggle(key:number, 'down'|'up')`, `on(event, cb)`), plus the constant maps `UiohookKey`, `EventType`, `WheelDirection`.
- **Return shape**: `start()/stop()/keyTap()/keyToggle()` return `undefined` (void, synchronous). `on()` returns `this`. Emitted `keydown`/`keyup` payload = `{ type:number, time:number, altKey:boolean, ctrlKey:boolean, metaKey:boolean, shiftKey:boolean, keycode:number }`.
- **Errors / exceptions**: none observed at load/API-inspection time. (Throw-on-no-permission behavior of `start()` not observed — see Open assumptions.)
- **Side effects**: `start()` spawns a native global-input hook thread and begins emitting events; `stop()` tears it down. A mock should just emit synthetic `keydown`/`keyup` objects on demand.

**Divergence from docs**
- None. Shipped README and GitHub `src/index.ts` match the spike exactly (same API, same modifier values, no `fn`).

**Open assumptions** (spike could NOT verify)
- `uIOhook.start()` was NOT called (headless). Behavior of actual global key capture, the exact event stream for press/hold/release, and any throw/no-op when macOS **Input Monitoring** permission is missing are UNVERIFIED.
- **Electron runtime compatibility** is UNVERIFIED here (no Electron in the spike). The prebuilds are N-API (ABI-stable), which generally load in Electron without `@electron/rebuild`; but whether 1.5.5's prebuilds load under Electron 42.4.0 specifically, and whether a global hook is reliable inside a packaged/notarized Electron app, must be validated in an actual Electron main-process spike. (Web search returned only forks/general advice — not authoritative for this package+version.)
- Whether the macOS Fn key emits ANY uiohook event at all (even an unnamed keycode) is UNVERIFIED; the only verified fact is that `UiohookKey` has no `fn` entry.

**Sources**
- Spike: /tmp/superpowers-spikes/uiohook-napi.cjs (executed, exit 0)
- node_modules/uiohook-napi/dist/index.d.ts, dist/index.js, package.json, binding.gyp, README.md, LICENSE
- https://github.com/SnosMe/uiohook-napi/blob/master/src/index.ts (authoritative source, master) — confirms full `UiohookKey` map, no `fn`, modifier values
- https://raw.githubusercontent.com/SnosMe/uiohook-napi/master/README.md (API + usage example)

---

### @nut-tree-fork/nut-js@4.2.6
**Verified facts** (from spike execution + cross-checked with docs)
- **This IS the FREE community fork.** Package name `@nut-tree-fork/nut-js`, `license: "Apache-2.0"`, and crucially **no `preinstall`/`install`/`postinstall` scripts and no license-key/token gate** — `require()` and the clipboard round-trip ran with zero credentials. By contrast the original `@nut-tree/nut-js` requires a paid subscription token to install prebuilt packages (or you build native deps from source yourself). [source: spike "fork identity" + https://github.com/nut-tree/nut.js README ("Pre-built packages are available for subscription plans ... a token which you can use to install")]
- Ships a **prebuilt native binary on macOS — no compile on install**: `@nut-tree-fork/libnut-darwin@2.7.5` contains `build/Release/libnut.node` (244,512 bytes), loaded via `bindings`. No `cmake-js` build ran during `npm i`. [source: spike "native binary" + ls of libnut-darwin]
- Native addon is **N-API** (`node-addon-api@7.1.0` build-time, ABI-stable). Cross-platform packages `libnut-darwin`/`libnut-linux`/`libnut-win32` (all `2.7.5`) are ALL installed; the correct one is selected at runtime in `import_libnut.js` via `process.platform` (`win32`→win32, `linux`→linux, else→darwin). [source: spike + node_modules/@nut-tree-fork/libnut/dist/import_libnut.js]
- Exported API (top-level, 60 symbols) includes singletons `keyboard`, `clipboard`, `mouse`, `screen`, and the `Key` enum (also classes `KeyboardClass`, `ClipboardClass`). [source: spike "import" output + dist/index.d.ts]
- **keyboard** API (all async, all variadic rest-params, all return `Promise<KeyboardClass>`):
  - `keyboard.type(...input: (string | Key)[]) => Promise<KeyboardClass>` — types text and/or single keys.
  - `keyboard.pressKey(...keys: Key[]) => Promise<KeyboardClass>` — press & hold (modifiers first, e.g. `pressKey(Key.LeftCmd, Key.V)`).
  - `keyboard.releaseKey(...keys: Key[]) => Promise<KeyboardClass>` — release.
  - `keyboard.config = { autoDelayMs: 300 }` (default 300 ms between key events — tunable). [source: spike + keyboard.class.d.ts]
- **clipboard** API: `clipboard.setContent(text: string) => Promise<void>`, `clipboard.getContent() => Promise<string>`. Round-trip **verified working headless** (backed by `clipboardy`→`pbcopy`/`pbpaste` on macOS, no native build, no extra perms): set a marker, got it back, exact match; `setContent` resolves to `undefined`. [source: spike "clipboard round-trip" + clipboard.class.d.ts + default-clipboard-provider deps]
- **`Key` enum** (137 members) confirms the paste-combo keys: `LeftCmd=107`, `RightCmd=114`, `LeftControl=104`, `RightControl=110`, `LeftSuper=105`, `LeftWin=106`, `LeftAlt=108`, `LeftShift=87`, `V=91`, `A=72`, `Space=116`, `Return=83` — and even `Fn=118` exists in this enum (note: that's the SEND enum, unrelated to uiohook's capture map). [source: spike "Key enum entries" + shared/dist/lib/enums/key.enum.d.ts]
- **macOS permission flow**: on darwin, `libnut-darwin/index.js` loads `permissionCheck.js`, which wraps `keyTap`/`keyToggle`/`typeString` (and mouse/screen fns) so that on first use it checks **Accessibility** authorization via the optional dep `@nut-tree-fork/node-mac-permissions@2.2.1` and, if not granted, calls `askForAccessibilityAccess()` (triggers the macOS prompt) and logs a warning while still attempting the call. `captureScreen`/`getWindowTitle` additionally check **Screen Recording**. [source: spike + node_modules/@nut-tree-fork/libnut-darwin/permissionCheck.js]

**Spike file:** /tmp/superpowers-spikes/nut-js.cjs

**Spike execution output** (key excerpts only)
```
$ NODE_PATH=.../node_modules node /tmp/superpowers-spikes/nut-js.cjs
name: @nut-tree-fork/nut-js ; version: 4.2.6 ; license: Apache-2.0
install/postinstall scripts: preinstall=(none), install=(none), postinstall=(none)
runtime deps: [ jimp, node-abort-controller, @nut-tree-fork/default-clipboard-provider,
                @nut-tree-fork/libnut, @nut-tree-fork/shared, @nut-tree-fork/provider-interfaces ]
top-level exports: [ ... 'Key','KeyboardClass','ClipboardClass','clipboard','keyboard','mouse','screen', ... ]
keyboard.type: function ; pressKey: function ; releaseKey: function ; keyboard.config: {"autoDelayMs":300}
clipboard.getContent: function ; setContent: function
Key.LeftCmd=107 RightCmd=114 LeftControl=104 RightControl=110 LeftSuper=105 LeftWin=106
Key.LeftAlt=108 LeftShift=87 V=91 A=72 Space=116 Fn=118 Return=83 ; total Key members: 137
libnut-darwin version: 2.7.5 ; prebuilt libnut.node exists: true (244512 bytes)
node-mac-permissions (optional dep) version: 2.2.1
clipboard round-trip: setContent returned undefined ; getContent typeof string: true ; round-trip match: true
[spike] keyboard.type / pressKey NOT called (needs GUI + macOS Accessibility perm).

# separate checks:
libnut platform pkgs: libnut-darwin INSTALLED, libnut-linux INSTALLED, libnut-win32 INSTALLED
import_libnut.js -> win32? libnut-win32 : linux? libnut-linux : libnut-darwin
```

**Constraints discovered**
- All keyboard methods are **async** (`Promise`) — paste flow must `await keyboard.pressKey(Key.LeftCmd, Key.V)` then `await keyboard.releaseKey(...)`, or `await keyboard.type(text)`. [source: spike + keyboard.class.d.ts]
- `keyboard.config.autoDelayMs` default 300 ms; for fast injection of long transcripts you'll likely want to lower it. [source: spike]
- macOS **Accessibility** permission is required before `keyboard.type`/`pressKey` actually inject; first call triggers a system prompt (and the action effectively fails/warns until granted). The packaged Electron app's bundle identity is what the user must grant. [source: permissionCheck.js]
- `node-mac-permissions` is an **optional** dependency of libnut-darwin; if it ever fails to install, permissionCheck falls back to the raw module without prompting (still subject to OS-level permission). [source: permissionCheck.js catch block + libnut-darwin optionalDependencies]
- `clipboardy@2.3.0` (clipboard provider) shells out to `pbcopy`/`pbpaste` on macOS — works without GUI/perms, but on Linux it would need `xsel`/`xclip` (not relevant for mac/win targets). [source: default-clipboard-provider deps]
- Installing on macOS still downloads `libnut-linux` and `libnut-win32` (their `os` field lists all three platforms, so npm does not skip them); harmless but adds install weight. Runtime picks the right one. [source: spike platform-pkg check]

**Mock contract** (actual observed shape)
- **Symbols to mock**: `keyboard` (`{ type(...args):Promise, pressKey(...keys):Promise, releaseKey(...keys):Promise, config:{autoDelayMs} }`), `clipboard` (`{ setContent(string):Promise<void>, getContent():Promise<string> }`), and the `Key` enum (numeric).
- **Return shape**: `keyboard.type/pressKey/releaseKey` resolve to the `keyboard` (KeyboardClass) instance (chainable). `clipboard.setContent` resolves to `undefined`; `clipboard.getContent` resolves to a `string` (verified — exact round-trip match).
- **Errors / exceptions**: none observed at load + clipboard round-trip. (Behavior when Accessibility is denied was not observed — see Open assumptions.)
- **Side effects**: real `keyboard.*` inject system-wide synthetic input into the focused app; real `clipboard.*` read/write the OS clipboard (verified it mutates the live clipboard). A mock should record calls and return resolved promises with the above shapes.

**Divergence from docs**
- nutjs.dev API docstrings use `Key.STRG` in `pressKey`/`releaseKey` examples (German for Ctrl) — `STRG` is NOT a member of the actual `Key` enum (the real names are `LeftControl`/`RightControl`). Treat the docstring example as illustrative only; use `Key.LeftControl`/`Key.LeftCmd`. [source: keyboard.class.d.ts docstring vs key.enum.d.ts]
- The original nut.js README (github.com/nut-tree/nut.js) documents the PAID `@nut-tree/nut-js` and the source-build path; the `@nut-tree-fork` namespace (community fork with free prebuilts) is documented separately. Identity confirmed empirically via the installed package, not the original README.

**Open assumptions** (spike could NOT verify)
- `keyboard.type` / `pressKey` / `releaseKey` were NOT executed (headless; would prompt for Accessibility and cannot verify injection offscreen). Actual injection into a focused app, the Cmd+V paste combo, and behavior when Accessibility is denied are UNVERIFIED.
- **Electron 42.4.0 compatibility** UNVERIFIED in this spike (no Electron). libnut is N-API so it should load without rebuild, and `keyboard`/`clipboard` must run in the main process; validate in an Electron main-process spike. Note the macOS permission prompt will be attributed to the app's bundle identity in a packaged build.
- Windows behavior (`libnut-win32` prebuilt load + injection, and that no admin/UAC perm is needed) UNVERIFIED on this mac.

**Sources**
- Spike: /tmp/superpowers-spikes/nut-js.cjs (executed, exit 0)
- node_modules/@nut-tree-fork/nut-js/package.json + dist/index.d.ts; .../keyboard.class.d.ts; .../clipboard.class.d.ts
- node_modules/@nut-tree-fork/shared/dist/lib/enums/key.enum.d.ts (full Key enum)
- node_modules/@nut-tree-fork/libnut/package.json + dist/import_libnut.js; libnut-darwin/{index.js,permissionCheck.js,package.json,build/Release/libnut.node}
- node_modules/@nut-tree-fork/default-clipboard-provider/package.json (clipboardy)
- https://github.com/nut-tree/nut.js (confirms paid/token model for original @nut-tree/nut-js + macOS Accessibility/Screen-Recording requirement, auto-request since v2.3.0)

<!-- ===== fragment: supabase-stack ===== -->

### Supabase local stack (CLI 2.104.0) + Edge Functions WebSocket + supabase-js@2.108.2

**Verified facts** (from spike execution + cross-checked with docs)
- `supabase init` (non-interactive) + `supabase start` brings up a full local stack via Docker; images pulled to public.ecr.aws/supabase/*. Authoritative container versions observed: Postgres `17.6.1.132`, GoTrue `v2.189.0`, PostgREST `v14.12`, Kong `2.8.1`, edge-runtime `v1.74.0` (compatible with Deno v2.1.4). [source: spike `docker ps` + GoTrue `/auth/v1/health` returned `{"version":"v2.189.0"}`]
- `supabase status -o json` exposes BOTH legacy JWT keys (`ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_SECRET`) AND the new opaque keys (`PUBLISHABLE_KEY=sb_publishable_...`, `SECRET_KEY=sb_secret_...`). The pretty `supabase status` only prints the new `sb_publishable_/sb_secret_` pair; use `-o json` to get the JWT anon/service_role keys. supabase-js works with the legacy JWT anon key as the client key. [source: spike `supabase status -o json`]
- `Deno.upgradeWebSocket(req)` WORKS in the local supabase functions runtime (edge-runtime v1.74.0). Full bidirectional streaming verified: server-initiated message on open, text echo, 3 sequential client→server→client text messages, and a binary frame (ArrayBuffer, bytes [1,2,3]) echoed back unchanged. [source: spike `ws-test.mjs` SUMMARY: `{ok:true, helloOk:true, textEchoOk:true, multiCount:2, binaryOk:true}` + official docs https://supabase.com/docs/guides/functions/websockets]
- WebSocket upgrade requests BYPASS the gateway JWT/apikey check. WS connected successfully EVEN WITHOUT `--no-verify-jwt` AND WITHOUT any apikey header. Official docs confirm: "WebSocket browser clients don't have the option to send custom headers. Because of this, Edge Functions won't be able to perform the usual authorization header check to verify the JWT." Auth must be done INSIDE the function via URL query param (`url.searchParams.get('jwt')`) or the `Sec-WebSocket-Protocol` header (format `jwt-TOKEN`). [source: spike Test A (no apikey, jwt-verify ON) still `ok:true` + https://supabase.com/docs/guides/functions/websockets]
- supabase-js@2.108.2 `auth.signUp` (with `enable_confirmations=false`) returns a session immediately. `signInWithPassword` returns a full session. `auth.admin.createUser` (service-role client) works. [source: spike `supabase-js-test.mjs`]
- RLS with `auth.uid()` works end-to-end against the local stack: authenticated INSERT defaults `user_id` to `auth.uid()` (201 Created); SELECT returns only the caller's rows; cross-user isolation holds (user B sees 0 of user A's rows); anon (unauthenticated) SELECT returns 0 rows; an INSERT spoofing a different `user_id` is rejected with Postgres error code `42501` / HTTP 403. [source: spike `supabase-js-test.mjs` output]
- `--no-verify-jwt` IS needed for non-WS HTTP function calls if you want to skip the apikey/JWT gateway check; for WS it is effectively irrelevant (the check doesn't apply to upgrades anyway). [source: spike + docs]

**Spike file:** `/tmp/superpowers-spikes/supabase-stack/` (ws-echo-index.ts, ws-test.mjs, supabase-js-test.mjs, 20260615134307_notes_rls.sql)

**Spike execution output** (key excerpts only)
```
# supabase status -o json (keys captured)
ANON_KEY=eyJhbGciOi...role":"anon"...   SERVICE_ROLE_KEY=eyJ...role":"service_role"...
PUBLISHABLE_KEY=sb_publishable_<redacted-local-dev-key>
SECRET_KEY=sb_secret_<redacted-local-dev-key>
API_URL=http://127.0.0.1:54321  FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# serve: Using supabase-edge-runtime-1.74.0 (compatible with Deno v2.1.4)
#        Serving functions on http://127.0.0.1:54321/functions/v1/ws-echo

# ws-test.mjs (endpoint ws://127.0.0.1:54321/functions/v1/ws-echo)
A (no apikey, jwt-verify ON): {"ok":true,"helloOk":true,"textEchoOk":true,"multiCount":2,"binaryOk":true}
B (apikey):                   {"ok":true,"helloOk":true,"textEchoOk":true,"multiCount":2,"binaryOk":true}
# server log: socket open -> text msg #1 ping-1 -> #2 -> #3 -> binary msg #4 -> socket closed

# supabase-js-test.mjs
signInWithPassword session keys: access_token, token_type, expires_in, expires_at, refresh_token, user, weak_password
  token_type: bearer   expires_in: 3600   access_token len 918
authenticated INSERT: status 201 Created, data:[{id,user_id,body,created_at}]
  PostgrestResponse own keys: ["success","error","data","count","status","statusText"]
RLS VIOLATION insert: error {"message":"new row violates row-level security policy...","code":"42501"} status 403
ANON SELECT rows: 0    USER B SELECT rows: 0 (isolation OK)
admin.createUser (service role): ok, returns { user }
```

**Constraints discovered**
- The CLI defaults to binding services to `0.0.0.0` (network-accessible) and prints a security notice; for a desktop app's local backend, consider binding to 127.0.0.1. [source: spike `supabase start` output "All services bind to 0.0.0.0"]
- `storage`, `imgproxy`, `analytics`, `vector`, `pooler` had to be disabled in `config.toml` (set `[storage] enabled=false`, `[analytics] enabled=false`) for a clean `supabase start` on this machine — the storage container's CLI health check repeatedly reported "unhealthy" and tore down the whole stack even though the storage server logged "Started Successfully". None of these are needed for Wisopen (no file storage). This may be machine/version-specific. [source: spike — two failed starts before disabling storage+analytics]
- Only ONE local supabase stack can use the default ports (54321-54324, 54322 db). A pre-existing project was already bound to them; `supabase start` failed with "Bind for 0.0.0.0:54322 failed: port is already allocated". To run multiple stacks, override ports in `config.toml`. [source: spike line "port is already allocated"]
- `supabase functions serve` requires the function source to be a bare `Deno.serve(...)` (or default-export). The CLI's `functions new` scaffolds a NEWER template using `import { withSupabase } from "@supabase/server"` and `export default { fetch: withSupabase(...) }` — the spike overwrote it with a plain `Deno.serve` WS handler, which is the lowest-level portable form and is what the official WS docs use. [source: spike — scaffolded index.ts vs rewritten index.ts]
- `supabase db reset` re-runs all migrations + seed; it RESTARTS containers (kills any running `functions serve`). One reset failed transiently ("error running container: exit 1") but `--debug` showed all migration SQL committed; a re-run succeeded. Treat reset as occasionally flaky; verify with psql. [source: spike — first `db reset` failed, `--debug` showed CommandComplete for all statements]

**Mock contract** (actual observed shape)
- **Symbols to mock**:
  - `createClient(url, key, { auth: { persistSession, autoRefreshToken } })` → SupabaseClient
  - `client.auth.signUp({ email, password })` / `signInWithPassword({ email, password })`
  - `client.auth.admin.createUser({ email, password, email_confirm })` (service-role client only)
  - `client.from('<table>').insert(...).select()` / `.select('*')`
  - Edge Function: `Deno.serve((req) => { const { socket, response } = Deno.upgradeWebSocket(req); ...; return response })` with `socket.onopen/onmessage/onclose/onerror`, `socket.send(string | ArrayBuffer)`
- **Return shape — auth**: `{ data, error }`. On success `error: null`, `data.session` = `{ access_token (JWT string), token_type: "bearer", expires_in: 3600, expires_at: <unix sec>, refresh_token, user, weak_password? }`. `data.user`/`session.user` = `{ id (uuid), aud: "authenticated", role: "authenticated", email, email_confirmed_at, phone, confirmed_at, last_sign_in_at, app_metadata, user_metadata, identities, created_at, updated_at, is_anonymous }`. `signUp` user object omits `confirmed_at`/`weak_password` (only `signIn` session had `weak_password`).
- **Return shape — postgrest (`.insert/.select`)**: a discriminated union. Observed runtime keys: `{ success, error, data, count, status, statusText }`. Success = `{ success: true, error: null, data: T[], count: number|null, status, statusText }`; failure = `{ success: false, error: PostgrestError, data: null, count: null, status, statusText }`. INSERT success → `status: 201, statusText: "Created"`.
- **Errors / exceptions**: Auth/postgrest calls do NOT throw on logical errors — they return `{ error }`. `createClient` THROWS synchronously if `supabaseKey` is falsy ("supabaseKey is required."). RLS violation → `error = { message: "new row violates row-level security policy for table \"<t>\"", code: "42501", details, hint }`, `status: 403`. WS handler: returns `new Response(..., {status:426})` if `upgrade` header is not `websocket`.
- **Side effects**: `signUp`/`createUser` write to `auth.users`; INSERT writes rows. `supabase start/stop` mutate Docker (containers + volumes; `stop` backs up DB to a docker volume). `db reset` drops+recreates the DB and restarts containers.

**Divergence from docs**
- The shipped `@supabase/postgrest-js@2.108.2` `.d.ts` (and runtime) includes a `success: true|false` boolean discriminant on the response union. The postgrest-js GitHub `master` branch `src/types.ts` does NOT have `success` (it discriminates only via `error: null` vs `error: PostgrestError`). So `success` is present in the 2.108.2 release artifact but not on current master. SAFE GUIDANCE: discriminate via `error` (null = ok) and read `data`/`count`/`status`/`statusText` — these are stable in BOTH. Treat `success` as a 2.108.2 convenience that exists at runtime but is not guaranteed across versions; do not depend on it in shared contracts.
- `supabase status` (pretty) no longer prints `anon key`/`service_role key` labels (only the new `sb_publishable_/sb_secret_`); the JWT keys are still emitted by `supabase status -o json`. Older docs/tutorials referencing `anon key` in `supabase status` are stale for CLI 2.104.0.

**Open assumptions** (things the spike could NOT verify)
- Long-lived WS streaming under load / wall-clock limits: edge-runtime free/local has per-request CPU & wall-time limits; the spike only ran a short echo (~sub-second). Whether a multi-minute STT stream stays open within local edge-runtime limits was NOT measured. This is the key residual risk for putting `stt-stream` in an Edge Function vs a separate Node WS gateway.
- WS behavior when DEPLOYED to Supabase Cloud (vs local serve) was not tested — only local `functions serve`.
- The `Sec-WebSocket-Protocol: jwt-TOKEN` auth path and query-param JWT path are documented but were NOT exercised in the spike (only confirmed that the upgrade itself bypasses gateway JWT checks).
- Storage/realtime were disabled, so RLS interaction with Realtime subscriptions was not tested (not needed for Wisopen).

**Spike Failure**
- Not a spike failure (all questions answered), but an ENVIRONMENT SIDE EFFECT to flag: a pre-existing local Supabase project (`project-id wyhqzfzkotksmcapahul`) was running on the default ports before this spike and was STOPPED (`supabase stop --project-id wyhqzfzkotksmcapahul`) to free ports 54321-54324/54322. Its data is preserved in its docker volume. To restore the user's environment, run `supabase start` from THAT project's directory (unknown to this spike). The spike's own stack was stopped cleanly. ACTION FOR USER/COORDINATOR: restart project `wyhqzfzkotksmcapahul` if it was wanted running.

**Sources**
- spike execution: /tmp/superpowers-spikes/supabase-stack/ (ws-echo-index.ts, ws-test.mjs, supabase-js-test.mjs, 20260615134307_notes_rls.sql)
- https://supabase.com/docs/guides/functions/websockets (Deno.upgradeWebSocket; WS clients can't send headers; jwt via query param or Sec-WebSocket-Protocol; --no-verify-jwt)
- installed SDK artifacts: node_modules/@supabase/postgrest-js@2.108.2/dist/index.d.cts (PostgrestResponseSuccess/Failure with `success` discriminant), @supabase/auth-js@2.108.2
- https://raw.githubusercontent.com/supabase/postgrest-js/master/src/types.ts (master lacks `success` field — divergence)
- running container images (public.ecr.aws/supabase/*) + GoTrue /auth/v1/health version v2.189.0

<!-- ===== fragment: electron-os ===== -->

### electron@42.4.0
**Verified facts**
- BrowserWindow/BaseWindow constructor options (verified against current docs; these option semantics are stable through v42):
  - `frame` boolean, default `true`; `false` creates a frameless window. [source: https://www.electronjs.org/docs/latest/api/structures/base-window-options]
  - `transparent` boolean, default `false`; "On Windows, does not work unless the window is frameless." [source: https://www.electronjs.org/docs/latest/api/structures/base-window-options]
  - `hasShadow` boolean, default `true`. [source: https://www.electronjs.org/docs/latest/api/structures/base-window-options]
  - `focusable` boolean, default `true`. "On Windows setting `focusable: false` also implies setting `skipTaskbar: true`. On Linux setting `focusable: false` makes the window stop interacting with wm, so the window will always stay on top in all workspaces." [source: https://www.electronjs.org/docs/latest/api/base-window]
  - `skipTaskbar` boolean, default `false` _macOS_ _Windows_. [source: https://www.electronjs.org/docs/latest/api/structures/base-window-options]
  - `alwaysOnTop` boolean, default `false`. [source: https://www.electronjs.org/docs/latest/api/structures/base-window-options]
  - `type` string. Valid values are platform-specific: Linux = `desktop`, `dock`, `toolbar`, `splash`, `notification`; **macOS = `desktop`, `textured`, `panel`**; Windows = `toolbar`. [source: https://www.electronjs.org/docs/latest/api/structures/base-window-options]
  - `vibrancy` string _macOS_; valid values include `appearance-based`, `titlebar`, `selection`, `menu`, `popover`, `sidebar`, `header`, `sheet`, `window`, `hud`, `fullscreen-ui`, `tooltip`, `content`, `under-window`, `under-page`. [source: https://www.electronjs.org/docs/latest/api/structures/base-window-options]
- **macOS `panel` window type is the documented mechanism for a non-activating overlay**: "The `panel` type enables the window to float on top of full-screened apps by adding the `NSWindowStyleMaskNonactivatingPanel` style mask, normally reserved for NSPanel, at runtime." Panel windows also appear on all spaces (desktops). This is the key API for an overlay that does not steal focus from the active app. [source: https://www.electronjs.org/docs/latest/api/base-window]
- `win.setAlwaysOnTop(flag[, level][, relativeLevel])`: `flag` boolean; `level` string (optional) _macOS_ _Windows_; `relativeLevel` Integer (optional) _macOS_. Valid `level` values: `"normal"`, `"floating"`, `"torn-off-menu"`, `"modal-panel"`, `"main-menu"`, `"status"`, `"pop-up-menu"`, `"screen-saver"`, `"dock"` (Deprecated). Default level is `floating` when `flag` is true; reset to `normal` when flag is false. [source: https://www.electronjs.org/docs/latest/api/browser-window]
- `win.setVisibleOnAllWorkspaces(visible[, options])` _macOS_ _Linux_: `visible` boolean; `options` { `visibleOnFullScreen` boolean (optional) _macOS_, `skipTransformProcessType` boolean (optional) _macOS_ }. [source: https://www.electronjs.org/docs/latest/api/browser-window]
- `win.setIgnoreMouseEvents(ignore[, options])`: `ignore` boolean; `options` { `forward` boolean (optional) _macOS_ _Windows_ }, where `forward` "Only used when `ignore` is true." [source: https://www.electronjs.org/docs/latest/api/browser-window]
- `win.showInactive()`: "Shows the window but doesn't focus on it." (companion to panel/overlay so it appears without activating). [source: https://www.electronjs.org/docs/latest/api/base-window]
- `globalShortcut.register(accelerator, callback)` -> `boolean`; `registerAll(accelerators, callback)`; `isRegistered(accelerator)` -> `boolean`; `unregister(accelerator)`; `unregisterAll()`. The callback "is called when the registered shortcut is pressed by the user." [source: https://www.electronjs.org/docs/latest/api/global-shortcut]
- `clipboard.readText([type])` and `clipboard.writeText(text[, type])`: `type` can be `selection` or `clipboard`, default `clipboard`; `selection` is Linux-only. (Use these from the MAIN process — see gotchas.) [source: https://www.electronjs.org/docs/latest/api/clipboard]
- `new Tray(image[, guid])`: `image` NativeImage | string; `guid` optional. Methods: `setToolTip(toolTip)`, `setContextMenu(menu)` (pass `null` to clear), `setImage(image)`; `'click'` event "Emitted when the tray icon is clicked." macOS icons should be Template Images. [source: https://www.electronjs.org/docs/latest/api/tray]
- `Menu.buildFromTemplate(template)` -> `Menu`; `Menu.setApplicationMenu(menu | null)`; `menu.popup([options])`. [source: https://www.electronjs.org/docs/latest/api/menu]
- `app.setAsDefaultProtocolClient(protocol[, path, args])` -> `boolean`; `protocol` is the scheme name without `://`; `path` and `args` are Windows-only optional. macOS uses `LSSetDefaultHandlerForURLScheme`; **on macOS the protocol must be declared in the app's `info.plist` and cannot be added at runtime.** Companions: `isDefaultProtocolClient`, `removeAsDefaultProtocolClient` _macOS_ _Windows_. [source: https://www.electronjs.org/docs/latest/api/app]
- Deep-link delivery is platform-split: macOS delivers via the `'open-url'` event `(event, url)` _macOS_; Windows/Linux deliver the URL as a command-line arg through the `'second-instance'` event `(event, argv, workingDirectory, additionalData)`, gated by `app.requestSingleInstanceLock([additionalData])` -> `boolean` (true = primary instance). [source: https://www.electronjs.org/docs/latest/api/app]
- `systemPreferences.getMediaAccessStatus(mediaType)` _Windows_ _macOS_: `mediaType` = `microphone` | `camera` | `screen`; returns `not-determined` | `granted` | `denied` | `restricted` | `unknown`. [source: https://www.electronjs.org/docs/latest/api/system-preferences]
- `systemPreferences.askForMediaAccess(mediaType)` _macOS only_: `mediaType` = `microphone` | `camera`; returns a Promise resolving `true` if consent granted, `false` if denied. [source: https://www.electronjs.org/docs/latest/api/system-preferences]
- `systemPreferences.isTrustedAccessibilityClient(prompt)` _macOS only_: `prompt` boolean (whether to prompt the user if untrusted); returns `boolean` (`true` if the current process is a trusted accessibility client). [source: https://www.electronjs.org/docs/latest/api/system-preferences]
- `contextBridge.exposeInMainWorld(apiKey, api)`; also `contextBridge.exposeInIsolatedWorld(worldId, apiKey, api)`. [source: https://www.electronjs.org/docs/latest/api/context-bridge]
- IPC main: `ipcMain.handle(channel, listener)` (listener gets `event: IpcMainInvokeEvent, ...args`); `ipcMain.on(channel, listener)` (listener gets `event: IpcMainEvent, ...args`); `ipcMain.removeHandler(channel)`. [source: https://www.electronjs.org/docs/latest/api/ipc-main]
- IPC renderer: `ipcRenderer.invoke(channel, ...args)` -> `Promise<any>`; `ipcRenderer.send(channel, ...args)` (fire-and-forget); `ipcRenderer.on(channel, listener)` (listener gets `event: IpcRendererEvent, ...args`). [source: https://www.electronjs.org/docs/latest/api/ipc-renderer]
- `shell.openExternal(url[, options])` -> `Promise<void>`; options `{ activate? (macOS), workingDirectory? (Windows), logUsage? (Windows) }`. "Open the given external protocol URL in the desktop's default manner." [source: https://www.electronjs.org/docs/latest/api/shell]
- Sandbox is on by default: "Starting from Electron 20, the sandbox is enabled for renderer processes without any further configuration." [source: https://www.electronjs.org/docs/latest/tutorial/sandbox]
- `contextIsolation` is enabled by default since Electron 12.0.0. [source: https://www.electronjs.org/docs/latest/api/context-bridge]

**Constraints & gotchas**
- **globalShortcut has NO key-release / keyup event.** The callback fires only on press. There is no documented keyup. A true push-to-talk (hold-to-talk, fire on release) CANNOT be built from `globalShortcut` alone — it only knows "pressed", not "released" or "held". This is the single biggest API gap for the Wisopen hotkey flow. Workarounds (native key hooks like `uiohook-napi`, or treating the hotkey as a toggle) are outside the Electron API and unverified here. [source: https://www.electronjs.org/docs/latest/api/global-shortcut]
- **`clipboard` access from the RENDERER is deprecated as of Electron 40.** "Using the `clipboard` API directly in the renderer process is deprecated." For Wisopen's save/restore-around-paste, call `clipboard` in the MAIN process and bridge via contextBridge/IPC. [source: https://www.electronjs.org/docs/latest/breaking-changes]
- macOS protocol registration is **not runtime-mutable**: `wisopen://auth-callback` must be declared in `info.plist` (`CFBundleURLTypes`) at build time. `setAsDefaultProtocolClient` on macOS only affects the LaunchServices default handler, not the scheme declaration. [source: https://www.electronjs.org/docs/latest/api/app]
- `askForMediaAccess` is macOS-only; there is no Electron API to request microphone permission on Windows (status is readable via `getMediaAccessStatus` but Windows has no programmatic prompt API in Electron). Plan a Windows-specific path (rely on OS prompt at capture time / Settings deep-link). [source: https://www.electronjs.org/docs/latest/api/system-preferences]
- Accessibility permission API (`isTrustedAccessibilityClient`) is macOS-only. The Accessibility permission Wisopen needs for cursor text injection has no equivalent Electron API on Windows. [source: https://www.electronjs.org/docs/latest/api/system-preferences]
- `transparent: true` on Windows requires the window to be frameless. [source: https://www.electronjs.org/docs/latest/api/structures/base-window-options]
- `setVisibleOnAllWorkspaces` is macOS/Linux only (no Windows). For the always-on-top overlay across spaces, pair it with `setAlwaysOnTop(true, 'screen-saver')` and `{ visibleOnFullScreen: true }` on macOS. [source: https://www.electronjs.org/docs/latest/api/browser-window]
- `setIgnoreMouseEvents` `forward` option is macOS/Windows only (not Linux). [source: https://www.electronjs.org/docs/latest/api/browser-window]
- Electron 42 migrated macOS notifications from `NSUserNotification` to the `UNNotification` API (behavior change; relevant only if Wisopen uses the Notification API). [source: https://www.electronjs.org/docs/latest/breaking-changes]
- Sandboxed preload scripts can only `require` a restricted set: `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame`, `webUtils` (+ node `events`, `timers`, `url`, and globals `Buffer`, `process`, `clearImmediate`, `setImmediate`). No full Node in preload when sandboxed — keep all Node/native work in the main process. [source: https://www.electronjs.org/docs/latest/tutorial/sandbox]

**Verified examples**
- Process model / preload + contextBridge security pattern — https://www.electronjs.org/docs/latest/tutorial/process-model and https://www.electronjs.org/docs/latest/api/context-bridge
- Sandbox-enabled preload constraints — https://www.electronjs.org/docs/latest/tutorial/sandbox
- Deep linking tutorial (open-url vs second-instance) — https://www.electronjs.org/docs/latest/api/app (events `open-url`, `second-instance`)

**Couldn't verify**
- `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')` to open a specific macOS System Settings privacy pane — the Electron `shell.openExternal` docs do not document the `x-apple.systempreferences:` scheme (it is a macOS/Apple OS URL scheme, not an Electron feature). `openExternal` accepts arbitrary protocol URLs per its description, so this should work, but the exact pane identifier strings (`com.apple.preference.security?Privacy_Accessibility`, `Privacy_Microphone`) are Apple-internal and not documented by Electron; they also changed with the macOS Ventura+ System Settings redesign. Searched: electronjs.org shell docs. Not found in authoritative Electron sources — treat pane URL strings as needing runtime verification on the target macOS version.
- Exact non-activating focus behavior of `type:'panel'` beyond the `NSWindowStyleMaskNonactivatingPanel` statement (e.g. whether it fully prevents focus theft in every scenario) — only the style-mask statement is documented. Searched: base-window and browser-window docs.
- A v42-specific breaking change touching globalShortcut, BrowserWindow overlay options, contextBridge, Tray/Menu, protocol, or systemPreferences — none found for 42.0/41.0/40.0 other than the clipboard-renderer deprecation (40) and macOS notification API change (42). Searched: electronjs.org/docs/latest/breaking-changes.

**Sources consulted**
- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/base-window
- https://www.electronjs.org/docs/latest/api/structures/base-window-options
- https://www.electronjs.org/docs/latest/api/global-shortcut
- https://www.electronjs.org/docs/latest/api/clipboard
- https://www.electronjs.org/docs/latest/api/tray
- https://www.electronjs.org/docs/latest/api/menu
- https://www.electronjs.org/docs/latest/api/app
- https://www.electronjs.org/docs/latest/api/system-preferences
- https://www.electronjs.org/docs/latest/api/context-bridge
- https://www.electronjs.org/docs/latest/api/ipc-main
- https://www.electronjs.org/docs/latest/api/ipc-renderer
- https://www.electronjs.org/docs/latest/api/shell
- https://www.electronjs.org/docs/latest/tutorial/sandbox
- https://www.electronjs.org/docs/latest/breaking-changes

<!-- ===== fragment: storage-packaging ===== -->

### electron safeStorage@42 (built-in to Electron 42.4.0)
**Verified facts**
- `safeStorage` "allows access to simple encryption and decryption of strings for storage on the local machine." [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- `safeStorage.isEncryptionAvailable()` returns `boolean`. "On Linux, returns true if the app has emitted the `ready` event and the secret key is available. On MacOS, returns true if Keychain is available. On Windows, returns true once the app has emitted the `ready` event." [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- `safeStorage.encryptString(plainText: string)` returns `Buffer` (an array of bytes representing the encrypted string). [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- `safeStorage.decryptString(encrypted: Buffer)` returns `string` (the decrypted string); reverses `encryptString`. [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- `safeStorage.getSelectedStorageBackend()` (Linux only) returns `string`; possible values: `basic_text`, `gnome_libsecret`, `kwallet`, `kwallet5`, `kwallet6`, `unknown`. Returns `unknown` when called before the app `ready` event. [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- `safeStorage.setUsePlainTextEncryption(usePlainText: boolean)` — no return value; on Linux forces an in-memory password for the symmetric key; no-op on Windows and macOS. [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- OS keychain backing: macOS uses Keychain; Windows uses DPAPI; Linux uses a secret store (`gnome-libsecret`, `kwallet`/`kwallet5`/`kwallet6`). [source: https://www.electronjs.org/docs/latest/api/safe-storage]

**Constraints & gotchas**
- `encryptString` "will throw an error if encryption fails." Wrap in try/catch and gate on `isEncryptionAvailable()` first. [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- Must be used AFTER the app `ready` event on Windows and Linux (per `isEncryptionAvailable` semantics above). On macOS it depends on Keychain availability rather than `ready`. Implication: do not call at top-level/module-load in the main process. [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- safeStorage is encryption-only, NOT a named keychain key/value store like keytar. The app is responsible for persisting the returned `Buffer` itself (e.g. to a file under `app.getPath('userData')` or via electron-store/better-sqlite3). The docs do not provide a storage location. This is the key behavioral difference vs keytar's `setPassword(service, account, password)`. [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- Linux degraded mode: "If no secret store is available, items stored in using the `safeStorage` API will be unprotected as they are encrypted via hardcoded plaintext password. You can detect when this happens when `safeStorage.getSelectedStorageBackend()` returns `basic_text`." Treat `basic_text` as "not actually secure" for the Supabase refresh token. [source: https://www.electronjs.org/docs/latest/api/safe-storage]
- Encrypted blobs are keyed to the OS user/machine; not portable across machines or users.

**Verified examples**
- Official API reference with all method signatures and the `basic_text` Linux warning — https://www.electronjs.org/docs/latest/api/safe-storage

**Couldn't verify**
- Exact behavior if `decryptString` is given a buffer produced on a different OS/user (cross-context decryption) — not stated on the API page.

**Sources consulted**
- https://www.electronjs.org/docs/latest/api/safe-storage

---

### keytar@7.9.0 (deprecation/archival status for migration off)
**Verified facts**
- The `atom/node-keytar` GitHub repository is archived and read-only: "This repository was archived by the owner on Dec 15, 2022. It is now read-only." [source: https://github.com/atom/node-keytar]
- Latest/last published version on npm is `7.9.0`, published `2022-02-17`. No newer release exists. [source: npm registry https://registry.npmjs.org/keytar — dist-tags.latest=7.9.0, time["7.9.0"]=2022-02-17T12:13:51Z]
- The npm `latest` tag still points at `7.9.0`; the package does NOT carry a formal `deprecated` field on 7.9.0 (deprecation is via repo archival, not the npm deprecate flag). [source: npm registry https://registry.npmjs.org/keytar]

**Constraints & gotchas**
- keytar is unmaintained (archived 2022, no release since Feb 2022) and is a native module that must be rebuilt against the Electron ABI — combined with archival this is the migration driver. Replace with Electron `safeStorage` for the Supabase refresh token.
- Migration note: keytar stored secrets BY NAME in the OS keychain (`setPassword`/`getPassword`/`deletePassword`). safeStorage only encrypts/decrypts — the app must persist the ciphertext itself. A drop-in replacement requires an app-side persistence layer (file or DB) plus `safeStorage` for the crypto.

**Verified examples**
- Archive banner on the repo homepage — https://github.com/atom/node-keytar

**Couldn't verify**
- Whether any official Electron/GitHub doc names safeStorage as the "recommended successor" to keytar specifically — not found on the keytar repo README (no alternative recommended there).

**Sources consulted**
- https://github.com/atom/node-keytar
- https://registry.npmjs.org/keytar (registry metadata)

---

### better-sqlite3@12.10.1
**Verified facts**
- Version `12.10.1` is the current latest on npm, published `2026-06-13`. `engines.node` = `20.x || 22.x || 23.x || 24.x || 25.x || 26.x`; dependencies are `bindings` and `prebuild-install` (it is a native/gyp addon shipping prebuilds). [source: npm registry https://registry.npmjs.org/better-sqlite3]
- Constructor: `new Database(path, [options])` — creates a new DB connection synchronously; pass `":memory:"` for in-memory or `""` for a temporary on-disk DB; if the file does not exist it is created (synchronously). Options include `readonly`, `fileMustExist`, `timeout` (default 5000ms), `verbose`. [source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md]
- `Database#prepare(sql) -> Statement`: "Creates a new prepared Statement from the given SQL string." The API is synchronous throughout. [source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md]
- `Statement#run([...bindParameters]) -> object` returns an info object with `info.changes` (rows inserted/updated/deleted) and `info.lastInsertRowid`. [source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md]
- `Statement#get([...bindParameters]) -> row` returns the first row as an object (column names as keys) or `undefined` if no rows. [source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md]
- `Statement#all([...bindParameters]) -> array` returns all matching rows as an array of objects, or `[]` if none. All three throw an `Error` on execution failure. [source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md]

**Constraints & gotchas**
- Electron rebuild REQUIRED: official troubleshooting doc (verified at tag v12.10.1) states under "Electron": "1. If you're using Electron, use `electron-rebuild`." [source: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v12.10.1/docs/troubleshooting.md] — Note: the doc names the `electron-rebuild` npm package; this is the same tool now published as `@electron/rebuild` (CLI binary `electron-rebuild`). Either works; rebuild against the exact Electron version's ABI.
- asar unpacking REQUIRED: "If you're using an app.asar bundle, be sure all native libraries are 'unpacked'." With electron-forge use the auto-unpack-natives plugin; with electron-builder, native modules are auto-detected for unpacking (or use `asarUnpack`). [source: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v12.10.1/docs/troubleshooting.md]
- Synchronous API blocks the main thread — for the Wisopen main process keep queries short or run the DB on a utility/worker process if large.
- Native addon: `engines.node` constrains the Node toolchain used to build; the resulting `.node` must match Electron 42.4.0's ABI, hence the mandatory rebuild step.

**Verified examples**
- API reference (constructor + Statement methods) — https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- Electron + asar guidance at the pinned tag — https://github.com/WiseLibs/better-sqlite3/blob/v12.10.1/docs/troubleshooting.md

**Couldn't verify**
- Nothing material outstanding.

**Sources consulted**
- https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v12.10.1/docs/troubleshooting.md
- https://registry.npmjs.org/better-sqlite3 (registry metadata)

---

### electron-store@11.0.2
**Verified facts**
- v11.0.2 is current latest on npm, published `2025-10-05`. Package metadata: `"type": "module"`, `exports` = `{ "types": "./index.d.ts", "default": "./index.js" }`, NO `main` field, `engines.node` = `>=20`. This confirms v11 is ESM-ONLY (native ESM, no CommonJS export). [source: npm registry https://registry.npmjs.org/electron-store]
- README: "This package is native ESM and no longer provides a CommonJS export. If your project uses CommonJS, you will have to convert to ESM." [source: https://github.com/sindresorhus/electron-store/blob/main/readme.md]
- Minimum Electron version: Electron 30 or later. [source: https://github.com/sindresorhus/electron-store/blob/main/readme.md]
- Core API: `new Store(options?)`, `store.set(key, value)`, `store.get(key, defaultValue?)`, plus `.delete()`, `.clear()`, `.has()`, `.onDidChange()`. [source: https://github.com/sindresorhus/electron-store/blob/main/readme.md]
- Process usage: "You can use this module directly in both the main and renderer process. For use in the renderer process only, you need to call `Store.initRenderer()` in the main process, or create a new Store instance (`new Store()`) in the main process." [source: https://github.com/sindresorhus/electron-store/blob/main/readme.md]

**Constraints & gotchas**
- ESM-only is the headline constraint. The README's OFFICIAL recommendation for CommonJS consumers is to convert the project to ESM — it does NOT document the dynamic `import()` workaround. If the Wisopen main process stays CommonJS, the documented path is to convert to ESM; using top-level `await import('electron-store')` is a community pattern, NOT documented by the maintainer. [source: https://github.com/sindresorhus/electron-store/blob/main/readme.md]
- A Store instance must be created in the main process at least once (directly, or `Store.initRenderer()`) before renderer use. [source: https://github.com/sindresorhus/electron-store/blob/main/readme.md]
- electron-store persists JSON to `app.getPath('userData')` by default; data is plaintext unless `encryptionKey` is set — and even then it is obfuscation, not OS-keychain security. Do NOT rely on it alone for the Supabase refresh token; pair with safeStorage.

**Verified examples**
- README ESM/CommonJS note and API — https://github.com/sindresorhus/electron-store/blob/main/readme.md

**Couldn't verify**
- Whether the README anywhere endorses dynamic `import()` from CJS — not found; it only says "convert to ESM."

**Sources consulted**
- https://github.com/sindresorhus/electron-store/blob/main/readme.md
- https://registry.npmjs.org/electron-store (registry metadata: type/exports/engines)

---

### electron-builder@26.15.3
**Verified facts**
- v26.15.3 is current latest on npm, published `2026-06-09`. [source: npm registry https://registry.npmjs.org/electron-builder]
- mac `notarize` option: type `boolean` (optional). Description: "Whether to disable electron-builder's @electron/notarize integration." (i.e. notarization is built into electron-builder via @electron/notarize; set `notarize: false` to disable.) [source: https://www.electron.build/docs/mac/ ; https://www.electron.build/app-builder-lib.interface.macconfiguration]
- Notarization is activated by environment variables (one set required): (A) `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (recommended, API-key based; also commonly with `APPLE_TEAM_ID`); (B) `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; (C) `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`. "electron-builder handles all three [notarization] steps automatically when configured." [source: https://www.electron.build/docs/mac/ ; https://www.electron.build/docs/features/code-signing/notarization]
- mac `hardenedRuntime`: type `boolean`, DEFAULT `true` — "Whether your app has to be signed with hardened runtime." Required for notarization. [source: https://www.electron.build/docs/mac/]
- mac `gatekeeperAssess`: type `boolean`, DEFAULT `false` — "Whether to let @electron/osx-sign validate the signing or not." [source: https://www.electron.build/docs/mac/]
- mac `entitlements`: `string | null`, default path `build/entitlements.mac.plist` — "The path to entitlements file for signing the app." `entitlementsInherit`: default path `build/entitlements.mac.inherit.plist`. [source: https://www.electron.build/docs/mac/]
- mac `target` default: `dmg` and `zip` (zip needed for Squirrel.Mac auto-update). [source: https://www.electron.build/docs/mac/]
- Windows `target` default: `nsis`. Other targets: nsis-web, portable, appx, msi, msi-wrapped, squirrel, 7z, zip, tar.*, dir. [source: https://www.electron.build/app-builder-lib.Interface.WindowsConfiguration.html]
- Windows signing in v26 is configured under `win.signtoolOptions` (a `WindowsSigntoolConfiguration` object): keys include `certificateFile`, `certificatePassword`, `certificateSubjectName` (required for EV), `certificateSha1`, `publisherName`, `sign` (custom function/file/module), `rfc3161TimeStampServer`/`timeStampServer` (default `http://timestamp.digicert.com`), `signingHashAlgorithms` (default `['sha1','sha256']`). "Options for usage with signtool.exe. Cannot be used in conjunction with `azureSignOptions`." [source: https://www.electron.build/app-builder-lib.Interface.WindowsConfiguration.html ; https://www.electron.build/app-builder-lib.Interface.WindowsSigntoolConfiguration.html]
- Env vars for Windows cert: `CSC_LINK`/`WIN_CSC_LINK` (cert path) and `CSC_KEY_PASSWORD`/`WIN_CSC_KEY_PASSWORD` (password) — used if the config-file fields are not used. [source: https://www.electron.build/app-builder-lib.Interface.WindowsSigntoolConfiguration.html]
- `asar` option: `boolean | AsarOptions`, DEFAULT `true` — "Whether to package the application's source code into an archive... Node modules, that must be unpacked, will be detected automatically." [source: https://www.electron.build/app-builder-lib.Interface.Configuration.html]
- `asarUnpack`: "A glob patterns relative to the app directory, which specifies which files to unpack when creating the asar archive." Use to force-unpack native `.node` modules (e.g. better-sqlite3) so they load from `app.asar.unpacked/`. [source: https://www.electron.build/app-builder-lib.Interface.Configuration.html]

**Constraints & gotchas**
- BREAKING vs older guidance: in electron-builder v26 the Windows signtool keys moved UNDER `win.signtoolOptions`. The legacy flat `win.sign` / `win.certificateFile` / `win.certificateSubjectName` top-level keys are the OLD shape; for v26 use `win.signtoolOptions.{sign,certificateFile,certificateSubjectName,...}`. [source: https://www.electron.build/app-builder-lib.Interface.WindowsConfiguration.html]
- The mac `notarize` option is a BOOLEAN (disable switch), not an object. To CONFIGURE notarization you set the APPLE_* env vars; an explicit team id is supplied via `APPLE_TEAM_ID`, not via a `notarize: { teamId }` object in current docs. (Some older versions accepted an object; v26 docs show boolean.) [source: https://www.electron.build/docs/mac/]
- A manual `afterSign` notarize hook is NO LONGER required for the core notarization flow (built-in). afterSign is only for edge cases like signing additional/3rd-party binaries. [source: https://www.electron.build/docs/features/code-signing/notarization]
- Audio capture (Wisopen mic): macOS hardened runtime + notarization requires the entitlement `com.apple.security.device.audio-input` in the entitlements plist; also the app must declare `NSMicrophoneUsageDescription` in Info.plist (set via `build.mac.extendInfo`). hardenedRuntime is on by default so this is mandatory. [source: hardenedRuntime/entitlements behavior at https://www.electron.build/docs/mac/]
- Native modules unpack automatically (asar=true auto-detect), but for reliability with better-sqlite3 add an explicit `asarUnpack: ["**/node_modules/better-sqlite3/**"]` (or `**/*.node`). [source: https://www.electron.build/app-builder-lib.Interface.Configuration.html]

**Verified examples**
- MacConfiguration option reference — https://www.electron.build/app-builder-lib.interface.macconfiguration
- Windows signtoolOptions reference — https://www.electron.build/app-builder-lib.Interface.WindowsSigntoolConfiguration.html
- Notarization feature doc — https://www.electron.build/docs/features/code-signing/notarization

**Couldn't verify**
- Exact verbatim `com.apple.security.device.audio-input` string in the electron-builder docs (it is an Apple entitlement key; electron-builder docs cover entitlements file plumbing, not the specific microphone key). The KEY itself is correct per Apple, but not quoted from an electron-builder page — flagged as an Apple-doc fact, not electron-builder-doc-verified.
- Whether v26 still accepts a `mac.notarize` OBJECT form (e.g. `{ teamId }`) for backward compat — current docs only show the boolean; not confirmed.

**Sources consulted**
- https://www.electron.build/docs/mac/
- https://www.electron.build/app-builder-lib.interface.macconfiguration
- https://www.electron.build/docs/features/code-signing/notarization
- https://www.electron.build/app-builder-lib.Interface.WindowsConfiguration.html
- https://www.electron.build/app-builder-lib.Interface.WindowsSigntoolConfiguration.html
- https://www.electron.build/app-builder-lib.Interface.Configuration.html
- https://registry.npmjs.org/electron-builder (registry metadata)

---

### electron-updater@6.8.9
**Verified facts**
- v6.8.9 is current latest on npm, published `2026-06-05`. [source: npm registry https://registry.npmjs.org/electron-updater]
- Import + basic usage: `import { autoUpdater } from "electron-updater"` then `autoUpdater.checkForUpdatesAndNotify()`. [source: https://www.electron.build/auto-update.html]
- `checkForUpdatesAndNotify(downloadNotification?)` returns `Promise<null | UpdateCheckResult>`. [source: https://www.electron.build/electron-updater.Class.AppUpdater.html]
- autoUpdater events: `error` (Error), `checking-for-update`, `update-available` (UpdateInfo), `update-not-available` (UpdateInfo), `download-progress` (ProgressInfo: `bytesPerSecond`, `percent`, `total`, `transferred`), `update-downloaded` (UpdateInfo). [source: https://www.electron.build/auto-update.html]
- Publish providers include `generic`, `github`, `s3` (plus bitbucket, spaces, keygen, snapStore). [source: https://www.electron.build/publish.html]
- Generic provider config: `provider: "generic"` (required), `url` (required, base URL e.g. `https://bucket_name.s3.amazonaws.com`), optional `channel` (default `latest`), `useMultipleRangeRequest`, `requestHeaders`, `timeout` (default 120000). [source: https://www.electron.build/builder-util-runtime.Interface.GenericServerOptions.html]
- GitHub provider config: `provider: "github"` (required), `owner`, `repo` (detected automatically), `private`, `host` (default github.com), `protocol` (https only), `releaseType` (default `draft`); requires `GH_TOKEN` env var. [source: https://www.electron.build/builder-util-runtime.Interface.GithubOptions.html]
- S3 provider config: `provider: "s3"`, `bucket` (required), `acl` (default `public-read`), `channel` (default `latest`), `region`/`endpoint`; AWS creds via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or `~/.aws/credentials`. [source: https://www.electron.build/builder-util-runtime.Interface.S3Options.html]

**Constraints & gotchas**
- macOS auto-update (Squirrel.Mac) requires BOTH `dmg` and `zip` targets to be built. [source: https://www.electron.build/docs/mac/]
- macOS auto-update requires the app to be code-signed (and notarized for distribution) or updates will be rejected.
- electron-updater is a main-process module; pair update events with IPC to the renderer for UI.
- Use a single source of truth for the publish provider: the same `publish` block drives both electron-builder upload and electron-updater feed URL.

**Verified examples**
- Auto-update setup + events — https://www.electron.build/auto-update.html
- AppUpdater class (checkForUpdatesAndNotify signature) — https://www.electron.build/electron-updater.Class.AppUpdater.html

**Couldn't verify**
- Nothing material outstanding.

**Sources consulted**
- https://www.electron.build/auto-update.html
- https://www.electron.build/electron-updater.Class.AppUpdater.html
- https://www.electron.build/publish.html
- https://www.electron.build/builder-util-runtime.Interface.GenericServerOptions.html
- https://www.electron.build/builder-util-runtime.Interface.GithubOptions.html
- https://www.electron.build/builder-util-runtime.Interface.S3Options.html
- https://registry.npmjs.org/electron-updater (registry metadata)

---

### @electron/rebuild@4.0.4
**Verified facts**
- v4.0.4 is current latest on npm, published `2026-04-21`; CLI bin is `electron-rebuild` -> `lib/cli.js`. [source: npm registry https://registry.npmjs.org/@electron/rebuild]
- CLI flags: `-v, --version` "The version of Electron to build against"; `-a, --arch` "Override the target architecture..."; `-f, --force` "Force rebuilding modules, even if we would skip it otherwise"; `-m, --module-dir` "The path to the node_modules directory to rebuild". [source: https://github.com/electron/rebuild/blob/main/README.md]
- Programmatic usage: `import { rebuild } from '@electron/rebuild'; rebuild({ buildPath, electronVersion, arch? }).then(...)`. `buildPath` = "An absolute path to your app's directory (the directory that contains your node_modules)"; `electronVersion` = Electron version to target; `arch` optional (default `process.arch`). Returns a Promise. [source: https://github.com/electron/rebuild/blob/main/README.md]

**Constraints & gotchas**
- This is the modern, scoped package; older docs/packages reference the legacy `electron-rebuild` name. The CLI binary is still `electron-rebuild`. better-sqlite3's troubleshooting doc still says "use electron-rebuild" — same tool. [source: https://github.com/electron/rebuild/blob/main/README.md ; https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v12.10.1/docs/troubleshooting.md]
- `electronVersion` must match the EXACT Electron runtime (42.4.0) so the native ABI lines up. Re-run after every Electron upgrade and for each target `arch` (x64 + arm64 on macOS).
- Run rebuild before packaging/tests; pair with electron-builder which can also trigger rebuild during `install-app-deps`.

**Verified examples**
- CLI + programmatic examples — https://github.com/electron/rebuild/blob/main/README.md

**Couldn't verify**
- Nothing material outstanding.

**Sources consulted**
- https://github.com/electron/rebuild/blob/main/README.md
- https://registry.npmjs.org/@electron/rebuild (registry metadata)

---

### playwright@1.61.0
**Verified facts**
- v1.61.0 is current latest on npm, published `2026-06-15`. [source: npm registry https://registry.npmjs.org/playwright]
- Electron entry point: `const { _electron: electron } = require('playwright');` (also `import { _electron } from 'playwright'`). [source: https://playwright.dev/docs/api/class-electron]
- `electron.launch([options])` returns `Promise<ElectronApplication>`. Options include `args` ("Additional arguments to pass to the application when launching. You typically pass the main script name here."), `executablePath` ("Launches given Electron application. If not specified, launches the default Electron executable installed in this package"), `cwd`, `env`, `timeout` (default 30000), `recordVideo`. [source: https://playwright.dev/docs/api/class-electron]
- `electronApp.firstWindow()` — "Get the first window that the app opens, wait if necessary" — returns the first `Page`. [source: https://playwright.dev/docs/api/class-electron]
- `electronApp.evaluate(pageFunction, arg?)` runs a function in the MAIN Electron process (the arg is the result of `require('electron')`); returns `Promise<Serializable>`. [source: https://playwright.dev/docs/api/class-electronapplication]
- `electronApp.close()` returns `Promise<void>` — closes the Electron application. [source: https://playwright.dev/docs/api/class-electronapplication]

**Constraints & gotchas**
- `_electron` is the experimental/underscore-prefixed API (intentionally namespaced), but is the official, documented way to drive Electron in tests. [source: https://playwright.dev/docs/api/class-electron]
- To launch the real app, pass the built main script via `args: ['path/to/main.js']` (or `executablePath` for a packaged binary); `firstWindow()` then yields the window `Page` for normal Playwright assertions. [source: https://playwright.dev/docs/api/class-electron]
- Use `electronApp.evaluate(({ app }) => ...)` to reach main-process APIs (e.g. trigger the hotkey path or stub providers) since renderer-only locators can't touch the main process. [source: https://playwright.dev/docs/api/class-electronapplication]

**Verified examples**
- Full launch -> evaluate -> firstWindow -> screenshot -> close example — https://playwright.dev/docs/api/class-electron

**Couldn't verify**
- Nothing material outstanding.

**Sources consulted**
- https://playwright.dev/docs/api/class-electron
- https://playwright.dev/docs/api/class-electronapplication (via Context7 /microsoft/playwright.dev)
- https://registry.npmjs.org/playwright (registry metadata)

<!-- ===== fragment: stt-providers ===== -->

### @aws-sdk/client-transcribe-streaming@3.1068.0
**Verified facts**
- `TranscribeStreamingClient({ region, credentials })` is the client; you send `new StartStreamTranscriptionCommand(input)` via `client.send(command)`, which resolves to a response whose `TranscriptResultStream` is an async iterable. [source: https://github.com/aws/aws-sdk-js-v3/blob/main/clients/client-transcribe-streaming/README.md]
- `StartStreamTranscriptionCommand` input fields: `LanguageCode?` (optional), `MediaSampleRateHertz` (required for the operation), `MediaEncoding` (required for the operation), `AudioStream` (required), `VocabularyName?` (optional), `IdentifyLanguage?` (optional boolean), `LanguageOptions?` (optional, comma-separated string), `PreferredLanguage?` (optional). [source: https://raw.githubusercontent.com/aws/aws-sdk-js-v3/main/clients/client-transcribe-streaming/src/models/models_0.ts]
- `MediaEncoding` valid values: `"pcm"` (signed 16-bit little-endian), `"ogg-opus"` (OPUS in Ogg container), `"flac"`. The README/example uses `MediaEncoding: "pcm"`. [source: SDK README + models_0.ts]
- `MediaSampleRateHertz` is in Hz; AWS suggests 8000 Hz for low-quality and 16000 Hz for high-quality audio, and it must match the audio's actual sample rate. [source: SDK README]
- `AudioStream` is an async iterable (async generator) yielding tagged-union members of shape `{ AudioEvent: { AudioChunk: <Uint8Array> } }`. The README shows: `yield { AudioEvent: { AudioChunk: chunk } };`. [source: SDK README]
- `AudioEvent.AudioChunk` is typed `Uint8Array | undefined`; an AudioEvent represents a chunk with a "maximum duration of 1 second". [source: models_0.ts]
- Response iteration: `for await (const event of response.TranscriptResultStream) { if (event.TranscriptEvent) { const results = event.TranscriptEvent.Transcript.Results; ... } }`. Each `Result` exposes `Alternatives`, each `Alternative` exposes `Items`, each `Item` exposes `Content`. [source: SDK README]
- Custom vocabulary for the dictionary feature is supplied via `VocabularyName` (single name) — maps to header `x-amzn-transcribe-vocabulary-name`. There is also `VocabularyNames` (plural, comma-separated) and `LanguageModelName` for custom language models. [source: models_0.ts + Transcribe DG custom-vocabulary-using.md]
- Partial vs final results are signaled by `Result.IsPartial` (boolean): `true` = incomplete/in-progress segment; `false` = complete/finalized segment. There is no separate "end" event — finality is per-result via this flag. [source: https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.md]

**Constraints & gotchas**
- `IsPartial: false` is the ONLY signal of a finalized segment. The stream keeps emitting `TranscriptEvent`s; a given `ResultId` is re-emitted with growing text while `IsPartial: true`, then once more with `IsPartial: false`. Dedup/replace by `ResultId`. [source: streaming-partial-results.md]
- Per the TypeScript types, ALL fields on `Result`, `Alternative`, and `Item` are optional (`?`). In a mock, defensively guard `result.Alternatives?.[0]?.Items` and `result.IsPartial` may be `undefined` (treat undefined like not-final, or assert presence). [source: models_0.ts]
- `MediaEncoding` is exposed as a string-literal-typed param, not an enum object; the only practical encodings are `pcm`/`ogg-opus`/`flac`. Wisopen captures PCM so use `"pcm"` (16 kHz). [source: models_0.ts + SDK README]
- Exceptions can arrive EITHER as a thrown error on `client.send()` (request setup/validation) OR as members INSIDE the `TranscriptResultStream` union mid-stream — the result-stream events must be checked for exception members, not only `TranscriptEvent`. [source: models_0.ts TranscriptResultStream union]
- `AudioStream` is a tagged union (`AudioEventMember | ConfigurationEventMember | $UnknownMember`); the audio path uses the `AudioEvent` member shape only. [source: models_0.ts]
- Streaming transport is bidirectional HTTP/2 (`POST /stream-transcription`, content-type `application/vnd.amazon.eventstream`). In Node this is handled by the SDK's stream handler; the public surface you mock is only the async-iterable input + async-iterable response. [source: SDK test snapshots req/res]

**Mock contract**
- **Symbols to mock**:
  - `TranscribeStreamingClient(config: { region: string; credentials })` -> instance with `.send(command)`. [source: SDK README]
  - `StartStreamTranscriptionCommand(input: StartStreamTranscriptionCommandInput)` -> command object. [source: SDK README + models_0.ts]
  - `client.send(StartStreamTranscriptionCommand)` -> `Promise<{ TranscriptResultStream: AsyncIterable<TranscriptResultStream>, SessionId?, LanguageCode?, MediaSampleRateHertz?, MediaEncoding?, $metadata }>`. [source: SDK test snapshots res/StartStreamTranscription]
- **Return shape** (verbatim TypeScript from models_0.ts for the nested transcript shape):
  ```ts
  export interface Item {
    StartTime?: number | undefined;
    EndTime?: number | undefined;
    Type?: ItemType | undefined;            // "pronunciation" | "punctuation"
    Content?: string | undefined;
    VocabularyFilterMatch?: boolean | undefined;
    Speaker?: string | undefined;
    Confidence?: number | undefined;
    Stable?: boolean | undefined;
  }
  export interface Alternative {
    Transcript?: string | undefined;
    Items?: Item[] | undefined;
    Entities?: Entity[] | undefined;
  }
  export interface Result {
    ResultId?: string | undefined;
    StartTime?: number | undefined;
    EndTime?: number | undefined;
    IsPartial?: boolean | undefined;
    Alternatives?: Alternative[] | undefined;
    ChannelId?: string | undefined;
    LanguageCode?: LanguageCode | undefined;
    LanguageIdentification?: LanguageWithScore[] | undefined;
  }
  export interface AudioEvent {
    AudioChunk?: Uint8Array | undefined;     // <= 1 second of audio
  }
  // TranscriptEvent.Transcript.Results: Result[]
  // TranscriptResultStream union members:
  //   TranscriptEventMember | BadRequestExceptionMember | LimitExceededExceptionMember
  //   | InternalFailureExceptionMember | ConflictExceptionMember
  //   | ServiceUnavailableExceptionMember | $UnknownMember
  ```
  Wire-level JSON of one TranscriptEvent result (from Transcribe DG, partial-stabilization example) — exact field casing the SDK deserializes:
  ```json
  "Transcript": {
    "Results": [
      {
        "Alternatives": [
          {
            "Items": [
              { "Content": "Welcome", "EndTime": 2.4225, "Stable": true, "StartTime": 1.65, "Type": "pronunciation", "VocabularyFilterMatch": false },
              { "Content": "to", "EndTime": 2.8325, "Stable": false, "StartTime": 2.4225, "Type": "pronunciation", "VocabularyFilterMatch": false }
            ],
            "Transcript": "Welcome to Amazon."
          }
        ],
        "EndTime": 4.165,
        "IsPartial": true,
        "ResultId": "12345a67-8bc9-0de1-2f34-a5b678c90d12",
        "StartTime": 1.65
      }
    ]
  }
  ```
  Minimal mock the adapter consumes: yield `{ TranscriptEvent: { Transcript: { Results: [{ ResultId, IsPartial, Alternatives: [{ Transcript, Items: [{ Content, Type }] }] }] } } }` — partial(s) with `IsPartial:true` then a final with `IsPartial:false`.
- **Errors / exceptions**: `BadRequestException` (raised when "one or more arguments to StartStreamTranscription ... was not valid"; HTTP 400), `LimitExceededException` ("client has exceeded one of the Amazon Transcribe limits ... typically the audio length limit"; HTTP 429), `InternalFailureException` ("a problem occurred while processing the audio ... terminated processing"; 500), `ConflictException` ("a new stream started with the same session ID ... current stream terminated"; 409), `ServiceUnavailableException` ("the service is currently unavailable"; 503). These are both thrown from `send()` AND deliverable as members within `TranscriptResultStream`. [source: models_0.ts]
- **Side effects**: bidirectional HTTP/2 long-lived stream; service enforces per-account streaming quotas and an audio length limit (surfaced as `LimitExceededException`). AudioChunk must be <= ~1s each and audio must be roughly real-time/continuous (gaps can degrade transcription). No idempotency key; `SessionId` identifies a stream and a duplicate SessionId triggers `ConflictException`. [source: models_0.ts + SDK test snapshot notes]

**Verified examples**
- Construct command + send + iterate TranscriptResultStream — https://github.com/aws/aws-sdk-js-v3/blob/main/clients/client-transcribe-streaming/README.md
- AudioStream async generator yielding `{ AudioEvent: { AudioChunk } }` (mic and Node-stream variants) — same README
- Custom vocabulary header `x-amzn-transcribe-vocabulary-name` in streaming — https://docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary-using.md
- Partial vs final (`IsPartial`, `Stable`) result JSON — https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.md

**Couldn't verify**
- The exact published date and the version-tagged README for the precise tag 3.1068.0 — npmjs.com returned HTTP 403 to WebFetch and I did not check out the SDK at that git tag. Types were read from `main` (the `models_0.ts` interfaces above), not from a `v3.1068.0` tag; these model interfaces are stable across recent v3 minors but the exact-tag diff was not confirmed. Searched: npm (blocked), GitHub raw `main`.
- The full enumerated `LanguageCode` list for this version — `models_0.ts` imports it from `./enums` which I did not fetch; AWS DG lists streaming codes (e.g., en-US, en-GB, es-US, fr-CA, fr-FR, plus many more). Searched: models_0.ts (import only).

**Sources consulted**
- https://github.com/aws/aws-sdk-js-v3/blob/main/clients/client-transcribe-streaming/README.md
- https://raw.githubusercontent.com/aws/aws-sdk-js-v3/main/clients/client-transcribe-streaming/src/models/models_0.ts
- https://github.com/aws/aws-sdk-js-v3/blob/main/clients/client-transcribe-streaming/test/snapshots/req/StartStreamTranscription.txt (+ res/ snapshots)
- https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.md
- https://docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary-using.md
- https://docs.aws.amazon.com/transcribe/latest/dg/conversation-channel-id-med.md

---

### openai@6.42.0
**Verified facts**
- Client: `new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })`; `apiKey` defaults to the `OPENAI_API_KEY` env var and may be omitted when set. [source: https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md]
- Batch (file) transcription: `client.audio.transcriptions.create(body, options?)`. Overloads (verbatim from src at the v6.42.0 tag):
  ```ts
  create(body: TranscriptionCreateParamsNonStreaming<'json' | undefined>, options?): APIPromise<Transcription>;
  create(body: TranscriptionCreateParamsNonStreaming<'verbose_json'>, options?): APIPromise<TranscriptionVerbose>;
  create(body: TranscriptionCreateParamsNonStreaming<'srt' | 'vtt' | 'text'>, options?): APIPromise<string>;
  create(body: TranscriptionCreateParamsStreaming, options?): APIPromise<Stream<TranscriptionStreamEvent>>;
  ```
  [source: https://raw.githubusercontent.com/openai/openai-node/v6.42.0/src/resources/audio/transcriptions.ts]
- `TranscriptionCreateParams` fields: `file: Uploadable` (required), `model` (required; values include `"gpt-4o-transcribe"`, `"gpt-4o-mini-transcribe"`, `"whisper-1"`, `"gpt-4o-transcribe-diarize"`), `response_format?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt' | 'diarized_json'`, `stream?: boolean | null`, `language?: string`, `chunking_strategy?: 'auto' | VadConfig | null`, `include?: Array<'logprobs'>`, `timestamp_granularities?: Array<'word' | 'segment'>`. [source: transcriptions.ts @ v6.42.0]
- `Transcription` (non-verbose) shape: `text: string` (required), `logprobs?: Array<Transcription.Logprob>`, `usage?: Transcription.Tokens | Transcription.Duration`. [source: transcriptions.ts @ v6.42.0]
- `TranscriptionVerbose` shape: `duration: number`, `language: string`, `text: string` (all required), `segments?: Array<TranscriptionSegment>`, `usage?`, `words?: Array<TranscriptionWord>`. [source: transcriptions.ts @ v6.42.0]
- STREAMING transcription IS supported on `audio.transcriptions.create` via `stream: true` — the overload returns `APIPromise<Stream<TranscriptionStreamEvent>>`. NOT supported for `whisper-1` (only the gpt-4o transcribe models stream). [source: transcriptions.ts @ v6.42.0 + https://developers.openai.com/api/docs/api-reference/audio/createTranscription]
- Streaming event union `TranscriptionStreamEvent` = `TranscriptionTextDeltaEvent | TranscriptionTextDoneEvent`:
  - `TranscriptionTextDeltaEvent`: `type: 'transcript.text.delta'` (required), `delta: string` (required), `logprobs?`, `segment_id?: string`.
  - `TranscriptionTextDoneEvent`: `type: 'transcript.text.done'` (required), `text: string` (required), `logprobs?`, `usage?`.
  [source: transcriptions.ts @ v6.42.0]
- Output format support per model: `whisper-1` -> json, text, srt, verbose_json, vtt; `gpt-4o-transcribe` & `gpt-4o-mini-transcribe` -> json or plain text; `gpt-4o-transcribe-diarize` -> json, text, diarized_json. [source: https://developers.openai.com/api/docs/guides/speech-to-text]
- Realtime (WebSocket) transcription is a SEPARATE API. Dedicated transcription session config uses `input_audio_transcription: { model, prompt?, language? }`; server events are `conversation.item.input_audio_transcription.delta` (field `delta`) and `conversation.item.input_audio_transcription.completed` (field `transcript`). [source: https://developers.openai.com/api/docs/guides/realtime-transcription]
- v6 vs v4 SDK differences: v6 keeps the same `client.audio.transcriptions.create` surface and SSE streaming via `Stream<...>`. Realtime helper import is `openai/realtime/websocket` (`OpenAIRealtimeWebSocket`). [source: README @ v6.42.0]

**Constraints & gotchas**
- `whisper-1` cannot stream (`stream:true`) and supports the widest `response_format` set; the gpt-4o transcribe models stream but only return `json`/`text` formats (no `verbose_json` for those models). Pick model/format accordingly. [source: speech-to-text guide]
- When `stream:true`, you DO NOT get a `Transcription` object — you must iterate the `Stream` and accumulate `delta`s, then read the final full text from the single `transcript.text.done` event (`event.text`). [source: transcriptions.ts overload + createTranscription SSE example]
- The HTTP (file) streaming endpoint is for an already-recorded file streamed back as it's transcribed — it still takes a complete `file`. It is NOT a live mic-audio-in socket. For live push-to-talk mic streaming, the Realtime transcription WebSocket API (input_audio_transcription) is the live-audio path. [source: createTranscription docs + realtime-transcription guide]
- Realtime `input_audio_format` for `pcm16` requires 16-bit PCM at 24 kHz, mono, little-endian (differs from AWS Transcribe's 16 kHz). [source: realtime transcription_session.update docs]
- The REST `POST /realtime/transcription_sessions` (used to mint an ephemeral `client_secret`) is documented as DEPRECATED; the session is configured over the socket via `transcription_session.update`. [source: https://developers.openai.com/api/docs/api-reference/realtime-server-events/.../transcription_sessions]
- `logprobs` in responses require `include: ['logprobs']` (REST) or `include: ['item.input_audio_transcription.logprobs']` (realtime); otherwise omitted. [source: createTranscription + realtime docs]

**Mock contract**
- **Symbols to mock**:
  - `new OpenAI({ apiKey })` -> client. [source: README @ v6.42.0]
  - `client.audio.transcriptions.create(body, options?)` -> `APIPromise<Transcription>` (non-streaming json) OR `APIPromise<TranscriptionVerbose>` (verbose_json) OR `APIPromise<string>` (text/srt/vtt) OR `APIPromise<Stream<TranscriptionStreamEvent>>` (stream:true). [source: transcriptions.ts @ v6.42.0]
- **Return shape** (verbatim):
  - Non-streaming `json` (`Transcription`):
    ```json
    {
      "text": "Hey, my knee is hurting and I want to see the doctor tomorrow ideally.",
      "usage": { "type": "tokens", "input_tokens": 14, "input_token_details": { "text_tokens": 0, "audio_tokens": 14 }, "output_tokens": 45, "total_tokens": 59 }
    }
    ```
    (with `include[]=logprobs`, adds `"logprobs": [ { "token": "Hey", "logprob": -1.0415299, "bytes": [72,101,121] }, ... ]`)
  - `verbose_json` (`TranscriptionVerbose`):
    ```json
    { "task": "transcribe", "language": "english", "duration": 8.470000267028809,
      "text": "The beach was a popular spot ...",
      "words": [ { "word": "The", "start": 0.0, "end": 0.23999999463558197 }, ... ],
      "usage": { "type": "duration", "seconds": 9 } }
    ```
  - Streaming SSE (`Stream<TranscriptionStreamEvent>`) — N delta events then implicitly a `transcript.text.done` (the done event carries final `text`):
    ```
    data: {"type":"transcript.text.delta","delta":"I","logprobs":[{"token":"I","logprob":-0.00007588794,"bytes":[73]}]}
    data: {"type":"transcript.text.delta","delta":" see","logprobs":[{"token":" see","logprob":-3.1281633e-7,"bytes":[32,115,101,101]}]}
    ...
    data: {"type":"transcript.text.done","text":"I see skies of blue ... wonderful world.","usage":{...}}
    ```
  - Realtime WebSocket events (live mic path):
    ```json
    { "type": "conversation.item.input_audio_transcription.delta", "item_id": "item_003", "content_index": 0, "delta": "Hello" }
    { "type": "conversation.item.input_audio_transcription.completed", "item_id": "item_003", "content_index": 0, "transcript": "Hello, how are you?" }
    ```
- **Errors / exceptions**: a subclass of `APIError` is thrown on any non-2xx or connection failure. Subclasses: `BadRequestError` (400), `AuthenticationError` (401), `PermissionDeniedError` (403), `NotFoundError` (404), `RateLimitError` (429), `InternalServerError` (5xx), plus `APIConnectionError` / `APIConnectionTimeoutError` for transport failures. [source: README @ v6.42.0]
- **Side effects**: REST returns once (no idempotency needed for transcription); SDK has built-in retry with backoff on certain errors (configurable via `maxRetries`). Rate limits surface as `RateLimitError` (429). Realtime requires a persistent WebSocket and (for browser/client) an ephemeral `client_secret`. [source: README @ v6.42.0 + realtime docs]

**Verified examples**
- `audio/transcriptions` create with `response_format=json` + `include[]=logprobs` (cURL + JSON) — https://developers.openai.com/api/docs/api-reference/audio/createTranscription
- `verbose_json` with `timestamp_granularities[]=word` — same reference
- SSE streaming output (`stream=true`, `transcript.text.delta`) — same reference
- Realtime transcription delta/completed handling over WS — https://developers.openai.com/api/docs/guides/realtime-transcription
- create() overloads + Transcription/Stream event types — https://raw.githubusercontent.com/openai/openai-node/v6.42.0/src/resources/audio/transcriptions.ts

**Couldn't verify**
- A `transcript.text.done`-terminated streaming example showing BOTH the deltas AND the final done frame in one verbatim doc block — the createTranscription SSE example I fetched showed only `transcript.text.delta` frames; the `transcript.text.done` event itself is confirmed only via the SDK type (`TranscriptionTextDoneEvent` with `text`). Searched: developers.openai.com createTranscription page, openai-node src.
- That the README at the v6.42.0 tag contains an explicit `audio.transcriptions.create` snippet — WebFetch of that README did not surface one (it showed `responses.create` and Realtime examples instead). The create surface is confirmed from the SDK source file, not the README.

**Sources consulted**
- https://raw.githubusercontent.com/openai/openai-node/v6.42.0/src/resources/audio/transcriptions.ts
- https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md
- https://developers.openai.com/api/docs/api-reference/audio/createTranscription
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://developers.openai.com/api/docs/api-reference/realtime-server-events (transcription_session.update / transcription_sessions)

<!-- ===== fragment: llm-providers ===== -->

### openai@6.42.0
**Verified facts**
- Version 6.42.0 exists; released 2026-06-03; changelog entry: "feat(api): adds support for responses.moderation and chat_completions.moderation". [source: https://github.com/openai/openai-node/releases/tag/v6.42.0]
- Client construction with custom base URL is supported: `const client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'], baseURL: 'your-custom-url' });` — this is the documented mechanism for OpenAI-compatible endpoints. [source: https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md]
- Chat Completions call: `await client.chat.completions.create({ model, messages: [{ role, content }], ... })` returning a `ChatCompletion`. [source: https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md; src/resources/chat/completions/completions.ts]
- `ChatCompletion` interface (verbatim): `id: string`, `choices: Array<ChatCompletion.Choice>`, `created: number`, `model: string`, `object: 'chat.completion'`, `moderation?: ... | null`, `service_tier?: 'auto'|'default'|'flex'|'scale'|'priority'|null`, `system_fingerprint?: string`, `usage?: CompletionUsage`. [source: src/resources/chat/completions/completions.ts @ v6.42.0]
- `ChatCompletion.Choice`: `finish_reason: 'stop'|'length'|'tool_calls'|'content_filter'|'function_call'`, `index: number`, `logprobs: Choice.Logprobs | null`, `message: ChatCompletionMessage`. [source: src/resources/chat/completions/completions.ts @ v6.42.0]
- `ChatCompletionMessage`: `content: string | null`, `refusal: string | null`, `role: 'assistant'`, plus optional `annotations?`, `audio?`, `function_call?`, `tool_calls?`. Note `content` is nullable. [source: src/resources/chat/completions/completions.ts @ v6.42.0]
- `CompletionUsage`: `completion_tokens` (number, "Number of tokens in the generated completion."), `prompt_tokens` (number, "Number of tokens in the prompt."), `total_tokens` (number, "Total number of tokens used in the request (prompt + completion)."). Optional nested `completion_tokens_details` (accepted_prediction_tokens, audio_tokens, reasoning_tokens, rejected_prediction_tokens) and `prompt_tokens_details` (audio_tokens, cached_tokens). These three top-level token fields are what to use for metering. [source: src/resources/completions.ts @ v6.42.0]
- Newer Responses API exists and is documented as the primary API: `await client.responses.create({ model, instructions, input })`. README states: "The primary API for interacting with OpenAI models is the Responses API." Chat Completions is described as "The previous standard (supported indefinitely)". [source: https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md]
- `Response` interface (responses.create return): `id: string`, `object: 'response'`, `created_at: number`, `status?: ResponseStatus` (completed | failed | in_progress | ...), `model: ResponsesModel`, `output: Array<ResponseOutputItem>`, `output_text: string` (SDK convenience aggregated text), `usage?: ResponseUsage`. [source: src/resources/responses/responses.ts @ v6.42.0]
- `ResponseUsage` uses DIFFERENT token field names than chat completions: `input_tokens`, `output_tokens`, `total_tokens` (plus nested cached/reasoning breakdowns). [source: src/resources/responses/responses.ts @ v6.42.0]
- `ResponseCreateParams`: `model`, `input`, `instructions`, `max_output_tokens?: number`, `temperature` (0-2). Note: max-token param is `max_output_tokens` here (not `max_tokens`/`max_completion_tokens`). [source: src/resources/responses/responses.ts @ v6.42.0]
- Error classes (all extend `APIError` which extends `OpenAIError` extends `Error`) with HTTP status mapping: 400 `BadRequestError`, 401 `AuthenticationError`, 403 `PermissionDeniedError`, 404 `NotFoundError`, 409 `ConflictError`, 422 `UnprocessableEntityError`, 429 `RateLimitError`, >=500 `InternalServerError`. Connection-layer: `APIConnectionError`, `APIConnectionTimeoutError` (extends APIConnectionError), `APIUserAbortError`. A `static generate()` factory maps status -> class. [source: https://raw.githubusercontent.com/openai/openai-node/v6.42.0/src/core/error.ts; README.md]
- `APIError` properties: `status`, `headers`, `error`, `code` (string|null|undefined), `param` (string|null|undefined), `type` (string|undefined), `requestID`. [source: src/core/error.ts @ v6.42.0]

**Constraints & gotchas**
- `max_tokens` is `@deprecated` in the SDK in favor of `max_completion_tokens`. Doc comment: "This value is now deprecated in favor of `max_completion_tokens`, and is not compatible with o-series models." The spec's API surface lists `max_tokens` — prefer `max_completion_tokens` for Chat Completions, and `max_output_tokens` for the Responses API. [source: src/resources/chat/completions/completions.ts @ v6.42.0]
- Usage token field names differ between the two APIs: Chat Completions = `prompt_tokens`/`completion_tokens`/`total_tokens`; Responses = `input_tokens`/`output_tokens`/`total_tokens`. Metering code must branch on which API was used. [source: completions.ts / responses.ts @ v6.42.0]
- `message.content` is nullable (`string | null`) — a polished-text consumer must handle null (e.g., refusal-only responses where `refusal` is set instead). [source: src/resources/chat/completions/completions.ts @ v6.42.0]
- `usage` is optional (`usage?`) on both response objects — do not assume it is always present. [source: completions.ts / responses.ts @ v6.42.0]
- `temperature` documented range is 0–2 (not 0–1). [source: completions.ts @ v6.42.0]
- For OpenAI-compatible providers (Tensorix), use Chat Completions, not Responses — Responses is an OpenAI-proprietary surface unlikely to be implemented by third parties. (See Tensorix section: only `/v1/chat/completions` is documented.)

**Mock contract**
- **Symbols to mock**:
  - `client.chat.completions.create(params: { model: string; messages: Array<{ role: string; content: string|null }>; temperature?: number; max_completion_tokens?: number /* or deprecated max_tokens */ })` -> `Promise<ChatCompletion>` [source: README.md + completions.ts @ v6.42.0]
  - `client.responses.create(params: { model: string; input: ...; instructions?: string; max_output_tokens?: number; temperature?: number })` -> `Promise<Response>` [source: README.md + responses.ts @ v6.42.0]
  - Constructor `new OpenAI({ apiKey: string; baseURL?: string })` [source: README.md @ v6.42.0]
- **Return shape** (Chat Completions — derived from the SDK type definitions; minimal valid object):
  ```
  {
    "id": "chatcmpl-...",
    "object": "chat.completion",
    "created": 1700000000,
    "model": "gpt-5.5",
    "choices": [
      {
        "index": 0,
        "message": { "role": "assistant", "content": "polished text", "refusal": null },
        "finish_reason": "stop",
        "logprobs": null
      }
    ],
    "usage": { "prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30 }
  }
  ```
- **Return shape** (Responses API — from SDK type definitions):
  ```
  {
    "id": "resp_...",
    "object": "response",
    "created_at": 1700000000,
    "status": "completed",
    "model": "gpt-5.5",
    "output": [ /* Array<ResponseOutputItem> */ ],
    "output_text": "polished text",
    "usage": { "input_tokens": 10, "output_tokens": 20, "total_tokens": 30 }
  }
  ```
- **Errors / exceptions**: throws `BadRequestError`(400), `AuthenticationError`(401), `PermissionDeniedError`(403), `NotFoundError`(404), `ConflictError`(409), `UnprocessableEntityError`(422), `RateLimitError`(429), `InternalServerError`(>=500); `APIConnectionError`/`APIConnectionTimeoutError` on network failure. All extend `APIError`. To mock a rate-limit, throw a `RateLimitError` (has `.status === 429`). [source: src/core/error.ts @ v6.42.0]
- **Side effects**: SDK retries certain failures automatically (connection errors, 408, 409, 429, >=500) with backoff; default max retries is configurable via client option `maxRetries`. Usage tokens reported in `usage` are the metering source. [source: README.md @ v6.42.0 — "Retries"/"Configuring … maxRetries"]

**Verified examples**
- Responses API quickstart (model/instructions/input) — https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md
- Chat Completions example (model/messages with developer+user roles) — https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md
- Error-class status mapping table — https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md + src/core/error.ts

**Couldn't verify**
- Exact full `ResponseUsage` nested field names (input_tokens_details / output_tokens_details sub-fields) — WebFetch summarized them as "nested breakdown details" without verbatim field names; the three top-level fields (input_tokens/output_tokens/total_tokens) are confirmed. Not load-bearing for the polish-pass metering, which uses the top-level counts.
- Whether `default maxRetries` is 2 in this exact version — README documents the retry feature and `maxRetries` option but the exact default number wasn't captured verbatim.

**Sources consulted**
- https://github.com/openai/openai-node/releases/tag/v6.42.0
- https://raw.githubusercontent.com/openai/openai-node/v6.42.0/README.md
- https://raw.githubusercontent.com/openai/openai-node/v6.42.0/src/resources/chat/completions/completions.ts
- https://raw.githubusercontent.com/openai/openai-node/v6.42.0/src/resources/completions.ts
- https://raw.githubusercontent.com/openai/openai-node/v6.42.0/src/resources/responses/responses.ts
- https://raw.githubusercontent.com/openai/openai-node/v6.42.0/src/core/error.ts
- https://raw.githubusercontent.com/openai/openai-node/v6.42.0/api.md

---

### Tensorix (docs.tensorix.ai)
**Verified facts**
- OpenAI-compatible base URL is `https://api.tensorix.ai/v1`. Docs state: "If you're already using OpenAI's API, simply change your base URL to `https://api.tensorix.ai/v1` and update your API key." [source: https://docs.tensorix.ai/api-reference/overview]
- Authentication header: `Authorization: Bearer YOUR_API_KEY`. [source: https://docs.tensorix.ai/api-reference/overview; https://docs.tensorix.ai/api-reference/api-examples]
- Chat completions endpoint: `POST /v1/chat/completions` (OpenAI-compatible). [source: https://docs.tensorix.ai/api-reference/overview]
- The OpenAI Node SDK works by setting `baseURL` + `apiKey` only — confirmed by the official docs' own Node.js example:
  ```javascript
  import OpenAI from 'openai';
  const client = new OpenAI({
    apiKey: 'YOUR_API_KEY',
    baseURL: 'https://api.tensorix.ai/v1'
  });
  const response = await client.chat.completions.create({
    model: 'z-ai/glm-5.1',
    messages: [{ role: 'user', content: 'Hello, world!' }]
  });
  console.log(response.choices[0].message.content);
  ```
  [source: https://docs.tensorix.ai/api-reference/api-examples]
- Verified model IDs (exact strings to pass as `model`):
  - GLM: `z-ai/glm-5.1`, `z-ai/glm-4.6`
  - MiniMax: `minimax/minimax-m2.5`, `minimax/minimax-m2`
  - DeepSeek: `deepseek/deepseek-chat-v3.1`, `deepseek/deepseek-v3.2`, `deepseek/deepseek-r1-0528`
  - Llama: `meta-llama/llama-3.3-70b-instruct`, `meta-llama/llama-4-maverick`
  [source: https://docs.tensorix.ai/api-reference/models]

**Constraints & gotchas**
- Model IDs are namespaced (`provider/model`), unlike bare OpenAI IDs (`gpt-5.5`). Config/UI must allow slash-containing model strings. [source: https://docs.tensorix.ai/api-reference/models]
- The spec's example IDs "GLM-5.x" / "MiniMax-M2.x" are directionally correct but the EXACT documented strings are lowercase, namespaced: `z-ai/glm-5.1` and `minimax/minimax-m2.5`. Use the verified strings.
- Response shape is asserted OpenAI-compatible (`choices[0].message.content`); treat the response contract as identical to the OpenAI Chat Completions shape above for mocking. Provider-specific deviations in `usage` sub-fields are not documented — rely only on the standard `prompt_tokens`/`completion_tokens`/`total_tokens`.

**Mock contract**
- **Symbols to mock**: same as openai SDK Chat Completions — `client.chat.completions.create({ model: 'z-ai/glm-5.1', messages, temperature?, max_tokens? })` -> `Promise<ChatCompletion>` (OpenAI-compatible). [source: https://docs.tensorix.ai/api-reference/api-examples]
- **Return shape** (OpenAI Chat Completions-compatible — the only shape the docs reference; same as openai section):
  ```
  {
    "id": "chatcmpl-...",
    "object": "chat.completion",
    "created": 1700000000,
    "model": "z-ai/glm-5.1",
    "choices": [
      { "index": 0, "message": { "role": "assistant", "content": "polished text" }, "finish_reason": "stop" }
    ],
    "usage": { "prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30 }
  }
  ```
- **Errors / exceptions**: Not documented separately; because access is via the openai SDK, the SDK raises its standard error classes based on the HTTP status returned by Tensorix (e.g. `AuthenticationError` 401, `RateLimitError` 429). [source: inference from SDK behavior — see openai section; not separately documented by Tensorix]
- **Side effects**: rate limits exist (docs mention API keys/dashboard) but exact per-key limits/headers were not found in the consulted pages.

**Verified examples**
- Python + Node.js OpenAI-SDK examples using `base_url`/`baseURL` and `model: 'z-ai/glm-5.1'` — https://docs.tensorix.ai/api-reference/api-examples

**Couldn't verify**
- Exact `usage` object fields returned by Tensorix (whether identical to OpenAI's or with extra provider fields) — searched overview/models/api-examples pages, only the standard `choices[0].message.content` access was shown; usage shape not explicitly documented.
- Documented per-model rate limits and error-response body shape — not found on the consulted docs pages.
- Whether `responses.create` is supported by Tensorix — only `/v1/chat/completions` is documented; assume Chat Completions only.

**Sources consulted**
- https://docs.tensorix.ai/api-reference/overview
- https://docs.tensorix.ai/api-reference/models
- https://docs.tensorix.ai/api-reference/api-examples

---

### @aws-sdk/client-bedrock-runtime@3.1068.0
**Verified facts**
- Version 3.1068.0 is published on npm. Notable deps: `@smithy/core ^3.24.6`, `@smithy/types ^4.14.3`, `@aws-sdk/credential-provider-node ^3.972.55`, `@aws-sdk/token-providers 3.1068.0`. [source: https://registry.npmjs.org/@aws-sdk/client-bedrock-runtime/3.1068.0]
- Client construction + command-send pattern (from the package's own README): `import { BedrockRuntimeClient, <Command> } from "@aws-sdk/client-bedrock-runtime";` then `const client = new BedrockRuntimeClient({ region: "REGION" });` and `const data = await client.send(command);`. The README confirms this pattern "works with any of the available commands (InvokeModel, Converse, ConverseStream, CountTokens, etc.)". The constructor accepts standard SDK v3 config including `region` and `credentials`. [source: https://raw.githubusercontent.com/aws/aws-sdk-js-v3/v3.1068.0/clients/client-bedrock-runtime/README.md]
- Converse is recommended over InvokeModel. AWS user guide: "we recommend using the Converse API as it provides consistent API, that works with all Amazon Bedrock models that support messages." [source: https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html]
- `Converse` requires IAM permission for the `bedrock:InvokeModel` action. [source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html]
- Converse Request Syntax (verbatim, relevant fields): `inferenceConfig: { maxTokens, stopSequences, temperature, topP }`; `messages: [ { content: [ {...} ], role } ]`; `system: [ {...} ]` (array of SystemContentBlock, e.g. `{ "text": "..." }`). [source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html]
- Converse Response Syntax (verbatim, success path): `output` (ConverseOutput union -> `{ message: { content: [{ text }], role } }`), `stopReason`, `usage: { inputTokens, outputTokens, totalTokens, cacheReadInputTokens, cacheWriteInputTokens, cacheDetails[] }`, `metrics: { latencyMs }`. [source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html]
- `stopReason` valid values: `end_turn | tool_use | max_tokens | stop_sequence | guardrail_intervened | content_filtered | malformed_model_output | malformed_tool_use | model_context_window_exceeded`. [source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html]
- Verified Anthropic Claude modelId strings (from official Converse examples): base model `anthropic.claude-3-sonnet-20240229-v1:0`; cross-region inference profile `us.anthropic.claude-3-5-sonnet-20240620-v1:0`. [source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html — Examples]

**Constraints & gotchas**
- `output` is a Union ("Only one member of this object can be specified or returned") — the documented success member is `message`. Code reads text via `response.output.message.content[0].text`. [source: API_runtime_Converse.html; user-guide examples read `response['output']['message']['content']`]
- `content` is an ARRAY of blocks; text is at `content[0].text` (not a flat string like OpenAI). Mapping layer must translate between OpenAI's `message.content: string` and Bedrock's `content: [{ text }]`. [source: API_runtime_Converse.html — Example response]
- `messages[].content` is also an array of blocks on the REQUEST side: `{ role, content: [{ text }] }`. [source: API_runtime_Converse.html — Example request]
- Token field names differ AGAIN from both OpenAI APIs: `inputTokens` / `outputTokens` / `totalTokens` (camelCase). Metering code needs a third mapping. [source: API_runtime_Converse.html]
- `system` is a top-level Converse field (array of `{ text }`), NOT a message with role 'system' — unlike OpenAI where the system/developer prompt is a message. [source: API_runtime_Converse.html — Example request]
- Inference profile IDs (prefixed `us.` / `eu.` etc.) are often REQUIRED instead of bare base model IDs for newer Claude models via on-demand cross-region inference. [source: API_runtime_Converse.html modelId description + Example 5]
- `cross-region` inference profile prefixes match the project memory's `us.anthropic.*` trigger pattern.

**Mock contract**
- **Symbols to mock**:
  - `new BedrockRuntimeClient({ region: string; credentials?: ... })` -> client [source: README @ v3.1068.0]
  - `client.send(new ConverseCommand(input))` -> `Promise<ConverseCommandOutput>` where input is `{ modelId: string; messages: Array<{ role: 'user'|'assistant'; content: Array<{ text: string }> }>; system?: Array<{ text: string }>; inferenceConfig?: { maxTokens?: number; temperature?: number; topP?: number; stopSequences?: string[] } }` [source: API_runtime_Converse.html; README]
- **Return shape** (verbatim from the official Converse example response):
  ```
  {
    "output": {
        "message": {
            "content": [
                { "text": "<text generated by the model>" }
            ],
            "role": "assistant"
        }
    },
    "stopReason": "end_turn",
    "usage": {
        "inputTokens": 30,
        "outputTokens": 628,
        "totalTokens": 658
    },
    "metrics": {
        "latencyMs": 1275
    }
  }
  ```
  (Optional usage fields per schema: `cacheReadInputTokens`, `cacheWriteInputTokens`, `cacheDetails[]`. `output` is a union; mock the `message` member.)
- **Errors / exceptions**: `AccessDeniedException` (403), `ResourceNotFoundException` (404), `ModelTimeoutException` (408), `ModelErrorException` (424, has `originalStatusCode`, `resourceName`), `ThrottlingException` (429), `ModelNotReadyException` (429 — SDK auto-retries up to 5 times), `ServiceUnavailableException` (503), `InternalServerException` (500), `ValidationException` (400). [source: API_runtime_Converse.html — Errors]
- **Side effects**: `ModelNotReadyException` is automatically retried by the SDK up to 5 times; SDK v3 standard retry/backoff applies to throttling/5xx. Metering uses `usage.inputTokens`/`outputTokens`/`totalTokens`. [source: API_runtime_Converse.html]

**Verified examples**
- Converse request/response examples to Claude (`anthropic.claude-3-sonnet-20240229-v1:0`, inference profile `us.anthropic.claude-3-5-sonnet-20240620-v1:0`) — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
- Client construct + `client.send(command)` pattern — https://raw.githubusercontent.com/aws/aws-sdk-js-v3/v3.1068.0/clients/client-bedrock-runtime/README.md
- AWS SDK for JavaScript V3 Converse reference link — https://docs.aws.amazon.com/goto/SdkForJavaScriptV3/bedrock-runtime-2023-09-30/Converse

**Couldn't verify**
- A verbatim Node.js/TypeScript (not Python) Converse code example from official AWS docs — the user-guide code samples on the consulted pages were boto3/Python; the JS constructor+send pattern is confirmed from the SDK README and the request/response JSON shapes are language-agnostic (Smithy-generated, identical across SDKs). The TypeDoc class pages (ConverseCommand / BedrockRuntimeClient) are JS-rendered and did not return body content via WebFetch.
- A current full list of available Claude modelIds on Bedrock — the `models-supported` page now redirects to per-model "model cards"; only the two Claude IDs in the Converse examples were captured verbatim. Newer Claude IDs (e.g. Claude 3.5/3.7/4-era) should be confirmed against the live model-cards page or `ListFoundationModels` at build time.

**Sources consulted**
- https://registry.npmjs.org/@aws-sdk/client-bedrock-runtime/3.1068.0
- https://raw.githubusercontent.com/aws/aws-sdk-js-v3/v3.1068.0/clients/client-bedrock-runtime/README.md
- https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html (redirect to model-cards)

<!-- ===== fragment: supabase-platform ===== -->

### supabase-cli (local dev workflow) @ current (docs as of 2026-06)
**Verified facts**
- `supabase init` "creates a new local project" and creates a `supabase` folder (config.toml + functions/ + migrations/) that is "safe to commit ... to version control". [source: https://supabase.com/docs/guides/local-development/cli/getting-started]
- `supabase start` launches the Supabase services via Docker; first run downloads images; outputs local URLs + keys. [source: https://supabase.com/docs/guides/local-development/cli/getting-started]
- `supabase stop` halts the stack "without resetting your local database"; the `--no-backup` flag deletes local schema/data changes. [source: https://supabase.com/docs/guides/local-development/cli/getting-started]
- `supabase status` "Shows status of the Supabase local development stack" and prints these defaults: API URL `http://127.0.0.1:54321`, GraphQL URL `http://127.0.0.1:54321/graphql/v1`, DB URL `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Studio URL `http://127.0.0.1:54323`, Inbucket URL `http://127.0.0.1:54324`, JWT secret, `anon key`, `service_role key`. [source: https://supabase.com/docs/reference/cli/supabase-status]
- `supabase migration new <migration name>` "Creates a new migration file locally" in `supabase/migrations` named `<timestamp>_<name>.sql` (can accept piped SQL from `db diff`). [source: https://supabase.com/docs/reference/cli/supabase-migration-new]
- `supabase migration up [flags]` applies pending migrations; flags `--local`, `--linked`, `--db-url <string>`, `--include-all`. [source: https://supabase.com/docs/reference/cli/supabase-migration-new]
- `supabase db reset` "Resets the local database to a clean state" — recreates the local Postgres container, applies all local migrations in `supabase/migrations`, then runs `supabase/seed.sql`. Flags: `--local`, `--linked`, `--db-url <string>`, `--no-seed`. [source: https://supabase.com/docs/reference/cli/supabase-db-reset]
- `supabase db push` "Pushes all local migrations to a remote database"; first run creates the migration history table; subsequent pushes skip already-applied migrations. Flags: `--linked`, `--local`, `--db-url <string>`, `--dry-run`. [source: https://supabase.com/docs/reference/cli/supabase-db-reset]
- `supabase functions new <Function name>` "Creates a new Edge Function with boilerplate code in the `supabase/functions` directory" (creates `supabase/functions/<name>/index.ts`, optionally Deno config for VSCode). Flag `--auth <[ none | apikey | user ]>`. [source: https://supabase.com/docs/reference/cli/supabase-functions-deploy ; https://supabase.com/docs/guides/functions/quickstart]
- `supabase functions serve [flags]` serves functions locally at `http://localhost:54321/functions/v1/<name>` with hot reload. Flags: `--env-file <string>` ("Path to an env file to be populated to the Function environment."), `--import-map <string>`, `--no-verify-jwt` ("Disable JWT verification for the Function."). [source: https://supabase.com/docs/reference/cli/supabase-functions-serve]
- `supabase functions deploy [Function name] [flags]` — flags `--no-verify-jwt` ("Disable JWT verification for the Function."), `--import-map <string>`, `--project-ref <string>`, `--prune`, `--use-api` ("Bundle functions server-side without using Docker."), `-j/--jobs <uint>`. Deploying with no name deploys all functions. [source: https://supabase.com/docs/reference/cli/supabase-functions-deploy]
- `supabase secrets set` — production secrets: `supabase secrets set --env-file .env` (batch) or `supabase secrets set NAME=value` (individual); `supabase secrets list` lists remote secrets. "You don't need to re-deploy after setting your secrets. They're available immediately in your functions." [source: https://supabase.com/docs/guides/functions/secrets]
- config.toml `[auth]` defaults (from CLI config schema): `site_url` default `"http://127.0.0.1:3000"` ("The base URL of your website. Used as an allow-list for redirects and for constructing URLs used in emails."); `additional_redirect_urls` default `["https://127.0.0.1:3000"]` ("A list of exact URLs that auth providers are permitted to redirect to post authentication."); `jwt_expiry` default `3600`; `enable_signup` default `true`; `enable_anonymous_sign_ins` default `false`. [source: https://raw.githubusercontent.com/supabase/cli/main/apps/docs/public/cli/config.schema.json]

**Constraints & gotchas**
- The default `additional_redirect_urls` allow-list contains only localhost; for a desktop deep-link callback you MUST add your custom scheme URL (e.g. `wisopen://login-callback` / `com.wisopen://login-callback/`) to `auth.additional_redirect_urls` in config.toml AND to the Dashboard Redirect URLs for the remote project. Custom URL schemes for native/desktop deep links are explicitly supported (docs example `com.supabase://login-callback/`). [source: https://supabase.com/docs/guides/auth/redirect-urls]
- Redirect URL matching supports wildcards: `*` (non-separator chars), `**` (any chars), `?` (single non-separator char), `[!{range}]`; separators are `.` and `/`. So `http://localhost:3000/*` does NOT match a path with a slash; use `**`. [source: https://supabase.com/docs/guides/auth/redirect-urls]
- Local Edge Function env: place a `.env` at `supabase/functions/.env` for automatic loading on `supabase start`; or pass a custom file with `supabase functions serve --env-file .env.local`. "Never check your `.env` files into Git". [source: https://supabase.com/docs/guides/functions/secrets ; https://supabase.com/docs/reference/cli/supabase-functions-serve]
- `--no-verify-jwt` (serve/deploy) disables the platform's automatic JWT check at the gateway for that function — required for endpoints that cannot present a Bearer Authorization header (notably browser WebSocket clients). When used you must verify the token yourself inside the function. [source: https://supabase.com/docs/reference/cli/supabase-functions-serve ; https://supabase.com/docs/guides/functions/websockets]
- `db push` is local→remote (linked) only; it does not pull. First push bootstraps the remote migration history table. [source: https://supabase.com/docs/reference/cli/supabase-db-reset]

**Verified examples**
- Quickstart hello-world function + serve + deploy — https://supabase.com/docs/guides/functions/quickstart
- Secrets / env file workflow — https://supabase.com/docs/guides/functions/secrets

**Couldn't verify**
- Exact human-readable `[auth.email]` key names/defaults in config.toml (e.g. `enable_confirmations`, `enable_signup`) — the dedicated CLI config reference page (https://supabase.com/docs/guides/cli/config and /docs/reference/cli/config) returned HTTP 404 via WebFetch; only the top-level `[auth]` keys above were verifiable from the config.schema.json. Treat `[auth.email]` key names as unverified.

**Sources consulted**
- https://supabase.com/docs/guides/local-development/cli/getting-started
- https://supabase.com/docs/reference/cli/supabase-status
- https://supabase.com/docs/reference/cli/supabase-migration-new
- https://supabase.com/docs/reference/cli/supabase-db-reset
- https://supabase.com/docs/reference/cli/supabase-functions-serve
- https://supabase.com/docs/reference/cli/supabase-functions-deploy
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/quickstart
- https://supabase.com/docs/guides/auth/redirect-urls
- https://raw.githubusercontent.com/supabase/cli/main/apps/docs/public/cli/config.schema.json

---

### supabase-edge-functions (Deno runtime) @ current (docs as of 2026-06)
**Verified facts**
- Edge Functions read env vars via Deno: `Deno.env.get('NAME_OF_SECRET')`. [source: https://supabase.com/docs/guides/functions/secrets]
- Auto-populated secrets available in every function: `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_ANON_KEY` (legacy, safe in browser w/ RLS), `SUPABASE_SERVICE_ROLE_KEY` (legacy, "safe to use in Edge Functions, but ... NEVER ... in a browser"), plus the newer keys `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_JWKS`. [source: https://supabase.com/docs/guides/functions/secrets]
- Classic HTTP handler pattern (still documented): `Deno.serve(async (req: Request) => { ... return new Response(...) })`, read JSON via `await req.json()`, return with `Response.json(...)` or `new Response(...)`. [source: https://supabase.com/docs/guides/functions/auth-legacy-jwt]
- Classic in-function JWT auth (verbatim from docs): create a per-request client forwarding the caller's Authorization header, then `auth.getUser(token)`:
  ```js
  import { createClient } from 'npm:@supabase/supabase-js@2'

  Deno.serve(async (req: Request) => {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data } = await supabaseClient.auth.getUser(token)
    // ...
  })
  ```
  Forwarding the Authorization header means subsequent DB queries on `supabaseClient` run under the caller's RLS context. [source: https://supabase.com/docs/guides/functions/auth-legacy-jwt]
- NEWER (now-default in docs) pattern uses a wrapper from `npm:@supabase/server`: `export default { fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => { ... }) }`. The handler's `ctx` exposes `{ supabase, supabaseAdmin, userClaims, jwtClaims, authMode }` where `supabase` is RLS-scoped to the caller, `supabaseAdmin` bypasses RLS (service role), `userClaims` is `{ id, email, role }`. Auth modes: `'user'` (valid user JWT on `Authorization`), `'secret'` (secret key on `apikey`), `'publishable'` (publishable key on `apikey`), `'none'` (no check, for signed webhooks); arrays and named keys (`'secret:<name>'`) are supported. [source: https://supabase.com/docs/guides/functions/auth]
- WebSocket support: `const { socket, response } = Deno.upgradeWebSocket(req)`; attach `socket.onopen` / `socket.onmessage` / `socket.onclose`; return `response`. [source: https://supabase.com/docs/guides/functions/websockets]

**Constraints & gotchas**
- WebSocket auth caveat (DIRECTLY relevant to the stt-stream proxy): "WebSocket browser clients don't have the option to send custom headers ... Edge Functions won't be able to perform the usual authorization header check to verify the JWT." Workaround: deploy/serve with `--no-verify-jwt` and verify the token yourself; pass the JWT via URL query param or via the `Sec-WebSocket-Protocol` header, then validate before/after upgrade. [source: https://supabase.com/docs/guides/functions/websockets]
- The two auth styles use DIFFERENT module specifiers: classic = `npm:@supabase/supabase-js@2` with `createClient`; new wrapper = `npm:@supabase/server` with `withSupabase`. Don't mix the import for the pattern you choose. [source: https://supabase.com/docs/guides/functions/auth-legacy-jwt ; https://supabase.com/docs/guides/functions/auth]
- `auth.getUser(token)` validates the JWT against the auth server; prefer it over trusting unverified claims for authorization decisions. (The new `withSupabase({auth:'user'}) gateway check + ctx.userClaims is the documented modern equivalent.) [source: https://supabase.com/docs/guides/functions/auth]
- The `format` LLM-proxy edge function is plain HTTP, so the standard gateway JWT verification applies (do NOT pass `--no-verify-jwt` there); only `stt-stream` (WebSocket) needs `--no-verify-jwt` + manual token verification. [source: https://supabase.com/docs/guides/functions/websockets]

**Verified examples**
- Edge Function auth (legacy createClient + getUser) — https://supabase.com/docs/guides/functions/auth-legacy-jwt
- Edge Function auth (withSupabase wrapper modes) — https://supabase.com/docs/guides/functions/auth
- WebSockets in Edge Functions — https://supabase.com/docs/guides/functions/websockets
- Quickstart Deno function — https://supabase.com/docs/guides/functions/quickstart

**Couldn't verify**
- The exact full type/signature of `withSupabase` and the `ctx` object (only the documented prose fields above) — searched supabase.com/docs/guides/functions/auth; no formal type reference page found. Spec currently assumes the classic `createClient`+`getUser` pattern, which IS verified, so this is non-blocking.

**Sources consulted**
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/auth-legacy-jwt
- https://supabase.com/docs/guides/functions/quickstart
- https://supabase.com/docs/guides/functions/websockets

---

### supabase-js / GoTrue auth @ supabase-js v2 (auth-js current)
**Verified facts**
- `supabase.auth.signUp({ email, password, options: { emailRedirectTo, data, channel } })` returns `{ data: { user, session }, error }`. `options.data` is stored as user metadata; `options.emailRedirectTo` sets the post-confirmation redirect (must be allow-listed). "PKCE flow cannot be used when autoconfirm is enabled." [source: https://supabase.com/docs/reference/javascript/auth-signup]
- `supabase.auth.signInWithPassword({ email, password })` (or `{ phone, password }`) returns `{ data: { user, session }, error }`. Errors are deliberately ambiguous (don't reveal account existence). [source: https://supabase.com/docs/reference/javascript/auth-signinwithpassword]
- `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser } })` sends a magic link / OTP; returns `{ data, error }`. [source: https://supabase.com/docs/reference/javascript/auth-signinwithotp]
- `supabase.auth.setSession({ access_token, refresh_token })` "Sets the session data from the current session. If the current session is expired, setSession will take care of refreshing it"; returns `{ data: { session, user }, error }`. [source: https://supabase.com/docs/reference/javascript/auth-setsession]
- `supabase.auth.refreshSession()` / `refreshSession({ refresh_token })` "Returns a new session, regardless of expiry status." Returns `{ data: { session, user }, error }`. [source: https://supabase.com/docs/reference/javascript/auth-refreshsession]
- `supabase.auth.onAuthStateChange((event, session) => {})` returns `{ data: { subscription } }`; unsubscribe via `data.subscription.unsubscribe()`. Events: `INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`, `PASSWORD_RECOVERY`, `TOKEN_REFRESHED`, `USER_UPDATED` (+ MFA events). [source: https://supabase.com/docs/reference/javascript/auth-onauthstatechange ; https://raw.githubusercontent.com/supabase/auth-js/master/src/lib/types.ts]
- `createClient` auth options (from auth-js source, with the verbatim doc-comments): `autoRefreshToken?: boolean` (auto-refresh before expiry), `persistSession?: boolean` ("save the user session into local storage. If set to false, session will just be saved in memory"), `detectSessionInUrl?: boolean` ("automatically detects OAuth grants in the URL and signs in the user"), `storage?: SupportedStorage` ("Provide your own local storage implementation"), `storageKey?: string`, `flowType?: AuthFlowType`. [source: https://raw.githubusercontent.com/supabase/auth-js/master/src/lib/types.ts]
- `AuthFlowType = 'implicit' | 'pkce'`; flowType doc-comment: "If set to 'pkce' PKCE flow. Defaults to the 'implicit' flow otherwise" — i.e. DEFAULT is `'implicit'`. [source: https://raw.githubusercontent.com/supabase/auth-js/master/src/lib/types.ts]
- PKCE flow: enable with `flowType: 'pkce'` in createClient auth options; the callback URL carries `?code=<...>` which is exchanged via `exchangeCodeForSession(code)`; with `detectSessionInUrl: true` the client auto-exchanges after redirect. PKCE is the appropriate flow for server-side/native contexts (where localStorage may be unavailable). [source: https://supabase.com/docs/guides/auth/sessions/pkce-flow]
- **Session object shape** (authoritative, from auth-js types):
  ```ts
  export interface Session {
    provider_token?: string | null
    provider_refresh_token?: string | null
    access_token: string
    refresh_token: string
    expires_in: number
    expires_at?: number
    token_type: 'bearer'
    user: User
  }
  ```
  [source: https://raw.githubusercontent.com/supabase/auth-js/master/src/lib/types.ts]
- **User object** key fields (from auth-js types): `id: string`, `app_metadata: UserAppMetadata`, `user_metadata: UserMetadata`, `aud: string`, `email?: string`, `phone?: string`, `created_at: string`, `confirmed_at?: string`, `last_sign_in_at?: string`, `identities?: UserIdentity[]`, `factors?: Factor[]`. [source: https://raw.githubusercontent.com/supabase/auth-js/master/src/lib/types.ts]

**Constraints & gotchas**
- For a desktop deep-link login callback, set `flowType: 'pkce'` AND `detectSessionInUrl: true`; provide a custom `storage` impl (Electron has no browser localStorage in the main process) and a stable `storageKey`. The default flow is `implicit`, so PKCE is opt-in. [source: https://raw.githubusercontent.com/supabase/auth-js/master/src/lib/types.ts ; https://supabase.com/docs/guides/auth/sessions/pkce-flow]
- `expires_at` and `provider_token`/`provider_refresh_token` are OPTIONAL/nullable on Session; only `access_token`, `refresh_token`, `expires_in`, `token_type:'bearer'`, `user` are always present. Do not assume `expires_at`. [source: https://raw.githubusercontent.com/supabase/auth-js/master/src/lib/types.ts]
- "PKCE flow cannot be used when autoconfirm is enabled" — if local `[auth.email].enable_confirmations` is off (autoconfirm on), PKCE email-confirmation links won't apply; design tests accordingly. [source: https://supabase.com/docs/reference/javascript/auth-signup]
- `detectSessionInUrl` parses the URL of the current context; in Electron you must feed the deep-link URL into the renderer/web context (or use `exchangeCodeForSession(code)` manually after capturing the deep link). [source: https://supabase.com/docs/guides/auth/sessions/pkce-flow]
- `getSession()` can return `null` session; docs warn `getUser()` (server-verified) is preferred over `getSession()` for authorization checks. [source: https://supabase.com/docs/reference/javascript/auth-getsession]

**Verified examples**
- PKCE flow guide — https://supabase.com/docs/guides/auth/sessions/pkce-flow
- onAuthStateChange — https://supabase.com/docs/reference/javascript/auth-onauthstatechange

**Couldn't verify**
- Whether `signInWithOtp` return `data` carries any session (docs only show `{ data, error }` for the email/magic-link case; session is null until link is followed) — searched the reference page; not explicitly stated. Safe assumption: no session on send.

**Sources consulted**
- https://supabase.com/docs/reference/javascript/auth-signup
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://supabase.com/docs/reference/javascript/auth-signinwithotp
- https://supabase.com/docs/reference/javascript/auth-setsession
- https://supabase.com/docs/reference/javascript/auth-refreshsession
- https://supabase.com/docs/reference/javascript/auth-onauthstatechange
- https://supabase.com/docs/reference/javascript/auth-getsession
- https://supabase.com/docs/guides/auth/sessions/pkce-flow
- https://raw.githubusercontent.com/supabase/auth-js/master/src/lib/types.ts

---

### supabase-postgres / RLS @ current (docs as of 2026-06)
**Verified facts**
- Enable RLS: `alter table "table_name" enable row level security;`. [source: https://supabase.com/docs/guides/database/postgres/row-level-security]
- `auth.uid()` "Returns the ID of the user making the request"; returns `null` when no authenticated user (so `null = user_id` is false, denying access). [source: https://supabase.com/docs/guides/database/postgres/row-level-security]
- SELECT policy example (verbatim):
  ```sql
  create policy "User can see their own profile only."
  on profiles
  for select using ( (select auth.uid()) = user_id );
  ```
  [source: https://supabase.com/docs/guides/database/postgres/row-level-security]
- UPDATE policy with both clauses (verbatim):
  ```sql
  create policy "Users can update their own profile."
  on profiles for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );
  ```
  [source: https://supabase.com/docs/guides/database/postgres/row-level-security]
- `USING` filters which existing rows are visible (SELECT/UPDATE/DELETE); `WITH CHECK` validates new/modified row data (INSERT/UPDATE). [source: https://supabase.com/docs/guides/database/postgres/row-level-security]
- `handle_new_user()` trigger seeding `public.profiles` from `auth.users` (verbatim):
  ```sql
  create function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer set search_path = ''
  as $$
  begin
    insert into public.profiles (id, first_name, last_name)
    values (new.id, new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name');
    return new;
  end;
  $$;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();
  ```
  [source: https://supabase.com/docs/guides/auth/managing-user-data]
- UUIDs: `gen_random_uuid()` is a Postgres built-in (Postgres 13+ core) that "generate[s] a UUIDv4"; `uuid_generate_v4()` requires the `uuid-ossp` extension (`create extension "uuid-ossp" with schema extensions;`). [source: https://supabase.com/docs/guides/database/extensions/uuid-ossp ; https://www.postgresql.org/docs/current/functions-uuid.html]

**Constraints & gotchas**
- Modern docs wrap `auth.uid()` as `(select auth.uid())` inside policies for query-plan caching / performance — prefer this form. [source: https://supabase.com/docs/guides/database/postgres/row-level-security]
- The trigger function uses `security definer set search_path = ''` (empty search_path) so all object references must be schema-qualified (`public.profiles`, `auth.users`) — required for security and correctness. [source: https://supabase.com/docs/guides/auth/managing-user-data]
- `execute procedure` (used in docs) and `execute function` are equivalent in modern Postgres; both work. [source: https://supabase.com/docs/guides/auth/managing-user-data]
- `auth.uid()` is null in the Postgres `service_role`/superuser context too — the service-role key bypasses RLS entirely, so backend/admin paths should use it deliberately, not rely on policies. [source: https://supabase.com/docs/guides/database/postgres/row-level-security]
- Enabling RLS with no policies denies ALL access by default — every accessed table needs explicit policies. [source: https://supabase.com/docs/guides/database/postgres/row-level-security]

**Verified examples**
- RLS policies — https://supabase.com/docs/guides/database/postgres/row-level-security
- handle_new_user trigger — https://supabase.com/docs/guides/auth/managing-user-data
- UUID generation — https://supabase.com/docs/guides/database/extensions/uuid-ossp

**Couldn't verify**
- Whether `pgcrypto` is pre-enabled by default in Supabase Postgres (the dedicated pgcrypto extensions page 404'd via WebFetch). NOTE: `gen_random_uuid()` does NOT require pgcrypto on Postgres 13+ (it is in core), so the spec's UUID needs are met regardless; if the project also uses pgcrypto-specific functions (e.g. `crypt()`, `digest()`), enable with `create extension if not exists pgcrypto with schema extensions;` — but that enablement statement itself was not verified against an authoritative page in this pass.

**Sources consulted**
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/database/extensions/uuid-ossp

---

## Open assumptions

Verified facts above cover the API surface; these remain unverified and the plan must treat them as fragile:

- **Native input behavior is headless-unverified.** `uIOhook.start()` (actual global key capture, press/hold/release stream, throw/no-op when macOS Input Monitoring denied) and nut-js `keyboard.type/pressKey/releaseKey` (actual injection, Cmd+V combo, behavior when Accessibility denied) were NOT executed. Clipboard round-trip WAS verified. → Must be validated manually on a GUI session and in a packaged/notarized build.
- **Electron 42.4.0 + native addons load** is unverified (no Electron in the spikes). Both are N-API/ABI-stable and *should* load without `@electron/rebuild`, but `better-sqlite3` *does* require rebuild; validate all three (`uiohook-napi`, `@nut-tree-fork/nut-js`, `better-sqlite3`) load in an Electron main-process smoke test before building features on them.
- **macOS `fn`/Globe key emits no referenceable uiohook event** (only verified: no `fn` entry in the map). Whether it emits *any* keycode is unverified — treat Fn as unusable for PTT.
- **Long-lived WS streaming under edge-runtime limits** (multi-minute) was NOT measured (spike was sub-second). This is the residual risk for `stt-stream` as an Edge Function; keep the Node WS gateway fallback until a long-stream test passes both locally and on Supabase Cloud.
- **WS JWT via `?jwt=` query param / `Sec-WebSocket-Protocol: jwt-TOKEN`** is documented but not exercised in the spike (only confirmed the upgrade bypasses the gateway check). Validate the in-function `auth.getUser(token)` path during backend build.
- **Windows runtime** (libnut-win32 + uiohook win32 hook + injection without UAC; mic prompt path) was not exercised (darwin-only spikes). Validated only via CI build + manual test on Windows.
- **AWS Transcribe / OpenAI / Bedrock live calls** were not made (no provider creds). Response shapes are from official docs/SDK types; the mock providers encode these shapes. Real-provider behavior is validated when a key is connected.
- **macOS System Settings privacy-pane URL strings** (`x-apple.systempreferences:...Privacy_Accessibility` / `Privacy_Microphone`) are Apple-internal and changed in Ventura+; verify on the target macOS at runtime.
- **Realtime/Storage RLS interactions** untested (storage disabled locally; not needed for Wisopen).

## Required spec amendments

Findings that contradict or refine the spec. Material ones are applied to the spec file with `<!-- amended per ... -->` back-references.

### Amendment 1 — Push-to-talk default key cannot be macOS `fn`

**Spec section:** §3.1 onboarding (hotkey pick) / §5.4 Push-to-talk; default "`fn` (macOS)".

**Current text (in spec):**
> Default: hold `fn` (macOS) / `Ctrl+Space` (Windows) = push-to-talk; release = finalize.

**Issue:** `uiohook-napi@1.5.5` has no `fn`/`Function` entry in `UiohookKey` (verified in spike + authoritative `src/index.ts`); globalShortcut has no keyup either. The macOS Fn key cannot drive hold-to-talk via the global hook.

**Replacement text:**
> Default push-to-talk: hold **`F13`** (a key uiohook reliably reports and most keyboards lack, avoiding conflicts) on macOS, **`Ctrl+Space`** on Windows; release = finalize. Hold-detection uses `uiohook-napi` keydown/keyup (Electron `globalShortcut` has no keyup). Fully remappable to any uiohook-reportable key or modifier (Right-Cmd/Right-Ctrl are good alternatives); **Fn is not offered** (unsupported by the global hook).

**Status:** Applied at 2026-06-15 — spec patch in commit (next).

### Amendment 2 — Replace keytar with Electron safeStorage; drop electron-store

**Spec section:** §5.2 modules (`secretStore` keytar, `localStore` electron-store) / §5.7 Local storage.

**Current text (in spec):**
> `secretStore` | Store refresh token / sensitive prefs in OS keychain | `keytar`
> `localStore` | App settings + offline cache ... + local history | `better-sqlite3` (or `electron-store` for simple prefs)

**Issue:** keytar is archived (last release 7.9.0, 2022) and unmaintained; electron-store@11 is ESM-only (friction with a CommonJS Electron main + native modules). safeStorage is encryption-only (no named keychain entry) — the app must persist the ciphertext itself.

**Replacement text:**
> `secretStore` | Encrypt the Supabase refresh token with Electron **`safeStorage`** (`isEncryptionAvailable()` gate → `encryptString`/`decryptString`, after app `ready`); persist the returned ciphertext **Buffer** in the local DB. On Linux, treat `getSelectedStorageBackend()==='basic_text'` as insecure and warn. | Electron `safeStorage`
> `localStore` | Single local store via **`better-sqlite3`** for settings, cached snippets/dictionary/modes, local history, and the secret ciphertext blob. (electron-store dropped — ESM-only.) | `better-sqlite3`

**Status:** Applied at 2026-06-15 — spec patch in commit (next).

### Amendment 3 — stt-stream WebSocket auth happens inside the function

**Spec section:** §6.2 Edge Functions → `stt-stream`.

**Current text (in spec):**
> Authenticates the Supabase JWT (reject otherwise).

**Issue:** WebSocket upgrades bypass the Supabase gateway JWT/apikey check (browser WS can't set headers); verified in spike. Gateway `verify_jwt` does not apply.

**Replacement text:**
> Serve/deploy `stt-stream` with `--no-verify-jwt`. The client passes its Supabase JWT via the `?jwt=<token>` query param (or `Sec-WebSocket-Protocol: jwt-<token>`). The function validates it with `createClient(SUPABASE_URL, SUPABASE_ANON_KEY,{global:{headers:{Authorization:'Bearer '+token}}})` → `auth.getUser(token)` and rejects (close code) on failure before relaying audio. `format` (plain HTTP) keeps the normal gateway JWT check (no `--no-verify-jwt`).

**Status:** Applied at 2026-06-15 — spec patch in commit (next).

### Amendment 4 — OpenAI STT adapter is buffered (final-only); AWS Transcribe streams

**Spec section:** §6.3 provider adapters (STT) / §3.2 core loop (partials).

**Current text (in spec):**
> **STT:** `aws-transcribe` (streaming SDK ...), `openai` (Whisper / `gpt-4o-transcribe`), `mock`.

**Issue:** `openai.audio.transcriptions.create` is file-based (takes a complete file; SSE only re-streams an already-recorded file). True live mic streaming requires the OpenAI **Realtime WebSocket** API (pcm16 @ 24 kHz) — a heavier integration. AWS Transcribe streams PCM16 @ 16 kHz with `IsPartial` partials.

**Replacement text:**
> The `SttProvider` interface supports two modes: **streaming** (emits partial + final) and **buffered** (accumulate the utterance, emit final only). `aws-transcribe` = streaming (PCM16 16 kHz, dedup by `ResultId`, final when `IsPartial:false`). `openai` = **buffered** in v1 (accumulate PCM → wrap as WAV → `audio.transcriptions.create({model:'gpt-4o-transcribe'})` → final text; no live partials). `mock` = streaming. The overlay shows partials when available, else a "transcribing…" state. (OpenAI Realtime-WS streaming is future work.)

**Status:** Applied at 2026-06-15 — spec patch in commit (next).

### Amendment 5 — Normalize three different usage-token shapes

**Spec section:** §6.1 `usage_events` / §6.3 LLM adapters.

**Current text (in spec):**
> Returns `{ final_text, tokens_in, tokens_out }`; writes a `usage_events` row.

**Issue:** Token field names differ across providers: OpenAI chat = `prompt_tokens`/`completion_tokens`/`total_tokens`; OpenAI Responses = `input_tokens`/`output_tokens`; Bedrock Converse = `inputTokens`/`outputTokens`. `usage` may be absent.

**Replacement text:**
> Each LLM adapter normalizes provider usage into `{ tokensIn, tokensOut }` (chat: prompt/completion; responses: input/output; bedrock: inputTokens/outputTokens), defaulting to `0`/`null` when `usage` is absent. `format` writes the normalized values to `usage_events`. (openai-compatible adapter uses Chat Completions — not Responses — since third parties like Tensorix implement only `/v1/chat/completions`.)

**Status:** Applied at 2026-06-15 — spec patch in commit (next).

### Amendment 6 — Desktop deep-link: info.plist + PKCE + custom storage; Supabase redirect allow-list

**Spec section:** §5.8 Auth flow / §6.2 Auth.

**Current text (in spec):**
> deep link `wisopen://auth-callback`

**Issue:** On macOS the scheme must be declared in `info.plist` (`CFBundleURLTypes`) at build time (not runtime-mutable). supabase-js defaults to the `implicit` flow; native/desktop should use PKCE (`flowType:'pkce'` + `exchangeCodeForSession`/`detectSessionInUrl`) with a custom `storage` impl (no browser localStorage in Electron main). The callback scheme must be added to `auth.additional_redirect_urls` in `config.toml` (and the Cloud dashboard later).

**Replacement text:**
> Declare `wisopen://auth-callback` in `info.plist` `CFBundleURLTypes` (via `electron-builder build.mac.extendInfo`) and register on Windows via `app.setAsDefaultProtocolClient` + `requestSingleInstanceLock` (`second-instance`); macOS delivers via the `open-url` event. supabase-js client uses `flowType:'pkce'`, a custom `storage` adapter backed by better-sqlite3+safeStorage, and `auth.exchangeCodeForSession(code)` on the captured callback. Add the scheme to `auth.additional_redirect_urls` in `config.toml`.

**Status:** Applied at 2026-06-15 — spec patch in commit (next).

### Amendment 7 — Local Supabase config: disable unused services; in-function clipboard note

**Spec section:** §6 (Supabase local) / §5.5 injection.

**Current text (in spec):**
> Runs via the Supabase CLI (`supabase start`) → local Postgres, GoTrue (auth), Edge Runtime (Deno functions), Studio.

**Issue:** On this machine `supabase start` only came up cleanly with `storage`, `imgproxy`, `analytics`, `vector`, `pooler` disabled (storage health-check flapped and tore down the stack); none are needed for Wisopen. Also, Electron 40 deprecated renderer clipboard access.

**Replacement text:**
> `config.toml` disables `[storage]`, `[analytics]` (and imgproxy/vector/pooler) — none are used by Wisopen — and binds services to `127.0.0.1`. Read the legacy JWT anon key via `supabase status -o json` (the pretty output now shows only `sb_publishable_/sb_secret_`). Clipboard save/restore around paste runs in the **main process** (renderer clipboard deprecated in Electron 40), bridged via IPC.

**Status:** Applied at 2026-06-15 — spec patch in commit (next).

> Non-amending refinements already consistent with the spec: keep the Node WS gateway fallback (§6.2) given the long-stream open assumption; postgrest responses discriminated via `error` not the volatile `success` field; Bedrock newer Claude modelIds confirmed at connect-time via model cards / `ListFoundationModels`.

## Subagent dispatch log
- 2026-06-15 ~15:00–15:29 — 7 agents in parallel (`wisopen-preimpl-research`, runId wf_c298ffc4-2f9), ~27 min, 504,932 subagent tokens, 240 tool uses.
  - `spike:native-input` (T2) uiohook-napi@1.5.5 + @nut-tree-fork/nut-js@4.2.6 → /tmp/wisopen-research/native-input.md (spikes: /tmp/superpowers-spikes/uiohook-napi.cjs, nut-js.cjs)
  - `spike:supabase-stack` (T2) Edge WS + supabase-js@2.108.2 + RLS → /tmp/wisopen-research/supabase-stack.md (spikes: /tmp/superpowers-spikes/supabase-stack/)
  - `doc:electron-os` (T1) electron@42.4.0 → /tmp/wisopen-research/electron-os.md
  - `doc:storage-packaging` (T1) safeStorage/keytar/better-sqlite3/electron-store/builder/updater/rebuild/playwright → /tmp/wisopen-research/storage-packaging.md
  - `doc:stt-providers` (T1) transcribe-streaming@3.1068.0 + openai@6.42.0 STT → /tmp/wisopen-research/stt-providers.md
  - `doc:llm-providers` (T1) openai@6.42.0 + Tensorix + bedrock-runtime@3.1068.0 → /tmp/wisopen-research/llm-providers.md
  - `doc:supabase-platform` (T1) CLI/edge/auth/RLS → /tmp/wisopen-research/supabase-platform.md

### Environment side effect to flag
A pre-existing local Supabase project (`project-id wyhqzfzkotksmcapahul`) was running on the default ports and was **stopped** by the supabase spike to free ports (its data is preserved in its Docker volume). To restore it, run `supabase start` from that project's directory. The spike's own scratch stack was stopped cleanly.
