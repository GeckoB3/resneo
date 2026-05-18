import { describe, expect, it } from 'vitest';
import { linkedBookingCountByDate } from './month-linked-counts';

describe('linkedBookingCountByDate', () => {
  it('counts visible practitioner bookings per day, skips cancelled', () => {
    const counts = linkedBookingCountByDate(
      [{ venueId: 'v1', practitionerId: 'p1' }],
      [
        {
          venueId: 'v1',
          bookings: [
            {
              practitionerId: 'p1',
              bookingDate: '2026-05-10',
              status: 'Booked',
            },
            {
              practitionerId: 'p1',
              bookingDate: '2026-05-10',
              status: 'Cancelled',
            },
            {
              practitionerId: 'p2',
              bookingDate: '2026-05-10',
              status: 'Booked',
            },
          ],
        },
      ],
    );
    expect(counts).toEqual({ '2026-05-10': 1 });
  });

  it('sums across multiple visible columns', () => {
    const counts = linkedBookingCountByDate(
      [
        { venueId: 'v1', practitionerId: 'p1' },
        { venueId: 'v2', practitionerId: 'p2' },
      ],
      [
        {
          venueId: 'v1',
          bookings: [
            { practitionerId: 'p1', bookingDate: '2026-05-11', status: 'Confirmed' },
          ],
        },
        {
          venueId: 'v2',
          bookings: [
            { practitionerId: 'p2', bookingDate: '2026-05-11', status: 'Booked' },
          ],
        },
      ],
    );
    expect(counts['2026-05-11']).toBe(2);
  });
});
