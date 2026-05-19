import { describe, expect, it } from 'vitest';
import { isScheduleModificationPayload } from '@/lib/booking/log-booking-modified-event';

describe('isScheduleModificationPayload', () => {
  it('returns true when booking date changes', () => {
    expect(
      isScheduleModificationPayload({
        before: { booking_date: '2026-05-01', booking_time: '10:00' },
        after: { booking_date: '2026-05-02', booking_time: '10:00' },
      }),
    ).toBe(true);
  });

  it('returns true when booking time changes', () => {
    expect(
      isScheduleModificationPayload({
        before: { booking_date: '2026-05-01', booking_time: '10:00' },
        after: { booking_date: '2026-05-01', booking_time: '11:30' },
      }),
    ).toBe(true);
  });

  it('returns false when only party size changes', () => {
    expect(
      isScheduleModificationPayload({
        before: { booking_date: '2026-05-01', booking_time: '10:00', party_size: 2 },
        after: { booking_date: '2026-05-01', booking_time: '10:00', party_size: 4 },
      }),
    ).toBe(false);
  });
});
