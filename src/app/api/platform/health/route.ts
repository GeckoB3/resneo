import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { planDisplayName } from '@/lib/pricing-constants';
import { effectivePlanStatus } from '@/lib/billing/subscription-entitlement';

export type HealthBand = 'healthy' | 'watch' | 'at_risk';

interface HealthStatsRow {
  venue_id: string;
  bookings_last_30: number | string;
  bookings_prev_30: number | string;
  bookings_last_7: number | string;
  last_booking_at: string | null;
  upcoming_bookings: number | string;
}

function n(v: number | string): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

/**
 * GET /api/platform/health
 * Venue health scores for live venues: booking trend (30d vs prior 30d), recency,
 * upcoming pipeline, billing state — scored 0–100 with explicit risk flags.
 */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const admin = getSupabaseAdminClient();

  try {
    const [venuesRes, statsRes] = await Promise.all([
      admin
        .from('venues')
        .select('id, name, slug, pricing_tier, plan_status, billing_access_source, onboarding_completed, created_at, subscription_current_period_end')
        .eq('is_test', false),
      admin.rpc('platform_venue_health_stats'),
    ]);

    if (venuesRes.error) {
      console.error('[platform/health] venues:', venuesRes.error.message);
      return NextResponse.json({ error: 'Failed to load venues' }, { status: 500 });
    }
    if (statsRes.error) {
      console.error('[platform/health] rpc:', statsRes.error.message);
      return NextResponse.json(
        { error: 'Health aggregates unavailable. Apply migration 20261213120000_platform_admin_suite.sql.' },
        { status: 500 },
      );
    }

    const statsByVenue = new Map<string, HealthStatsRow>();
    for (const r of (statsRes.data ?? []) as HealthStatsRow[]) {
      statsByVenue.set(r.venue_id, r);
    }

    const now = Date.now();
    const msDay = 86400000;

    const rows = ((venuesRes.data ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      pricing_tier: string | null;
      plan_status: string | null;
      billing_access_source: string | null;
      onboarding_completed: boolean;
      created_at: string;
      subscription_current_period_end: string | null;
    }>).map((v) => {
      const st = statsByVenue.get(v.id);
      const last30 = st ? n(st.bookings_last_30) : 0;
      const prev30 = st ? n(st.bookings_prev_30) : 0;
      const last7 = st ? n(st.bookings_last_7) : 0;
      const upcoming = st ? n(st.upcoming_bookings) : 0;
      const lastBookingAt = st?.last_booking_at ?? null;
      // Effective status: a venue stuck at 'cancelling' past its period end scores/flags as 'cancelled'.
      const status = effectivePlanStatus(v.plan_status, v.subscription_current_period_end, now);
      const ageDays = Math.floor((now - new Date(v.created_at).getTime()) / msDay);
      const daysSinceLastBooking = lastBookingAt
        ? Math.floor((now - new Date(lastBookingAt).getTime()) / msDay)
        : null;

      const trendPct =
        prev30 > 0 ? Math.round(((last30 - prev30) / prev30) * 100) : last30 > 0 ? 100 : 0;

      const flags: string[] = [];
      if (status === 'past_due') flags.push('Payment past due');
      if (status === 'cancelling') flags.push('Cancelling');
      if (!v.onboarding_completed && ageDays > 7) flags.push('Onboarding incomplete (>7 days)');
      if (ageDays > 14 && daysSinceLastBooking === null) flags.push('Never taken a booking');
      if (daysSinceLastBooking !== null && daysSinceLastBooking >= 14) {
        flags.push(`No bookings for ${daysSinceLastBooking} days`);
      }
      if (prev30 >= 5 && trendPct <= -30) flags.push(`Bookings down ${Math.abs(trendPct)}% vs prior 30d`);

      // Score: start at 100, subtract weighted penalties; floor at 0.
      let score = 100;
      if (status === 'past_due') score -= 35;
      if (status === 'cancelling') score -= 50;
      if (status === 'cancelled') score -= 80;
      if (!v.onboarding_completed && ageDays > 7) score -= 20;
      if (ageDays > 14 && daysSinceLastBooking === null) score -= 30;
      else if (daysSinceLastBooking !== null) {
        if (daysSinceLastBooking >= 30) score -= 30;
        else if (daysSinceLastBooking >= 14) score -= 15;
      }
      if (prev30 >= 5 && trendPct <= -30) score -= 20;
      else if (prev30 >= 5 && trendPct <= -10) score -= 8;
      if (upcoming === 0 && ageDays > 14) score -= 5;
      score = Math.max(0, Math.min(100, score));

      const band: HealthBand = score >= 75 ? 'healthy' : score >= 45 ? 'watch' : 'at_risk';

      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        plan: planDisplayName(v.pricing_tier),
        plan_status: status,
        comped: (v.billing_access_source ?? '') === 'superuser_free',
        onboarding_completed: v.onboarding_completed,
        age_days: ageDays,
        bookings_last_30: last30,
        bookings_prev_30: prev30,
        bookings_last_7: last7,
        upcoming_bookings: upcoming,
        trend_pct: trendPct,
        last_booking_at: lastBookingAt,
        days_since_last_booking: daysSinceLastBooking,
        score,
        band,
        flags,
      };
    });

    rows.sort((a, b) => a.score - b.score);

    const summary = {
      healthy: rows.filter((r) => r.band === 'healthy').length,
      watch: rows.filter((r) => r.band === 'watch').length,
      at_risk: rows.filter((r) => r.band === 'at_risk').length,
    };

    return NextResponse.json({ summary, venues: rows });
  } catch (e) {
    console.error('[platform/health]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
