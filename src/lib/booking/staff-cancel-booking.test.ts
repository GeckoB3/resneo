import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { stripe } from '@/lib/stripe';
import { cancelStaffBookingWithNotify } from './staff-cancel-booking';

vi.mock('@/lib/stripe', () => ({
  stripe: { refunds: { create: vi.fn() } },
}));
vi.mock('@/lib/booking/card-hold-release', () => ({
  releaseCardHoldsForBookings: vi.fn(async () => ({ releasedBookingIds: [], deletedCustomerIds: [] })),
}));
vi.mock('@/lib/table-management/lifecycle', () => ({
  applyBookingLifecycleStatusEffects: vi.fn(async () => undefined),
  validateBookingStatusTransition: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/lib/emails/booking-email-enrichment', () => ({
  enrichBookingEmailForComms: vi.fn(async (_a: unknown, _b: unknown, e: unknown) => e),
}));
vi.mock('@/lib/communications/send-templated', () => ({
  sendCancellationNotification: vi.fn(async () => undefined),
}));
vi.mock('@/lib/booking/offer-appointment-waitlist-on-cancel', () => ({
  offerAppointmentWaitlistOnCancel: vi.fn(async () => ({ offered: false })),
}));
vi.mock('@/lib/class-commerce/booking-was-credit-paid', () => ({
  bookingWasCreditPaid: vi.fn(async () => false),
  bookingWasMembershipPaid: vi.fn(async () => false),
}));
vi.mock('@/lib/class-commerce/restore-class-credits', () => ({
  restoreClassCreditsForBooking: vi.fn(async () => ({ ok: true, restoredCredits: 0 })),
}));
vi.mock('@/lib/class-commerce/restore-membership-allowance', () => ({
  restoreMembershipAllowanceForBooking: vi.fn(async () => ({ restoredSessions: 0 })),
}));
vi.mock('@/lib/communications/send-class-commerce', () => ({
  sendClassCommerceComm: vi.fn(async () => undefined),
}));

const releaseMock = releaseCardHoldsForBookings as unknown as Mock;
const refundCreateMock = stripe.refunds.create as unknown as Mock;

type BookingRow = Record<string, unknown>;

function baseBooking(overrides: BookingRow = {}): BookingRow {
  return {
    id: 'b1',
    venue_id: 'venue-1',
    guest_id: 'g1',
    status: 'Booked',
    group_booking_id: null,
    stripe_payment_intent_id: null,
    deposit_status: 'Pending',
    deposit_amount_pence: null,
    cancellation_deadline: null,
    booking_date: '2026-07-10',
    booking_time: '18:00:00',
    party_size: 2,
    ...overrides,
  };
}

