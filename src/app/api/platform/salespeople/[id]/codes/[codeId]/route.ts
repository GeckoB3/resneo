import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { deleteSalesCode, updateSalesCode } from '@/lib/sales/admin';
import { MIN_SALES_TRIAL_DAYS, MAX_SALES_TRIAL_DAYS } from '@/lib/sales/constants';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';
import type { SupabaseClient } from '@supabase/supabase-js';

const patchSchema = z
  .object({
    trial_days: z.number().int().min(MIN_SALES_TRIAL_DAYS).max(MAX_SALES_TRIAL_DAYS).optional(),
    label: z.string().max(120).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

/** Confirms the code exists and belongs to this salesperson before any mutation. */
async function assertCodeBelongsToSalesperson(
  admin: SupabaseClient,
  salespersonId: string,
  codeId: string,
): Promise<{ code: string } | null> {
  const { data } = await admin
    .from('sales_codes')
    .select('id, code, salesperson_id')
    .eq('id', codeId)
    .maybeSingle();
  if (!data || (data as { salesperson_id: string }).salesperson_id !== salespersonId) return null;
  return { code: (data as { code: string }).code };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; codeId: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, codeId } = await params;
    const json = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const owned = await assertCodeBelongsToSalesperson(admin, id, codeId);
    if (!owned) {
      return NextResponse.json({ error: 'Code not found' }, { status: 404 });
    }

    await updateSalesCode(admin, codeId, parsed.data);

    await recordPlatformAuditEvent(admin, {
      superuser: user,
      action: 'salesperson.code.update',
      targetType: 'salesperson',
      targetId: id,
      summary: `Updated sales code ${owned.code} (${Object.keys(parsed.data).join(', ')})`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[api/platform/salespeople/[id]/codes/[codeId]] PATCH:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; codeId: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, codeId } = await params;
    const admin = getSupabaseAdminClient();
    const owned = await assertCodeBelongsToSalesperson(admin, id, codeId);
    if (!owned) {
      return NextResponse.json({ error: 'Code not found' }, { status: 404 });
    }

    await deleteSalesCode(admin, codeId);

    await recordPlatformAuditEvent(admin, {
      superuser: user,
      action: 'salesperson.code.delete',
      targetType: 'salesperson',
      targetId: id,
      summary: `Deleted sales code ${owned.code}`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[api/platform/salespeople/[id]/codes/[codeId]] DELETE:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
