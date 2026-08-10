import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bookingCaptureUnitOwesCapture } from './booking-owes-capture';

type RecordedCall = {
  table: string;
  filters: Array<[string, string, unknown]>;
};

function makeAdmin(
  bookings: Array<Record<string, unknown>>,
  holds: Array<Record<string, unknown>>,
  opts: { bookingsError?: boolean } = {},
) {
  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, filters: [] };
      const builder: Record<string, unknown> = {};
      const chain = (fn?: (...args: unknown[]) => void) =>
        (...args: unknown[]) => {
          fn?.(...args);
          return builder;
        };
      builder.select = chain();
      for (const op of ['eq', 'in', 'is'] as const) {
        builder[op] = chain((k, v) => call.filters.push([op, k as string, v]));
      }
      const respond = () => {
        if (table === 'bookings' && opts.bookingsError) {
          return { data: null, error: { message: 'boom' } };
        }
        const rows = table === 'bookings' ? bookings : holds;
        return {
          data: rows.filter((row) =>
            call.filters.every(([op, key, value]) => {
              const actual = row[key];
              if (op === 'eq') return actual === value;
              if (op === 'in') return Array.isArray(value) && value.includes(actual);
              if (op === 'is') return value === null ? actual == null : actual === value;
              return true;
            }),
          ),
          error: null,
        };
      };
      builder.then = (resolve: (v: unknown) => unknown, reject: (r?: unknown) => unknown) =>
        Promise.resolve(respond()).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
  return admin;
}

const PARAMS = { bookingId: 'b1', venueId: 'venue-1', groupBookingId: null };

describe('bookingCaptureUnitOwesCapture', () => {
  it('owes for a Pending money deposit', async () => {
    const admin = makeAdmin(
      [{ id: 'b1', venue_id: 'venue-1', deposit_status: 'Pending', deposit_amount_pence: 2000 }],
      [],
    );
    const result = await bookingCaptureUnitOwesCapture(admin, PARAMS);
    expect(result.owes).toBe(true);
    expect(result.depositStatus).toBe('Pending');
    expect(result.depositAmountPence).toBe(2000);
    expect(result.owingBookingIds).toEqual(['b1']);
  });

  it('owes for a Failed deposit (a failed attempt does not settle the debt)', async () => {
    const admin = makeAdmin(
      [{ id: 'b1', venue_id: 'venue-1', deposit_status: 'Failed', deposit_amount_pence: 2000 }],
      [],
    );
    const result = await bookingCaptureUnitOwesCapture(admin, PARAMS);
    expect(result.owes).toBe(true);
    expect(result.depositStatus).toBe('Failed');
  });

  it('owes for an open unsaved card hold with no money deposit', async () => {
    const admin = makeAdmin(
      [{ id: 'b1', venue_id: 'venue-1', deposit_status: 'Pending', deposit_amount_pence: null }],
      [
        {
          booking_id: 'b1',
          fee_pence: 2500,
          released_at: null,
          stripe_payment_method_id: null,
        },
      ],
    );
    const result = await bookingCaptureUnitOwesCapture(admin, PARAMS);
    expect(result.owes).toBe(true);
    expect(result.cardHoldFeePence).toBe(2500);
  });

  it('does not owe when the hold is released or saved', async () => {
    const admin = makeAdmin(
      [{ id: 'b1', venue_id: 'venue-1', deposit_status: 'Pending', deposit_amount_pence: null }],
      [
        {
          booking_id: 'b1',
          fee_pence: 2500,
          released_at: '2026-08-01T00:00:00.000Z',
          stripe_payment_method_id: null,
        },
      ],
    );
    const result = await bookingCaptureUnitOwesCapture(admin, PARAMS);
    expect(result.owes).toBe(false);
  });

  it('does not owe for Paid, Waived or Not Required deposits', async () => {
    for (const status of ['Paid', 'Waived', 'Not Required', 'Card Held']) {
      const admin = makeAdmin(
        [{ id: 'b1', venue_id: 'venue-1', deposit_status: status, deposit_amount_pence: 2000 }],
        [],
      );
      const result = await bookingCaptureUnitOwesCapture(admin, PARAMS);
      expect(result.owes).toBe(false);
    }
  });

  it('a group unit owes when ANY sibling owes, summing the amounts', async () => {
    const admin = makeAdmin(
      [
        { id: 'b1', venue_id: 'venue-1', group_booking_id: 'grp1', deposit_status: 'Paid', deposit_amount_pence: 1500 },
        { id: 'b2', venue_id: 'venue-1', group_booking_id: 'grp1', deposit_status: 'Pending', deposit_amount_pence: 2000 },
        { id: 'b3', venue_id: 'venue-1', group_booking_id: 'grp1', deposit_status: 'Failed', deposit_amount_pence: 1000 },
      ],
      [],
    );
    const result = await bookingCaptureUnitOwesCapture(admin, {
      bookingId: 'b1',
      venueId: 'venue-1',
      groupBookingId: 'grp1',
    });
    expect(result.owes).toBe(true);
    expect(result.depositAmountPence).toBe(3000);
    expect(result.unitBookingIds.sort()).toEqual(['b1', 'b2', 'b3']);
    expect(result.owingBookingIds.sort()).toEqual(['b2', 'b3']);
  });

  it('fails closed (owes) when the unit read errors', async () => {
    const admin = makeAdmin([], [], { bookingsError: true });
    const result = await bookingCaptureUnitOwesCapture(admin, PARAMS);
    expect(result.owes).toBe(true);
  });
});