/** Chain double for the staffDb/admin usage in cancelStaffBookingWithNotify. */
function makeDb(opts: {
  booking: BookingRow;
  groupRows?: BookingRow[];
  /**
   * Rows sharing the booking's PaymentIntent, as `planSharedDepositRefund`
   * reads them. Distinct from `groupRows`, which the helper narrows to
   * cancellable statuses: a sibling that is already Completed still holds its
   * paid deposit on the shared intent and must not be refunded.
   */
  piRows?: BookingRow[];
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'events') {
        return { insert: async () => ({ error: null }) };
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: async () => ({ data: opts.piRows ?? opts.groupRows ?? [], error: null }),
        in: async () => ({ data: opts.groupRows ?? [], error: null }),
        update: () => ({ in: async () => ({ error: null }) }),
        single: async () => {
          if (table === 'bookings') return { data: opts.booking, error: null };
          if (table === 'venues') {
            return {
              data: {
                name: 'Venue One',
                address: null,
                phone: null,
                booking_rules: null,
                email: null,
                reply_to_email: null,
                stripe_connected_account_id: 'acct_1',
              },
              error: null,
            };
          }
          if (table === 'guests') {
            return {
              data: { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', phone: null },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cancelStaffBookingWithNotify card-hold release', () => {
  it('releases holds for the cancelled booking with reason cancelled', async () => {
    const booking = baseBooking();
    const admin = makeDb({ booking, groupRows: [booking] });
    const staffDb = makeDb({ booking, groupRows: [booking] });

    const result = await cancelStaffBookingWithNotify(admin, staffDb, 'venue-1', 'b1', {
      actorId: 'staff-1',
    });

    expect(result.cancelled).toBe(true);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(admin, ['b1'], 'cancelled');
  });

  it('releases per sibling row on a group cancel', async () => {
    const booking = baseBooking({ group_booking_id: 'grp-1' });
    const groupRows = [
      baseBooking({ id: 'b1', group_booking_id: 'grp-1' }),
      baseBooking({ id: 'b2', group_booking_id: 'grp-1' }),
    ];
    const admin = makeDb({ booking, groupRows });
    const staffDb = makeDb({ booking, groupRows });

    const result = await cancelStaffBookingWithNotify(admin, staffDb, 'venue-1', 'b1', {
      actorId: null,
    });

    expect(result.cancelled).toBe(true);
    expect(releaseMock).toHaveBeenCalledWith(admin, ['b1', 'b2'], 'cancelled');
  });

  it('still cancels when the hold release throws (best-effort)', async () => {
    releaseMock.mockRejectedValueOnce(new Error('release failed'));
    const booking = baseBooking();
    const admin = makeDb({ booking });
    const staffDb = makeDb({ booking });

    const result = await cancelStaffBookingWithNotify(admin, staffDb, 'venue-1', 'b1', {
      actorId: 'staff-1',
    });

    expect(result.cancelled).toBe(true);
  });

  it('does not release holds when the booking is not cancellable', async () => {
    const booking = baseBooking({ status: 'Cancelled' });
    const admin = makeDb({ booking });
    const staffDb = makeDb({ booking });

    const result = await cancelStaffBookingWithNotify(admin, staffDb, 'venue-1', 'b1', {
      actorId: 'staff-1',
    });

    expect(result.cancelled).toBe(false);
    expect(releaseMock).not.toHaveBeenCalled();
  });
});

describe('cancelStaffBookingWithNotify shared-deposit refund amount (C11)', () => {
  const FUTURE = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  function refundableRow(overrides: BookingRow = {}): BookingRow {
    return baseBooking({
      stripe_payment_intent_id: 'pi_shared',
      deposit_status: 'Paid',
      deposit_amount_pence: 1000,
      cancellation_deadline: FUTURE,
      ...overrides,
    });
  }

  it('refunds only the cancelled rows share when a paid sibling survives', async () => {
    // Two attendees on one £20 intent. The sibling is already Completed, so it
    // is not cancellable and keeps its deposit; refunding the whole intent
    // would hand back money that was earned.
    const booking = refundableRow({ id: 'b1', group_booking_id: 'grp-1' });
    const groupRows = [refundableRow({ id: 'b1', group_booking_id: 'grp-1' })];
    const piRows = [
      refundableRow({ id: 'b1' }),
      refundableRow({ id: 'b2', status: 'Completed' }),
    ];
    const admin = makeDb({ booking, groupRows, piRows });
    const staffDb = makeDb({ booking, groupRows, piRows });

    const result = await cancelStaffBookingWithNotify(admin, staffDb, 'venue-1', 'b1', {
      actorId: 'staff-1',
    });

    expect(result.cancelled).toBe(true);
    expect(refundCreateMock).toHaveBeenCalledTimes(1);
    const [params, options] = refundCreateMock.mock.calls[0]!;
    expect(params).toMatchObject({ payment_intent: 'pi_shared', amount: 1000 });
    expect(options.idempotencyKey).toMatch(/^deposit_refund:pi_shared:/);
  });

  it('omits the amount when every paid row on the intent is being cancelled', async () => {
    // A full group cancel must stay byte-identical to the old behaviour: no
    // amount, so Stripe returns the whole remaining balance.
    const booking = refundableRow({ id: 'b1', group_booking_id: 'grp-1' });
    const rows = [
      refundableRow({ id: 'b1', group_booking_id: 'grp-1' }),
      refundableRow({ id: 'b2', group_booking_id: 'grp-1' }),
    ];
    const admin = makeDb({ booking, groupRows: rows, piRows: rows });
    const staffDb = makeDb({ booking, groupRows: rows, piRows: rows });

    const result = await cancelStaffBookingWithNotify(admin, staffDb, 'venue-1', 'b1', {
      actorId: 'staff-1',
    });

    expect(result.cancelled).toBe(true);
    expect(refundCreateMock).toHaveBeenCalledTimes(1);
    const [params] = refundCreateMock.mock.calls[0]!;
    expect(params).toEqual({ payment_intent: 'pi_shared' });
    expect(params).not.toHaveProperty('amount');
  });

  it('leaves the booking uncancelled when the refund fails', async () => {
    refundCreateMock.mockRejectedValueOnce(new Error('card_declined'));
    const booking = refundableRow({ id: 'b1' });
    const admin = makeDb({ booking, groupRows: [booking], piRows: [booking] });
    const staffDb = makeDb({ booking, groupRows: [booking], piRows: [booking] });

    const result = await cancelStaffBookingWithNotify(admin, staffDb, 'venue-1', 'b1', {
      actorId: 'staff-1',
    });

    expect(result.cancelled).toBe(false);
    expect(result.refundFailed).toBe(true);
  });
});
