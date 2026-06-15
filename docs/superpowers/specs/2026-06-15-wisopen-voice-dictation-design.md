# Wisopen — Voice Dictation Desktop App (Wispr Flow analog)

**Design document** · 2026-06-15 · Status: Draft for review

---

## 1. Overview & goals

Wisopen is a voice-first dictation tool for **macOS and Windows**. The user holds a global
hotkey anywhere in the OS, speaks, and releases. Audio is streamed to **our backend**, which
proxies it to a Speech-to-Text (STT) provider; the raw transcript is then passed through an
**LLM "polish" pass** that cleans filler words, fixes punctuation/casing, applies a chosen
*mode* (email / Slack / note / raw), corrects names via a custom dictionary, and expands
user-defined **shortcuts** ("my linkedin" → URL). The final text is **injected into whatever
app currently has focus**, at the cursor. Everything (users, consumption, API proxying) goes
through our own backend.

### Primary requirements (from the brief)
1. Native-feeling desktop apps for **Mac and Windows** (single Electron codebase).
2. Connects to **our backend** that manages users, usage/consumption, and API calls.
3. **100% functional out of the box** — connecting a real model API is a one-line config change.
4. **Rewrites / reformats text better** (the LLM polish pass).
5. **Configurable shortcuts** like `"my linkedin" → LINK` (text expansion).

### Confirmed architecture decisions
| Area | Decision |
|---|---|
| Desktop framework | **Electron** (one JS/TS codebase, Mac + Win) |
| STT | **Cloud, streamed through our backend**; adapters: **AWS Transcribe**, **OpenAI**, Mock |
| LLM (polish) | Adapters: **OpenAI-compatible** (covers OpenAI **and** Tensorix), **AWS Bedrock**, Mock |
| Backend | **Supabase, self-hosted locally** (Docker/CLI); clean migration path to Supabase Cloud |
| Billing | **Internal beta** → usage **logging only**, no quota enforcement (Stripe-ready later) |
| UI language | **English primary**, Italian available |

### Success criteria
- A new dev runs `supabase start` + `npm run dev`, and the **full dictation loop works with the
  built-in mock providers — no real API key required**.
- Replacing the mock with a real provider = set env vars (`LLM_PROVIDER`, `STT_PROVIDER`, keys),
  restart functions. No code changes.
- Hotkey → speak → polished text injected into the focused app on both macOS and Windows.
- Shortcuts, custom dictionary, modes, and history all work and sync per-user.

---

## 2. Non-goals (v1 scope / YAGNI)

Explicitly **out** of v1, noted as future work:
- Local/offline STT (whisper.cpp). v1 is cloud-only.
- Stripe billing & paywall enforcement (schema is billing-ready; enforcement deferred).
- Voice **commands** beyond dictation formatting (e.g. "press enter", "open Safari").
- Global text-expander while typing (snippets apply only inside dictation in v1).
- Real-time *context-aware* style auto-switching by active app (we capture app context and
  expose manual modes; automatic per-app mode selection is future).
- Mobile apps, browser extension, team/admin console.

---

## 3. Key user flows

### 3.1 First run (onboarding)
1. Launch → onboarding window.
2. Sign in / sign up (Supabase Auth, email+password or magic link).
3. Permission walkthrough (macOS: Microphone, Accessibility, Input Monitoring; Windows: Microphone).
<!-- amended per docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md amendment 1 on 2026-06-15 -->
4. Pick push-to-talk hotkey (default: `F13` on macOS / `Ctrl+Space` on Windows; remappable; **Fn not offered** — unsupported by the global hook).
5. Mic test (level meter + sample dictation against the mock/real provider).
6. Done → app lives in the tray/menu bar.

### 3.2 Core dictation loop
```
[hold hotkey]
  → engine renderer captures mic (16 kHz mono PCM)
  → opens WebSocket to backend `stt-stream` (auth: Supabase JWT)
  → backend relays audio chunks to STT provider, streams partial transcripts back
  → overlay pill shows live partials  ("listening… / transcribing…")
[release hotkey]
  → backend returns final transcript; logs audio_seconds → usage_events
  → client POSTs `format` { transcript, mode_id, app_context, lang }
  → backend loads mode prompt + dictionary, calls LLM, returns polished text; logs tokens
  → client expands shortcuts deterministically (post-LLM)
  → injector pastes final text into the focused app (clipboard paste w/ save+restore)
  → client saves to local history + upserts `dictations` row (if history enabled)
```

