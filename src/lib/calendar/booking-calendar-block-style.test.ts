import { describe, expect, it } from 'vitest';
import {
  bookingCalendarBlockCardStyle,
  bookingCalendarBlockPalette,
  bookingCalendarBlockPaletteWithOverlay,
  calendarBookingVisualKey,
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

  it('card shell style includes inset left accent matching stripe', () => {
    const p = bookingCalendarBlockPalette({
      status: 'Confirmed',
      client_arrived_at: '2026-06-01T18:00:00.000Z',
    });
    expect(bookingCalendarBlockCardStyle(p).boxShadow).toContain('#D97706');
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
