import { describe, expect, it } from 'vitest';
import { isAccountLinkedPublicMode, mergeVenueAuthoritativeField } from '@/lib/guests/guest-matching-rules';

describe('mergeVenueAuthoritativeField', () => {
  it('keeps existing non-empty value', () => {
    expect(mergeVenueAuthoritativeField('Venue Name', 'Booking Name')).toBe('Venue Name');
  });

  it('fills from incoming when existing empty', () => {
    expect(mergeVenueAuthoritativeField(null, 'Booking Name')).toBe('Booking Name');
    expect(mergeVenueAuthoritativeField('   ', 'Booking Name')).toBe('Booking Name');
  });

  it('returns null when both empty', () => {
    expect(mergeVenueAuthoritativeField(null, null)).toBeNull();
    expect(mergeVenueAuthoritativeField('', '  ')).toBeNull();
  });
});

describe('isAccountLinkedPublicMode', () => {
  it('is true only when silent signup and email present', () => {
    expect(isAccountLinkedPublicMode(true, 'a@b.com')).toBe(true);
    expect(isAccountLinkedPublicMode(true, null)).toBe(false);
    expect(isAccountLinkedPublicMode(true, '  ')).toBe(false);
    expect(isAccountLinkedPublicMode(false, 'a@b.com')).toBe(false);
  });
});
