import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

function cookieAdapter(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      } catch {
        // setAll from Server Component; middleware will refresh session
      }
    },
  };
}

function getSupabaseServerEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase URL or publishable key is not configured.');
  }

  return { supabaseUrl, supabasePublishableKey };
}

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Uses cookies for session (magic link). Use this for authenticated dashboard flows.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabasePublishableKey } = getSupabaseServerEnv();

  return createServerClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookies: cookieAdapter(cookieStore),
    },
  );
}

/**
 * Route Handler client: session cookies plus optional `Authorization: Bearer <access_token>`
 * for mobile or API clients that do not send Supabase cookie headers.
 */
export async function createRouteHandlerClient(request: Request) {
  const cookieStore = await cookies();
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)/i)?.[1]?.trim();
  const { supabaseUrl, supabasePublishableKey } = getSupabaseServerEnv();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: cookieAdapter(cookieStore),
    global: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
  });
}
