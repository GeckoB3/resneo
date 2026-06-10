import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import {
  replaceSalespersonBonusTiers,
  revokeSalesperson,
  updateSalespersonRewards,
} from '@/lib/sales/admin';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  active: z.boolean().optional(),
  lump_sum_per_signup_pence: z.number().int().min(0).optional(),
  revenue_share_percent: z.number().min(0).max(100).optional(),
  revenue_share_months: z.number().int().min(1).max(120).optional(),
  bonus_tiers: z
    .array(
      z.object({
        threshold: z.number().int().min(1),
        amount_pence: z.number().int().min(0),
      }),
    )
    .optional(),
});

export async function PATCH(
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
    const json = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { bonus_tiers, ...rewardUpdates } = parsed.data;

    if (Object.keys(rewardUpdates).length > 0) {
      await updateSalespersonRewards(admin, id, rewardUpdates);
    }
    if (bonus_tiers) {
      await replaceSalespersonBonusTiers(admin, id, bonus_tiers);
    }

    await recordPlatformAuditEvent(admin, {
      superuser: user,
      action: 'salesperson.update',
      targetType: 'salesperson',
      targetId: id,
      summary: `Updated salesperson rewards/settings (${Object.keys(parsed.data).join(', ')})`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[api/platform/salespeople/[id]] PATCH:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
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
    const admin = getSupabaseAdminClient();
    await revokeSalesperson({ admin, salespersonId: id });

    await recordPlatformAuditEvent(admin, {
      superuser: user,
      action: 'salesperson.revoke',
      targetType: 'salesperson',
      targetId: id,
      summary: 'Revoked salesperson access',
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const status =
      typeof e === 'object' && e !== null && 'status' in e && typeof (e as { status: number }).status === 'number'
        ? (e as { status: number }).status
        : 500;
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return NextResponse.json({ error: msg }, { status });
  }
}
