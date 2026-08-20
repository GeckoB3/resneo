import { describe, it, expect } from 'vitest';
import type { OpeningHours } from '@/types/availability';
import type { PractitionerService, Practitioner, AppointmentService } from '@/types/booking-models';
import { getDayOfWeek } from '@/lib/availability/engine';
import {
  computeAppointmentAvailability,
  validateExactAppointmentStart,
  type AppointmentEngineInput,
} from './appointment-engine';

/**
 * Overlap rules for appointment availability, pinned in both directions.
 *
 * These were written while chasing a suspected double-booking bug that turned out
 * not to exist. A 90 minute Root Tint was being offered at 20:00 on a calendar that
 * already held a 20:30-21:00 booking, which looks like a clash until you notice
 * Root Tint carries a processing gap over exactly that window. The distinction is
 * subtle enough to be worth locking down:
 *
 *   - a candidate with NO gap that would enclose an existing booking must be refused
 *   - a candidate WITH a gap may legitimately host another booking inside that gap
 *   - but its BUSY segments must still refuse a collision
 *
 * The middle case is the whole point of processing time (colour is applied, it
 * develops while the stylist takes another client, they return to finish), so a
 * future "fix" that treats it as a conflict would silently destroy salon capacity.
 */

const DATE = '2030-06-05';
const DK = String(getDayOfWeek(DATE));

function practitioner(parallelClients?: number): Practitioner {
  return {
    id: 'p1',
    name: 'Andrew',
    is_active: true,
    working_hours: { [DK]: [{ start: '09:00', end: '22:00' }] },
    break_times: [],
    days_off: [],
    ...(parallelClients != null ? { parallel_clients: parallelClients } : {}),
  } as unknown as Practitioner;
}

function service(id: string, durationMinutes: number): AppointmentService {
  return {
    id,
    name: `svc-${durationMinutes}`,
    duration_minutes: durationMinutes,
    buffer_minutes: 0,
    is_active: true,
  } as AppointmentService;
}

const OPENING: OpeningHours = {
  [DK]: { periods: [{ open: '09:00', close: '22:00' }] },
} as OpeningHours;

/** One existing 30 minute booking at 20:30-21:00. */
const EXISTING = [
  {
    id: 'b-existing',
    practitioner_id: 'p1',
    booking_time: '20:30',
    duration_minutes: 30,
    buffer_minutes: 0,
    status: 'Booked',
  },
];

function inputFor(durationMinutes: number): AppointmentEngineInput {
  const svcId = `s-${durationMinutes}`;
  return {
    date: DATE,
    venueOpeningHours: OPENING,
    practitioners: [practitioner()],
    services: [service(svcId, durationMinutes)],
    practitionerServices: [
      {
        id: 'ps1',
        practitioner_id: 'p1',
        service_id: svcId,
        custom_duration_minutes: null,
        custom_price_pence: null,
      },
    ] as PractitionerService[],
    existingBookings: EXISTING,
    skipPastSlotFilter: true,
  } as AppointmentEngineInput;
}

function startsFor(durationMinutes: number): string[] {
  const r = computeAppointmentAvailability(inputFor(durationMinutes));
  return (r.practitioners[0]?.slots ?? []).map((s) => s.start_time);
}

describe('availability: a candidate that encloses an existing booking', () => {
  it('does not offer a 90 minute slot at 20:00 that would swallow the 20:30-21:00 booking', () => {
    // 20:00 + 90 = 21:30, which fully contains 20:30-21:00.
    expect(startsFor(90)).not.toContain('20:00');
  });

  it('does not offer 150 minute slots at 19:15 or 19:30 that would swallow it', () => {
    const starts = startsFor(150);
    expect(starts).not.toContain('19:15');
    expect(starts).not.toContain('19:30');
  });

  it('still refuses shorter candidates whose end lands inside the booking', () => {
    // These already behaved correctly; kept so a fix cannot regress them.
    expect(startsFor(45)).not.toContain('20:00'); // 20:00-20:45
    expect(startsFor(60)).not.toContain('19:45'); // 19:45-20:45
  });

  it('still offers candidates that genuinely fit before and after the booking', () => {
    const ninety = startsFor(90);
    expect(ninety).toContain('19:00'); // 19:00-20:30, abuts, no overlap
    const thirty = startsFor(30);
    expect(thirty).toContain('20:00'); // 20:00-20:30, abuts
    expect(thirty).toContain('21:00'); // 21:00-21:30, after
    expect(thirty).not.toContain('20:15'); // 20:15-20:45 overlaps
    expect(thirty).not.toContain('20:30'); // exact clash
  });

  it('validateExactAppointmentStart also refuses the enclosing start', () => {
    const res = validateExactAppointmentStart(inputFor(90), 'p1', 's-90', '20:00');
    expect(res.ok).toBe(false);
  });

  it('honours parallel_clients: a calendar taking 2 at once may enclose one booking', () => {
    const svcId = 's-90';
    const input = {
      ...inputFor(90),
      practitioners: [practitioner(2)],
    } as AppointmentEngineInput;
    const r = computeAppointmentAvailability(input);
    const starts = (r.practitioners[0]?.slots ?? []).map((s) => s.start_time);
    expect(starts).toContain('20:00');
    expect(svcId).toBe('s-90');
  });
});

/**
 * The counterpart: a service WITH a processing gap is supposed to allow another
 * booking inside that gap. This is the salon case the feature exists for (colour
 * is applied, it develops while the stylist takes another client, they return to
 * finish). An "overlap" here is correct, not a double booking.
 */
describe('availability: processing gaps are legitimately shareable', () => {
  const svcId = 's-roottint';

  function rootTintLikeInput(): AppointmentEngineInput {
    return {
      date: DATE,
      venueOpeningHours: OPENING,
      practitioners: [practitioner()],
      services: [
        {
          id: svcId,
          name: 'Root Tint',
          duration_minutes: 90,
          buffer_minutes: 0,
          is_active: true,
          // Busy 0-30, FREE 30-60 (developing), busy 60-90.
          processing_time_blocks: [{ id: 'pb1', start_minute: 30, duration_minutes: 30 }],
        } as unknown as AppointmentService,
      ],
      practitionerServices: [
        {
          id: 'ps1',
          practitioner_id: 'p1',
          service_id: svcId,
          custom_duration_minutes: null,
          custom_price_pence: null,
        },
      ] as PractitionerService[],
      existingBookings: EXISTING,
      skipPastSlotFilter: true,
    } as AppointmentEngineInput;
  }

  it('offers 20:00 because the 20:30-21:00 booking sits inside the processing gap', () => {
    const r = computeAppointmentAvailability(rootTintLikeInput());
    const starts = (r.practitioners[0]?.slots ?? []).map((s) => s.start_time);
    // 20:00 -> busy 20:00-20:30, free 20:30-21:00, busy 21:00-21:30.
    // The existing booking fits exactly in the gap, so the stylist is free.
    expect(starts).toContain('20:00');
  });

  it('still refuses a start whose BUSY segment collides with the same booking', () => {
    const r = computeAppointmentAvailability(rootTintLikeInput());
    const starts = (r.practitioners[0]?.slots ?? []).map((s) => s.start_time);
    // 20:15 -> busy 20:15-20:45 which overlaps 20:30-21:00. Must be refused even
    // though a later part of the service is a gap.
    expect(starts).not.toContain('20:15');
  });
});
