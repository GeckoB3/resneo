import { describe, expect, it } from 'vitest';
import { normaliseReferralCodeInput } from './lookup';

describe('normaliseReferralCodeInput', () => {
  it('uppercases and trims', () => {
    expect(normaliseReferralCodeInput('  greenway-x4f2  ')).toBe('GREENWAY-X4F2');
  });

  it('rejects empty / null / non-string', () => {
    expect(normaliseReferralCodeInput('')).toBe(null);
    expect(normaliseReferralCodeInput(null)).toBe(null);
    expect(normaliseReferralCodeInput(undefined)).toBe(null);
    expect(normaliseReferralCodeInput('   ')).toBe(null);
  });

  it('rejects strings with invalid characters', () => {
    expect(normaliseReferralCodeInput('hello world')).toBe(null);
    expect(normaliseReferralCodeInput('joe@business')).toBe(null);
    expect(normaliseReferralCodeInput('abc/def')).toBe(null);
  });

  it('rejects too-short and too-long', () => {
    expect(normaliseReferralCodeInput('AB')).toBe(null);
    expect(normaliseReferralCodeInput('A'.repeat(41))).toBe(null);
  });

  it('accepts hyphens and digits', () => {
    expect(normaliseReferralCodeInput('joes-shop-23')).toBe('JOES-SHOP-23');
  });
});
