const DEFAULT_AUTH_NEXT = '/dashboard';
const DEFAULT_MAGIC_LINK_NEXT = '/auth/callback';

/**
 * Origin used only to resolve candidate redirects. Never navigated to; `.invalid`
 * is reserved by RFC 2606 and cannot resolve.
 */
const SAME_ORIGIN_PROBE = 'https://resneo.invalid';

/**
 * Returns `raw` as a same-origin path, or null if it can escape the origin.
 *
 * A prefix check is not sufficient here. `"/"` followed by a backslash, a tab or a
 * newline all survive `startsWith('/') && !startsWith('//')` and are then resolved
 * by the WHATWG URL parser as protocol-relative, so `/\evil.com` navigates to
 * https://evil.com. Verified against Node's parser, which is the same one
 * `new URL()` uses in `NextResponse.redirect` and `router.push`.
 *
 * So: strip the control characters the parser would ignore, resolve against a
 * probe origin, and accept only what stayed on it. Path traversal is normalised
 * away by the parser as a side benefit.
 */
function toSameOriginPath(raw: string): string | null {
  // Drop C0 controls and DEL by code point. The URL parser ignores these, so a
  // tab or newline inside a candidate could otherwise smuggle a leading '//'
  // past a textual prefix check.
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim();
  if (!cleaned.startsWith('/')) return null;
  try {
    const url = new URL(cleaned, SAME_ORIGIN_PROBE);
    if (url.origin !== SAME_ORIGIN_PROBE) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Same-origin guard for callers outside this module (the login page and form,
 * which previously used a raw `redirectTo` or none at all).
 */
export function safeSameOriginPath(
  raw: string | null | undefined,
  fallback: string,
): string {
  if (!raw || typeof raw !== 'string') return fallback;
  return toSameOriginPath(raw) ?? fallback;
}

function authNextPathOnly(raw: string): string {
  return raw.split('?')[0]?.split('#')[0] ?? raw;
}

export function isPublicBookingAuthReturnPath(raw: string): boolean {
  const pathOnly = authNextPathOnly(raw);
  return (
    pathOnly === '/book' ||
    pathOnly.startsWith('/book/') ||
    pathOnly === '/embed' ||
    pathOnly.startsWith('/embed/')
  );
}

/**
 * Signup-funnel steps a half-finished signup can be safely resumed to after auth.
 * Used to honour an explicit resume target (e.g. /login?redirectTo=/signup/payment)
 * that the generic post-login routing would otherwise drop.
 */
export function isSignupResumePath(raw: string): boolean {
  const pathOnly = authNextPathOnly(raw);
  return (
    pathOnly === '/signup/payment' ||
    pathOnly === '/signup/booking-models' ||
    pathOnly === '/signup/business-type' ||
    pathOnly === '/signup/plan'
  );
}

function isAllowedMagicLinkDestination(pathWithOptionalQuery: string): boolean {
  const pathOnly = authNextPathOnly(pathWithOptionalQuery);
  return (
    pathOnly === '/auth/callback' ||
    pathOnly.startsWith('/auth/callback/') ||
    pathOnly === '/dashboard' ||
    pathOnly.startsWith('/dashboard/') ||
    pathOnly === '/onboarding' ||
    pathOnly.startsWith('/onboarding/') ||
    pathOnly === '/account' ||
    pathOnly.startsWith('/account/') ||
    pathOnly === '/signup' ||
    pathOnly.startsWith('/signup/') ||
    pathOnly === '/book' ||
    pathOnly.startsWith('/book/') ||
    pathOnly === '/embed' ||
    pathOnly.startsWith('/embed/') ||
    pathOnly === '/auth/choose-destination' ||
    pathOnly.startsWith('/auth/choose-destination/') ||
    pathOnly === '/super' ||
    pathOnly.startsWith('/super/') ||
    pathOnly === '/sales' ||
    pathOnly.startsWith('/sales/')
  );
}

/**
 * Restricts open redirects from auth query params to same-origin paths only.
 */
export function sanitizeAuthNextPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return DEFAULT_AUTH_NEXT;
  return toSameOriginPath(raw) ?? DEFAULT_AUTH_NEXT;
}

/**
 * Unwraps `/auth/callback?next=…` values used by branded magic-link emails.
 */
export function resolveAuthNextPath(raw: string | null | undefined): string {
  let next = sanitizeAuthNextPath(raw ?? undefined);
  if (next.startsWith('/auth/callback?')) {
    const query = next.slice('/auth/callback?'.length);
    const inner = new URLSearchParams(query).get('next');
    if (inner) {
      next = sanitizeAuthNextPath(decodeURIComponent(inner));
    }
  }
  return next;
}

/**
 * Magic-link API should only allow callback/dashboard style destinations.
 * This keeps links from being reused as an arbitrary in-app redirect primitive.
 */
export function sanitizeMagicLinkNextPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return DEFAULT_MAGIC_LINK_NEXT;
  const trimmed = toSameOriginPath(raw);
  if (trimmed === null) return DEFAULT_MAGIC_LINK_NEXT;

  if (trimmed.startsWith('/auth/callback?')) {
    return sanitizeAuthNextPath(trimmed);
  }

  if (isAllowedMagicLinkDestination(trimmed)) {
    return trimmed;
  }
  return DEFAULT_MAGIC_LINK_NEXT;
}

/**
 * Normalises the `next` field for POST /api/auth/send-magic-link.
 * Clients should send the final post-login path (e.g. `/account`); this wraps it as
 * `/auth/callback?next=…` when needed so `/auth/confirm` receives a single, correctly encoded
 * redirect target (avoids double-encoding when the client already passed `/auth/callback?next=…`).
 */
export function buildMagicLinkConfirmNextQuery(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return DEFAULT_MAGIC_LINK_NEXT;
  }
  const trimmed = toSameOriginPath(raw);
  if (trimmed === null) {
    return DEFAULT_MAGIC_LINK_NEXT;
  }
  if (trimmed === DEFAULT_MAGIC_LINK_NEXT || trimmed.startsWith(`${DEFAULT_MAGIC_LINK_NEXT}?`)) {
    return sanitizeMagicLinkNextPath(trimmed);
  }
  const dest = sanitizeMagicLinkNextPath(trimmed);
  if (dest === DEFAULT_MAGIC_LINK_NEXT || dest.startsWith(`${DEFAULT_MAGIC_LINK_NEXT}?`)) {
    return dest;
  }
  return `${DEFAULT_MAGIC_LINK_NEXT}?next=${encodeURIComponent(dest)}`;
}
