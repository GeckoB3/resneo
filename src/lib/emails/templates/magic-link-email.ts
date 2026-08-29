import { buildCtaButton, escapeHtml, renderBaseTemplate } from './base-template';

/**
 * The sign-in link email (P3-4e, closes half of G20).
 *
 * It was built inline inside `POST /api/auth/send-magic-link`: three bare
 * `<p>` tags with a naked anchor, no ResNeo header, no footer, no unsubscribe
 * context, and invisible to the template gallery because it did not exist as a
 * template. Every other transactional email the platform sends is branded; this
 * one is the FIRST thing a customer sees when they try to get into their
 * account, and it looked like a phishing attempt.
 *
 * **`renderBaseTemplate` is the target, and the plan's correction is why that
 * needed saying.** An earlier draft said to route this through
 * `renderBaseTemplate` "so it matches the confirmation email's design", which
 * is wrong: the booking confirmation uses its own richer
 * `booking-confirmation-layout`. `renderBaseTemplate` is the layout for
 * everything that is NOT a booking, and it already has three non-booking
 * callers, of which `staff-welcome-email` is the closest analogue: a heading, a
 * short body, one CTA button, a footer note. A sign-in link has no booking
 * date, no party size and no venue address, so the richer layout would have
 * nothing to put in its detail card.
 *
 * **No venue.** Signing in is a platform action, not a venue one, and a
 * customer with bookings at four venues would find any single venue's name on
 * it misleading. `renderBaseTemplate` takes `venueName` as its brand line, so
 * this passes the platform's own name.
 */

export interface MagicLinkEmailParams {
  /** The `/auth/confirm` URL carrying the OTP. */
  confirmUrl: string;
  /**
   * How long the link lasts, in hours. Passed rather than hardcoded because
   * `otp_expiry` is a project setting and the copy has to follow it: the plan
   * records that changing it must also update every string that states the
   * lifetime.
   */
  expiryHours: number;
}

export function renderMagicLinkEmail(params: MagicLinkEmailParams): {
  html: string;
  text: string;
} {
  const hours = Math.max(1, Math.round(params.expiryHours));
  const lifetime = hours === 1 ? '1 hour' : `${hours} hours`;

  const mainContent = [
    '<p style="margin:0 0 16px">Use the button below to sign in to your ResNeo account. You do not need a password.</p>',
    buildCtaButton('Sign in to ResNeo', params.confirmUrl),
    `<p style="margin:16px 0 0;font-size:13px;color:#64748b">This link works once and expires in ${escapeHtml(lifetime)}.</p>`,
    /*
      The line that makes this not look like phishing. Somebody who did not ask
      for this needs to be told, in the email itself, that ignoring it is the
      correct and sufficient response: no account was created and nothing
      happens if they do nothing.
    */
    '<p style="margin:8px 0 0;font-size:13px;color:#64748b">If you did not ask to sign in, you can ignore this email. Nothing will happen and no one can use this link but you.</p>',
  ].join('\n');

  const html = renderBaseTemplate({
    venueName: 'ResNeo',
    heading: 'Your sign-in link',
    mainContent,
    footerNote: 'You received this because someone asked to sign in to ResNeo with this email address.',
  });

  const text = [
    'Your ResNeo sign-in link',
    '',
    'Use this link to sign in. You do not need a password:',
    params.confirmUrl,
    '',
    `This link works once and expires in ${lifetime}.`,
    '',
    'If you did not ask to sign in, you can ignore this email. Nothing will happen and no one can use this link but you.',
  ].join('\n');

  return { html, text };
}
