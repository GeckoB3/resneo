import { describe, expect, it } from 'vitest';
import { sortCollectivePractitioners } from '@/lib/linked-accounts/collective-venue';

const HOST = 'venue-host';
const OTHER_A = 'venue-a';
const OTHER_B = 'venue-b';

function calendar(name: string, venueId: string, venueName: string) {
  return { name, owning_venue_id: venueId, owning_venue_name: venueName };
}

describe('sortCollectivePractitioners', () => {
  it('puts the host venue first, whatever it is called', () => {
    const sorted = sortCollectivePractitioners(
      [
        calendar('Zoe', OTHER_A, 'Anchor Salon'),
        calendar('Amy', HOST, 'Zenith Clinic'),
      ],
      HOST,
    );
    expect(sorted.map((p) => p.name)).toEqual(['Amy', 'Zoe']);
  });

  it('orders the other venues alphabetically', () => {
    const sorted = sortCollectivePractitioners(
      [
        calendar('Cal', OTHER_B, 'Riverside Studio'),
        calendar('Bea', OTHER_A, 'Harbour Clinic'),
        calendar('Amy', HOST, 'Zenith Clinic'),
      ],
      HOST,
    );
    expect(sorted.map((p) => p.owning_venue_name)).toEqual([
      'Zenith Clinic',
      'Harbour Clinic',
      'Riverside Studio',
    ]);
  });

  it('orders people by name inside a venue', () => {
    const sorted = sortCollectivePractitioners(
      [
        calendar('Sam', HOST, 'Zenith Clinic'),
        calendar('Ada', HOST, 'Zenith Clinic'),
        calendar('Mia', HOST, 'Zenith Clinic'),
      ],
      HOST,
    );
    expect(sorted.map((p) => p.name)).toEqual(['Ada', 'Mia', 'Sam']);
  });

  it('is stable when the collective has no host on record', () => {
    const sorted = sortCollectivePractitioners(
      [
        calendar('Bea', OTHER_B, 'Riverside Studio'),
        calendar('Ada', OTHER_A, 'Harbour Clinic'),
      ],
      null,
    );
    expect(sorted.map((p) => p.name)).toEqual(['Ada', 'Bea']);
  });
});
