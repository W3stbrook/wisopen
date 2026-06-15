#!/usr/bin/env bash
# Start the local Supabase stack for Wisopen.
set -euo pipefail
cd "$(dirname "$0")/.."
supabase start
echo
echo "Local stack up. Keys (legacy JWT for supabase-js):"
supabase status -o json | grep -E 'API_URL|ANON_KEY' || supabase status
