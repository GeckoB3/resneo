import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupAuthUserIdByEmail } from '@/lib/auth/ensure-auth-user-for-email';
import { sendEmail } from '@/lib/emails/send-email';
import { getStaffAuthBaseUrl } from '@/lib/staff-invite-redirect';
import { sanitizeAuthNextPath } from '@/lib/safe-auth-redirect';
import {
  SALES_AGENT_KEY,
  SALES_AGENT_REGISTERED_KEY,
  SALES_AGENT_VALUE,
  DEFAULT_SALES_BONUS_TIERS,
  DEFAULT_REVENUE_SHARE_MONTHS,
  SALES_SIGNUP_TRIAL_DAYS,
  clampSalesTrialDays,
} from '@/lib/sales/constants';
import { buildCandidateSalesCode } from '@/lib/sales/code';
import { normaliseSalesCodeInput } from '@/lib/sales/lookup';
import { countActivePayingSubscribers } from '@/lib/sales/earnings';

export interface SalesCodeRow {
  id: string;
  code: string;
  active: boolean;
  trial_days: number;
  label: string | null;
}

/** Options for minting a new sales code: a custom free-trial length, an internal note, and/or a vanity code. */
export interface NewSalesCodeOptions {
  trialDays?: number;
  label?: string | null;
  /** When provided, use this exact (case-insensitive) code instead of auto-generating one. */
  customCode?: string | null;
}

export interface SalespersonListRow {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  active: boolean;
  lump_sum_per_signup_pence: number;
  revenue_share_percent: number;
  revenue_share_months: number;
  created_at: string;
  created_by: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  codes: SalesCodeRow[];
  total_signups: number;
  active_paying_subscribers: number;
  lifetime_earnings_pence: number;
  bonus_tiers: Array<{ threshold: number; amount_pence: number }>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mergeSalesAgentAppMetadata(prev: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(prev ?? {}),
    [SALES_AGENT_KEY]: SALES_AGENT_VALUE,
    [SALES_AGENT_REGISTERED_KEY]: true,
  };
}

function stripSalesAgentAppMetadata(prev: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = { ...(prev ?? {}) };
  delete next[SALES_AGENT_KEY];
  delete next[SALES_AGENT_REGISTERED_KEY];
  return next;
}

async function referralCodeExists(admin: SupabaseClient, code: string): Promise<boolean> {
  // Sales and referral codes share one namespace on the signup page, so a sales code must not
  // collide (case-insensitively) with an existing referral code.
  const { data } = await admin.from('referral_codes').select('id').ilike('code', code).limit(1);
  return Boolean(data && data.length > 0);
}

async function insertGeneratedSalesCode(
  admin: SupabaseClient,
  salespersonId: string,
  displayName: string,
  trialDays: number,
  label: string | null,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = buildCandidateSalesCode(displayName);
    if (await referralCodeExists(admin, candidate)) continue;
    const { data, error } = await admin
      .from('sales_codes')
      .insert({ salesperson_id: salespersonId, code: candidate, trial_days: trialDays, label })
      .select('code')
      .maybeSingle();
    if (!error && data?.code) return data.code as string;
    const isUnique =
      (error as { code?: string } | null)?.code === '23505' ||
      /duplicate key/i.test(error?.message ?? '');
    if (!isUnique) {
      throw new Error(error?.message ?? 'Could not create sales code');
    }
  }
  throw new Error('Could not generate unique sales code');
}

/**
 * Validate a custom/vanity sales code and confirm it is free across BOTH the sales and referral
 * namespaces (they share one field on the signup page). Returns the normalised (uppercased) code,
 * or throws a 400/409. Pass `excludeCodeId` when renaming an existing code so it does not clash
 * with itself.
 */
async function assertCustomSalesCodeAvailable(
  admin: SupabaseClient,
  rawCode: string,
  excludeCodeId?: string | null,
): Promise<string> {
  const code = normaliseSalesCodeInput(rawCode);
  if (!code) {
    throw Object.assign(
      new Error('Custom code must be 3 to 40 characters using letters, numbers, or hyphens.'),
      { status: 400 },
    );
  }
  if (await referralCodeExists(admin, code)) {
    throw Object.assign(new Error('That code is already in use by the referral programme.'), { status: 409 });
  }
  let query = admin.from('sales_codes').select('id').ilike('code', code).limit(1);
  if (excludeCodeId) query = query.neq('id', excludeCodeId);
  const { data: salesClash } = await query;
  if (salesClash && salesClash.length > 0) {
    throw Object.assign(new Error('That code is already taken.'), { status: 409 });
  }
  return code;
}

