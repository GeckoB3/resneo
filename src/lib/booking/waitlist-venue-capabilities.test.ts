import { describe, expect, it } from 'vitest';
import { normalizeWaitlistKindQuery, resolveWaitlistVenueCapabilities } from './waitlist-venue-capabilities';

describe('resolveWaitlistVenueCapabilities', () => {
  it('appointments plan: appointment waitlist only', () => {
    expect(
      resolveWaitlistVenueCapabilities({
        pricingTier: 'appointments',
        bookingModel: 'unified_scheduling',
      }),
    ).toEqual({
      showTableWaitlist: false,
      showAppointmentWaitlist: true,
      showKindTabs: false,
      defaultKindFilter: 'appointment',
    });
  });

  it('restaurant table-only: table waitlist only', () => {
    expect(
      resolveWaitlistVenueCapabilities({
        pricingTier: 'restaurant',
        bookingModel: 'table_reservation',
        enabledModels: [],
      }),
    ).toEqual({
      showTableWaitlist: true,
      showAppointmentWaitlist: false,
      showKindTabs: false,
      defaultKindFilter: 'table',
    });
  });

  it('restaurant with appointments secondary: both kinds with tabs', () => {
    expect(
      resolveWaitlistVenueCapabilities({
        pricingTier: 'restaurant',
        bookingModel: 'table_reservation',
        enabledModels: ['unified_scheduling'],
      }),
    ).toEqual({
      showTableWaitlist: true,
      showAppointmentWaitlist: true,
      showKindTabs: true,
      defaultKindFilter: 'all',
    });
  });

  it('restaurant with events only: no appointment waitlist tab', () => {
    const caps = resolveWaitlistVenueCapabilities({
      pricingTier: 'restaurant',
      bookingModel: 'table_reservation',
      enabledModels: ['event_ticket'],
    });
    expect(caps.showTableWaitlist).toBe(true);
    expect(caps.showAppointmentWaitlist).toBe(false);
    expect(caps.showKindTabs).toBe(false);
  });
});

describe('normalizeWaitlistKindQuery', () => {
  it('defaults to table for restaurant-only venues', () => {
    const caps = resolveWaitlistVenueCapabilities({
      pricingTier: 'restaurant',
      bookingModel: 'table_reservation',
    });
    expect(normalizeWaitlistKindQuery(caps, null)).toBe('table');
  });

  it('rejects table kind for appointments-only venues', () => {
    const caps = resolveWaitlistVenueCapabilities({
      pricingTier: 'plus',
      bookingModel: 'unified_scheduling',
    });
    expect(normalizeWaitlistKindQuery(caps, 'table')).toBe(null);
    expect(normalizeWaitlistKindQuery(caps, 'appointment')).toBe('appointment');
  });
});
