/**
 * The Google review ask on the post-visit thank-you email.
 *
 * Two routes, both shown to everyone: leave a Google review, or tell the venue directly. That
 * second link is not a diversion for unhappy customers only. Showing the Google link solely to
 * people who rated highly first is review gating, which Google's review policies prohibit and which
 * UK review rules target. Offering both to every recipient is legitimate, and in practice a
 * customer with a complaint tends to take the direct route anyway.
 *
 * There is no rating picker because Google's dialog cannot be pre-set to a star count: a picker
 * here could only decide who sees the link, which is the gating this deliberately avoids.
 */

import { normaliseGoogleReviewUrl } from '@/lib/reviews/google-review-link';
import type { VenueEmailData } from './types';

export interface ReviewRequestBlock {
  html: string;
  textLines: string[];
}

/** Null when the venue has not switched this on, or has no usable link. */
export function buildReviewRequestBlock(
  venue: VenueEmailData,
  opts: { practitionerName?: string | null } = {},
): ReviewRequestBlock | null {
  if (!venue.review_request_enabled) return null;
  const reviewUrl = normaliseGoogleReviewUrl(venue.google_review_url);
  if (!reviewUrl) return null;

  const who = opts.practitionerName?.trim();
  const intro = who
    ? `We hope you enjoyed your appointment with ${escapeHtml(who)}.`
    : 'We hope you enjoyed your visit.';

  const replyTo = venue.reply_to_email?.trim() || null;
  const directLine = replyTo
    ? `<p style="margin:12px 0 0 0;font-size:13px;color:#64748b">Something not quite right? <a href="mailto:${escapeHtml(replyTo)}" style="color:#64748b">Tell us directly</a> and we will put it right.</p>`
    : '';

  const html =
    `<div style="margin:20px 0 0 0;padding:16px;border:1px solid #e2e8f0;border-radius:12px">` +
    `<p style="margin:0 0 6px 0;font-size:15px;font-weight:600;color:#0f172a">How did we do?</p>` +
    `<p style="margin:0 0 12px 0;font-size:14px;color:#334155">${intro} If you have a moment, a Google review really helps other people find us.</p>` +
    `<a href="${reviewUrl}" style="display:inline-block;padding:10px 18px;border-radius:9999px;background:#003B6F;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">Leave a Google review</a>` +
    directLine +
    `</div>`;

  const textLines = [
    '',
    'How did we do?',
    `${who ? `We hope you enjoyed your appointment with ${who}.` : 'We hope you enjoyed your visit.'} If you have a moment, a Google review really helps other people find us.`,
    `Leave a Google review: ${reviewUrl}`,
  ];
  if (replyTo) {
    textLines.push(`Something not quite right? Tell us directly at ${replyTo} and we will put it right.`);
  }

  return { html, textLines };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
