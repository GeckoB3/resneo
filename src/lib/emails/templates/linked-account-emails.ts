import { buildCtaButton, escapeHtml, renderBaseTemplate } from './base-template';

export interface LinkEmailParams {
  /** Venue the email is addressed to (used for the header + footer). */
  recipientVenueName: string;
  heading: string;
  /** Plain-text paragraphs; rendered as <p> in HTML. */
  paragraphs: string[];
  /** Optional bullet list rendered after the paragraphs. */
  bullets?: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}

/**
 * HTML + plain text for a Linked Accounts notification email. Link
 * administration is internal venue-to-venue messaging, so these are not guest
 * communications — the footer reflects that.
 */
export function renderLinkEmail(params: LinkEmailParams): { html: string; text: string } {
  const bulletsHtml =
    params.bullets && params.bullets.length > 0
      ? `<ul style="margin:0 0 16px;padding-left:20px;color:#1e293b">${params.bullets
          .map((b) => `<li style="margin:0 0 6px">${escapeHtml(b)}</li>`)
          .join('')}</ul>`
      : '';

  const mainContent = [
    ...params.paragraphs.map(
      (p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`,
    ),
    bulletsHtml,
    params.ctaLabel && params.ctaUrl ? buildCtaButton(params.ctaLabel, params.ctaUrl) : '',
  ]
    .filter(Boolean)
    .join('\n');

  const html = renderBaseTemplate({
    venueName: params.recipientVenueName,
    heading: params.heading,
    mainContent,
    footerNote:
      params.footerNote ??
      'You received this email because your venue uses ReserveNI Linked Accounts.',
  });

  const text = [
    params.heading,
    '',
    ...params.paragraphs,
    ...(params.bullets && params.bullets.length > 0
      ? ['', ...params.bullets.map((b) => `- ${b}`)]
      : []),
    ...(params.ctaLabel && params.ctaUrl ? ['', `${params.ctaLabel}: ${params.ctaUrl}`] : []),
  ].join('\n');

  return { html, text };
}
