import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertCanDisableBookingModels } from './venue-booking-model-disable-guard';

type Row = {
  booking_date: string;
  booking_time: string;
  booking_model: string;
  status: string;
};

/** Records the `.in('booking_model', ...)` filter so tests can assert what was asked for. */
function makeDb(rows: Row[] | null, error: { message: string } | null = null) {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    }),
    in: vi.fn((col: string, vals: unknown[]) => {
      filters[col] = vals;
      return chain;
    }),
    gte: vi.fn((col: string, val: unknown) => {
      filters[`gte_${col}`] = val;
      return chain;
    }),
    then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
      Promise.resolve({ data: rows, error }).then(resolve),
  };
  const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  return { db, filters };
}

const TZ = 'Europe/London';

/** Fixed "now": Wed 12 Aug 2026, 10:00 London. */
const NOW = new Date('2026-08-12T09:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('assertCanDisableBookingModels', () => {
  it('does nothing when no models are being removed', async () => {
    const { db } = makeDb([]);
    await expect(assertCanDisableBookingModels(db, 'v1', TZ, [])).resolves.toBeUndefined();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('allows the removal when the model has no upcoming bookings', async () => {
    const { db } = makeDb([]);
    await expect(
      assertCanDisableBookingModels(db, 'v1', TZ, ['resource_booking']),
    ).resolves.toBeUndefined();
  });

  it('refuses, naming the model, the count and the next booking', async () => {
    const { db } = makeDb([
      { booking_date: '2026-08-20', booking_time: '11:00:00', booking_model: 'class_session', status: 'Booked' },
      { booking_date: '2026-08-14', booking_time: '14:00:00', booking_model: 'class_session', status: 'Confirmed' },
      { booking_date: '2026-08-25', booking_time: '09:30:00', booking_model: 'class_session', status: 'Booked' },
    ]);

    await expect(assertCanDisableBookingModels(db, 'v1', TZ, ['class_session'])).rejects.toThrow(
      /Classes cannot be turned off yet\. You have 3 upcoming bookings of that type, the next on Fri 14 Aug 2026 at 2:00pm\./,
    );
  });

  /** The earliest booking must win regardless of the order the query returns rows in. */
  it('names the earliest booking, not the first row returned', async () => {
    const { db } = makeDb([
      { booking_date: '2026-08-30', booking_time: '08:00:00', booking_model: 'resource_booking', status: 'Booked' },
      { booking_date: '2026-08-13', booking_time: '16:45:00', booking_model: 'resource_booking', status: 'Booked' },
    ]);

    await expect(
      assertCanDisableBookingModels(db, 'v1', TZ, ['resource_booking']),
    ).rejects.toThrow(/the next on Thu 13 Aug 2026 at 4:45pm/);
  });

  it('uses the singular wording for exactly one booking', async () => {
    const { db } = makeDb([
      { booking_date: '2026-08-14', booking_time: '09:00:00', booking_model: 'event_ticket', status: 'Booked' },
    ]);

    await expect(assertCanDisableBookingModels(db, 'v1', TZ, ['event_ticket'])).rejects.toThrow(
      /You have 1 upcoming booking of that type, on Fri 14 Aug 2026 at 9:00am\. Cancel or complete it first/,
    );
  });

  it('tags the error so the route can answer 409', async () => {
    const { db } = makeDb([
      { booking_date: '2026-08-14', booking_time: '09:00:00', booking_model: 'class_session', status: 'Booked' },
    ]);

    await expect(
      assertCanDisableBookingModels(db, 'v1', TZ, ['class_session']),
    ).rejects.toMatchObject({
      code: 'BOOKING_MODEL_HAS_FUTURE_BOOKINGS',
      model: 'class_session',
      upcomingCount: 1,
      nextBookingDate: '2026-08-14',
    });
  });

  it('ignores cancelled, completed and no-show bookings', async () => {
    const { db } = makeDb([
      { booking_date: '2026-08-20', booking_time: '11:00:00', booking_model: 'class_session', status: 'Cancelled' },
      { booking_date: '2026-08-21', booking_time: '11:00:00', booking_model: 'class_session', status: 'Completed' },
      { booking_date: '2026-08-22', booking_time: '11:00:00', booking_model: 'class_session', status: 'No-Show' },
    ]);

    await expect(
      assertCanDisableBookingModels(db, 'v1', TZ, ['class_session']),
    ).resolves.toBeUndefined();
  });

  /** Recorded decision: later today still counts, this morning's finished booking does not. */
  it('counts a booking later today but not one earlier today', async () => {
    const past = makeDb([
      { booking_date: '2026-08-12', booking_time: '08:00:00', booking_model: 'class_session', status: 'Booked' },
    ]);
    await expect(
      assertCanDisableBookingModels(past.db, 'v1', TZ, ['class_session']),
    ).resolves.toBeUndefined();

    const later = makeDb([
      { booking_date: '2026-08-12', booking_time: '16:00:00', booking_model: 'class_session', status: 'Booked' },
    ]);
    await expect(
      assertCanDisableBookingModels(later.db, 'v1', TZ, ['class_session']),
    ).rejects.toThrow(/Classes cannot be turned off yet/);
  });

  it('treats the legacy practitioner_appointment value as unified scheduling', async () => {
    const { db, filters } = makeDb([
      {
        booking_date: '2026-08-14',
        booking_time: '09:00:00',
        booking_model: 'practitioner_appointment',
        status: 'Booked',
      },
    ]);

    await expect(
      assertCanDisableBookingModels(db, 'v1', TZ, ['unified_scheduling']),
    ).rejects.toThrow(/Appointments cannot be turned off yet/);
    expect(filters.booking_model).toEqual(
      expect.arrayContaining(['unified_scheduling', 'practitioner_appointment']),
    );
  });

  it('reports the first removed model that has bookings, in the caller order', async () => {
    const { db } = makeDb([
      { booking_date: '2026-08-14', booking_time: '09:00:00', booking_model: 'event_ticket', status: 'Booked' },
      { booking_date: '2026-08-15', booking_time: '09:00:00', booking_model: 'class_session', status: 'Booked' },
    ]);

    await expect(
      assertCanDisableBookingModels(db, 'v1', TZ, ['class_session', 'event_ticket']),
    ).rejects.toThrow(/^Classes cannot be turned off yet/);
  });

  it('propagates a query failure rather than allowing the removal', async () => {
    const { db } = makeDb(null, { message: 'boom' });
    await expect(
      assertCanDisableBookingModels(db, 'v1', TZ, ['class_session']),
    ).rejects.toThrow('boom');
  });
});
