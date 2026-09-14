import { describe, expect, it } from 'vitest';
import {
  calendarDurationMinutes,
  calendarPricePence,
  resolveCalendarServiceTerms,
} from './calendar-service-terms';
import { applyVariantToService } from '@/lib/appointments/service-variant';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import type { AppointmentService, PractitionerService, ServiceVariant } from '@/types/booking-models';

/** TERMS-01: one resolver, one precedence table, over today's two calendar values. */
const service = {
  price_pence: 4000,
  duration_minutes: 60,
  buffer_minutes: 10,
  deposit_pence: 1000,
  processing_time_blocks: [{ id: 'b1', start_minute: 40, duration_minutes: 20 }],
};
const assignment = { custom_price_pence: 2200, custom_duration_minutes: 50 };
const option = {
  price_pence: 5500,
  duration_minutes: 90,
  buffer_minutes: 15,
  deposit_pence: null,
  processing_time_blocks: [],
};

describe('calendarPricePence / calendarDurationMinutes', () => {
  it("uses the calendar's own value when set", () => {
    expect(calendarPricePence(4000, assignment)).toBe(2200);
    expect(calendarDurationMinutes(60, assignment)).toBe(50);
  });

  it("falls back to the service's value when the calendar has none", () => {
    expect(calendarPricePence(4000, { custom_price_pence: null })).toBe(4000);
    expect(calendarPricePence(4000, null)).toBe(4000);
    expect(calendarDurationMinutes(60, undefined)).toBe(60);
  });

  it('treats a calendar price of 0 as a real price', () => {
    expect(calendarPricePence(4000, { custom_price_pence: 0 })).toBe(0);
  });

  it('keeps an unpriced service unpriced', () => {
    expect(calendarPricePence(null, null)).toBeNull();
  });
});

describe('resolveCalendarServiceTerms precedence', () => {
  it('service only', () => {
    expect(resolveCalendarServiceTerms({ service })).toMatchObject({
      pricePence: 4000,
      durationMinutes: 60,
      totalDurationMinutes: 60,
      bufferMinutes: 10,
      depositPence: 1000,
    });
  });

  it('calendar values replace the service price and length', () => {
    expect(resolveCalendarServiceTerms({ service, assignment })).toMatchObject({
      pricePence: 2200,
      durationMinutes: 50,
      bufferMinutes: 10,
      depositPence: 1000,
    });
  });

  it('an option replaces the calendar values, and its deposit falls back to the service', () => {
    expect(resolveCalendarServiceTerms({ service, assignment, option })).toMatchObject({
      pricePence: 5500,
      durationMinutes: 90,
      bufferMinutes: 15,
      depositPence: 1000,
    });
  });

  it('a staff-entered length wins over everything; add-on minutes stack on top', () => {
    expect(
      resolveCalendarServiceTerms({ service, assignment, option, staffLengthMinutes: 35, addonMinutes: 15 }),
    ).toMatchObject({ durationMinutes: 35, totalDurationMinutes: 50, pricePence: 5500 });
  });

  it('re-fits the service pattern to the calendar length', () => {
    const terms = resolveCalendarServiceTerms({ service, assignment });
    for (const b of terms.processingBlocks) expect(b.start_minute).toBeLessThan(50);
  });
});

describe('the shared merges agree with the resolver', () => {
  it('mergeAppointmentServiceWithPractitionerLink then applyVariantToService matches', () => {
    const base = { ...service, id: 's1', name: 'Colour', is_active: true } as unknown as AppointmentService;
    const link = { id: 'l1', practitioner_id: 'c1', service_id: 's1', ...assignment } as PractitionerService;
    const merged = mergeAppointmentServiceWithPractitionerLink(base, link);
    expect({ price: merged.price_pence, length: merged.duration_minutes }).toEqual({ price: 2200, length: 50 });

    const withOption = applyVariantToService(merged, { ...option, id: 'v1', name: 'Long', is_active: true } as unknown as ServiceVariant);
    const terms = resolveCalendarServiceTerms({ service, assignment, option });
    expect({
      price: withOption.price_pence,
      length: withOption.duration_minutes,
      buffer: withOption.buffer_minutes,
      deposit: withOption.deposit_pence,
    }).toEqual({
      price: terms.pricePence,
      length: terms.durationMinutes,
      buffer: terms.bufferMinutes,
      deposit: terms.depositPence,
    });
  });
});
