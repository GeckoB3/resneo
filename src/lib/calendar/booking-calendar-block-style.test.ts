import { describe, expect, it } from 'vitest';
import {
  bookingCalendarBlockCardStyle,
  bookingCalendarBlockPalette,
  bookingCalendarBlockPaletteWithOverlay,
  calendarBookingVisualKey,
  CalendarBookingStatusStripe,
  isArrivedWaitingDisplay,
} from './booking-calendar-block-style';

describe('bookingCalendarBlockPalette', () => {
  it('maps lifecycle statuses to distinct stripe colours', () => {
    expect(bookingCalendarBlockPalette({ status: 'Booked' }).accent).toBe('#0369A1');
    expect(bookingCalendarBlockPalette({ status: 'Confirmed' }).accent).toBe('#003B6F');
    expect(bookingCalendarBlockPalette({ status: 'Confirmed' }).bg).toBe('#C6D8E9');
    expect(bookingCalendarBlockPalette({ status: 'Booked' }).bg).not.toBe(
      bookingCalendarBlockPalette({ status: 'Confirmed' }).bg,
    );
    expect(bookingCalendarBlockPalette({ status: 'Seated' }).accent).toBe('#047857');
    expect(bookingCalendarBlockPalette({ status: 'Completed' }).accent).toBe('#4B5563');
    expect(bookingCalendarBlockPalette({ status: 'No-Show' }).accent).toBe('#DC2626');
  });

  it('uses Arrived stripe when client_arrived_at is set before start', () => {
    expect(
      isArrivedWaitingDisplay({
        status: 'Confirmed',
        client_arrived_at: '2026-06-01T18:00:00.000Z',
      }),
    ).toBe(true);
    expect(calendarBookingVisualKey({
      status: 'Confirmed',
      client_arrived_at: '2026-06-01T18:00:00.000Z',
    })).toBe('Arrived');
    expect(
      bookingCalendarBlockPalette({
        status: 'Confirmed',
        client_arrived_at: '2026-06-01T18:00:00.000Z',
      }).accent,
    ).toBe('#D97706');
  });

  it('applies optimistic client_arrived overlay before refetch', () => {
    expect(
      bookingCalendarBlockPaletteWithOverlay(
        { status: 'Confirmed', client_arrived_at: null },
        { client_arrived_at: '2026-06-01T18:00:00.000Z' },
      ).accent,
    ).toBe('#D97706');
  });

  it('status stripe element carries the accent colour', () => {
    const p = bookingCalendarBlockPalette({
      status: 'Confirmed',
      client_arrived_at: '2026-06-01T18:00:00.000Z',
    });
    // The accent now lives on a dedicated stripe column (not the card box-shadow)
    // so drag handles/content can't cover it; the card keeps a neutral glassy shell.
    const stripe = CalendarBookingStatusStripe({ palette: p });
    // React 19 types `ReactElement.props` as `unknown`; narrow to read the inline style.
    const stripeProps = stripe.props as { style: { backgroundColor?: string } };
    expect(stripeProps.style.backgroundColor).toBe('#D97706');
    expect(bookingCalendarBlockCardStyle(p).backgroundColor).toBe(p.bg);
  });

  it('gives linked cards a non-colour distinction (dashed border + hatch) while keeping the status hue', () => {
    const p = bookingCalendarBlockPalette({ status: 'Confirmed' });
    const own = bookingCalendarBlockCardStyle(p);
    const linked = bookingCalendarBlockCardStyle(p, { linked: true });
    expect(own.borderStyle).toBe('solid');
    expect(linked.borderStyle).toBe('dashed');
    // Status hue still backs the card (legibility / fallback) in both variants.
    expect(linked.backgroundColor).toBe(p.bg);
    // The linked surface adds a diagonal hatch the own-venue surface doesn't have.
    expect(String(linked.backgroundImage)).toContain('repeating-linear-gradient');
    expect(String(own.backgroundImage)).not.toContain('repeating-linear-gradient');
  });

  it('treats attendance-confirmed Booked as Confirmed stripe', () => {
    expect(
      calendarBookingVisualKey({
        status: 'Booked',
        staff_attendance_confirmed_at: '2026-06-01T12:00:00.000Z',
      }),
    ).toBe('Confirmed');
  });
});
