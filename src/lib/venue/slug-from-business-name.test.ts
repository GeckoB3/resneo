import { describe, expect, it } from 'vitest';
import { slugFromBusinessName, slugFromBusinessNameOrFallback } from '@/lib/venue/slug-from-business-name';

describe('slugFromBusinessName', () => {
  it('removes apostrophes without an extra hyphen', () => {
    expect(slugFromBusinessName("Andrew's Salon")).toBe('andrews-salon');
  });

  it('handles curly apostrophe', () => {
    expect(slugFromBusinessName('Andrew\u2019s Salon')).toBe('andrews-salon');
  });

  it('collapses punctuation and spaces', () => {
    expect(slugFromBusinessName("Joe's Hair & Beauty!")).toBe('joes-hair-beauty');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugFromBusinessName('  --ABC--  ')).toBe('abc');
  });

  it('returns empty when no slug characters remain', () => {
    expect(slugFromBusinessName('!!!')).toBe('');
  });
});

describe('slugFromBusinessNameOrFallback', () => {
  it('uses fallback when slug is empty', () => {
    expect(slugFromBusinessNameOrFallback('!!!', () => 'venue-123')).toBe('venue-123');
  });
});
