import { describe, expect, it, vi } from 'vitest';
import { applyAttendanceMutation } from '@/lib/class-commerce/class-attendance';

const VENUE = 'venue-1';
const INSTANCE = 'inst-1';
const BOOKING = 'booking-1';

interface BookingRow {
  id: string;
  venue_id: string;
  class_instance_id: string | null;
  guest_id: string;
  status: string;
  checked_in_at: string | null;
}

function makeBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: BOOKING,
    venue_id: VENUE,
    class_instance_id: INSTANCE,
    guest_id: 'guest-1',
    status: 'Booked',
    checked_in_at: null,
    ...overrides,
  };
}

/**
 * Admin double covering the chains applyAttendanceMutation exercises:
 * bookings select/update, guests select (user_id null skips enrollment mirroring),
 * events insert. Captures every bookings update payload.
 */
function makeAdmin(bookingRow: BookingRow) {
  const bookingUpdates: Array<Record<string, unknown>> = [];
  const eventInserts: Array<Record<string, unknown>> = [];
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: bookingRow, error: null }),
            }),
          }),
          update: vi.fn((patch: Record<string, unknown>) => {
            bookingUpdates.push(patch);
            return { eq: vi.fn().mockResolvedValue({ error: null }) };
          }),
        };
      }
      if (table === 'guests') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: null }, error: null }),
            }),
          }),
        };
      }
      if (table === 'events') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            eventInserts.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return { admin: admin as never, bookingUpdates, eventInserts };
}

describe('applyAttendanceMutation no_show', () => {
  it("writes the canonical 'No-Show' status (hyphen), never 'No Show'", async () => {
    const { admin, bookingUpdates, eventInserts } = makeAdmin(makeBooking());

    const res = await applyAttendanceMutation({
      admin,
      venueId: VENUE,
      classInstanceId: INSTANCE,
      bookingId: BOOKING,
      kind: 'no_show',
      actorId: 'staff-1',
    });

    expect(res).toEqual({ ok: true, changed: true });
    expect(bookingUpdates).toHaveLength(1);
    expect(bookingUpdates[0]!.status).toBe('No-Show');
    expect(bookingUpdates[0]!.status).not.toBe('No Show');
    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0]!.event_type).toBe('class_no_show');
  });

  it("is idempotent: a booking already 'No-Show' is not updated again", async () => {
    const { admin, bookingUpdates, eventInserts } = makeAdmin(
      makeBooking({ status: 'No-Show' }),
    );

    const res = await applyAttendanceMutation({
      admin,
      venueId: VENUE,
      classInstanceId: INSTANCE,
      bookingId: BOOKING,
      kind: 'no_show',
      actorId: 'staff-1',
    });

    expect(res).toEqual({ ok: true, changed: false });
    expect(bookingUpdates).toHaveLength(0);
    expect(eventInserts).toHaveLength(0);
  });

  it('rejects a no-show on a cancelled booking', async () => {
    const { admin, bookingUpdates } = makeAdmin(makeBooking({ status: 'Cancelled' }));

    const res = await applyAttendanceMutation({
      admin,
      venueId: VENUE,
      classInstanceId: INSTANCE,
      bookingId: BOOKING,
      kind: 'no_show',
      actorId: null,
    });

    expect(res).toEqual({
      ok: false,
      status: 409,
      error: 'Cannot mark attendance on a cancelled booking',
    });
    expect(bookingUpdates).toHaveLength(0);
  });
});
