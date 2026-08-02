import { describe, it, expect } from 'vitest';
import type { AppointmentService, Practitioner, PractitionerService } from '@/types/booking-models';
import { getDayOfWeek } from '@/lib/availability/engine';
import { computeAppointmentAvailability, type AppointmentEngineInput } from './appointment-engine';
import { mapServiceItemToAppointmentService } from './appointment-month-availability';

/**
 * The month picker builds its own engine input from raw service rows. When that mapping drops a
 * scheduling field, a date can show as bookable and then offer no slots (or hide a date that is
 * genuinely bookable), because the month view and the day view disagree on candidate start times.
 */

const DATE = '2030-06-04';

function serviceRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 's1',
    name: 'Piano tuning',
    duration_minutes: 90,
    buffer_minutes: 0,
    is_active: true,
    ...overrides,
  };
}

function slotsFor(service: AppointmentService): string[] {
  const input: AppointmentEngineInput = {
    date: DATE,
    practitioners: [
      {
        id: 'p1',
        name: 'Alex',
        is_active: true,
        working_hours: { [String(getDayOfWeek(DATE))]: [{ start: '09:00', end: '17:00' }] },
        break_times: [],
        days_off: [],
      } as unknown as Practitioner,
    ],
    services: [service],
    practitionerServices: [
      { id: 'ps1', practitioner_id: 'p1', service_id: 's1', custom_duration_minutes: null, custom_price_pence: null },
    ] as PractitionerService[],
    existingBookings: [],
  };
  return computeAppointmentAvailability(input).practitioners[0]?.slots.map((s) => s.start_time) ?? [];
}

describe('mapServiceItemToAppointmentService', () => {
  it('carries fixed start times through to the engine', () => {
    const svc = mapServiceItemToAppointmentService(
      serviceRow({ booking_start_times: ['09:20', '11:30', '13:45', '15:30'] }),
      'v1',
    );
    expect(svc.booking_start_times).toEqual(['09:20', '11:30', '13:45', '15:30']);
    expect(slotsFor(svc)).toEqual(['09:20', '11:30', '13:45', '15:30']);
  });

  it('carries the booking interval and minute marks through to the engine', () => {
    const svc = mapServiceItemToAppointmentService(
      serviceRow({ duration_minutes: 30, booking_interval_minutes: 15, booking_minute_marks: [0, 15] }),
      'v1',
    );
    expect(svc.booking_interval_minutes).toBe(15);
    expect(svc.booking_minute_marks).toEqual([0, 15]);
    expect(slotsFor(svc)).toEqual([
      '09:00', '09:15', '10:00', '10:15', '11:00', '11:15', '12:00', '12:15',
      '13:00', '13:15', '14:00', '14:15', '15:00', '15:15', '16:00', '16:15',
    ]);
  });

  it('leaves rows with no start-time settings on the default 15-minute grid', () => {
    const svc = mapServiceItemToAppointmentService(serviceRow({ duration_minutes: 30 }), 'v1');
    expect(svc.booking_interval_minutes).toBeUndefined();
    expect(svc.booking_minute_marks).toBeNull();
    expect(svc.booking_start_times).toBeNull();
    expect(slotsFor(svc).slice(0, 4)).toEqual(['09:00', '09:15', '09:30', '09:45']);
  });
});
