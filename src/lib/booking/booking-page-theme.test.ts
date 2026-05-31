import { describe, expect, it } from 'vitest';
import {
  bookingPageThemeVars,
  buildBrandRamp,
  contrastRatio,
  normalizeHexColor,
  primaryNeedsDarkText,
  readableTextColor,
  sanitizeBookingPageConfig,
} from './booking-page-theme';

describe('normalizeHexColor', () => {
  it('accepts 6-digit hex with or without #', () => {
    expect(normalizeHexColor('#A1B2C3')).toBe('#a1b2c3');
    expect(normalizeHexColor('a1b2c3')).toBe('#a1b2c3');
  });
  it('rejects invalid / empty values', () => {
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor('#fff')).toBeNull();
    expect(normalizeHexColor('not-a-colour')).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });
});

describe('buildBrandRamp', () => {
  it('anchors 600 to the chosen colour', () => {
    expect(buildBrandRamp('#003b6f')[600]).toBe('#003b6f');
  });
  it('produces a monotonic light→dark ramp', () => {
    const ramp = buildBrandRamp('#003b6f');
    const lum = (hex: string) => {
      const h = hex.replace('#', '');
      return parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16);
    };
    const stops = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
    for (let i = 1; i < stops.length; i++) {
      // Each darker stop should be no lighter than the previous.
      expect(lum(ramp[stops[i]!])).toBeLessThanOrEqual(lum(ramp[stops[i - 1]!]));
    }
    expect(lum(ramp[50])).toBeGreaterThan(lum(ramp[900]));
  });
});

describe('contrast helpers', () => {
  it('picks white text on a dark brand and dark text on a light brand', () => {
    expect(readableTextColor('#003b6f')).toBe('#ffffff');
    expect(readableTextColor('#fde68a')).toBe('#0f172a');
  });
  it('flags light primaries that fail white-text contrast', () => {
    expect(primaryNeedsDarkText('#fde68a')).toBe(true); // pale yellow
    expect(primaryNeedsDarkText('#003b6f')).toBe(false); // navy
  });
  it('reports a high contrast ratio for navy vs white', () => {
    expect(contrastRatio('#003b6f', '#ffffff')).toBeGreaterThan(7);
  });
});

describe('bookingPageThemeVars', () => {
  it('returns no overrides when no primary is set (keeps default theme)', () => {
    expect(bookingPageThemeVars(null)).toEqual({});
    expect(bookingPageThemeVars({ about: 'hi' })).toEqual({});
    expect(bookingPageThemeVars({ brand_primary: 'bad' })).toEqual({});
  });
  it('emits brand CSS variables for a valid primary', () => {
    const vars = bookingPageThemeVars({ brand_primary: '#7c3aed' });
    expect(vars['--brand-600']).toBe('#7c3aed');
    expect(vars['--brand']).toBe('#7c3aed');
    // The appointment flow themes from --accent → must follow the brand primary.
    expect(vars['--accent']).toBe('#7c3aed');
    expect(vars['--brand-50']).toBeDefined();
    expect(vars['--brand-900']).toBeDefined();
    // No accent vars unless an accent is provided.
    expect(vars['--accent-500']).toBeUndefined();
  });
  it('emits accent variables when an accent is provided', () => {
    const vars = bookingPageThemeVars({ brand_primary: '#7c3aed', brand_accent: '#10b981' });
    expect(vars['--brand-accent']).toBe('#10b981');
    expect(vars['--accent-600']).toBe('#10b981');
  });
});

describe('sanitizeBookingPageConfig', () => {
  it('keeps valid colours, font preset, and trims copy', () => {
    const out = sanitizeBookingPageConfig({
      brand_primary: '7C3AED',
      brand_accent: '#10b981',
      font_preset: 'elegant',
      about: '  Welcome  ',
      announcement: ' Closed Monday ',
      social_links: { instagram: ' https://insta/x ', bogus: 'drop-me' },
    });
    expect(out.brand_primary).toBe('#7c3aed');
    expect(out.brand_accent).toBe('#10b981');
    expect(out.font_preset).toBe('elegant');
    expect(out.about).toBe('Welcome');
    expect(out.announcement).toBe('Closed Monday');
    expect(out.social_links).toEqual({ instagram: 'https://insta/x' });
  });

  it('keeps only valid http(s) gallery URLs, de-duped and capped', () => {
    const out = sanitizeBookingPageConfig({
      gallery: ['https://cdn/x.jpg', 'https://cdn/x.jpg', 'not-a-url', '  https://cdn/y.png  ', 42],
    });
    expect(out.gallery).toEqual(['https://cdn/x.jpg', 'https://cdn/y.png']);
  });

  it('drops invalid colours, unknown/default font presets, and empty fields', () => {
    const out = sanitizeBookingPageConfig({
      brand_primary: 'not-a-colour',
      font_preset: 'comic-sans',
      about: '   ',
      social_links: {},
    });
    expect(out.brand_primary).toBeUndefined();
    expect(out.font_preset).toBeUndefined();
    expect(out.about).toBeUndefined();
    expect(out.social_links).toBeUndefined();
    expect(sanitizeBookingPageConfig({ font_preset: 'default' }).font_preset).toBeUndefined();
  });
});
