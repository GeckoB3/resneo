import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_SUBSCRIBER_PLAN_STATUS } from '@/lib/sales/constants';

export interface SalespersonRow {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  lump_sum_per_signup_pence: number;
  revenue_share_percent: number;
  revenue_share_months: number;
}

export interface BonusTierRow {
  threshold: number;
  amount_pence: number;
}

export function monthStartUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function previousMonthStartUtc(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return monthStartUtc(d);
}

export function addMonthsUtc(monthStart: string, months: number): string {
  const [y, m] = monthStart.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m ?? 1) - 1 + months, 1));
  return monthStartUtc(d);
}

/** Count attributed venues with plan_status = active (paying only). */
export async function countActivePayingSubscribers(
  admin: SupabaseClient,
  salespersonId: string,
): Promise<number> {
  const { data: attrs, error: attrErr } = await admin
    .from('sales_attributions')
    .select('venue_id')
    .eq('salesperson_id', salespersonId)
    .eq('status', 'active')
    .not('venue_id', 'is', null);
  if (attrErr || !attrs?.length) return 0;

  const venueIds = attrs
    .map((a) => (a as { venue_id: string | null }).venue_id)
    .filter((id): id is string => Boolean(id));
  if (!venueIds.length) return 0;

  const { count, error } = await admin
    .from('venues')
    .select('id', { count: 'exact', head: true })
    .in('id', venueIds)
    .eq('plan_status', ACTIVE_SUBSCRIBER_PLAN_STATUS);
  if (error) {
    console.error('[sales/earnings] active subscriber count failed', error.message);
    return 0;
  }
  return count ?? 0;
}

interface ComputeStatementInput {
  admin: SupabaseClient;
  salesperson: SalespersonRow;
  periodMonth: string;
  bonusTiers: BonusTierRow[];
}

export interface MonthlyStatementBreakdown {
  signups_count: number;
  validated_count: number;
  lump_sum_pence: number;
  revenue_share_pence: number;
  bonus_pence: number;
  active_subscribers_end: number;
  total_pence: number;
  new_bonus_awards: Array<{ threshold: number; amount_pence: number }>;
}

export async function computeMonthlyStatement(
  input: ComputeStatementInput,
): Promise<MonthlyStatementBreakdown> {
  const { admin, salesperson, periodMonth, bonusTiers } = input;
  const spId = salesperson.id;

  const periodEndExclusive = addMonthsUtc(periodMonth, 1);
  const periodStartIso = `${periodMonth}T00:00:00.000Z`;
  const periodEndIso = `${periodEndExclusive}T00:00:00.000Z`;

  const { data: signups } = await admin
    .from('sales_attributions')
    .select('id')
    .eq('salesperson_id', spId)
    .gte('signed_up_at', periodStartIso)
    .lt('signed_up_at', periodEndIso);
  const signupsCount = signups?.length ?? 0;

  const { data: newlyValidated } = await admin
    .from('sales_attributions')
    .select('id')
    .eq('salesperson_id', spId)
    .gte('first_paid_at', periodStartIso)
    .lt('first_paid_at', periodEndIso);
  const validatedCount = newlyValidated?.length ?? 0;
  const lumpSumPence = validatedCount * (salesperson.lump_sum_per_signup_pence ?? 0);

  const sharePercent = Number(salesperson.revenue_share_percent ?? 0);
  const shareMonths = salesperson.revenue_share_months ?? 12;

  let revenueSharePence = 0;
  if (sharePercent > 0) {
    const { data: attrs } = await admin
      .from('sales_attributions')
      .select('id, first_paid_at')
      .eq('salesperson_id', spId)
      .not('first_paid_at', 'is', null);

    const eligibleAttrIds: string[] = [];
    for (const row of attrs ?? []) {
      const fp = (row as { first_paid_at: string }).first_paid_at;
      if (!fp) continue;
      const firstPaidMonth = monthStartUtc(new Date(fp));
      const windowEnd = addMonthsUtc(firstPaidMonth, shareMonths);
      if (periodMonth >= firstPaidMonth && periodMonth < windowEnd) {
        eligibleAttrIds.push((row as { id: string }).id);
      }
    }

    if (eligibleAttrIds.length) {
      const { data: revRows } = await admin
        .from('sales_invoice_revenue')
        .select('amount_paid_pence')
        .in('attribution_id', eligibleAttrIds)
        .eq('period_month', periodMonth);
      const gross = (revRows ?? []).reduce(
        (sum, r) => sum + ((r as { amount_paid_pence: number }).amount_paid_pence ?? 0),
        0,
      );
      revenueSharePence = Math.round((gross * sharePercent) / 100);
    }
  }

  const activeSubscribersEnd = await countActivePayingSubscribers(admin, spId);

  const { data: existingAwards } = await admin
    .from('sales_bonus_awards')
    .select('threshold')
    .eq('salesperson_id', spId);
  const awardedThresholds = new Set(
    (existingAwards ?? []).map((r) => (r as { threshold: number }).threshold),
  );

  const newBonusAwards: Array<{ threshold: number; amount_pence: number }> = [];
  let bonusPence = 0;
  for (const tier of bonusTiers) {
    if (activeSubscribersEnd >= tier.threshold && !awardedThresholds.has(tier.threshold)) {
      newBonusAwards.push({ threshold: tier.threshold, amount_pence: tier.amount_pence });
      bonusPence += tier.amount_pence;
    }
  }

  const totalPence = lumpSumPence + revenueSharePence + bonusPence;

  return {
    signups_count: signupsCount,
    validated_count: validatedCount,
    lump_sum_pence: lumpSumPence,
    revenue_share_pence: revenueSharePence,
    bonus_pence: bonusPence,
    active_subscribers_end: activeSubscribersEnd,
    total_pence: totalPence,
    new_bonus_awards: newBonusAwards,
  };
}

