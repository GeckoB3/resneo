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
 * Embed URL for an iframe map preview (no API key).
 *
 * The query is the business name followed by the address. When Google can match that to a
 * Business Profile the embed's card shows the name, address and star rating; when it cannot,
 * it falls back to a pin at the address exactly as an address-only query does. The keyless
 * embed ignores Place IDs, so the name is the only way to reach the listing's rating.
 */
export function buildGoogleMapsEmbedUrl(
  address: string | null | undefined,
  placeName?: string | null,
): string | null {
  const a = (address ?? '').trim();
  if (!a) return null;
  const name = (placeName ?? '').trim();
  const query = name ? `${name}, ${a}` : a;
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
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
