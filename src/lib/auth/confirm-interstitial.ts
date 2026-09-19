/**
 * The page a web sign-in link lands on BEFORE anything is verified.
 *
 * A sign-in link is a single-use token, and `/auth/confirm` used to spend it on the plain
 * GET the link produced. Corporate mail security (Outlook Safe Links, Mimecast, Proofpoint)
 * and some consumer clients fetch every link in a message before the recipient sees it, so
 * the scanner spent the token and the customer's own click was told the link had "already
 * been used or has expired". The portal token and the app hand-off already avoided this;
 * the ordinary web link did not.
 *
 * So the GET renders this page and the verification happens on a POST from it. The form
 * submits itself the moment the page runs, so almost nobody sees it, and the button is
 * there for a browser with scripting off. A scanner that only fetches never submits.
 *
 * Same two rules as the app hand-off page (`renderAppHandoffPage`): nothing but the
 * values, HTML-escaped, ever reaches the markup, and the inline script carries no prose.
 * The token sits in the page, so it is served no-store with no referrer.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ConfirmInterstitialParams {
  /** Where the form posts: the confirm route itself, on this origin. */
  action: string;
  tokenHash: string;
  type: string;
  /** The caller's post-login path, already reduced to a same-origin path, or null. */
  next: string | null;
  /** The sign-in page, for the escape hatch. */
  signInUrl: string;
}

export function renderConfirmInterstitial(params: ConfirmInterstitialParams): string {
  const hidden = [
    ['token_hash', params.tokenHash],
    ['type', params.type],
    ...(params.next ? [['next', params.next] as [string, string]] : []),
  ]
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('\n    ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light">
<title>Signing you in to ResNeo</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       padding:1.5rem;background:#f6f8fb;color:#0f172a;
       font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
  main{width:100%;max-width:20rem;text-align:center}
  .mark{display:block;width:3.5rem;height:3.5rem;margin:0 auto 1.25rem}
  h1{margin:0 0 .5rem;font-size:1.125rem;font-weight:600;color:#003B6F}
  p{margin:0 0 1.5rem;color:#5b6b7f;font-size:.9375rem}
  .btn{display:block;width:100%;padding:.875rem 1.25rem;border:0;border-radius:.75rem;background:#003B6F;
       color:#fff;font:inherit;font-weight:600;cursor:pointer}
  .alt{display:inline-block;margin-top:1.25rem;color:#5b6b7f;font-size:.875rem}
</style>
</head>
<body>
<main>
  <img class="mark" src="/apple-icon.png" alt="" width="56" height="56">
  <h1>Signing you in</h1>
  <p>One moment. If nothing happens, press the button.</p>
  <form id="confirm" method="post" action="${escapeHtml(params.action)}">
    ${hidden}
    <button class="btn" type="submit">Continue to ResNeo</button>
  </form>
  <a class="alt" href="${escapeHtml(params.signInUrl)}">Sign in another way</a>
</main>
<script>var f=document.getElementById("confirm");if(f){f.submit();}</script>
</body>
</html>`;
}
