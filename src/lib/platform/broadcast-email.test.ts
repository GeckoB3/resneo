import { describe, expect, it } from 'vitest';
import {
  broadcastSendProblems,
  describeVenueNames,
  emptyBroadcastContent,
  fillMergeTagsPlain,
  firstNameFrom,
  normaliseBroadcastContent,
  renderBroadcastBodyHtml,
  renderBroadcastBodyText,
  renderBroadcastEmail,
  safeBroadcastHref,
  type BroadcastContent,
} from './broadcast-email';
import { STARTER_TEMPLATES } from '@/app/super/contact-users/contact-users-shared';

const BASE = 'https://www.resneo.com';
/** Built from its code point so this file itself stays free of the character. */
const EM_DASH = String.fromCharCode(0x2014);

function content(overrides: Partial<BroadcastContent> = {}): BroadcastContent {
  return {
    ...emptyBroadcastContent(),
    headline: 'Deposits are here',
    intro: 'Take a deposit when clients book online.',
    body: 'Hello there.',
    ...overrides,
  };
}

function render(overrides: Partial<Parameters<typeof renderBroadcastEmail>[0]> = {}) {
  return renderBroadcastEmail({
    baseUrl: BASE,
    subject: 'New for {venue_name}',
    content: content(),
    recipient: { firstName: 'Sam', venueNames: ['Glow Studio'] },
    important: false,
    unsubscribeUrl: `${BASE}/updates/unsubscribe?r=abc&sig=def`,
    ...overrides,
  });
}

