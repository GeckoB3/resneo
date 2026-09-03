import { describe, expect, it } from 'vitest';
import {
  cleanCategoryName,
  compareCombinedCatalogueItems,
  normaliseCategoryName,
  pickInheritedCategoryName,
  type CombinedCatalogueSortKey,
} from './collective-categories';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

const HOST = 'venue-host';
const MEMBER = 'venue-member';

describe('category name normalisation', () => {
  it('matches the database unique index: trimmed, single-spaced, case-folded', () => {
    expect(normaliseCategoryName('  Hair   &  Beauty ')).toBe('hair & beauty');
    expect(cleanCategoryName('  Hair   &  Beauty ')).toBe('Hair & Beauty');
  });
});

describe('pickInheritedCategoryName', () => {
  it('prefers the host venue\'s category over a member\'s', () => {
    expect(
      pickInheritedCategoryName(
        [
          { venueId: MEMBER, categoryName: 'Nails' },
          { venueId: HOST, categoryName: 'Manicures' },
        ],
        HOST,
      ),
    ).toBe('Manicures');
  });

  it('falls back to the first categorised source when the host has none', () => {
    expect(
      pickInheritedCategoryName(
        [
          { venueId: HOST, categoryName: null },
          { venueId: MEMBER, categoryName: '  Nails ' },
        ],
        HOST,
      ),
    ).toBe('Nails');
  });

  it('is null when no source is categorised', () => {
    expect(pickInheritedCategoryName([{ venueId: HOST, categoryName: null }], HOST)).toBeNull();
    expect(pickInheritedCategoryName([], HOST)).toBeNull();
  });
});

describe('compareCombinedCatalogueItems', () => {
  const hair: ServiceCategoryRef = { id: 'c1', name: 'Hair', sort_order: 0 };
  const nails: ServiceCategoryRef = { id: 'c2', name: 'Nails', sort_order: 1 };
  const key = (
    name: string,
    category: ServiceCategoryRef | null,
    displayOrder = 0,
    sourceOrder = 0,
  ): CombinedCatalogueSortKey => ({ name, category, displayOrder, sourceOrder });

  it('keeps the historical order when nothing is categorised', () => {
    const items = [key('Zed', null, 1, 0), key('Beta', null, 0, 2), key('Alpha', null, 0, 2), key('Gamma', null, 0, 1)];
    expect(items.sort(compareCombinedCatalogueItems).map((i) => i.name)).toEqual(['Gamma', 'Alpha', 'Beta', 'Zed']);
  });

  it('orders by heading first, then the host order inside each, with uncategorised last', () => {
    const items = [
      key('Aftercare kit', null, 0, 0),
      key('Manicure', nails, 0, 0),
      key('Colour', hair, 1, 0),
      key('Cut', hair, 0, 5),
    ];
    expect(items.sort(compareCombinedCatalogueItems).map((i) => i.name)).toEqual([
      'Cut',
      'Colour',
      'Manicure',
      'Aftercare kit',
    ]);
  });
});
