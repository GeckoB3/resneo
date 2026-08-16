import { describe, expect, it } from 'vitest';
import {
  validateAppointmentCustomInterval,
  type AppointmentEngineInput,
} from '@/lib/availability/appointment-engine';
import type { AppointmentService, Practitioner } from '@/types/booking-models';

/**
 * SA-M3. Full-day leave is folded into `days_off` by `leaveRowsToDaysOffAndBlocks`,
 * and `days_off` is read by the working-hours gate, which every staff override
 * skips via `allowOutsideHours`. So a staff move, resize or walk-in could be
 * placed on a practitioner who was on leave all day, while the comments in the
 * engine and in `venue/bookings/route.ts` both claimed leave was still honoured.
 *
 * Partial leave was never affected: it arrives as a blocked range of kind
 * `leave`, which is checked outside the overridable block. Both cases are
 * covered here so a future refactor cannot quietly swap which one is safe.
 */

const DATE = '2030-06-03'; // a Monday
const DAY_KEY = '1';

function inputWith(overrides: Partial<AppointmentEngineInput>): AppointmentEngineInput {
  return {
    date: DATE,
    skipPastSlotFilter: true,
    practitioners: [
      {
        id: 'p1',
        name: 'Sarah',
        is_active: true,
        working_hours: { [DAY_KEY]: [{ start: '09:00', end: '17:00' }] },
        break_times: [],
        days_off: [],
      } as unknown as Practitioner,
    ],
    services: [
      {
        id: 's30',
        name: 'Cut',
        duration_minutes: 30,
        buffer_minutes: 0,
        processing_time_minutes: 0,
        processing_time_blocks: [],
        is_active: true,
      } as unknown as AppointmentService,
    ],
    practitionerServices: [
      {
        id: 'ps1',
        practitioner_id: 'p1',
        service_id: 's30',
        custom_duration_minutes: null,
        custom_price_pence: null,
      },
    ],
    existingBookings: [],
    ...overrides,
  };
}

/** What a fetcher produces for a practitioner on full-day leave. */
function onFullDayLeave(): AppointmentEngineInput {
  return inputWith({
    practitioners: [
      {
        id: 'p1',
        name: 'Sarah',
        is_active: true,
        working_hours: { [DAY_KEY]: [{ start: '09:00', end: '17:00' }] },
        break_times: [],
        days_off: [DATE],
      } as unknown as Practitioner,
    ],
    fullDayLeavePractitionerIds: ['p1'],
  });
}

describe('full-day leave survives allowOutsideHours (SA-M3)', () => {
  it('refuses a staff override onto a practitioner on full-day leave', () => {
    const res = validateAppointmentCustomInterval(
      onFullDayLeave(),
      'p1',
      's30',
      '10:00',
      '10:30',
      undefined,
      { allowOutsideHours: true, processingTimeBlocks: [] },
    );

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Staff on leave this day');
  });

  it('refuses a walk-in, which relaxes every other gate at once', () => {
    // The walk-in path passes all four overrides together. If the leave check
    // ever moves back inside the opening-hours block, this is the call that
    // would silently start succeeding.
    const res = validateAppointmentCustomInterval(
      onFullDayLeave(),
      'p1',
      's30',
      '10:00',
      '10:30',
      undefined,
      {
        allowOutsideHours: true,
        allowBookingOverlap: true,
        allowInsideNoticeWindow: true,
        allowDuringBreaks: true,
        processingTimeBlocks: [],
      },
    );

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Staff on leave this day');
  });

  it('still lets staff book outside hours on an ordinary day off', () => {
    // The override must keep working for what it is actually for. A day the
    // practitioner does not normally work is a boundary, not an absence.
    const res = validateAppointmentCustomInterval(
      inputWith({
        practitioners: [
          {
            id: 'p1',
            name: 'Sarah',
            is_active: true,
            working_hours: { [DAY_KEY]: [{ start: '09:00', end: '17:00' }] },
            break_times: [],
            days_off: [DATE],
          } as unknown as Practitioner,
        ],
      }),
      'p1',
      's30',
      '10:00',
      '10:30',
      undefined,
      { allowOutsideHours: true, processingTimeBlocks: [] },
    );

    expect(res.ok).toBe(true);
  });

  it('still lets staff book past closing on a working day', () => {
    const res = validateAppointmentCustomInterval(
      inputWith({}),
      'p1',
      's30',
      '17:15',
      '17:45',
      undefined,
      { allowOutsideHours: true, processingTimeBlocks: [] },
    );

    expect(res.ok).toBe(true);
  });

  it('refuses partial leave without needing the override to be off', () => {
    const res = validateAppointmentCustomInterval(
      inputWith({
        practitionerBlockedRanges: [
          { practitioner_id: 'p1', start: 12 * 60, end: 13 * 60, kind: 'leave' },
        ],
      }),
      'p1',
      's30',
      '12:15',
      '12:45',
      undefined,
      { allowOutsideHours: true, processingTimeBlocks: [] },
    );

    expect(res.ok).toBe(false);
  });

  it('leaves an unrelated practitioner bookable while a colleague is on leave', () => {
    const input = onFullDayLeave();
    input.practitioners = [
      ...input.practitioners,
      {
        id: 'p2',
        name: 'Jo',
        is_active: true,
        working_hours: { [DAY_KEY]: [{ start: '09:00', end: '17:00' }] },
        break_times: [],
        days_off: [],
      } as unknown as Practitioner,
    ];
    input.practitionerServices = [
      ...input.practitionerServices,
      {
        id: 'ps2',
        practitioner_id: 'p2',
        service_id: 's30',
        custom_duration_minutes: null,
        custom_price_pence: null,
      },
    ];

    const res = validateAppointmentCustomInterval(input, 'p2', 's30', '10:00', '10:30', undefined, {
      allowOutsideHours: true,
      processingTimeBlocks: [],
    });

    expect(res.ok).toBe(true);
  });
});
