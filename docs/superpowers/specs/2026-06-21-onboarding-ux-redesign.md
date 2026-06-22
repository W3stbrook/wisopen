# Wisopen — Onboarding & Login UX Redesign

**Date:** 2026-06-21  
**Status:** Implemented (v1)  
**Research:** [ce-web-researcher session](af1bb3a8-9076-4da4-aa5d-2dfd6ba1108a)

## Problem

The first-run experience showed all steps at once (auth + permissions + hotkey) in stacked cards. Users faced technical jargon, no narrative, no progressive disclosure, and permission requests without context — a classic activation killer.

## Design thesis

**Calm macOS-native minimalism with Wispr-style doubt reduction:** one decision per screen, functional visuals (mic level, permission status), verb-led CTAs, skip for power users after account creation.

## Flow (6 screens)

| Step | Job | CTA |
|------|-----|-----|
| 1 Welcome | Promise + category clarity | "Get started" |
| 2 Account | Unified sign-in / sign-up | "Create account" / "Sign in" |
| 3 Microphone | Pre-permission education → OS prompt | "Test your microphone" |
| 4 System access | Accessibility + input monitoring (why + deep link) | "Open System Settings" |
| 5 Hotkey | Pick push-to-talk shortcut | "Save hotkey" |
| 6 Try it | First dictation + finish | "Open Wisopen" |

**Skip:** "Skip setup" available after sign-in (steps 3–5) — opens app without blocking.

## Copy principles

- Headlines name the outcome, not the feature ("Your voice, in any app").
- CTAs are verb + artifact ("Test your microphone", not "Continue").
- Permission screens explain benefit before OS dialog.
- Errors are human-readable; success states are specific.

## Visual

- Max width ~400px content column, centered.
- Progress dots (6), no "Step 4 of 16".
- System font stack (`-apple-system`), existing dark tokens from `app.css`.
- Subtle entrance animation (150ms fade/slide).
- Permission rows: icon + title + one-line why + status pill.

## Anti-patterns avoided

- All steps visible at once
- Raw OS permission with no primer
- Separate "Sign in" vs "Sign up" pages
- Emoji in primary headline
- "Get started" on every screen

## Future (v2)

- Google / Apple OAuth (auth layer ready via Supabase)
- Magic link as primary (IPC `auth:signInOtp` exists)
- Live mic waveform during test step
- Mock Slack/email context for first dictation (Wispr-style)
- Resume onboarding from settings if permissions missing
- i18n (en/it)

## Verification

- Playwright smoke: `#email`, `#password`, `#signup`, `#authMsg`
- Manual: macOS permission grant/deny paths, skip flow, back navigation
