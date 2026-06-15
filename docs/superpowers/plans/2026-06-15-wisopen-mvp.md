# Wisopen MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Inputs:** spec `docs/superpowers/specs/2026-06-15-wisopen-voice-dictation-design.md` (amended) + research `docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md` (verified signatures + mock contracts). When a task touches an external SDK, the verified facts/mock-contract in the research artifact are authoritative.

**Goal:** A cross-platform (macOS + Windows) Electron voice-dictation app — hold a hotkey, speak, get LLM-polished text injected into the focused app — backed by a local Supabase stack, running 100% end-to-end on built-in mock providers, where connecting a real STT/LLM provider is one env-var change.

**Architecture:** 3 tiers — Electron client (main-process OS integration + hidden engine renderer for mic/STT-WS + overlay/settings/onboarding renderers) ↔ Supabase-local backend (Postgres+RLS, Auth, two Edge Functions: `stt-stream` WS proxy + `format` LLM proxy, provider adapters with mock) ↔ external STT/LLM providers. Data CRUD goes client→Postgres via supabase-js+RLS; only secret-key AI calls go through edge functions.

**Tech Stack:** TypeScript, npm workspaces, Electron 42.4.0, Vite, uiohook-napi 1.5.5, @nut-tree-fork/nut-js 4.2.6, better-sqlite3 12.10.1, Electron safeStorage, @supabase/supabase-js 2.108.2, Supabase CLI (Deno edge functions), @aws-sdk/client-transcribe-streaming + bedrock-runtime 3.1068.0, openai 6.42.0, vitest, Playwright 1.61.0, electron-builder 26.15.3, GitHub Actions.

**Test commands (root):** `npm test` (vitest across workspaces), `npm run test:backend` (edge-function integration vs local supabase), `npm run test:e2e` (Playwright Electron), `npm run typecheck`, `npm run lint`.

**Conventions:** TDD where logic is non-trivial (pure functions, adapters, prompt builder, snippet expander, usage normalization). Commit after each green task. Native/OS behaviors (real hotkey hook, real injection, mic) are validated by a manual checklist + the macOS smoke run, not unit tests (per research open assumptions).

---

## Phase 0 — Monorepo + shared contracts

**Exit criteria:** `npm install` clean; `npm run typecheck` + `npm test` green; `packages/shared` exports all contracts + a unit-tested snippet expander.

**File structure:**
- `package.json` (root, workspaces: `apps/*`, `packages/*`, `backend` excluded from npm workspaces — Deno)
- `tsconfig.base.json`, `.eslintrc.cjs`, `vitest.config.ts`, `.nvmrc`
- `packages/shared/package.json`, `tsconfig.json`
- `packages/shared/src/index.ts` (barrel)
- `packages/shared/src/dto.ts` — `FormatRequest`, `FormatResponse`, STT WS message union (`SttClientMsg`=`audio-frame|end|config`, `SttServerMsg`=`ready|partial|final|error`), `UsageKind`
- `packages/shared/src/domain.ts` — `Profile`, `Snippet`, `DictionaryTerm`, `Mode`, `Dictation`, `UsageEvent`, `Settings`
- `packages/shared/src/ipc.ts` — typed IPC channel map (main↔renderer)
- `packages/shared/src/providers.ts` — `SttProvider`/`SttSession` (mode: 'streaming'|'buffered'), `LlmProvider`, normalized `{text,tokensIn,tokensOut}`
- `packages/shared/src/snippet.ts` — `expandSnippets(text, snippets): string` (pure)
- `packages/shared/src/snippet.test.ts`

### Task 0.1: Root workspace + tooling
- [ ] Create root `package.json` with workspaces `["apps/*","packages/*"]`, scripts (`typecheck`, `test`, `lint`, `dev`, placeholders), devDeps: typescript ~5.6, vitest, eslint, @types/node, prettier.
- [ ] Create `tsconfig.base.json` (strict, `moduleResolution: "bundler"`, `target: ES2022`, `declaration`), `.eslintrc.cjs`, `vitest.config.ts` (projects glob), `.nvmrc` (`25`).
- [ ] Run `npm install`; Run `npm run typecheck` → expect no files yet / passes. Commit.

### Task 0.2: shared contracts (types)
- [ ] Create `packages/shared` package.json + tsconfig; write `dto.ts`, `domain.ts`, `ipc.ts`, `providers.ts` matching the spec §6.1 schema and §8, and the research mock contracts (e.g. STT `final` carries `text`; usage normalized to `tokensIn/tokensOut`). Barrel-export from `index.ts`.
- [ ] `npm run typecheck` green. Commit.

