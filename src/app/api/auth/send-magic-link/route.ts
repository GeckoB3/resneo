import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/emails/send-email';
import { getStaffAuthBaseUrl } from '@/lib/staff-invite-redirect';
import { sanitizeMagicLinkNextPath } from '@/lib/safe-auth-redirect';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  /**
   * Path to redirect to after `/auth/confirm` verifies the token, e.g.
   * `/auth/callback` or `/auth/callback?next=%2Fdashboard`. Must be a
   * same-origin path (starts with `/`). Defaults to `/auth/callback`.
   */
  next: z.string().startsWith('/').optional(),
});

/**
 * POST /api/auth/send-magic-link — public endpoint.
 *
 * Sends a branded sign-in email from bookings@reserveni.com (via SendGrid) instead of
 * Supabase's default noreply@mail.app.supabase.io. Uses `generateLink` + `/auth/confirm`
 * (server-side OTP verification) — the same flow as staff invites.
 *
 * If SendGrid is not configured, returns `{ fallback: true }` so the client can fall
 * back to the browser-side `signInWithOtp` (which still works with PKCE).
 *
 * Security: always returns success to avoid revealing whether an email is registered.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { email, next } = parsed.data;
    const nextPath = sanitizeMagicLinkNextPath(next);
    const normalisedEmail = email.trim().toLowerCase();

    if (!process.env.SENDGRID_API_KEY?.trim()) {
      return NextResponse.json({ fallback: true });
    }

    const admin = getSupabaseAdminClient();
    const baseUrl = getStaffAuthBaseUrl(request);

    const { data: genData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: normalisedEmail,
    });

    if (linkErr || !genData) {
      console.error('[send-magic-link] generateLink:', linkErr?.message ?? 'no data');
      return NextResponse.json({ ok: true });
    }

    const hashedToken =
      (genData as { properties?: { hashed_token?: string } }).properties?.hashed_token ?? '';

    if (!hashedToken) {
      console.error('[send-magic-link] generateLink returned no hashed_token');
      return NextResponse.json({ ok: true });
    }

    const confirmUrl =
      `${baseUrl}/auth/confirm` +
      `?token_hash=${encodeURIComponent(hashedToken)}` +
      `&type=magiclink` +
      `&next=${encodeURIComponent(nextPath)}`;

    const text = [
      'Here is your sign-in link for ReserveNI.',
      '',
      'Open this link to sign in:',
      confirmUrl,
      '',
      'This link expires in 1 hour. If you did not request this, you can ignore it.',
    ].join('\n');

    const html = `
      <p>Here is your sign-in link for <strong>ReserveNI</strong>.</p>
      <p><a href="${confirmUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">Sign in to ReserveNI</a></p>
      <p style="font-size:12px;color:#64748b;">This link expires in 1 hour. If you did not request this, you can ignore it.</p>
    `;

    try {
      await sendEmail({
        to: normalisedEmail,
        subject: 'Sign in to ReserveNI',
        html,
        text,
        disableTracking: true,
      });
    } catch (err) {
      console.error('[send-magic-link] sendEmail:', err instanceof Error ? err.message : err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/send-magic-link failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
