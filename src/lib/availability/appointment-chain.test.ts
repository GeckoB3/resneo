import { describe, expect, it } from 'vitest';
import type { PractitionerService } from '@/types/booking-models';
import { getDayOfWeek } from '@/lib/availability/engine';
import type { AppointmentEngineInput } from './appointment-engine';
import {
  chainSegmentsSpanMinutes,
  chainStartsToSlots,
  computeChainStartsForPractitioner,
  type ChainSegmentEngineInput,
} from './appointment-chain';

/**
 * The chain helper answers "when can the WHOLE visit start?". These cases pin
 * the arithmetic the flow and `create-multi-service` both rely on: the next
 * service starts at the previous end plus its buffer, earlier segments count
 * as busy, and a start survives only when every segment fits.
 */

const DATE = '2030-06-03'; // a Monday
const DK = String(getDayOfWeek(DATE));

const LINKS: PractitionerService[] = [
  { id: 'ps1', practitioner_id: 'p1', service_id: 'cut', custom_duration_minutes: null, custom_price_pence: null },
  { id: 'ps2', practitioner_id: 'p1', service_id: 'colour', custom_duration_minutes: null, custom_price_pence: null },
];

function practitioner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Ada',
    is_active: true,
    working_hours: { [DK]: [{ start: '09:00', end: '12:00' }] },
    break_times: [],
    days_off: [],
    ...overrides,
  } as unknown as import('@/types/booking-models').Practitioner;
}

function service(id: string, duration: number, buffer = 0) {
  return {
    id,
    name: id,
    duration_minutes: duration,
    buffer_minutes: buffer,
    price_pence: 1000,
    is_active: true,
    booking_interval_minutes: 30,
  } as unknown as import('@/types/booking-models').AppointmentService;
}

function baseInput(extra: Partial<AppointmentEngineInput> = {}): AppointmentEngineInput {
  return {
    date: DATE,
    practitioners: [practitioner()],
    services: [service('cut', 30), service('colour', 60)],
    practitionerServices: LINKS,
    existingBookings: [],
    ...extra,
  };
}

function segments(input: AppointmentEngineInput, ids: string[]): ChainSegmentEngineInput[] {
  return ids.map((id) => {
    const svc = input.services.find((s) => s.id === id)!;
    return {
      input: { ...input, services: [svc] },
      serviceId: id,
      durationMinutes: svc.duration_minutes,
      bufferMinutes: svc.buffer_minutes ?? 0,
    };
  });
}

describe('chainSegmentsSpanMinutes', () => {
  it('counts inner buffers but not the last one', () => {
    expect(
      chainSegmentsSpanMinutes([
        { durationMinutes: 30, bufferMinutes: 10 },
        { durationMinutes: 60, bufferMinutes: 15 },
      ]),
    ).toBe(100);
    expect(chainSegmentsSpanMinutes([{ durationMinutes: 45, bufferMinutes: 10 }])).toBe(45);
  });
});

describe('computeChainStartsForPractitioner', () => {
  it('offers only the starts where every service fits before the day ends', () => {
    const input = baseInput();
    const { starts } = computeChainStartsForPractitioner('p1', segments(input, ['cut', 'colour']));
    const times = starts.map((s) => s.start_time);
    // cut 30 + colour 60 = 90 minutes; the last start that ends by 12:00 is 10:30.
    expect(times).toContain('09:00');
    expect(times).toContain('10:30');
    expect(times).not.toContain('11:00');
    expect(starts[0]).toEqual({ start_time: '09:00', end_time: '10:30', span_minutes: 90 });
  });

  it('starts the second service after the first one’s buffer', () => {
    const input = baseInput({ services: [service('cut', 30, 15), service('colour', 60)] });
    const { starts } = computeChainStartsForPractitioner('p1', segments(input, ['cut', 'colour']));
    // 30 + 15 buffer + 60 = 105 minutes: 10:00 ends 11:45 (fits), 10:30 ends 12:15 (does not).
    const times = starts.map((s) => s.start_time);
    expect(times).toContain('10:00');
    expect(times).not.toContain('10:30');
    expect(starts.find((s) => s.start_time === '10:00')?.end_time).toBe('11:45');
  });

  it('drops starts whose later service would collide with an existing booking', () => {
    const input = baseInput({
      existingBookings: [
        {
          id: 'b1',
          practitioner_id: 'p1',
          booking_time: '10:00',
          duration_minutes: 30,
          buffer_minutes: 0,
          status: 'Booked',
        } as unknown as AppointmentEngineInput['existingBookings'][number],
      ],
    });
    const { starts } = computeChainStartsForPractitioner('p1', segments(input, ['cut', 'colour']));
    const times = starts.map((s) => s.start_time);
    // 09:00: cut 09:00-09:30, colour 09:30-10:30 overlaps the 10:00 booking.
    expect(times).not.toContain('09:00');
    expect(times).not.toContain('09:30');
    // 10:30: cut 10:30-11:00, colour 11:00-12:00 fits.
    expect(times).toContain('10:30');
  });

  it('respects a break that only the later service would hit', () => {
    const input = baseInput({
      practitioners: [practitioner({ break_times: [{ start: '10:00', end: '10:30' }] })],
    });
    const { starts } = computeChainStartsForPractitioner('p1', segments(input, ['cut', 'colour']));
    const times = starts.map((s) => s.start_time);
    expect(times).not.toContain('09:00');
    expect(times).toContain('10:30');
  });

  it('offers nothing when the person does not do one of the services', () => {
    const input = baseInput({
      practitionerServices: LINKS.filter((l) => l.service_id === 'cut'),
    });
    const { starts } = computeChainStartsForPractitioner('p1', segments(input, ['cut', 'colour']));
    expect(starts).toEqual([]);
  });

  it('returns a single service’s ordinary starts unchanged', () => {
    const input = baseInput();
    const { starts } = computeChainStartsForPractitioner('p1', segments(input, ['cut']));
    expect(starts.map((s) => s.start_time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });
});

describe('chainStartsToSlots', () => {
  it('labels every slot with the first service and the whole span', () => {
    const slots = chainStartsToSlots(
      { id: 'p1', name: 'Ada' },
      { id: 'cut', name: 'Cut', price_pence: 2500 },
      [{ start_time: '09:00', end_time: '10:30', span_minutes: 90 }],
    );
    expect(slots).toEqual([
      {
        practitioner_id: 'p1',
        practitioner_name: 'Ada',
        service_id: 'cut',
        service_name: 'Cut',
        start_time: '09:00',
        duration_minutes: 90,
        price_pence: 2500,
      },
    ]);
  });
});