### Task 0.3: snippet expander (TDD)
- [ ] **Write failing tests** `snippet.test.ts`: case-insensitive match; word-boundary (no mid-word match); longest-trigger-first when two triggers overlap; `enabled:false` skipped; `match_mode` `exact` vs `phrase` vs `regex`; preserves surrounding text; multiple occurrences; LLM casing change ("my LinkedIn") still matches trigger "my linkedin".
- [ ] Run vitest → FAIL (function not implemented).
- [ ] Implement `expandSnippets` (normalize for matching, replace with expansion verbatim, longest-first sort, word boundaries via regex with escaped triggers, regex mode compiles trigger as RegExp).
- [ ] Run vitest → PASS. Commit.

---

## Phase 1 — Backend (Supabase local + edge functions + providers)

**Exit criteria:** `supabase start` (custom config) up; migrations+seed apply; `npm run test:backend` green — integration tests drive `format` (mock LLM) and `stt-stream` (mock STT over WS) end-to-end and assert `usage_events` rows + RLS. Real adapters compile and are unit-tested against the research mock contracts with the SDK mocked.

**File structure:**
- `backend/supabase/config.toml` — ports 127.0.0.1; `[storage] enabled=false`, `[analytics] enabled=false`, imgproxy/vector/pooler off; `[auth] additional_redirect_urls=["wisopen://auth-callback"]`; `[auth.email] enable_confirmations=false` (local dev autoconfirm)
- `backend/supabase/migrations/0001_init.sql` — tables (spec §6.1) + RLS policies (`(select auth.uid()) = user_id`) + `handle_new_user()` trigger + system modes are `is_system`
- `backend/supabase/seed.sql` — system modes (Raw, Clean[default], Email, Slack, Notes) prompt templates
- `backend/supabase/functions/_shared/providers/types.ts` — re-declare provider interfaces (Deno; mirror shared)
- `backend/supabase/functions/_shared/providers/stt/{mock,aws-transcribe,openai}.ts`
- `backend/supabase/functions/_shared/providers/llm/{mock,openai-compatible,bedrock}.ts`
- `backend/supabase/functions/_shared/providers/index.ts` — `getSttProvider()`/`getLlmProvider()` from `Deno.env`
- `backend/supabase/functions/_shared/auth.ts` — `verifyJwt(token)` via `createClient(...).auth.getUser(token)`
- `backend/supabase/functions/_shared/usage.ts` — `logUsage(adminClient, row)`
- `backend/supabase/functions/_shared/prompt.ts` — `buildPolishPrompt(mode, transcript, dictionary, lang)`
- `backend/supabase/functions/format/index.ts` — HTTP, gateway JWT on
- `backend/supabase/functions/stt-stream/index.ts` — `Deno.upgradeWebSocket`, `--no-verify-jwt`, in-fn auth via `?jwt=`
- `backend/supabase/functions/.env.example` — provider selection (defaults `mock`)
- `backend/tests/{format.test.ts,stt-stream.test.ts,rls.test.ts}` — vitest, run against local stack
- `backend/scripts/start-local.sh`, `backend/scripts/serve-functions.sh`

### Task 1.1: Supabase project + config
- [ ] `cd backend && supabase init`; edit `config.toml` per file structure (disable storage/analytics/imgproxy/vector/pooler; bind 127.0.0.1; add redirect URL; autoconfirm email). Add `scripts/start-local.sh` (`supabase start`) and `serve-functions.sh` (`supabase functions serve --no-verify-jwt --env-file functions/.env`).
- [ ] Run `bash scripts/start-local.sh` → stack healthy (`supabase status -o json` yields ANON_KEY). Commit (config only; not the docker volumes).

### Task 1.2: schema + RLS + seed migration
- [ ] Write `migrations/0001_init.sql` (tables, `alter table ... enable row level security`, per-table select/insert/update/delete policies scoped to `(select auth.uid()) = user_id`, system-mode read policy `is_system or auth.uid()=user_id`, `handle_new_user()` `security definer set search_path=''` inserting a `profiles` row). Write `seed.sql` (5 system modes).
- [ ] `supabase db reset` → migrations + seed apply (verify with psql `\dt` + `select count(*) from modes where is_system`).
- [ ] Write `backend/tests/rls.test.ts` (TDD): two users via `auth.admin.createUser`; user A insert snippet → visible to A, not B; anon sees none; spoofed `user_id` insert → error code `42501`. Run `npm run test:backend -- rls` → PASS. Commit.

