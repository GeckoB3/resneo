import { cardHoldChargeWindowEndsAt } from '@/lib/booking/card-hold-terms';

/**
 * Charge-window derivation for card holds (docs:
 * CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §9.1, §12.3).
 *
 * `charge_window_ends_at` is never stored: it is derived as the booking's end
 * plus CARD_HOLD_CHARGE_WINDOW_DAYS. The booking's end follows the same
 * precedence the staff surfaces use (`bookingDisplayEndHm`): the wall-clock
 * `booking_end_time` on the booking's date (rolling to the next day for
 * overnight bookings), then the absolute `estimated_end_time`, then the start
 * itself when no end resolves. Wall-clock date/time is treated as UTC, matching
 * the existing `cancellation_deadline` convention; any timezone offset is noise
 * against a 14-day window. The `release-card-holds` cron reuses this module for
 * its expiry sweep.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The booking-row fields the derivation reads (all on `bookings`). */
export interface CardHoldWindowBookingFields {
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
}

function wallClockUtcMs(bookingDate: string, hm: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof bookingDate === 'string' ? bookingDate : '');
  const timeMatch = /^(\d{1,2}):(\d{2})/.exec(typeof hm === 'string' ? hm.trim() : '');
  if (!dateMatch || !timeMatch) return null;
  const ms = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The booking's end as an ISO timestamp, falling back to the start when no end
 * field resolves. Returns null only when the start itself cannot be parsed.
 */
export function resolveCardHoldBookingEndIso(booking: CardHoldWindowBookingFields): string | null {
  const startMs = wallClockUtcMs(booking.booking_date, booking.booking_time);
  if (startMs === null) return null;

  const endMs = wallClockUtcMs(booking.booking_date, booking.booking_end_time ?? '');
  if (endMs !== null) {
    // An end before the start is an overnight booking: roll to the next day.
    return new Date(endMs < startMs ? endMs + DAY_MS : endMs).toISOString();
  }

  if (booking.estimated_end_time) {
    const estimatedMs = new Date(booking.estimated_end_time).getTime();
    if (Number.isFinite(estimatedMs)) return new Date(estimatedMs).toISOString();
  }

  return new Date(startMs).toISOString();
}

/**
 * §9.1 `charge_window_ends_at`: booking end + CARD_HOLD_CHARGE_WINDOW_DAYS as
 * an ISO timestamp, or null when the booking's schedule cannot be parsed.
 */
export function cardHoldChargeWindowEndsAtForBooking(
  booking: CardHoldWindowBookingFields,
): string | null {
  const endIso = resolveCardHoldBookingEndIso(booking);
  return endIso ? cardHoldChargeWindowEndsAt(endIso) : null;
}
