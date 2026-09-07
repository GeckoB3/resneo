import { describe, expect, it } from 'vitest';
import { buildGoogleMapsEmbedUrl } from './external-links';

describe('buildGoogleMapsEmbedUrl', () => {
  it('returns null without an address', () => {
    expect(buildGoogleMapsEmbedUrl('')).toBeNull();
    expect(buildGoogleMapsEmbedUrl('  ', 'Cultra Manor')).toBeNull();
  });

  it('searches the address alone when no place name is given', () => {
    expect(buildGoogleMapsEmbedUrl('10 Cultra Avenue, Holywood')).toBe(
      'https://www.google.com/maps?q=10%20Cultra%20Avenue%2C%20Holywood&output=embed',
    );
    expect(buildGoogleMapsEmbedUrl('10 Cultra Avenue, Holywood', null)).toBe(
      'https://www.google.com/maps?q=10%20Cultra%20Avenue%2C%20Holywood&output=embed',
    );
  });

  it('puts the business name before the address so Google matches the listing', () => {
    expect(buildGoogleMapsEmbedUrl('10 Cultra Avenue, Holywood', ' Cultra Manor ')).toBe(
      'https://www.google.com/maps?q=Cultra%20Manor%2C%2010%20Cultra%20Avenue%2C%20Holywood&output=embed',
    );
  });
});
