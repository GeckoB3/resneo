import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { loadMonthlyEarnings } from '@/lib/sales/monthly-earnings';
import type { BonusTierRow, SalespersonRow } from '@/lib/sales/earnings';

/**
 * GET /api/platform/salespeople/[id]/earnings
 * Per-month earnings for one salesperson: the live running total for the in-progress month plus
 * the finalised monthly statements. Loaded on demand when a superuser expands a salesperson, so
 * the (already heavy) list endpoint stays light.
 */
export async function GET(
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

    const { data: sp } = await admin
      .from('salespeople')
      .select(
        'id, user_id, email, name, lump_sum_per_signup_pence, revenue_share_percent, revenue_share_months',
      )
      .eq('id', id)
      .is('revoked_at', null)
      .maybeSingle();
    if (!sp) {
      return NextResponse.json({ error: 'Salesperson not found' }, { status: 404 });
    }

    const { data: tiers } = await admin
      .from('sales_bonus_tiers')
      .select('threshold, amount_pence')
      .eq('salesperson_id', id)
      .order('threshold', { ascending: true });

    const earnings = await loadMonthlyEarnings({
      admin,
      salesperson: sp as SalespersonRow,
      bonusTiers: (tiers ?? []) as BonusTierRow[],
    });

    return NextResponse.json(earnings);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[api/platform/salespeople/[id]/earnings] GET:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
