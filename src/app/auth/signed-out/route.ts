import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /auth/signed-out — final hop of the logout flow (see signOutCleanly).
 *
 * Responds with `Clear-Site-Data: "cache", "storage"` so supporting browsers
 * drop the HTTP cache, Cache Storage, localStorage, IndexedDB and service
 * worker registrations for the origin — flushing any data cached while the
 * previous account was signed in before the next account signs in on the same
 * browser. Cookies are not cleared by the header; `signOut()` handles those
 * (and runs again here server-side in case the client-side call failed).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  // Internal paths only — never redirect off-origin from a logout link.
  const rawNext = url.searchParams.get('next') ?? '/login';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/login';

  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    /* Best effort — the client normally signed out already. */
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  response.headers.set('Clear-Site-Data', '"cache", "storage"');
  return response;
}
