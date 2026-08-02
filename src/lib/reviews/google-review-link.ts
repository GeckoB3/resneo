/**
 * Resolve whatever a venue pastes into a link that opens Google's "write a review" dialog.
 *
 * Venues do not know what a Place ID is. They paste a Maps search result, a share link, or the
 * short link from their Business Profile, and a wrong link fails silently inside an email nobody
 * sees fail. So we accept the forms that genuinely carry a review target, normalise them, and
 * reject everything else loudly rather than emitting a link that lands somewhere useless.
 *
 * Deliberately no rating parameter: Google's review dialog cannot be pre-set to a star count, so a
 * rating picker in the email could only ever decide who is shown this link, which is review gating
 * and against Google's policies.
 */

/** Place IDs are long, URL-safe and unpadded; short strings are almost certainly something else. */
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{15,}$/;

/** `https://g.page/r/<id>/review` ids are not Place IDs and cannot be converted to one. */
const G_PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

export function buildGoogleReviewUrlFromPlaceId(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/**
 * Canonical review URL for a pasted value, or null when nothing usable is present.
 *
 * Accepts a bare Place ID, a `search.google.com/local/writereview` link, and a `g.page/r/…` short
 * link. A plain Maps place or search URL is rejected: it identifies the business but carries no
 * review target, and guessing one would produce a link that quietly goes to the wrong place.
 */
export function normaliseGoogleReviewUrl(raw: string | null | undefined): string | null {
  const input = (raw ?? '').trim();
  if (!input) return null;

  if (!input.includes('/') && !input.includes(':')) {
    return PLACE_ID_PATTERN.test(input) ? buildGoogleReviewUrlFromPlaceId(input) : null;
  }

  let url: URL;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();

  if (host === 'search.google.com' && url.pathname.startsWith('/local/writereview')) {
    const placeId = url.searchParams.get('placeid')?.trim();
    if (placeId && PLACE_ID_PATTERN.test(placeId)) return buildGoogleReviewUrlFromPlaceId(placeId);
    return null;
  }

  if (host === 'g.page') {
    // `/r/<id>/review`, or `/r/<id>` which we complete. Anything else on g.page is a profile link
    // rather than a review target.
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'r' && parts[1] && G_PAGE_ID_PATTERN.test(parts[1])) {
      return `https://g.page/r/${parts[1]}/review`;
    }
    return null;
  }

  return null;
}

/** True when the venue's stored value will produce a working review link. */
export function hasUsableGoogleReviewLink(raw: string | null | undefined): boolean {
  return normaliseGoogleReviewUrl(raw) !== null;
}

/** What to tell a venue that pasted something we cannot use. */
export const GOOGLE_REVIEW_LINK_HELP =
  'Paste your Google review link (it looks like https://g.page/r/... /review) or your Place ID. A Maps search link will not work, because it does not open the review box.';
