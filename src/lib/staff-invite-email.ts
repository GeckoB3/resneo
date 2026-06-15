/**
 * Staff access emails.
 *
 * Why NOT `signInWithOtp` server-side:
 *   `signInWithOtp` requires a **browser** context to store the PKCE code verifier in session
 *   storage. Called from a server API route (no browser), Supabase cannot store the verifier and
 *   generates a plain OTP token (no `pkce_` prefix). After the user clicks, Supabase uses implicit
 *   flow (`#access_token=…` in hash). `/auth/callback` expects a PKCE `code=` query param, finds
 *   none, and fails with `exchange_failed`.
 *
 * Primary path (SendGrid configured):
 *   1. Ensure auth user exists and metadata is set.
 *   2. `admin.generateLink({ type: 'magiclink' })` → extract `hashed_token`.
 *   3. Build `${baseUrl}/auth/confirm?token_hash=…&type=magiclink&next=/auth/set-password`.
 *   4. Email that URL via SendGrid (disableTracking — tracking wrappers break token URLs).
 *   `/auth/confirm` calls server-side `verifyOtp`, sets session in cookies, redirects to
 *   `/auth/set-password`. No PKCE involved — works reliably from a server context.
 *
 * Fallback (no SendGrid or send failure):
 *   `inviteUserByEmail` — Supabase sends its own email. The invite token type works with the
 *   `/auth/callback?next=/auth/set-password` redirect because Supabase's email templates send
 *   the user through its own verify endpoint with a `code` param when PKCE is enabled.
 */
import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/emails/send-email';

export type StaffAccessLinkChannel = 'sendgrid' | 'supabase_invite';

function isSendGridConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY?.trim());
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type StaffAccessLinkResult =
  | { ok: true; channel: StaffAccessLinkChannel }
  | { ok: false; error: string; status: number }
  /** Auth user already exists (e.g. invited elsewhere); caller may still insert staff with invite_email_sent: false. */
  | { ok: false; error: string; status: 409; allowStaffInsertWithoutEmail: true };

export async function deliverStaffAccessLinkEmail(params: {
  admin: SupabaseClient;
  email: string;
  /** Base URL e.g. `https://www.reserveni.com` — used to build the /auth/confirm link. */
  baseUrl: string;
  /** Merged into auth user_metadata; must include has_set_password: false for new staff. */
  userMetadata: Record<string, unknown>;
  venueName: string;
}): Promise<StaffAccessLinkResult> {
  const { admin, email, baseUrl, userMetadata, venueName } = params;
  const normalisedEmail = email.trim().toLowerCase();

  if (isSendGridConfigured()) {
    const ensured = await ensureAuthUserWithStaffMetadata(admin, normalisedEmail, userMetadata);
    if (!ensured.ok) {
      return { ok: false, error: ensured.error, status: ensured.status };
    }

    const sendResult = await generateConfirmLinkAndSendEmail(
      admin,
      normalisedEmail,
      baseUrl,
      userMetadata,
      venueName,
    );

    if (sendResult.ok) {
      return { ok: true, channel: 'sendgrid' };
    }

    console.error('[staff-invite-email] primary path failed:', sendResult.error);

    if (ensured.createdUserId) {
      const { error: delErr } = await admin.auth.admin.deleteUser(ensured.createdUserId);
      if (delErr) {
        console.error('[staff-invite-email] deleteUser after failed send:', delErr);
      }
    }
  }

  const inviteRedirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent('/auth/set-password')}`;

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalisedEmail, {
    redirectTo: inviteRedirectTo,
    data: userMetadata as Record<string, string | boolean>,
  });

  if (!inviteErr) {
    return { ok: true, channel: 'supabase_invite' };
  }

  const msg = inviteErr.message?.toLowerCase() ?? '';
  const alreadyExists =
    msg.includes('already') || msg.includes('registered') || msg.includes('exists') || msg.includes('duplicate');

  if (alreadyExists) {
    return {
      ok: false,
      error: 'Auth user already exists; email was not sent.',
      status: 409,
      allowStaffInsertWithoutEmail: true,
    };
  }

  console.error('[staff-invite-email] inviteUserByEmail fallback:', inviteErr);
  return {
    ok: false,
    error: inviteErr.message ?? 'Failed to send invite',
    status: 500,
  };
}

export async function resendStaffAccessLinkEmail(params: {
  admin: SupabaseClient;
  email: string;
  baseUrl: string;
  userMetadata: Record<string, unknown>;
  venueName: string;
}): Promise<
  | { ok: true; channel: StaffAccessLinkChannel }
  | { ok: false; error: string; status: number }
> {
  const { admin, email, baseUrl, userMetadata, venueName } = params;
  const normalisedEmail = email.trim().toLowerCase();

  if (isSendGridConfigured()) {
    const ensured = await ensureAuthUserWithStaffMetadata(admin, normalisedEmail, userMetadata);
    if (!ensured.ok) {
      return { ok: false, error: ensured.error, status: ensured.status };
    }

    const sendResult = await generateConfirmLinkAndSendEmail(
      admin,
      normalisedEmail,
      baseUrl,
      userMetadata,
      venueName,
    );

    if (sendResult.ok) {
      return { ok: true, channel: 'sendgrid' };
    }

    console.error('[staff-invite-email] resend primary path failed:', sendResult.error);

    if (ensured.createdUserId) {
      const { error: delErr } = await admin.auth.admin.deleteUser(ensured.createdUserId);
      if (delErr) {
        console.error('[staff-invite-email] deleteUser after failed resend:', delErr);
      }
    }
  }

  const inviteRedirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent('/auth/set-password')}`;

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalisedEmail, {
    redirectTo: inviteRedirectTo,
    data: userMetadata as Record<string, string | boolean>,
  });

  if (!inviteErr) {
    return { ok: true, channel: 'supabase_invite' };
  }

  const msg = inviteErr.message?.toLowerCase() ?? '';
  const alreadyExists =
    msg.includes('already') || msg.includes('registered') || msg.includes('exists') || msg.includes('duplicate');

  if (alreadyExists) {
    return {
      ok: false,
      error:
        'Could not send a sign-in link. Configure SENDGRID_API_KEY and SENDGRID_FROM_EMAIL, or ask the team member to use the Magic link tab on the login page.',
      status: 503,
    };
  }

  console.error('[staff-invite-email] resend inviteUserByEmail fallback:', inviteErr);
  return {
    ok: false,
    error: inviteErr.message ?? 'Failed to send invite',
    status: 500,
  };
}

