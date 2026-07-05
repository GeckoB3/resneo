import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/communications', () => ({ sendCommunication: vi.fn(async () => ({ sent: true })) }));
vi.mock('@/lib/communications/send-templated', () => ({
  sendCardHoldRequestNotifications: vi.fn(async () => ({
    email: { sent: true },
    sms: { sent: false, reason: 'no_phone' },
  })),
}));
vi.mock('@/lib/booking-short-links', () => ({
  createOrGetPaymentShortLink: vi.fn(async () => 'https://short.test/p/abc'),
}));
// Pass the handler through untouched so the test does not need a cron_runs table.
vi.mock('@/lib/platform/cron-log', () => ({
  withCronRunLogging: (_job: string, handler: unknown) => handler,
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import { sendCardHoldRequestNotifications } from '@/lib/communications/send-templated';
import { POST } from './route';

const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockSendCommunication = vi.mocked(sendCommunication);
const mockSendCardHoldRequest = vi.mocked(sendCardHoldRequestNotifications);

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
  const inner = row[head === 'booking' ? 'booking' : head!];
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
  return new NextRequest('https://site.test/api/cron/deposit-reminder-2h', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/cron/deposit-reminder-2h card-hold exclusion (spec 12.2)', () => {
  it('sends the deposit reminder only to the non-hold booking and the card-request reminder to the hold booking', async () => {
    const createdAt = new Date(Date.now() - 2.2 * 60 * 60 * 1000).toISOString();
    const bookingBase = {
      venue_id: 'venue-1',
      booking_date: '2026-07-06',
      booking_time: '18:30:00',
      party_size: 2,
      created_at: createdAt,
      source: 'phone',
      status: 'Pending',
      deposit_status: 'Pending',
    };
    const bookings: Array<Record<string, unknown>> = [
      {
        ...bookingBase,
        id: 'b-dep',
        guest_id: 'g-dep',
        deposit_amount_pence: 1500,
        stripe_payment_intent_id: 'pi_1',
      },
      {
        ...bookingBase,
        id: 'b-hold',
        guest_id: 'g-hold',
        deposit_amount_pence: null,
        stripe_payment_intent_id: null,
      },
    ];
    const holds: Array<Record<string, unknown>> = [
      {
        booking_id: 'b-hold',
        fee_pence: 2500,
        released_at: null,
        stripe_payment_method_id: null,
        created_at: createdAt,
        booking: { ...bookingBase, id: 'b-hold', guest_id: 'g-hold' },
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
      if (call.table === 'booking_card_holds' && call.op === 'select') {
        return { data: rowsMatching(holds, call), error: null };
      }
      if (call.table === 'venues' && call.op === 'select') {
        return {
          data: [{ name: 'Venue One', address: null, email: null, reply_to_email: null }],
          error: null,
        };
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
    expect(await res.json()).toEqual({ sent: 1, card_hold_sent: 1 });

    // Deposit reminder: the hold booking is excluded (a phantom deposit amount
    // would otherwise be invented for it).
    expect(mockSendCommunication).toHaveBeenCalledTimes(1);
    expect(mockSendCommunication.mock.calls[0]![0]).toMatchObject({
      type: 'deposit_payment_reminder',
      booking_id: 'b-dep',
      venue_id: 'venue-1',
    });

    // Card-request reminder: only the hold booking, with its fee and the
    // reminder variant (card_hold_payment_reminder template).
    expect(mockSendCardHoldRequest).toHaveBeenCalledTimes(1);
    const [holdBooking, , holdVenueId, , feePence, opts] = mockSendCardHoldRequest.mock.calls[0]!;
    expect(holdBooking).toMatchObject({ id: 'b-hold' });
    expect(holdVenueId).toBe('venue-1');
    expect(feePence).toBe(2500);
    expect(opts).toEqual({ reminder: true });
  });
});
