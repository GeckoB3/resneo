import { describe, it, expect } from 'vitest';
import {
  sanitizeCollectiveBookingPageConfig,
  mergeCollectiveBookingPageConfigPatch,
  inheritCollectivePageConfigFromHost,
  collectivePageConfigHasOwnTabSettings,
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

describe('inheritCollectivePageConfigFromHost', () => {
  const host = {
    show_services_tab: true,
    show_team_tab: true,
    show_about_tab: true,
    about: 'Welcome to the salon',
    gallery: ['https://cdn.example.com/g1.jpg'],
    social_links: { instagram: 'https://instagram.com/salon' },
    brand_primary: '#ff0000',
  };

  /**
   * The bug this pins: a freshly linked combined page has an empty config, so
   * the host's Services, Meet the team and About tabs all disappeared.
   */
  it('borrows the host tabs and About content when the combined page has none of its own', () => {
    const out = inheritCollectivePageConfigFromHost({ logo_crop: { x: 50, y: 50, zoom: 1 } }, host);
    expect(out.show_services_tab).toBe(true);
    expect(out.show_team_tab).toBe(true);
    expect(out.show_about_tab).toBe(true);
    expect(out.about).toBe('Welcome to the salon');
    expect(out.gallery).toEqual(['https://cdn.example.com/g1.jpg']);
    expect(out.social_links).toEqual({ instagram: 'https://instagram.com/salon' });
    // Branding is the collective's own and is never borrowed.
    expect(out.brand_primary).toBeUndefined();
    expect(out.logo_crop).toEqual({ x: 50, y: 50, zoom: 1 });
  });

  it('leaves the combined page alone once the host has saved any tab setting there', () => {
    const own = { show_services_tab: true, show_about_tab: false };
    expect(inheritCollectivePageConfigFromHost(own, host)).toEqual(own);
  });

  it('keeps the combined page text over the host text', () => {
    const out = inheritCollectivePageConfigFromHost({ about: 'Our combined studio' }, host);
    expect(out.about).toBe('Our combined studio');
    expect(out.show_team_tab).toBe(true);
  });

  it('does nothing without a host config', () => {
    expect(inheritCollectivePageConfigFromHost({}, null)).toEqual({});
  });
});

describe('sanitizeCollectiveBookingPageConfig tab settings', () => {
  it('keeps an explicit off so switching every tab off does not read as never set', () => {
    const out = sanitizeCollectiveBookingPageConfig({
      show_services_tab: false,
      show_team_tab: false,
      show_about_tab: false,
    });
    expect(out.show_services_tab).toBe(false);
    expect(out.show_team_tab).toBe(false);
    expect(out.show_about_tab).toBe(false);
    expect(collectivePageConfigHasOwnTabSettings(out)).toBe(true);
    expect(collectivePageConfigHasOwnTabSettings({})).toBe(false);
  });
});
