import { describe, expect, it } from 'vitest';
import { applyMappingsToDataRow, type DbMappingRow } from './apply-mappings';

function map(
  source_column: string,
  target_field: string | null,
  overrides: Partial<DbMappingRow> = {},
): DbMappingRow {
  return {
    id: source_column,
    source_column,
    target_field,
    action: target_field ? 'map' : 'ignore',
    custom_field_name: null,
    custom_field_type: null,
    split_config: null,
    ...overrides,
  };
}

describe('applyMappingsToDataRow full-name fallback', () => {
  it('splits a full name when first/last are not mapped', () => {
    const { targets } = applyMappingsToDataRow(
      { 'Full Name': 'Sarah Jane Smith' },
      [map('Full Name', 'full_name')],
    );
    expect(targets.first_name).toBe('Sarah');
    expect(targets.last_name).toBe('Jane Smith');
  });

  it('does not overwrite an explicitly mapped first/last name', () => {
    const { targets } = applyMappingsToDataRow(
      { 'Full Name': 'Pete L Smith', First: 'Pete', Last: 'Smith' },
      [
        map('Full Name', 'full_name'),
        map('First', 'first_name'),
        map('Last', 'last_name'),
      ],
    );
    expect(targets.first_name).toBe('Pete');
    expect(targets.last_name).toBe('Smith');
  });

  it('only fills the missing half when one of first/last is mapped', () => {
    const { targets } = applyMappingsToDataRow(
      { 'Full Name': 'Sarah Smith', First: 'Sarah' },
      [map('Full Name', 'full_name'), map('First', 'first_name')],
    );
    expect(targets.first_name).toBe('Sarah');
    expect(targets.last_name).toBe('Smith');
  });

  it('handles comma-separated full names', () => {
    const { targets } = applyMappingsToDataRow(
      { 'Full Name': 'Smith, Mary' },
      [map('Full Name', 'full_name')],
    );
    expect(targets.first_name).toBe('Mary');
    expect(targets.last_name).toBe('Smith');
  });
});
