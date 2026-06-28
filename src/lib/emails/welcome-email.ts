import { sendEmail } from './send-email';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

/** Friendly, relationship-led sender for the customer welcome (distinct from bookings@). */
const WELCOME_FROM_EMAIL = 'hello@resneo.com';
const SUPPORT_EMAIL = 'support@resneo.com';

/**
 * The customer welcome email, sent once when a new account signs up. Aimed at appointments
 * businesses, in plain warm second-person voice (no em-dashes per the project copy rules).
 * Rendered separately from sending so it can be unit-tested.
 */
export function renderWelcomeEmail(baseUrl: string): { subject: string; html: string; text: string } {
  const base = baseUrl.replace(/\/$/, '');
  const guideUrl = `${base}/help/getting-started`;
  const supportPageUrl = `${base}/dashboard/support`;
  const helpUrl = `${base}/help`;
  const referUrl = `${base}/dashboard/settings?tab=refer-earn`;

  const subject = "Welcome to ResNeo, let's get you started";

  const numberBadge = (n: number, accent: boolean) =>
    `<div style="width:26px;height:26px;border-radius:50%;background-color:${accent ? '#00C2C7' : '#E8EFF6'};color:${accent ? '#00264A' : '#1A5587'};font-size:13px;font-weight:700;text-align:center;line-height:26px">${n}</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">

<tr><td style="background-color:#003B6F;padding:34px 32px 30px">
<div style="font-size:20px;font-weight:700;letter-spacing:-0.01em;color:#ffffff">Res<span style="color:#00C2C7">Neo</span></div>
<div style="width:46px;height:3px;background-color:#00C2C7;border-radius:2px;margin:22px 0 18px"></div>
<h1 style="margin:0;font-size:27px;line-height:1.22;font-weight:700;color:#ffffff">Welcome to ResNeo</h1>
<p style="margin:11px 0 0;font-size:15px;line-height:1.6;color:#C6D8E9">We're really glad you're here. Let's get you set up and taking bookings.</p>
</td></tr>

<tr><td style="padding:30px 32px 4px;font-size:15px;line-height:1.65;color:#1e293b">
<p style="margin:0 0 14px">Hi there,</p>
<p style="margin:0 0 14px">Welcome aboard, and thank you for joining ResNeo. Your account is ready to go, and we're so pleased to have you with us.</p>
<p style="margin:0 0 14px">We want your first steps to feel easy, so we've put everything you need in one simple guide. It walks you through each part at your own pace, in plain language, and most people are up and running in well under an hour.</p>
<p style="margin:0">Whenever you're ready, open the guide below and we'll point you in the right direction.</p>
</td></tr>

<tr><td style="padding:18px 32px 6px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0"><tr>
<td style="background-color:#003B6F;border-radius:8px;text-align:center"><a href="${guideUrl}" target="_blank" style="display:inline-block;padding:15px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">Open the getting started guide</a></td>
</tr></table>
</td></tr>

<tr><td style="padding:16px 32px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F5F5;border:1px solid #e2e8f0;border-radius:10px">
<tr><td style="padding:20px 22px">
<div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;margin:0 0 14px">Your first steps</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td width="36" valign="top" style="padding:0 12px 14px 0">${numberBadge(1, true)}</td><td valign="top" style="padding:0 0 14px"><div style="font-size:15px;font-weight:600;color:#0f172a">Add what you offer</div><div style="font-size:14px;line-height:1.5;color:#64748b">Set up your services so clients can book them.</div></td></tr>
<tr><td width="36" valign="top" style="padding:0 12px 14px 0">${numberBadge(2, true)}</td><td valign="top" style="padding:0 0 14px"><div style="font-size:15px;font-weight:600;color:#0f172a">Set your hours</div><div style="font-size:14px;line-height:1.5;color:#64748b">Tell ResNeo when you're open and when each person works. This is the most important step.</div></td></tr>
<tr><td width="36" valign="top" style="padding:0 12px 14px 0">${numberBadge(3, true)}</td><td valign="top" style="padding:0 0 14px"><div style="font-size:15px;font-weight:600;color:#0f172a">Add your business details</div><div style="font-size:14px;line-height:1.5;color:#64748b">Add your name and logo, then claim your own booking page address.</div></td></tr>
<tr><td width="36" valign="top" style="padding:0 12px 0 0">${numberBadge(4, false)}</td><td valign="top" style="padding:0"><div style="font-size:15px;font-weight:600;color:#0f172a">Turn on payments <span style="font-weight:400;color:#94a3b8">(optional)</span></div><div style="font-size:14px;line-height:1.5;color:#64748b">Connect Stripe if you'd like to take a deposit or full payment at booking.</div></td></tr>
</table>
<div style="font-size:13px;line-height:1.5;color:#64748b;margin:14px 0 0;border-top:1px solid #e2e8f0;padding-top:12px">There's a short, friendly how-to for each of these in the guide, plus pages on your calendar, contacts, reminders, reports and more.</div>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:22px 32px 2px;font-size:15px;line-height:1.6;color:#1e293b">
<h2 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#0f172a">We're here to help</h2>
<p style="margin:0 0 10px">You're never on your own with ResNeo. We're a small, friendly team and we genuinely want this to work for you.</p>
<p style="margin:0">Email us any time at <a href="mailto:${SUPPORT_EMAIL}" style="color:#003B6F;font-weight:600;text-decoration:none">${SUPPORT_EMAIL}</a>, send a message from the <a href="${supportPageUrl}" target="_blank" style="color:#003B6F;font-weight:600;text-decoration:none">Support page</a> in your dashboard, or browse the <a href="${helpUrl}" target="_blank" style="color:#003B6F;font-weight:600;text-decoration:none">help centre</a>. We usually reply within 24 hours, and we're happy to help with anything at all.</p>
</td></tr>

<tr><td style="padding:20px 32px 2px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E6FBFB;border:1px solid #8FEAEB;border-radius:10px">
<tr><td style="padding:18px 22px">
<div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#007E81;margin:0 0 6px">Refer and Earn</div>
<div style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 7px">Refer a venue, get a free month</div>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155">Know another business that would love ResNeo? When they sign up with your link, you both get a free month of credit. You'll find your personal link under Settings, Refer and Earn.</p>
<a href="${referUrl}" target="_blank" style="font-size:14px;color:#003B6F;font-weight:600;text-decoration:none">Get your referral link &#8594;</a>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:22px 32px 4px;font-size:15px;line-height:1.6;color:#1e293b">
<h2 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#0f172a">Tell us what you think</h2>
<p style="margin:0">Your feedback shapes ResNeo. If something could work better, or there's a feature you'd love, send it over from the Support page using the "Feature request" option, or just reply to this email. We read every message.</p>
</td></tr>

<tr><td style="padding:20px 32px 30px;font-size:15px;line-height:1.6;color:#1e293b">
<p style="margin:0 0 4px">Here's to filling your diary,</p>
<p style="margin:0;font-weight:600;color:#0f172a">The ResNeo team</p>
</td></tr>

<tr><td style="padding:18px 32px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#888888">
<p style="margin:0 0 6px">You're receiving this email because you created a ResNeo account.</p>
<p style="margin:0;color:#aaa">&copy; 2026 ResNeo &middot; JAR 26 LTD (NI740269) &middot; 100a Main Street, Bangor, BT20 4AG, UK</p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    'Welcome to ResNeo',
    '',
    'Hi there,',
    '',
    "Welcome aboard, and thank you for joining ResNeo. Your account is ready to go, and we're so pleased to have you with us.",
    '',
    "We want your first steps to feel easy, so we've put everything you need in one simple guide. It walks you through each part at your own pace, in plain language, and most people are up and running in well under an hour.",
    '',
    'Open the getting started guide:',
    guideUrl,
    '',
    'Your first steps',
    '1. Add what you offer. Set up your services so clients can book them.',
    "2. Set your hours. Tell ResNeo when you're open and when each person works. This is the most important step.",
    '3. Add your business details. Add your name and logo, then claim your own booking page address.',
    "4. Turn on payments (optional). Connect Stripe if you'd like to take a deposit or full payment at booking.",
    '',
    "There's a short how-to for each of these in the guide, plus pages on your calendar, contacts, reminders, reports and more.",
    '',
    "We're here to help",
    `You're never on your own with ResNeo. Email us any time at ${SUPPORT_EMAIL}, send a message from the Support page in your dashboard (${supportPageUrl}), or browse the help centre (${helpUrl}). We usually reply within 24 hours.`,
    '',
    'Refer and Earn: refer a venue, get a free month',
    `When another business signs up with your link, you both get a free month of credit. Find your personal link under Settings, Refer and Earn: ${referUrl}`,
    '',
    'Tell us what you think',
    `Your feedback shapes ResNeo. If something could work better, or there's a feature you'd love, send it from the Support page using the "Feature request" option, or just reply to this email. We read every message.`,
    '',
    "Here's to filling your diary,",
    'The ResNeo team',
    '',
    "You're receiving this email because you created a ResNeo account.",
    '(c) 2026 ResNeo, JAR 26 LTD (NI740269), 100a Main Street, Bangor, BT20 4AG, UK',
  ].join('\n');

  return { subject, html, text };
}

/**
 * Send the customer welcome email from hello@resneo.com (reply-to hello@) when a new account
 * signs up. Both provisioning paths call this right after sendNewSignupNotification, so it
 * inherits the same once-per-signup guarantee. Never throws: a welcome-send failure must not
 * fail the signup or trigger a Stripe webhook retry (and sendEmail already no-ops without an
 * API key or recipient).
 */
export async function sendWelcomeEmail(params: { to: string | null | undefined }): Promise<void> {
  if (!params.to?.trim()) return;
  try {
    const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
    const { subject, html, text } = renderWelcomeEmail(base);
    await sendEmail({
      to: params.to,
      subject,
      html,
      text,
      fromEmail: WELCOME_FROM_EMAIL,
      fromDisplayName: 'ResNeo',
      replyTo: WELCOME_FROM_EMAIL,
    });
  } catch (err) {
    console.error('[sendWelcomeEmail] failed (non-fatal):', err);
  }
}
