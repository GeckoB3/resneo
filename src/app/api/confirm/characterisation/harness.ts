import { vi, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { makeRecordingDb, makeAfterStub, type RecordedCall } from '@/lib/testing/recording-supabase';

/**
 * Shared harness for the POST /api/confirm characterisation suite (P0-9).
 *
 * This suite describes the route AS IT IS, not as it should be. It exists so
 * P0-4 can rewrite a 1,670-line handler with 53 JSON returns and prove it
 * changed nothing: the gate is that P0-4 lands with ZERO modified snapshot
 * files. Any intended difference needs its own reviewed commit saying so.
 *
 * Three decisions worth knowing, all from the plan:
 *
 * 1. Mocked-supabase vitest, not an integration suite. Precedent is
 *    `route.card-hold.test.ts`. The route touches thirteen tables directly and
 *    every heavy reader is a static module-scope import that can be mocked
 *    wholesale.
 *
 * 2. `after()` RUNS its callback here. The route defers comms at five sites,
 *    and the precedent suite mocks `after: vi.fn()`, which SWALLOWS them: every
 *    assertion about an email or SMS would silently pass against nothing. This
 *    harness uses P0-0's `makeAfterStub()`. Do not "simplify" it.
 *
 * 3. Assertions are on OUTCOMES, never on the shape of the after() stub. AD1
 *    changes the deferral mechanism during P0-4; a suite coupled to the stub
 *    would break on a refactor that changed no behaviour, and a week would go
 *    into deciding whether that was a regression.
 *
 * The frozen shape per row is `{status, body, dbWrites[], externalCalls[]}`,
 * with time fixed by the caller via `vi.setSystemTime` and ids from fixtures
 * rather than generators, so a snapshot diff means a behaviour change.
 */

export const FIXED_NOW = '2026-06-01T09:00:00.000Z';

/** Ids are fixed strings, never generated: a snapshot must be reproducible. */
export const IDS = {
  booking: '11111111-1111-4111-8111-111111111111',
  venue: '22222222-2222-4222-8222-222222222222',
  guest: '33333333-3333-4333-8333-333333333333',
  calendar: '44444444-4444-4444-8444-444444444444',
  serviceItem: '55555555-5555-4555-8555-555555555555',
} as const;

export type BookingRow = Record<string, unknown>;

/** A booking as the route's own SELECT returns it: appointment, Booked, no deposit. */
export function baseBooking(overrides: BookingRow = {}): BookingRow {
  return {
    id: IDS.booking,
    venue_id: IDS.venue,
    guest_id: IDS.guest,
    booking_date: '2026-06-10',
    booking_time: '14:00:00',
    booking_end_time: '14:30:00',
    party_size: 1,
    status: 'Booked',
    deposit_status: null,
    deposit_amount_pence: null,
    stripe_payment_intent_id: null,
    cancellation_deadline: '2026-06-08T13:00:00+00:00',
    confirm_token_hash: 'hashed-confirm-token',
    confirm_token_used_at: null,
    service_id: null,
    practitioner_id: null,
    appointment_service_id: null,
    calendar_id: IDS.calendar,
    service_item_id: IDS.serviceItem,
    service_variant_id: null,
    addons_total_duration_minutes: 0,
    experience_event_id: null,
    class_instance_id: null,
    resource_id: null,
    event_session_id: null,
    updated_at: '2026-05-30T10:00:00+00:00',
    guest_attendance_confirmed_at: null,
    ...overrides,
  };
}

export interface ExternalCall {
  module: string;
  fn: string;
  args: unknown[];
}

export interface Frozen {
  status: number;
  body: unknown;
  /** Writes in call order: table, op, payload, filters. */
  dbWrites: Array<Pick<RecordedCall, 'table' | 'op' | 'payload' | 'filters'>>;
  /** Sorted by module then fn, so ordering noise cannot churn a snapshot. */
  externalCalls: ExternalCall[];
}

export interface RunOptions {
  /** The row the route's initial SELECT returns; null produces the 404 path. */
  booking: BookingRow | null;
  action: 'confirm' | 'cancel' | 'modify' | string;
  /** Exactly one of these in a real request; the route 400s without either. */
  auth?: { token?: string; hmac?: string };
  body?: Record<string, unknown>;
  /** Responses for tables beyond `bookings`, keyed by table name. */
  tables?: Record<string, unknown>;
}

/**
 * Record every mocked collaborator call as `{module, fn, args}` so assertions
 * name the OUTCOME (a lifecycle effect applied, an op logged) rather than the
 * mock. Sorted before freezing.
 */
export function makeCallLog() {
  const calls: ExternalCall[] = [];
  const record =
    (module: string, fn: string, impl?: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ module, fn, args });
      return impl?.(...args);
    };
  const sorted = (): ExternalCall[] =>
    [...calls].sort((a, b) => a.module.localeCompare(b.module) || a.fn.localeCompare(b.fn));
  return { calls, record, sorted };
}

/** Build the request the route parses. */
export function makeRequest(opts: RunOptions): NextRequest {
  return new NextRequest('http://localhost:3000/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      booking_id: opts.booking ? IDS.booking : IDS.booking,
      ...(opts.auth ?? { token: 'raw-confirm-token' }),
      action: opts.action,
      ...(opts.body ?? {}),
    }),
  });
}

/**
 * The recording admin client, wired to answer the route's reads. `bookings`
 * SELECTs return `opts.booking`; a null booking yields PGRST116, which is how
 * the route reaches its 404.
 */
export function makeAdminDb(opts: RunOptions) {
  return makeRecordingDb((call) => {
    if (call.table === 'bookings' && call.op === 'select') {
      return opts.booking
        ? { data: opts.booking }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    if (call.op !== 'select') return { data: null, error: null };
    const table = opts.tables?.[call.table];
    return table === undefined ? undefined : { data: table };
  });
}

/** Freeze a response plus everything it caused. */
export async function freeze(
  res: Response,
  db: ReturnType<typeof makeRecordingDb>,
  log: ReturnType<typeof makeCallLog>,
): Promise<Frozen> {
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    dbWrites: db.calls
      .filter((c) => c.op !== 'select')
      .map(({ table, op, payload, filters }) => ({ table, op, payload, filters })),
    externalCalls: log.sorted(),
  };
}

/**
 * Guard against the failure this suite is written to avoid: a row that asserts
 * nothing because the route bailed earlier than the fixture intended.
 */
export function expectFrozen(frozen: Frozen, expected: { status: number }) {
  expect(frozen.status, `expected HTTP ${expected.status}, body: ${JSON.stringify(frozen.body)}`).toBe(
    expected.status,
  );
}

export { makeAfterStub, vi };
