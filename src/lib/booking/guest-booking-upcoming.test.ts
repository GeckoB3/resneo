import { describe, expect, it } from 'vitest';
import { staffRebookInitialDate } from '@/lib/booking/guest-booking-upcoming';

const TZ = 'Europe/London';

describe('staffRebookInitialDate', () => {
  it('uses booking date when visit is still upcoming', () => {
    const now = new Date('2026-06-10T10:00:00.000Z');
    const row = {
      booking_date: '2026-06-15',
      booking_time: '14:00:00',
      estimated_end_time: '2026-06-15T15:00:00.000Z',
    };
    expect(staffRebookInitialDate(row, TZ, now)).toBe('2026-06-15');
  });

  it('uses venue today when visit has ended', () => {
    const now = new Date('2026-06-20T12:00:00.000Z');
    const row = {
      booking_date: '2026-06-15',
      booking_time: '14:00:00',
      estimated_end_time: '2026-06-15T15:00:00.000Z',
    };
    expect(staffRebookInitialDate(row, TZ, now)).toBe('2026-06-20');
  });
});
