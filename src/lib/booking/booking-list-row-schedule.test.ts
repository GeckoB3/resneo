import { describe, expect, it } from 'vitest';
import {
  bookingListRowDurationBarLabel,
  bookingListRowDurationDetailLabel,
  bookingListRowDurationMinutes,
  bookingListRowTimeRangeLabel,
  multiServiceVisitWallClockSchedule,
  resolveBookingListBarSchedule,
} from '@/lib/booking/booking-list-row-schedule';

describe('bookingListRowSchedule', () => {
  it('uses booking_end_time for wall-clock duration including extras', () => {
    const row = {
      booking_time: '10:00',
      booking_end_time: '10:45',
      addons_total_duration_minutes: 15,
    };
    expect(bookingListRowDurationMinutes(row)).toBe(45);
    expect(bookingListRowTimeRangeLabel(row)).toBe('10:00–10:45');
    expect(bookingListRowDurationBarLabel(row)).toBe('45 min');
    expect(bookingListRowDurationDetailLabel(row)).toBe('45 min (30 min service + 15 min extras)');
  });

  it('falls back to catalogue default plus add-on minutes', () => {
    expect(
      bookingListRowDurationMinutes(
        { booking_time: '10:00', addons_total_duration_minutes: 10 },
        30,
      ),
    ).toBe(40);
  });

  it('uses first start and last end for multi-service visits', () => {
    const segments = [
      {
        booking_time: '10:00',
        booking_end_time: '10:30',
        addons_total_duration_minutes: 5,
        group_booking_id: 'g1',
      },
      {
        booking_time: '10:30',
        booking_end_time: '11:15',
        addons_total_duration_minutes: 10,
        group_booking_id: 'g1',
      },
    ];
    expect(multiServiceVisitWallClockSchedule(segments)).toEqual({
      timeRangeLabel: '10:00–11:15',
      durationMinutes: 75,
      addonsTotalMinutes: 15,
    });

    const bar = resolveBookingListBarSchedule(segments[0]!, segments);
    expect(bar.timeRangeLabel).toBe('10:00–11:15');
    expect(bar.durationBarLabel).toBe('1 hr 15 min');
    expect(bar.durationDetailLabel).toBe('1 hr 15 min (1 hr service + 15 min extras)');
  });
});
