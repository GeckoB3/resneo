import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseFake, type FakeRow, type FakeTables } from '@/lib/testing/supabase-fake';
import { applyBookingLifecycleStatusEffects, guestVisitEffect } from './lifecycle';
import type { BookingStatus } from './booking-status';

/**
 * A guest's visit history (`visit_count`, `last_visit_date`) as staff move one booking
 * through its lifecycle. Reported from a device pass (R36): a booking three weeks out,
 * marked Arrived by mistake, left the guest reading "1 previous visit, last visit today"
 * when there had been no visit today, and undoing it could not bring the old date back.
 */

/** The read fake plus the two writes the lifecycle makes: row updates and deletes. */
function makeDb(tables: FakeTables) {
  const fake = createSupabaseFake({ tables });
  const matches = (row: FakeRow, filters: Array<[string, unknown]>) =>
    filters.every(([col, val]) => String(row[col]) === String(val));
  const writeChain = (apply: (filters: Array<[string, unknown]>) => void) => {
    const filters: Array<[string, unknown]> = [];
    const chain = {
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return chain;
      },
      then<T>(onfulfilled: (value: { error: null }) => T) {
        apply(filters);
        return Promise.resolve({ error: null }).then(onfulfilled);
      },
    };
    return chain;
  };
  const client = {
    from(table: string) {
      const query = fake.client.from(table);
      return Object.assign(query, {
        update: (payload: FakeRow) =>
          writeChain((filters) => {
            for (const row of tables[table] ?? []) if (matches(row, filters)) Object.assign(row, payload);
          }),
        delete: () =>
          writeChain((filters) => {
            tables[table] = (tables[table] ?? []).filter((row) => !matches(row, filters));
          }),
      });
    },
  };
  return client as unknown as SupabaseClient;
}

const VENUE = { id: 'v1', timezone: 'Europe/London' };

function booking(id: string, over: Partial<FakeRow> = {}): FakeRow {
  return {
    id,
    venue_id: 'v1',
    guest_id: 'g1',
    booking_date: '2026-09-12',
    status: 'Booked',
    group_booking_id: null,
    person_label: null,
    class_instance_id: null,
    ...over,
  };
}

