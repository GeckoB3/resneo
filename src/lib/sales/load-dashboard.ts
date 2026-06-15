import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  computeMonthlyStatement,
  countActivePayingSubscribers,
  monthStartUtc,
  type BonusTierRow,
  type SalespersonRow,
} from '@/lib/sales/earnings';
import { planDisplayName } from '@/lib/pricing-constants';

export interface SalesDashboardData {
  salesperson: {
    id: string;
    name: string | null;
    email: string;
    lump_sum_per_signup_pence: number;
    revenue_share_percent: number;
    revenue_share_months: number;
  };
  codes: Array<{ code: string; active: boolean }>;
  summary: {
    total_signups: number;
    validated_signups: number;
    active_paying_subscribers: number;
    lifetime_earnings_pence: number;
    current_month_estimated_pence: number;
  };
  bonus_ladder: {
    tiers: Array<{ threshold: number; amount_pence: number; awarded: boolean }>;
    next_tier: { threshold: number; amount_pence: number } | null;
  };
  statements: Array<{
    period_month: string;
    signups_count: number;
    validated_count: number;
    lump_sum_pence: number;
    revenue_share_pence: number;
    bonus_pence: number;
    active_subscribers_end: number;
    total_pence: number;
  }>;
  attributions: Array<{
    venue_id: string | null;
    venue_name: string;
    pricing_tier: string | null;
    plan_status: string | null;
    signed_up_at: string;
    first_paid_at: string | null;
    status: string;
    revenue_share_months_remaining: number | null;
  }>;
}

