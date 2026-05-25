import { describe, expect, it } from 'vitest';
import {
  bookingTimelineEventsForDisplay,
  formatBookingTimelineEvent,
  shouldShowBookingTimelineEvent,
} from '@/lib/booking/format-booking-timeline-event';

describe('shouldShowBookingTimelineEvent', () => {
  it('shows only Confirmed status changes', () => {
    expect(
      shouldShowBookingTimelineEvent({
        id: '1',
        event_type: 'booking_status_changed',
        created_at: '2026-01-01T12:00:00Z',
        payload: { old_status: 'Pending', new_status: 'Booked' },
      }),
    ).toBe(false);
    expect(
      shouldShowBookingTimelineEvent({
        id: '2',
        event_type: 'booking_status_changed',
        created_at: '2026-01-01T12:00:00Z',
        payload: { old_status: 'Booked', new_status: 'Confirmed' },
      }),
    ).toBe(true);
  });
});

describe('formatBookingTimelineEvent', () => {
  it('labels Confirmed by guest vs staff', () => {
    expect(
      formatBookingTimelineEvent({
        id: '1',
        event_type: 'booking_status_changed',
        created_at: '2026-01-01T12:00:00Z',
        payload: { new_status: 'Confirmed', confirmed_by: 'guest' },
      }).title,
    ).toBe('Confirmed by guest');
    expect(
      formatBookingTimelineEvent({
        id: '2',
        event_type: 'booking_status_changed',
        created_at: '2026-01-01T12:00:00Z',
        payload: { new_status: 'Confirmed', confirmed_by: 'staff' },
      }).title,
    ).toBe('Confirmed by staff');
  });

  it('describes booking_modified field changes', () => {
    const formatted = formatBookingTimelineEvent({
      id: '3',
      event_type: 'booking_modified',
      created_at: '2026-01-01T12:00:00Z',
      payload: {
        modification_actor: 'staff',
        before: { booking_date: '2026-06-01', booking_time: '18:00:00', party_size: 2 },
        after: { booking_date: '2026-06-02', booking_time: '19:30:00', party_size: 4 },
      },
    });
    expect(formatted.title).toBe('Booking modified (Staff)');
    expect(formatted.detail).toContain('Date');
    expect(formatted.detail).toContain('Time 18:00 → 19:30');
    expect(formatted.detail).toContain('Party size 2 → 4');
  });
});

describe('bookingTimelineEventsForDisplay', () => {
  it('filters and formats in order', () => {
    const rows = bookingTimelineEventsForDisplay([
      {
        id: 'a',
        event_type: 'booking_status_changed',
        created_at: '2026-01-02T12:00:00Z',
        payload: { new_status: 'Booked' },
      },
      {
        id: 'b',
        event_type: 'booking_modified',
        created_at: '2026-01-03T12:00:00Z',
        payload: {
          modification_actor: 'guest',
          before: { booking_time: '12:00:00' },
          after: { booking_time: '13:00:00' },
        },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Booking modified (Guest)');
  });
});
