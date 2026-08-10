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
    paymentIntents: { retrieve: vi.fn(), cancel: vi.fn(async () => ({})) },
  },
}));
vi.mock('@/lib/booking/card-hold-release', () => ({
  releaseCardHoldsForBookings: vi.fn(async () => ({
    releasedBookingIds: [],
    deletedCustomerIds: [],
  })),
}));
vi.mock('@/lib/booking/self-heal-succeeded-payment', () => ({
  selfHealSucceededPaymentIntent: vi.fn(async () => ({
    outcome: 'confirmed' as const,
    confirmedIds: ['healed'],
  })),
}));
vi.mock('@/lib/platform/cron-log', () => ({
  withCronRunLogging: (_job: string, handler: unknown) => handler,
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import { stripe } from '@/lib/stripe';
import { selfHealSucceededPaymentIntent } from '@/lib/booking/self-heal-succeeded-payment';
import { POST } from './route';

const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockSendCommunication = vi.mocked(sendCommunication);
const mockPiRetrieve = vi.mocked(stripe.paymentIntents.retrieve);
const mockPiCancel = vi.mocked(stripe.paymentIntents.cancel);
const mockSelfHeal = vi.mocked(selfHealSucceededPaymentIntent);

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
      for (const op of ['eq', 'in', 'is', 'gte', 'lte', 'lt', 'gt'] as const) {
        builder[op] = chain((k, v) => call.filters.push([op, k as string, v]));
      }
      builder.not = chain((k, opName, v) =>
        call.filters.push(['not', k as string, { op: opName, value: v }]),
      );
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
      if (op === 'gt') return typeof actual === 'number' && actual > (value as number);
      if (op === 'not') {
        const spec = value as { op: string; value: unknown };
        if (spec.op === 'is' && spec.value === null) return actual != null;
        return true;
      }
      return true;
    }),
  );

function cronRequest(): NextRequest {
  return new NextRequest('https://site.test/api/cron/auto-cancel-bookings', { method: 'POST' });
}

const AGO_31_MIN = new Date(Date.now() - 31 * 60 * 1000).toISOString();
const AGO_25_H = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

function onlineMoneyBooking(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    venue_id: 'venue-1',
    guest_id: 'g1',
    group_booking_id: null,
    stripe_payment_intent_id: 'pi_1',
    class_instance_id: null,
    booking_date: '2026-08-14',
    booking_time: '11:15:00',
    party_size: 1,
    source: 'booking_page',
    created_at: AGO_31_MIN,
    status: 'Pending',
    deposit_status: 'Pending',
    deposit_amount_pence: 2000,
    ...over,
  };
}

type Scenario = {
  bookings: Array<Record<string, unknown>>;
  commLogs?: Array<Record<string, unknown>>;
};

function wireAdmin({ bookings, commLogs = [] }: Scenario) {
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
      return { data: [], error: null };
    }
    if (call.table === 'communication_logs' && call.op === 'select') {
      return { data: rowsMatching(commLogs, call), error: null };
    }
    if (call.table === 'events' && call.op === 'insert') return { data: null, error: null };
    if (call.table === 'venues' && call.op === 'select') {
      return { data: [{ name: 'Venue One', stripe_connected_account_id: 'acct_1' }], error: null };
    }
    if (call.table === 'guests' && call.op === 'select') {
      return { data: [{ first_name: 'Mia', last_name: 'G', phone: '+447700900001', email: null }], error: null };
    }
    throw new Error(`unexpected call ${call.table} ${call.op}`);
  });
  mockGetAdmin.mockReturnValue(admin as never);
  return admin;
}

async function runCron() {
  const res = await POST(cronRequest());
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, number>;
}

function autoCancelNotifications() {
  return mockSendCommunication.mock.calls
    .map((c) => c[0] as { type: string; booking_id?: string; payload?: Record<string, unknown> })
    .filter((c) => c.type === 'auto_cancel_notification');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelfHeal.mockResolvedValue({ outcome: 'confirmed', confirmedIds: ['healed'] });
});

