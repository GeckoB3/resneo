import {
  cardHoldChargeWindowEndsAtForBooking,
  type CardHoldWindowBookingFields,
} from '@/lib/booking/card-hold-window';

/**
 * Pure pieces of the card-hold cron sweeps (docs:
 * CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §12.1-§12.3), extracted so the
 * predicates are unit-testable without a Supabase or Stripe double.
 *
 * Source values are load-bearing (§12.1): the direct public flows post
 * `source: 'booking_page'` (or `'widget'` when embedded); ONLY the class-cart
 * orchestrator writes `'online'`. Staff flows post `'phone'` or `'walk-in'`
 * (walk-ins can carry card holds, unlike deposits, D6).
 */

export const CARD_HOLD_ONLINE_SOURCES = ['online', 'widget', 'booking_page'] as const;
export const CARD_HOLD_STAFF_SOURCES = ['phone', 'walk-in'] as const;

/**
 * §12.1/§12.2: the existing phone deposit sweeps must EXCLUDE card-hold
 * bookings (a hold row means the booking is card-hold-typed: wrong reason,
 * wrong guest copy, and a phantom £5.00 deposit otherwise). Keeps the input
 * order, so any limit applied by the caller's query is unaffected.
 */
export function excludeBookingsWithHolds<T extends { id: string }>(
  bookings: T[],
  holdBookingIds: Iterable<string>,
): T[] {
  const held = new Set(holdBookingIds);
  return bookings.filter((b) => !held.has(b.id));
}

/**
 * PostgREST returns an embedded `bookings!inner(...)` resource as an object or
 * a one-element array depending on relationship detection; normalise to one row.
 */
export function normalizeEmbeddedBooking<B>(booking: B | B[] | null | undefined): B | null {
  if (Array.isArray(booking)) return booking[0] ?? null;
  return booking ?? null;
}

/**
 * §12.1 online arm, setup mode: a SetupIntent in one of these states means the
 * guest definitively abandoned the capture (never submitted, or the SI was
 * cancelled). `requires_action` / `processing` are in-flight and must wait for
 * the next sweep.
 */
export function isAbandonedSetupIntentStatus(status: string | null | undefined): boolean {
  return status === 'requires_payment_method' || status === 'canceled';
}

export interface OnlineHoldCandidate {
  /** `booking_card_holds.stripe_setup_intent_id`: set in setup mode, NULL in payment_with_setup mode. */
  stripe_setup_intent_id: string | null;
  booking: { stripe_payment_intent_id?: string | null };
}

/**
 * §12.1 online 30-minute arm: split open unsaved holds into their capture
 * modes. Setup-mode rows are grouped by SetupIntent (all rows of a capture
 * unit share the SI, so one Stripe lookup covers the unit); payment_with_setup
 * rows (NULL SI, booking carries the unit's PI) feed the widened PI-status
 * sweep. Rows with neither intent have nothing to check yet and are dropped.
 */
export function partitionOnlineHoldCandidates<T extends OnlineHoldCandidate>(
  rows: T[],
): { setupModeBySetupIntent: Map<string, T[]>; paymentWithSetup: T[] } {
  const setupModeBySetupIntent = new Map<string, T[]>();
  const paymentWithSetup: T[] = [];
  for (const row of rows) {
    if (row.stripe_setup_intent_id) {
      const group = setupModeBySetupIntent.get(row.stripe_setup_intent_id) ?? [];
      group.push(row);
      setupModeBySetupIntent.set(row.stripe_setup_intent_id, group);
    } else if (row.booking.stripe_payment_intent_id) {
      paymentWithSetup.push(row);
    }
  }
  return { setupModeBySetupIntent, paymentWithSetup };
}

/**
 * §12.3 expiry sweep predicate: the hold's charge window (booking end +
 * CARD_HOLD_CHARGE_WINDOW_DAYS, derived, never stored) has passed. A booking
 * whose schedule cannot be parsed never auto-expires (the inline release paths
 * remain the backstop for such rows).
 */
export function isCardHoldChargeWindowExpired(
  booking: CardHoldWindowBookingFields,
  nowMs: number = Date.now(),
): boolean {
  const endsAt = cardHoldChargeWindowEndsAtForBooking(booking);
  if (!endsAt) return false;
  return new Date(endsAt).getTime() < nowMs;
}
