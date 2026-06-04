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

export function bookingCalendarBlockCardStyle(
  p: BookingBlockPalette,
  opts: { linked?: boolean } = {},
): CSSProperties {
  if (opts.linked) {
    // Linked (other-venue) cards must be instantly distinct from own-venue cards
    // *without relying on colour alone* (§19.1, WCAG 1.4.1): a dashed border, a
    // subtle diagonal hatch, and a desaturating slate veil read clearly even in
    // greyscale, while the status hue still shows through underneath.
    return {
      color: p.text,
      backgroundColor: p.bg,
      backgroundImage: [
        'repeating-linear-gradient(45deg, rgba(15,23,42,0.06) 0, rgba(15,23,42,0.06) 1px, rgba(255,255,255,0) 1px, rgba(255,255,255,0) 6px)',
        'linear-gradient(177deg, rgba(248,250,252,0.72) 0%, rgba(248,250,252,0.46) 42%, rgba(248,250,252,0.34) 100%)',
        `linear-gradient(0deg, ${p.bg}, ${p.bg})`,
      ].join(', '),
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: p.border,
      boxShadow: [
        'inset 0 1px 0 rgba(255,255,255,0.7)',
        '0 1px 2px rgba(15,23,42,0.05)',
        '0 10px 22px -14px rgba(2,32,71,0.20)',
      ].join(', '),
    };
  }
  return {
    color: p.text,
    // Frosted-glass surface: a white sheen over the status hue, easing to a faint
    // shadow at the base for depth. `backgroundColor` stays as a robust fallback.
    backgroundColor: p.bg,
    backgroundImage:
      'linear-gradient(177deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.14) 32%, rgba(255,255,255,0) 58%, rgba(15,23,42,0.04) 100%)',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: p.border,
    boxShadow: [
      'inset 0 1px 0 rgba(255,255,255,0.85)', // crisp top edge
      'inset 0 -1px 0 rgba(15,23,42,0.05)', // grounded bottom edge
      '0 1px 2px rgba(15,23,42,0.06)', // tight contact shadow
      '0 14px 28px -12px rgba(2,32,71,0.26)', // soft brand-tinted lift
    ].join(', '),
  };
}

/**
 * Status stripe for calendar booking bars. Rendered as the first column so drag handles
 * and inner content cannot cover a CSS border-left on the card shell. A glossy gradient
 * (top-light → base-shade) gives it a polished, dimensional accent rather than a flat bar.
 */
export function CalendarBookingStatusStripe({ palette }: { palette: BookingBlockPalette }): ReactElement {
  return createElement('div', {
    className: 'pointer-events-none z-[3] shrink-0 self-stretch rounded-l-[15px]',
    style: {
      width: 5,
      minWidth: 5,
      backgroundColor: palette.accent,
      backgroundImage:
        'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.12) 42%, rgba(0,0,0,0.18) 100%)',
      boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.35), 1px 0 4px rgba(2,32,71,0.10)',
    },
    'aria-hidden': true,
  });
}
