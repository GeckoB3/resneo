import { sendEmail } from './send-email';

/**
 * Internal recipient for new-signup notifications. Override with
 * SIGNUP_NOTIFICATION_TO (same convention as the contact form's CONTACT_TO).
 */
const SIGNUP_NOTIFICATION_TO = process.env.SIGNUP_NOTIFICATION_TO?.trim() || 'andrew@resneo.com';

export interface NewSignupNotificationParams {
  /** Email address the new account signed up with. */
  signupEmail: string | null;
  /** Pricing tier chosen at checkout, e.g. "appointments" / "light". */
  plan: string | null;
  businessType: string | null;
  /** Subscription state at creation, e.g. "trialing" / "active". */
  planStatus: string | null;
  venueId: string;
  /** Referral code the signup arrived through, when present. */
  referralCode?: string | null;
  /**
   * Which of the two racing provisioning paths created the venue —
   * useful when checking why/when a signup landed.
   */
  source: 'signup_complete' | 'stripe_webhook';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SOURCE_LABELS: Record<NewSignupNotificationParams['source'], string> = {
  signup_complete: 'Signup success page',
  stripe_webhook: 'Stripe webhook',
};

/** Rendered separately from sending so templates.test.ts-style unit tests can cover it. */
export function renderNewSignupNotificationEmail(params: NewSignupNotificationParams): {
  subject: string;
  html: string;
  text: string;
} {
  const email = params.signupEmail?.trim() || 'unknown';
  const plan = params.plan?.trim() || 'unknown';
  const subject = `New Resneo signup: ${email} (${plan})`;

  const rows: Array<[string, string]> = [
    ['Email', email],
    ['Plan', plan],
    ...(params.planStatus ? [['Plan status', params.planStatus] as [string, string]] : []),
    ...(params.businessType ? [['Business type', params.businessType] as [string, string]] : []),
    ['Venue ID', params.venueId],
    ...(params.referralCode ? [['Referral code', params.referralCode] as [string, string]] : []),
    ['Provisioned via', SOURCE_LABELS[params.source]],
  ];

  const tds = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">${escapeHtml(label)}</td><td style="padding:8px 0;color:#1e293b">${escapeHtml(value)}</td></tr>`,
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc">
<tr><td style="padding:24px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
<tr><td style="padding:24px;border-bottom:3px solid #003B6F"><h1 style="margin:0;font-size:20px;color:#1e293b">New Resneo signup</h1></td></tr>
<tr><td style="padding:24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${tds}</table></td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = ['New Resneo signup', '', ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n');

  return { subject, html, text };
}

/**
 * Notify the internal mailbox that a new account just signed up. Both venue
 * provisioning paths (signup success page and the Stripe webhook) call this
 * right after their guarded venue+staff insert succeeds, so exactly one email
 * goes out per signup. Never throws — a notification failure must not fail
 * the signup itself (and sendEmail already no-ops without SENDGRID_API_KEY).
 */
export async function sendNewSignupNotification(params: NewSignupNotificationParams): Promise<void> {
  try {
    const { subject, html, text } = renderNewSignupNotificationEmail(params);
    await sendEmail({
      to: SIGNUP_NOTIFICATION_TO,
      subject,
      html,
      text,
      fromDisplayName: 'Resneo Signups',
    });
  } catch (err) {
    console.error('[sendNewSignupNotification] failed (non-fatal):', err);
  }
}
