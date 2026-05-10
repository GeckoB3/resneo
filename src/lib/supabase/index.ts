import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Read env at call time so Server Components get request-time env (fixes Turbopack/.env.local loading). */
function getEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local in the project root and restart the dev server (npm run dev).'
    );
  }
  if (!supabasePublishableKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. Add it to .env.local and restart the dev server.');
  }
  return { supabaseUrl, supabasePublishableKey, supabaseSecretKey };
}

let browserClient: SupabaseClient | undefined;
let adminClient: SupabaseClient | undefined;

export const getSupabaseClient = (): SupabaseClient => {
  if (!browserClient) {
    const { supabaseUrl, supabasePublishableKey } = getEnv();
    browserClient = createClient(supabaseUrl, supabasePublishableKey);
  }
  return browserClient;
};

/**
 * Server-only Supabase client using the secret key.
 * Do not import this into client components or any browser code.
 */
export const getSupabaseAdminClient = (): SupabaseClient => {
  if (!adminClient) {
    const { supabaseUrl, supabaseSecretKey } = getEnv();
    if (!supabaseSecretKey) {
      throw new Error('SUPABASE_SECRET_KEY is not set. Add it to .env.local and restart the dev server.');
    }
    adminClient = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false },
    });
  }
  return adminClient;
};

