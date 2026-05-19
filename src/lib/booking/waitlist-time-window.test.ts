import { describe, expect, it } from 'vitest';
import {
  formatWaitlistTimeWindowLabel,
  parseWaitlistTimeWindow,
  slotStartMatchesWaitlistWindow,
  validateGuestWaitlistTimeInput,
  waitlistTimeMatchesFreedSlot,
} from '@/lib/booking/waitlist-time-window';

describe('waitlist-time-window', () => {
  it('parses all day', () => {
    expect(parseWaitlistTimeWindow({ desired_time: null, desired_time_end: null })).toEqual({
      kind: 'all_day',
    });
    expect(formatWaitlistTimeWindowLabel({ desired_time: null })).toBe('All day');
  });

  it('parses range', () => {
    expect(
      parseWaitlistTimeWindow({ desired_time: '10:00', desired_time_end: '14:00' }),
    ).toEqual({ kind: 'range', startHm: '10:00', endHm: '14:00' });
    expect(
      formatWaitlistTimeWindowLabel({ desired_time: '10:00', desired_time_end: '14:00' }),
    ).toBe('10:00 – 14:00');
  });

  it('matches slots in range', () => {
    const fields = { desired_time: '10:00', desired_time_end: '14:00' };
    expect(slotStartMatchesWaitlistWindow('10:00', fields)).toBe(true);
    expect(slotStartMatchesWaitlistWindow('13:30', fields)).toBe(true);
    expect(slotStartMatchesWaitlistWindow('14:00', fields)).toBe(false);
    expect(waitlistTimeMatchesFreedSlot(fields, '11:00')).toBe(true);
  });

  it('validates guest input', () => {
    expect(validateGuestWaitlistTimeInput({ preferred_window: 'all_day' })).toEqual({
      ok: true,
      desired_time: null,
      desired_time_end: null,
    });
    expect(
      validateGuestWaitlistTimeInput({
        preferred_window: 'time_range',
        desired_time: '09:00',
        desired_time_end: '12:00',
      }),
    ).toEqual({
      ok: true,
      desired_time: '09:00',
      desired_time_end: '12:00',
    });
    expect(
      validateGuestWaitlistTimeInput({
        preferred_window: 'time_range',
        desired_time: '12:00',
        desired_time_end: '09:00',
      }).ok,
    ).toBe(false);
  });
});
