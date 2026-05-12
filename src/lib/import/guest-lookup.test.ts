import { describe, expect, it } from 'vitest';
import { matchablePhone, phoneForMatching } from './guest-lookup';

describe('phoneForMatching', () => {
  it('returns null for nullish input', () => {
    expect(phoneForMatching(null)).toBeNull();
    expect(phoneForMatching(undefined)).toBeNull();
  });

  it('returns null when normalisation flagged a warning', () => {
    expect(phoneForMatching({ e164: '0123 nope', warning: true })).toBeNull();
  });

  it('returns the e164 value when normalisation succeeded', () => {
    expect(phoneForMatching({ e164: '+447700900123', warning: false })).toBe('+447700900123');
  });

  it('returns null when normalisation succeeded with empty value', () => {
    expect(phoneForMatching({ e164: null, warning: false })).toBeNull();
  });
});

describe('matchablePhone', () => {
  it('returns null for blank input', () => {
    expect(matchablePhone('')).toBeNull();
    expect(matchablePhone(null)).toBeNull();
  });

  it('returns null for unrecognisable input', () => {
    expect(matchablePhone('???')).toBeNull();
  });

  it('produces an E.164 string for normalisable UK numbers', () => {
    expect(matchablePhone('07700 900123')).toMatch(/^\+44/);
  });

  it('matches its own output (normalising twice is stable)', () => {
    const once = matchablePhone('07700 900123');
    expect(once).not.toBeNull();
    expect(matchablePhone(once)).toBe(once);
  });
});
