import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import {
  createSalespersonWithMagicLink,
  createSalespersonWithPassword,
  listActiveSalespeople,
  resolveSalesInviteBaseUrl,
} from '@/lib/sales/admin';
import { MIN_SALES_TRIAL_DAYS, MAX_SALES_TRIAL_DAYS } from '@/lib/sales/constants';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';

const createBodySchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1).max(120),
    method: z.enum(['magic_link', 'password']),
    password: z.string().min(8).max(200).optional(),
    lump_sum_per_signup_pence: z.number().int().min(0).optional(),
    revenue_share_percent: z.number().min(0).max(100).optional(),
    revenue_share_months: z.number().int().min(1).max(120).optional(),
    trial_days: z.number().int().min(MIN_SALES_TRIAL_DAYS).max(MAX_SALES_TRIAL_DAYS).optional(),
    code: z.string().max(40).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === 'password' && (!data.password || data.password.length < 8)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Password is required (min 8 characters) for the password method.',
        path: ['password'],
      });
    }
  });

function errorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number' && s >= 400 && s < 600) return s;
  }
  return 500;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = getSupabaseAdminClient();
    const salespeople = await listActiveSalespeople(admin);
    return NextResponse.json({ salespeople });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[api/platform/salespeople] GET:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const json = await request.json().catch(() => null);
    const parsed = createBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const baseUrl = resolveSalesInviteBaseUrl(request);
    const body = parsed.data;
    const email = body.email.trim().toLowerCase();

    const rewardOpts = {
      lump_sum_per_signup_pence: body.lump_sum_per_signup_pence,
      revenue_share_percent: body.revenue_share_percent,
      revenue_share_months: body.revenue_share_months,
      trial_days: body.trial_days,
      custom_code: body.code,
    };

    if (body.method === 'password') {
      const result = await createSalespersonWithPassword({
        admin,
        email,
        password: body.password!,
        name: body.name,
        createdBy: user.id,
        ...rewardOpts,
      });
      await recordPlatformAuditEvent(admin, {
        superuser: user,
        action: 'salesperson.create',
        targetType: 'salesperson',
        targetId: email,
        summary: `Created salesperson ${email} (password)`,
      });
      return NextResponse.json({ ok: true, ...result, method: 'password' as const });
    }

    const result = await createSalespersonWithMagicLink({
      admin,
      email,
      name: body.name,
      baseUrl,
      createdBy: user.id,
      ...rewardOpts,
    });
    await recordPlatformAuditEvent(admin, {
      superuser: user,
      action: 'salesperson.create',
      targetType: 'salesperson',
      targetId: email,
      summary: `Created salesperson ${email} (magic link invite)`,
    });
    return NextResponse.json({ ok: true, ...result, method: 'magic_link' as const });
  } catch (e) {
    const status = errorStatus(e);
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    if (status === 500) console.error('[api/platform/salespeople] POST:', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
