# Wisopen — voice dictation for macOS & Windows

A Wispr Flow–style dictation app. Hold a hotkey, speak, and get **LLM-polished text
injected into whatever app you're typing in** — plus text-expansion shortcuts
(`"my linkedin"` → your URL), a custom dictionary, and formatting modes.

It runs **100% end-to-end on built-in mock providers with zero API keys**. Connecting a
real Speech-to-Text or LLM provider is a one-line `.env` change.

> **Verification status:** the macOS path is built **and verified running** (the app boots,
> authenticates against the local backend, and runs the polish+shortcut loop — see the e2e
> test). The **Windows** installer is produced by CI (cross-platform code + config) but has
> not been hand-tested on a Windows machine. The native voice bits (global hotkey, mic
> capture, system-wide paste) require OS permissions and are validated by a manual checklist
> (below) — everything around them is automated-tested.

---

## Architecture

```
Electron app (mac/win)            Supabase (local, → cloud later)         Providers
  hotkey (uiohook)                  Auth (GoTrue) + Postgres + RLS          STT: AWS Transcribe / OpenAI / mock
  mic → 16k PCM16 (engine)   ⇄ WS   Edge fn: stt-stream (WS proxy)    ⇄     LLM: OpenAI / Tensorix / Bedrock / mock
  overlay / settings / tray  ⇄ HTTP Edge fn: format (LLM proxy)
  inject text (nut.js)              data CRUD via supabase-js + RLS
```

Provider API keys live **only** in the backend. The app never sees them. See
`docs/superpowers/specs/` (design) and `docs/superpowers/research/` (verified SDK facts).

---

## Prerequisites

- **Node 20+** and npm
- **Docker** (for the local Supabase stack)
- **Supabase CLI** (`brew install supabase/tap/supabase`)

## Quick start (local, mock providers — no API keys)

```bash
npm install

# 1) start the local backend (Postgres + Auth + Edge Functions)
npm run backend:start          # supabase start
(cd backend && supabase db reset)   # apply migrations + seed system modes
npm run backend:serve          # serve edge functions (keep this running)

# 2) in another terminal, launch the app pointed at the local backend
npm run dev:local              # auto-loads local keys, runs the Electron app
```

Create an account in the onboarding window, grant Microphone / Accessibility / Input
Monitoring (macOS), then hold **F13** (default) and talk. With mock providers you'll get a
canned transcript polished by the mock LLM — proving the whole loop before any real key.

## Connecting a real model API

Edit `backend/supabase/functions/.env` (copy from `.env.example`), set the provider + key,
then restart `npm run backend:serve`. **No code changes.**

| Want | Set in `.env` |
|---|---|
| **OpenAI** (LLM) | `LLM_PROVIDER=openai-compatible`, `OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1`, `OPENAI_COMPAT_API_KEY=…`, `OPENAI_COMPAT_MODEL=gpt-4o-mini` |
| **Tensorix** (LLM, EU) | `LLM_PROVIDER=openai-compatible`, `OPENAI_COMPAT_BASE_URL=https://api.tensorix.ai/v1`, `OPENAI_COMPAT_API_KEY=…`, `OPENAI_COMPAT_MODEL=z-ai/glm-5.1` |
| **AWS Bedrock** (LLM) | `LLM_PROVIDER=bedrock`, `AWS_REGION=eu-west-1`, `AWS_ACCESS_KEY_ID/SECRET`, `BEDROCK_MODEL_ID=us.anthropic.claude-3-5-sonnet-20240620-v1:0` |
| **AWS Transcribe** (STT, streaming) | `STT_PROVIDER=aws-transcribe`, `AWS_REGION`, `AWS_ACCESS_KEY_ID/SECRET` |
| **OpenAI** (STT, buffered) | `STT_PROVIDER=openai`, `OPENAI_API_KEY=…`, `OPENAI_STT_MODEL=gpt-4o-transcribe` |