async function insertCustomSalesCode(
  admin: SupabaseClient,
  salespersonId: string,
  rawCode: string,
  trialDays: number,
  label: string | null,
): Promise<string> {
  const code = await assertCustomSalesCodeAvailable(admin, rawCode);
  const { data, error } = await admin
    .from('sales_codes')
    .insert({ salesperson_id: salespersonId, code, trial_days: trialDays, label })
    .select('code')
    .maybeSingle();
  if (error || !data?.code) {
    const isUnique =
      (error as { code?: string } | null)?.code === '23505' ||
      /duplicate key/i.test(error?.message ?? '');
    if (isUnique) {
      throw Object.assign(new Error('That code is already taken.'), { status: 409 });
    }
    throw new Error(error?.message ?? 'Could not create sales code');
  }
  return data.code as string;
}

function normaliseCodeLabel(label: string | null | undefined): string | null {
  const trimmed = (label ?? '').trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

async function seedDefaultBonusTiers(admin: SupabaseClient, salespersonId: string): Promise<void> {
  const rows = DEFAULT_SALES_BONUS_TIERS.map((t) => ({
    salesperson_id: salespersonId,
    threshold: t.threshold,
    amount_pence: t.amount_pence,
  }));
  const { error } = await admin.from('sales_bonus_tiers').upsert(rows, {
    onConflict: 'salesperson_id,threshold',
    ignoreDuplicates: true,
  });
  if (error) {
    console.error('[sales/admin] seed tiers failed', error.message);
  }
}

export async function listActiveSalespeople(admin: SupabaseClient): Promise<SalespersonListRow[]> {
  const { data: rows, error } = await admin
    .from('salespeople')
    .select(
      'id, user_id, email, name, active, lump_sum_per_signup_pence, revenue_share_percent, revenue_share_months, created_at, created_by',
    )
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[sales/admin] list failed', error.message);
    throw new Error('Failed to list salespeople');
  }

  const out: SalespersonListRow[] = [];
  for (const r of rows ?? []) {
    const spId = r.id as string;
    const userId = r.user_id as string;

    const [{ data: codeRows }, { count: signupCount }, { data: stmtRows }, { data: tierRows }] =
      await Promise.all([
        admin
          .from('sales_codes')
          .select('id, code, active, trial_days, label')
          .eq('salesperson_id', spId)
          .order('created_at', { ascending: true }),
        admin
          .from('sales_attributions')
          .select('id', { count: 'exact', head: true })
          .eq('salesperson_id', spId),
        admin.from('sales_monthly_statements').select('total_pence').eq('salesperson_id', spId),
        admin
          .from('sales_bonus_tiers')
          .select('threshold, amount_pence')
          .eq('salesperson_id', spId)
          .order('threshold', { ascending: true }),
      ]);

    const { data: uwrap, error: ue } = await admin.auth.admin.getUserById(userId);
    if (ue || !uwrap.user) continue;

    const activePaying = await countActivePayingSubscribers(admin, spId);
    const lifetime = (stmtRows ?? []).reduce(
      (sum, s) => sum + ((s as { total_pence: number }).total_pence ?? 0),
      0,
    );

    out.push({
      id: spId,
      user_id: userId,
      email: (uwrap.user.email ?? (r.email as string)).toLowerCase().trim(),
      name: (r.name as string | null) ?? null,
      active: r.active as boolean,
      lump_sum_per_signup_pence: r.lump_sum_per_signup_pence as number,
      revenue_share_percent: Number(r.revenue_share_percent),
      revenue_share_months: r.revenue_share_months as number,
      created_at: r.created_at as string,
      created_by: (r.created_by as string | null) ?? null,
      last_sign_in_at: uwrap.user.last_sign_in_at ?? null,
      email_confirmed_at: uwrap.user.email_confirmed_at ?? null,
      codes: (codeRows ?? []).map((c) => {
        const row = c as { id: string; code: string; active: boolean; trial_days: number | null; label: string | null };
        return {
          id: row.id,
          code: row.code,
          active: row.active,
          trial_days: clampSalesTrialDays(row.trial_days),
          label: row.label ?? null,
        };
      }),
      total_signups: signupCount ?? 0,
      active_paying_subscribers: activePaying,
      lifetime_earnings_pence: lifetime,
      bonus_tiers: (tierRows ?? []) as Array<{ threshold: number; amount_pence: number }>,
    });
  }
  return out;
}

