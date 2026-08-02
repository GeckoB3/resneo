import { describe, it, expect } from 'vitest';
import type { OpeningHours } from '@/types/availability';
import type { AppointmentService, Practitioner, PractitionerService } from '@/types/booking-models';
import { getDayOfWeek } from '@/lib/availability/engine';
import {
  computeAppointmentAvailability,
  validateExactAppointmentStart,
  type AppointmentEngineInput,
} from './appointment-engine';

const PS_P1_S1: PractitionerService[] = [
  { id: 'ps1', practitioner_id: 'p1', service_id: 's1', custom_duration_minutes: null, custom_price_pence: null },
];

function dayKey(dateStr: string): string {
  return String(getDayOfWeek(dateStr));
}

/** A far-future date so "today" past-slot filtering never trims results. */
const DATE = '2030-06-04';

function buildInput(serviceOverrides: Partial<AppointmentService>): AppointmentEngineInput {
  const dk = dayKey(DATE);
  return {
    date: DATE,
    practitioners: [
      {
        id: 'p1',
        name: 'Alex',
        is_active: true,
        working_hours: { [dk]: [{ start: '09:00', end: '11:00' }] },
        break_times: [],
        days_off: [],
      } as unknown as Practitioner,
    ],
    services: [
      {
        id: 's1',
        name: 'Cut',
        duration_minutes: 30,
        buffer_minutes: 0,
        is_active: true,
        ...serviceOverrides,
      } as AppointmentService,
    ],
    practitionerServices: PS_P1_S1,
    existingBookings: [],
  };
}

function startTimes(input: AppointmentEngineInput): string[] {
  return computeAppointmentAvailability(input).practitioners[0]?.slots.map((s) => s.start_time) ?? [];
}

describe('computeAppointmentAvailability — booking interval', () => {
  it('defaults to a 15-minute grid (legacy behaviour) when unset', () => {
    const times = startTimes(buildInput({}));
    expect(times).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30']);
  });

  it('preserves legacy range-start anchoring for unconfigured services with off-grid hours', () => {
    // Working hours starting at 09:10 must keep stepping by 15 from the range start (09:10, 09:25, …),
    // exactly as before these changes — not re-anchor to the top of the hour (09:15, 09:30, …).
    const dk = dayKey(DATE);
    const input = buildInput({});
    (input.practitioners[0] as unknown as { working_hours: Record<string, unknown> }).working_hours = {
      [dk]: [{ start: '09:10', end: '11:00' }],
    };
    const times = startTimes(input);
    expect(times).toEqual(['09:10', '09:25', '09:40', '09:55', '10:10', '10:25']);
  });

  it('honours a 5-minute interval', () => {
    const times = startTimes(buildInput({ booking_interval_minutes: 5 }));
    expect(times).toContain('09:05');
    expect(times).toContain('09:55');
    // 30-minute service must still fit before 11:00 → last start is 10:30.
    expect(times).toContain('10:30');
    expect(times).not.toContain('10:35');
  });

  it('restricts to specific minute marks within each hour (first 30 min, every 5)', () => {
    const times = startTimes(
      buildInput({ booking_interval_minutes: 5, booking_minute_marks: [0, 5, 10, 15, 20, 25] }),
    );
    // First half of each hour only.
    expect(times).toEqual([
      '09:00', '09:05', '09:10', '09:15', '09:20', '09:25',
      '10:00', '10:05', '10:10', '10:15', '10:20', '10:25',
    ]);
  });

  it('restricts to on-the-hour and quarter-past only', () => {
    const times = startTimes(
      buildInput({ booking_interval_minutes: 15, booking_minute_marks: [0, 15] }),
    );
    expect(times).toEqual(['09:00', '09:15', '10:00', '10:15']);
  });
});

