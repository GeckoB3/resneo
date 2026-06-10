import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { previousMonthStartUtc, runMonthlyStatementsForAll } from '@/lib/sales/earnings';

/**
 * POST /api/cron/sales-monthly
 * Run daily; builds prior-month salesperson statements on/after the 1st (UTC).
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const periodMonth = previousMonthStartUtc();
    const admin = getSupabaseAdminClient();
    const { processed } = await runMonthlyStatementsForAll(admin, periodMonth);
    return NextResponse.json({ ok: true, period_month: periodMonth, processed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[cron sales-monthly]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
