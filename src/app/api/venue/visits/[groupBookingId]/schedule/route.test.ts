import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * The schedule endpoint's contract, with the engine and the database stood in
 * for: what it writes for a shift and for a per-service edit, which sibling
 * counts as a collision, that a failed write rolls back, and that the guest
 * hears once.
 */
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // Runs the deferred work now, so a test can see the notification fire.
  after: (cb: () => unknown) => {
    void cb();
  },
}));
vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  })),
}));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireManagedCalendarAccess: vi.fn(async () => ({ ok: true, managedCalendarIds: [] })),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/booking/staff-booking-access', () => ({
  loadStaffAccessibleBooking: vi.fn(),
  linkedGrantAllowsMutation: vi.fn(() => true),
  linkedGrantAllowsCalendar: vi.fn(() => true),
}));
vi.mock('@/lib/booking/staff-booking-calendar-scope', () => ({
  resolveBookingScopedCalendarId: vi.fn(async (_a: unknown, _v: unknown, b: { calendar_id?: string }) => b.calendar_id ?? null),
}));
vi.mock('@/lib/booking/validate-appointment-modification', () => ({
  validateAppointmentModificationInterval: vi.fn(),
}));
vi.mock('@/lib/booking/visit-write-shared', () => ({
  visitCancellationFields: vi.fn(async () => ({
    cancellation_deadline: '2026-09-08T10:00:00.000Z',
    cancellation_policy_snapshot: { refund_window_hours: 24, policy: 'p' },
  })),
  resetVisitScheduledComms: vi.fn(async () => {}),
}));
vi.mock('@/lib/compliance/enforce-booking', () => ({
  checkBookingCompliance: vi.fn(async () => ({ blocked: false, details: [] })),
  complianceUnmetMessage: vi.fn(() => 'unmet'),
  COMPLIANCE_REQUIREMENT_UNMET: 'compliance_requirement_unmet',
}));
vi.mock('@/lib/compliance/records-service', () => ({
  rescheduleBookingComplianceRecords: vi.fn(async () => {}),
}));
vi.mock('@/lib/linked-accounts/audit', () => ({ recordBookingWriteAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/linked-accounts/notifications', () => ({ notifyCrossVenueBookingWrite: vi.fn(async () => {}) }));
vi.mock('@/lib/booking/log-booking-modified-event', () => ({ logBookingModifiedEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/booking/send-booking-modification-guest-notification', () => ({
  executeBookingModificationGuestNotification: vi.fn(async () => {}),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadStaffAccessibleBooking } from '@/lib/booking/staff-booking-access';
import { validateAppointmentModificationInterval } from '@/lib/booking/validate-appointment-modification';
import { resetVisitScheduledComms } from '@/lib/booking/visit-write-shared';
import { executeBookingModificationGuestNotification } from '@/lib/booking/send-booking-modification-guest-notification';
import { PATCH } from './route';

const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAL_D = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAL_J = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ROW_A = '11111111-1111-4111-8111-111111111111';
const ROW_B = '22222222-2222-4222-8222-222222222222';
const SVC_1 = '33333333-3333-4333-8333-333333333333';
const SVC_2 = '44444444-4444-4444-8444-444444444444';

type Row = Record<string, unknown> & { id: string; booking_date: string; booking_time: string; booking_end_time: string; updated_at: string };

/** Cut 10:00-11:00 then Beard Trim 11:00-11:30, both on David, 9 Sep. */
function rows(): Row[] {
  return [
    {
      id: ROW_A,
      venue_id: VENUE,
      status: 'Booked',
      booking_date: '2026-09-09',
      booking_time: '10:00:00',
      booking_end_time: '11:00:00',
      calendar_id: CAL_D,
      service_item_id: SVC_1,
      service_name_snapshot: 'Cut & Blow Dry',
      group_booking_id: GROUP,
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: ROW_B,
      venue_id: VENUE,
      status: 'Booked',
      booking_date: '2026-09-09',
      booking_time: '11:00:00',
      booking_end_time: '11:30:00',
      calendar_id: CAL_D,
      service_item_id: SVC_2,
      service_name_snapshot: 'Beard Trim',
      group_booking_id: GROUP,
      updated_at: '2026-09-01T00:00:00.000Z',
    },
  ];
}

type Update = { id: string; payload: Record<string, unknown>; guarded: boolean };

/**
 * A database with the visit in it. `updateResult` decides what each guarded
 * update returns (the updated row, or null for a stale guard).
 */
function makeDb(fixture: Row[], updateResult: (id: string) => 'ok' | 'stale' = () => 'ok') {
  const updates: Update[] = [];
  const db = {
    from(table: string) {
      const call: { op: string; payload?: Record<string, unknown>; filters: Array<[string, unknown, unknown?]> } = { op: 'select', filters: [] };
      const b: Record<string, unknown> = {};
      const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => {
        fn(...a);
        return b;
      };
      b.select = chain(() => {});
      b.update = chain((p) => {
        call.op = 'update';
        call.payload = p as Record<string, unknown>;
      });
      for (const f of ['eq', 'in', 'neq', 'is', 'order', 'limit']) {
        b[f] = chain((...a) => call.filters.push([f, a[0], a[1]]));
      }
      const resolve = () => {
        if (table === 'bookings' && call.op === 'select') {
          return Promise.resolve({ data: fixture, error: null });
        }
        if (table === 'bookings' && call.op === 'update') {
          const id = String(call.filters.find((f) => f[0] === 'eq' && f[1] === 'id')?.[2]);
          const guarded = call.filters.some((f) => f[0] === 'eq' && f[1] === 'updated_at');
          updates.push({ id, payload: call.payload!, guarded });
          if (guarded && updateResult(id) === 'stale') return Promise.resolve({ data: null, error: null });
          const row = fixture.find((r) => r.id === id)!;
          return Promise.resolve({ data: { ...row, ...call.payload }, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      };
      b.maybeSingle = resolve;
      b.single = resolve;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => resolve().then(res, rej);
      return b;
    },
  };
  return { db, updates };
}

/**
 * The engine, stood in for: a window collides with any fixture row on the same
 * calendar and day that is not excluded, unless overlap is allowed.
 */
function engineAgainst(fixture: Row[]) {
  vi.mocked(validateAppointmentModificationInterval).mockImplementation(async (params) => {
    const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
    const start = toMin(params.timeStr);
    const end = start + (params.durationMinutes ?? 0);
    const excluded = new Set([params.bookingId, ...(params.excludeBookingIds ?? [])]);
    const hit = fixture.find(
      (r) =>
        !excluded.has(r.id) &&
        r.calendar_id === params.practId &&
        r.booking_date === params.newDate &&
        toMin(r.booking_time) < end &&
        start < toMin(r.booking_end_time),
    );
    if (hit && !params.allowManualOverlap) {
      return { ok: false, reason: 'Overlaps another booking', code: 'overlap' } as never;
    }
    return { ok: true, outsideHours: false };
  });
}

function setup(opts: { updateResult?: (id: string) => 'ok' | 'stale' } = {}) {
  const fixture = rows();
  const { db, updates } = makeDb(fixture, opts.updateResult);
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 'staff-1', venue_id: VENUE, email: 'a@b.c', role: 'admin', db } as never);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(db as never);
  vi.mocked(loadStaffAccessibleBooking).mockResolvedValue({
    ok: true,
    ctx: { booking: fixture[0], ownerVenueId: VENUE, isOwnVenue: true, linkedGrant: null, linkId: null },
  } as never);
  engineAgainst(fixture);
  return { fixture, updates };
}

/** Lets the deferred notification's dynamic import settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const params = { params: Promise.resolve({ groupBookingId: GROUP }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/venue/visits/[gid]/schedule', () => {
  it('refuses a body with neither mode, or both', async () => {
    setup();
    expect((await PATCH(req({}), params)).status).toBe(400);
    expect(
      (await PATCH(req({ shift: {}, services: [{ booking_id: ROW_A, booking_time: '12:00' }] }), params)).status,
    ).toBe(400);
  });

  it('a shift moves every service by the same delta, writes both, and tells the guest once', async () => {
    const { updates } = setup();
    const res = await PATCH(req({ shift: { booking_time: '14:00' } }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(true);
    expect(body.services.map((s: { id: string; booking_time: string; booking_end_time: string }) => [s.id, s.booking_time, s.booking_end_time])).toEqual([
      [ROW_A, '14:00:00', '15:00:00'],
      [ROW_B, '15:00:00', '15:30:00'],
    ]);
    // Both rows written under their own guard; each checked with the other excluded.
    expect(updates.filter((u) => u.guarded).map((u) => [u.id, u.payload.booking_time])).toEqual([
      [ROW_A, '14:00:00'],
      [ROW_B, '15:00:00'],
    ]);
    for (const call of vi.mocked(validateAppointmentModificationInterval).mock.calls) {
      expect(call[0].excludeBookingIds).toEqual([ROW_A, ROW_B]);
    }
    expect(vi.mocked(resetVisitScheduledComms)).toHaveBeenCalledWith(expect.anything(), [ROW_A, ROW_B]);
    await flush();
    expect(vi.mocked(executeBookingModificationGuestNotification)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeBookingModificationGuestNotification).mock.calls[0]![2]).toBe(ROW_A);
  });

  it('a shift to another calendar rewrites the calendar on every row and moves nothing', async () => {
    const { updates } = setup();
    const res = await PATCH(req({ shift: { practitioner_id: CAL_J } }), params);
    expect(res.status).toBe(200);
    expect(updates.filter((u) => u.guarded).map((u) => [u.id, u.payload.calendar_id, u.payload.booking_time])).toEqual([
      [ROW_A, CAL_J, '10:00:00'],
      [ROW_B, CAL_J, '11:00:00'],
    ]);
    expect(vi.mocked(resetVisitScheduledComms)).not.toHaveBeenCalled();
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });

  it('an empty shift describes the visit and writes nothing', async () => {
    const { updates } = setup();
    const res = await PATCH(req({ shift: {}, dry_run: true }), params);
    const body = await res.json();
    expect(body.changed).toBe(false);
    expect(body.services.map((s: { id: string; service_id: string }) => s.service_id)).toEqual([SVC_1, SVC_2]);
    expect(updates).toHaveLength(0);
  });

  it('a per-service edit writes only the service named', async () => {
    const { updates } = setup();
    const res = await PATCH(
      req({ services: [{ booking_id: ROW_B, booking_time: '15:00', duration_minutes: 45, practitioner_id: CAL_J }] }),
      params,
    );
    expect(res.status).toBe(200);
    expect(updates.filter((u) => u.guarded)).toHaveLength(1);
    const only = updates[0]!;
    expect(only.id).toBe(ROW_B);
    expect(only.payload).toMatchObject({ booking_time: '15:00:00', booking_end_time: '15:45:00', calendar_id: CAL_J });
    // The visit's earliest slot did not move, so no deadline is re-pinned.
    expect(only.payload.cancellation_deadline).toBeUndefined();
    expect(vi.mocked(resetVisitScheduledComms)).toHaveBeenCalledWith(expect.anything(), [ROW_B]);
    await flush();
    expect(vi.mocked(executeBookingModificationGuestNotification)).toHaveBeenCalledTimes(1);
  });

  it('moving the earliest service re-pins the visit deadline on the row that stayed too', async () => {
    const { updates } = setup();
    const res = await PATCH(req({ services: [{ booking_id: ROW_A, booking_time: '08:00' }] }), params);
    expect(res.status).toBe(200);
    expect(updates.map((u) => [u.id, u.payload.booking_time ?? null, u.payload.cancellation_deadline])).toEqual([
      [ROW_A, '08:00:00', '2026-09-08T10:00:00.000Z'],
      [ROW_B, null, '2026-09-08T10:00:00.000Z'],
    ]);
  });

  it('a stationary sibling is a real collision, which allow_manual_overlap overrides', async () => {
    const { updates } = setup();
    const refused = await PATCH(req({ services: [{ booking_id: ROW_A, booking_time: '10:45' }] }), params);
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error).toMatch(/^Cut & Blow Dry cannot go to 10:45: Overlaps another booking/);
    expect(body.service_id).toBe(ROW_A);
    expect(updates).toHaveLength(0);

    const allowed = await PATCH(
      req({ services: [{ booking_id: ROW_A, booking_time: '10:45' }], allow_manual_overlap: true }),
      params,
    );
    expect(allowed.status).toBe(200);
    // Cut moved (and, as the visit's earliest service, re-pinned the deadline on Beard Trim).
    expect(updates.filter((u) => u.payload.booking_time).map((u) => u.id)).toEqual([ROW_A]);
  });

  it('two services moved onto each other are a collision too, which allow_manual_overlap overrides', async () => {
    const { updates } = setup();
    // Each is checked with the other off the calendar; their NEW slots still clash.
    const refused = await PATCH(
      req({
        services: [
          { booking_id: ROW_A, booking_time: '14:00' },
          { booking_id: ROW_B, booking_time: '14:30' },
        ],
      }),
      params,
    );
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error).toMatch(/^Beard Trim cannot go to 14:30: it would overlap Cut & Blow Dry/);
    expect(body.service_id).toBe(ROW_B);
    expect(updates).toHaveLength(0);

    const allowed = await PATCH(
      req({
        services: [
          { booking_id: ROW_A, booking_time: '14:00' },
          { booking_id: ROW_B, booking_time: '14:30' },
        ],
        allow_manual_overlap: true,
      }),
      params,
    );
    expect(allowed.status).toBe(200);
    expect(updates.filter((u) => u.guarded).map((u) => u.id).sort()).toEqual([ROW_A, ROW_B].sort());

    // On different calendars the same times are no collision.
    const apart = await PATCH(
      req({
        services: [
          { booking_id: ROW_A, booking_time: '14:00' },
          { booking_id: ROW_B, booking_time: '14:30', practitioner_id: CAL_J },
        ],
      }),
      params,
    );
    expect(apart.status).toBe(200);
  });

  it('a refusal names the day when the service is going to another one', async () => {
    setup();
    vi.mocked(validateAppointmentModificationInterval).mockResolvedValue({ ok: false, reason: 'Blocked time', code: 'blocked' } as never);
    const res = await PATCH(
      req({ services: [{ booking_id: ROW_B, booking_date: '2026-09-16', booking_time: '09:00' }] }),
      params,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Beard Trim cannot go to 09:00 on Wed 16 Sep: Blocked time/);
  });

  it('a write that fails part-way puts back the rows already written', async () => {
    const { updates } = setup({ updateResult: (id) => (id === ROW_B ? 'stale' : 'ok') });
    const res = await PATCH(req({ shift: { booking_time: '14:00' } }), params);
    expect(res.status).toBe(412);
    expect((await res.json()).code).toBe('stale_booking');
    // A written, B stale, then A restored without a guard.
    expect(updates.map((u) => [u.id, u.guarded, u.payload.booking_time])).toEqual([
      [ROW_A, true, '14:00:00'],
      [ROW_B, true, '15:00:00'],
      [ROW_A, false, '10:00:00'],
    ]);
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });

  it('refuses a stale view of the visit and an unknown service', async () => {
    const { updates } = setup();
    const stale = await PATCH(
      req({ services: [{ booking_id: ROW_A, booking_time: '12:00' }], known_booking_ids: [ROW_A] }),
      params,
    );
    expect(stale.status).toBe(412);
    expect((await stale.json()).code).toBe('stale_visit');
    const unknown = await PATCH(
      req({ services: [{ booking_id: '99999999-9999-4999-8999-999999999999', booking_time: '12:00' }] }),
      params,
    );
    expect(unknown.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('a dry run checks everything and writes nothing', async () => {
    const { updates } = setup();
    const res = await PATCH(req({ shift: { booking_time: '14:00' }, dry_run: true }), params);
    const body = await res.json();
    expect(body.dry_run).toBe(true);
    expect(body.changed).toBe(true);
    expect(vi.mocked(validateAppointmentModificationInterval)).toHaveBeenCalledTimes(2);
    expect(updates).toHaveLength(0);
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });

  it('a deferred or skipped notification is not sent', async () => {
    setup();
    await PATCH(req({ shift: { booking_time: '14:00' }, defer_modification_guest_notification: true }), params);
    await PATCH(req({ shift: { booking_time: '14:00' }, skip_booking_modification_guest_notification: true }), params);
    await flush();
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });
});
