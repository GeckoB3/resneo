import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/communications', () => ({ sendCommunication: vi.fn(async () => ({ sent: true })) }));
vi.mock('@/lib/communications/staff-push-notification', () => ({
  sendStaffPush: vi.fn(async () => undefined),
}));
vi.mock('@/lib/table-management/lifecycle', () => ({
  applyBookingLifecycleStatusEffects: vi.fn(async () => undefined),
  validateBookingStatusTransition: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    setupIntents: { retrieve: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
  },
}));
vi.mock('@/lib/booking/card-hold-release', () => ({
  releaseCardHoldsForBookings: vi.fn(async () => ({
    releasedBookingIds: [],
    deletedCustomerIds: [],
  })),
}));
// Pass the handler through untouched so the test does not need a cron_runs table.
vi.mock('@/lib/platform/cron-log', () => ({
  withCronRunLogging: (_job: string, handler: unknown) => handler,
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { POST } from './route';

const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockSendCommunication = vi.mocked(sendCommunication);
const mockRelease = vi.mocked(releaseCardHoldsForBookings);

/**
 * Filter-aware fake supabase in the confirm-deposit-payment.test.ts style,
 * extended with gte/lte/lt, order/limit chains and dotted `booking.*` keys for
 * the PostgREST embedded-join filters this route uses.
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
      for (const op of ['eq', 'in', 'is', 'gte', 'lte', 'lt', 'not'] as const) {
        builder[op] = chain((k, v) => call.filters.push([op, k as string, v]));
      }
      builder.order = chain(() => {});
      builder.limit = chain(() => {});
      builder.single = async () => {
        const r = responder(call);
        const rows = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
        return { data: rows[0] ?? null, error: r.error ?? null };
      };
      builder.maybeSingle = builder.single;
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(responder(call)).then(resolve, reject);
      return builder;
    },
  };
  return { admin, calls };
}

/** Resolve `booking.status`-style keys through the embedded booking object. */
const fieldValue = (row: Record<string, unknown>, key: string): unknown => {
  if (!key.includes('.')) return row[key];
  const [head, ...rest] = key.split('.');
  const inner = row[head!];
  if (!inner || typeof inner !== 'object') return undefined;
  return fieldValue(inner as Record<string, unknown>, rest.join('.'));
};

const rowsMatching = (rows: Array<Record<string, unknown>>, call: RecordedCall) =>
  rows.filter((row) =>
    call.filters.every(([op, key, value]) => {
      const actual = fieldValue(row, key);
      if (op === 'eq') return actual === value;
      if (op === 'in') return Array.isArray(value) && value.includes(actual);
      if (op === 'is') return value === null ? actual == null : actual === value;
      if (op === 'gte') return typeof actual === 'string' && actual >= (value as string);
      if (op === 'lte') return typeof actual === 'string' && actual <= (value as string);
      if (op === 'lt') return typeof actual === 'string' && actual < (value as string);
      return true;
    }),
  );

function cronRequest(): NextRequest {
  return new NextRequest('https://site.test/api/cron/auto-cancel-bookings', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/cron/auto-cancel-bookings card-hold exclusion (spec 12.1)', () => {
  it('deposit sweep skips hold bookings; staff hold sweep cancels them with hold release and card-hold copy', async () => {
    const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const bookingBase = {
      venue_id: 'venue-1',
      booking_date: '2026-07-04',
      booking_time: '18:30:00',
      party_size: 2,
      created_at: createdAt,
      source: 'phone',
      status: 'Pending',
      deposit_status: 'Pending',
      class_instance_id: null,
      stripe_payment_intent_id: null,
    };
    const bookings: Array<Record<string, unknown>> = [
      { ...bookingBase, id: 'b-dep', guest_id: 'g-dep' },
      { ...bookingBase, id: 'b-hold', guest_id: 'g-hold' },
    ];
    // The embedded join row shares the live booking object so status guards
    // (.eq('booking.status', 'Pending')) see sweep-1 mutations.
    const holds: Array<Record<string, unknown>> = [
      {
        booking_id: 'b-hold',
        stripe_setup_intent_id: 'seti_1',
        stripe_connected_account_id: 'acct_1',
        released_at: null,
        stripe_payment_method_id: null,
        created_at: createdAt,
        booking: bookings[1],
      },
    ];
    const guests: Record<string, Record<string, unknown>> = {
      'g-dep': { first_name: 'Dee', last_name: 'Posit', phone: '+447700900001', email: null },
      'g-hold': { first_name: 'Hol', last_name: 'Der', phone: '+447700900002', email: null },
    };

    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: rowsMatching(bookings, call), error: null };
      }
      if (call.table === 'bookings' && call.op === 'update') {
        const matched = rowsMatching(bookings, call);
        for (const row of matched) Object.assign(row, call.payload as Record<string, unknown>);
        return { data: matched.map((r) => ({ id: r.id })), error: null };
      }
      if (call.table === 'booking_card_holds' && call.op === 'select') {
        return { data: rowsMatching(holds, call), error: null };
      }
      if (call.table === 'events' && call.op === 'insert') return { data: null, error: null };
      if (call.table === 'venues' && call.op === 'select') {
        return { data: [{ name: 'Venue One', stripe_connected_account_id: 'acct_1' }], error: null };
      }
      if (call.table === 'guests' && call.op === 'select') {
        const id = call.filters.find(([op, k]) => op === 'eq' && k === 'id')?.[2] as string;
        return { data: guests[id] ? [guests[id]] : [], error: null };
      }
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });
    mockGetAdmin.mockReturnValue(admin as never);

    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cancelled: 1,
      staff_hold_cancelled: 1,
      online_hold_cancelled: 0,
      class_cancelled: 0,
    });

    // Both bookings end Cancelled, but via different sweeps.
    expect(bookings[0]).toMatchObject({ id: 'b-dep', status: 'Cancelled' });
    expect(bookings[1]).toMatchObject({ id: 'b-hold', status: 'Cancelled' });
    // The staff hold sweep (not the deposit sweep) released the hold.
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith(admin, ['b-hold'], 'abandoned');

    // Guest copy: deposit wording for b-dep, card-hold wording for b-hold.
    const notifications = mockSendCommunication.mock.calls
      .map((c) => c[0] as { type: string; booking_id?: string; payload?: Record<string, unknown> })
      .filter((c) => c.type === 'auto_cancel_notification');
    expect(notifications).toHaveLength(2);
    const depNote = notifications.find((n) => n.booking_id === 'b-dep');
    const holdNote = notifications.find((n) => n.booking_id === 'b-hold');
    expect(depNote?.payload).not.toHaveProperty('card_hold');
    expect(holdNote?.payload).toMatchObject({ card_hold: true });
  });
});
