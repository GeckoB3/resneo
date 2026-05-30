import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupAuthUserIdByEmail } from '@/lib/auth/ensure-auth-user-for-email';
import { sendEmail } from '@/lib/emails/send-email';
import { getStaffAuthBaseUrl } from '@/lib/staff-invite-redirect';
import { sanitizeAuthNextPath } from '@/lib/safe-auth-redirect';
import {
  PLATFORM_ROLE_KEY,
  PLATFORM_ROLE_VALUE,
  PLATFORM_SUPERUSER_REGISTERED_KEY,
} from '@/lib/platform-auth';

export interface PlatformSuperuserRow {
  user_id: string;
  email: string;
  created_at: string;
  created_by: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mergeSuperuserAppMetadata(prev: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(prev ?? {}),
    [PLATFORM_ROLE_KEY]: PLATFORM_ROLE_VALUE,
    [PLATFORM_SUPERUSER_REGISTERED_KEY]: true,
  };
}

function stripSuperuserAppMetadata(prev: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = { ...(prev ?? {}) };
  delete next[PLATFORM_ROLE_KEY];
  delete next[PLATFORM_SUPERUSER_REGISTERED_KEY];
  return next;
}

export async function listActivePlatformSuperusers(
  admin: SupabaseClient,
  options?: { sessionSuperuserUserId?: string },
): Promise<PlatformSuperuserRow[]> {
  const { data: rows, error } = await admin
    .from('platform_superusers')
    .select('user_id, email, created_at, created_by')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[platform-superusers] list rows:', error.message);
    throw new Error('Failed to list platform superusers');
  }

  const out: PlatformSuperuserRow[] = [];
  for (const r of rows ?? []) {
    const userId = r.user_id as string;
    const { data: uwrap, error: ue } = await admin.auth.admin.getUserById(userId);
    if (ue || !uwrap.user) {
      console.warn('[platform-superusers] missing auth user for row', { userId, message: ue?.message });
      continue;
    }
    const u = uwrap.user;
    out.push({
      user_id: userId,
      email: (u.email ?? (r.email as string)).toLowerCase().trim(),
      created_at: r.created_at as string,
      created_by: (r.created_by as string | null) ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      email_confirmed_at: u.email_confirmed_at ?? null,
    });
  }

  const sid = options?.sessionSuperuserUserId?.trim();
  if (sid && !out.some((row) => row.user_id === sid)) {
    const { data: uwrap, error: ue } = await admin.auth.admin.getUserById(sid);
    if (!ue && uwrap.user) {
      const u = uwrap.user;
      const email = (u.email ?? '').toLowerCase().trim();
      if (email) {
        out.push({
          user_id: sid,
          email,
          created_at: u.created_at ?? new Date().toISOString(),
          created_by: null,
          last_sign_in_at: u.last_sign_in_at ?? null,
          email_confirmed_at: u.email_confirmed_at ?? null,
        });
      }
    }
  }

  out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return out;
}

async function assertNoActiveRowForEmail(admin: SupabaseClient, email: string): Promise<void> {
  const { data, error } = await admin
    .from('platform_superusers')
    .select('user_id')
    .eq('email', email)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) {
    console.error('[platform-superusers] duplicate check:', error.message);
    throw new Error('Failed to verify email availability');
  }
  if (data) {
    throw Object.assign(new Error('This email is already an active platform superuser.'), { status: 409 });
  }
}

