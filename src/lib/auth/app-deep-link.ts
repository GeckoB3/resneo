/**
 * Handing an email link off to the ResNeo mobile app.
 *
 * Email templates cannot link to `resneo://` directly. Supabase renders them with Go's
 * `html/template`, which refuses any scheme outside its safe list in an `href` and
 * substitutes the marker `ZgotmplZ`, producing a dead link. Click-tracking rewriters
 * (SendGrid) also only understand http(s).
 *
 * So the templates link to `{{ .SiteURL }}/auth/confirm` over https and carry the app's
 * deep link as a *query value* (`&redirect_to={{ .RedirectTo }}`), where Go percent-encodes
 * it instead of filtering it. `/auth/confirm` then bounces the browser to the app.
 *
 * The bounce deliberately does NOT verify the token first: it is single-use, and the app
 * must be the one to spend it. A useful side effect is that link scanners that fetch the
 * https URL no longer burn the link before the recipient opens it.
 */

/** The app's URL scheme (`app.json` -> expo.scheme). Two slashes, per `Linking.createURL`. */
export const APP_DEEP_LINK_PREFIX = 'resneo://';

/** OTP types the app's callback screen knows how to complete. */
const APP_OTP_TYPES = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change']);

/**
 * Is this `redirect_to` a link into the mobile app? Matched by exact scheme prefix, never
 * by substring: an allowlist of one, so a hostile `redirect_to` cannot turn this route into
 * an open redirector to some other scheme.
 */
export function isAppDeepLink(redirectTo: string | null | undefined): boolean {
  return typeof redirectTo === 'string' && redirectTo.startsWith(APP_DEEP_LINK_PREFIX);
}

/** The deep link the app's `app/(auth)/callback.tsx` completes via `verifyOtp`. */
export function buildAppCallbackUrl(tokenHash: string, type: string): string | null {
  // GoTrue token hashes are hex. Anything else arrived from a crafted URL, not from an
  // email we sent, so refuse it at the source rather than relying on downstream escaping.
  if (!tokenHash || !/^[A-Za-z0-9_-]{1,255}$/.test(tokenHash) || !APP_OTP_TYPES.has(type)) {
    return null;
  }
  const params = new URLSearchParams({ token_hash: tokenHash, type });
  return `${APP_DEEP_LINK_PREFIX}callback?${params.toString()}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Interstitial that opens the app. A plain 302 to a custom scheme is unreliable: mobile
 * browsers routinely drop redirects to non-http schemes that no one tapped. So this tries
 * automatically and still gives the reader something to tap when that is blocked.
 *
 * Self-contained by design. No external requests, and `no-referrer` so the one-time token
 * in this URL is never sent to another origin.
 */
export function renderAppHandoffPage(deepLink: string, signInUrl: string): string {
  const href = escapeHtml(deepLink);
  const webHref = escapeHtml(signInUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Opening the ResNeo app</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f8fafc; color:#0f172a; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:22rem; padding:2rem 1.5rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; color:#003B6F; }
  p { margin:0 0 1.5rem; line-height:1.5; color:#475569; }
  a.button { display:inline-block; padding:.75rem 1.5rem; border-radius:.75rem; background:#003B6F;
             color:#fff; font-weight:600; text-decoration:none; }
  a.alt { display:inline-block; margin-top:1.25rem; color:#475569; font-size:.875rem; }
</style>
</head>
<body>
<main>
  <h1>Opening the ResNeo app</h1>
  <p>If the app does not open on its own, tap the button below.</p>
  <p><a id="app-link" class="button" href="${href}">Open the ResNeo app</a></p>
  <a class="alt" href="${webHref}">Sign in on the web instead</a>
</main>
<script>
  // Read the target from the DOM rather than interpolating it into this script. Serialising
  // a URL into a script block is not safe by escaping alone: a "</script>" inside the value
  // ends the element regardless of JavaScript string quoting. The href above is the single
  // place the link appears, and it is HTML-escaped.
  // location.replace keeps this page out of the back stack, so going back does not re-fire
  // a link that has already been spent.
  var appLink = document.getElementById('app-link');
  if (appLink) { window.location.replace(appLink.href); }
</script>
</body>
</html>`;
}
