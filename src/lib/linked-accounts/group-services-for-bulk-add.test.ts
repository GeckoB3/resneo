import { describe, expect, it } from 'vitest';
import { groupServicesForBulkAdd } from './group-services-for-bulk-add';

describe('groupServicesForBulkAdd', () => {
  it('keeps distinctly named services as separate offerings', () => {
    const groups = groupServicesForBulkAdd([
      { name: 'Massage', venueId: 'v1', sourceServiceId: 's1' },
      { name: 'Facial', venueId: 'v1', sourceServiceId: 's2' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ name: 'Massage', sources: [{ venueId: 'v1', sourceServiceId: 's1' }] });
    expect(groups[1]).toEqual({ name: 'Facial', sources: [{ venueId: 'v1', sourceServiceId: 's2' }] });
  });

  it('merges same-named services from different venues into one offering', () => {
    const groups = groupServicesForBulkAdd([
      { name: 'Massage', venueId: 'v1', sourceServiceId: 's1' },
      { name: 'Massage', venueId: 'v2', sourceServiceId: 's2' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      name: 'Massage',
      sources: [
        { venueId: 'v1', sourceServiceId: 's1' },
        { venueId: 'v2', sourceServiceId: 's2' },
      ],
    });
  });

  it('treats names as equal ignoring case and surrounding whitespace', () => {
    const groups = groupServicesForBulkAdd([
      { name: 'Deep Tissue', venueId: 'v1', sourceServiceId: 's1' },
      { name: '  deep tissue ', venueId: 'v2', sourceServiceId: 's2' },
    ]);
    expect(groups).toHaveLength(1);
    // The first-seen (trimmed) name wins as the display name.
    expect(groups[0].name).toBe('Deep Tissue');
    expect(groups[0].sources).toHaveLength(2);
  });

  it('drops entries whose name is blank after trimming', () => {
    const groups = groupServicesForBulkAdd([
      { name: '   ', venueId: 'v1', sourceServiceId: 's1' },
      { name: 'Facial', venueId: 'v1', sourceServiceId: 's2' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Facial');
  });

  it('returns an empty array for empty input', () => {
    expect(groupServicesForBulkAdd([])).toEqual([]);
  });
});
