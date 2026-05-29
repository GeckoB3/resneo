import { describe, expect, it } from 'vitest';
import {
  calendarBookingServiceDisplayLine,
  calendarMultiServiceDisplayTitle,
} from './calendar-booking-service-label';

describe('calendarBookingServiceDisplayLine', () => {
  it('includes variant when not already in service name', () => {
    expect(
      calendarBookingServiceDisplayLine({
        booking: { booking_item_name: 'Cut', service_variant_id: 'v1' },
        catalogService: { name: 'Cut', variants: [{ id: 'v1', name: 'Short' }] },
      }),
    ).toBe('Cut – Short');
  });

  it('includes add-on snapshots', () => {
    expect(
      calendarBookingServiceDisplayLine({
        booking: {
          booking_item_name: 'Massage',
          booking_addon_labels: ['Hot stones', 'Aromatherapy'],
        },
        catalogService: { name: 'Massage' },
      }),
    ).toBe('Massage · + Hot stones, + Aromatherapy');
  });

  it('joins resource, service, variant, and add-ons', () => {
    expect(
      calendarBookingServiceDisplayLine({
        booking: {
          booking_item_name: 'Room hire',
          service_variant_id: 'v2',
          booking_addon_labels: ['Projector'],
        },
        catalogService: {
          name: 'Room hire',
          variants: [{ id: 'v2', name: 'Half day' }],
        },
        resourceName: 'Studio A',
      }),
    ).toBe('Studio A · Room hire – Half day · + Projector');
  });
});

describe('calendarMultiServiceDisplayTitle', () => {
  it('joins segments with arrow', () => {
    expect(
      calendarMultiServiceDisplayTitle([
        {
          booking: { booking_item_name: 'Cut' },
          catalogService: { name: 'Cut' },
        },
        {
          booking: {
            booking_item_name: 'Colour',
            booking_addon_labels: ['Toner'],
          },
          catalogService: { name: 'Colour' },
        },
      ]),
    ).toBe('Cut → Colour · + Toner');
  });
});
