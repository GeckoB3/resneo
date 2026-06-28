import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { addSalesCode } from '@/lib/sales/admin';
import { MIN_SALES_TRIAL_DAYS, MAX_SALES_TRIAL_DAYS } from '@/lib/sales/constants';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';

const bodySchema = z.object({
  trial_days: z.number().int().min(MIN_SALES_TRIAL_DAYS).max(MAX_SALES_TRIAL_DAYS).optional(),
  label: z.string().max(120).optional(),
  code: z.string().max(40).optional(),
});

function errorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number' && s >= 400 && s < 600) return s;
  }
  return 500;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    // The form may POST a reward config; an empty body keeps the previous "auto-generate, one
    // month free" behaviour so older callers still work.
    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    const { data: sp } = await admin
      .from('salespeople')
      .select('name, email')
      .eq('id', id)
      .is('revoked_at', null)
      .maybeSingle();
    if (!sp) {
      return NextResponse.json({ error: 'Salesperson not found' }, { status: 404 });
    }

    const code = await addSalesCode(admin, id, (sp.name as string) || (sp.email as string), {
      trialDays: parsed.data.trial_days,
      label: parsed.data.label,
      customCode: parsed.data.code,
    });

    await recordPlatformAuditEvent(admin, {
      superuser: user,
      action: 'salesperson.code.create',
      targetType: 'salesperson',
      targetId: id,
      summary: `Added sales code ${code}${parsed.data.trial_days ? ` (${parsed.data.trial_days}-day trial)` : ''}`,
    });

    return NextResponse.json({ ok: true, code });
  } catch (e) {
    const status = errorStatus(e);
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    if (status === 500) console.error('[api/platform/salespeople/[id]/codes] POST:', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
