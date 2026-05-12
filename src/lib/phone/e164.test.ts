import { describe, expect, it } from 'vitest';
import {
  normalizeToE164,
  parseStoredPhoneForUi,
  composeNationalAndCountry,
  normalizeToE164Lenient,
  formatPhoneForDisplay,
} from './e164';

describe('normalizeToE164', () => {
  it('normalises UK national mobile with GB default', () => {
    expect(normalizeToE164('07725002232', 'GB')).toBe('+447725002232');
    expect(normalizeToE164('7725002232', 'GB')).toBe('+447725002232');
  });

  it('passes through valid E.164', () => {
    expect(normalizeToE164('+447725002232', 'GB')).toBe('+447725002232');
  });

  it('normalises IE number with IE default', () => {
    expect(normalizeToE164('0871234567', 'IE')).toMatch(/^\+353/);
  });

  it('returns null for empty or invalid', () => {
    expect(normalizeToE164('', 'GB')).toBeNull();
    expect(normalizeToE164('   ', 'GB')).toBeNull();
    expect(normalizeToE164('12', 'GB')).toBeNull();
  });
});

describe('parseStoredPhoneForUi', () => {
  it('parses E.164 to GB + national', () => {
    const p = parseStoredPhoneForUi('+447725002232');
    expect(p.countryCode).toBe('GB');
    expect(p.nationalNumber).toBe('7725002232');
  });

  it('returns empty national for null', () => {
    const p = parseStoredPhoneForUi(null);
    expect(p.countryCode).toBe('GB');
    expect(p.nationalNumber).toBe('');
  });
});

describe('composeNationalAndCountry', () => {
  it('builds international string for parser', () => {
    expect(composeNationalAndCountry('7725002232', 'GB')).toBe('+447725002232');
  });
});

describe('normalizeToE164Lenient', () => {
  it('matches strict when valid', () => {
    expect(normalizeToE164Lenient('07725002232', 'GB')).toBe('+447725002232');
  });
});

describe('formatPhoneForDisplay', () => {
  it('returns null for empty input', () => {
    expect(formatPhoneForDisplay(null)).toBeNull();
    expect(formatPhoneForDisplay('')).toBeNull();
  });

  it('formats valid E.164 as national', () => {
    const s = formatPhoneForDisplay('+447725002232');
    expect(s).toBeTruthy();
    expect(s).toContain('7725');
  });
});