describe('renderBroadcastEmail', () => {
  it('fills merge tags in the subject and greets by first name', () => {
    const out = render();
    expect(out.subject).toBe('New for Glow Studio');
    expect(out.html).toContain('Hi Sam,');
    expect(out.text).toContain('Hi Sam,');
  });

  it('greets "there" when the first name is unknown, and can drop the greeting', () => {
    expect(render({ recipient: { firstName: null, venueNames: ['A'] } }).html).toContain('Hi there,');
    expect(render({ content: content({ greeting: false }) }).html).not.toContain('Hi Sam,');
  });

  it('shows the eyebrow, headline and intro, and uses the intro as the preview text', () => {
    const out = render();
    expect(out.html).toContain('New feature');
    expect(out.html).toContain('Deposits are here');
    expect(out.preheader).toBe('Take a deposit when clients book online.');
  });

  it('carries the unsubscribe link for product news and never for an important notice', () => {
    const news = render();
    expect(news.html).toContain('/updates/unsubscribe?r=abc&amp;sig=def');
    expect(news.text).toContain('Unsubscribe: https://www.resneo.com/updates/unsubscribe?r=abc&sig=def');

    const notice = render({ important: true, unsubscribeUrl: null });
    expect(notice.html).not.toMatch(/unsubscribe/i);
    expect(notice.html).toContain('important notice');
  });

  it('names every venue the person runs in the footer', () => {
    const out = render({ recipient: { firstName: 'Sam', venueNames: ['Glow Studio', 'Glow Spa'] } });
    expect(out.html).toContain('ResNeo account for Glow Studio and Glow Spa');
  });

  it('escapes a headline and subject that contain markup', () => {
    const out = render({ content: content({ headline: '<script>alert(1)</script>' }) });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('keeps em-dashes out of the fixed copy', () => {
    const out = render();
    expect(out.html).not.toContain(EM_DASH);
    expect(out.text).not.toContain(EM_DASH);
    const notice = render({ important: true, unsubscribeUrl: null });
    expect(notice.html).not.toContain(EM_DASH);
  });

  it('keeps em-dashes out of the starter templates', () => {
    for (const t of STARTER_TEMPLATES) {
      const all = [t.label, t.description, t.subject, ...Object.values(t.content)].join('\n');
      expect(all, t.id).not.toContain(EM_DASH);
    }
  });
});

describe('renderBroadcastBodyHtml', () => {
  it('turns the button syntax into a navy pill button with an absolute link', () => {
    const html = renderBroadcastBodyHtml('Before\n\n[[button: Try it now | /dashboard]]\n\nAfter', BASE);
    expect(html).toContain('href="https://www.resneo.com/dashboard"');
    expect(html).toContain('Try it now');
    expect(html).toContain('background-color:#003B6F');
    expect(html).toContain('After');
  });

  it('renders a quote as a highlighted callout', () => {
    const html = renderBroadcastBodyHtml('> **Good to know:** it is free.', BASE);
    expect(html).toContain('border-left:4px solid #00C2C7');
    expect(html).toContain('Good to know:');
  });

  it('styles headings, lists and links inline', () => {
    const html = renderBroadcastBodyHtml('## Steps\n\n1. One\n2. Two\n\n- a\n- b\n\n[help](https://www.resneo.com/help)', BASE);
    expect(html).toMatch(/<h2 style="[^"]+">Steps<\/h2>/);
    expect(html).toMatch(/<ol style=/);
    expect(html).toMatch(/<ul style=/);
    expect(html).toContain('<a href="https://www.resneo.com/help" target="_blank" style=');
  });

  it('never interprets raw HTML', () => {
    const html = renderBroadcastBodyHtml('<img src=x onerror=alert(1)>\n\nHi <b>there</b>', BASE);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('drops unsafe link schemes but keeps the text', () => {
    const html = renderBroadcastBodyHtml('[click](javascript:alert(1)) and [mail](mailto:hello@resneo.com)', BASE);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
    expect(html).toContain('href="mailto:hello@resneo.com"');
  });

  it('only shows images from https addresses', () => {
    expect(renderBroadcastBodyHtml('![shot](https://cdn.example.com/a.png)', BASE)).toContain(
      '<img src="https://cdn.example.com/a.png"',
    );
    expect(renderBroadcastBodyHtml('![shot](http://cdn.example.com/a.png)', BASE)).not.toContain('<img');
  });
});

describe('renderBroadcastBodyText', () => {
  it('writes links, buttons and lists as readable plain text', () => {
    const text = renderBroadcastBodyText(
      '## Steps\n\n1. Open [settings](/dashboard/settings)\n2. Save\n\n[[button: Go | /dashboard]]',
      BASE,
    );
    expect(text).toContain('STEPS');
    expect(text).toContain('1. Open settings (https://www.resneo.com/dashboard/settings)');
    expect(text).toContain('2. Save');
    expect(text).toContain('Go: https://www.resneo.com/dashboard');
  });
});

describe('merge tags', () => {
  it('escapes markdown in venue names so they render literally', () => {
    const out = render({
      content: content({ body: 'Welcome, {venue_name}!' }),
      recipient: { firstName: 'Sam', venueNames: ['*Glow* [Studio]'] },
    });
    expect(out.html).toContain('*Glow* [Studio]');
    expect(out.html).not.toContain('<em');
  });

  it('is case and space tolerant', () => {
    expect(fillMergeTagsPlain('Hi { First_Name }', { firstName: 'Jo', venueNames: [] })).toBe('Hi Jo');
  });
});

describe('helpers', () => {
  it('describes venue lists naturally', () => {
    expect(describeVenueNames([])).toBe('your business');
    expect(describeVenueNames(['A'])).toBe('A');
    expect(describeVenueNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(describeVenueNames(['A', 'B', 'C', 'D'])).toBe('A, B and 2 other venues');
  });

  it('takes the first name from a full name, never from an email', () => {
    expect(firstNameFrom('Sarah Jane Smith')).toBe('Sarah');
    expect(firstNameFrom('owner@example.com')).toBeNull();
    expect(firstNameFrom('  ')).toBeNull();
  });

  it('resolves site paths and rejects other schemes', () => {
    expect(safeBroadcastHref('/help', BASE)).toBe('https://www.resneo.com/help');
    expect(safeBroadcastHref('//evil.com', BASE)).toBeNull();
    expect(safeBroadcastHref('data:text/html,hi', BASE)).toBeNull();
  });

  it('normalises stored content and lists what is missing before a send', () => {
    const c = normaliseBroadcastContent({ headline: 'x'.repeat(500), greeting: 'no' });
    expect(c.headline.length).toBe(150);
    expect(c.greeting).toBe(true);
    expect(broadcastSendProblems('', emptyBroadcastContent())).toHaveLength(3);
    expect(broadcastSendProblems('Subject', content())).toEqual([]);
  });
});
