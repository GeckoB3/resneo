import { describe, expect, it } from 'vitest';
import {
  compareByCategoryThenServiceOrder,
  groupServicesByCategory,
  hasServiceCategories,
  serviceCategoryDomId,
  serviceMatchesSearch,
  UNCATEGORISED_GROUP_LABEL,
  type ServiceCategoryRef,
} from './service-categories';

const hair: ServiceCategoryRef = { id: 'c-hair', name: 'Hair', sort_order: 0 };
const nails: ServiceCategoryRef = { id: 'c-nails', name: 'Nails', sort_order: 1 };

const svc = (
  id: string,
  name: string,
  sort_order: number,
  category: ServiceCategoryRef | null = null,
  description: string | null = null,
) => ({ id, name, sort_order, category, description });

describe('compareByCategoryThenServiceOrder', () => {
  it('orders by category position, then the venue drag order, then name', () => {
    const list = [
      svc('4', 'Manicure', 0, nails),
      svc('2', 'Blow dry', 1, hair),
      svc('1', 'Cut', 0, hair),
      svc('3', 'Colour', 1, hair),
    ];
    expect(list.sort(compareByCategoryThenServiceOrder).map((s) => s.id)).toEqual(['1', '2', '3', '4']);
  });

  it('puts uncategorised services after every category', () => {
    const list = [svc('1', 'Aftercare kit', 0), svc('2', 'Manicure', 5, nails)];
    expect(list.sort(compareByCategoryThenServiceOrder).map((s) => s.id)).toEqual(['2', '1']);
  });

  it('is exactly the old venue order when nothing is categorised', () => {
    const list = [svc('b', 'Beta', 0), svc('a', 'Alpha', 0), svc('z', 'Zed', 1)];
    expect(list.sort(compareByCategoryThenServiceOrder).map((s) => s.id)).toEqual(['a', 'b', 'z']);
  });
});

describe('groupServicesByCategory', () => {
  it('returns one unnamed group when no service has a category', () => {
    const groups = groupServicesByCategory([svc('1', 'Cut', 0), svc('2', 'Colour', 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBeNull();
    expect(groups[0]!.name).toBe('');
    expect(groups[0]!.services.map((s) => s.id)).toEqual(['1', '2']);
    expect(hasServiceCategories(groups[0]!.services)).toBe(false);
  });

  it('groups in category order and collects the rest under Other services, last', () => {
    const groups = groupServicesByCategory([
      svc('kit', 'Aftercare kit', 0),
      svc('mani', 'Manicure', 0, nails),
      svc('cut', 'Cut', 0, hair),
      svc('colour', 'Colour', 1, hair),
    ]);
    expect(groups.map((g) => [g.id, g.name, g.services.map((s) => s.id)])).toEqual([
      ['c-hair', 'Hair', ['cut', 'colour']],
      ['c-nails', 'Nails', ['mani']],
      [null, UNCATEGORISED_GROUP_LABEL, ['kit']],
    ]);
  });

  it('does not mutate the input', () => {
    const input = [svc('2', 'B', 1, hair), svc('1', 'A', 0, hair)];
    groupServicesByCategory(input);
    expect(input.map((s) => s.id)).toEqual(['2', '1']);
  });
});

describe('serviceMatchesSearch', () => {
  const gel = svc('g', 'Gel polish', 0, nails, 'Long lasting colour');

  it('matches every word across name, description and category', () => {
    expect(serviceMatchesSearch(gel, 'gel')).toBe(true);
    expect(serviceMatchesSearch(gel, 'gel nails')).toBe(true);
    expect(serviceMatchesSearch(gel, 'lasting polish')).toBe(true);
    expect(serviceMatchesSearch(gel, 'gel pedicure')).toBe(false);
  });

  it('ignores case, accents and extra spaces', () => {
    expect(serviceMatchesSearch(svc('b', 'Balayage Déluxe', 0), '  déluxe  ')).toBe(true);
    expect(serviceMatchesSearch(svc('b', 'Balayage Déluxe', 0), 'DELUXE')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(serviceMatchesSearch(gel, '')).toBe(true);
    expect(serviceMatchesSearch(gel, '   ')).toBe(true);
  });
});

describe('serviceCategoryDomId', () => {
  it('is stable and distinguishes the uncategorised group', () => {
    expect(serviceCategoryDomId('svc', 'abc')).toBe('svc-cat-abc');
    expect(serviceCategoryDomId('svc', null)).toBe('svc-cat-other');
  });
});