function setup(bookings: FakeRow[], guest: Partial<FakeRow> = {}) {
  const tables: FakeTables = {
    venues: [{ ...VENUE }],
    guests: [{ id: 'g1', visit_count: 0, last_visit_date: null, ...guest }],
    bookings,
  };
  const db = makeDb(tables);
  const guestRow = () => tables.guests![0]!;
  /** Callers write the new status before the effects run, so the fake does too. */
  const move = async (id: string, from: string, to: BookingStatus) => {
    const row = tables.bookings!.find((b) => b.id === id)!;
    row.status = to;
    await applyBookingLifecycleStatusEffects(db, {
      bookingId: id,
      guestId: 'g1',
      previousStatus: from,
      nextStatus: to,
      actorId: null,
    });
  };
  return { guestRow, move, tables };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Saturday 12 September 2026, 10:00 in London.
  vi.setSystemTime(new Date('2026-09-12T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('guestVisitEffect', () => {
  it('reads each status change for what it means to the guest', () => {
    expect(guestVisitEffect('Booked', 'Seated')).toBe('start');
    expect(guestVisitEffect('Confirmed', 'Seated')).toBe('start');
    expect(guestVisitEffect('Seated', 'Booked')).toBe('undo');
    // The per-service "Undo start" on a visit goes back to Confirmed.
    expect(guestVisitEffect('Seated', 'Confirmed')).toBe('undo');
    expect(guestVisitEffect('Seated', 'Completed')).toBe('complete');
    // Reopening a finished booking is not another visit.
    expect(guestVisitEffect('Completed', 'Seated')).toBeNull();
    expect(guestVisitEffect('Seated', 'Cancelled')).toBeNull();
    expect(guestVisitEffect('Booked', 'Confirmed')).toBeNull();
    expect(guestVisitEffect('Booked', 'No-Show')).toBeNull();
  });
});

describe('last_visit_date', () => {
  it("records the booking's own date, not the day it was ticked in", async () => {
    vi.setSystemTime(new Date('2026-09-14T09:00:00Z'));
    const { guestRow, move } = setup([booking('b1', { booking_date: '2026-09-12' })]);
    await move('b1', 'Booked', 'Seated');
    expect(guestRow()).toMatchObject({ visit_count: 1, last_visit_date: '2026-09-12' });
  });

  it("uses the venue's calendar day, not UTC", async () => {
    // 13:00 UTC on the 12th is 01:00 on the 13th in Auckland.
    vi.setSystemTime(new Date('2026-09-12T13:00:00Z'));
    const { guestRow, move, tables } = setup([booking('b1', { booking_date: '2026-09-13' })]);
    tables.venues![0]!.timezone = 'Pacific/Auckland';
    await move('b1', 'Booked', 'Seated');
    expect(guestRow()).toMatchObject({ visit_count: 1, last_visit_date: '2026-09-13' });
  });

  it('never records a day that has not arrived (the reported case)', async () => {
    const { guestRow, move } = setup([booking('b1', { booking_date: '2026-09-21' })]);
    await move('b1', 'Booked', 'Seated');
    expect(guestRow()).toMatchObject({ visit_count: 1, last_visit_date: null });

    await move('b1', 'Seated', 'Booked');
    expect(guestRow()).toMatchObject({ visit_count: 0, last_visit_date: null });
  });

  it('does not move backwards when an older booking is marked late', async () => {
    const { guestRow, move } = setup([booking('b1', { booking_date: '2026-09-01' })], {
      visit_count: 3,
      last_visit_date: '2026-09-10',
    });
    await move('b1', 'Booked', 'Seated');
    expect(guestRow()).toMatchObject({ visit_count: 4, last_visit_date: '2026-09-10' });
  });

  it('records the day on completion, for a visit started early by mistake', async () => {
    const { guestRow, move } = setup([booking('b1', { booking_date: '2026-09-21' })]);
    await move('b1', 'Booked', 'Seated');
    expect(guestRow().last_visit_date).toBeNull();

    vi.setSystemTime(new Date('2026-09-21T15:00:00Z'));
    await move('b1', 'Seated', 'Completed');
    expect(guestRow()).toMatchObject({ visit_count: 1, last_visit_date: '2026-09-21' });

    // Reopening changes nothing.
    await move('b1', 'Completed', 'Seated');
    expect(guestRow()).toMatchObject({ visit_count: 1, last_visit_date: '2026-09-21' });
  });

  it('falls back to the latest other attended booking when a start is undone', async () => {
    const { guestRow, move } = setup(
      [
        booking('old', { booking_date: '2026-08-20', status: 'Completed' }),
        booking('cancelled', { booking_date: '2026-09-05', status: 'Cancelled' }),
        booking('b1', { booking_date: '2026-09-12' }),
      ],
      { visit_count: 1, last_visit_date: '2026-08-20' },
    );
    await move('b1', 'Booked', 'Seated');
    expect(guestRow()).toMatchObject({ visit_count: 2, last_visit_date: '2026-09-12' });

    await move('b1', 'Seated', 'Booked');
    expect(guestRow()).toMatchObject({ visit_count: 1, last_visit_date: '2026-08-20' });
  });

  it('clears the date when an undone start leaves the guest with no visits', async () => {
    const { guestRow, move } = setup([booking('b1')]);
    await move('b1', 'Booked', 'Seated');
    expect(guestRow()).toMatchObject({ visit_count: 1, last_visit_date: '2026-09-12' });

    await move('b1', 'Seated', 'Booked');
    expect(guestRow()).toMatchObject({ visit_count: 0, last_visit_date: null });
  });

  it('leaves the date alone when no attended booking can replace it and visits remain (an import)', async () => {
    // Imported history has no booking rows to fall back on, so the old date cannot be
    // recovered. Clearing it would lose more than it fixes for a guest with five visits.
    const { guestRow, move } = setup([booking('b1')], { visit_count: 5, last_visit_date: '2026-03-01' });
    await move('b1', 'Booked', 'Seated');
    await move('b1', 'Seated', 'Booked');
    expect(guestRow()).toMatchObject({ visit_count: 5, last_visit_date: '2026-09-12' });
  });
});

describe('visit_count', () => {
  const visit = (id: string, over: Partial<FakeRow> = {}) => booking(id, { group_booking_id: 'grp', ...over });

  it('counts a multi-service visit once, however its services are started and undone', async () => {
    const { guestRow, move } = setup([visit('cut'), visit('colour')]);

    await move('cut', 'Booked', 'Seated');
    expect(guestRow().visit_count).toBe(1);
    await move('colour', 'Booked', 'Seated');
    expect(guestRow().visit_count).toBe(1);

    // Per-service Undo start goes back to Confirmed; the cut is still under way.
    await move('colour', 'Seated', 'Confirmed');
    expect(guestRow().visit_count).toBe(1);
    await move('cut', 'Seated', 'Confirmed');
    expect(guestRow()).toMatchObject({ visit_count: 0, last_visit_date: null });
  });

  it('still counts the visit while a finished service remains', async () => {
    const { guestRow, move } = setup([visit('cut'), visit('colour')]);
    await move('cut', 'Booked', 'Seated');
    await move('cut', 'Seated', 'Completed');
    await move('colour', 'Booked', 'Seated');
    await move('colour', 'Seated', 'Booked');
    expect(guestRow()).toMatchObject({ visit_count: 1, last_visit_date: '2026-09-12' });
  });

  it('counts each day of a visit that spans two days', async () => {
    vi.setSystemTime(new Date('2026-09-13T09:00:00Z'));
    const { guestRow, move } = setup([visit('day1'), visit('day2', { booking_date: '2026-09-13' })]);
    await move('day1', 'Booked', 'Seated');
    await move('day2', 'Booked', 'Seated');
    expect(guestRow()).toMatchObject({ visit_count: 2, last_visit_date: '2026-09-13' });
  });

  it('counts each person of a group booking, and each class of a cart', async () => {
    const group = setup([
      visit('mum', { person_label: 'Mum' }),
      visit('child', { person_label: 'Child' }),
    ]);
    await group.move('mum', 'Booked', 'Seated');
    await group.move('child', 'Booked', 'Seated');
    expect(group.guestRow().visit_count).toBe(2);

    const cart = setup([
      visit('yoga', { class_instance_id: 'ci1' }),
      visit('pilates', { class_instance_id: 'ci2' }),
    ]);
    await cart.move('yoga', 'Booked', 'Seated');
    await cart.move('pilates', 'Booked', 'Seated');
    expect(cart.guestRow().visit_count).toBe(2);
  });

  it('takes the count back for a per-service Undo start on a single booking too', async () => {
    const { guestRow, move } = setup([booking('b1', { status: 'Confirmed' })]);
    await move('b1', 'Confirmed', 'Seated');
    await move('b1', 'Seated', 'Confirmed');
    expect(guestRow()).toMatchObject({ visit_count: 0, last_visit_date: null });
  });
});