export async function createPlatformSuperuserWithPassword(params: {
  admin: SupabaseClient;
  email: string;
  password: string;
  createdBy: string;
}): Promise<{ user_id: string }> {
  const email = params.email.trim().toLowerCase();
  await assertNoActiveRowForEmail(params.admin, email);

  const existingId = await lookupAuthUserIdByEmail(params.admin, email);
  if (existingId) {
    const { data: uwrap, error: ge } = await params.admin.auth.admin.getUserById(existingId);
    if (ge || !uwrap.user) {
      throw new Error('Could not load existing auth user');
    }
    const { error: pwErr } = await params.admin.auth.admin.updateUserById(existingId, {
      password: params.password,
      app_metadata: mergeSuperuserAppMetadata(uwrap.user.app_metadata as Record<string, unknown> | undefined),
      user_metadata: { ...(uwrap.user.user_metadata ?? {}), has_set_password: true },
    });
    if (pwErr) {
      console.error('[platform-superusers] updateUser password:', pwErr.message);
      throw new Error(pwErr.message || 'Could not set password');
    }
    const { error: insErr } = await params.admin.from('platform_superusers').upsert(
      {
        user_id: existingId,
        email,
        created_by: params.createdBy,
        revoked_at: null,
      },
      { onConflict: 'user_id' },
    );
    if (insErr) {
      console.error('[platform-superusers] insert row:', insErr.message);
      const { data: uwrap2 } = await params.admin.auth.admin.getUserById(existingId);
      await params.admin.auth.admin.updateUserById(existingId, {
        app_metadata: stripSuperuserAppMetadata(uwrap2.user?.app_metadata as Record<string, unknown> | undefined),
      });
      throw new Error('Could not save platform superuser record');
    }
    return { user_id: existingId };
  }

  const { data: created, error: cErr } = await params.admin.auth.admin.createUser({
    email,
    password: params.password,
    email_confirm: true,
    app_metadata: mergeSuperuserAppMetadata(undefined),
    user_metadata: { has_set_password: true },
  });
  if (cErr || !created.user?.id) {
    const msg = cErr?.message?.toLowerCase() ?? '';
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      throw Object.assign(new Error('This email is already registered.'), { status: 409 });
    }
    console.error('[platform-superusers] createUser:', cErr?.message);
    throw new Error(cErr?.message ?? 'Could not create auth user');
  }

  const userId = created.user.id;
  const { error: insErr } = await params.admin.from('platform_superusers').insert({
    user_id: userId,
    email,
    created_by: params.createdBy,
  });
  if (insErr) {
    console.error('[platform-superusers] insert after create:', insErr.message);
    await params.admin.auth.admin.deleteUser(userId);
    throw new Error('Could not save platform superuser record');
  }

  return { user_id: userId };
}

