import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, IS_CONFIGURED } from '@/shared/config';
import { STORAGE_KEYS } from '@/shared/types';

/**
 * Supabase auth normally persists to `localStorage`, which does not exist in an
 * MV3 service worker. We swap in a `chrome.storage.local` adapter so the session
 * survives service-worker restarts and is shared across every surface of the
 * extension (popup, options, background).
 */
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const res = await chrome.storage.local.get(key);
    return (res[key] as string | undefined) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!IS_CONFIGURED) {
    throw new Error(
      'TeamHue is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to your .env and rebuild.',
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: chromeStorageAdapter,
        storageKey: STORAGE_KEYS.session,
        persistSession: true,
        autoRefreshToken: true,
        // There is no OAuth redirect inside a service worker.
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
      global: {
        headers: { 'x-client-info': 'teamhue-extension/1.0.0' },
      },
      realtime: {
        params: { eventsPerSecond: 5 },
      },
    });
  }
  return client;
}

export function isConfigured(): boolean {
  return IS_CONFIGURED;
}

/** Converts a Supabase/Postgres error into a message a human can act on. */
export function friendlyError(err: unknown): string {
  const msg =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);

  if (/Invalid login credentials/i.test(msg)) return 'That email or password is incorrect.';
  if (/User already registered/i.test(msg)) return 'An account already exists for that email. Try signing in.';
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email address, then sign in.';
  if (/Password should be at least/i.test(msg)) return 'Password must be at least 6 characters.';
  if (/duplicate key value/i.test(msg)) return 'That already exists.';
  if (/No workspace found/i.test(msg)) return 'No workspace matches that join code. Double-check it and try again.';
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) {
    return 'Cannot reach the server. Check your internet connection.';
  }
  if (/JWT|not authenticated|Not authenticated/i.test(msg)) return 'Your session expired. Please sign in again.';
  if (/row-level security/i.test(msg)) return 'You do not have permission to do that.';
  return msg || 'Something went wrong.';
}
