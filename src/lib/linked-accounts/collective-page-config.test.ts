import { describe, it, expect } from 'vitest';
import {
  sanitizeCollectiveBookingPageConfig,
  mergeCollectiveBookingPageConfigPatch,
} from './collective-page-config';

const CAL_ID = '11111111-1111-1111-1111-111111111111';

describe('sanitizeCollectiveBookingPageConfig', () => {
  it('keeps shared branding fields and a valid cover photo url', () => {
    const out = sanitizeCollectiveBookingPageConfig({
      brand_primary: '#003B6F',
      font_preset: 'modern',
      about: '  Hello  ',
      cover_photo_url: 'https://cdn.example.com/c/abc/cover.jpg',
    });
    expect(out.brand_primary).toBe('#003b6f');
    expect(out.font_preset).toBe('modern');
    expect(out.about).toBe('Hello');
    expect(out.cover_photo_url).toBe('https://cdn.example.com/c/abc/cover.jpg');
  });

  it('drops service_photos (collective offering photos live on the item)', () => {
    const out = sanitizeCollectiveBookingPageConfig({
      service_photos: { [CAL_ID]: 'https://x/y.jpg' },
    });
    expect(out.service_photos).toBeUndefined();
  });

  it('keeps offering photo framing even though the photo itself lives on the item', () => {
    const out = sanitizeCollectiveBookingPageConfig({
      service_photos: { [CAL_ID]: 'https://x/y.jpg' },
      service_photo_crops: { [CAL_ID]: { x: 30, y: 60, zoom: 1.5 } },
    });
    expect(out.service_photos).toBeUndefined();
    expect(out.service_photo_crops).toEqual({ [CAL_ID]: { x: 30, y: 60, zoom: 1.5 } });
  });

  it('keeps team photo framing keyed by calendar id', () => {
    const out = sanitizeCollectiveBookingPageConfig({
      team_profiles: {
        [CAL_ID]: { photo: 'https://x/p.jpg', photo_crop: { x: 20, y: 80, zoom: 2 } },
      },
    });
    expect(out.team_profiles?.[CAL_ID]?.photo_crop).toEqual({ x: 20, y: 80, zoom: 2 });
  });

  it('keeps team profile photos keyed by calendar id', () => {
    const out = sanitizeCollectiveBookingPageConfig({
      team_profiles: { [CAL_ID]: { bio: 'Hi', photo: 'https://x/p.jpg' } },
    });
    expect(out.team_profiles?.[CAL_ID]?.photo).toBe('https://x/p.jpg');
    expect(out.team_profiles?.[CAL_ID]?.bio).toBe('Hi');
  });

  it('rejects a non-https cover photo url', () => {
    const out = sanitizeCollectiveBookingPageConfig({ cover_photo_url: 'ftp://x/y.jpg' });
    expect(out.cover_photo_url).toBeUndefined();
  });
});

describe('mergeCollectiveBookingPageConfigPatch', () => {
  it('preserves cover_photo_url when the patch omits it (branding save)', () => {
    const existing = { brand_primary: '#111111', cover_photo_url: 'https://x/cover.jpg' };
    const incoming = { brand_primary: '#222222' }; // no cover_photo_url
    const merged = mergeCollectiveBookingPageConfigPatch(existing, incoming);
    expect(merged.brand_primary).toBe('#222222');
    expect(merged.cover_photo_url).toBe('https://x/cover.jpg');
  });

  it('uses the patch cover_photo_url when provided', () => {
    const existing = { cover_photo_url: 'https://x/old.jpg' };
    const incoming = { cover_photo_url: 'https://x/new.jpg' };
    const merged = mergeCollectiveBookingPageConfigPatch(existing, incoming);
    expect(merged.cover_photo_url).toBe('https://x/new.jpg');
  });

  it('clears cover_photo_url when the patch sends an empty string', () => {
    const existing = { cover_photo_url: 'https://x/old.jpg' };
    const incoming = { cover_photo_url: '' };
    const merged = mergeCollectiveBookingPageConfigPatch(existing, incoming);
    expect(merged.cover_photo_url).toBeUndefined();
  });

  it('replaces managed keys wholesale (an omitted key is cleared)', () => {
    const existing = { brand_primary: '#111111', about: 'Old about' };
    const incoming = { brand_primary: '#222222' }; // about omitted → cleared
    const merged = mergeCollectiveBookingPageConfigPatch(existing, incoming);
    expect(merged.about).toBeUndefined();
    expect(merged.brand_primary).toBe('#222222');
  });

  it('drops service_photos on merge', () => {
    const existing = { service_photos: { [CAL_ID]: 'https://x/y.jpg' } };
    const incoming = { brand_primary: '#222222' };
    const merged = mergeCollectiveBookingPageConfigPatch(existing, incoming);
    expect(merged.service_photos).toBeUndefined();
  });
});

describe('services_layout on a combined page', () => {
  it('keeps the collapsible-categories choice and drops the default', () => {
    expect(sanitizeCollectiveBookingPageConfig({ services_layout: 'accordion' }).services_layout).toBe('accordion');
    expect(sanitizeCollectiveBookingPageConfig({ services_layout: 'sections' })).not.toHaveProperty('services_layout');
    expect(sanitizeCollectiveBookingPageConfig({ services_layout: 'grid' })).not.toHaveProperty('services_layout');
  });
});
