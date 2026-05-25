import type { BookingModifiedSnapshot } from '@/lib/booking/log-booking-modified-event';

function formatBookingDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export interface BookingTimelineEventRow {
  id: string;
  event_type: string;
  created_at: string;
  payload?: Record<string, unknown> | null;
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function timeHm(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const hm = value.trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(hm) ? hm : null;
}

function describeScheduleChange(
  before: BookingModifiedSnapshot,
  after: BookingModifiedSnapshot,
): string[] {
  const parts: string[] = [];
  if (
    before.booking_date &&
    after.booking_date &&
    before.booking_date !== after.booking_date
  ) {
    parts.push(
      `Date ${formatBookingDate(before.booking_date)} → ${formatBookingDate(after.booking_date)}`,
    );
  }
  const beforeTime = timeHm(before.booking_time);
  const afterTime = timeHm(after.booking_time);
  if (beforeTime && afterTime && beforeTime !== afterTime) {
    parts.push(`Time ${beforeTime} → ${afterTime}`);
  }
  const beforeEnd = timeHm(before.booking_end_time);
  const afterEnd = timeHm(after.booking_end_time);
  if (beforeEnd && afterEnd && beforeEnd !== afterEnd) {
    parts.push(`End ${beforeEnd} → ${afterEnd}`);
  } else if (!beforeEnd && afterEnd) {
    parts.push(`End set to ${afterEnd}`);
  } else if (beforeEnd && !afterEnd) {
    parts.push(`End removed (was ${beforeEnd})`);
  }
  if (
    typeof before.party_size === 'number' &&
    typeof after.party_size === 'number' &&
    before.party_size !== after.party_size
  ) {
    parts.push(`Party size ${before.party_size} → ${after.party_size}`);
  }
  return parts;
}

/** Whether this event should appear in the expanded booking timeline UI. */
export function shouldShowBookingTimelineEvent(event: BookingTimelineEventRow): boolean {
  const payload = payloadRecord(event.payload);
  switch (event.event_type) {
    case 'booking_status_changed':
      return payload?.new_status === 'Confirmed';
    case 'booking_created':
    case 'booking_modified':
    case 'auto_cancelled':
    case 'waitlist_converted':
      return true;
    default:
      return false;
  }
}

export function formatBookingTimelineEvent(event: BookingTimelineEventRow): {
  title: string;
  detail?: string;
} {
  const payload = payloadRecord(event.payload);

  switch (event.event_type) {
    case 'booking_created':
      return { title: 'Booking created' };

    case 'booking_status_changed': {
      const confirmedBy = payload?.confirmed_by;
      if (confirmedBy === 'guest') {
        return { title: 'Confirmed by guest' };
      }
      if (confirmedBy === 'staff') {
        return { title: 'Confirmed by staff' };
      }
      if (confirmedBy === 'both') {
        return { title: 'Confirmed by guest and staff' };
      }
      const oldStatus =
        typeof payload?.old_status === 'string' ? payload.old_status : null;
      const detail =
        oldStatus && oldStatus !== 'Confirmed'
          ? `From ${oldStatus.replace(/_/g, ' ')}`
          : undefined;
      return { title: 'Booking confirmed', detail };
    }

    case 'booking_modified': {
      const actor =
        payload?.modification_actor === 'guest'
          ? 'Guest'
          : payload?.modification_actor === 'staff'
            ? 'Staff'
            : 'User';
      const before = (payload?.before ?? {}) as BookingModifiedSnapshot;
      const after = (payload?.after ?? {}) as BookingModifiedSnapshot;
      const changes = describeScheduleChange(before, after);
      return {
        title: `Booking modified (${actor})`,
        detail: changes.length > 0 ? changes.join(' · ') : 'Booking details updated',
      };
    }

    case 'auto_cancelled':
      return { title: 'Booking auto-cancelled' };

    case 'waitlist_converted':
      return { title: 'Converted from waitlist' };

    default:
      return {
        title: event.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      };
  }
}

export function bookingTimelineEventsForDisplay(
  events: BookingTimelineEventRow[],
): Array<BookingTimelineEventRow & { title: string; detail?: string }> {
  return events
    .filter(shouldShowBookingTimelineEvent)
    .map((event) => {
      const { title, detail } = formatBookingTimelineEvent(event);
      return { ...event, title, detail };
    });
}
