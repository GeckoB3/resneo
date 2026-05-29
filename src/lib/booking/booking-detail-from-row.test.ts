import { describe, expect, it } from 'vitest';
import {
  bookingDetailLiteFromListRow,
  resolveExpandedBookingServiceLine,
} from '@/lib/booking/booking-detail-from-row';

describe('resolveExpandedBookingServiceLine', () => {
  it('prefers list row service_name over detail cde_context', () => {
    expect(
      resolveExpandedBookingServiceLine(
        { service_name: 'Cut & blow dry', booking_item_name: null },
        { cde_context: { title: 'Other' } },
      ),
    ).toBe('Cut & blow dry');
  });

  it('uses booking_item_name when service_name is missing', () => {
    expect(
      resolveExpandedBookingServiceLine(
        { service_name: null, booking_item_name: '  Colour  ' },
        null,
      ),
    ).toBe('Colour');
  });

  it('falls back to variant then cde_context after hydration', () => {
    expect(
      resolveExpandedBookingServiceLine(
        { service_name: null, booking_item_name: null },
        {
          service_variant_name: 'Long hair',
          cde_context: { title: 'Should not win' },
        },
      ),
    ).toBe('Long hair');
  });

  it('combines base service and variant name', () => {
    expect(
      resolveExpandedBookingServiceLine(
        { service_name: 'Cut', booking_item_name: null },
        { service_variant_name: 'Short' },
      ),
    ).toBe('Cut – Short');
  });

  it('keeps label when API detail has no cde_context (appointments)', () => {
    const row = {
      id: 'b1',
      booking_date: '2026-05-20',
      booking_time: '10:00',
      party_size: 1,
      status: 'Booked',
      booking_item_name: 'Consultation',
      inferred_booking_model: 'practitioner_appointment' as const,
    };
    const seed = bookingDetailLiteFromListRow(row);
    expect(seed.cde_context?.title).toBe('Consultation');
    expect(resolveExpandedBookingServiceLine(row, { cde_context: null })).toBe('Consultation');
  });
});