### Task 1.3: provider interfaces + mock providers (TDD)
- [ ] Write `providers/types.ts` (Deno mirror of shared providers). Write `providers/stt/mock.ts` (streaming: emits 2–3 `partial`s then a `final` with canned text, imitating latency) and `providers/llm/mock.ts` (returns deterministic "polished" text: trim filler, capitalize, add period; echoes token counts).
- [ ] Write unit tests for mocks (Deno test or vitest via tsx): mock STT yields partials then final; mock LLM returns text + `{tokensIn,tokensOut}`. PASS. Commit.

### Task 1.4: real STT adapters (unit, SDK mocked)
- [ ] Write `providers/stt/aws-transcribe.ts` — `TranscribeStreamingClient` + `StartStreamTranscriptionCommand` (MediaEncoding 'pcm', 16000); AudioStream async-generator from pushed frames; consume `TranscriptResultStream`, dedup by `ResultId`, emit `partial` while `IsPartial`, `final` on `IsPartial:false` (guard optional fields per research). `providers/stt/openai.ts` — **buffered**: accumulate PCM → WAV → `audio.transcriptions.create({file,model:'gpt-4o-transcribe'})` → single `final` (`resp.text`).
- [ ] Write unit tests mocking the SDK modules to the research mock-contract shapes (AWS nested `TranscriptEvent.Transcript.Results[]`; OpenAI `{text,usage}`). Assert adapter emits the normalized session events. PASS. Commit.

### Task 1.5: real LLM adapters (unit, SDK mocked)
- [ ] Write `providers/llm/openai-compatible.ts` — `new OpenAI({apiKey,baseURL})` + `chat.completions.create({model,messages,temperature,max_completion_tokens})`; read `choices[0].message.content` (handle null), normalize `usage.prompt_tokens/completion_tokens` → `{tokensIn,tokensOut}` (default 0 if absent). `providers/llm/bedrock.ts` — `ConverseCommand` (system top-level, content block array), read `output.message.content[0].text`, normalize `usage.inputTokens/outputTokens`.
- [ ] Unit tests mocking each SDK to the research return shapes (incl. a `RateLimitError`/throttling path → adapter surfaces error). PASS. Commit.

### Task 1.6: `format` edge function (integration)
- [ ] Write `_shared/prompt.ts` (`buildPolishPrompt`) + `_shared/auth.ts` + `_shared/usage.ts` + `providers/index.ts` (env selection) + `functions/format/index.ts` (`Deno.serve`: parse `FormatRequest`, verify JWT via header, load mode + dictionary [passed in body or queried with caller RLS client], call LLM, return `FormatResponse`, log `usage_events` with service-role admin client). Add `.env.example` (defaults mock).
- [ ] Write `backend/tests/format.test.ts`: sign in a test user; POST to local `format` with `LLM_PROVIDER=mock`; assert polished text returned and a `usage_events` `kind='llm'` row exists. Run `npm run test:backend -- format` → PASS. Commit.

### Task 1.7: `stt-stream` edge function (integration)
- [ ] Write `functions/stt-stream/index.ts` — `Deno.upgradeWebSocket`; read `?jwt=`; `auth.getUser` → close 1008 if invalid; on `config`/`audio-frame`/`end` client msgs drive the selected STT provider session; forward `partial`/`final` server msgs; on `end`/final log `usage_events` `kind='stt'` (audio_seconds). Serve with `--no-verify-jwt`.
- [ ] Write `backend/tests/stt-stream.test.ts`: connect `ws` with valid `?jwt=`; send config + a few audio-frames + end; assert receive `partial`*+`final` and a `usage_events` `kind='stt'` row; connect with bad jwt → socket closed. Run `npm run test:backend -- stt-stream` → PASS. Commit.

---

## Phase 2 — Electron desktop app (wired with mock, runs on macOS)

**Exit criteria:** `npm run dev` launches the app on macOS against local supabase; login works; pressing the PTT key records → overlay shows partials → polished text + expanded snippets injected into the focused app → history + usage row written. Playwright drives settings/onboarding renderers. Native hook/injection validated by manual checklist + the smoke run.

