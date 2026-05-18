import { describe, expect, it } from 'vitest';
import {
  parseVenueDeletionLinkPartners,
  uniqueSurvivorVenueIds,
} from './venue-deletion';

describe('parseVenueDeletionLinkPartners', () => {
  it('parses RPC JSON array', () => {
    const payload = [
      {
        link_id: 'a',
        survivor_venue_id: 'b',
        deleted_venue_name: 'Deleted Salon',
      },
      {
        link_id: 'c',
        survivor_venue_id: 'd',
        deleted_venue_name: 'Deleted Salon',
      },
    ];
    expect(parseVenueDeletionLinkPartners(payload)).toEqual(payload);
  });

  it('returns empty for non-array', () => {
    expect(parseVenueDeletionLinkPartners(null)).toEqual([]);
    expect(parseVenueDeletionLinkPartners({})).toEqual([]);
  });

  it('skips rows missing ids', () => {
    expect(
      parseVenueDeletionLinkPartners([{ link_id: 'a', survivor_venue_id: '' }]),
    ).toEqual([]);
  });
});

describe('uniqueSurvivorVenueIds', () => {
  it('deduplicates survivors', () => {
    const ids = uniqueSurvivorVenueIds([
      { link_id: '1', survivor_venue_id: 'x', deleted_venue_name: 'A' },
      { link_id: '2', survivor_venue_id: 'x', deleted_venue_name: 'A' },
      { link_id: '3', survivor_venue_id: 'y', deleted_venue_name: 'A' },
    ]);
    expect(ids).toEqual(['x', 'y']);
  });
});