async function ensureAuthUserWithStaffMetadata(
  admin: SupabaseClient,
  normalisedEmail: string,
  userMetadata: Record<string, unknown>,
): Promise<{ ok: true; createdUserId: string | null } | { ok: false; error: string; status: number }> {
  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    console.error('[staff-invite-email] listUsers:', listErr);
    return { ok: false, error: 'Could not look up auth user', status: 500 };
  }

  const existing = listData?.users?.find((u) => u.email?.toLowerCase() === normalisedEmail);

  if (existing) {
    const merged = { ...(existing.user_metadata ?? {}), ...userMetadata };
    if (existing.user_metadata?.has_set_password === true) {
      merged.has_set_password = true;
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, { user_metadata: merged });
    if (updErr) {
      console.error('[staff-invite-email] updateUserById:', updErr);
      return { ok: false, error: 'Could not update auth profile for this staff member', status: 500 };
    }
    return { ok: true, createdUserId: null };
  }

  const tempPassword = randomBytes(32).toString('hex');
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: normalisedEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: userMetadata,
  });

  if (createErr) {
    const createMsg = createErr.message?.toLowerCase() ?? '';
    if (createMsg.includes('already') || createMsg.includes('registered') || createMsg.includes('exists')) {
      return { ok: false, error: 'This email is already registered. Try resending the invite.', status: 409 };
    }
    console.error('[staff-invite-email] createUser:', createErr);
    return { ok: false, error: 'Could not create auth user for this staff member', status: 500 };
  }

  return { ok: true, createdUserId: created.user.id };
}

/**
 * Generates a `hashed_token` via the Supabase Admin API and emails a URL that points to our own
 * `/auth/confirm` server route. That route calls `verifyOtp({ token_hash, type })` server-side
 * (no PKCE verifier needed) and redirects to `/auth/set-password`.
 */
async function generateConfirmLinkAndSendEmail(
  admin: SupabaseClient,
  normalisedEmail: string,
  baseUrl: string,
  userMetadata: Record<string, unknown>,
  venueName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: genData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: normalisedEmail,
    options: {
      data: userMetadata as Record<string, string | boolean>,
    },
  });

  const hashedToken =
    (genData as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token ?? '';

  if (linkErr || !hashedToken) {
    return { ok: false, error: linkErr?.message ?? 'generateLink returned no hashed_token' };
  }

  const confirmUrl =
    `${baseUrl}/auth/confirm` +
    `?token_hash=${encodeURIComponent(hashedToken)}` +
    `&type=magiclink` +
    `&next=${encodeURIComponent('/auth/set-password')}`;

  const subject = `Sign in to ${venueName} — ResNeo`;
  const text = [
    `You were invited to access the dashboard for ${venueName}.`,
    '',
    'Open this link to sign in and create your password:',
    confirmUrl,
    '',
    'If you did not expect this email, you can ignore it.',
  ].join('\n');

  const html = `
    <p>You were invited to access the dashboard for <strong>${escapeHtml(venueName)}</strong>.</p>
    <p><a href="${escapeHtml(confirmUrl)}">Sign in and continue</a></p>
    <p style="font-size:12px;color:#64748b;">If you did not expect this email, you can ignore it.</p>
  `;

  try {
    const messageId = await sendEmail({
      to: normalisedEmail,
      subject,
      html,
      text,
      disableTracking: true,
    });
    if (!messageId) {
      return { ok: false, error: 'SendGrid returned no message id (check SENDGRID_API_KEY)' };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
