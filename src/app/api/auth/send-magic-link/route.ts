import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/emails/send-email';
import { getStaffAuthBaseUrl } from '@/lib/staff-invite-redirect';
import { buildMagicLinkConfirmNextQuery } from '@/lib/safe-auth-redirect';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  /**
   * Post-login destination path (e.g. `/account`, `/dashboard`) or a full
   * `/auth/callback?next=…` value. Must start with `/`. Defaults to `/auth/callback`.
   */
  next: z.string().startsWith('/').optional(),
});

/**
 * POST /api/auth/send-magic-link — public endpoint.
 *
 * Sends a branded sign-in email from bookings@resneo.com (via SendGrid) instead of
 * Supabase's default noreply@mail.app.supabase.io. Uses `generateLink` + `/auth/confirm`
 * (server-side OTP verification) — the same flow as staff invites.
 *
 * If SendGrid is not configured, or link generation / email send fails, returns `{ fallback: true }`
 * so the client can fall back to `signInWithOtp` (PKCE + Supabase email).
 *
 * Security: on success paths that do not fall back, still returns a generic shape where appropriate
 * to avoid revealing whether an email is registered (see generateLink failure handling below).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { email, next } = parsed.data;
    const nextPath = buildMagicLinkConfirmNextQuery(next);
    const normalisedEmail = email.trim().toLowerCase();

    if (!process.env.SENDGRID_API_KEY?.trim()) {
      return NextResponse.json({ fallback: true });
    }

    const admin = getSupabaseAdminClient();
    const baseUrl = getStaffAuthBaseUrl(request);
    const redirectTo = `${baseUrl}/auth/callback`;

    const { data: genData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: normalisedEmail,
      options: {
        redirectTo,
      },
    });

    if (linkErr || !genData) {
      console.error('[send-magic-link] generateLink:', linkErr?.message ?? 'no data');
      return NextResponse.json({ fallback: true });
    }

    const hashedToken =
      (genData as { properties?: { hashed_token?: string } }).properties?.hashed_token ?? '';

    if (!hashedToken) {
      console.error('[send-magic-link] generateLink returned no hashed_token');
      return NextResponse.json({ fallback: true });
    }

    const confirmUrl =
      `${baseUrl}/auth/confirm` +
      `?token_hash=${encodeURIComponent(hashedToken)}` +
      `&type=magiclink` +
      `&next=${encodeURIComponent(nextPath)}`;

    const text = [
      'Here is your sign-in link for Resneo.',
      '',
      'Open this link to sign in:',
      confirmUrl,
      '',
      'This link expires in 1 hour. If you did not request this, you can ignore it.',
    ].join('\n');

    const html = `
      <p>Here is your sign-in link for <strong>Resneo</strong>.</p>
      <p><a href="${confirmUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">Sign in to Resneo</a></p>
      <p style="font-size:12px;color:#64748b;">This link expires in 1 hour. If you did not request this, you can ignore it.</p>
    `;

    try {
      await sendEmail({
        to: normalisedEmail,
        subject: 'Sign in to Resneo',
        html,
        text,
        disableTracking: true,
      });
    } catch (err) {
      console.error('[send-magic-link] sendEmail:', err instanceof Error ? err.message : err);
      return NextResponse.json({ fallback: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/send-magic-link failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
