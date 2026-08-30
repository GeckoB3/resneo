'use client';

import {
  GuestBookingDetailView,
  type GuestBookingDetailActor,
} from '@/components/booking/GuestBookingDetailView';

/**
 * The emailed manage link's booking page.
 *
 * Everything it used to render moved to `GuestBookingDetailView` (P2-4, AD9),
 * which the portal renders too. What is left is the only thing that was ever
 * specific to this surface: which proof the reader holds. The HMAC is the `/m/`
 * short link, the token is the one-time link in a confirmation email.
 *
 * P2-4's acceptance is that this file contains no JSX beyond mounting the
 * shared component, so that the cancellation and refund copy has exactly one
 * rendering and the two surfaces cannot drift apart.
 */
export function ManageBookingView({
  bookingId,
  token,
  hmac,
}: {
  bookingId: string;
  token?: string;
  hmac?: string;
}) {
  const actor: GuestBookingDetailActor = hmac
    ? { kind: 'hmac', hmac }
    : { kind: 'token', token: token ?? '' };

  return <GuestBookingDetailView bookingId={bookingId} actor={actor} />;
}
