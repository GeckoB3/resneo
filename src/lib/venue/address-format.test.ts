import { describe, expect, it } from 'vitest';
import { buildAddress, parseAddress } from './address-format';

/**
 * `venues.address` is one comma-joined string; the onboarding step and the venue profile
 * split it back into name / street / town / postcode. The two must round-trip, and in
 * particular an address saved WITHOUT a building name must reload with its street in the
 * Street field, which it did not until 2026-09-02 (the street came back as the name).
 */

describe('buildAddress', () => {
  it('joins the non-empty parts in order', () => {
    expect(buildAddress({ name: 'The Old Mill', street: '12 Main Street', town: 'Belfast', postcode: 'BT1 1AA' })).toBe(
      'The Old Mill, 12 Main Street, Belfast, BT1 1AA',
    );
    expect(buildAddress({ name: '  ', street: '12 Main Street', town: 'Belfast', postcode: 'BT1 1AA' })).toBe(
      '12 Main Street, Belfast, BT1 1AA',
    );
  });
});

describe('parseAddress', () => {
  it('round-trips an address with a building name', () => {
    const fields = { name: 'The Old Mill', street: '12 Main Street', town: 'Belfast', postcode: 'BT1 1AA' };
    expect(parseAddress(buildAddress(fields))).toEqual(fields);
  });

  it('round-trips an address without a building name, keeping the street as the street', () => {
    const fields = { name: '', street: '12 Main Street', town: 'Belfast', postcode: 'BT1 1AA' };
    expect(parseAddress(buildAddress(fields))).toEqual(fields);
  });

  it('keeps a street with its own comma together', () => {
    expect(parseAddress('The Old Mill, Unit 4, 12 Main Street, Belfast, BT1 1AA')).toEqual({
      name: 'The Old Mill',
      street: 'Unit 4, 12 Main Street',
      town: 'Belfast',
      postcode: 'BT1 1AA',
    });
  });

  it('copes with a postcode written without a space, and with lower case', () => {
    expect(parseAddress('12 Main Street, Belfast, bt11aa')).toEqual({ name: '', street: '12 Main Street', town: 'Belfast', postcode: 'bt11aa' });
  });

  it('falls back sensibly when there is no recognisable postcode', () => {
    expect(parseAddress('12 Main Street, Belfast')).toEqual({ name: '', street: '12 Main Street', town: 'Belfast', postcode: '' });
    expect(parseAddress('12 Main Street')).toEqual({ name: '', street: '12 Main Street', town: '', postcode: '' });
    expect(parseAddress(null)).toEqual({ name: '', street: '', town: '', postcode: '' });
  });
});