async function assertNoActiveSalespersonForEmail(admin: SupabaseClient, email: string): Promise<void> {
  const { data, error } = await admin
    .from('salespeople')
    .select('id')
    .eq('email', email)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw new Error('Failed to verify email availability');
  if (data) {
    throw Object.assign(new Error('This email is already an active salesperson.'), { status: 409 });
  }
}

/**
 * Mint the salesperson's first code. If it fails (for example a rare custom-code race that loses
 * the final insert), revoke the just-created salesperson row so the record is not left
 * half-created: revoked rows do not trip assertNoActiveSalespersonForEmail, so the superuser can
 * simply retry the same email.
 */
async function mintFirstCodeOrRollback(
  admin: SupabaseClient,
  salespersonId: string,
  displayName: string,
  trialDays: number | undefined,
  customCode: string | null | undefined,
): Promise<string> {
  try {
    return await addSalesCode(admin, salespersonId, displayName, { trialDays, customCode: customCode ?? null });
  } catch (e) {
    try {
      await admin
        .from('salespeople')
        .update({ revoked_at: new Date().toISOString(), active: false })
        .eq('id', salespersonId);
    } catch (rollbackErr) {
      console.error('[sales/admin] rollback after first-code mint failure also failed', rollbackErr);
    }
    throw e;
  }
}

export async function createSalespersonWithPassword(params: {
  admin: SupabaseClient;
  email: string;
  password: string;
  name: string;
  createdBy: string;
  lump_sum_per_signup_pence?: number;
  revenue_share_percent?: number;
  revenue_share_months?: number;
  /** Free-trial length for the salesperson's first auto-generated code (defaults to one month). */
  trial_days?: number;
  /** Optional custom/vanity code for the first code; auto-generated when omitted. */
  custom_code?: string;
}): Promise<{ user_id: string; salesperson_id: string; code: string }> {
  const email = params.email.trim().toLowerCase();
  await assertNoActiveSalespersonForEmail(params.admin, email);
  // Validate the custom code up front so an invalid/taken code fails before we create any auth
  // user or salesperson row (avoids leaving a half-created salesperson behind).
  if (params.custom_code && params.custom_code.trim()) {
    await assertCustomSalesCodeAvailable(params.admin, params.custom_code);
  }

  const existingId = await lookupAuthUserIdByEmail(params.admin, email);
  let userId = existingId;

  if (existingId) {
    const { data: uwrap, error: ge } = await params.admin.auth.admin.getUserById(existingId);
    if (ge || !uwrap.user) throw new Error('Could not load existing auth user');
    const { error: pwErr } = await params.admin.auth.admin.updateUserById(existingId, {
      password: params.password,
      app_metadata: mergeSalesAgentAppMetadata(uwrap.user.app_metadata as Record<string, unknown> | undefined),
      user_metadata: { ...(uwrap.user.user_metadata ?? {}), has_set_password: true },
    });
    if (pwErr) throw new Error(pwErr.message || 'Could not set password');
  } else {
    const { data: created, error: cErr } = await params.admin.auth.admin.createUser({
      email,
      password: params.password,
      email_confirm: true,
      app_metadata: mergeSalesAgentAppMetadata(undefined),
      user_metadata: { has_set_password: true },
    });
    if (cErr || !created.user?.id) {
      throw new Error(cErr?.message ?? 'Could not create auth user');
    }
    userId = created.user.id;
  }

  const { data: spRow, error: spErr } = await params.admin
    .from('salespeople')
    .upsert(
      {
        user_id: userId,
        email,
        name: params.name.trim() || null,
        active: true,
        lump_sum_per_signup_pence: params.lump_sum_per_signup_pence ?? 0,
        revenue_share_percent: params.revenue_share_percent ?? 0,
        revenue_share_months: params.revenue_share_months ?? DEFAULT_REVENUE_SHARE_MONTHS,
        created_by: params.createdBy,
        revoked_at: null,
      },
      { onConflict: 'user_id' },
    )
    .select('id')
    .single();
  if (spErr || !spRow) {
    throw new Error('Could not save salesperson record');
  }

  const salespersonId = spRow.id as string;
  await seedDefaultBonusTiers(params.admin, salespersonId);
  const code = await mintFirstCodeOrRollback(
    params.admin,
    salespersonId,
    params.name || email,
    params.trial_days,
    params.custom_code,
  );

  return { user_id: userId!, salesperson_id: salespersonId, code };
}

