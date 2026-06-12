import { describe, it, expect } from 'vitest';
import { autoSplitCombinedNames } from '@/lib/import/auto-split-names';

const row = (source_column: string, target_field: string | null, action = 'map') => ({
  source_column,
  target_field,
  action,
  split_config: null as { separator?: string; parts?: Array<{ field: string }> } | null,
});

describe('autoSplitCombinedNames', () => {
  it('converts a full_name map into a first/last split', () => {
    const [out] = autoSplitCombinedNames([row('Client Name', 'full_name')]);
    expect(out.action).toBe('split');
    expect(out.target_field).toBeNull();
    expect(out.split_config?.parts).toEqual([{ field: 'first_name' }, { field: 'last_name' }]);
  });

  it('converts a guest_full_name map into a guest first/last split', () => {
    const [out] = autoSplitCombinedNames([row('Client Name', 'guest_full_name')]);
    expect(out.action).toBe('split');
    expect(out.split_config?.parts).toEqual([
      { field: 'guest_first_name' },
      { field: 'guest_last_name' },
    ]);
  });

  it('leaves the combined column alone when dedicated first/last columns exist', () => {
    const out = autoSplitCombinedNames([
      row('Full Name', 'full_name'),
      row('First', 'first_name'),
      row('Last', 'last_name'),
    ]);
    expect(out[0]!.action).toBe('map');
    expect(out[0]!.target_field).toBe('full_name');
  });

  it('still splits when only one half is separately mapped is NOT done (one column claimed blocks split)', () => {
    const out = autoSplitCombinedNames([row('Full Name', 'full_name'), row('First', 'first_name')]);
    // last_name is free but first_name is claimed → keep the combined map to avoid a clash.
    expect(out[0]!.action).toBe('map');
  });

  it('leaves non-name mappings untouched', () => {
    const out = autoSplitCombinedNames([row('Email', 'client_email'), row('Date', 'booking_date')]);
    expect(out.map((r) => r.action)).toEqual(['map', 'map']);
  });

  it('preserves an already-split mapping', () => {
    const split = {
      source_column: 'Name',
      target_field: null,
      action: 'split',
      split_config: { separator: ' ', parts: [{ field: 'first_name' }, { field: 'last_name' }] },
    };
    const [out] = autoSplitCombinedNames([split]);
    expect(out).toEqual(split);
  });
});
