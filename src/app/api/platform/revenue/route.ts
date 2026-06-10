import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  RESTAURANT_PRICE,
  planDisplayName,
} from '@/lib/pricing-constants';

interface VenueBillingRow {
  id: string;
  name: string;
  pricing_tier: string | null;
  plan_status: string | null;
  billing_access_source: string | null;
  is_test: boolean;
  founding_free_period_ends_at: string | null;
  created_at: string;
}

function monthlyPricePounds(row: VenueBillingRow): number {
  const tier = (row.pricing_tier ?? '').toLowerCase().trim();
  switch (tier) {
    case 'light':
      return APPOINTMENTS_LIGHT_PRICE;
    case 'plus':
      return APPOINTMENTS_PLUS_PRICE;
    case 'appointments':
      return APPOINTMENTS_PRO_PRICE;
    case 'restaurant':
      return RESTAURANT_PRICE;
    case 'founding': {
      // Founding partners are free until their free period ends, then bill at restaurant rate.
      const ends = row.founding_free_period_ends_at;
      if (ends && new Date(ends).getTime() > Date.now()) return 0;
      return RESTAURANT_PRICE;
    }
    default:
      return 0;
  }
}

function lastNMonthStartsUtc(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}

/**
 * GET /api/platform/revenue
 * MRR snapshot (computed from live venue plans), trial pipeline, collected revenue
 * by month (platform_invoices ledger), and recent invoices.
 */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const admin = getSupabaseAdminClient();
  const monthStarts = lastNMonthStartsUtc(12);

  try {
    const [venuesRes, invoicesByMonthRes, recentInvoicesRes] = await Promise.all([
      admin
        .from('venues')
        .select(
          'id, name, pricing_tier, plan_status, billing_access_source, is_test, founding_free_period_ends_at, created_at',
        )
        .eq('is_test', false),
      admin
        .from('platform_invoices')
        .select('period_month, amount_paid_pence')
        .gte('period_month', monthStarts[0]),
      admin
        .from('platform_invoices')
        .select('stripe_invoice_id, venue_id, amount_paid_pence, currency, paid_at')
        .order('paid_at', { ascending: false })
        .limit(15),
    ]);

    if (venuesRes.error) {
      console.error('[platform/revenue] venues:', venuesRes.error.message);
      return NextResponse.json({ error: 'Failed to load venues' }, { status: 500 });
    }

    const venues = (venuesRes.data ?? []) as VenueBillingRow[];

    let mrrPounds = 0;
    let payingCount = 0;
    let trialingCount = 0;
    let trialPipelinePounds = 0;
    let compedCount = 0;
    let pastDuePounds = 0;
    let pastDueCount = 0;
    const byPlan = new Map<string, { plan: string; count: number; mrr_pounds: number }>();

    for (const v of venues) {
      const status = (v.plan_status ?? '').toLowerCase().trim();
      const comped = (v.billing_access_source ?? '') === 'superuser_free';
      const price = monthlyPricePounds(v);
      const planLabel = planDisplayName(v.pricing_tier);

      if (comped) {
        compedCount++;
        continue;
      }
      if (status === 'active') {
        payingCount++;
        mrrPounds += price;
        const entry = byPlan.get(planLabel) ?? { plan: planLabel, count: 0, mrr_pounds: 0 };
        entry.count++;
        entry.mrr_pounds += price;
        byPlan.set(planLabel, entry);
      } else if (status === 'trialing') {
        trialingCount++;
        trialPipelinePounds += price;
      } else if (status === 'past_due') {
        pastDueCount++;
        pastDuePounds += price;
      }
    }

    // Collected revenue by month from the invoice ledger.
    const collected = new Map<string, number>(monthStarts.map((m) => [m, 0]));
    for (const row of (invoicesByMonthRes.data ?? []) as Array<{
      period_month: string;
      amount_paid_pence: number;
    }>) {
      const key = row.period_month;
      if (collected.has(key)) {
        collected.set(key, (collected.get(key) ?? 0) + (row.amount_paid_pence ?? 0));
      }
    }

    // Resolve venue names for recent invoices.
    const recentRaw = (recentInvoicesRes.data ?? []) as Array<{
      stripe_invoice_id: string;
      venue_id: string | null;
      amount_paid_pence: number;
      currency: string;
      paid_at: string | null;
    }>;
    const venueNameById = new Map(venues.map((v) => [v.id, v.name]));
    const missingIds = recentRaw
      .map((r) => r.venue_id)
      .filter((id): id is string => Boolean(id) && !venueNameById.has(id as string));
    if (missingIds.length) {
      const { data: extra } = await admin.from('venues').select('id, name').in('id', missingIds);
      for (const v of (extra ?? []) as Array<{ id: string; name: string }>) {
        venueNameById.set(v.id, v.name);
      }
    }

    return NextResponse.json({
      snapshot: {
        mrr_pence: Math.round(mrrPounds * 100),
        arr_pence: Math.round(mrrPounds * 12 * 100),
        paying_venues: payingCount,
        arpv_pence: payingCount > 0 ? Math.round((mrrPounds / payingCount) * 100) : 0,
        trialing_venues: trialingCount,
        trial_pipeline_pence: Math.round(trialPipelinePounds * 100),
        past_due_venues: pastDueCount,
        at_risk_mrr_pence: Math.round(pastDuePounds * 100),
        comped_venues: compedCount,
      },
      by_plan: [...byPlan.values()]
        .map((p) => ({ ...p, mrr_pence: Math.round(p.mrr_pounds * 100) }))
        .sort((a, b) => b.mrr_pence - a.mrr_pence),
      collected_by_month: monthStarts.map((m) => ({
        month: m,
        amount_pence: collected.get(m) ?? 0,
      })),
      recent_invoices: recentRaw.map((r) => ({
        stripe_invoice_id: r.stripe_invoice_id,
        venue_name: r.venue_id ? venueNameById.get(r.venue_id) ?? '—' : '—',
        amount_pence: r.amount_paid_pence,
        currency: r.currency,
        paid_at: r.paid_at,
      })),
    });
  } catch (e) {
    console.error('[platform/revenue]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
