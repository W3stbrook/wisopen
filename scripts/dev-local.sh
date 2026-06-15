#!/usr/bin/env bash
# Launch the desktop app in dev against the local Supabase stack, auto-loading keys.
set -euo pipefail
cd "$(dirname "$0")/.."
# `-o env` is the stable shell-consumption format (API_URL/ANON_KEY/...)
eval "$(cd backend && supabase status -o env)"
export WISOPEN_SUPABASE_URL="${API_URL:-}"
export WISOPEN_SUPABASE_ANON_KEY="${ANON_KEY:-}"
if [ -z "$WISOPEN_SUPABASE_URL" ] || [ -z "$WISOPEN_SUPABASE_ANON_KEY" ]; then
  echo "Could not read local Supabase keys. Run 'npm run backend:start' first." >&2
  exit 1
fi
echo "Launching Wisopen against $WISOPEN_SUPABASE_URL"
npm --workspace @wisopen/desktop run dev
