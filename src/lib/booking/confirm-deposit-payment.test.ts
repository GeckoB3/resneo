import { describe, expect, it, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  confirmBookingsForSucceededPaymentIntent,
  confirmBookingsForSucceededSetupIntent,
} from '@/lib/booking/confirm-deposit-payment';

/**
 * Scriptable fake supabase: records every query and answers via a responder.
 * Builders are thenables (like the real client) so both `await ...update().in()...select()`
 * and `await ...update().eq().is()` shapes work.
 */
type RecordedCall = {
  table: string;
  op: 'select' | 'update' | 'insert';
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
};

function makeAdmin(responder: (call: RecordedCall) => { data?: unknown; error?: unknown }) {
  const calls: RecordedCall[] = [];
  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, op: 'select', filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = (fn: (...args: unknown[]) => void) =>
        (...args: unknown[]) => {
          fn(...args);
          return builder;
        };
      builder.select = chain(() => {});
      builder.update = chain((payload) => {
        call.op = 'update';
        call.payload = payload;
      });
      builder.insert = chain((payload) => {
        call.op = 'insert';
        call.payload = payload;
      });
      builder.eq = chain((k, v) => call.filters.push(['eq', k as string, v]));
      builder.in = chain((k, v) => call.filters.push(['in', k as string, v]));
      builder.is = chain((k, v) => call.filters.push(['is', k as string, v]));
      builder.not = chain((k, op, v) => call.filters.push(['not', k as string, v ?? op]));
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(responder(call)).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

const filterValue = (call: RecordedCall, key: string) =>
  call.filters.find(([, k]) => k === key)?.[2];

/**
 * Apply the recorded eq/in/is filters against in-memory rows, as Postgres row
 * filters would. Used so the fakes are FILTER-AWARE: removing a guard filter
 * (.eq('venue_id')/.eq('status')/.eq('deposit_status')/.is('released_at'))
 * from the source changes which rows match and fails these tests.
 */
const rowsMatching = (rows: Array<Record<string, unknown>>, call: RecordedCall) =>
  rows.filter((row) =>
    call.filters.every(([op, key, value]) => {
      if (op === 'eq') return row[key] === value;
      if (op === 'in') return Array.isArray(value) && value.includes(row[key]);
      if (op === 'is') return value === null ? row[key] == null : row[key] === value;
      return true;
    }),
  );

/** Filter-aware bookings UPDATE responder: mutates matched rows and returns their ids. */
const applyBookingUpdate = (rows: Array<Record<string, unknown>>, call: RecordedCall) => {
  const matched = rowsMatching(rows, call);
  for (const row of matched) Object.assign(row, call.payload as Record<string, unknown>);
  return { data: matched.map((r) => ({ id: r.id })), error: null };
};

const holdRow = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  id: 'h1',
  booking_id: 'b1',
  venue_id: 'venue-1',
  fee_pence: 2500,
  released_at: null,
  stripe_setup_intent_id: 'seti_1',
  stripe_payment_method_id: null,
  terms_snapshot: { version: 1, text: 'consent', fee_pence: 5000, accepted_at: null },
  ...overrides,
});

const pendingBooking = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  venue_id: 'venue-1',
  status: 'Pending',
  deposit_status: 'Pending',
  confirm_token_hash: null,
  ...overrides,
});

