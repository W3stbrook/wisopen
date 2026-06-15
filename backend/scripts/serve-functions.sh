#!/usr/bin/env bash
# Serve the edge functions locally with hot reload. WS functions need --no-verify-jwt;
# both functions self-verify the JWT internally.
set -euo pipefail
cd "$(dirname "$0")/.."
supabase functions serve --no-verify-jwt --env-file supabase/functions/.env
