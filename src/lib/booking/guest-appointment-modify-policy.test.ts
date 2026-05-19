import { describe, expect, it } from 'vitest';
import { guestAppointmentModifyBlockedReason } from '@/lib/booking/guest-appointment-modify-policy';

describe('guestAppointmentModifyBlockedReason', () => {
  it('allows modify when outside notice window', () => {
    const reason = guestAppointmentModifyBlockedReason({
      bookingDate: '2030-06-01',
      bookingTime: '14:00',
      venueTimezone: 'Europe/London',
      modifyNoticeHours: 48,
      now: new Date('2030-05-01T12:00:00Z'),
    });
    expect(reason).toBeNull();
  });

  it('blocks modify inside notice window', () => {
    const reason = guestAppointmentModifyBlockedReason({
      bookingDate: '2030-06-01',
      bookingTime: '14:00',
      venueTimezone: 'Europe/London',
      modifyNoticeHours: 48,
      now: new Date('2030-05-31T14:00:00Z'),
    });
    expect(reason).toMatch(/not available/i);
  });
});
