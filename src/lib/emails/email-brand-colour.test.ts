import { describe, expect, it } from 'vitest';
import { renderCommunicationEmail } from '@/lib/communications/renderer';
import { renderTransactionalEmailHtml } from '@/lib/emails/templates/booking-confirmation-layout';
import { buildReviewRequestBlock } from '@/lib/emails/review-request-block';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { DEFAULT_EMAIL_ACCENT, emailAccent } from '@/lib/emails/email-accent';
import type { BookingEmailData } from '@/lib/emails/types';

const BRAND = '#7c3aed';
const REVIEW_URL = 'https://g.page/r/CbAbCdEfGhIjK/review';

const venueRow = {
  name: 'Plum Studio',
  address: '1 High St',
  reply_to_email: 'hi@plum.test',
  google_review_url: REVIEW_URL,
  review_request_enabled: true,
  booking_page_config: { brand_primary: BRAND, brand_emails: true },
};

const booking: BookingEmailData = {
  id: 'b1',
  guest_name: 'Sam',
  guest_email: 'sam@example.com',
  booking_date: '2026-06-01',
  booking_time: '10:00',
  party_size: 1,
  manage_booking_link: 'https://example.com/m',
  account_bookings_link: 'https://example.com/account',
};

/** Everything except the "Powered by ResNeo" footer link, which always keeps the ResNeo navy. */
function withoutPoweredBy(html: string): string {
  return html.replace(/Powered by <a[^>]*>ResNeo<\/a>/g, '');
}

describe('emailAccent', () => {
  it('falls back to the ResNeo navy when the venue has no brand colour', () => {
    expect(emailAccent(null)).toBe(DEFAULT_EMAIL_ACCENT);
    expect(emailAccent(undefined)).toBe(DEFAULT_EMAIL_ACCENT);
    expect(emailAccent('   ')).toBe(DEFAULT_EMAIL_ACCENT);
    expect(emailAccent('#123456')).toBe('#123456');
  });
});

describe('customer emails follow the venue brand colour', () => {
  const branded = venueRowToEmailData(venueRow);
  const plain = venueRowToEmailData({
    ...venueRow,
    booking_page_config: { brand_primary: BRAND },
  });

  it('venueRowToEmailData resolves the colour only when the switch is on', () => {
    expect(branded.brand_colour).toBe(BRAND);
    expect(plain.brand_colour).toBeNull();
    expect(venueRowToEmailData({ name: 'No config' }).brand_colour).toBeNull();
  });

  it('booking confirmation paints the highlight, buttons and links with the brand', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking,
      venue: branded,
    });
    expect(out).not.toBeNull();
    const html = out!.html;
    expect(html).toContain(`color:${BRAND}">confirmed`);
    expect(html).toContain(`background:${BRAND}`);
    expect(html).toContain(`style="color:${BRAND};font-weight:600">View or sign in to your account`);
    expect(withoutPoweredBy(html)).not.toContain(DEFAULT_EMAIL_ACCENT);
    // The ResNeo link in the footer is not the venue's to recolour.
    expect(html).toContain(`style="color:${DEFAULT_EMAIL_ACCENT};font-weight:600;text-decoration:none">ResNeo</a>`);
  });

  it('booking confirmation keeps the ResNeo colours when the switch is off', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking,
      venue: plain,
    });
    expect(out!.html).toContain(`color:${DEFAULT_EMAIL_ACCENT}">confirmed`);
    expect(out!.html).not.toContain(BRAND);
  });

  it('reminder-style emails paint the CTA pills with the brand', () => {
    const base = {
      venueName: 'Plum Studio',
      heading: 'A reminder about your visit',
      mainContent: '<p>Hi Sam,</p>',
      ctaLabel: 'Manage booking',
      ctaUrl: 'https://example.com/m',
      secondaryCtaLabel: 'Directions',
      secondaryCtaUrl: 'https://maps.example.com/x',
    };
    const brandedHtml = renderTransactionalEmailHtml({ ...base, brandColour: BRAND });
    expect(brandedHtml).toContain(`background:${BRAND}`);
    expect(brandedHtml).toContain(`border:2px solid ${BRAND}`);
    expect(withoutPoweredBy(brandedHtml)).not.toContain(DEFAULT_EMAIL_ACCENT);

    const plainHtml = renderTransactionalEmailHtml(base);
    expect(plainHtml).toContain(`background:${DEFAULT_EMAIL_ACCENT}`);
    expect(plainHtml).not.toContain(BRAND);
  });

  it('the post-visit review button follows the brand', () => {
    expect(buildReviewRequestBlock(branded)!.html).toContain(`background:${BRAND}`);
    expect(buildReviewRequestBlock(plain)!.html).toContain(`background:${DEFAULT_EMAIL_ACCENT}`);
  });
});
