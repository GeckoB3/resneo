import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';

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

/**
 * Like {@link createRouteHandlerClient}, but reads the `Authorization: Bearer`
 * token from the ambient request via `next/headers` instead of an explicit
 * `request` argument. Lets shared helpers (e.g. resolveLinkAdmin) and no-arg
 * `GET()` handlers honour mobile Bearer auth without threading `request`
 * through every signature. Falls back to cookies (web dashboard) exactly as
 * `createClient`, so existing cookie sessions are unaffected.
 */
export async function createRouteHandlerClientFromHeaders() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const bearer = headerStore.get('authorization')?.match(/^Bearer\s+(\S+)/i)?.[1]?.trim();
  const { supabaseUrl, supabasePublishableKey } = getSupabaseServerEnv();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: cookieAdapter(cookieStore),
    global: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
  });
}
