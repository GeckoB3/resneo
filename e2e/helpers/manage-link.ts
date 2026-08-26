import { createHmac } from 'crypto';

/**
 * Mirrors `createBookingHmac` in `src/lib/short-manage-link.ts` for E2E (no Next.js imports).
 *
 * Format: `${expEpochSeconds}.${sigOver("manage:"+bookingId+":"+expEpoch)}`, matching
 * `bookingHmacSignature`. The legacy expiry-less shape (`manage:${bookingId}` with no
 * `${exp}.` prefix) is **rejected** by `verifyBookingHmac` after
 * `LEGACY_MANAGE_LINK_ACCEPT_UNTIL_MS` (2026-08-01), which is why this helper mints the
 * expiring form. Keep `BOOKING_HMAC_TTL_SEC` in step with the server constant.
 */
const BOOKING_HMAC_TTL_SEC = 60 * 60 * 24 * 30;

export function createBookingHmac(bookingId: string, secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + BOOKING_HMAC_TTL_SEC;
  const sig = createHmac('sha256', secret)
    .update(`manage:${bookingId}:${exp}`)
    .digest('base64url');
  return `${exp}.${sig}`;
}

export function buildConfirmPagePath(bookingId: string, secret: string): string {
  const hmac = createBookingHmac(bookingId, secret);
  return `/confirm/${bookingId}?hmac=${encodeURIComponent(hmac)}`;
}

/**
 * Guest manage page. Must use the `?hmac=` route (`/manage/[bookingId]`), not the
 * `[token]` path segment: `/manage/[bookingId]/[token]/page.tsx` forwards its segment to
 * `ManageBookingView` as `token`, which `/api/confirm` checks against
 * `bookings.confirm_token_hash`. An HMAC placed there can never match.
 */
export function buildManagePagePath(bookingId: string, secret: string): string {
  const hmac = createBookingHmac(bookingId, secret);
  return `/manage/${bookingId}?hmac=${encodeURIComponent(hmac)}`;
}
