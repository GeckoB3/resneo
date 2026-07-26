import { describe, it, expect } from 'vitest';
import { parseVenueAddressForLocation } from './terminal-location';

/**
 * Stripe rejects a GB Terminal Location without `address[city]`, and the Location
 * is provisioned lazily on the first connection-token request — so a missing city
 * failed every token and disabled in-person payments entirely. `city` must
 * therefore be non-empty for ANY input, including none at all.
 */
describe('parseVenueAddressForLocation', () => {
  it('splits a full UK address into line1, city and postcode', () => {
    expect(parseVenueAddressForLocation('12 High Street, Belfast, BT1 5GS')).toEqual({
      line1: '12 High Street',
      city: 'Belfast',
      postal_code: 'BT1 5GS',
    });
  });

  it('keeps multi-part streets in line1', () => {
    expect(parseVenueAddressForLocation('Unit 4, Ormeau Business Park, Belfast, BT7 2JA')).toEqual({
      line1: 'Unit 4, Ormeau Business Park',
      city: 'Belfast',
      postal_code: 'BT7 2JA',
    });
  });

  it('works without a postcode', () => {
    expect(parseVenueAddressForLocation('12 High Street, Belfast')).toEqual({
      line1: '12 High Street',
      city: 'Belfast',
    });
  });

  it('treats a single segment as the street, not the city', () => {
    // "Belfast" alone is more useful as line1; inventing it as the city would be
    // a guess, and Unknown is honest.
    expect(parseVenueAddressForLocation('Belfast')).toEqual({
      line1: 'Belfast',
      city: 'Unknown',
    });
  });

  it('still produces a usable city when the venue has no address at all', () => {
    // This is the case that must never throw: Stripe 400s on an empty city and
    // that would block every payment for the venue.
    for (const input of [null, undefined, '', '   ', ',,']) {
      expect(parseVenueAddressForLocation(input)).toEqual({
        line1: 'Unknown',
        city: 'Unknown',
      });
    }
  });

  it('handles an address that is only a postcode', () => {
    expect(parseVenueAddressForLocation('BT1 5GS')).toEqual({
      line1: 'Unknown',
      city: 'Unknown',
      postal_code: 'BT1 5GS',
    });
  });

  it('accepts postcodes with and without the internal space', () => {
    expect(parseVenueAddressForLocation('1 A Road, Derry, BT481AB').postal_code).toBe('BT481AB');
    expect(parseVenueAddressForLocation('1 A Road, Derry, ec1a 1bb').postal_code).toBe('ec1a 1bb');
  });

  it('does not mistake a trailing non-postcode segment for a postcode', () => {
    const out = parseVenueAddressForLocation('12 High Street, Belfast, County Antrim');
    expect(out.postal_code).toBeUndefined();
    expect(out.city).toBe('County Antrim');
  });

  it('clamps oversized values to the Stripe field limits', () => {
    const long = 'x'.repeat(300);
    const out = parseVenueAddressForLocation(`${long}, ${long}`);
    expect(out.line1).toHaveLength(200);
    expect(out.city).toHaveLength(100);
  });
});