**File structure (apps/desktop):**
- `package.json` (electron, electron-vite or vite+builder, deps: native modules, supabase-js, openai not needed client-side), `electron.vite.config.ts`, `tsconfig.json`
- `src/main/index.ts` — app lifecycle, single-instance, protocol, window orchestration
- `src/main/config.ts` — `configManager` (SUPABASE_URL/ANON from env/.env, feature flags)
- `src/main/store.ts` — `localStore` (better-sqlite3: settings, cache, history, secret ciphertext)
- `src/main/secrets.ts` — `secretStore` (safeStorage encrypt/decrypt around store)
- `src/main/auth.ts` — `apiClient` (supabase-js with custom storage adapter, pkce, refresh; getJwt())
- `src/main/hotkey.ts` — `hotkeyManager` (uiohook keydown/keyup; PTT default F13/Ctrl+Space; remap)
- `src/main/injector.ts` — `injector` (nut.js: clipboard-paste w/ save+restore; keystroke fallback; clipboard via main)
- `src/main/overlay.ts` — `overlayController` (panel window, click-through, position on active screen, state)
- `src/main/tray.ts` — `trayMenu`
- `src/main/permissions.ts` — `permissionsManager` (mac mic/accessibility/input-monitoring status + prompts)
- `src/main/session.ts` — `audioCoordinator` (orchestrates hotkey→engine→stt-stream→format→injector→history)
- `src/main/updater.ts` — `autoUpdater` (electron-updater; no-op without feed)
- `src/main/ipc.ts` — wires `ipc.ts` contract handlers
- `src/preload/index.ts` — contextBridge exposing the typed IPC surface
- `src/renderers/engine/` — hidden: getUserMedia + AudioWorklet (16k PCM16) + STT WebSocket client
- `src/renderers/overlay/` — pill UI (state-driven)
- `src/renderers/settings/` — tabs: Account, Hotkeys, Modes, Shortcuts, Dictionary, History, Audio, Language, Advanced (supabase-js CRUD via RLS)
- `src/renderers/onboarding/` — login + permission walkthrough + hotkey pick + mic test
- `src/renderers/shared-ui/` — small shared components/styles (i18n en/it)
- `build/entitlements.mac.plist` (audio-input + accessibility-friendly), `build/icon.*`
- `tests/e2e/*.spec.ts` (Playwright `_electron`)

### Task 2.1: Electron shell + config + IPC + preload
- [ ] Scaffold electron-vite project; `main/index.ts` (single-instance lock, `setAsDefaultProtocolClient('wisopen')`, create hidden engine window + tray; open onboarding if not logged in else idle); `config.ts`; `ipc.ts` handlers stub; `preload/index.ts` contextBridge.
- [ ] `npm run dev` launches an empty tray app on macOS (manual: tray icon appears). Add Playwright smoke (`_electron.launch` → app ready). Commit.

### Task 2.2: localStore + secretStore (TDD)
- [ ] `store.ts` (better-sqlite3 schema: kv settings, cached_* tables, dictations, secret blob) with typed get/set. `secrets.ts` (safeStorage gate + encrypt→store ciphertext, decrypt on read).
- [ ] Unit tests (vitest, run in Node with better-sqlite3; safeStorage mocked): settings round-trip; secret encrypt/decrypt round-trip via mocked safeStorage; history insert/query. PASS. Commit. (Rebuild native modules: add `electron-rebuild` postinstall.)

### Task 2.3: auth/apiClient
- [ ] `auth.ts`: supabase-js client with custom `storage` adapter backed by store+secrets, `flowType:'pkce'`, `autoRefreshToken`; `signIn`, `signInWithOtp`, `exchangeCodeForSession` (from `open-url`/`second-instance` deep link), `getJwt()`, `onAuthStateChange` → IPC. 
- [ ] Unit test the storage adapter (get/set/remove via store) with supabase-js mocked. Manual: login against local supabase from onboarding. Commit.

### Task 2.4: engine renderer (mic + STT WS)
- [ ] `renderers/engine`: `getUserMedia` mono; AudioWorklet downsample → 16k PCM16 frames; open WS to `stt-stream?jwt=<jwt>`; send `config`+`audio-frame`+`end`; forward `partial`/`final` + level to main via IPC.
- [ ] Vitest unit for the PCM downsample function (pure: input float32@48k → int16@16k length/values). Manual: with mock STT, partials arrive. Commit.

