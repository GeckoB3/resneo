const DEFAULT_AUTH_NEXT = '/dashboard';
const DEFAULT_MAGIC_LINK_NEXT = '/auth/callback';

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
 * Magic-link API should only allow callback/dashboard style destinations.
 * This keeps links from being reused as an arbitrary in-app redirect primitive.
 */
export function sanitizeMagicLinkNextPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return DEFAULT_MAGIC_LINK_NEXT;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_MAGIC_LINK_NEXT;

  const next = sanitizeAuthNextPath(raw);
  if (
    next === '/auth/callback' ||
    next.startsWith('/auth/callback?') ||
    next === '/dashboard' ||
    next.startsWith('/dashboard?') ||
    next.startsWith('/dashboard/') ||
    next === '/onboarding' ||
    next.startsWith('/onboarding?') ||
    next.startsWith('/onboarding/') ||
    next === '/account' ||
    next.startsWith('/account?') ||
    next.startsWith('/account/') ||
    next === '/auth/choose-destination' ||
    next.startsWith('/auth/choose-destination?')
  ) {
    return next;
  }
  return DEFAULT_MAGIC_LINK_NEXT;
}
