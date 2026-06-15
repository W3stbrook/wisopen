// Deno-only auth helpers for edge functions. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are auto-injected into every function by the runtime.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2';

function url(): string {
  return Deno.env.get('SUPABASE_URL') ?? '';
}
function anon(): string {
  return Deno.env.get('SUPABASE_ANON_KEY') ?? '';
}
function serviceRole(): string {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

/** Validate a user JWT against the auth server. Returns the user id or null. */
export async function verifyJwt(token: string): Promise<{ userId: string } | null> {
  if (!token) return null;
  const client = createClient(url(), anon(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id };
}

/** RLS-scoped client (runs queries as the calling user). */
export function userClient(token: string): SupabaseClient {
  return createClient(url(), anon(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Service-role client (bypasses RLS) — used only for writing usage_events. */
export function adminClient(): SupabaseClient {
  return createClient(url(), serviceRole());
}
