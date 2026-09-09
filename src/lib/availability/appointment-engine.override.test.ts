import { describe, expect, it } from 'vitest';
import {
  validateAppointmentCustomInterval,
  type AppointmentEngineInput,
} from '@/lib/availability/appointment-engine';
import type { AppointmentService, Practitioner } from '@/types/booking-models';

/**
 * The staff "override availability" booking (Docs/staff-availability-override-plan.md)
 * runs the interval check in `collectReasons` mode: every gate a staff member may
 * knowingly book through becomes a warning and the check still answers `ok`, while
 * the impossible (an unknown person or service, a length outside the limits) still
 * refuses. `allowUnassignedService` lets a calendar take a service it is not
 * assigned, sized and priced from the catalogue entry.
 */
const DATE = '2030-06-03'; // a Monday
const DAY_KEY = '1';

const sarah = {
  id: 'p1',
  name: 'Sarah',
  is_active: true,
  working_hours: { [DAY_KEY]: [{ start: '09:00', end: '17:00' }] },
  break_times: [{ day: 1, start: '13:00', end: '14:00' }],
  days_off: [],
} as unknown as Practitioner;

const cut = {
  id: 's30',
  name: 'Cut',
  duration_minutes: 30,
  buffer_minutes: 0,
  processing_time_minutes: 0,
  processing_time_blocks: [],
  is_active: true,
} as unknown as AppointmentService;

const colour = {
  id: 's90',
  name: 'Colour',
  duration_minutes: 90,
  buffer_minutes: 0,
  processing_time_minutes: 0,
  processing_time_blocks: [],
  is_active: true,
} as unknown as AppointmentService;

function inputWith(overrides: Partial<AppointmentEngineInput> = {}): AppointmentEngineInput {
  return {
    date: DATE,
    skipPastSlotFilter: true,
    practitioners: [sarah],
    services: [cut, colour],
    practitionerServices: [
      { id: 'ps1', practitioner_id: 'p1', service_id: 's30', custom_duration_minutes: null, custom_price_pence: null },
    ],
    existingBookings: [],
    ...overrides,
  };
}

const OVERRIDE = { allowUnassignedService: true, collectReasons: true } as const;

describe('validateAppointmentCustomInterval with the override options', () => {
  it('answers ok with no warnings for a time the engine would have offered', () => {
    const r = validateAppointmentCustomInterval(inputWith(), 'p1', 's30', '10:00', '10:30', undefined, OVERRIDE);
    expect(r).toEqual({ ok: true, warnings: [] });
  });

  it('reports outside hours, a break, a block and an overlap as warnings instead of refusing', () => {
    const input = inputWith({
      existingBookings: [
        { id: 'b1', practitioner_id: 'p1', booking_time: '10:00:00', status: 'Booked', duration_minutes: 30, buffer_minutes: 0 } as never,
      ],
      practitionerBlockedRanges: [{ practitioner_id: 'p1', start: 10 * 60, end: 10 * 60 + 15, kind: 'leave' } as never],
    });
    const overlap = validateAppointmentCustomInterval(input, 'p1', 's30', '10:00', '10:30', undefined, OVERRIDE);
    expect(overlap.ok).toBe(true);
    expect(overlap.warnings).toEqual(expect.arrayContaining(['Conflicts with another booking']));
    expect(overlap.warnings?.some((w) => /leave/i.test(w))).toBe(true);

    const early = validateAppointmentCustomInterval(inputWith(), 'p1', 's30', '07:00', '07:30', undefined, OVERRIDE);
    expect(early).toEqual({ ok: true, warnings: ['Outside working hours'] });

    const onBreak = validateAppointmentCustomInterval(inputWith(), 'p1', 's30', '13:15', '13:45', undefined, OVERRIDE);
    expect(onBreak).toEqual({ ok: true, warnings: ['Conflicts with a break'] });

    // Without the override the same requests are refused, as they always were.
    expect(validateAppointmentCustomInterval(inputWith(), 'p1', 's30', '07:00', '07:30').ok).toBe(false);
    expect(validateAppointmentCustomInterval(input, 'p1', 's30', '10:00', '10:30').ok).toBe(false);
  });

  it('reports full-day leave as a warning, which nothing else may skip', () => {
    const input = inputWith({
      practitioners: [{ ...sarah, days_off: [DATE] } as unknown as Practitioner],
      fullDayLeavePractitionerIds: ['p1'],
    });
    const r = validateAppointmentCustomInterval(input, 'p1', 's30', '10:00', '10:30', undefined, OVERRIDE);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining(['Staff on leave this day']));
    expect(validateAppointmentCustomInterval(input, 'p1', 's30', '10:00', '10:30', undefined, { allowOutsideHours: true }).ok).toBe(false);
  });

  it('takes a service the person is not assigned, and says so', () => {
    const r = validateAppointmentCustomInterval(inputWith(), 'p1', 's90', '10:00', '11:30', undefined, OVERRIDE);
    expect(r).toEqual({ ok: true, warnings: ['Sarah does not usually offer Colour'] });
    // Only with the option: the ordinary check still refuses the unassigned pair.
    expect(validateAppointmentCustomInterval(inputWith(), 'p1', 's90', '10:00', '11:30')).toEqual({
      ok: false,
      reason: 'Service not available with this staff member',
    });
  });

  it('still refuses the impossible: an unknown person, an unknown service, a length outside the limits', () => {
    expect(validateAppointmentCustomInterval(inputWith(), 'nobody', 's30', '10:00', '10:30', undefined, OVERRIDE).ok).toBe(false);
    expect(validateAppointmentCustomInterval(inputWith(), 'p1', 'nothing', '10:00', '10:30', undefined, OVERRIDE).ok).toBe(false);
    expect(validateAppointmentCustomInterval(inputWith(), 'p1', 's30', '10:00', '10:02', undefined, OVERRIDE).ok).toBe(false);
  });

  it('leaves the plain answer shape alone when reasons are not collected', () => {
    expect(validateAppointmentCustomInterval(inputWith(), 'p1', 's30', '10:00', '10:30')).toEqual({ ok: true });
  });
});