describe('online money sweep (plan 3.1)', () => {
  it('cancels a booking_page deposit row whose PI is requires_payment_method, cancels the PI, notifies once', async () => {
    const bookings = [onlineMoneyBooking()];
    wireAdmin({ bookings });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method', payment_method: null } as never);

    const body = await runCron();

    expect(body.online_money_cancelled).toBe(1);
    expect(bookings[0]).toMatchObject({ status: 'Cancelled', deposit_status: 'Failed' });
    expect(mockPiCancel).toHaveBeenCalledWith('pi_1', undefined, { stripeAccount: 'acct_1' });
    expect(autoCancelNotifications()).toHaveLength(1);
    expect(mockSelfHeal).not.toHaveBeenCalled();
  });

  it("sweeps a row whose deposit_status is 'Failed' (a failed attempt no longer exempts it)", async () => {
    const bookings = [onlineMoneyBooking({ deposit_status: 'Failed' })];
    wireAdmin({ bookings });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method', payment_method: null } as never);

    const body = await runCron();

    expect(body.online_money_cancelled).toBe(1);
    expect(bookings[0]).toMatchObject({ status: 'Cancelled' });
  });

  it('widened sources: widget rows are swept too', async () => {
    const bookings = [onlineMoneyBooking({ source: 'widget' })];
    wireAdmin({ bookings });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method', payment_method: null } as never);

    const body = await runCron();
    expect(body.online_money_cancelled).toBe(1);
  });

  it('a row younger than the 20-minute threshold is left alone', async () => {
    const bookings = [
      onlineMoneyBooking({ created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString() }),
    ];
    wireAdmin({ bookings });

    const body = await runCron();
    expect(body.online_money_cancelled).toBe(0);
    expect(bookings[0]).toMatchObject({ status: 'Pending' });
    expect(mockPiRetrieve).not.toHaveBeenCalled();
  });

  it('a staff-sent payment link within 24h shields the booking (plan D14)', async () => {
    const bookings = [onlineMoneyBooking()];
    wireAdmin({
      bookings,
      commLogs: [
        {
          booking_id: 'b1',
          message_type: 'deposit_request_email',
          created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
      ],
    });

    const body = await runCron();

    expect(body.online_money_cancelled).toBe(0);
    expect(bookings[0]).toMatchObject({ status: 'Pending' });
    expect(mockPiRetrieve).not.toHaveBeenCalled();
  });

  it('a succeeded PI self-heals instead of cancelling (plan M3)', async () => {
    const bookings = [onlineMoneyBooking()];
    wireAdmin({ bookings });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded', payment_method: 'pm_9' } as never);

    const body = await runCron();

    expect(body.online_money_cancelled).toBe(0);
    expect(body.self_healed).toBe(1);
    expect(bookings[0]).toMatchObject({ status: 'Pending' });
    expect(mockSelfHeal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        paymentIntentId: 'pi_1',
        venueId: 'venue-1',
        paymentMethodId: 'pm_9',
        source: 'auto-cancel-sweep',
      }),
    );
    expect(mockPiCancel).not.toHaveBeenCalled();
  });

  it('requires_action waits inside 24h and is abandoned after it (plan M4)', async () => {
    const young = onlineMoneyBooking();
    wireAdmin({ bookings: [young] });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_action', payment_method: null } as never);

    let body = await runCron();
    expect(body.online_money_cancelled).toBe(0);
    expect(young).toMatchObject({ status: 'Pending' });

    vi.clearAllMocks();
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_action', payment_method: null } as never);
    const stale = onlineMoneyBooking({ created_at: AGO_25_H });
    wireAdmin({ bookings: [stale] });

    body = await runCron();
    expect(body.online_money_cancelled).toBe(1);
    expect(stale).toMatchObject({ status: 'Cancelled' });
  });

  it('processing is never cancelled', async () => {
    const bookings = [onlineMoneyBooking({ created_at: AGO_25_H })];
    wireAdmin({ bookings });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'processing', payment_method: null } as never);

    const body = await runCron();
    expect(body.online_money_cancelled).toBe(0);
    expect(bookings[0]).toMatchObject({ status: 'Pending' });
  });

  it('group siblings sharing the PI are cancelled together with one notification', async () => {
    const bookings = [
      onlineMoneyBooking({ id: 'b1', group_booking_id: 'grp1' }),
      onlineMoneyBooking({ id: 'b2', group_booking_id: 'grp1' }),
    ];
    wireAdmin({ bookings });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method', payment_method: null } as never);

    const body = await runCron();

    expect(body.online_money_cancelled).toBe(2);
    expect(bookings[0]).toMatchObject({ status: 'Cancelled' });
    expect(bookings[1]).toMatchObject({ status: 'Cancelled' });
    expect(autoCancelNotifications()).toHaveLength(1);
    expect(mockPiCancel).toHaveBeenCalledTimes(1);
  });
});

describe('no-PI arm (plan 3.3)', () => {
  it('cancels an online money row that never got a PaymentIntent linked', async () => {
    const bookings = [onlineMoneyBooking({ stripe_payment_intent_id: null })];
    wireAdmin({ bookings });

    const body = await runCron();

    expect(body.no_pi_cancelled).toBe(1);
    expect(bookings[0]).toMatchObject({ status: 'Cancelled', deposit_status: 'Failed' });
    expect(mockPiRetrieve).not.toHaveBeenCalled();
    expect(autoCancelNotifications()).toHaveLength(1);
  });

  it('leaves free bookings (no deposit owed) alone', async () => {
    const bookings = [
      onlineMoneyBooking({ stripe_payment_intent_id: null, deposit_amount_pence: null }),
    ];
    wireAdmin({ bookings });

    const body = await runCron();
    expect(body.no_pi_cancelled).toBe(0);
    expect(bookings[0]).toMatchObject({ status: 'Pending' });
  });
});

describe('phone sweep PI verification (plan 3.5)', () => {
  function phoneBooking(over: Record<string, unknown> = {}): Record<string, unknown> {
    return onlineMoneyBooking({ source: 'phone', created_at: AGO_25_H, ...over });
  }

  it('a succeeded PI self-heals instead of cancelling the paid booking', async () => {
    const bookings = [phoneBooking()];
    wireAdmin({ bookings });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded', payment_method: 'pm_9' } as never);

    const body = await runCron();

    expect(body.cancelled).toBe(0);
    expect(body.self_healed).toBe(1);
    expect(bookings[0]).toMatchObject({ status: 'Pending' });
  });

  it('an unpaid PI cancels the booking at 24h and cancels the intent', async () => {
    const bookings = [phoneBooking()];
    wireAdmin({ bookings });
    mockPiRetrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method', payment_method: null } as never);

    const body = await runCron();

    expect(body.cancelled).toBe(1);
    expect(bookings[0]).toMatchObject({ status: 'Cancelled' });
    expect(mockPiCancel).toHaveBeenCalledWith('pi_1', undefined, { stripeAccount: 'acct_1' });
  });
});
