import { describe, it, expect } from 'vitest';
import type { OpeningHours } from '@/types/availability';
import type { PractitionerService } from '@/types/booking-models';
import { getDayOfWeek } from '@/lib/availability/engine';
import {
  computeAppointmentAvailability,
  validateAppointmentCustomInterval,
  type AppointmentEngineInput,
  type AppointmentBooking,
} from './appointment-engine';

/** Explicit link required for p1 to offer s1 (no “implicit all services”). */
const PS_P1_S1: PractitionerService[] = [
  { id: 'ps1', practitioner_id: 'p1', service_id: 's1', custom_duration_minutes: null, custom_price_pence: null },
];

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** Working-hours keys match getDayOfWeek (same as practitioner dashboard). */
function workingHoursDayKey(dateStr: string): string {
  return String(getDayOfWeek(dateStr));
}

describe('computeAppointmentAvailability', () => {
  it('clips appointment slots to venue opening hours when configured (intersection with staff hours)', () => {
    const date = '2030-06-02';
    const dk = workingHoursDayKey(date);
    const venueOpeningHours = {
      [dk]: { periods: [{ open: '10:00', close: '16:00' }] },
    } as OpeningHours;
    const input: AppointmentEngineInput = {
      date,
      venueOpeningHours,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: [],
    };
    const r = computeAppointmentAvailability(input);
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '09:00')).toBe(false);
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '09:30')).toBe(false);
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '10:00')).toBe(true);
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '15:30')).toBe(true);
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '16:00')).toBe(false);
  });

  it('treats a venue opening exception as closed for that date (no slots)', () => {
    const date = '2030-06-02';
    const dk = workingHoursDayKey(date);
    const venueOpeningHours = {
      [dk]: { periods: [{ open: '10:00', close: '16:00' }] },
    } as OpeningHours;
    const input: AppointmentEngineInput = {
      date,
      venueOpeningHours,
      venueOpeningExceptions: [
        {
          id: 'ex1',
          date_start: date,
          date_end: date,
          closed: true,
        },
      ],
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: [],
    };
    const r = computeAppointmentAvailability(input);
    expect(r.practitioners.length).toBe(0);
  });

  it('applies min_notice_hours on top of current time for guest flow', () => {
    const date = todayYmd();
    const dk = workingHoursDayKey(date);
    const input: AppointmentEngineInput = {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: [],
      minNoticeHours: 2,
    };
    const r = computeAppointmentAvailability(input, 10 * 60);
    expect(r.practitioners[0]?.slots.find((s) => s.start_time === '10:00')).toBeUndefined();
    expect(r.practitioners[0]?.slots.find((s) => s.start_time === '11:30')).toBeUndefined();
    expect(r.practitioners[0]?.slots.find((s) => s.start_time === '12:00')).toBeDefined();
  });

  it('does not drop the practitioner on today when allowSameDayBooking is false (slots follow min-notice and clock)', () => {
    const date = todayYmd();
    const dk = workingHoursDayKey(date);
    const input: AppointmentEngineInput = {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: [],
      allowSameDayBooking: false,
    };
    const r = computeAppointmentAvailability(input, 9 * 60);
    expect(r.practitioners.length).toBeGreaterThan(0);
    expect(r.practitioners[0]?.slots.length ?? 0).toBeGreaterThan(0);
  });

  it('hides today slots before current time for guest flow (default)', () => {
    const date = todayYmd();
    const dk = workingHoursDayKey(date);
    const input: AppointmentEngineInput = {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: [],
    };
    // Simulate 6pm local: 16:30 is "past"
    const lateDay = 18 * 60;
    const r = computeAppointmentAvailability(input, lateDay);
    const slot1630 = r.practitioners[0]?.slots.find((s) => s.start_time === '16:30');
    expect(slot1630).toBeUndefined();
  });

  it('skipPastSlotFilter allows same-day reschedule to a clock-past time for staff validation', () => {
    const date = todayYmd();
    const dk = workingHoursDayKey(date);
    const input: AppointmentEngineInput = {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: [],
      skipPastSlotFilter: true,
    };
    const lateDay = 18 * 60;
    const r = computeAppointmentAvailability(input, lateDay);
    const slot1630 = r.practitioners[0]?.slots.find((s) => s.start_time === '16:30' && s.service_id === 's1');
    expect(slot1630).toBeDefined();
  });

  it('respects practitioner calendar blocks', () => {
    const date = '2030-06-02';
    const dk = workingHoursDayKey(date);
    const input: AppointmentEngineInput = {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: [],
      practitionerBlockedRanges: [{ practitioner_id: 'p1', start: 15 * 60, end: 17 * 60 }],
    };
    const r = computeAppointmentAvailability(input);
    const inBlock = r.practitioners[0]?.slots.some((s) => s.start_time === '15:30');
    expect(inBlock).toBe(false);
    // 14:30 + 30m ends at 15:00 (block start) - must not overlap closed interval
    const beforeBlock = r.practitioners[0]?.slots.some((s) => s.start_time === '14:30');
    expect(beforeBlock).toBe(true);
  });

  it('after removing the booking being moved, 13:00 is available when another booking occupied 12:00', () => {
    const date = '2030-08-11';
    const dk = workingHoursDayKey(date);
    const base: AppointmentEngineInput = {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: [{ id: 'ps1', practitioner_id: 'p1', service_id: 's1', custom_duration_minutes: null, custom_price_pence: null }],
      existingBookings: [
        {
          id: 'moving',
          practitioner_id: 'p1',
          booking_time: '12:00',
          duration_minutes: 30,
          buffer_minutes: 0,
          status: 'Confirmed',
        },
      ],
    };
    const staffInput: AppointmentEngineInput = {
      ...base,
      existingBookings: base.existingBookings.filter((b) => b.id !== 'moving'),
      skipPastSlotFilter: true,
    };
    const r = computeAppointmentAvailability(staffInput);
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '13:00' && s.service_id === 's1')).toBe(true);
  });

  it('uses break_times_by_day for that weekday when set (ignores same-day break_times)', () => {
    const date = '2030-06-04';
    const dk = workingHoursDayKey(date);
    const input: AppointmentEngineInput = {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [{ start: '12:00', end: '13:00' }],
          break_times_by_day: { [dk]: [] },
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: 30,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: [],
    };
    const r = computeAppointmentAvailability(input);
    const slot1200 = r.practitioners[0]?.slots.find((s) => s.start_time === '12:00' && s.service_id === 's1');
    expect(slot1200).toBeDefined();
  });
});

