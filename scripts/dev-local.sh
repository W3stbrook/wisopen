#!/usr/bin/env bash
# Launch the desktop app in dev against the local Supabase stack, auto-loading keys.
set -euo pipefail
cd "$(dirname "$0")/.."
STATUS=$(cd backend && supabase status -o json)
read_key() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s)["'"$1"'"])||""))'; }
export WISOPEN_SUPABASE_URL=$(printf '%s' "$STATUS" | read_key API_URL)
export WISOPEN_SUPABASE_ANON_KEY=$(printf '%s' "$STATUS" | read_key ANON_KEY)
if [ -z "$WISOPEN_SUPABASE_URL" ] || [ -z "$WISOPEN_SUPABASE_ANON_KEY" ]; then
  echo "Could not read local Supabase keys. Run 'npm run backend:start' first." >&2
  exit 1
fi
echo "Launching Wisopen against $WISOPEN_SUPABASE_URL"
npm --workspace @wisopen/desktop run dev
