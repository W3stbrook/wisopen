#!/usr/bin/env bash
# Serve the edge functions locally with hot reload. WS functions need --no-verify-jwt;
# both functions self-verify the JWT internally.
set -euo pipefail
cd "$(dirname "$0")/.."
# self-heal: create functions/.env from the example on first run so it never serves
# with missing config (defaults to mock providers — runs with zero real keys).
if [ ! -f supabase/functions/.env ]; then
  cp supabase/functions/.env.example supabase/functions/.env
  echo "Created supabase/functions/.env from .env.example (mock providers; edit to add real keys)."
fi
supabase functions serve --no-verify-jwt --env-file supabase/functions/.env