describe('validateAppointmentCustomInterval (salon processing)', () => {
  function processingInput(existing: AppointmentBooking[]): AppointmentEngineInput {
    const date = '2030-06-02';
    const dk = workingHoursDayKey(date);
    return {
      date,
      skipPastSlotFilter: true,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '18:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's60',
          name: 'Colour',
          duration_minutes: 60,
          buffer_minutes: 10,
          processing_time_minutes: 0,
          processing_time_blocks: [],
          is_active: true,
        } as unknown as import('@/types/booking-models').AppointmentService,
        {
          id: 's15',
          name: 'Quick',
          duration_minutes: 15,
          buffer_minutes: 0,
          processing_time_minutes: 0,
          is_active: true,
        } as unknown as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: [
        { id: 'ps1', practitioner_id: 'p1', service_id: 's60', custom_duration_minutes: null, custom_price_pence: null },
        { id: 'ps2', practitioner_id: 'p1', service_id: 's15', custom_duration_minutes: null, custom_price_pence: null },
      ],
      existingBookings: existing,
    };
  }

  it('allows a short booking fully inside another appointment’s processing gap', () => {
    const existing: AppointmentBooking[] = [
      {
        id: 'long',
        practitioner_id: 'p1',
        booking_time: '10:00',
        duration_minutes: 60,
        buffer_minutes: 10,
        status: 'Confirmed',
        processing_time_blocks: [{ id: 'g', start_minute: 15, duration_minutes: 30 }],
      },
    ];
    const input = processingInput(existing);
    const ok = validateAppointmentCustomInterval(input, 'p1', 's15', '10:20', '10:35', undefined, {
      processingTimeBlocks: [],
    });
    expect(ok.ok).toBe(true);
  });

  it('rejects a candidate that overlaps practitioner-busy before the processing gap', () => {
    const existing: AppointmentBooking[] = [
      {
        id: 'long',
        practitioner_id: 'p1',
        booking_time: '10:00',
        duration_minutes: 60,
        buffer_minutes: 10,
        status: 'Confirmed',
        processing_time_blocks: [{ id: 'g', start_minute: 15, duration_minutes: 30 }],
      },
    ];
    const input = processingInput(existing);
    const bad = validateAppointmentCustomInterval(input, 'p1', 's15', '10:05', '10:20', undefined, {
      processingTimeBlocks: [],
    });
    expect(bad.ok).toBe(false);
  });

  it('rejects candidate processing blocks that extend past the core duration', () => {
    const date = '2030-06-02';
    const dk = workingHoursDayKey(date);
    const input: AppointmentEngineInput = {
      date,
      skipPastSlotFilter: true,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '18:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's45',
          name: 'Slot',
          duration_minutes: 45,
          buffer_minutes: 0,
          processing_time_minutes: 0,
          is_active: true,
        } as unknown as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: [
        { id: 'ps1', practitioner_id: 'p1', service_id: 's45', custom_duration_minutes: null, custom_price_pence: null },
      ],
      existingBookings: [],
    };
    const invalid = validateAppointmentCustomInterval(input, 'p1', 's45', '10:00', '10:45', undefined, {
      processingTimeBlocks: [{ id: 'x', start_minute: 40, duration_minutes: 10 }],
    });
    expect(invalid.ok).toBe(false);
  });
});

