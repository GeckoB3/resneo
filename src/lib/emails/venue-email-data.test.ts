import { describe, expect, it } from 'vitest';
import { venueBookingPageUrl, venueRowToEmailData } from './venue-email-data';

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

  it('derives booking_page_url from the venue slug on the public origin', () => {
    const out = venueRowToEmailData({ name: 'Test Venue', slug: 'sharps-barbers' });
    expect(out.booking_page_url).toMatch(/^https?:\/\/[^/]+\/book\/sharps-barbers$/);
  });

  it('leaves booking_page_url unset without a slug, so the Book again button is dropped', () => {
    expect(venueRowToEmailData({ name: 'Test Venue' }).booking_page_url).toBeUndefined();
    expect(venueRowToEmailData({ name: 'Test Venue', slug: '  ' }).booking_page_url).toBeUndefined();
    expect(venueBookingPageUrl(null)).toBeNull();
  });

  it('prefers an explicit booking_page_url over the slug', () => {
    expect(
      venueRowToEmailData({ name: 'Test Venue', slug: 'x', booking_page_url: 'https://example.com/book/y' })
        .booking_page_url,
    ).toBe('https://example.com/book/y');
  });

  it('passes through website_url for the Venue button', () => {
    expect(
      venueRowToEmailData({ name: 'Test Venue', website_url: 'https://example.com' }).website_url,
    ).toBe('https://example.com');
  });
});
