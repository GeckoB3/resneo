import { describe, expect, it } from 'vitest';
import { disambiguateHeaders } from './parse-storage-csv';

describe('disambiguateHeaders', () => {
  it('keeps unique headers untouched', () => {
    const { unique, duplicates } = disambiguateHeaders(['Email', 'Phone', 'First Name']);
    expect(unique).toEqual(['Email', 'Phone', 'First Name']);
    expect(duplicates).toEqual([]);
  });

  it('suffixes the second occurrence of a duplicate header so neither is overwritten', () => {
    const { unique, duplicates } = disambiguateHeaders(['Notes', 'Email', 'Notes']);
    expect(unique).toEqual(['Notes', 'Email', 'Notes_2']);
    expect(duplicates).toEqual(['Notes']);
  });

  it('numbers a triple-occurring duplicate as _2 and _3', () => {
    const { unique, duplicates } = disambiguateHeaders(['Tag', 'Tag', 'Tag']);
    expect(unique).toEqual(['Tag', 'Tag_2', 'Tag_3']);
    expect(duplicates).toEqual(['Tag']);
  });

  it('trims whitespace before comparing', () => {
    const { unique, duplicates } = disambiguateHeaders(['  Notes  ', 'Notes']);
    expect(unique).toEqual(['Notes', 'Notes_2']);
    expect(duplicates).toEqual(['Notes']);
  });

  it('skips suffixing for empty headers', () => {
    const { unique, duplicates } = disambiguateHeaders(['', '', 'Email']);
    expect(unique).toEqual(['', '', 'Email']);
    expect(duplicates).toEqual([]);
  });
});
