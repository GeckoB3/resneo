import { describe, expect, it } from 'vitest';
import { venueRowToEmailData } from './venue-email-data';

describe('venueRowToEmailData', () => {
  it('prefers logo_url over cover_photo_url for the email avatar', () => {
    const out = venueRowToEmailData({
      name: 'Test Venue',
      logo_url: 'https://cdn.example/logo.png',
      cover_photo_url: 'https://cdn.example/cover.jpg',
    });
    expect(out.logo_url).toBe('https://cdn.example/logo.png');
  });

  it('falls back to cover_photo_url when logo_url is not set', () => {
    const out = venueRowToEmailData({
      name: 'Test Venue',
      cover_photo_url: 'https://cdn.example/cover.jpg',
    });
    expect(out.logo_url).toBe('https://cdn.example/cover.jpg');
  });

  it('returns null when neither logo_url nor cover_photo_url is provided', () => {
    const out = venueRowToEmailData({ name: 'Test Venue' });
    expect(out.logo_url).toBeNull();
  });

  it('uses reply_to_email when present, falling back to email otherwise', () => {
    expect(
      venueRowToEmailData({
        name: 'Test Venue',
        email: 'hello@example.com',
        reply_to_email: 'replies@example.com',
      }).reply_to_email,
    ).toBe('replies@example.com');

    expect(
      venueRowToEmailData({ name: 'Test Venue', email: 'hello@example.com' }).reply_to_email,
    ).toBe('hello@example.com');

    expect(venueRowToEmailData({ name: 'Test Venue' }).reply_to_email).toBeNull();
  });

  it('passes through website_url for the Venue button', () => {
    expect(
      venueRowToEmailData({ name: 'Test Venue', website_url: 'https://example.com' }).website_url,
    ).toBe('https://example.com');
  });
});
