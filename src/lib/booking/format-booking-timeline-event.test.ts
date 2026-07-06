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

describe('card-hold timeline events (§11)', () => {
  it('shows all five card-hold event types', () => {
    for (const type of [
      'card_hold_saved',
      'card_hold_released',
      'card_hold_charged',
      'card_hold_charge_failed',
      'card_hold_charge_refunded',
    ]) {
      expect(
        shouldShowBookingTimelineEvent({
          id: type,
          event_type: type,
          created_at: '2026-07-05T12:00:00Z',
          payload: null,
        }),
      ).toBe(true);
    }
  });

  it('formats card-hold events with amounts and reasons', () => {
    expect(
      formatBookingTimelineEvent({
        id: '1',
        event_type: 'card_hold_saved',
        created_at: '2026-07-05T12:00:00Z',
        payload: { fee_pence: 2500 },
      }),
    ).toEqual({ title: 'Card saved for no-show fee', detail: 'No-show fee up to £25.00' });

    expect(
      formatBookingTimelineEvent({
        id: '2',
        event_type: 'card_hold_charged',
        created_at: '2026-07-05T12:00:00Z',
        payload: { charged_pence: 1000 },
      }),
    ).toEqual({ title: 'No-show fee charged', detail: '£10.00 charged to the saved card' });

    expect(
      formatBookingTimelineEvent({
        id: '3',
        event_type: 'card_hold_charge_refunded',
        created_at: '2026-07-05T12:00:00Z',
        payload: { charged_pence: 1000 },
      }),
    ).toEqual({ title: 'No-show fee refunded', detail: '£10.00 refunded' });

    expect(
      formatBookingTimelineEvent({
        id: '4',
        event_type: 'card_hold_released',
        created_at: '2026-07-05T12:00:00Z',
        payload: { release_reason: 'expired' },
      }),
    ).toEqual({ title: 'Card hold ended', detail: 'Reason: charge window passed' });

    expect(
      formatBookingTimelineEvent({
        id: '5',
        event_type: 'card_hold_charge_failed',
        created_at: '2026-07-05T12:00:00Z',
        payload: { failure_code: 'card_declined' },
      }),
    ).toEqual({ title: 'No-show fee charge failed', detail: 'Reason: card declined' });
  });

  it('degrades gracefully with no payload', () => {
    expect(
      formatBookingTimelineEvent({
        id: '6',
        event_type: 'card_hold_charged',
        created_at: '2026-07-05T12:00:00Z',
        payload: null,
      }),
    ).toEqual({ title: 'No-show fee charged' });
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
