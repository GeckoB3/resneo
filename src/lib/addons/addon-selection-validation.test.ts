import { describe, it, expect } from 'vitest';
import { validateAddonSelections, type AddonGroupForValidation } from './addon-selection-validation';
import type { Addon, AddonGroup } from '@/types/booking-models';

function group(partial: Partial<AddonGroup> = {}): AddonGroup {
  return {
    id: 'g-1',
    venue_id: 'venue-1',
    name: 'Conditioner',
    prompt_to_client: 'Pick a conditioner',
    description: null,
    selection_type: 'single',
    min_select: 1,
    max_select: 1,
    hidden_from_online: false,
    is_active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function addon(partial: Partial<Addon> & { id: string; addon_group_id: string }): Addon {
  return {
    venue_id: 'venue-1',
    name: 'Argan',
    description: null,
    additional_price_pence: 500,
    additional_duration_minutes: 0,
    cost_to_business_pence: null,
    is_active: true,
    sort_order: 0,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('validateAddonSelections', () => {
  it('passes when min/max obeyed in single-select group', () => {
    const g = group();
    const a = addon({ id: 'a-1', addon_group_id: 'g-1' });
    const groups: AddonGroupForValidation[] = [{ group: g, addons: [a] }];
    const res = validateAddonSelections({
      selections: [{ addon_id: 'a-1' }],
      groupsForService: groups,
      source: 'public',
    });
    expect(res.ok).toBe(true);
    expect(res.resolvedAddons).toHaveLength(1);
  });

  it('rejects unknown addon id', () => {
    const g = group();
    const a = addon({ id: 'a-1', addon_group_id: 'g-1' });
    const res = validateAddonSelections({
      selections: [{ addon_id: 'nope' }],
      groupsForService: [{ group: g, addons: [a] }],
      source: 'public',
    });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/Unknown/);
  });

  it('rejects when a required group is missing a selection', () => {
    const g = group();
    const a = addon({ id: 'a-1', addon_group_id: 'g-1' });
    const res = validateAddonSelections({
      selections: [],
      groupsForService: [{ group: g, addons: [a] }],
      source: 'public',
    });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/Conditioner/);
  });

  it('rejects two selections in a single-select group', () => {
    const g = group();
    const a = addon({ id: 'a-1', addon_group_id: 'g-1' });
    const b = addon({ id: 'a-2', addon_group_id: 'g-1' });
    const res = validateAddonSelections({
      selections: [{ addon_id: 'a-1' }, { addon_id: 'a-2' }],
      groupsForService: [{ group: g, addons: [a, b] }],
      source: 'public',
    });
    expect(res.ok).toBe(false);
  });

  it('enforces max_select in multi-select group', () => {
    const g = group({ selection_type: 'multi', min_select: 0, max_select: 1 });
    const a = addon({ id: 'a-1', addon_group_id: 'g-1' });
    const b = addon({ id: 'a-2', addon_group_id: 'g-1' });
    const res = validateAddonSelections({
      selections: [{ addon_id: 'a-1' }, { addon_id: 'a-2' }],
      groupsForService: [{ group: g, addons: [a, b] }],
      source: 'public',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects hidden-from-online groups in public source', () => {
    const g = group({ hidden_from_online: true });
    const a = addon({ id: 'a-1', addon_group_id: 'g-1' });
    const res = validateAddonSelections({
      selections: [{ addon_id: 'a-1' }],
      groupsForService: [{ group: g, addons: [a] }],
      source: 'public',
    });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/Unknown|unavailable/);
  });

  it('allows hidden-from-online groups in staff source', () => {
    const g = group({ hidden_from_online: true });
    const a = addon({ id: 'a-1', addon_group_id: 'g-1' });
    const res = validateAddonSelections({
      selections: [{ addon_id: 'a-1' }],
      groupsForService: [{ group: g, addons: [a] }],
      source: 'staff',
    });
    expect(res.ok).toBe(true);
  });

  it('rejects archived addons', () => {
    const g = group({ selection_type: 'multi', min_select: 0, max_select: null });
    const a = addon({ id: 'a-1', addon_group_id: 'g-1', archived_at: '2026-01-01T00:00:00Z' });
    const res = validateAddonSelections({
      selections: [{ addon_id: 'a-1' }],
      groupsForService: [{ group: g, addons: [a] }],
      source: 'public',
    });
    expect(res.ok).toBe(false);
  });

  it('returns canonical order by group sort then addon sort', () => {
    const g1 = group({ id: 'g-1', sort_order: 0, selection_type: 'multi', min_select: 0, max_select: null });
    const g2 = group({ id: 'g-2', sort_order: 1, selection_type: 'multi', min_select: 0, max_select: null, name: 'Other' });
    const a1 = addon({ id: 'a-1', addon_group_id: 'g-1', sort_order: 1 });
    const a2 = addon({ id: 'a-2', addon_group_id: 'g-1', sort_order: 0 });
    const a3 = addon({ id: 'a-3', addon_group_id: 'g-2' });
    const res = validateAddonSelections({
      selections: [{ addon_id: 'a-3' }, { addon_id: 'a-1' }, { addon_id: 'a-2' }],
      groupsForService: [
        { group: g1, addons: [a1, a2] },
        { group: g2, addons: [a3] },
      ],
      source: 'public',
    });
    expect(res.ok).toBe(true);
    expect(res.resolvedAddons.map((a) => a.id)).toEqual(['a-2', 'a-1', 'a-3']);
  });
});
