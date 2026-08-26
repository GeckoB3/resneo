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
 * Interstitial that opens the app.
 *
 * A plain 302 to a custom scheme is unreliable: mobile browsers routinely drop redirects to
 * non-http schemes that nobody tapped. So this tries automatically and still gives the
 * reader something to tap when that is blocked. Most people never see it.
 *
 * Two rules for the emitted markup, both learned the hard way:
 *  - No comments or prose inside the inline script. A closing script tag anywhere in that
 *    text, even inside a JavaScript comment, ends the element then and there, spilling the
 *    remainder onto the page as visible text and silently killing the redirect.
 *  - The link appears exactly once, HTML-escaped, in the href. The script reads it back off
 *    the DOM instead of having it interpolated in, so nothing attacker-influencable is ever
 *    serialised into a script context.
 *
 * Self-contained: no external requests, and no-referrer so the single-use token in this
 * URL is never sent to another origin.
 */
export function renderAppHandoffPage(deepLink: string, signInUrl: string): string {
  const href = escapeHtml(deepLink);
  const webHref = escapeHtml(signInUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light">
<title>Opening the ResNeo app</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       padding:1.5rem;background:#f6f8fb;color:#0f172a;
       font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
  main{width:100%;max-width:20rem;text-align:center}
  .mark{width:2.75rem;height:2.75rem;margin:0 auto 1.25rem;border-radius:.875rem;
        background:#003B6F;position:relative}
  .mark::after{content:"";position:absolute;left:50%;top:50%;width:.9rem;height:.9rem;
               margin:-.45rem 0 0 -.45rem;border-radius:50%;background:#00C2C7}
  h1{margin:0 0 .5rem;font-size:1.125rem;font-weight:600;color:#003B6F}
  p{margin:0 0 1.5rem;color:#5b6b7f;font-size:.9375rem}
  .btn{display:block;padding:.875rem 1.25rem;border-radius:.75rem;background:#003B6F;
       color:#fff;font-weight:600;text-decoration:none}
  .alt{display:inline-block;margin-top:1.25rem;color:#5b6b7f;font-size:.875rem}
</style>
</head>
<body>
<main>
  <div class="mark"></div>
  <h1>Opening the ResNeo app</h1>
  <p>If it does not open on its own, tap below.</p>
  <a id="app-link" class="btn" href="${href}">Open the ResNeo app</a>
  <a class="alt" href="${webHref}">Sign in on the web instead</a>
</main>
<script>var a=document.getElementById("app-link");if(a){window.location.replace(a.href);}</script>
</body>
</html>`;
}