STT and LLM are independent — mix any pair (e.g. AWS Transcribe + Tensorix).

---

## Testing

```bash
npm test                       # unit tests (snippet, providers, session, secrets, resample)
npm run typecheck              # all workspaces

# integration + e2e need the local stack running and keys exported:
# export keys from `cd backend && supabase status -o json` (API_URL/ANON_KEY/SERVICE_ROLE_KEY):
SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
  npx vitest run backend/tests --no-file-parallelism   # RLS + format + stt-stream live-stack
npm run e2e                    # launches the real app, signs up, runs the format loop
```

Tests that need the live stack auto-skip when the keys aren't set, so `npm test` stays green
in CI without Docker.

## Building installers

```bash
npm run build:mac              # → apps/desktop/release/*.dmg + *.zip (unsigned beta)
npm run build:win              # → apps/desktop/release/*.exe  (run on Windows)
```

CI (`.github/workflows/`):
- **ci.yml** — typecheck + unit tests + `deno check` (+ a live Supabase integration job) on every push/PR.
- **build.yml** — on a `v*` tag, builds **macOS + Windows** installers and **publishes them to a
  GitHub Release** (manual `workflow_dispatch` builds artifacts without publishing).

## Auto-update (Windows + macOS)

Installed apps update themselves — no reinstall. The client (`electron-updater`) checks the
GitHub Release feed on launch and every 3 h, **downloads new versions in the background**, and
installs them on quit; the user can also click **Restart & update** (tray menu or Settings →
Advanced) to apply one immediately.

**One-time setup:**
1. Push this repo to GitHub and set `publish.owner`/`publish.repo` in
   `apps/desktop/electron-builder.yml` to your GitHub user + repo.
2. Releasing = bump the version and tag it:
   ```bash
   npm version patch -w @wisopen/desktop   # or minor/major → bumps apps/desktop/package.json
   git push --follow-tags                  # pushing the vX.Y.Z tag triggers build.yml
   ```
   CI builds both installers and publishes the GitHub Release; every installed app picks it up.

**Platform reality:**
- **Windows** — auto-update works immediately, even unsigned (first install may show a SmartScreen
  "unknown publisher" notice; an optional OV/EV cert via `WIN_CSC_*` removes it).
- **macOS** — auto-update **requires Apple code-signing + notarization** (Squirrel.Mac + Gatekeeper
  requirement; not bypassable). Needs an **Apple Developer account ($99/yr)**. Until configured, the
  Mac build is unsigned and does **not** auto-update. To enable it, add repo secrets `CSC_LINK`
  (base64 `.p12`), `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
  `APPLE_TEAM_ID` — `build.yml` then signs + notarizes automatically (no code change).

## Migrating to Supabase Cloud

```bash
supabase link --project-ref <ref>
supabase db push                                    # same migrations
supabase functions deploy format stt-stream         # stt-stream is verify_jwt=false (config.toml)
supabase secrets set --env-file backend/supabase/functions/.env
```
Then point the app at the cloud project: set `WISOPEN_SUPABASE_URL` + `WISOPEN_SUPABASE_ANON_KEY`.

---

## Manual checklist (native bits not covered by automation)

On a real machine with permissions granted:
- [ ] Global hotkey (F13 / your binding) starts/stops dictation.
- [ ] Mic captures; overlay shows live partials (streaming STT) or "transcribing…".
- [ ] Polished text is **pasted into the focused app** at the cursor.
- [ ] Shortcut triggers expand; dictionary terms are spelled correctly.
- [ ] Windows: build via CI, install, repeat the above.

## Project layout

```
apps/desktop      Electron app (main modules, engine/overlay/settings/onboarding renderers)
backend/supabase  migrations + seed + edge functions (format, stt-stream) + providers (incl. mock)
packages/shared   cross-tier types, IPC/DTO contracts, provider interfaces, snippet expander
docs/superpowers  design spec, pre-implementation research, implementation plan
```
