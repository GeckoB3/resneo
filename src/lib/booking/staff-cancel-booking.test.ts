import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
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
function makeDb(opts: { booking: BookingRow; groupRows?: BookingRow[] }): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'events') {
        return { insert: async () => ({ error: null }) };
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
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
