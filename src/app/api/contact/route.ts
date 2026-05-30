import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

const CONTACT_TO = process.env.CONTACT_TO?.trim() || 'hello@resneo.com';
const FROM = { email: 'hello@resneo.com', name: 'Resneo' };

const MAX_MESSAGE_LENGTH = 2000;

/** Validated payload: name and email are set. */
interface ContactPayload {
  name: string;
  email: string;
  phone?: string;
  restaurantName?: string;
  message?: string;
}

function validate(body: unknown): { ok: true; data: ContactPayload } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid request body.' };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  const phone = typeof b.phone === 'string' ? b.phone.trim() : undefined;
  const restaurantName = typeof b.restaurantName === 'string' ? b.restaurantName.trim() : undefined;
  const message = typeof b.message === 'string' ? b.message : undefined;

  if (name.length < 2) {
    return { ok: false, error: 'Please enter your name (at least 2 characters).' };
  }
  if (!email) {
    return { ok: false, error: 'Please enter your email address.' };
  }
  if (!z.string().email().safeParse(email).success) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (phone !== undefined && phone !== '') {
    const e164 = normalizeToE164(phone, 'GB');
    if (!e164) {
      return { ok: false, error: 'Please enter a valid phone number.' };
    }
  }
  if (message !== undefined && message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: 'Message must be under 2000 characters.' };
  }

  const phoneNormalised =
    phone !== undefined && phone !== '' ? normalizeToE164(phone, 'GB') ?? undefined : undefined;

  return {
    ok: true,
    data: { name, email, phone: phoneNormalised, restaurantName, message } as ContactPayload,
  };
}

function buildNotificationHtml(data: ContactPayload): string {
  const rows: Array<[string, string]> = [
    ['Name', data.name],
    ['Email', data.email],
    ...(data.phone ? [['Phone', data.phone] as [string, string]] : []),
    ...(data.restaurantName ? [['Restaurant', data.restaurantName] as [string, string]] : []),
    ...(data.message ? [['Message', data.message] as [string, string]] : []),
  ];
  const tds = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">${escapeHtml(label)}</td><td style="padding:8px 0;color:#1e293b">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc">
<tr><td style="padding:24px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
<tr><td style="padding:24px;border-bottom:3px solid #003B6F"><h1 style="margin:0;font-size:20px;color:#1e293b">New contact form enquiry</h1></td></tr>
<tr><td style="padding:24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${tds}</table></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(ip, 'contact', 3, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const companyWebsite = typeof body.company_website === 'string' ? body.company_website.trim() : '';
    if (companyWebsite) {
      return NextResponse.json({ success: true });
    }

    const validated = validate(body);
    if (!validated.ok) {
      return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
    }
    const { data } = validated;

    if (!apiKey) {
      console.error('[contact] SENDGRID_API_KEY not set');
      return NextResponse.json(
        { success: false, error: 'Email is not configured. Please try again later.' },
        { status: 500 },
      );
    }

    const subjectNotification = data.restaurantName
      ? `New enquiry from ${data.name} (${data.restaurantName})`
      : `New enquiry from ${data.name}`;

    try {
      await sgMail.send({
        to: CONTACT_TO,
        from: FROM,
        subject: subjectNotification,
        html: buildNotificationHtml(data),
      });
    } catch (err: unknown) {
      const sgErr = err as { response?: { body?: unknown } };
      if (sgErr?.response?.body) {
        console.error('[contact] SendGrid error body:', JSON.stringify(sgErr.response.body));
      }
      console.error('[contact] Failed to send notification email:', err);
      return NextResponse.json(
        { success: false, error: 'Failed to send your message. Please try again later.' },
        { status: 500 },
      );
    }

    try {
      const confirmationHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc">
<tr><td style="padding:24px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
<tr><td style="padding:24px;border-bottom:3px solid #003B6F"><h1 style="margin:0;font-size:20px;color:#1e293b">Thanks for your interest in Resneo</h1></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6;color:#1e293b">
<p>Hi ${escapeHtml(data.name)},</p>
<p>We've received your enquiry and will be in touch shortly.</p>
<p>Best regards,<br>The Resneo Team</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
      await sgMail.send({
        to: data.email,
        from: FROM,
        subject: 'Thanks for your interest in Resneo',
        html: confirmationHtml,
      });
    } catch (err) {
      console.error('[contact] Failed to send confirmation email:', err);
      // Do not fail the request; notification was sent.
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[contact] Unexpected error:', err);
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again later.' },
      { status: 500 },
    );
  }
}
