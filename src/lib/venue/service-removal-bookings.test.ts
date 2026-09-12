import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  affectedBookingLabel,
  affectedCalendarIds,
  affectedServiceIds,
  moveAffectedBookings,
  parseServiceRemovalConfirmation,
  type ServiceRemovalAffectedBooking,
} from '@/lib/venue/service-removal-bookings';

function booking(overrides: Partial<ServiceRemovalAffectedBooking> = {}): ServiceRemovalAffectedBooking {
  return {
    id: 'b1',
    service_id: 'svc-1',
    service_name: 'Gents Cut',
    calendar_id: 'cal-1',
    calendar_name: 'Andrew',
    booking_date: '2026-10-14',
    booking_time: '10:00',
    end_time: '10:45',
    guest_name: 'Alex Smith',
    party_size: 1,
    status: 'Booked',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseServiceRemovalConfirmation', () => {
  it('reads the 409 body the service-link routes send', () => {
    const parsed = parseServiceRemovalConfirmation({
      requires_confirmation: true,
      message: '2 upcoming bookings are already booked for Gents Cut on Andrew.',
      affected_bookings: [booking(), booking({ id: 'b2' })],
      affected_total: 2,
      affected_truncated: false,
    });
    expect(parsed?.total).toBe(2);
    expect(parsed?.bookings).toHaveLength(2);
    expect(parsed?.truncated).toBe(false);
  });

  it('falls back to the list length when the total is missing', () => {
    const parsed = parseServiceRemovalConfirmation({
      requires_confirmation: true,
      affected_bookings: [booking()],
    });
    expect(parsed?.total).toBe(1);
    expect(parsed?.message).toContain('already booked');
  });

  it('returns null for an ordinary error body, so it surfaces as an error', () => {
    expect(parseServiceRemovalConfirmation({ error: 'Calendar not found' })).toBeNull();
    expect(parseServiceRemovalConfirmation({ requires_confirmation: true })).toBeNull();
    expect(parseServiceRemovalConfirmation(null)).toBeNull();
  });
});

describe('affectedBookingLabel', () => {
  it('names the guest and when they are booked', () => {
    expect(affectedBookingLabel(booking())).toBe('Alex Smith, Wed 14 Oct, 10:00');
  });
});

describe('affectedCalendarIds / affectedServiceIds', () => {
  const confirmation = {
    message: 'x',
    total: 3,
    truncated: false,
    bookings: [
      booking(),
      booking({ id: 'b2' }),
      booking({ id: 'b3', calendar_id: 'cal-2', service_id: 'svc-2' }),
    ],
  };

  it('lists each calendar and service once, so cancelling can put the ticks back', () => {
    expect(affectedCalendarIds(confirmation)).toEqual(['cal-1', 'cal-2']);
    expect(affectedServiceIds(confirmation)).toEqual(['svc-1', 'svc-2']);
  });

  it('has nothing to restore when there is no confirmation open', () => {
    expect(affectedCalendarIds(null)).toEqual([]);
    expect(affectedServiceIds(null)).toEqual([]);
  });
});

describe('moveAffectedBookings', () => {
  it('keeps the booking where it is in time and only changes the column', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true, json: async () => ({}) };
    });

    const rows = [booking()];
    const result = await moveAffectedBookings([{ bookingId: 'b1', targetCalendarId: 'cal-2' }], rows);

    expect(result.failures).toEqual([]);
    expect([...result.movedIds]).toEqual(['b1']);
    expect(calls[0].url).toBe('/api/venue/bookings/b1');
    expect(calls[0].body).toMatchObject({
      practitioner_id: 'cal-2',
      booking_date: '2026-10-14',
      booking_time: '10:00',
      booking_end_time: '10:45',
      allow_outside_hours: true,
      allow_during_breaks: true,
    });
    // A clash on the target calendar must still be reported, never forced through.
    expect(calls[0].body).not.toHaveProperty('allow_manual_overlap');
  });

  it('omits the end time only when the row has none, so a custom length survives', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, json: async () => ({}) };
    });

    await moveAffectedBookings(
      [{ bookingId: 'b1', targetCalendarId: 'cal-2' }],
      [booking({ end_time: null })],
    );
    expect(bodies[0]).not.toHaveProperty('booking_end_time');
  });

  it('reports the ones that failed and still moves the rest', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/b2')
        ? { ok: false, json: async () => ({ error: 'That time is already booked on Sam.' }) }
        : { ok: true, json: async () => ({}) },
    );

    const rows = [booking(), booking({ id: 'b2', guest_name: 'Jo Blue' })];
    const result = await moveAffectedBookings(
      rows.map((b) => ({ bookingId: b.id, targetCalendarId: 'cal-2' })),
      rows,
    );

    expect([...result.movedIds]).toEqual(['b1']);
    expect(result.failures).toEqual([
      {
        bookingId: 'b2',
        label: 'Jo Blue, Wed 14 Oct, 10:00',
        reason: 'That time is already booked on Sam.',
      },
    ]);
  });
});
