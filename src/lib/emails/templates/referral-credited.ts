import { escapeHtml, renderBaseTemplate } from './base-template';

export interface ReferralCreditedEmailParams {
  /** Display name for both the From header and the body greeting. */
  referrerVenueName: string;
  refereeVenueName: string;
  rewardDisplay: string; // e.g. "£99"
  dashboardUrl: string;
}

export function renderReferralCreditedEmail(
  params: ReferralCreditedEmailParams,
): { html: string; text: string } {
  const safeReferee = escapeHtml(params.refereeVenueName);
  const safeReward = escapeHtml(params.rewardDisplay);

  const mainContent = [
    `<p style="margin:0 0 12px">Great news — <strong>${safeReferee}</strong> just signed up to Resneo using your referral code, and their first month has been paid.</p>`,
    `<p style="margin:0 0 12px">As a thank-you, we&rsquo;ve added a <strong>${safeReward} credit</strong> to your Resneo account. It will be applied automatically to your next invoice.</p>`,
    '<p style="margin:0 0 8px;font-size:14px;color:#64748b">Keep sharing your code &mdash; each new venue you refer earns another month free.</p>',
  ].join('\n');

  const html = renderBaseTemplate({
    venueName: params.referrerVenueName,
    heading: 'Your referral credit is here',
    mainContent,
    ctaLabel: 'View Refer & Earn',
    ctaUrl: params.dashboardUrl,
    footerNote:
      'You received this email because someone signed up to Resneo using your referral code.',
  });

  const text = [
    `Great news — ${params.refereeVenueName} just signed up to Resneo using your referral code, and their first month has been paid.`,
    '',
    `As a thank-you, we've added a ${params.rewardDisplay} credit to your Resneo account. It will be applied automatically to your next invoice.`,
    '',
    `Refer & Earn: ${params.dashboardUrl}`,
    '',
    'Keep sharing your code — each new venue you refer earns another month free.',
  ].join('\n');

  return { html, text };
}