// ── Add-ons: validating the engine sees the EXTENDED duration ─────────────────
// The plan (§6.1) says callers must apply add-on minutes to the service input
// BEFORE invoking the engine. These tests fixture the supported pattern: callers
// stack `additional_duration_minutes` from chosen add-ons onto `service.duration_minutes`
// so the engine fits slots against the longer total. We verify:
//   • no add-ons: base behaviour unchanged
//   • +15 min add-on: a slot whose end would overflow an existing 10:30 booking is hidden
//   • the same slot becomes available again when the add-on is removed (base duration only)
describe('appointment engine: add-on duration extends slot fitting', () => {
  const date = '2030-06-02';
  const dk = workingHoursDayKey(date);
  const existingBookingAt1030: AppointmentBooking[] = [
    {
      id: 'b-existing',
      booking_time: '10:30',
      duration_minutes: 30,
      buffer_minutes: 0,
      practitioner_id: 'p1',
      status: 'Booked',
    },
  ];
  function inputWithDuration(durationMinutes: number): AppointmentEngineInput {
    return {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as import('@/types/booking-models').Practitioner,
      ],
      services: [
        {
          id: 's1',
          name: 'Cut',
          duration_minutes: durationMinutes,
          buffer_minutes: 0,
          is_active: true,
        } as import('@/types/booking-models').AppointmentService,
      ],
      practitionerServices: PS_P1_S1,
      existingBookings: existingBookingAt1030,
    };
  }

  it('base 30-min duration: 10:00 slot fits before the 10:30 booking', () => {
    const r = computeAppointmentAvailability(inputWithDuration(30));
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '10:00')).toBe(true);
  });

  it('base + 15-min add-on (45 total): 10:00 slot is dropped (would overflow the 10:30 booking)', () => {
    const r = computeAppointmentAvailability(inputWithDuration(30 + 15));
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '10:00')).toBe(false);
  });

  it('base + larger add-on still leaves the late-afternoon slots bookable when there is room', () => {
    // 11:00–17:00 is free after the existing booking ends at 11:00. Adding +60 min
    // turns the service into a 90-min slot; the engine should still find 11:00 / 12:00 / 13:00 etc.
    const r = computeAppointmentAvailability(inputWithDuration(30 + 60));
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '12:00')).toBe(true);
    expect(r.practitioners[0]?.slots.some((s) => s.start_time === '13:00')).toBe(true);
  });
});