### Task 2.5: hotkey + overlay + injector + session orchestration
- [ ] `hotkey.ts` (uiohook keydown/keyup on configured PTT key → start/stop session; toggle mode). `overlay.ts` (panel window, states idle→listening→transcribing→polishing→inserting→done/error). `injector.ts` (save clipboard→set→Cmd/Ctrl+V via nut.js→restore; fallback type; fallback copy+toast). `session.ts` ties: hotkey down→overlay listening + engine start; partials→overlay; hotkey up→engine end→final→`format` (via apiClient)→`expandSnippets`→injector→store history.
- [ ] Unit-test `session.ts` orchestration with hotkey/engine/format/injector mocked (assert call order + snippet expansion applied to final). Manual smoke on macOS. Commit.

### Task 2.6: settings + onboarding renderers
- [ ] `renderers/settings` tabs doing supabase-js CRUD (snippets/dictionary/modes/history) under RLS + local settings; `renderers/onboarding` (login, permission walkthrough using permissions.ts, hotkey capture, mic test). i18n en/it.
- [ ] Playwright e2e: launch app, open settings window, add a snippet, assert it persists (against local supabase test user). PASS. Commit.

### Task 2.7: permissions + tray + updater polish
- [ ] `permissions.ts` (mac `getMediaAccessStatus`/`askForMediaAccess`, `isTrustedAccessibilityClient(true)`, input-monitoring guidance + `shell.openExternal` settings panes; Windows graceful no-ops). `tray.ts` menu (toggle dictation, open settings, sign out, quit). `updater.ts` guarded by feed env.
- [ ] Manual checklist run on macOS (permissions prompts appear; tray works). Commit.

---

## Phase 3 — Packaging + CI

**Exit criteria:** `npm run build:mac` produces a dmg/zip locally (unsigned ok for beta); electron-builder win config present; GitHub Actions builds macOS + Windows artifacts on tag; README runbook complete.

**File structure:**
- `apps/desktop/electron-builder.yml` — appId `ai.wisopen.app`; mac (dmg+zip, hardenedRuntime, entitlements, `extendInfo` NSMicrophoneUsageDescription + CFBundleURLTypes wisopen, `asarUnpack` native `.node`, notarize env-driven); win (nsis, `signtoolOptions` via CSC_* env); `afterPack`/rebuild
- `.github/workflows/build.yml` — matrix macos-latest + windows-latest: install, electron-rebuild, typecheck, test, `electron-builder --publish never`, upload-artifact
- `.github/workflows/ci.yml` — push/PR: typecheck + lint + unit tests (+ backend tests on ubuntu with supabase CLI if feasible, else unit-only)
- `README.md` — runbook (below)

### Task 3.1: electron-builder config
- [ ] Write `electron-builder.yml`; add `build:mac`/`build:win` scripts; ensure `asarUnpack` covers better-sqlite3 + uiohook-napi + nut-js native dirs; mac `extendInfo` for mic usage string + `wisopen` URL scheme; entitlements plist.
- [ ] Run `npm run build:mac` → dmg/zip produced (unsigned). Manual: installed app launches. Commit.

### Task 3.2: CI workflows
- [ ] Write `.github/workflows/ci.yml` (lint+typecheck+unit on ubuntu) and `build.yml` (mac+win matrix → artifacts; signing/notarize gated on secrets presence). 
- [ ] Validate workflow YAML (`act` or push to a branch). Commit.

### Task 3.3: README + runbook
- [ ] Write `README.md`: prerequisites; `supabase start` + `npm run dev`; mock→real provider switch (env table: `LLM_PROVIDER`/`STT_PROVIDER` + keys, incl. Tensorix base URL + model ids, Bedrock inference-profile id, OpenAI gpt-4o-transcribe); build installers / CI; macOS-verified vs Windows-CI status; macOS permission notes; Supabase Cloud migration (`db push` + `functions deploy` + secrets). Commit.

---

## Self-review notes
- **Spec coverage:** voice loop (P2.4/2.5), polish engine + prompt (P1.6), shortcuts (P0.3 + applied P2.5), dictionary (P1.6 prompt), modes (P1.2 seed + P2.6), history+usage (P1.6/1.7 + P2.2/2.5), auth+deep-link PKCE (P2.3), providers incl. mock (P1.3–1.5), permissions (P2.7), packaging+CI Mac/Win (P3). All amended decisions (F13 hotkey, safeStorage, drop electron-store, WS in-fn auth, buffered OpenAI STT, usage normalization, config disables) are reflected in the relevant tasks.
- **Known fragilities (from research open assumptions):** native hook/injection + Electron-load of native modules validated by smoke run/manual, not unit tests; long-WS-stream edge limit → Node-gateway fallback kept available; Windows path validated only via CI + manual. These are accepted, not gaps.
