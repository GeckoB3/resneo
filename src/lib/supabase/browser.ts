import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for Client Components. Uses cookies for session (magic link).
 * Use this in dashboard UI that needs auth (e.g. realtime, mutations).
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase URL or publishable key is not configured.');
  }

  return createBrowserClient(
    supabaseUrl,
    supabasePublishableKey,
  );
}