export async function createSalespersonWithMagicLink(params: {
  admin: SupabaseClient;
  email: string;
  name: string;
  baseUrl: string;
  createdBy: string;
  lump_sum_per_signup_pence?: number;
  revenue_share_percent?: number;
  revenue_share_months?: number;
  /** Free-trial length for the salesperson's first auto-generated code (defaults to one month). */
  trial_days?: number;
  /** Optional custom/vanity code for the first code; auto-generated when omitted. */
  custom_code?: string;
}): Promise<{ user_id: string; salesperson_id: string; code: string; channel: 'sendgrid' | 'supabase_invite' }> {
  const email = params.email.trim().toLowerCase();
  await assertNoActiveSalespersonForEmail(params.admin, email);
  // Validate the custom code up front (see createSalespersonWithPassword) before any mutation.
  if (params.custom_code && params.custom_code.trim()) {
    await assertCustomSalesCodeAvailable(params.admin, params.custom_code);
  }

  const existingAtStart = await lookupAuthUserIdByEmail(params.admin, email);
  const sendGridConfigured = Boolean(process.env.SENDGRID_API_KEY?.trim());
  if (!sendGridConfigured && existingAtStart) {
    throw Object.assign(
      new Error('SendGrid is not configured: magic links to existing accounts require SENDGRID_API_KEY.'),
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
      userId = await lookupAuthUserIdByEmail(params.admin, email);
      if (!userId) throw new Error(cErr?.message ?? 'Could not create auth user');
    } else {
      userId = created.user.id;
      createdEphemeral = true;
    }
  }

  const nextPath = sanitizeAuthNextPath('/sales');
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
      if (createdEphemeral && userId) await params.admin.auth.admin.deleteUser(userId);
      throw new Error(linkErr?.message ?? 'Could not generate sign-in link');
    }

    const confirmUrl =
      `${base}/auth/confirm` +
      `?token_hash=${encodeURIComponent(hashedToken)}` +
      `&type=magiclink` +
      `&next=${encodeURIComponent(nextPath)}`;

    const subject = 'ResNeo sales dashboard access';
    const text = [
      'You have been granted access to the ResNeo sales dashboard.',
      '',
      'Open this link to sign in:',
      confirmUrl,
      '',
      'If you did not expect this email, contact your administrator.',
    ].join('\n');

    const html = `
      <p>You have been granted access to the <strong>ResNeo</strong> sales dashboard.</p>
      <p><a href="${escapeHtml(confirmUrl)}">Sign in to your sales dashboard</a></p>
      <p style="font-size:12px;color:#64748b;">If you did not expect this email, contact your administrator.</p>
    `;

    const messageId = await sendEmail({
      to: email,
      subject,
      html,
      text,
      disableTracking: true,
    });
    if (!messageId) {
      if (createdEphemeral && userId) await params.admin.auth.admin.deleteUser(userId);
      throw new Error('SendGrid is not configured correctly.');
    }
  } else {
    const redirectTo = `${base}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error: invErr } = await params.admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { has_set_password: false } as Record<string, string | boolean>,
    });
    if (invErr) {
      if (createdEphemeral && userId) await params.admin.auth.admin.deleteUser(userId);
      throw new Error(invErr.message ?? 'Could not send invite email');
    }
    userId = (await lookupAuthUserIdByEmail(params.admin, email)) ?? userId;
  }

  const { data: uwrap } = await params.admin.auth.admin.getUserById(userId!);
  await params.admin.auth.admin.updateUserById(userId!, {
    app_metadata: mergeSalesAgentAppMetadata(uwrap.user?.app_metadata as Record<string, unknown> | undefined),
  });

  const { data: spRow, error: spErr } = await params.admin
    .from('salespeople')
    .upsert(
      {
        user_id: userId,
        email,
        name: params.name.trim() || null,
        active: true,
        lump_sum_per_signup_pence: params.lump_sum_per_signup_pence ?? 0,
        revenue_share_percent: params.revenue_share_percent ?? 0,
        revenue_share_months: params.revenue_share_months ?? DEFAULT_REVENUE_SHARE_MONTHS,
        created_by: params.createdBy,
        revoked_at: null,
      },
      { onConflict: 'user_id' },
    )
    .select('id')
    .single();
  if (spErr || !spRow) {
    throw new Error('Could not save salesperson record');
  }

  const salespersonId = spRow.id as string;
  await seedDefaultBonusTiers(params.admin, salespersonId);
  const code = await mintFirstCodeOrRollback(
    params.admin,
    salespersonId,
    params.name || email,
    params.trial_days,
    params.custom_code,
  );

  return {
    user_id: userId!,
    salesperson_id: salespersonId,
    code,
    channel: sendGridConfigured ? 'sendgrid' : 'supabase_invite',
  };
}

export async function updateSalespersonRewards(
  admin: SupabaseClient,
  salespersonId: string,
  updates: {
    name?: string;
    active?: boolean;
    lump_sum_per_signup_pence?: number;
    revenue_share_percent?: number;
    revenue_share_months?: number;
  },
): Promise<void> {
  const { error } = await admin.from('salespeople').update(updates).eq('id', salespersonId).is('revoked_at', null);
  if (error) throw new Error(error.message);
}

export async function replaceSalespersonBonusTiers(
  admin: SupabaseClient,
  salespersonId: string,
  tiers: Array<{ threshold: number; amount_pence: number }>,
): Promise<void> {
  const { error: delErr } = await admin.from('sales_bonus_tiers').delete().eq('salesperson_id', salespersonId);
  if (delErr) throw new Error(delErr.message);

  if (!tiers.length) return;

  const rows = tiers.map((t) => ({
    salesperson_id: salespersonId,
    threshold: t.threshold,
    amount_pence: t.amount_pence,
  }));
  const { error: insErr } = await admin.from('sales_bonus_tiers').insert(rows);
  if (insErr) throw new Error(insErr.message);
}

export async function addSalesCode(
  admin: SupabaseClient,
  salespersonId: string,
  displayName: string,
  opts: NewSalesCodeOptions = {},
): Promise<string> {
  const trialDays = clampSalesTrialDays(opts.trialDays ?? SALES_SIGNUP_TRIAL_DAYS);
  const label = normaliseCodeLabel(opts.label);
  if (opts.customCode && opts.customCode.trim()) {
    return insertCustomSalesCode(admin, salespersonId, opts.customCode, trialDays, label);
  }
  return insertGeneratedSalesCode(admin, salespersonId, displayName, trialDays, label);
}

/** Update a single code's string/reward/label/active flag. Only the provided fields change. */
export async function updateSalesCode(
  admin: SupabaseClient,
  codeId: string,
  updates: { code?: string; trial_days?: number; label?: string | null; active?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (updates.code !== undefined) {
    // Rename the code in place: validate format + uniqueness, excluding this row so saving the
    // same string is a no-op rather than a self-collision.
    patch.code = await assertCustomSalesCodeAvailable(admin, updates.code, codeId);
  }
  if (updates.trial_days !== undefined) patch.trial_days = clampSalesTrialDays(updates.trial_days);
  if (updates.label !== undefined) patch.label = normaliseCodeLabel(updates.label);
  if (updates.active !== undefined) patch.active = updates.active;
  if (Object.keys(patch).length === 0) return;
  const { error } = await admin.from('sales_codes').update(patch).eq('id', codeId);
  if (error) {
    const isUnique =
      (error as { code?: string } | null)?.code === '23505' || /duplicate key/i.test(error.message ?? '');
    throw isUnique
      ? Object.assign(new Error('That code is already taken.'), { status: 409 })
      : new Error(error.message);
  }
}

export async function setSalesCodeActive(
  admin: SupabaseClient,
  codeId: string,
  active: boolean,
): Promise<void> {
  const { error } = await admin.from('sales_codes').update({ active }).eq('id', codeId);
  if (error) throw new Error(error.message);
}

export async function deleteSalesCode(admin: SupabaseClient, codeId: string): Promise<void> {
  const { error } = await admin.from('sales_codes').delete().eq('id', codeId);
  if (error) throw new Error(error.message);
}

export async function revokeSalesperson(params: {
  admin: SupabaseClient;
  salespersonId: string;
}): Promise<void> {
  const { data: row, error: rErr } = await params.admin
    .from('salespeople')
    .select('user_id')
    .eq('id', params.salespersonId)
    .is('revoked_at', null)
    .maybeSingle();
  if (rErr || !row) {
    throw Object.assign(new Error('Salesperson not found or already revoked.'), { status: 404 });
  }

  const { error: uErr } = await params.admin
    .from('salespeople')
    .update({ revoked_at: new Date().toISOString(), active: false })
    .eq('id', params.salespersonId)
    .is('revoked_at', null);
  if (uErr) throw new Error('Could not revoke salesperson');

  const userId = row.user_id as string;
  const { data: uwrap } = await params.admin.auth.admin.getUserById(userId);
  if (uwrap.user) {
    await params.admin.auth.admin.updateUserById(userId, {
      app_metadata: stripSalesAgentAppMetadata(uwrap.user.app_metadata as Record<string, unknown> | undefined),
    });
  }
}

export function resolveSalesInviteBaseUrl(request: Request): string {
  return getStaffAuthBaseUrl(request);
}
