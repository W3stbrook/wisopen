// Integration-test helpers. Tests gate on `liveStack` so they are skipped when the
// local Supabase stack isn't running (keeps `npm test` green in CI without Docker).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const ANON = process.env.SUPABASE_ANON_KEY ?? '';
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const FUNCTIONS_URL =
  process.env.FUNCTIONS_URL ?? (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '');
export const liveStack = Boolean(SUPABASE_URL && ANON && SERVICE);

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
}
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
}

export interface TestUser {
  client: SupabaseClient;
  userId: string;
  jwt: string;
  email: string;
}

export async function makeUser(): Promise<TestUser> {
  const email = `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}@wisopen.test`;
  const password = 'password123!';
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2 || !s.session) throw e2 ?? new Error('no session');
  return { client, userId: data.user!.id, jwt: s.session.access_token, email };
}
