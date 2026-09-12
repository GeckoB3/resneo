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
  it('counts a multi-service visit once per day, across columns (R36)', () => {
    const visit = (practitionerId: string, bookingDate = '2026-05-10') => ({
      practitionerId,
      bookingDate,
      status: 'Booked',
      groupBookingId: 'grp-1',
      personLabel: null,
    });
    const counts = linkedBookingCountByDate(
      [
        { venueId: 'v1', practitionerId: 'p1' },
        { venueId: 'v1', practitionerId: 'p2' },
      ],
      [
        {
          venueId: 'v1',
          bookings: [
            visit('p1'),
            visit('p1'),
            visit('p2'),
            visit('p1', '2026-05-11'),
            // A party's people and a cart's classes are separate bookings.
            { ...visit('p2'), groupBookingId: 'grp-2', personLabel: 'Mum' },
            { ...visit('p2'), groupBookingId: 'grp-2', personLabel: 'Child' },
            { ...visit('p1'), groupBookingId: 'grp-3', classInstanceId: 'ci-1' },
            { ...visit('p1'), groupBookingId: 'grp-3', classInstanceId: 'ci-2' },
          ],
        },
      ],
    );
    expect(counts).toEqual({ '2026-05-10': 5, '2026-05-11': 1 });
  });
});
