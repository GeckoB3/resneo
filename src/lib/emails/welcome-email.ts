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
  const logoUrl = `${base}/Logo.png`;
  const guideUrl = `${base}/help/getting-started`;
  const helpUrl = `${base}/help`;
  const referUrl = `${base}/dashboard/settings?tab=refer-earn`;
  const appStoreUrl = 'https://apple.co/4eNTo3d';
  const googlePlayUrl = 'https://play.google.com/store/apps/details?id=com.resneo.app';
  const instagramUrl = 'https://www.instagram.com/resneohq/';
  const facebookUrl = 'https://www.facebook.com/resneohq';
  const siteUrl = 'https://www.resneo.com';

  const subject = "Welcome to ResNeo, let's get you started";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@media only screen and (max-width:480px){
  .app-btn{display:block !important;width:100% !important;margin:0 0 10px !important;}
  .app-btn a{display:block !important;}
  .app-btn-gap{display:none !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#F4F0E9;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F0E9">
<tr><td align="center" style="padding:36px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 10px 34px rgba(2,38,74,0.07)">

<tr><td align="center" style="padding:42px 40px 0">
<img src="${logoUrl}" alt="ResNeo" width="150" height="35" style="display:block;width:150px;height:auto;border:0;margin:0 auto" />
</td></tr>

<tr><td align="center" style="padding:28px 44px 0">
<h1 style="margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:28px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:#003B6F">Welcome to ResNeo</h1>
<div style="width:42px;height:4px;background-color:#00C2C7;border-radius:40px;margin:18px auto 0"></div>
</td></tr>

<tr><td align="center" style="padding:16px 52px 0">
<p style="margin:0;font-size:16px;line-height:1.6;color:#717D89">Your 14-day free trial starts now. Let's get you set up and taking bookings.</p>
</td></tr>

<tr><td style="padding:28px 44px 4px;font-size:16px;line-height:1.75;color:#4A5663">
<p style="margin:0 0 16px">Welcome aboard. We're glad you're here.</p>
<p style="margin:0 0 16px">What started as a chat between a few friends at the school gates in Holywood, Co. Down has grown into a platform with one job: giving independent businesses back their time, control, and hard-earned profits.</p>
<p style="margin:0">The fastest way to get started is to log in and complete the step-by-step onboarding. After that, check out our getting started guide, where you'll find all the help and information you need to get fully ready for action.</p>
</td></tr>

<tr><td align="center" style="padding:28px 44px 10px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
<td style="background-color:#003B6F;border-radius:40px;text-align:center"><a href="${guideUrl}" target="_blank" style="display:inline-block;padding:15px 34px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:40px">Open the getting started guide</a></td>
</tr></table>
</td></tr>

<tr><td style="padding:10px 30px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBF2E7;border-radius:18px">
<tr><td style="padding:26px 26px">
<div style="font-size:18px;font-weight:600;color:#15324C;margin:0 0 7px">Take ResNeo with you</div>
<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#5E5446">Your business diary, wherever you go. Download the official ResNeo app straight to your phone.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="app-btn" style="background-color:#003B6F;border-radius:40px;text-align:center"><a href="${appStoreUrl}" target="_blank" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:40px">Download the iPhone app</a></td>
<td class="app-btn-gap" style="width:12px;font-size:0;line-height:0">&nbsp;</td>
<td class="app-btn" style="background-color:#003B6F;border-radius:40px;text-align:center"><a href="${googlePlayUrl}" target="_blank" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:40px">Download the Android app</a></td>
</tr></table>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:26px 44px 4px;font-size:16px;line-height:1.7;color:#4A5663">
<h2 style="margin:0 0 10px;font-size:19px;font-weight:600;color:#003B6F">Need a hand?</h2>
<p style="margin:0 0 12px">We aren't a faceless tech giant. We're a small, friendly team, and we genuinely want this to work for you.</p>
<p style="margin:0">If you get stuck, want help moving your old client list over, or just fancy a chat about getting your setup right, reply straight to this email, write to us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#0E7C84;font-weight:600;text-decoration:none">${SUPPORT_EMAIL}</a>, or send a DM on <a href="${instagramUrl}" target="_blank" style="color:#0E7C84;font-weight:600;text-decoration:none">Instagram</a> or <a href="${facebookUrl}" target="_blank" style="color:#0E7C84;font-weight:600;text-decoration:none">Facebook</a> (@resneohq). You can also browse the <a href="${helpUrl}" target="_blank" style="color:#0E7C84;font-weight:600;text-decoration:none">help centre</a> any time. We usually reply within 24 hours.</p>
</td></tr>

<tr><td style="padding:20px 30px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E7FAFA;border-radius:18px">
<tr><td style="padding:24px 26px">
<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#097075;margin:0 0 7px">Refer and Earn</div>
<div style="font-size:18px;font-weight:600;color:#15324C;margin:0 0 8px">Refer a venue, get a free month</div>
<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#45595F">Know another business that would love ResNeo? When they sign up with your link, you both get a free month of credit. You'll find your personal link under Settings, Refer and Earn.</p>
<a href="${referUrl}" target="_blank" style="font-size:15px;color:#00696F;font-weight:600;text-decoration:none">Get your referral link &#8594;</a>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:28px 44px 4px;font-size:16px;line-height:1.75;color:#4A5663">
<p style="margin:0 0 16px">Thank you for backing local tech and choosing to reclaim your high street margins. Let's get to work!</p>
<p style="margin:0 0 4px">Best regards,</p>
<p style="margin:0;font-weight:600;color:#15324C">Ryan, John and Andrew</p>
<p style="margin:0 0 12px;color:#15324C">The ResNeo team</p>
<a href="${siteUrl}" target="_blank" style="font-size:15px;color:#0E7C84;font-weight:600;text-decoration:none">www.resneo.com</a>
</td></tr>

<tr><td style="padding:26px 44px 40px">
<div style="border-top:1px solid #EFE7DB;padding-top:18px;font-size:12px;line-height:1.7;color:#A39A8C">
<p style="margin:0 0 6px">You're receiving this email because you created a ResNeo account.</p>
<p style="margin:0;color:#B8B0A3">&copy; 2026 ResNeo &middot; JAR 26 LTD (NI740269) &middot; 100a Main Street, Bangor, BT20 4AG, UK</p>
</div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    'Welcome to ResNeo',
    '',
    "Welcome aboard. We're glad you're here.",
    '',
    'What started as a chat between a few friends at the school gates in Holywood, Co. Down has grown into a platform with one job: giving independent businesses back their time, control, and hard-earned profits.',
    '',
    "The fastest way to get started is to log in and complete the step-by-step onboarding. After that, check out our getting started guide, where you'll find all the help and information you need to get fully ready for action.",
    '',
    'Open the getting started guide:',
    guideUrl,
    '',
    'Take ResNeo with you',
    'Your business diary, wherever you go. Download the official ResNeo app straight to your phone.',
    `Download the iPhone app: ${appStoreUrl}`,
    `Download the Android app: ${googlePlayUrl}`,
    '',
    'Need a hand?',
    `We aren't a faceless tech giant. We're a small, friendly team, and we genuinely want this to work for you. If you get stuck, want help moving your old client list over, or just fancy a chat about getting your setup right, reply straight to this email, write to us at ${SUPPORT_EMAIL}, or send a DM on Instagram (${instagramUrl}) or Facebook (${facebookUrl}) (@resneohq). You can also browse the help centre (${helpUrl}) any time. We usually reply within 24 hours.`,
    '',
    'Refer and Earn: refer a venue, get a free month',
    `When another business signs up with your link, you both get a free month of credit. Find your personal link under Settings, Refer and Earn: ${referUrl}`,
    '',
    "Thank you for backing local tech and choosing to reclaim your high street margins. Let's get to work!",
    '',
    'Best regards,',
    'Ryan, John and Andrew',
    'The ResNeo team',
    siteUrl,
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