export async function createPlatformSuperuserWithMagicLink(params: {
  admin: SupabaseClient;
  email: string;
  baseUrl: string;
  createdBy: string;
}): Promise<{ user_id: string; channel: 'sendgrid' | 'supabase_invite' }> {
  const email = params.email.trim().toLowerCase();
  await assertNoActiveRowForEmail(params.admin, email);

  const existingAtStart = await lookupAuthUserIdByEmail(params.admin, email);
  const sendGridConfigured = Boolean(process.env.SENDGRID_API_KEY?.trim());
  if (!sendGridConfigured && existingAtStart) {
    throw Object.assign(
      new Error(
        'SendGrid is not configured: magic links to an existing account are not supported. Use the password option or set SENDGRID_API_KEY.',
      ),
      { status: 400 },
    );
  }

  let userId = existingAtStart;
  let createdEphemeral = false;

  if (!userId) {
    const tempPassword = randomBytes(32).toString('hex');
    const { data: created, error: cErr } = await params.admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { has_set_password: false },
    });
    if (cErr || !created.user?.id) {
      const msg = cErr?.message?.toLowerCase() ?? '';
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        userId = await lookupAuthUserIdByEmail(params.admin, email);
      }
      if (!userId) {
        console.error('[platform-superusers] createUser magic:', cErr?.message);
        throw new Error(cErr?.message ?? 'Could not create auth user');
      }
    } else {
      userId = created.user.id;
      createdEphemeral = true;
    }
  }

  const nextPath = sanitizeAuthNextPath('/super');
  const base = params.baseUrl.replace(/\/$/, '');

  if (sendGridConfigured) {
    const { data: genData, error: linkErr } = await params.admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {},
    });
    const hashedToken =
      (genData as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token ?? '';
    if (linkErr || !hashedToken) {
      if (createdEphemeral && userId) {
        await params.admin.auth.admin.deleteUser(userId);
      }
      console.error('[platform-superusers] generateLink:', linkErr?.message);
      throw new Error(linkErr?.message ?? 'Could not generate sign-in link');
    }

    const confirmUrl =
      `${base}/auth/confirm` +
      `?token_hash=${encodeURIComponent(hashedToken)}` +
      `&type=magiclink` +
      `&next=${encodeURIComponent(nextPath)}`;

    const subject = 'Resneo platform access';
    const text = [
      'You have been granted access to the Resneo platform dashboard (superuser).',
      '',
      'Open this link to sign in:',
      confirmUrl,
      '',
      'If you did not expect this email, contact your administrator.',
    ].join('\n');

    const html = `
      <p>You have been granted access to the <strong>Resneo</strong> platform dashboard (superuser).</p>
      <p><a href="${escapeHtml(confirmUrl)}">Sign in to the platform</a></p>
      <p style="font-size:12px;color:#64748b;">If you did not expect this email, contact your administrator.</p>
    `;

    try {
      const messageId = await sendEmail({
        to: email,
        subject,
        html,
        text,
        disableTracking: true,
      });
      if (!messageId) {
        if (createdEphemeral && userId) await params.admin.auth.admin.deleteUser(userId);
        throw new Error('SendGrid is not configured correctly (no message id).');
      }
    } catch (e) {
      if (createdEphemeral && userId) await params.admin.auth.admin.deleteUser(userId);
      throw e instanceof Error ? e : new Error('Failed to send email');
    }
  } else {
    const redirectTo = `${base}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error: invErr } = await params.admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { has_set_password: false } as Record<string, string | boolean>,
    });
    if (invErr) {
      if (createdEphemeral && userId) await params.admin.auth.admin.deleteUser(userId);
      console.error('[platform-superusers] inviteUserByEmail:', invErr.message);
      throw new Error(invErr.message ?? 'Could not send Supabase invite email');
    }
    userId = (await lookupAuthUserIdByEmail(params.admin, email)) ?? userId;
    if (!userId) {
      throw new Error('Invite sent but user id could not be resolved.');
    }
  }

  const { data: uwrap } = await params.admin.auth.admin.getUserById(userId);
  const { error: metaErr } = await params.admin.auth.admin.updateUserById(userId, {
    app_metadata: mergeSuperuserAppMetadata(uwrap.user?.app_metadata as Record<string, unknown> | undefined),
  });
  if (metaErr) {
    console.error('[platform-superusers] grant app_metadata after email:', metaErr.message);
    if (createdEphemeral && userId) {
      await params.admin.auth.admin.deleteUser(userId);
    }
    throw new Error('User was created but superuser role could not be applied. Check Supabase Auth logs.');
  }

  const { error: insErr } = await params.admin.from('platform_superusers').upsert(
    {
      user_id: userId,
      email,
      created_by: params.createdBy,
      revoked_at: null,
    },
    { onConflict: 'user_id' },
  );
  if (insErr) {
    console.error('[platform-superusers] insert row magic:', insErr.message);
    const { data: uwrap2 } = await params.admin.auth.admin.getUserById(userId);
    await params.admin.auth.admin.updateUserById(userId, {
      app_metadata: stripSuperuserAppMetadata(uwrap2.user?.app_metadata as Record<string, unknown> | undefined),
    });
    if (createdEphemeral) {
      await params.admin.auth.admin.deleteUser(userId);
    }
    throw new Error('Could not save platform superuser record');
  }

  return { user_id: userId, channel: sendGridConfigured ? 'sendgrid' : 'supabase_invite' };
}

export async function revokePlatformSuperuser(params: {
  admin: SupabaseClient;
  targetUserId: string;
  actorUserId: string;
}): Promise<void> {
  if (params.targetUserId === params.actorUserId) {
    throw Object.assign(new Error('You cannot revoke your own platform access while signed in.'), { status: 400 });
  }

  const envBackup = Boolean(process.env.PLATFORM_SUPERUSER_EMAILS?.trim());
  const { count, error: cErr } = await params.admin
    .from('platform_superusers')
    .select('user_id', { count: 'exact', head: true })
    .is('revoked_at', null);
  if (cErr) {
    console.error('[platform-superusers] count active:', cErr.message);
    throw new Error('Could not verify superuser count');
  }
  const active = count ?? 0;
  if (active <= 1 && !envBackup) {
    throw Object.assign(
      new Error(
        'Refusing to revoke the last database-backed superuser while PLATFORM_SUPERUSER_EMAILS is empty. Add a bootstrap email first.',
      ),
      { status: 403 },
    );
  }

  const { data: row, error: rErr } = await params.admin
    .from('platform_superusers')
    .select('user_id')
    .eq('user_id', params.targetUserId)
    .is('revoked_at', null)
    .maybeSingle();
  if (rErr || !row) {
    throw Object.assign(new Error('Superuser not found or already revoked.'), { status: 404 });
  }

  const { error: uErr } = await params.admin
    .from('platform_superusers')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', params.targetUserId)
    .is('revoked_at', null);
  if (uErr) {
    console.error('[platform-superusers] revoke row:', uErr.message);
    throw new Error('Could not revoke platform superuser');
  }

  const { data: uwrap, error: gErr } = await params.admin.auth.admin.getUserById(params.targetUserId);
  if (!gErr && uwrap.user) {
    const { error: mErr } = await params.admin.auth.admin.updateUserById(params.targetUserId, {
      app_metadata: stripSuperuserAppMetadata(uwrap.user.app_metadata as Record<string, unknown> | undefined),
    });
    if (mErr) {
      console.error('[platform-superusers] strip app_metadata:', mErr.message);
    }
  }
}

export function resolveSuperuserInviteBaseUrl(request: Request): string {
  return getStaffAuthBaseUrl(request);
}
