import { describe, expect, it } from 'vitest';
import {
  formatMessageParagraphsHtml,
  renderCustomMessageEmailHtml,
  renderCustomMessageEmailText,
} from './custom-message-email';

const venue = {
  venueName: 'Willow & Sage Studio',
  guestFirstName: 'Priya',
  venueAddress: '12 Market Row, Bath BA1 5AA',
  venuePhone: '01225 123456',
  venueWebsiteUrl: 'willowandsage.co.uk',
};

describe('formatMessageParagraphsHtml', () => {
  it('turns blank lines into paragraphs and single newlines into breaks', () => {
    const html = formatMessageParagraphsHtml('First line\nsecond line\n\nNew paragraph');
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain('First line<br/>second line');
    expect(html).toContain('New paragraph');
  });
  it('escapes markup and handles Windows line endings', () => {
    const html = formatMessageParagraphsHtml('<b>hi</b>\r\n\r\nx');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html.match(/<p /g)).toHaveLength(2);
  });
});

describe('renderCustomMessageEmailHtml', () => {
  it('greets by first name, carries the message and the venue contact details, and no booking details', () => {
    const html = renderCustomMessageEmailHtml({
      ...venue,
      message: 'We are open late on Thursdays.\n\nBook your spot.',
      brandColour: '#7C3AED',
    });
    expect(html).toContain('Hi Priya,');
    expect(html).toContain('We are open late on Thursdays.');
    expect(html).toContain('12 Market Row, Bath BA1 5AA');
    expect(html).toContain('href="tel:01225123456"');
    expect(html).toContain('href="https://willowandsage.co.uk/"');
    expect(html).toContain('#7C3AED');
    expect(html).not.toMatch(/Guests|Party size|Date:|Time:|booking is/i);
    expect(html).not.toContain('—');
  });
  it('falls back to the ResNeo accent and omits empty contact rows', () => {
    const html = renderCustomMessageEmailHtml({
      venueName: 'Plain Venue',
      guestFirstName: 'there',
      message: 'Hello',
    });
    expect(html).toContain('#003B6F');
    expect(html).not.toContain('Address');
    expect(html).not.toContain('Website');
    expect(html).toContain('Hi there,');
  });
  it('renders a plain-text twin with the contact details last', () => {
    const text = renderCustomMessageEmailText({ ...venue, message: 'Hello\n\n\n\nWorld' });
    expect(text).toBe(
      'Hi Priya,\n\nHello\n\nWorld\n\nWillow & Sage Studio\n12 Market Row, Bath BA1 5AA\n01225 123456\nhttps://willowandsage.co.uk/',
    );
  });
});
