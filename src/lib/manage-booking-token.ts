import { createBookingHmac, resolveShortManageBookingId } from '@/lib/short-manage-link';

export function resolveManageBookingToken(token: string): { bookingId: string; hmac: string } | null {
  const bookingId = resolveShortManageBookingId(token);
  if (!bookingId) return null;
  return { bookingId, hmac: createBookingHmac(bookingId) };
}
