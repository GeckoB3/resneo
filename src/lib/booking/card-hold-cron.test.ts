import { describe, expect, it } from 'vitest';
import {
  CARD_HOLD_ONLINE_SOURCES,
  CARD_HOLD_STAFF_SOURCES,
  excludeBookingsWithHolds,
  isAbandonedSetupIntentStatus,
  isCardHoldChargeWindowExpired,
  normalizeEmbeddedBooking,
  partitionOnlineHoldCandidates,
} from './card-hold-cron';

describe('card-hold cron source sets (§12.1, load-bearing)', () => {
  it('online set covers direct flows (booking_page/widget) and class carts (online)', () => {
    expect([...CARD_HOLD_ONLINE_SOURCES].sort()).toEqual(['booking_page', 'online', 'widget']);
  });

  it('staff set includes walk-in (card holds, unlike deposits, allow walk-ins, D6)', () => {
    expect([...CARD_HOLD_STAFF_SOURCES].sort()).toEqual(['phone', 'walk-in']);
  });
});

describe('excludeBookingsWithHolds (§12.1/§12.2 sweep amendment)', () => {
  const bookings = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];

  it('drops bookings that have hold rows and keeps the rest in order', () => {
    expect(excludeBookingsWithHolds(bookings, ['b2'])).toEqual([{ id: 'b1' }, { id: 'b3' }]);
  });

  it('is a no-op when no booking has a hold', () => {
    expect(excludeBookingsWithHolds(bookings, [])).toEqual(bookings);
  });

  it('can empty the candidate list (every phone booking is card-hold-typed)', () => {
    expect(excludeBookingsWithHolds(bookings, ['b1', 'b2', 'b3'])).toEqual([]);
  });
});

describe('normalizeEmbeddedBooking', () => {
  it('unwraps a one-element embed array, passes objects through, nulls otherwise', () => {
    expect(normalizeEmbeddedBooking([{ id: 'b1' }])).toEqual({ id: 'b1' });
    expect(normalizeEmbeddedBooking({ id: 'b1' })).toEqual({ id: 'b1' });
    expect(normalizeEmbeddedBooking([])).toBeNull();
    expect(normalizeEmbeddedBooking(null)).toBeNull();
    expect(normalizeEmbeddedBooking(undefined)).toBeNull();
  });
});

describe('isAbandonedSetupIntentStatus (§12.1 online arm)', () => {
  it('treats requires_payment_method and canceled as definitively abandoned', () => {
    expect(isAbandonedSetupIntentStatus('requires_payment_method')).toBe(true);
    expect(isAbandonedSetupIntentStatus('canceled')).toBe(true);
  });

  it('waits on in-flight and terminal-success states', () => {
    expect(isAbandonedSetupIntentStatus('requires_action')).toBe(false);
    expect(isAbandonedSetupIntentStatus('processing')).toBe(false);
    expect(isAbandonedSetupIntentStatus('requires_confirmation')).toBe(false);
    expect(isAbandonedSetupIntentStatus('succeeded')).toBe(false);
    expect(isAbandonedSetupIntentStatus(null)).toBe(false);
    expect(isAbandonedSetupIntentStatus(undefined)).toBe(false);
  });
});

