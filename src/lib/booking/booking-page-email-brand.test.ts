import { describe, expect, it } from 'vitest';
import {
  bookingPageEmailBrandColour,
  contrastRatio,
  mergeBookingPageConfigPatch,
  sanitizeBookingPageConfig,
} from './booking-page-theme';

describe('brand_emails config flag', () => {
  it('sanitises to true only when explicitly true', () => {
    expect(sanitizeBookingPageConfig({ brand_emails: true }).brand_emails).toBe(true);
    expect(sanitizeBookingPageConfig({ brand_emails: 'yes' })).not.toHaveProperty('brand_emails');
    expect(sanitizeBookingPageConfig({ brand_emails: false })).not.toHaveProperty('brand_emails');
  });

  it('merges: true sets, false removes, absent keeps', () => {
    const on = mergeBookingPageConfigPatch({ brand_primary: '#123456' }, { brand_emails: true });
    expect(on.brand_emails).toBe(true);

    const off = mergeBookingPageConfigPatch(
      { brand_primary: '#123456', brand_emails: true },
      { brand_emails: false },
    );
    expect(off).not.toHaveProperty('brand_emails');

    const kept = mergeBookingPageConfigPatch(
      { brand_primary: '#123456', brand_emails: true },
      { about: 'hello' },
    );
    expect(kept.brand_emails).toBe(true);
  });
});

describe('bookingPageEmailBrandColour', () => {
  it('is null unless the switch is on and a valid primary is set', () => {
    expect(bookingPageEmailBrandColour(null)).toBeNull();
    expect(bookingPageEmailBrandColour(undefined)).toBeNull();
    expect(bookingPageEmailBrandColour('garbage')).toBeNull();
    expect(bookingPageEmailBrandColour({})).toBeNull();
    expect(bookingPageEmailBrandColour({ brand_primary: '#7c3aed' })).toBeNull();
    expect(bookingPageEmailBrandColour({ brand_emails: true })).toBeNull();
    expect(bookingPageEmailBrandColour({ brand_emails: true, brand_primary: 'not a colour' })).toBeNull();
    expect(bookingPageEmailBrandColour({ brand_emails: 'true', brand_primary: '#7c3aed' })).toBeNull();
  });

  it('returns a dark primary unchanged, normalised to lowercase', () => {
    expect(bookingPageEmailBrandColour({ brand_emails: true, brand_primary: '#7C3AED' })).toBe('#7c3aed');
  });

  it('darkens a light primary until white button text is readable', () => {
    const out = bookingPageEmailBrandColour({ brand_emails: true, brand_primary: '#fde68a' });
    expect(out).not.toBeNull();
    expect(out).not.toBe('#fde68a');
    expect(contrastRatio(out!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