describe('confirmBookingsForSucceededSetupIntent', () => {
  let holds: Array<Record<string, unknown>>;
  let bookings: Array<Record<string, unknown>>;

  beforeEach(() => {
    holds = [holdRow({ id: 'h1', booking_id: 'b1' }), holdRow({ id: 'h2', booking_id: 'b2' })];
    bookings = [pendingBooking('b1'), pendingBooking('b2')];
  });

  const makeSetupIntentAdmin = () =>
    makeAdmin((call) => {
      if (call.table === 'booking_card_holds' && call.op === 'select') {
        return { data: rowsMatching(holds, call), error: null };
      }
      // Zero-row confirms re-read booking statuses to distinguish a benign
      // replay from a sweep-cancelled unit (J2).
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: rowsMatching(bookings, call), error: null };
      }
      if (call.table === 'booking_card_holds' && call.op === 'update') return { data: null, error: null };
      if (call.table === 'bookings' && call.op === 'update') return applyBookingUpdate(bookings, call);
      if (call.table === 'events' && call.op === 'insert') return { data: null, error: null };
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

  it('confirms the unit: stamps holds, flips bookings to Card Held, assigns tokens, logs events', async () => {
    const { admin, calls } = makeSetupIntentAdmin();

    const result = await confirmBookingsForSucceededSetupIntent(admin, {
      setupIntentId: 'seti_1',
      paymentMethodId: 'pm_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: ['b1', 'b2'], alreadyConfirmed: false });

    // Hold rows get the payment method and an accepted_at consent stamp.
    const holdUpdates = calls.filter((c) => c.table === 'booking_card_holds' && c.op === 'update');
    expect(holdUpdates).toHaveLength(2);
    for (const update of holdUpdates) {
      const payload = update.payload as {
        stripe_payment_method_id?: string;
        terms_snapshot?: { accepted_at?: string | null; text?: string };
      };
      expect(payload.stripe_payment_method_id).toBe('pm_1');
      expect(payload.terms_snapshot?.accepted_at).toBeTruthy();
      expect(payload.terms_snapshot?.text).toBe('consent');
    }

    // Booking flip is guarded to Pending rows in-venue.
    const bookingFlip = calls.find(
      (c) => c.table === 'bookings' && c.op === 'update' && Array.isArray(filterValue(c, 'id')),
    );
    expect(bookingFlip?.payload).toMatchObject({ status: 'Booked', deposit_status: 'Card Held' });
    expect(filterValue(bookingFlip!, 'venue_id')).toBe('venue-1');
    expect(filterValue(bookingFlip!, 'status')).toBe('Pending');

    // Manage tokens assigned only where missing (confirm_token_hash IS NULL guard).
    const tokenUpdates = calls.filter(
      (c) =>
        c.table === 'bookings' &&
        c.op === 'update' &&
        c.filters.some(([op, k]) => op === 'is' && k === 'confirm_token_hash'),
    );
    expect(tokenUpdates).toHaveLength(2);

    // card_hold_saved events with { booking_id, fee_pence } payloads.
    const eventInsert = calls.find((c) => c.table === 'events' && c.op === 'insert');
    expect(eventInsert?.payload).toEqual([
      { venue_id: 'venue-1', booking_id: 'b1', event_type: 'card_hold_saved', payload: { booking_id: 'b1', fee_pence: 2500 } },
      { venue_id: 'venue-1', booking_id: 'b2', event_type: 'card_hold_saved', payload: { booking_id: 'b2', fee_pence: 2500 } },
    ]);
  });

  it('is idempotent: a second call finds no Pending rows and reports alreadyConfirmed', async () => {
    // Holds and bookings already completed by the first call.
    for (const h of holds) {
      h.stripe_payment_method_id = 'pm_1';
      (h.terms_snapshot as Record<string, unknown>).accepted_at = '2026-07-05T10:00:00.000Z';
    }
    for (const b of bookings) {
      b.status = 'Booked';
      b.deposit_status = 'Card Held';
    }
    const { admin, calls } = makeSetupIntentAdmin();

    const result = await confirmBookingsForSucceededSetupIntent(admin, {
      setupIntentId: 'seti_1',
      paymentMethodId: 'pm_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: [], alreadyConfirmed: true });
    // No token writes, no events.
    expect(calls.filter((c) => c.table === 'events')).toHaveLength(0);
    expect(
      calls.filter(
        (c) => c.table === 'bookings' && c.filters.some(([op, k]) => op === 'is' && k === 'confirm_token_hash'),
      ),
    ).toHaveLength(0);
  });

  it('fails with hold_not_found when the SetupIntent has no hold rows', async () => {
    const { admin } = makeSetupIntentAdmin();

    const result = await confirmBookingsForSucceededSetupIntent(admin, {
      setupIntentId: 'seti_missing',
      paymentMethodId: 'pm_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: false, reason: 'hold_not_found' });
  });

  it('ignores released holds: a waived booking stays Waived and its dead hold is never re-stamped', async () => {
    // b2 was waived by staff: hold released, deposit_status 'Waived'. A stale
    // payment page completing the card save must not resurrect it.
    holds = [
      holdRow({ id: 'h1', booking_id: 'b1' }),
      holdRow({ id: 'h2', booking_id: 'b2', released_at: '2026-07-01T00:00:00.000Z' }),
    ];
    bookings = [pendingBooking('b1'), pendingBooking('b2', { deposit_status: 'Waived' })];
    const { admin, calls } = makeSetupIntentAdmin();

    const result = await confirmBookingsForSucceededSetupIntent(admin, {
      setupIntentId: 'seti_1',
      paymentMethodId: 'pm_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: ['b1'], alreadyConfirmed: false });
    // The waived sibling is untouched.
    expect(bookings[1]).toMatchObject({ id: 'b2', status: 'Pending', deposit_status: 'Waived' });
    // The released hold is never re-stamped: every hold update targets h1 only.
    const holdUpdates = calls.filter((c) => c.table === 'booking_card_holds' && c.op === 'update');
    expect(holdUpdates.length).toBeGreaterThan(0);
    for (const update of holdUpdates) {
      expect(filterValue(update, 'id')).toBe('h1');
    }
    // card_hold_saved event only for the live hold.
    const eventInsert = calls.find((c) => c.table === 'events' && c.op === 'insert');
    expect(eventInsert?.payload).toEqual([
      { venue_id: 'venue-1', booking_id: 'b1', event_type: 'card_hold_saved', payload: { booking_id: 'b1', fee_pence: 2500 } },
    ]);
  });

  it("only flips bookings whose deposit_status is 'Pending' (a Waived row with an open hold stays Waived)", async () => {
    // Waive flipped the booking but the hold release failed (crashed midway):
    // the open hold must still not resurrect the waived booking.
    bookings = [pendingBooking('b1'), pendingBooking('b2', { deposit_status: 'Waived' })];
    const { admin } = makeSetupIntentAdmin();

    const result = await confirmBookingsForSucceededSetupIntent(admin, {
      setupIntentId: 'seti_1',
      paymentMethodId: 'pm_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: ['b1'], alreadyConfirmed: false });
    expect(bookings[0]).toMatchObject({ id: 'b1', status: 'Booked', deposit_status: 'Card Held' });
    expect(bookings[1]).toMatchObject({ id: 'b2', status: 'Pending', deposit_status: 'Waived' });
  });

  it('never flips rows outside the venue scope (venue_id guard)', async () => {
    bookings = [pendingBooking('b1'), pendingBooking('b2', { venue_id: 'venue-other' })];
    const { admin } = makeSetupIntentAdmin();

    const result = await confirmBookingsForSucceededSetupIntent(admin, {
      setupIntentId: 'seti_1',
      paymentMethodId: 'pm_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: ['b1'], alreadyConfirmed: false });
    expect(bookings[1]).toMatchObject({ id: 'b2', status: 'Pending', deposit_status: 'Pending' });
  });
});

describe('confirmBookingsForSucceededPaymentIntent', () => {
  it('returns alreadyConfirmed when no Pending rows share the PaymentIntent', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') return { data: [], error: null };
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });
    const result = await confirmBookingsForSucceededPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      venueId: 'venue-1',
    });
    expect(result).toEqual({ ok: true, confirmedIds: [], alreadyConfirmed: true });
  });

  it('confirms a plain deposit row to Paid', async () => {
    const bookings = [pendingBooking('b1', { deposit_amount_pence: 2000 })];
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: bookings.map((b) => ({ ...b })), error: null };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [], error: null };
      if (call.table === 'bookings' && call.op === 'update') return applyBookingUpdate(bookings, call);
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

    const result = await confirmBookingsForSucceededPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: ['b1'], alreadyConfirmed: false });
    const flip = calls.find((c) => c.table === 'bookings' && c.op === 'update' && Array.isArray(filterValue(c, 'id')));
    expect(flip?.payload).toMatchObject({ status: 'Booked', deposit_status: 'Paid' });
  });

  it('handles a mixed payment_with_setup unit per row: Paid for the money row, Card Held for the hold row', async () => {
    const hold = {
      id: 'h2',
      booking_id: 'b2',
      fee_pence: 2500,
      stripe_payment_method_id: null,
      terms_snapshot: { version: 1, text: 'consent', fee_pence: 2500, accepted_at: null },
    };
    const bookings = [
      pendingBooking('b1', { deposit_amount_pence: 2000 }),
      pendingBooking('b2', { deposit_amount_pence: null }),
    ];
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: bookings.map((b) => ({ ...b })), error: null };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [hold], error: null };
      if (call.table === 'booking_card_holds' && call.op === 'update') return { data: null, error: null };
      if (call.table === 'bookings' && call.op === 'update') return applyBookingUpdate(bookings, call);
      if (call.table === 'events' && call.op === 'insert') return { data: null, error: null };
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

    const result = await confirmBookingsForSucceededPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      venueId: 'venue-1',
      paymentMethodId: 'pm_1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyConfirmed).toBe(false);
    expect([...result.confirmedIds].sort()).toEqual(['b1', 'b2']);

    const flips = calls.filter((c) => c.table === 'bookings' && c.op === 'update' && Array.isArray(filterValue(c, 'id')));
    const heldFlip = flips.find((c) => (c.payload as { deposit_status?: string }).deposit_status === 'Card Held');
    const paidFlip = flips.find((c) => (c.payload as { deposit_status?: string }).deposit_status === 'Paid');
    expect(filterValue(heldFlip!, 'id')).toEqual(['b2']);
    expect(filterValue(paidFlip!, 'id')).toEqual(['b1']);

    // The hold row is completed from the PI's payment method with consent stamped.
    const holdUpdate = calls.find((c) => c.table === 'booking_card_holds' && c.op === 'update');
    const holdPayload = holdUpdate?.payload as {
      stripe_payment_method_id?: string;
      terms_snapshot?: { accepted_at?: string | null };
    };
    expect(holdPayload.stripe_payment_method_id).toBe('pm_1');
    expect(holdPayload.terms_snapshot?.accepted_at).toBeTruthy();

    // card_hold_saved event only for the hold row.
    const eventInsert = calls.find((c) => c.table === 'events' && c.op === 'insert');
    expect(eventInsert?.payload).toEqual([
      { venue_id: 'venue-1', booking_id: 'b2', event_type: 'card_hold_saved', payload: { booking_id: 'b2', fee_pence: 2500 } },
    ]);
  });

  it("flips a 'Failed' money row back to Booked/'Paid' on retry success (regression)", async () => {
    // payment_intent.payment_failed marked the row 'Failed'; the guest retried
    // from the still-open payment element on the SAME PI and succeeded. The
    // classification must treat 'Failed' like 'Pending' or the retry is lost.
    const bookings = [pendingBooking('b1', { deposit_status: 'Failed', deposit_amount_pence: 2000 })];
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: bookings.map((b) => ({ ...b })), error: null };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [], error: null };
      if (call.table === 'bookings' && call.op === 'update') return applyBookingUpdate(bookings, call);
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

    const result = await confirmBookingsForSucceededPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: ['b1'], alreadyConfirmed: false });
    const flip = calls.find((c) => c.table === 'bookings' && c.op === 'update' && Array.isArray(filterValue(c, 'id')));
    expect(flip?.payload).toMatchObject({ status: 'Booked', deposit_status: 'Paid' });
    expect(bookings[0]).toMatchObject({ id: 'b1', status: 'Booked', deposit_status: 'Paid' });
  });

  it("flips a 'Failed' hold row to Booked/'Card Held' on retry success and stamps the PM (regression)", async () => {
    // Same retry-after-failure path, payment_with_setup unit: the card-hold row
    // (deposit_amount_pence NULL + open hold) must classify to 'Card Held',
    // never 'Paid', and its hold row must still get the payment method.
    const hold = {
      id: 'h1',
      booking_id: 'b1',
      fee_pence: 2500,
      stripe_payment_method_id: null,
      terms_snapshot: { version: 1, text: 'consent', fee_pence: 2500, accepted_at: null },
    };
    const bookings = [pendingBooking('b1', { deposit_status: 'Failed', deposit_amount_pence: null })];
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: bookings.map((b) => ({ ...b })), error: null };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [hold], error: null };
      if (call.table === 'booking_card_holds' && call.op === 'update') return { data: null, error: null };
      if (call.table === 'bookings' && call.op === 'update') return applyBookingUpdate(bookings, call);
      if (call.table === 'events' && call.op === 'insert') return { data: null, error: null };
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

    const result = await confirmBookingsForSucceededPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      venueId: 'venue-1',
      paymentMethodId: 'pm_1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: ['b1'], alreadyConfirmed: false });
    const flip = calls.find((c) => c.table === 'bookings' && c.op === 'update' && Array.isArray(filterValue(c, 'id')));
    expect(flip?.payload).toMatchObject({ status: 'Booked', deposit_status: 'Card Held' });
    expect(bookings[0]).toMatchObject({ id: 'b1', status: 'Booked', deposit_status: 'Card Held' });

    // Hold completion: payment method stamped, consent accepted_at set.
    const holdUpdate = calls.find((c) => c.table === 'booking_card_holds' && c.op === 'update');
    const holdPayload = holdUpdate?.payload as {
      stripe_payment_method_id?: string;
      terms_snapshot?: { accepted_at?: string | null };
    };
    expect(holdPayload.stripe_payment_method_id).toBe('pm_1');
    expect(holdPayload.terms_snapshot?.accepted_at).toBeTruthy();
  });

  it("keeps 'Not Required' zero-deposit siblings out of the Paid flip (regression)", async () => {
    const bookings = [
      pendingBooking('b1', { deposit_amount_pence: 1500 }),
      pendingBooking('b2', { deposit_status: 'Not Required', deposit_amount_pence: null }),
    ];
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: bookings.map((b) => ({ ...b })), error: null };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [], error: null };
      if (call.table === 'bookings' && call.op === 'update') return applyBookingUpdate(bookings, call);
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

    const result = await confirmBookingsForSucceededPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      venueId: 'venue-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.confirmedIds].sort()).toEqual(['b1', 'b2']);

    const flips = calls.filter((c) => c.table === 'bookings' && c.op === 'update' && Array.isArray(filterValue(c, 'id')));
    const paidFlip = flips.find((c) => (c.payload as { deposit_status?: string }).deposit_status === 'Paid');
    expect(filterValue(paidFlip!, 'id')).toEqual(['b1']);

    // The 'Not Required' sibling is confirmed without its deposit_status changing.
    const statusOnlyFlip = flips.find((c) => !('deposit_status' in (c.payload as Record<string, unknown>)));
    expect(statusOnlyFlip?.payload).toMatchObject({ status: 'Booked' });
    expect(filterValue(statusOnlyFlip!, 'id')).toEqual(['b2']);
  });
});
