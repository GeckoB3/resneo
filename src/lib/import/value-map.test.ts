import { describe, expect, it } from 'vitest';
import {
  applyValueMap,
  canonicalValuesForTarget,
  isCanonicalValueFor,
  isValueMapTarget,
  sanitiseValueMap,
} from '@/lib/import/value-map';
import { applyMappingsToDataRow, type DbMappingRow } from '@/lib/import/apply-mappings';

describe('value-map registry', () => {
  it('recognises enum targets and exposes their canonical vocabulary', () => {
    expect(isValueMapTarget('status')).toBe(true);
    expect(isValueMapTarget('deposit_status')).toBe(true);
    expect(isValueMapTarget('first_name')).toBe(false);
    expect(isValueMapTarget(null)).toBe(false);
    expect(canonicalValuesForTarget('status')).toContain('Cancelled');
    expect(canonicalValuesForTarget('status')).toContain('No-Show');
    expect(canonicalValuesForTarget('first_name')).toEqual([]);
  });

  it('validates canonical values per target', () => {
    expect(isCanonicalValueFor('status', 'Cancelled')).toBe(true);
    expect(isCanonicalValueFor('status', 'Nope')).toBe(false);
    expect(isCanonicalValueFor('deposit_status', 'Refunded')).toBe(true);
  });
});

describe('applyValueMap', () => {
  const vm = { CXL: 'Cancelled', NS: 'No-Show' };

  it('translates exact and case-insensitive raw values', () => {
    expect(applyValueMap('CXL', vm)).toBe('Cancelled');
    expect(applyValueMap('cxl', vm)).toBe('Cancelled');
    expect(applyValueMap('  NS ', vm)).toBe('No-Show');
  });

  it('passes through unmapped values and empty maps', () => {
    expect(applyValueMap('Booked', vm)).toBe('Booked');
    expect(applyValueMap('anything', null)).toBe('anything');
    expect(applyValueMap('', vm)).toBe('');
  });
});

describe('sanitiseValueMap', () => {
  it('keeps only valid canonical entries and drops blanks', () => {
    const out = sanitiseValueMap('status', [
      { from: 'CXL', to: 'Cancelled' },
      { from: 'NS', to: 'No-Show' },
      { from: 'XX', to: 'NotACanonical' }, // dropped: invalid canonical
      { from: '', to: 'Booked' }, // dropped: blank key
    ]);
    expect(out).toEqual({ CXL: 'Cancelled', NS: 'No-Show' });
  });

  it('returns null for non-enum targets or empty input', () => {
    expect(sanitiseValueMap('first_name', [{ from: 'a', to: 'b' }])).toBeNull();
    expect(sanitiseValueMap('status', [])).toBeNull();
    expect(sanitiseValueMap('status', [{ from: 'X', to: 'bad' }])).toBeNull();
  });

  it('de-dupes keys case-insensitively (last wins)', () => {
    const out = sanitiseValueMap('status', [
      { from: 'cxl', to: 'Cancelled' },
      { from: 'CXL', to: 'Completed' },
    ]);
    expect(out).toEqual({ CXL: 'Completed' });
  });
});

describe('applyMappingsToDataRow with value_map', () => {
  function mapping(over: Partial<DbMappingRow>): DbMappingRow {
    return {
      id: 'm1',
      source_column: 'Status',
      target_field: 'status',
      action: 'map',
      custom_field_name: null,
      custom_field_type: null,
      split_config: null,
      value_map: null,
      ...over,
    };
  }

  it('translates a mapped enum column via its value_map', () => {
    const m = mapping({ value_map: { CXL: 'Cancelled', NS: 'No-Show' } });
    expect(applyMappingsToDataRow({ Status: 'CXL' }, [m]).targets.status).toBe('Cancelled');
    expect(applyMappingsToDataRow({ Status: 'ns' }, [m]).targets.status).toBe('No-Show');
    // Unmapped value falls through unchanged (the downstream normaliser handles it).
    expect(applyMappingsToDataRow({ Status: 'Booked' }, [m]).targets.status).toBe('Booked');
  });

  it('leaves the value unchanged when there is no value_map', () => {
    const m = mapping({ value_map: null });
    expect(applyMappingsToDataRow({ Status: 'CXL' }, [m]).targets.status).toBe('CXL');
  });
});
