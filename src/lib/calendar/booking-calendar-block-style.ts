import { createElement, type CSSProperties, type ReactElement } from 'react';
import type { BookingStaffIndicatorInput } from '@/lib/booking/booking-staff-indicators';
import {
  bookingDisplayVisualKey,
  bookingStatusVisualForKey,
  isArrivedWaitingDisplay,
} from '@/lib/table-management/booking-status-visual';

export { isArrivedWaitingDisplay };

/** Inline-style palette for staff calendar booking bars (`accent` = left stripe). */
export interface BookingBlockPalette {
  bg: string;
  text: string;
  border: string;
  accent: string;
}

export type BookingCalendarBlockInput = BookingStaffIndicatorInput & {
  status: string;
  client_arrived_at?: string | null;
};

/**
 * Visual status key for calendar stripes — aligns with {@link bookingStatusVisualForKey}
 * (Booked, Confirmed, Arrived, Seated/Started, Completed, No-Show, Cancelled).
 */
export function calendarBookingVisualKey(b: BookingCalendarBlockInput): string {
  return bookingDisplayVisualKey(calendarBookingStripeInput(b));
}

/** Normalise row fields used for calendar bar stripes (status + arrived + attendance). */
export function calendarBookingStripeInput(
  b: BookingCalendarBlockInput,
): BookingCalendarBlockInput {
  return {
    status: b.status,
    client_arrived_at: b.client_arrived_at ?? null,
    staff_attendance_confirmed_at: b.staff_attendance_confirmed_at ?? null,
    guest_attendance_confirmed_at: b.guest_attendance_confirmed_at ?? null,
  };
}

export function bookingCalendarBlockPalette(b: BookingCalendarBlockInput): BookingBlockPalette {
  const visual = bookingStatusVisualForKey(calendarBookingVisualKey(calendarBookingStripeInput(b)));
  return visual.calendarBlock;
}

/** Merge list/calendar overlay fields then resolve stripe colours (same path as status pills). */
export function bookingCalendarBlockPaletteWithOverlay(
  b: BookingCalendarBlockInput,
  overlay: Partial<BookingCalendarBlockInput> = {},
): BookingBlockPalette {
  if (Object.keys(overlay).length === 0) return bookingCalendarBlockPalette(b);
  return bookingCalendarBlockPalette({ ...b, ...overlay });
}

/** Stripe + card palette for a calendar grid row after applying optimistic overlay. */
export function bookingCalendarBlockPaletteForDisplayRow(
  row: BookingCalendarBlockInput,
  overlay: Partial<BookingCalendarBlockInput> = {},
): BookingBlockPalette {
  return bookingCalendarBlockPaletteWithOverlay(row, overlay);
}

export function bookingCalendarBlockCardStyle(p: BookingBlockPalette): CSSProperties {
  return {
    backgroundColor: p.bg,
    color: p.text,
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: p.border,
    boxShadow: `inset 4px 0 0 ${p.accent}, 0 10px 26px rgba(15, 23, 42, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.42)`,
  };
}

/**
 * Status stripe for calendar booking bars. Rendered as the first column so drag handles
 * and inner content cannot cover a CSS border-left on the card shell.
 */
export function CalendarBookingStatusStripe({ palette }: { palette: BookingBlockPalette }): ReactElement {
  return createElement('div', {
    className: 'pointer-events-none z-[3] shrink-0 self-stretch rounded-l-[15px]',
    style: { width: 4, minWidth: 4, backgroundColor: palette.accent },
    'aria-hidden': true,
  });
}