### 3.3 Managing settings
Settings window tabs: **Account**, **Hotkeys**, **Modes**, **Shortcuts**, **Dictionary**,
**History**, **Audio**, **Language**, **Advanced** (injection mode, privacy/history toggle,
provider status read-out).

---

## 4. High-level architecture

Three tiers:

```
┌───────────────────────────────┐     WSS / HTTPS      ┌──────────────────────────────┐
│  DESKTOP CLIENT (Electron)    │  ◄───────────────►   │  BACKEND (Supabase, local)   │
│  • global hotkey (uiohook)    │   JWT-authenticated  │  • Auth (GoTrue)             │
│  • mic capture (WebAudio)     │                      │  • Postgres + RLS            │
│  • overlay pill / settings    │                      │  • Edge Functions:           │
│  • text injection (nut.js)    │                      │      - stt-stream (WS proxy) │
│  • local cache (SQLite)       │                      │      - format (LLM proxy)    │
│  • supabase-js (CRUD via RLS) │                      │  • provider adapters         │
└───────────────────────────────┘                      └───────────────┬──────────────┘
                                                                        │ provider keys (.env only)
                                                          ┌─────────────▼───────────────┐
                                                          │  EXTERNAL PROVIDERS          │
                                                          │  STT: AWS Transcribe / OpenAI│
                                                          │  LLM: OpenAI / Tensorix /    │
                                                          │       Bedrock                │
                                                          │  (or built-in MOCK)          │
                                                          └──────────────────────────────┘
```

**Why proxy AI through the backend** (not client→provider directly):
1. Provider API keys never ship to clients (security).
2. Centralized, tamper-proof usage metering.
3. Provider swappable without releasing a new app build.

**Data CRUD** (snippets, dictionary, modes, history, settings) goes **directly** from the client
via `supabase-js`, protected by Row-Level Security — no need for custom endpoints. Edge Functions
exist **only** where secret keys are required (STT + LLM proxying).

---

## 5. Desktop client (Electron) — detailed design

### 5.1 Process model
- **Main process** (Node): owns OS integration, windows, IPC, secrets, networking config.
- **Renderer: `engine`** (hidden `BrowserWindow`): mic capture (`navigator.mediaDevices`),
  audio downsampling/encoding, the STT WebSocket, audio level metering. Hidden because it needs a
  web context for WebAudio but no visible UI.
- **Renderer: `overlay`** (frameless, transparent, always-on-top, click-through): the live state pill.
- **Renderer: `settings`** (standard window): full UI.
- **Renderer: `onboarding`** (standard window): first-run flow.

IPC is typed via a single `ipcBridge` contract defined in `packages/shared`.

### 5.2 Main-process modules
Each module is a focused unit with a small interface.

