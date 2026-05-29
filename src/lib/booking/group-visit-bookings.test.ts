import { describe, expect, it, beforeEach } from 'vitest';
import {
  formatGroupVisitSegmentDurationLabel,
  groupVisitSegmentsFromList,
  mapGroupVisitListRow,
  peekGroupVisitBookings,
  primeGroupVisitBookingsFromListSeeds,
  resolveInitialGroupVisitBookings,
} from '@/lib/booking/group-visit-bookings';

describe('group-visit-bookings cache', () => {
  beforeEach(() => {
    primeGroupVisitBookingsFromListSeeds([]);
  });

  it('primes multi-service groups from list seeds', () => {
    primeGroupVisitBookingsFromListSeeds([
      {
        id: 'a',
        booking_time: '10:00',
        status: 'Booked',
        group_booking_id: 'g1',
        booking_item_name: 'Cut',
      },
      {
        id: 'b',
        booking_time: '11:00',
        status: 'Booked',
        group_booking_id: 'g1',
        booking_item_name: 'Colour',
      },
    ]);
    const cached = peekGroupVisitBookings('g1');
    expect(cached?.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('resolveInitialGroupVisitBookings prefers cached segments', () => {
    primeGroupVisitBookingsFromListSeeds([
      { id: 'a', booking_time: '10:00', status: 'Booked', group_booking_id: 'g2' },
      { id: 'b', booking_time: '11:00', status: 'Booked', group_booking_id: 'g2' },
    ]);
    const initial = resolveInitialGroupVisitBookings([], 'g2');
    expect(initial?.length).toBe(2);
  });

  it('groupVisitSegmentsFromList returns sorted siblings', () => {
    const rows = groupVisitSegmentsFromList(
      [
        { id: 'b', booking_time: '11:00', status: 'Booked', group_booking_id: 'g3' },
        { id: 'a', booking_time: '10:00', status: 'Booked', group_booking_id: 'g3' },
      ],
      'g3',
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('maps wall-clock duration and add-on minutes from list rows', () => {
    const row = mapGroupVisitListRow({
      id: 'x',
      booking_time: '10:00',
      booking_end_time: '10:45',
      status: 'Booked',
      addons_total_duration_minutes: 15,
    });
    expect(row.duration_minutes).toBe(45);
    expect(row.addons_total_duration_minutes).toBe(15);
  });

  it('formats duration with service and extras breakdown', () => {
    expect(
      formatGroupVisitSegmentDurationLabel({
        duration_minutes: 45,
        addons_total_duration_minutes: 15,
      }),
    ).toBe('45 min (30 min service + 15 min extras)');
  });
});
