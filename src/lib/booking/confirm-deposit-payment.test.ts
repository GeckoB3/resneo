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

describe('confirmBookingsForSucceededSetupIntent', () => {
  let holds: Array<Record<string, unknown>>;

  beforeEach(() => {
    holds = [
      {
        id: 'h1',
        booking_id: 'b1',
        fee_pence: 2500,
        stripe_payment_method_id: null,
        terms_snapshot: { version: 1, text: 'consent', fee_pence: 5000, accepted_at: null },
      },
      {
        id: 'h2',
        booking_id: 'b2',
        fee_pence: 2500,
        stripe_payment_method_id: null,
        terms_snapshot: { version: 1, text: 'consent', fee_pence: 5000, accepted_at: null },
      },
    ];
  });

  it('confirms the unit: stamps holds, flips bookings to Card Held, assigns tokens, logs events', async () => {
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: holds, error: null };
      if (call.table === 'booking_card_holds' && call.op === 'update') return { data: null, error: null };
      if (call.table === 'bookings' && call.op === 'update' && filterValue(call, 'status') === 'Pending' && Array.isArray(filterValue(call, 'id'))) {
        return { data: [{ id: 'b1' }, { id: 'b2' }], error: null };
      }
      if (call.table === 'bookings' && call.op === 'update') return { data: null, error: null };
      if (call.table === 'events' && call.op === 'insert') return { data: null, error: null };
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

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
    // Holds already completed by the first call.
    for (const h of holds) {
      h.stripe_payment_method_id = 'pm_1';
      (h.terms_snapshot as Record<string, unknown>).accepted_at = '2026-07-05T10:00:00.000Z';
    }
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: holds, error: null };
      if (call.table === 'bookings' && call.op === 'update') return { data: [], error: null };
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

    const result = await confirmBookingsForSucceededSetupIntent(admin, {
      setupIntentId: 'seti_1',
      paymentMethodId: 'pm_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: true, confirmedIds: [], alreadyConfirmed: true });
    // No hold re-stamping, no token writes, no events.
    expect(calls.filter((c) => c.table === 'booking_card_holds' && c.op === 'update')).toHaveLength(0);
    expect(calls.filter((c) => c.table === 'events')).toHaveLength(0);
  });

  it('fails with hold_not_found when the SetupIntent has no hold rows', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [], error: null };
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });

    const result = await confirmBookingsForSucceededSetupIntent(admin, {
      setupIntentId: 'seti_missing',
      paymentMethodId: 'pm_1',
      venueId: 'venue-1',
    });

    expect(result).toEqual({ ok: false, reason: 'hold_not_found' });
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
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: [{ id: 'b1', deposit_status: 'Pending', deposit_amount_pence: 2000 }], error: null };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [], error: null };
      if (call.table === 'bookings' && call.op === 'update' && Array.isArray(filterValue(call, 'id'))) {
        return { data: [{ id: 'b1' }], error: null };
      }
      if (call.table === 'bookings' && call.op === 'update') return { data: null, error: null };
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
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return {
          data: [
            { id: 'b1', deposit_status: 'Pending', deposit_amount_pence: 2000 },
            { id: 'b2', deposit_status: 'Pending', deposit_amount_pence: null },
          ],
          error: null,
        };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [hold], error: null };
      if (call.table === 'booking_card_holds' && call.op === 'update') return { data: null, error: null };
      if (call.table === 'bookings' && call.op === 'update' && Array.isArray(filterValue(call, 'id'))) {
        const ids = filterValue(call, 'id') as string[];
        return { data: ids.map((id) => ({ id })), error: null };
      }
      if (call.table === 'bookings' && call.op === 'update') return { data: null, error: null };
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

  it("keeps 'Not Required' zero-deposit siblings out of the Paid flip (regression)", async () => {
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return {
          data: [
            { id: 'b1', deposit_status: 'Pending', deposit_amount_pence: 1500 },
            { id: 'b2', deposit_status: 'Not Required', deposit_amount_pence: null },
          ],
          error: null,
        };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') return { data: [], error: null };
      if (call.table === 'bookings' && call.op === 'update' && Array.isArray(filterValue(call, 'id'))) {
        const ids = filterValue(call, 'id') as string[];
        return { data: ids.map((id) => ({ id })), error: null };
      }
      if (call.table === 'bookings' && call.op === 'update') return { data: null, error: null };
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
