import { describe, expect, it } from 'vitest';
import { candidateVenueSlugs, firstAvailableVenueSlug } from './unique-venue-slug';

describe('candidateVenueSlugs', () => {
  it('tries the base, then directly-appended numbered suffixes (no separator)', () => {
    const candidates = candidateVenueSlugs('my-business', 4);
    expect(candidates).toEqual(['my-business', 'my-business2', 'my-business3', 'my-business4']);
  });

  it('numbers single-word names the same way', () => {
    const candidates = candidateVenueSlugs('salon', 3);
    expect(candidates).toEqual(['salon', 'salon2', 'salon3']);
  });

  it('returns nothing for an empty slug', () => {
    expect(candidateVenueSlugs('')).toEqual([]);
  });
});

describe('firstAvailableVenueSlug', () => {
  it('keeps the preferred slug when it is free', () => {
    expect(firstAvailableVenueSlug('my-business', () => false)).toBe('my-business');
  });

  it('gives a duplicate name the fewest-digit suffix (my-business2)', () => {
    const taken = new Set(['my-business']);
    expect(firstAvailableVenueSlug('my-business', (s) => taken.has(s))).toBe('my-business2');
  });

  it('uses the first numbered suffix for a taken single-word name', () => {
    const taken = new Set(['salon']);
    expect(firstAvailableVenueSlug('salon', (s) => taken.has(s))).toBe('salon2');
  });

  it('skips consecutively taken numbered suffixes', () => {
    const taken = new Set(['salon', 'salon2', 'salon3']);
    expect(firstAvailableVenueSlug('salon', (s) => taken.has(s))).toBe('salon4');
  });

  it('grows to two digits only when needed', () => {
    const taken = new Set(['salon']);
    for (let n = 2; n <= 9; n += 1) taken.add(`salon${n}`);
    expect(firstAvailableVenueSlug('salon', (s) => taken.has(s))).toBe('salon10');
  });

  it('returns null when every candidate up to the cap is taken', () => {
    const taken = new Set(candidateVenueSlugs('salon', 5));
    expect(firstAvailableVenueSlug('salon', (s) => taken.has(s), 5)).toBeNull();
  });
});
