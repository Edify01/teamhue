/**
 * Build-time configuration.
 *
 * These are injected by `scripts/build.mjs` from your `.env` file.
 * The anon key is safe to ship: it is a public, RLS-gated key. NEVER put the
 * service-role key here — it would grant full database access to anyone who
 * unzips the extension.
 */

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export const SUPABASE_URL: string = __SUPABASE_URL__;
export const SUPABASE_ANON_KEY: string = __SUPABASE_ANON_KEY__;

export const IS_CONFIGURED =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.startsWith('https://') &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.length > 20;

/** How often the background worker does a full reconciliation pull (minutes). */
export const SYNC_INTERVAL_MINUTES = 5;
