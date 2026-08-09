import { describe, expect, it } from 'vitest';
import { mergeVenueTerminology } from '@/lib/dashboard/merge-venue-terminology';

describe('mergeVenueTerminology', () => {
  it('falls back to the model defaults when a venue has none', () => {
    expect(mergeVenueTerminology('unified_scheduling', null)).toMatchObject({
      client: 'Client',
      booking: 'Appointment',
      staff: 'Staff',
    });
  });

  it('drops restaurant words left behind by a venue that now takes appointments', () => {
    // The real shape of the bug: signed up as a restaurant, moved to
    // appointments, and the terminology written at signup was never revisited.
    const stale = { client: 'Guest', booking: 'Reservation', staff: 'Staff' };

    expect(mergeVenueTerminology('unified_scheduling', stale)).toMatchObject({
      client: 'Client',
      booking: 'Appointment',
    });
  });

  it('keeps restaurant words for a venue that really does take reservations', () => {
    const stored = { client: 'Guest', booking: 'Reservation', staff: 'Staff' };

    expect(mergeVenueTerminology('table_reservation', stored)).toMatchObject({
      client: 'Guest',
      booking: 'Reservation',
    });
  });

  it('keeps a word the venue chose, even one another model also defaults to', () => {
    // "Booking" is the default for classes and events, but an appointments
    // venue that says "Booking" means it, so it is left alone.
    expect(
      mergeVenueTerminology('unified_scheduling', { booking: 'Booking', client: 'Client' }),
    ).toMatchObject({ booking: 'Booking', client: 'Client' });
  });

  it('keeps genuinely custom words', () => {
    expect(
      mergeVenueTerminology('unified_scheduling', {
        client: 'Patient',
        booking: 'Consultation',
        staff: 'Practitioner',
      }),
    ).toMatchObject({
      client: 'Patient',
      booking: 'Consultation',
      staff: 'Practitioner',
    });
  });

  it('ignores blanks and non-strings rather than showing an empty label', () => {
    expect(
      mergeVenueTerminology('unified_scheduling', { booking: '   ', client: 42 as never }),
    ).toMatchObject({ booking: 'Appointment', client: 'Client' });
  });
});
