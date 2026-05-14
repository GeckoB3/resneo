import { describe, expect, it } from 'vitest';
import {
  MAX_APPOINTMENT_CORE_DURATION_MINUTES,
  minutesBetweenStartAndEndHM,
  resolveAppointmentModifyEndCoreHHmm,
} from '@/lib/booking/validate-appointment-modification';

describe('resolveAppointmentModifyEndCoreHHmm', () => {
  it('prefers duration_minutes over booking_end_time', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '10:00',
      durationMinutes: 45,
      bookingEndTime: '11:00',
      defaultDurationMinutes: 30,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endCoreHHmm).toBe('10:45');
  });

  it('uses booking_end_time when duration omitted', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '09:15',
      durationMinutes: undefined,
      bookingEndTime: '10:30:00',
      defaultDurationMinutes: 20,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endCoreHHmm).toBe('10:30');
  });

  it('rejects duration under 15 minutes', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '10:00',
      durationMinutes: 10,
      bookingEndTime: null,
      defaultDurationMinutes: 30,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects duration above max', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '10:00',
      durationMinutes: MAX_APPOINTMENT_CORE_DURATION_MINUTES + 1,
      bookingEndTime: null,
      defaultDurationMinutes: 30,
    });
    expect(r.ok).toBe(false);
  });
});

describe('minutesBetweenStartAndEndHM', () => {
  it('counts across midnight', () => {
    expect(minutesBetweenStartAndEndHM('23:30', '00:45')).toBe(75);
  });
});