describe('computeAppointmentAvailability — fixed start times', () => {
  /** Full working day, so fixed times across the afternoon are in range. */
  function fullDayInput(serviceOverrides: Partial<AppointmentService>): AppointmentEngineInput {
    const input = buildInput(serviceOverrides);
    (input.practitioners[0] as unknown as { working_hours: Record<string, unknown> }).working_hours = {
      [dayKey(DATE)]: [{ start: '09:00', end: '17:00' }],
    };
    return input;
  }

  it('offers exactly the configured times (the four-jobs-a-day case)', () => {
    const times = startTimes(
      fullDayInput({
        duration_minutes: 90,
        booking_start_times: ['09:20', '11:30', '13:45', '15:30'],
      }),
    );
    expect(times).toEqual(['09:20', '11:30', '13:45', '15:30']);
  });

  it('drops a fixed time that would run past the end of the working day', () => {
    const times = startTimes(
      fullDayInput({
        duration_minutes: 120,
        booking_start_times: ['09:20', '15:30'],
      }),
    );
    expect(times).toEqual(['09:20']);
  });

  it('accounts for buffer and processing time when checking the fit', () => {
    // 15:30 + 60 duration + 30 buffer = 17:00 exactly, so it still fits.
    expect(
      startTimes(
        fullDayInput({
          duration_minutes: 60,
          buffer_minutes: 30,
          booking_start_times: ['15:30'],
        }),
      ),
    ).toEqual(['15:30']);
    // One more minute of buffer pushes it past close.
    expect(
      startTimes(
        fullDayInput({
          duration_minutes: 60,
          buffer_minutes: 31,
          booking_start_times: ['15:30'],
        }),
      ),
    ).toEqual([]);
  });

  it('wins over a conflicting interval and minute-mark configuration', () => {
    const times = startTimes(
      fullDayInput({
        duration_minutes: 30,
        booking_interval_minutes: 15,
        booking_minute_marks: [0, 15],
        booking_start_times: ['09:20', '11:30'],
      }),
    );
    expect(times).toEqual(['09:20', '11:30']);
  });

  it('is narrowed by the service custom schedule', () => {
    const dk = dayKey(DATE);
    const times = startTimes(
      fullDayInput({
        duration_minutes: 60,
        booking_start_times: ['09:20', '11:30', '13:45', '15:30'],
        custom_availability_enabled: true,
        custom_working_hours: {
          version: 2,
          rules: [{ id: 'r1', kind: 'weekly', windows: { [dk]: [{ start: '09:00', end: '13:00' }] } }],
        },
      }),
    );
    expect(times).toEqual(['09:20', '11:30']);
  });

  it('skips a fixed time already taken by an existing booking', () => {
    const input = fullDayInput({
      duration_minutes: 90,
      booking_start_times: ['09:20', '11:30', '13:45', '15:30'],
    });
    input.existingBookings = [
      {
        id: 'b1',
        practitioner_id: 'p1',
        booking_time: '11:30',
        duration_minutes: 90,
        buffer_minutes: 0,
        status: 'Confirmed',
      } as unknown as AppointmentEngineInput['existingBookings'][number],
    ];
    expect(startTimes(input)).toEqual(['09:20', '13:45', '15:30']);
  });

  it('rejects an exact start outside the fixed times, so a posted time cannot bypass them', () => {
    const input = fullDayInput({
      duration_minutes: 90,
      booking_start_times: ['09:20', '11:30'],
    });
    // The interval grid is deliberately relaxed for multi-service chains, but fixed times are a
    // list of when the service runs, so an unoffered time must not be creatable.
    expect(validateExactAppointmentStart(input, 'p1', 's1', '10:00').ok).toBe(false);
    expect(validateExactAppointmentStart(input, 'p1', 's1', '09:20').ok).toBe(true);
    expect(validateExactAppointmentStart(input, 'p1', 's1', '11:30').ok).toBe(true);
  });

  it('still allows off-grid exact starts for interval services (chains rely on it)', () => {
    const input = fullDayInput({ duration_minutes: 30, booking_interval_minutes: 15 });
    expect(validateExactAppointmentStart(input, 'p1', 's1', '10:07').ok).toBe(true);
  });

  it('falls back to the interval grid when the list is empty or null', () => {
    expect(startTimes(buildInput({ booking_start_times: [] }))).toEqual([
      '09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30',
    ]);
    expect(startTimes(buildInput({ booking_start_times: null }))).toEqual([
      '09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30',
    ]);
  });
});