| Module | Purpose | Key deps |
|---|---|---|
| `hotkeyManager` | Detect push-to-talk **press / hold / release** + toggle (hands-free) mode | `uiohook-napi` (low-level key events; `globalShortcut` can't do reliable hold-detection) |
| `audioCoordinator` | Bridge engine renderer ↔ STT session lifecycle; manage start/stop | IPC |
| `injector` | Insert final text into the focused app | `nut.js` |
| `overlayController` | Position pill near cursor/active screen, drive its state | `screen`, IPC |
| `trayMenu` | Menu-bar/tray icon, quick toggles, open settings, quit | `Tray`, `Menu` |
| `permissionsManager` | Query/request OS permissions, drive onboarding gating | `systemPreferences` (mac), native checks |
| `autoUpdater` | Background updates | `electron-updater` |
| `apiClient` | Supabase auth (token refresh) + edge-function calls; injects JWT | `@supabase/supabase-js` |
<!-- amended per docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md amendment 2 on 2026-06-15 -->
| `secretStore` | Encrypt the Supabase refresh token with Electron **`safeStorage`** (`isEncryptionAvailable()` → `encryptString`/`decryptString`, after app `ready`); persist the ciphertext Buffer in the local DB. Linux `basic_text` backend treated as insecure. | Electron `safeStorage` |
| `localStore` | Single local store for settings, cached snippets/dictionary/modes, local history, and the secret ciphertext blob | `better-sqlite3` (electron-store dropped — ESM-only) |
| `configManager` | Resolve backend URL, anon key, feature flags from env/config | — |

### 5.3 Audio pipeline
1. `engine` calls `getUserMedia({ audio: { channelCount:1, echoCancellation:true,
   noiseSuppression:true } })`.
2. An `AudioWorklet` downsamples to **16 kHz mono PCM16** (the common denominator for AWS
   Transcribe and OpenAI). Frames (~100 ms) are pushed over the WebSocket.
3. Live audio level → overlay meter via IPC.
4. On release, send an "end-of-stream" control frame; await final transcript.

### 5.4 Push-to-talk / hotkey
<!-- amended per docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md amendment 1 on 2026-06-15 -->
- Default: **hold `F13` (macOS) / `Ctrl+Space` (Windows)** = push-to-talk; release = finalize. `F13` is chosen because it is reliably reported by `uiohook-napi` and absent on most keyboards (no conflicts). `Fn` is **not** usable (no entry in `UiohookKey`); good alternatives are Right-Cmd / Right-Ctrl.
- **Toggle (hands-free)** mode: a configurable second binding starts/stops a session.
- Implemented with `uiohook-napi` keydown/keyup for true hold-detection (Electron `globalShortcut` has no keyup); debounced to avoid accidental triggers. `uIOhook.start()`/nut-js injection run in the **main process** only.
- Fully remappable in Settings → Hotkeys, persisted in `localStore`.

### 5.5 Text injection (the hard part)
Two strategies behind one `injector` interface:
- **Clipboard-paste (default):** save current clipboard → set clipboard to final text →
  synthesize `Cmd/Ctrl+V` → restore previous clipboard after a short delay. Fast and reliable;
  preserves rich apps. Risk: clipboard managers — mitigated by restore + an "advanced" opt-out.
- **Synthetic keystrokes (fallback):** type characters via `nut.js`. No clipboard touch but slower
  and can drop characters in some apps. Used where paste is blocked.
- If no editable target / injection fails → **copy to clipboard + toast** "Copied — paste manually".

### 5.6 Overlay pill states
`idle (hidden)` → `listening` (mic active, level meter) → `transcribing` (partials streaming)
→ `polishing` (LLM pass) → `inserting` → `done` (brief check) / `error` (actionable message).
Frameless, transparent, `setIgnoreMouseEvents(true, {forward:true})`, always-on-top, shown on the
screen containing the focused window.

### 5.7 Local storage
- **Settings/prefs:** `localStore` (hotkeys, default mode, injection mode, language, audio device,
  privacy toggle).
- **Cache:** snippets/dictionary/modes mirrored locally so dictation works with zero round-trips
  for expansion; refreshed on login and via Realtime/poll.
- **History:** local SQLite copy of `dictations` for instant search; synced to backend when enabled.
<!-- amended per docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md amendments 2 & 6 on 2026-06-15 -->
- **Secrets:** Supabase refresh token encrypted with Electron `safeStorage`, ciphertext stored in
  the local SQLite DB; the Supabase **anon key is public** and may live in config.

### 5.8 Auth flow (desktop)
- Supabase Auth (GoTrue). v1: **email + password** and **magic link** (deep link
  `wisopen://auth-callback`, declared in `info.plist` `CFBundleURLTypes` on macOS at build time and
  registered via `app.setAsDefaultProtocolClient` + single-instance lock on Windows). The supabase-js
  client uses **`flowType:'pkce'`** with a custom `storage` adapter (better-sqlite3 + safeStorage) and
  `auth.exchangeCodeForSession(code)` on the captured callback (default flow is `implicit`).
- On login, encrypt+store the refresh token; `apiClient` auto-refreshes the JWT and attaches it to
  every `format` call (Authorization header) and to the `stt-stream` WebSocket via the `?jwt=` query
  param (browser/Electron WS cannot set custom headers).
- On refresh failure → silent re-auth attempt → if it fails, prompt re-login without losing
  in-progress text (buffer the transcript locally).

---

## 6. Backend (Supabase local) — detailed design

<!-- amended per docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md amendment 7 on 2026-06-15 -->
Runs via the Supabase CLI (`supabase start`) → local Postgres, GoTrue (auth), Edge Runtime
(Deno functions), Studio. `config.toml` **disables `[storage]`, `[analytics]`** (and imgproxy/vector/
pooler — none are used by Wisopen; on some machines the storage health-check otherwise tears down the
stack) and binds services to `127.0.0.1`. The legacy JWT anon key (needed by supabase-js) is read via
`supabase status -o json` (pretty output now shows only `sb_publishable_/sb_secret_`). Same migrations
deploy unchanged to Supabase Cloud later.

### 6.1 Database schema (Postgres)

All user-owned tables enforce **RLS**: `user_id = auth.uid()`.

```sql
-- profiles: 1:1 with auth.users
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  plan          text not null default 'beta',     -- billing-ready, unused in beta
  ui_language   text not null default 'en',        -- 'en' | 'it'
  settings      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

-- snippets: the "my linkedin" -> URL shortcuts
create table snippets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  trigger     text not null,                      -- e.g. "my linkedin"
  expansion   text not null,                      -- e.g. "https://linkedin.com/in/luca"
  enabled     boolean not null default true,
  match_mode  text not null default 'phrase',     -- 'phrase' | 'exact' | 'regex'
  created_at  timestamptz not null default now(),
  unique (user_id, trigger)
);

-- dictionary_terms: custom vocabulary to fix misheard names/jargon
create table dictionary_terms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  term        text not null,                      -- correct spelling, e.g. "Wisopen"
  sounds_like text[] not null default '{}',       -- optional phonetic variants
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (user_id, term)
);

-- modes: formatting profiles (prompt templates)
create table modes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade, -- null = system default
  name            text not null,                  -- "Email", "Slack", "Note", "Raw"
  description     text,
  prompt_template text not null,
  is_system       boolean not null default false,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);

-- dictations: history + cross-device sync
create table dictations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  raw_transcript  text not null,
  final_text      text not null,
  mode_id         uuid references modes(id) on delete set null,
  app_context     text,                           -- focused app name/bundle id
  lang            text,
  audio_seconds   numeric(10,2),
  tokens_in       integer,
  tokens_out      integer,
  created_at      timestamptz not null default now()
);

-- usage_events: append-only metering log (the "consumi")
create table usage_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,                    -- 'stt' | 'llm'
  provider      text not null,                    -- 'aws-transcribe' | 'openai' | 'bedrock' | 'tensorix' | 'mock'
  model         text,
  audio_seconds numeric(10,2),
  tokens_in     integer,
  tokens_out    integer,
  cost_estimate numeric(12,6),                     -- computed from a price table
  created_at    timestamptz not null default now()
);

-- devices: optional, for sessions/telemetry
create table devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null,                       -- 'mac' | 'win'
  app_version text,
  last_seen   timestamptz not null default now()
);
```

- A `handle_new_user()` trigger creates a `profiles` row + seeds the default system modes on signup.
- System modes (`is_system = true`, `user_id null`) are readable by all; user modes are private.
- A small `provider_prices` config (in code or a table) drives `cost_estimate`.

### 6.2 Edge Functions (Deno)

Only two — the secret-key boundary.

#### `stt-stream` (WebSocket)
<!-- amended per docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md amendment 3 on 2026-06-15 -->
- Served/deployed with `--no-verify-jwt` (WS upgrades bypass the Supabase gateway JWT check —
  verified). The client passes its JWT via `?jwt=<token>` (or `Sec-WebSocket-Protocol: jwt-<token>`).
  The function validates it (`createClient(URL, ANON, {global:{headers:{Authorization:'Bearer '+token}}})`
  → `auth.getUser(token)`) and closes the socket on failure **before** relaying audio.
- Opens an upstream session to the configured STT provider.
- Relays client audio frames upstream; streams partial + final transcripts back to the client.
- On finalize: writes a `usage_events` row (`kind='stt'`, `audio_seconds`, provider/model).
- If the local Edge Runtime's WebSocket support proves flaky, **fallback**: a tiny standalone
  Deno/Node `ws` gateway in `backend/gateway/` exposing the same contract. (Designed so the client
  is agnostic to which one serves it — same URL/contract.)

#### `format` (HTTP POST, optionally streaming)
- Input: `{ transcript, mode_id, app_context, lang, dictionary[], snippet_triggers[] }`.
- Loads the mode's `prompt_template`, builds the final prompt (see §7), calls the LLM adapter.
<!-- amended per docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md amendment 5 on 2026-06-15 -->
- Each LLM adapter **normalizes** provider usage into `{ tokensIn, tokensOut }` (OpenAI chat:
  `prompt_tokens`/`completion_tokens`; Responses: `input_tokens`/`output_tokens`; Bedrock Converse:
  `inputTokens`/`outputTokens`), defaulting to `0`/`null` when `usage` is absent.
- Returns `{ final_text, tokens_in, tokens_out }`; writes a `usage_events` row (`kind='llm'`). Keeps
  the normal gateway JWT check (no `--no-verify-jwt`).
- Snippet **expansion is NOT done here** — it's deterministic on the client (post-response) so
  URLs can't be mangled by the model; the model is only told to **preserve triggers verbatim**.

### 6.3 Provider abstraction (adapters)

A `_shared/providers/` module with two interfaces and config-driven selection:

```ts
interface SttProvider {
  mode: 'streaming' | 'buffered';
  // streaming: push PCM frames, emits partial+final; buffered: accumulate, emit final only
  openSession(opts): SttSession;            // aws-transcribe | openai | mock
}
interface LlmProvider {
  complete(prompt, opts): Promise<{ text, tokensIn, tokensOut }>;  // openai-compatible | bedrock | mock
}
```

<!-- amended per docs/superpowers/research/2026-06-15-wisopen-voice-dictation-design.md amendment 4 on 2026-06-15 -->
Adapters shipped in v1:
- **STT:** `aws-transcribe` — **streaming** (PCM16 16 kHz; dedup partials by `ResultId`; final when
  `IsPartial:false`; region-configurable incl. `eu-west-1`); `openai` — **buffered** (accumulate PCM →
  wrap as WAV → `audio.transcriptions.create({model:'gpt-4o-transcribe'})` → final only; live partials
  via OpenAI Realtime-WS are future work because `transcriptions.create` is file-based); `mock` —
  streaming. The overlay shows partials when the active provider streams, else a "transcribing…" state.
- **LLM:** `openai-compatible` (base URL + key + model → covers **OpenAI** *and* **Tensorix** and
  any OpenAI-compatible endpoint), `bedrock` (AWS SigV4 / Bedrock Runtime), `mock`.

Selection via env: `STT_PROVIDER`, `LLM_PROVIDER`, plus provider-specific keys/URLs.

### 6.4 Configuration (`.env`) — "connect the API"

`backend/supabase/functions/.env`:
```ini
# --- provider selection ---
STT_PROVIDER=mock            # aws-transcribe | openai | mock
LLM_PROVIDER=mock            # openai-compatible | bedrock | mock

# --- LLM: OpenAI-compatible (OpenAI OR Tensorix OR any compatible) ---
OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1   # or https://api.tensorix.ai/v1
OPENAI_COMPAT_API_KEY=
OPENAI_COMPAT_MODEL=gpt-4o-mini                     # OpenAI, or a Tensorix id e.g. z-ai/glm-5.1

# --- LLM: Bedrock (Converse API) ---
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
BEDROCK_MODEL_ID=us.anthropic.claude-3-5-sonnet-20240620-v1:0   # inference-profile id

# --- STT: AWS Transcribe (reuses AWS_* above) / OpenAI ---
OPENAI_API_KEY=                                     # for STT=openai (model gpt-4o-transcribe)
STT_LANGUAGE=en-US                                  # default; per-dictation language overrides
```
**The whole app runs end-to-end with `*_PROVIDER=mock` and zero keys.** Flip a provider + add its
key + restart functions → real AI. No code changes anywhere.

### 6.5 The mock providers (what makes it "100% functional" day one)
- `mock` STT: streams back a realistic canned transcript token-by-token (so partials animate),
  with timing that imitates real latency.
- `mock` LLM: returns a plausibly "polished" version of the input (applies simple deterministic
  cleanup), so the format step visibly does something.
- Both log `usage_events` exactly like real providers (so metering is demonstrable).
- Result: a fresh checkout shows the **entire** loop — hotkey, pill, partials, polish, injection,
  usage logging — before any account with a paid provider exists.

---

## 7. The formatting engine (core IP)

Two stages: STT produces a raw transcript; the **LLM polish pass** transforms it.

### 7.1 Polish prompt (per mode)
The prompt instructs the model to:
- Remove filler words ("um", "uh", "you know"), false starts, and repetitions.
- Fix grammar, punctuation, capitalization, and paragraph breaks.
- Apply spoken dictation commands ("new line", "new paragraph", "bullet point", "comma").
- Apply the **mode** (e.g. Email = greeting/sign-off structure; Slack = concise/casual; Note =
  bullets; **Raw = skip the LLM entirely**, light local cleanup only — for lowest latency).
- Correct names/jargon using the supplied **dictionary** terms.
- **Preserve the user's language** (detect from `lang`/content; never translate).
- **Preserve snippet triggers verbatim** (do not expand or alter them).
- **Add no new content**; never answer the text, only reformat it. Low temperature.

### 7.2 Modes (system defaults, seeded)
`Raw` (no LLM) · `Clean` (default: fix grammar/punctuation, keep meaning) · `Email` · `Slack/Chat`
· `Notes` (bulleted). Users can add custom modes (own `prompt_template`).

### 7.3 Snippet expansion (deterministic)
- Applied **client-side after** the LLM returns, on `final_text`.
- Case-insensitive, **word-boundary**, **longest-trigger-first**, `enabled` only.
- `match_mode`: `phrase` (default) / `exact` / `regex`.
- Example: transcript "send him my linkedin please" → LLM polishes to "Send him my LinkedIn,
  please." → expansion replaces "my LinkedIn" → "Send him https://linkedin.com/in/luca, please."
  (Trigger matching is normalized so casing changes from the LLM still match.)

### 7.4 Dictionary
- Terms (+ optional `sounds_like`) are passed to `format` and injected into the prompt as a
  correction list. (Future: also bias the STT provider's custom-vocabulary feature where supported,
  e.g. AWS Transcribe custom vocabularies.)

---

## 8. Shared package (`packages/shared`)
Single source of truth for cross-tier contracts (TypeScript):
- **DTOs:** `FormatRequest`, `FormatResponse`, STT WS message types (`audio-frame`, `partial`,
  `final`, `error`, `end`).
- **IPC contracts:** main ↔ renderer channels and payloads.
- **Provider interfaces:** `SttProvider`, `LlmProvider`.
- **Domain types:** `Snippet`, `DictionaryTerm`, `Mode`, `Dictation`, `UsageEvent`.
- **Snippet-expansion function** (pure, unit-tested) — imported by the client.

---

## 9. Error-handling matrix

| Failure | Behavior |
|---|---|
| Offline / no network | Overlay: "Offline — can't transcribe". Settings/history still work from cache. |
| STT provider error | Retry once; keep captured audio; show actionable error; allow re-send. |
| LLM error/timeout | **Fall back to raw transcript** (still inject something useful) + toast. |
| Injection fails / no field | Copy to clipboard + toast "Copied — paste manually". |
| Auth/JWT expired | Silent refresh; if it fails, prompt re-login; buffer in-progress text. |
| Mic busy / no device | Onboarding mic test + clear error; let user pick another device. |
| Permission missing (mac) | Block dictation with a deep link to the exact System Settings pane. |
| Paste into elevated app (Win) | Detect failure → clipboard fallback + explain the admin-app limitation. |

---

## 10. Security & privacy
- Provider API keys **only** in backend `.env` — never shipped to clients.
- Client ↔ backend over TLS; every call carries a Supabase JWT; **RLS** on all user tables.
- **Audio is not persisted** — streamed and discarded. Transcripts/history stored per-user only
  if history is enabled (privacy toggle to disable saving entirely).
- Clipboard saved/restored around paste.
- Refresh token in OS keychain; anon key is public-safe by design.
- Tensorix path is EU-sovereign / zero-retention; Bedrock + Transcribe can be pinned to `eu-west-1`
  for an all-EU stack if desired.

---

## 11. Testing strategy
- **Unit:** snippet expansion (edge cases: overlap, casing, regex), dictionary correction, prompt
  builder, mode selection, usage/cost calc.
- **Integration:** edge functions against the **mock** providers → assert `usage_events` written,
  `format` output shape, STT WS message sequence. Provider adapters behind interfaces → a `fake`
  provider gives deterministic tests; "connect the API" = flip env from fake/mock to real.
- **UI:** Playwright on the settings/onboarding renderers.
- **E2E (harness):** hotkey → capture → (mock STT) → format → inject in a controlled test target.
- **Manual checklist:** OS-level injection + permissions per platform (the parts that can't be
  fully automated), tracked as a release checklist.

---

## 12. Build, packaging & distribution
- **macOS:** `electron-builder`; code-sign + **notarize**; hardened runtime; entitlement
  `com.apple.security.device.audio-input`; request TCC (Mic/Accessibility/Input-Monitoring) in
  onboarding. Output: `.dmg` / `.zip`.
- **Windows:** `electron-builder` NSIS installer; code-sign (EV/OV) for SmartScreen.
- **Auto-update:** `electron-updater` against a release feed (GitHub Releases or S3).
- **Native modules:** `uiohook-napi`, `nut.js`, `better-sqlite3`, `keytar` rebuilt per platform/arch
  (incl. Apple Silicon + Intel) via `electron-rebuild` in CI.
- For **local beta**, signing/notarization can be skipped (run unsigned / ad-hoc) to move fast.

---

## 13. Repository structure (monorepo)

```
Wisopen/
  apps/
    desktop/
      src/
        main/         # main-process modules (§5.2)
        renderers/
          engine/     # hidden: mic + STT WS
          overlay/    # pill
          settings/   # full UI
          onboarding/ # first run
        preload/      # context-isolated bridges
      electron-builder.yml
      package.json
  backend/
    supabase/
      migrations/     # SQL schema (§6.1)
      functions/
        stt-stream/
        format/
        _shared/
          providers/
            stt/      # aws-transcribe, openai, mock
            llm/      # openai-compatible, bedrock, mock
        .env          # provider selection + keys (gitignored)
      seed.sql        # system modes
      config.toml
    gateway/          # optional fallback WS proxy (only if edge WS is flaky)
  packages/
    shared/           # DTOs, IPC contracts, provider interfaces, snippet expander
  docs/
    superpowers/specs/
  package.json        # workspaces root
```

---

## 14. Migration path: local → Supabase Cloud
- The **same `migrations/` + `seed.sql`** apply to a Cloud project (`supabase db push`).
- Edge functions deploy via `supabase functions deploy`; set the same env vars as Cloud secrets.
- Client switches by changing `SUPABASE_URL` + `SUPABASE_ANON_KEY` in its config — no code change.
- This is why we keep all data access through migrations + supabase-js/edge functions and avoid any
  local-only assumptions.

---

## 15. Build order (milestones)
1. **Monorepo + shared types** + Supabase local up (schema, RLS, seed, auth).
2. **Mock providers + edge functions** (`format`, `stt-stream`) green via integration tests.
3. **Electron shell**: windows, tray, IPC, config, Supabase auth/login.
4. **Audio + STT loop** end-to-end with mock (engine renderer ↔ stt-stream ↔ overlay partials).
5. **Format + snippet expansion + injection** → full loop working with mock.
6. **Settings UI**: hotkeys, modes, snippets, dictionary, history, audio, language.
7. **Onboarding + permissions** (mac/win) + remappable hotkeys.
8. **Real providers**: AWS Transcribe / OpenAI (STT); OpenAI-compatible (OpenAI+Tensorix) / Bedrock (LLM).
9. **Packaging**: signed builds + auto-update; release checklist.

---

## 16. Open questions / future
- Hands-free toggle UX details (auto-stop on silence?).
- Per-app automatic mode selection (using `app_context`).
- Voice commands (navigation/editing) beyond formatting.
- Local/offline STT option (whisper.cpp) for privacy/cost.
- Stripe billing + quota enforcement when leaving beta.
- Global text-expander (snippets while typing, not only dictation).
```

