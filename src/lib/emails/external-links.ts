/**
 * Shared external-link helpers for transactional emails (booking confirmations, etc.).
 * Kept separate from `calendar-links.ts` so these helpers remain framework-agnostic and
 * trivially unit-testable.
 */

/**
 * Build a Google Maps "directions" URL for the venue address.
 * Uses the search/place form `?api=1&query=` which works on web, iOS and Android maps apps,
 * including handing off to native Maps when installed.
 *
 * Returns null when the address is empty/whitespace so callers can omit the button entirely.
 */
export function buildGoogleMapsDirectionsUrl(address: string | null | undefined): string | null {
  const a = (address ?? '').trim();
  if (!a) return null;
  const params = new URLSearchParams({ api: '1', query: a });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Normalise a stored business website URL for safe use in `<a href="…">`.
 * Mirrors the storage normaliser in `lib/urls/website-url.ts` but is tolerant of legacy
 * unprefixed values that may exist in older rows.
 *
 * Returns null when the input is empty or cannot be coerced to an http(s) URL.
 */
export function normalizeWebsiteUrlForLink(raw: string | null | undefined): string | null {
  let t = (raw ?? '').trim();
  if (!t) return null;
  if (t.startsWith('//')) {
    t = `https:${t}`;
  } else if (!/^https?:\/\//i.test(t)) {
    t = `https://${t}`;
  }
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}
