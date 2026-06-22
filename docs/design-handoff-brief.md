# Wisopen — Design handoff per Cloud Design

Brief operativo per ridisegnare l'UI desktop (macOS, dark theme) mantenendo information architecture e vincoli Electron.

## Prodotto

App menu bar macOS per dettatura vocale globale. Core loop: hotkey → parli → testo pulito incollato al cursore. Modalità ibrida: **hold** = push-to-talk; **double-tap** = hands-free.

**Tone:** calmo, nativo macOS, minimalismo scuro. **Lingua UI:** inglese primaria (struttura i18n-friendly).

**Fuori scope:** backend, landing, Windows, light theme, OAuth, billing, engine audio (nessuna UI).

## Superfici UI (3)

### 1. Settings — 720×700 (min 640×560)

Sidebar **220 px**, due sezioni:

| App | Settings |
|-----|----------|
| Home | Dictation |
| Dictionary | Modes |
| Snippets | General |
| History | Privacy |
| | Account |

Content max-width ~560 px. Title bar macOS `hiddenInset`, traffic lights x:16 y:18.

### 2. Onboarding — 480×680, 6 step

Welcome → Account → Microphone → System Access → Hotkey → Try It

Footer: Back / Skip / Next / Open Wisopen. Hotkey = **press-to-record** (mai text input).

### 3. Overlay pill — 280×64 (error: 340×72)

Frameless, trasparente, bottom-center (~80 px dal bordo). Stati:

`listening` · `transcribing` · `polishing` · `inserting` · `done` · `error` · `cancelled` · `idle`

## Token attuali (punto di partenza)

```
bg #0c0e12 · panel #14171e / #1a1e28 · border #262b36
fg #f0f2f6 · muted #8b939f · accent #5b8cff · success #3dd68c · danger #ff5c72
radius card 12px · body 14px · h1 22px weight 650
```

## Deliverables richiesti

- Figma: design system + components + tutte le schermate/stati
- Figma Variables → export JSON tokens
- SVG: logo, tray icon 22×22, icone nav 18×18 (no unicode)
- Prototipo: onboarding + dictation overlay states
- Spec: window sizes, spacing scale, overlay positioning, timing auto-hide

## Struttura Figma suggerita

```
Wisopen Design System
├── Tokens
├── Components (Button, Input, Card, Nav, Hotkey capture, Overlay pill, …)
├── Screens (Settings ×9, Onboarding ×6, Overlay ×8 stati)
└── Prototypes
```

## Mappa integrazione dev

| Figma | Codebase |
|-------|----------|
| Tokens | `apps/desktop/src/renderers/shared-ui/app.css` |
| Shell | `shared-ui/shell.css` |
| Settings | `settings/settings.ts` + `index.html` |
| Onboarding | `onboarding/*` |
| Overlay | `overlay/*` |
| Tray icon | `apps/desktop/src/main/tray.ts` |

**Invarianti:** stessi `id` DOM e IPC (`hotkey:capture`, `overlay:state`, view ids `home`/`dictation`/…).

## Riferimenti repo

- UI attuale: `apps/desktop/src/renderers/`
- Spec onboarding: `docs/superpowers/specs/2026-06-21-onboarding-ux-redesign.md`
- Spec prodotto: `docs/superpowers/specs/2026-06-15-wisopen-voice-dictation-design.md`

## Checklist pre-handoff

- [ ] Screenshot/video app in uso
- [ ] Scope confermato: macOS dark, 3 superfici
- [ ] Hotkey = press-to-record
- [ ] Milestone e criteri accettazione definiti

## Checklist post-design (integrazione)

- [ ] Token JSON + tutti gli stati overlay
- [ ] 9 viste settings + empty states
- [ ] 6 step onboarding + errori auth/permessi
- [ ] SVG logo + tray + icone nav
- [ ] `npm run dev:local` smoke + Playwright
