import { describe, expect, it } from 'vitest';
import { renderTransactionalEmailHtml, emailFooterVenue } from './booking-confirmation-layout';

const venue = {
  name: 'Plus 1 Staging',
  address: '3 Hibernia St, Holywood, BT18 9JE',
  phone: '+44 7725 002232',
  website_url: 'https://example.com/',
};

function render(footerVenue: ReturnType<typeof emailFooterVenue> | null) {
  return renderTransactionalEmailHtml({
    venueName: venue.name,
    heading: 'Thank you for your visit',
    mainContent: '<p>Hi</p>',
    footerVenue,
  });
}

describe('email footer contact block', () => {
  it('links the address, phone and website as explicit anchors in one colour', () => {
    const html = render(emailFooterVenue(venue, 'https://maps.example/x'));
    const footer = html.slice(html.indexOf('padding:24px 12px 36px'));
    expect(footer).toContain('href="https://maps.example/x"');
    expect(footer).toContain('href="tel:+447725002232"');
    expect(footer).toContain('href="https://example.com/"');
    expect(footer).toContain('Visit website');
    const colours = [...footer.matchAll(/<a href="(?:https:\/\/maps|tel:|https:\/\/example)[^>]*style="color:([^;]+);/g)].map((m) => m[1]);
    expect(colours).toHaveLength(3);
    expect(new Set(colours).size).toBe(1);
  });

  it('shows the address as plain text without a maps link', () => {
    const html = render(emailFooterVenue(venue, null));
    expect(html).toContain('3 Hibernia St, Holywood, BT18 9JE');
    expect(html).not.toContain('maps');
  });

  it('drops the address for off-site services but keeps phone and website', () => {
    const html = render(emailFooterVenue(venue, null, { includeAddress: false }));
    expect(html).not.toContain('3 Hibernia St');
    expect(html).toContain('tel:+447725002232');
    expect(html).toContain('Visit website');
  });

  it('keeps the plain footer when no venue block is given', () => {
    const html = render(null);
    expect(html).toContain('You received this email because you have a booking at Plus 1 Staging.');
    expect(html).not.toContain('tel:');
  });
});
