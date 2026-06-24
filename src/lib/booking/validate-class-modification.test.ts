import { describe, expect, it } from 'vitest';
import { validateClassModification } from '@/lib/booking/validate-class-modification';

/**
 * These tests exercise validateClassModification against a hand-rolled fake of
 * the Supabase query builder (the three reads it performs: class_instances,
 * class_types, bookings). The real future/notice maths (via
 * isClassInstanceBookableForGuest → venueLocalDateTimeToUtcMs) runs unmocked, so
 * we pin `referenceNowMs` and use Europe/London to keep assertions deterministic.
 */

const VENUE_TZ = 'Europe/London';
// 2026-06-22T12:00:00Z — well before the future instances used below.
const NOW_MS = Date.UTC(2026, 5, 22, 12, 0, 0);

const CLASS_TYPE_ID = 'ct-1';
const TARGET_INSTANCE_ID = 'ci-target';
const BOOKING_ID = 'bk-moving';

interface FakeData {
  instance?: Record<string, unknown> | null;
  classType?: Record<string, unknown> | null;
  bookings?: Array<{ id: string; party_size: number | null }>;
}

/**
 * Minimal stand-in for the chained Supabase client used by the validator.
 * Routes by table name; `.maybeSingle()` resolves single rows, `.in()` returns
 * the bookings array via an awaitable terminal.
 */
function makeAdmin(data: FakeData): unknown {
  return {
    from(table: string) {
      if (table === 'class_instances') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: data.instance ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === 'class_types') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: data.classType ?? null, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'bookings') {
        // .eq().eq().in() → awaitable resolving to the booking rows.
        const result = { data: data.bookings ?? [], error: null };
        const inTerminal = { then: (r: (v: typeof result) => unknown) => r(result) };
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => inTerminal,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function activeClassType(overrides: Record<string, unknown> = {}) {
  return {
    id: CLASS_TYPE_ID,
    venue_id: 'venue-1',
    name: 'Vinyasa Flow',
    duration_minutes: 60,
    capacity: 10,
    is_active: true,
    cancellation_notice_hours: 24,
    min_booking_notice_hours: 2,
    ...overrides,
  };
}

function futureInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_INSTANCE_ID,
    class_type_id: CLASS_TYPE_ID,
    instance_date: '2026-06-25',
    start_time: '18:00',
    capacity_override: null,
    is_cancelled: false,
    ...overrides,
  };
}

const base = {
  venueId: 'venue-1',
  bookingId: BOOKING_ID,
  currentClassTypeId: CLASS_TYPE_ID,
  targetInstanceId: TARGET_INSTANCE_ID,
  partySize: 1,
  venueTimezone: VENUE_TZ,
  referenceNowMs: NOW_MS,
};

describe('validateClassModification', () => {
  it('accepts a move to a future instance of the same class type with capacity', async () => {
    const admin = makeAdmin({
      instance: futureInstance(),
      classType: activeClassType(),
      bookings: [{ id: 'other', party_size: 3 }],
    });
    const r = await validateClassModification({ ...base, admin: admin as never });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.instanceDate).toBe('2026-06-25');
      expect(r.startTime).toBe('18:00');
      expect(r.classTypeId).toBe(CLASS_TYPE_ID);
      expect(r.remaining).toBe(7); // capacity 10 - 3 booked
      expect(r.cancellationNoticeHours).toBe(24);
      expect(r.durationMinutes).toBe(60);
    }
  });

  it('rejects moving to an instance of a DIFFERENT class type', async () => {
    const admin = makeAdmin({
      instance: futureInstance({ class_type_id: 'ct-other' }),
      classType: activeClassType(),
      bookings: [],
    });
    const r = await validateClassModification({ ...base, admin: admin as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/same class/i);
  });

  it('rejects a cancelled target instance', async () => {
    const admin = makeAdmin({
      instance: futureInstance({ is_cancelled: true }),
      classType: activeClassType(),
      bookings: [],
    });
    const r = await validateClassModification({ ...base, admin: admin as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cancelled/i);
  });

  it('rejects a target instance that is in the past', async () => {
    const admin = makeAdmin({
      instance: futureInstance({ instance_date: '2026-06-20', start_time: '09:00' }),
      classType: activeClassType(),
      bookings: [],
    });
    const r = await validateClassModification({ ...base, admin: admin as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already started|too soon/i);
  });

  it('rejects when the target instance is full', async () => {
    const admin = makeAdmin({
      instance: futureInstance(),
      classType: activeClassType({ capacity: 5 }),
      bookings: [
        { id: 'a', party_size: 2 },
        { id: 'b', party_size: 3 },
      ],
    });
    const r = await validateClassModification({ ...base, admin: admin as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/full/i);
  });

  it('excludes the booking being moved from the capacity tally', async () => {
    // Capacity 5, the moving booking already counts for 4 on this instance; with
    // it excluded only 0 others remain, so a party of 4 still fits (in-place move).
    const admin = makeAdmin({
      instance: futureInstance(),
      classType: activeClassType({ capacity: 5 }),
      bookings: [{ id: BOOKING_ID, party_size: 4 }],
    });
    const r = await validateClassModification({ ...base, partySize: 4, admin: admin as never });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.remaining).toBe(5);
  });

  it('honours capacity_override over the class type capacity', async () => {
    const admin = makeAdmin({
      instance: futureInstance({ capacity_override: 2 }),
      classType: activeClassType({ capacity: 50 }),
      bookings: [{ id: 'x', party_size: 2 }],
    });
    const r = await validateClassModification({ ...base, admin: admin as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/full/i);
  });

  it('rejects a guest move that violates the class min booking notice', async () => {
    // Instance starts 2026-06-22 13:00 London (= 12:00Z, 1h after NOW). With a
    // 2h guest notice the move is too soon; a staff move (enforceGuestNotice
    // false) would be allowed since the start is still ahead of now.
    const admin = makeAdmin({
      instance: futureInstance({ instance_date: '2026-06-22', start_time: '13:30' }),
      classType: activeClassType({ min_booking_notice_hours: 2 }),
      bookings: [],
    });
    const guest = await validateClassModification({
      ...base,
      enforceGuestNotice: true,
      admin: admin as never,
    });
    expect(guest.ok).toBe(false);
    if (!guest.ok) expect(guest.reason).toMatch(/too soon/i);

    const staff = await validateClassModification({
      ...base,
      enforceGuestNotice: false,
      admin: makeAdmin({
        instance: futureInstance({ instance_date: '2026-06-22', start_time: '13:30' }),
        classType: activeClassType({ min_booking_notice_hours: 2 }),
        bookings: [],
      }) as never,
    });
    expect(staff.ok).toBe(true);
  });
});
