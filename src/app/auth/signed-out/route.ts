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
 *
 * Why an HTML interstitial instead of a 302 redirect: a 3xx response that ALSO
 * carries `Clear-Site-Data: "cache"` is mishandled by several mobile browsers
 * (iOS WebKit and some Android in-app WebViews) — they clear the cache and then
 * drop the redirect, stranding the user on the page they signed out from. A 200
 * HTML page reliably renders, clears site data via the header all the same, and
 * navigates to `next` three independent ways: a meta refresh, a script-driven
 * `location.replace`, and a tappable fallback link if both are blocked.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  // Internal paths only — never redirect off-origin from a logout link, and
  // reject anything carrying characters that could break out of the HTML
  // attribute / JS string contexts below.
  const rawNext = url.searchParams.get('next') ?? '/login';
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') && !/[<>"'\s]/.test(rawNext)
      ? rawNext
      : '/login';

  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    /* Best effort — the client normally signed out already. */
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${next}">
<title>Signing out…</title>
<script>window.location.replace(${JSON.stringify(next)});</script>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         display: flex; min-height: 100vh; align-items: center; justify-content: center;
         color: #475569; background: #f8fafc; }
  a { color: #4f46e5; font-weight: 600; }
</style>
</head>
<body>
<p>Signing out… <a href="${next}">Continue to sign in</a> if you are not redirected.</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Clear-Site-Data': '"cache", "storage"',
    },
  });
}
