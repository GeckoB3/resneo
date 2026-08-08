import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findStuckPendingComms, findUncommunicatedBookings } from './delivery-health';

interface Stub {
  bookings?: Array<Record<string, unknown>>;
  loggedBookingIds?: string[];
  pending?: Array<Record<string, unknown>>;
  bookingsError?: { message: string };
  logsError?: { message: string };
}

/** Captures the filters applied so the query itself can be asserted, not just its result. */
function makeAdmin(s: Stub) {
  const captured = { notCalls: [] as unknown[][], inIds: [] as string[] };

  const from = (table: string) => {
    if (table === 'bookings') {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain,
        gte: chain,
        lte: chain,
        order: chain,
        not: (...args: unknown[]) => {
          captured.notCalls.push(args);
          return b;
        },
        limit: () =>
          Promise.resolve({ data: s.bookings ?? [], error: s.bookingsError ?? null }),
      });
      return b;
    }

    if (table === 'communication_logs') {
      const c: Record<string, unknown> = {};
      const chain = () => c;
      Object.assign(c, {
        select: chain,
        eq: chain,
        gte: chain,
        order: chain,
        lte: chain,
        in: (_col: string, ids: string[]) => {
          captured.inIds = ids;
          return Promise.resolve({
            data: (s.loggedBookingIds ?? []).map((id) => ({ booking_id: id })),
            error: s.logsError ?? null,
          });
        },
        limit: () => Promise.resolve({ data: s.pending ?? [], error: null }),
      });
      return c;
    }

    throw new Error(`unexpected table ${table}`);
  };

  return { admin: { from } as unknown as SupabaseClient, captured };
}

const today = new Date().toISOString().slice(0, 10);

function booking(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    venue_id: 'v1',
    booking_date: today,
    booking_time: '14:00:00',
    status: 'Booked',
    guest_email: 'ann@example.test',
    ...extra,
  };
}

describe('findUncommunicatedBookings', () => {
  it('returns bookings that have no communication logged at all', async () => {
    const { admin } = makeAdmin({
      bookings: [booking('b1'), booking('b2')],
      loggedBookingIds: ['b2'],
    });

    const out = await findUncommunicatedBookings(admin);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ booking_id: 'b1', venue_id: 'v1', status: 'Booked' });
  });

  it('returns nothing when every booking has a communication', async () => {
    const { admin } = makeAdmin({
      bookings: [booking('b1'), booking('b2')],
      loggedBookingIds: ['b1', 'b2'],
    });

    expect(await findUncommunicatedBookings(admin)).toEqual([]);
  });

  it('excludes cancelled and no-show bookings, which are not expected to generate comms', async () => {
    const probe = makeAdmin({ bookings: [booking('b1')] });

    await findUncommunicatedBookings(probe.admin);

    const statusFilter = probe.captured.notCalls.find((c) => c[0] === 'status');
    expect(statusFilter).toBeDefined();
    expect(String(statusFilter?.[2])).toContain('Cancelled');
    expect(String(statusFilter?.[2])).toContain('No-Show');
  });

  it('only considers bookings with a contactable guest', async () => {
    const probe = makeAdmin({ bookings: [booking('b1')] });

    await findUncommunicatedBookings(probe.admin);

    const emailFilter = probe.captured.notCalls.find((c) => c[0] === 'guest_email');
    expect(emailFilter).toEqual(['guest_email', 'is', null]);
  });

  it('does not query logs when there are no bookings in the window', async () => {
    const probe = makeAdmin({ bookings: [] });

    expect(await findUncommunicatedBookings(probe.admin)).toEqual([]);
    expect(probe.captured.inIds).toEqual([]);
  });

  it('throws when the bookings query fails, rather than reporting a clean result', async () => {
    const { admin } = makeAdmin({ bookingsError: { message: 'db down' } });

    // A silent empty result here would read as "nothing wrong", which is the exact
    // failure mode this check exists to eliminate.
    await expect(findUncommunicatedBookings(admin)).rejects.toThrow(/delivery health/i);
  });

  it('throws when the logs query fails', async () => {
    const { admin } = makeAdmin({
      bookings: [booking('b1')],
      logsError: { message: 'db down' },
    });

    await expect(findUncommunicatedBookings(admin)).rejects.toThrow(/delivery health/i);
  });
});

describe('findStuckPendingComms', () => {
  it('reports age in hours for rows still pending', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const { admin } = makeAdmin({
      pending: [
        {
          id: 'c1',
          venue_id: 'v1',
          booking_id: 'b1',
          message_type: 'reminder_56h_email',
          channel: 'email',
          created_at: threeHoursAgo,
        },
      ],
    });

    const out = await findStuckPendingComms(admin);

    expect(out).toHaveLength(1);
    expect(out[0].message_type).toBe('reminder_56h_email');
    expect(out[0].age_hours).toBeGreaterThanOrEqual(2.9);
    expect(out[0].age_hours).toBeLessThanOrEqual(3.1);
  });

  it('returns an empty list when nothing is stuck', async () => {
    const { admin } = makeAdmin({ pending: [] });
    expect(await findStuckPendingComms(admin)).toEqual([]);
  });
});
