import { createHmac } from 'crypto';

/** Mirrors `createBookingHmac` in src/lib/short-manage-link.ts for E2E (no Next.js imports). */
export function createBookingHmac(bookingId: string, secret: string): string {
  return createHmac('sha256', secret).update(`manage:${bookingId}`).digest('base64url');
}

export function buildConfirmPagePath(bookingId: string, secret: string): string {
  const hmac = createBookingHmac(bookingId, secret);
  return `/confirm/${bookingId}?hmac=${encodeURIComponent(hmac)}`;
}

/** Guest manage page (`/manage/[bookingId]/[token]`) — token may be HMAC. */
export function buildManagePagePath(bookingId: string, secret: string): string {
  const hmac = createBookingHmac(bookingId, secret);
  return `/manage/${bookingId}/${encodeURIComponent(hmac)}`;
}
