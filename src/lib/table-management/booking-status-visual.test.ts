import { describe, expect, it } from 'vitest';
import {
  bookingStatusVisualForRow,
  bookingStatusVisualKeyForRow,
  bookingTransitionButtonSurface,
} from './booking-status-visual';

describe('booking status visual rows', () => {
  it('uses Arrived visual key while a waiting booking has arrived', () => {
    const row = {
      status: 'Confirmed',
      client_arrived_at: '2026-06-01T18:00:00.000Z',
    };

    expect(bookingStatusVisualKeyForRow(row)).toBe('Arrived');
    expect(bookingStatusVisualForRow(row).listBorderLeft).toBe('border-l-[#D97706]');
  });

  it('uses Confirmed visual key when attendance is confirmed on a Booked row', () => {
    expect(
      bookingStatusVisualKeyForRow({
        status: 'Booked',
        staff_attendance_confirmed_at: '2026-06-01T12:00:00.000Z',
      }),
    ).toBe('Confirmed');
    expect(
      bookingStatusVisualForRow({
        status: 'Booked',
        staff_attendance_confirmed_at: '2026-06-01T12:00:00.000Z',
      }).listBorderLeft,
    ).toBe('border-l-[#003B6F]');
  });

  it('keeps lifecycle visual keys once the booking has started or finished', () => {
    expect(
      bookingStatusVisualKeyForRow({
        status: 'Seated',
        client_arrived_at: '2026-06-01T18:00:00.000Z',
      }),
    ).toBe('Seated');
    expect(
      bookingStatusVisualKeyForRow({
        status: 'Completed',
        client_arrived_at: '2026-06-01T18:00:00.000Z',
      }),
    ).toBe('Completed');
  });
});

describe('bookingTransitionButtonSurface', () => {
  it('colours each action button to preview the status the bar becomes', () => {
    // Confirm a pending booking → Booked (sky)
    expect(bookingTransitionButtonSurface('Booked')).toContain('#0369A1');
    // Confirm attendance → Confirmed (brand navy)
    expect(bookingTransitionButtonSurface('Confirmed')).toContain('#003B6F');
    // Start → Seated (emerald)
    expect(bookingTransitionButtonSurface('Seated')).toContain('emerald-600');
    // Arrived → amber
    expect(bookingTransitionButtonSurface('Arrived')).toContain('#D97706');
  });

  it('makes the Complete button grey (matching the Completed bar)', () => {
    const surface = bookingTransitionButtonSurface('Completed');
    expect(surface).toContain('#4B5563');
    // Not emerald / navy / sky
    expect(surface).not.toContain('emerald');
    expect(surface).not.toContain('#003B6F');
    expect(surface).not.toContain('#0369A1');
  });
});
