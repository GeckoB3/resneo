const DEFAULT_AUTH_NEXT = '/dashboard';
const DEFAULT_MAGIC_LINK_NEXT = '/auth/callback';

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
  const next = raw.trim();
  if (!next.startsWith('/') || next.startsWith('//')) return DEFAULT_AUTH_NEXT;
  return next;
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
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_MAGIC_LINK_NEXT;

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
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
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
