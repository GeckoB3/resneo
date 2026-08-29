/**
 * Who is looking at a booking, and what proof they hold (P2-4, AD9).
 *
 * The token and HMAC actors are the emailed manage link and the `/m/` short
 * link. The session actor is the portal, which has already proved ownership
 * server-side and therefore carries no proof in the browser at all.
 *
 * This lives in `lib/` rather than beside `GuestBookingDetailView`, which is
 * where P2-4 declared it, because `AppointmentBookingFlow` needs it too and
 * that view imports the flow: taking it from the view would be a cycle. The
 * view re-exports it so nothing that already imports it there had to change.
 */
export type GuestBookingDetailActor =
  | { kind: 'token'; token: string }
  | { kind: 'hmac'; hmac: string }
  | { kind: 'session' };
