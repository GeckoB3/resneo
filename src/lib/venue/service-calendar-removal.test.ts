import { describe, expect, it } from 'vitest';
import {
  buildServiceRemovalWarning,
  findBookingsAffectedByRemovingServicesUnified,
  serviceRemovalConfirmationPayload,
} from '@/lib/venue/service-calendar-removal';
import type { ServiceRemovalAffectedBooking } from '@/lib/venue/service-removal-bookings';

/**
 * A thenable query builder: every PostgREST method returns `this`, and awaiting it
 * yields whatever the table was seeded with. Filters are not simulated, so each test
 * seeds exactly the rows the real query would have matched.
 */
function db(tables: Record<string, { data: unknown[]; count?: number; error?: { message: string } }>) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [] };
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: result.error ? null : result.data,
            error: result.error ?? null,
            count: result.count ?? result.data.length,
          }).then(resolve),
      };
      for (const method of ['select', 'eq', 'gte', 'in', 'or', 'order', 'limit']) {
        builder[method] = () => builder;
      }
      return builder as never;
    },
  } as never;
}

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    booking_date: '2026-10-14',
    booking_time: '10:00:00',
    booking_end_time: '10:45:00',
    estimated_end_time: null,
    status: 'Confirmed',
    party_size: 1,
    calendar_id: 'cal-1',
    practitioner_id: null,
    service_item_id: 'svc-1',
    guest: { first_name: 'Alex', last_name: 'Smith' },
    ...overrides,
  };
}

const catalogue = {
  service_items: { data: [{ id: 'svc-1', name: 'Gents Cut' }] },
  unified_calendars: { data: [{ id: 'cal-1', name: 'Andrew' }] },
};

describe('findBookingsAffectedByRemovingServicesUnified', () => {
  it('shapes each affected booking for the dashboard list', async () => {
    const impact = await findBookingsAffectedByRemovingServicesUnified(
      db({ bookings: { data: [bookingRow()] }, ...catalogue }),
      { venueId: 'v1', calendarIds: ['cal-1'], serviceItemIds: ['svc-1'] },
    );

    expect(impact.total).toBe(1);
    expect(impact.truncated).toBe(false);
    expect(impact.bookings[0]).toEqual({
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
      status: 'Confirmed',
    });
  });

  it('resolves the owning column the way the booking PATCH writes it', async () => {
    const impact = await findBookingsAffectedByRemovingServicesUnified(
      db({
        bookings: {
          data: [
            // A legacy-shaped row: `practitioner_id` is the column that counts.
            bookingRow({ id: 'b2', calendar_id: null, practitioner_id: 'cal-1' }),
            // Matched by the `.or()` on `practitioner_id`, but it lives on another column.
            bookingRow({ id: 'b3', calendar_id: 'cal-9', practitioner_id: 'cal-1' }),
          ],
        },
        ...catalogue,
      }),
      { venueId: 'v1', calendarIds: ['cal-1'], serviceItemIds: ['svc-1'] },
    );

    expect(impact.bookings.map((b) => b.id)).toEqual(['b2']);
  });

  it('falls back to the estimated end when there is no explicit one', async () => {
    const impact = await findBookingsAffectedByRemovingServicesUnified(
      db({
        bookings: {
          data: [bookingRow({ booking_end_time: null, estimated_end_time: '2026-10-14T11:30:00.000Z' })],
        },
        ...catalogue,
      }),
      { venueId: 'v1', calendarIds: ['cal-1'], serviceItemIds: ['svc-1'] },
    );
    expect(impact.bookings[0].end_time).toBe('11:30');
  });

  it('fails closed when the lookup errors', async () => {
    const impact = await findBookingsAffectedByRemovingServicesUnified(
      db({ bookings: { data: [], error: { message: 'boom' } }, ...catalogue }),
      { venueId: 'v1', calendarIds: ['cal-1'], serviceItemIds: ['svc-1'] },
    );
    expect(impact.error).toBe('Could not check existing bookings.');
  });

  it('does nothing when no service is being removed', async () => {
    const impact = await findBookingsAffectedByRemovingServicesUnified(
      db({ bookings: { data: [bookingRow()] }, ...catalogue }),
      { venueId: 'v1', calendarIds: ['cal-1'], serviceItemIds: [] },
    );
    expect(impact.total).toBe(0);
  });
});

function affected(overrides: Partial<ServiceRemovalAffectedBooking> = {}): ServiceRemovalAffectedBooking {
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

describe('buildServiceRemovalWarning', () => {
  it('says what stays behind, in the singular', () => {
    expect(
      buildServiceRemovalWarning({ bookings: [affected()], total: 1, truncated: false }),
    ).toBe(
      '1 upcoming booking is already booked for Gents Cut on Andrew. Removing the service keeps that booking exactly as it is and only stops new bookings.',
    );
  });

  it('names several services and drops the calendar when they differ', () => {
    const message = buildServiceRemovalWarning({
      bookings: [
        affected(),
        affected({ id: 'b2', service_id: 'svc-2', service_name: 'Beard Trim', calendar_id: 'cal-2', calendar_name: 'Sam' }),
      ],
      total: 2,
      truncated: false,
    });
    expect(message).toContain('2 upcoming bookings are already booked for Gents Cut and Beard Trim on these calendars');
    expect(message).toContain('keeps those bookings exactly as they are');
  });

  it('never uses an em-dash, which is banned in user-facing copy', () => {
    expect(buildServiceRemovalWarning({ bookings: [affected()], total: 1, truncated: false })).not.toContain('—');
  });
});

describe('serviceRemovalConfirmationPayload', () => {
  it('repeats the message under `error` for callers that only read that', () => {
    const payload = serviceRemovalConfirmationPayload({
      bookings: [affected()],
      total: 1,
      truncated: false,
    });
    expect(payload.requires_confirmation).toBe(true);
    expect(payload.error).toBe(payload.message);
    expect(payload.affected_total).toBe(1);
  });
});
