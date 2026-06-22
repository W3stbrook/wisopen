// apiClient — wraps supabase-js (auth + RLS CRUD) and the `format` edge-function call.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AuthStatus,
  FormatRequest,
  FormatResponse,
  Snippet,
  DictionaryTerm,
  Mode,
} from '@wisopen/shared';
import { getConfig } from './config.js';
import { SecretSessionStorage, type SecretStore } from './secrets.js';

export class ApiClient {
  readonly supabase: SupabaseClient;

  constructor(secret: SecretStore) {
    const { supabaseUrl, supabaseAnonKey } = getConfig();
    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'wisopen-auth',
        // supabase-js accepts a sync storage adapter
        storage: new SecretSessionStorage(secret) as unknown as Storage,
      },
    });
  }

  async status(): Promise<AuthStatus> {
    const { data } = await this.supabase.auth.getSession();
    const u = data.session?.user;
    return { signedIn: Boolean(u), email: u?.email ?? null, userId: u?.id ?? null };
  }

  async signInPassword(email: string, password: string): Promise<AuthStatus> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return this.status();
  }

  async signUpPassword(email: string, password: string): Promise<AuthStatus> {
    const { error } = await this.supabase.auth.signUp({ email, password });
    if (error) throw error;
    return this.status();
  }

  async signInOtp(email: string): Promise<{ sent: boolean }> {
    const { error } = await this.supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'wisopen://auth-callback' },
    });
    if (error) throw error;
    return { sent: true };
  }

  async exchangeCode(code: string): Promise<AuthStatus> {
    const { error } = await this.supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return this.status();
  }

  async signOut(): Promise<AuthStatus> {
    const { error } = await this.supabase.auth.signOut();
    // Already signed out / stale session — treat as success for the UI.
    if (error && !/session/i.test(error.message)) throw error;
    return this.status();
  }

  async getJwt(): Promise<string | null> {
    const { data } = await this.supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  onChange(cb: (s: AuthStatus) => void): void {
    this.supabase.auth.onAuthStateChange(() => {
      void this.status().then(cb);
    });
  }

  // ---- edge function: format ----
  async callFormat(req: FormatRequest): Promise<FormatResponse> {
    const jwt = await this.getJwt();
    if (!jwt) throw new Error('not signed in');
    const { supabaseUrl, supabaseAnonKey } = getConfig();
    const res = await fetch(`${supabaseUrl}/functions/v1/format`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`format failed: ${res.status}`);
    return (await res.json()) as FormatResponse;
  }

  // ---- RLS-protected CRUD ----
  async listSnippets(): Promise<Snippet[]> {
    const { data } = await this.supabase.from('snippets').select('*').order('created_at');
    return (data ?? []) as Snippet[];
  }
  async upsertSnippet(s: Partial<Snippet> & { trigger: string; expansion: string }): Promise<Snippet> {
    const { userId } = await this.status();
    const row = {
      ...(s.id ? { id: s.id } : {}),
      user_id: userId,
      trigger: s.trigger,
      expansion: s.expansion,
      enabled: s.enabled ?? true,
      match_mode: s.match_mode ?? 'phrase',
    };
    const { data, error } = await this.supabase
      .from('snippets')
      .upsert(row, { onConflict: 'user_id,trigger' })
      .select()
      .single();
    if (error) throw error;
    return data as Snippet;
  }
  async deleteSnippet(id: string): Promise<void> {
    await this.supabase.from('snippets').delete().eq('id', id);
  }

  async listDictionary(): Promise<DictionaryTerm[]> {
    const { data } = await this.supabase.from('dictionary_terms').select('*').order('created_at');
    return (data ?? []) as DictionaryTerm[];
  }
  async upsertTerm(t: Partial<DictionaryTerm> & { term: string }): Promise<DictionaryTerm> {
    const { userId } = await this.status();
    const row = {
      ...(t.id ? { id: t.id } : {}),
      user_id: userId,
      term: t.term,
      sounds_like: t.sounds_like ?? [],
      enabled: t.enabled ?? true,
    };
    const { data, error } = await this.supabase
      .from('dictionary_terms')
      .upsert(row, { onConflict: 'user_id,term' })
      .select()
      .single();
    if (error) throw error;
    return data as DictionaryTerm;
  }
  async deleteTerm(id: string): Promise<void> {
    await this.supabase.from('dictionary_terms').delete().eq('id', id);
  }

  async listModes(): Promise<Mode[]> {
    const { data } = await this.supabase
      .from('modes')
      .select('*')
      .order('is_system', { ascending: false })
      .order('name');
    return (data ?? []) as Mode[];
  }
  async upsertMode(m: Partial<Mode> & { name: string; prompt_template: string }): Promise<Mode> {
    const { userId } = await this.status();
    const row = {
      ...(m.id ? { id: m.id } : {}),
      user_id: userId,
      name: m.name,
      description: m.description ?? null,
      prompt_template: m.prompt_template,
      is_system: false,
    };
    const { data, error } = await this.supabase.from('modes').upsert(row).select().single();
    if (error) throw error;
    return data as Mode;
  }
  async deleteMode(id: string): Promise<void> {
    // RLS only permits deleting own non-system modes
    await this.supabase.from('modes').delete().eq('id', id);
  }

  /** Persist a completed dictation server-side (RLS) for cross-device history. */
  async insertDictation(d: {
    raw_transcript: string;
    final_text: string;
    mode_id: string | null;
    lang: string | null;
    audio_seconds: number | null;
  }): Promise<void> {
    const { userId } = await this.status();
    const { error } = await this.supabase.from('dictations').insert({ user_id: userId, ...d });
    if (error) console.warn('[dictations] insert failed', error.message);
  }
}
