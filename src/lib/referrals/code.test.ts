import { describe, expect, it } from 'vitest';
import {
  buildCandidateReferralCode,
  randomReferralSuffix,
  slugifyForReferralCode,
} from './code';

describe('slugifyForReferralCode', () => {
  it('uppercases and strips non-alphanumeric chars', () => {
    expect(slugifyForReferralCode("Joe's Hair & Beauty!")).toBe('JOE-S-HAIR-BEAUTY');
  });

  it('falls back to VENUE when input is empty', () => {
    expect(slugifyForReferralCode('')).toBe('VENUE');
    expect(slugifyForReferralCode(null)).toBe('VENUE');
    expect(slugifyForReferralCode(undefined)).toBe('VENUE');
    expect(slugifyForReferralCode('   ')).toBe('VENUE');
    expect(slugifyForReferralCode('!!!')).toBe('VENUE');
  });

  it('truncates to 20 chars and trims trailing hyphen', () => {
    const long = 'A very very long venue name that should be cut down';
    const out = slugifyForReferralCode(long);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('-')).toBe(false);
    expect(out.startsWith('A-VERY-VERY')).toBe(true);
  });

  it('strips trailing/leading hyphens', () => {
    expect(slugifyForReferralCode('--ABC--')).toBe('ABC');
  });
});

describe('randomReferralSuffix', () => {
  it('returns 4 chars from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const s = randomReferralSuffix();
      expect(s).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });
});

describe('buildCandidateReferralCode', () => {
  it('joins slug and suffix with a hyphen', () => {
    const code = buildCandidateReferralCode('Greenway');
    expect(code).toMatch(/^GREENWAY-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  });
});
