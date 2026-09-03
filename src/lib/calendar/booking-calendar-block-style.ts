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

/**
 * Ring drawn for the post-action flash.
 *
 * It has to be part of THIS inline `boxShadow`, not a Tailwind `ring-*` class.
 * `ring` is itself a box-shadow utility, and an inline style always beats a
 * class, so the flash ring on the calendar bars never painted at all: the bar
 * just faded to half opacity and back, which reads as flickering rather than
 * "look here". Inset so an `overflow-hidden` ancestor cannot clip it.
 */
const BOOKING_BLOCK_FLASH_RING = 'inset 0 0 0 2px rgba(56,189,248,0.90)';

export function bookingCalendarBlockCardStyle(
  p: BookingBlockPalette,
  opts: { flash?: boolean } = {},
): CSSProperties {
  // One look for every bar, linked or own. Linked cards used to carry a dashed
  // border, a diagonal hatch and a white veil so they read as foreign at a
  // glance; the column header already says "Linked · {venue}", and the hatch
  // read as a fault rather than a label ("why are these bars shaded?"), so the
  // distinction now lives in the header alone.
  return {
    color: p.text,
    // Bold saturated fill is the hero. A restrained top-light → base-shade sheen
    // gives the lozenge a crafted, dimensional gloss *without* washing out the
    // colour, and a soft brand-tinted drop shadow lifts it off the pale grid so
    // each bar reads boldly. `backgroundColor` stays as a robust fallback.
    backgroundColor: p.bg,
    backgroundImage:
      'linear-gradient(176deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0) 55%, rgba(0,0,0,0.12) 100%)',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: p.border,
    boxShadow: [
      ...(opts.flash ? [BOOKING_BLOCK_FLASH_RING] : []),
      'inset 0 1px 0 rgba(255,255,255,0.30)', // glossy top edge
      'inset 0 -1px 0 rgba(0,0,0,0.12)', // grounded base edge
      // A pale hairline outside the border. Two bars of the same status that
      // touch, or one drawn inside another's processing gap, share a hue and
      // a border colour, so their edges melted together; the light ring keeps
      // every bar's outline readable against its neighbours.
      '0 0 0 1px rgba(255,255,255,0.85)',
      '0 1px 2px rgba(15,23,42,0.18)', // contact shadow, a touch firmer
      '0 16px 30px -14px rgba(2,32,71,0.42)', // soft brand-tinted lift
    ].join(', '),
  };
}

/**
 * Left highlight for calendar booking bars. Now that the bar's saturated fill carries the
 * status hue, this column is a purely decorative *glass* edge: a luminous top-light → soft-fade
 * gloss that catches light along the leading edge, giving each lozenge a crafted, dimensional
 * finish. Rendered as the first column so drag handles and inner content can't cover it. The
 * `palette` argument is retained for API stability (and future per-status tuning).
 */
export function CalendarBookingStatusStripe(
  _props: { palette: BookingBlockPalette },
): ReactElement {
  return createElement('div', {
    className: 'pointer-events-none z-[3] shrink-0 self-stretch rounded-l-[15px]',
    style: {
      width: 4,
      minWidth: 4,
      backgroundColor: 'rgba(255,255,255,0.22)',
      backgroundImage:
        'linear-gradient(180deg, rgba(255,255,255,0.70) 0%, rgba(255,255,255,0.30) 45%, rgba(255,255,255,0.08) 100%)',
      boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.30), 1px 0 0 rgba(0,0,0,0.06)',
    },
    'aria-hidden': true,
  });
}
