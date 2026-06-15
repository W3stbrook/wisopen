// Backend connection + runtime config. Read from env so switching local <-> cloud
// is a config change, not a code change.

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  sampleRate: number;
  updateFeedUrl?: string;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  cached = {
    supabaseUrl: process.env.WISOPEN_SUPABASE_URL || 'http://127.0.0.1:54321',
    supabaseAnonKey: process.env.WISOPEN_SUPABASE_ANON_KEY || '',
    sampleRate: 16000,
    updateFeedUrl: process.env.WISOPEN_UPDATE_FEED || undefined,
  };
  return cached;
}

/** test seam */
export function __setConfigForTest(c: AppConfig | null): void {
  cached = c;
}
