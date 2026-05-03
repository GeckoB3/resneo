import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import sgMail from '@sendgrid/mail';
import { z } from 'zod';

const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

const SUPPORT_TO = 'support@reserveni.com';
const FROM = { email: 'hello@reserveni.com', name: 'ReserveNI' };

const supportSchema = z
  .object({
    subject: z.string().min(1, 'Subject is required').max(200),
    message: z.string().min(1, 'Message is required').max(5000),
    category: z.enum(['general', 'billing', 'technical', 'feature_request']).optional(),
    contact_email: z.string().trim().max(255).optional(),
    contact_phone: z.string().trim().max(40).optional(),
  })
  .superRefine((data, ctx) => {
    const e = data.contact_email?.trim();
    if (e && !z.string().email().safeParse(e).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid email address', path: ['contact_email'] });
    }
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = supportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { subject, message, category, contact_email, contact_phone } = parsed.data;
    const contactEmailTrimmed = contact_email?.trim() || undefined;
    const contactPhoneTrimmed = contact_phone?.trim() || undefined;

    const admin = (await import('@/lib/supabase')).getSupabaseAdminClient();
    const { data: venue } = await admin
      .from('venues')
      .select('name')
      .eq('id', staff.venue_id)
      .single();

    const venueName = venue?.name ?? 'Unknown venue';
    const categoryLabel = category
      ? { general: 'General', billing: 'Billing', technical: 'Technical', feature_request: 'Feature Request' }[category]
      : 'General';

    if (!apiKey) {
      console.error('[support] SENDGRID_API_KEY not set');
      return NextResponse.json(
        { error: 'Email is not configured. Please try again later.' },
        { status: 500 },
      );
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc">
<tr><td style="padding:24px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
<tr><td style="padding:24px;border-bottom:3px solid #4E6B78"><h1 style="margin:0;font-size:20px;color:#1e293b">Support request from ${escapeHtml(venueName)}</h1></td></tr>
<tr><td style="padding:24px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">Venue</td><td style="padding:8px 0;color:#1e293b">${escapeHtml(venueName)}</td></tr>
<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">Staff account</td><td style="padding:8px 0;color:#1e293b">${escapeHtml(staff.email)}</td></tr>
<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">Contact email</td><td style="padding:8px 0;color:#1e293b">${contactEmailTrimmed ? escapeHtml(contactEmailTrimmed) : '—'}</td></tr>
<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">Contact phone</td><td style="padding:8px 0;color:#1e293b">${contactPhoneTrimmed ? escapeHtml(contactPhoneTrimmed) : '—'}</td></tr>
<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">Category</td><td style="padding:8px 0;color:#1e293b">${escapeHtml(categoryLabel)}</td></tr>
<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">Subject</td><td style="padding:8px 0;color:#1e293b">${escapeHtml(subject)}</td></tr>
<tr><td style="padding:8px 12px 8px 0;font-weight:600;color:#475569;vertical-align:top">Message</td><td style="padding:8px 0;color:#1e293b;white-space:pre-wrap">${escapeHtml(message)}</td></tr>
</table>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

    try {
      await sgMail.send({
        to: SUPPORT_TO,
        from: FROM,
        replyTo: contactEmailTrimmed ?? staff.email,
        subject: `[${categoryLabel}] ${subject} - ${venueName}`,
        html,
      });
    } catch (err: unknown) {
      const sgErr = err as { response?: { body?: unknown } };
      if (sgErr?.response?.body) {
        console.error('[support] SendGrid error body:', JSON.stringify(sgErr.response.body));
      }
      console.error('[support] Failed to send support email:', err);
      return NextResponse.json(
        { error: 'Failed to send your message. Please try again later.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST /api/venue/support failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