describe('partitionOnlineHoldCandidates (§12.1 capture modes)', () => {
  it('groups setup-mode rows by SetupIntent (one Stripe lookup per capture unit)', () => {
    const rows = [
      { stripe_setup_intent_id: 'seti_1', booking: { stripe_payment_intent_id: null } },
      { stripe_setup_intent_id: 'seti_1', booking: { stripe_payment_intent_id: null } },
      { stripe_setup_intent_id: 'seti_2', booking: { stripe_payment_intent_id: null } },
    ];
    const { setupModeBySetupIntent, paymentWithSetup } = partitionOnlineHoldCandidates(rows);
    expect([...setupModeBySetupIntent.keys()].sort()).toEqual(['seti_1', 'seti_2']);
    expect(setupModeBySetupIntent.get('seti_1')).toHaveLength(2);
    expect(setupModeBySetupIntent.get('seti_2')).toHaveLength(1);
    expect(paymentWithSetup).toEqual([]);
  });

  it('routes NULL-SI rows with a unit PI to payment_with_setup', () => {
    const piRow = { stripe_setup_intent_id: null, booking: { stripe_payment_intent_id: 'pi_1' } };
    const { setupModeBySetupIntent, paymentWithSetup } = partitionOnlineHoldCandidates([piRow]);
    expect(setupModeBySetupIntent.size).toBe(0);
    expect(paymentWithSetup).toEqual([piRow]);
  });

  it('drops rows with neither intent (nothing to check yet)', () => {
    const { setupModeBySetupIntent, paymentWithSetup } = partitionOnlineHoldCandidates([
      { stripe_setup_intent_id: null, booking: { stripe_payment_intent_id: null } },
    ]);
    expect(setupModeBySetupIntent.size).toBe(0);
    expect(paymentWithSetup).toEqual([]);
  });

  it('setup mode wins when a row somehow carries both intents', () => {
    const row = { stripe_setup_intent_id: 'seti_9', booking: { stripe_payment_intent_id: 'pi_9' } };
    const { setupModeBySetupIntent, paymentWithSetup } = partitionOnlineHoldCandidates([row]);
    expect(setupModeBySetupIntent.get('seti_9')).toEqual([row]);
    expect(paymentWithSetup).toEqual([]);
  });
});

describe('isCardHoldChargeWindowExpired (§12.3 expiry predicate)', () => {
  const now = Date.parse('2026-07-05T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('expires a hold whose booking ended more than 14 days ago', () => {
    expect(
      isCardHoldChargeWindowExpired(
        { booking_date: '2026-06-01', booking_time: '18:00', booking_end_time: '20:00' },
        now,
      ),
    ).toBe(true);
  });

  it('keeps a hold inside the window (booking ended less than 14 days ago)', () => {
    expect(
      isCardHoldChargeWindowExpired(
        { booking_date: '2026-06-25', booking_time: '18:00', booking_end_time: '20:00' },
        now,
      ),
    ).toBe(false);
  });

  it('flips exactly when the derived window boundary passes', () => {
    // Ends 2026-06-21T12:00Z; window ends 2026-07-05T12:00Z, exactly `now`.
    const booking = { booking_date: '2026-06-21', booking_time: '10:00', booking_end_time: '12:00' };
    expect(isCardHoldChargeWindowExpired(booking, now)).toBe(false);
    expect(isCardHoldChargeWindowExpired(booking, now + 60_000)).toBe(true);
  });

  it('derives the end via resolveCardHoldBookingEndIso: overnight ends roll to the next day', () => {
    // 23:00 -> 01:00 rolls to 2026-06-22T01:00Z, so the window ends
    // 2026-07-06T01:00Z. A same-day (unrolled) end would already be expired at
    // 2026-07-06T00:59Z; the rolled end is not.
    const overnight = { booking_date: '2026-06-21', booking_time: '23:00', booking_end_time: '01:00' };
    expect(isCardHoldChargeWindowExpired(overnight, Date.parse('2026-07-06T00:59:00.000Z'))).toBe(false);
    expect(isCardHoldChargeWindowExpired(overnight, Date.parse('2026-07-06T01:01:00.000Z'))).toBe(true);
  });

  it('falls back to estimated_end_time, then the start, when no wall-clock end exists', () => {
    expect(
      isCardHoldChargeWindowExpired(
        {
          booking_date: '2026-06-01',
          booking_time: '18:00',
          booking_end_time: null,
          estimated_end_time: '2026-06-01T19:30:00.000Z',
        },
        now,
      ),
    ).toBe(true);
    expect(
      isCardHoldChargeWindowExpired(
        { booking_date: '2026-06-30', booking_time: '18:00' },
        now,
      ),
    ).toBe(false);
  });

  it('never expires a hold whose booking schedule cannot be parsed', () => {
    expect(
      isCardHoldChargeWindowExpired(
        { booking_date: 'not-a-date', booking_time: 'nope' },
        now + 365 * DAY_MS,
      ),
    ).toBe(false);
  });
});