export async function persistMonthlyStatement(
  admin: SupabaseClient,
  salespersonId: string,
  periodMonth: string,
  breakdown: MonthlyStatementBreakdown,
): Promise<void> {
  for (const award of breakdown.new_bonus_awards) {
    const { error: awardErr } = await admin.from('sales_bonus_awards').upsert(
      {
        salesperson_id: salespersonId,
        threshold: award.threshold,
        amount_pence: award.amount_pence,
        awarded_month: periodMonth,
      },
      { onConflict: 'salesperson_id,threshold', ignoreDuplicates: true },
    );
    if (awardErr) {
      console.error('[sales/earnings] bonus award insert failed', awardErr.message);
    }
  }

  const { error: stmtErr } = await admin.from('sales_monthly_statements').upsert(
    {
      salesperson_id: salespersonId,
      period_month: periodMonth,
      signups_count: breakdown.signups_count,
      validated_count: breakdown.validated_count,
      lump_sum_pence: breakdown.lump_sum_pence,
      revenue_share_pence: breakdown.revenue_share_pence,
      bonus_pence: breakdown.bonus_pence,
      active_subscribers_end: breakdown.active_subscribers_end,
      total_pence: breakdown.total_pence,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'salesperson_id,period_month' },
  );
  if (stmtErr) {
    console.error('[sales/earnings] statement upsert failed', stmtErr.message);
    throw new Error('Failed to persist monthly statement');
  }
}

export async function runMonthlyStatementsForAll(
  admin: SupabaseClient,
  periodMonth: string,
): Promise<{ processed: number }> {
  const { data: salespeople, error } = await admin
    .from('salespeople')
    .select('id, user_id, email, name, lump_sum_per_signup_pence, revenue_share_percent, revenue_share_months')
    .is('revoked_at', null);
  if (error) {
    throw new Error(error.message);
  }

  let processed = 0;
  for (const sp of salespeople ?? []) {
    const salesperson = sp as SalespersonRow;
    const { data: tiers } = await admin
      .from('sales_bonus_tiers')
      .select('threshold, amount_pence')
      .eq('salesperson_id', salesperson.id)
      .order('threshold', { ascending: true });

    const breakdown = await computeMonthlyStatement({
      admin,
      salesperson,
      periodMonth,
      bonusTiers: (tiers ?? []) as BonusTierRow[],
    });
    await persistMonthlyStatement(admin, salesperson.id, periodMonth, breakdown);
    processed += 1;
  }
  return { processed };
}
