import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { parseMembershipRules } from '@/lib/class-commerce/product-schemas';
import {
  ALLOWANCE_CONSUMING_REASONS,
  computeRolloverCarryOver,
  netAllowanceConsumed,
} from '@/lib/class-commerce/membership-allowance-coverage';

interface MembershipRow {
  id: string;
  product_id: string;
  user_id: string;
  venue_id: string;
  current_period_start: string | null;
  current_period_end: string | null;
  status: string;
}

interface MembershipProductRow {
  id: string;
  rules: Record<string, unknown>;
}

interface AllowanceLedgerRow {
  delta_sessions: number;
  reason: string;
}

/**
 * Cron — 4.5.1.5 of the class commerce plan.
 * Daily, for each active/trialing membership whose current_period_start is in the
 * past AND has no `period_reset` ledger row inside the current period, insert a
 * `period_reset` row recording the carry-over (rollover) into the new period.
 */
export const GET = withCronRunLogging('class-membership-period-reset', handleGet);

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: memberships, error } = await admin
    .from('class_memberships')
    .select('id, product_id, user_id, venue_id, current_period_start, current_period_end, status')
    .in('status', ['active', 'trialing'])
    .not('current_period_start', 'is', null)
    .lt('current_period_start', nowIso)
    .limit(1000);

  if (error) {
    console.error('[cron/class-membership-period-reset]', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const mRows = (memberships ?? []) as MembershipRow[];
  if (mRows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, reset: 0 });
  }

  const productIds = [...new Set(mRows.map((r) => r.product_id))];
  const { data: products } = await admin
    .from('class_membership_products')
    .select('id, rules')
    .in('id', productIds);
  const productById = new Map(
    ((products ?? []) as MembershipProductRow[]).map((p) => [p.id, p] as const),
  );

  let reset = 0;
  const errors: string[] = [];

  for (const m of mRows) {
    if (!m.current_period_start) continue;
    const prod = productById.get(m.product_id);
    if (!prod) continue;
    const rules = parseMembershipRules(prod.rules);
    if (rules.unlimited) continue;
    const allowance = rules.allowance_per_period ?? 0;
    if (allowance <= 0) continue;

    // Has a period_reset row already been written inside this period?
    const { data: alreadyReset } = await admin
      .from('class_membership_allowance_ledger')
      .select('id')
      .eq('membership_id', m.id)
      .eq('reason', 'period_reset')
      .gte('created_at', m.current_period_start)
      .limit(1)
      .maybeSingle();
    if (alreadyReset) continue;

    // Compute previous period's leftover for rollover. We look at ledger rows
    // strictly before current_period_start and after the prior period_reset row.
    //
    // Fix (§5.2): the prior-period window must be bounded by the prior period_reset
    // boundary. When there is no prior reset row we DO NOT reach back to epoch —
    // that swept every historical redeem into "the prior period", over-counting
    // consumption and wrongly zeroing rollover. With no prior reset row there is no
    // observable prior period, so the window starts at current_period_start (empty)
    // and the member carries over the full allowance, capped by rollover_limit.
    let carryOver = 0;
    if (rules.rollover) {
      const { data: priorReset } = await admin
        .from('class_membership_allowance_ledger')
        .select('created_at, delta_sessions')
        .eq('membership_id', m.id)
        .eq('reason', 'period_reset')
        .lt('created_at', m.current_period_start)
        .order('created_at', { ascending: false })
        .limit(1);
      const priorResetRow = (priorReset ?? [])[0] as
        | { created_at: string; delta_sessions: number }
        | undefined;
      const priorPeriodStart = priorResetRow?.created_at ?? m.current_period_start;
      const priorStartingBalance =
        (rules.allowance_per_period ?? 0) + (priorResetRow?.delta_sessions ?? 0);

      const { data: priorRows } = await admin
        .from('class_membership_allowance_ledger')
        .select('delta_sessions, reason')
        .eq('membership_id', m.id)
        .gte('created_at', priorPeriodStart)
        .lt('created_at', m.current_period_start)
        .in('reason', [...ALLOWANCE_CONSUMING_REASONS]);

      const consumed = netAllowanceConsumed((priorRows ?? []) as AllowanceLedgerRow[]);
      carryOver = computeRolloverCarryOver({
        priorStartingBalance,
        priorConsumed: consumed,
        rollover: rules.rollover,
        rolloverLimit: rules.rollover_limit,
      });
    }

    const idempotencyKey = `period_reset:${m.id}:${m.current_period_start}`;
    const { error: insErr } = await admin.from('class_membership_allowance_ledger').insert({
      membership_id: m.id,
      venue_id: m.venue_id,
      user_id: m.user_id,
      delta_sessions: carryOver,
      reason: 'period_reset',
      idempotency_key: idempotencyKey,
      note: 'Period boundary carry-over',
    });
    if (insErr) {
      if (/duplicate key|unique/i.test(insErr.message)) continue;
      errors.push(`reset ${m.id}: ${insErr.message}`);
      continue;
    }
    reset += 1;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    scanned: mRows.length,
    reset,
    errors,
  });
}