export async function loadSalesDashboardForUser(
  userId: string,
  supabase?: SupabaseClient,
): Promise<SalesDashboardData | null> {
  const db = supabase ?? getSupabaseAdminClient();

  const { data: spRow, error: spErr } = await db
    .from('salespeople')
    .select('id, user_id, email, name, lump_sum_per_signup_pence, revenue_share_percent, revenue_share_months')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle();
  if (spErr || !spRow) return null;

  const salesperson = spRow as SalespersonRow;
  const spId = salesperson.id;

  const [
    { data: codes },
    { data: statements },
    { data: attrs },
    { data: tiers },
    { data: awards },
    { data: allStatementTotals },
  ] = await Promise.all([
    db.from('sales_codes').select('code, active').eq('salesperson_id', spId).order('created_at'),
    db
      .from('sales_monthly_statements')
      .select(
        'period_month, signups_count, validated_count, lump_sum_pence, revenue_share_pence, bonus_pence, active_subscribers_end, total_pence',
      )
      .eq('salesperson_id', spId)
      .order('period_month', { ascending: false })
      .limit(24),
    db
      .from('sales_attributions')
      .select('venue_id, signed_up_at, first_paid_at, status')
      .eq('salesperson_id', spId)
      .order('signed_up_at', { ascending: false }),
    db
      .from('sales_bonus_tiers')
      .select('threshold, amount_pence')
      .eq('salesperson_id', spId)
      .order('threshold', { ascending: true }),
    db.from('sales_bonus_awards').select('threshold').eq('salesperson_id', spId),
    // Lifetime earnings sums every statement, not just the 24 most recent shown in the table.
    db.from('sales_monthly_statements').select('total_pence').eq('salesperson_id', spId),
  ]);

  const awardedSet = new Set((awards ?? []).map((a) => (a as { threshold: number }).threshold));
  const tierRows = (tiers ?? []) as BonusTierRow[];
  const activePaying = await countActivePayingSubscribers(db, spId);

  // Live "this month so far" estimate (not persisted; the cron writes the official statement).
  const currentMonth = monthStartUtc(new Date());
  let currentMonthEstimate = 0;
  try {
    const liveBreakdown = await computeMonthlyStatement({
      admin: db,
      salesperson,
      periodMonth: currentMonth,
      bonusTiers: tierRows,
    });
    currentMonthEstimate = liveBreakdown.total_pence;
  } catch (e) {
    console.error('[sales/load-dashboard] current month estimate failed', e);
  }

  const nextTier =
    tierRows.find((t) => !awardedSet.has(t.threshold) && activePaying < t.threshold) ?? null;

  const venueIds = (attrs ?? [])
    .map((a) => (a as { venue_id: string | null }).venue_id)
    .filter((id): id is string => Boolean(id));

  const venueMap = new Map<
    string,
    { name: string; pricing_tier: string | null; plan_status: string | null }
  >();
  if (venueIds.length) {
    const { data: venues } = await db
      .from('venues')
      .select('id, name, pricing_tier, plan_status')
      .in('id', venueIds);
    for (const v of venues ?? []) {
      venueMap.set((v as { id: string }).id, {
        name: (v as { name: string }).name,
        pricing_tier: (v as { pricing_tier: string | null }).pricing_tier,
        plan_status: (v as { plan_status: string | null }).plan_status,
      });
    }
  }

  const shareMonths = salesperson.revenue_share_months ?? 12;
  const nowMonth = monthStartUtc(new Date());

  const attributions = (attrs ?? []).map((row) => {
    const r = row as {
      venue_id: string | null;
      signed_up_at: string;
      first_paid_at: string | null;
      status: string;
    };
    const venue = r.venue_id ? venueMap.get(r.venue_id) : null;
    let monthsRemaining: number | null = null;
    if (r.first_paid_at) {
      const firstMonth = monthStartUtc(new Date(r.first_paid_at));
      const endMonth = (() => {
        const [y, m] = firstMonth.split('-').map(Number);
        const d = new Date(Date.UTC(y, (m ?? 1) - 1 + shareMonths, 1));
        return monthStartUtc(d);
      })();
      if (nowMonth < endMonth) {
        const [y1, m1] = nowMonth.split('-').map(Number);
        const [y2, m2] = endMonth.split('-').map(Number);
        monthsRemaining = (y2 - y1) * 12 + (m2 - m1);
      } else {
        monthsRemaining = 0;
      }
    }
    return {
      venue_id: r.venue_id,
      venue_name: venue?.name ?? '—',
      pricing_tier: venue?.pricing_tier ? planDisplayName(venue.pricing_tier) : null,
      plan_status: venue?.plan_status ?? null,
      signed_up_at: r.signed_up_at,
      first_paid_at: r.first_paid_at,
      status: r.status,
      revenue_share_months_remaining: monthsRemaining,
    };
  });

  const totalSignups = attributions.length;
  const validatedSignups = attributions.filter((a) => a.first_paid_at).length;
  const lifetimeEarnings = (allStatementTotals ?? []).reduce(
    (sum, s) => sum + ((s as { total_pence: number }).total_pence ?? 0),
    0,
  );

  return {
    salesperson: {
      id: salesperson.id,
      name: salesperson.name,
      email: salesperson.email,
      lump_sum_per_signup_pence: salesperson.lump_sum_per_signup_pence,
      revenue_share_percent: Number(salesperson.revenue_share_percent),
      revenue_share_months: salesperson.revenue_share_months,
    },
    codes: (codes ?? []).map((c) => ({
      code: (c as { code: string }).code,
      active: (c as { active: boolean }).active,
    })),
    summary: {
      total_signups: totalSignups,
      validated_signups: validatedSignups,
      active_paying_subscribers: activePaying,
      lifetime_earnings_pence: lifetimeEarnings,
      current_month_estimated_pence: currentMonthEstimate,
    },
    bonus_ladder: {
      tiers: tierRows.map((t) => ({
        threshold: t.threshold,
        amount_pence: t.amount_pence,
        awarded: awardedSet.has(t.threshold),
      })),
      next_tier: nextTier ? { threshold: nextTier.threshold, amount_pence: nextTier.amount_pence } : null,
    },
    statements: (statements ?? []).map((s) => ({
      period_month: (s as { period_month: string }).period_month,
      signups_count: (s as { signups_count: number }).signups_count,
      validated_count: (s as { validated_count: number }).validated_count,
      lump_sum_pence: (s as { lump_sum_pence: number }).lump_sum_pence,
      revenue_share_pence: (s as { revenue_share_pence: number }).revenue_share_pence,
      bonus_pence: (s as { bonus_pence: number }).bonus_pence,
      active_subscribers_end: (s as { active_subscribers_end: number }).active_subscribers_end,
      total_pence: (s as { total_pence: number }).total_pence,
    })),
    attributions,
  };
}
