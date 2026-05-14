import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  formatPeriodByModelSummary,
  resolveVenueEnabledModelLabels,
} from '@/lib/platform/subscriber-report';

function parseUtcDateStart(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function defaultRange(): { from: Date; toExclusive: Date } {
  const toExclusive = new Date();
  const from = new Date(toExclusive.getTime());
  from.setUTCDate(from.getUTCDate() - 30);
  return { from, toExclusive };
}

/**
 * GET /api/platform/subscribers
 *
 * Subscriber intelligence for platform superusers. Middleware enforces access.
 *
 * Query:
 *   from       – optional YYYY-MM-DD (UTC start of day)
 *   to         – optional YYYY-MM-DD (UTC end inclusive → exclusive bound is next day 00:00 UTC)
 *   search     – optional substring on venue name or slug
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const search = searchParams.get('search')?.trim() ?? '';

    let from: Date;
    let toExclusive: Date;
    const fromStr = searchParams.get('from')?.trim();
    const toStr = searchParams.get('to')?.trim();

    if (fromStr && toStr) {
      const f = parseUtcDateStart(fromStr);
      const t = parseUtcDateStart(toStr);
      if (!f || !t) {
        return NextResponse.json({ error: 'Invalid from or to date (use YYYY-MM-DD).' }, { status: 400 });
      }
      if (t.getTime() < f.getTime()) {
        return NextResponse.json({ error: 'End date must be on or after start date.' }, { status: 400 });
      }
      from = f;
      toExclusive = addUtcDays(t, 1);
    } else {
      ({ from, toExclusive } = defaultRange());
    }

    const admin = getSupabaseAdminClient();

    let venueQuery = admin
      .from('venues')
      .select(
        `id, name, slug, email, pricing_tier, plan_status, billing_access_source,
         booking_model, enabled_models, active_booking_models,
         created_at, updated_at,
         subscription_current_period_start, subscription_current_period_end,
         stripe_subscription_id, onboarding_completed`,
      )
      .order('created_at', { ascending: false });

    if (search) {
      venueQuery = venueQuery.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    const [{ data: venues, error: vErr }, rpcResult, newRes, churnRes] = await Promise.all([
      venueQuery,
      admin.rpc('platform_venue_booking_stats', {
        p_from: from.toISOString(),
        p_to_excl: toExclusive.toISOString(),
      }),
      admin
        .from('venues')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', from.toISOString())
        .lt('created_at', toExclusive.toISOString()),
      admin
        .from('venues')
        .select('id', { count: 'exact', head: true })
        .in('plan_status', ['cancelled', 'cancelling'])
        .lt('created_at', from.toISOString())
        .gte('updated_at', from.toISOString())
        .lt('updated_at', toExclusive.toISOString()),
    ]);

    if (vErr) {
      console.error('[platform/subscribers] venues:', vErr.message);
      return NextResponse.json({ error: 'Failed to load venues' }, { status: 500 });
    }

    if (rpcResult.error) {
      console.error('[platform/subscribers] rpc:', rpcResult.error.message);
      return NextResponse.json(
        {
          error:
            'Booking aggregates unavailable. Apply migration 20260918120000_platform_venue_booking_stats.sql or check database logs.',
        },
        { status: 500 },
      );
    }

    const statsRows = (rpcResult.data ?? []) as Array<{
      venue_id: string;
      all_time_count: number | string;
      period_count: number | string;
      period_by_model: Record<string, unknown> | null;
    }>;

    const statsByVenue = new Map<
      string,
      { allTime: number; period: number; byModel: Record<string, number> }
    >();
    for (const r of statsRows) {
      const byRaw = r.period_by_model ?? {};
      const byModel: Record<string, number> = {};
      for (const [k, v] of Object.entries(byRaw)) {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isNaN(n)) byModel[k] = n;
      }
      statsByVenue.set(r.venue_id, {
        allTime: Number(r.all_time_count) || 0,
        period: Number(r.period_count) || 0,
        byModel,
      });
    }

    const now = Date.now();
    const msDay = 86400000;

    const rows = (venues ?? []).map((v) => {
      const st = statsByVenue.get(v.id as string);
      const created = new Date((v as { created_at: string }).created_at).getTime();
      const subscriberDays = Math.max(0, Math.floor((now - created) / msDay));
      const tier = (v as { pricing_tier?: string }).pricing_tier ?? null;
      const enabledLabels = resolveVenueEnabledModelLabels({
        pricing_tier: tier,
        booking_model: (v as { booking_model?: string | null }).booking_model ?? null,
        enabled_models: (v as { enabled_models?: unknown }).enabled_models,
        active_booking_models: (v as { active_booking_models?: unknown }).active_booking_models,
      });

      return {
        id: v.id as string,
        name: (v as { name: string }).name,
        slug: (v as { slug: string }).slug,
        email: (v as { email?: string | null }).email ?? null,
        pricing_tier: tier ?? '',
        plan_status: ((v as { plan_status?: string }).plan_status ?? '') as string,
        billing_access_source: (v as { billing_access_source?: string | null }).billing_access_source ?? null,
        booking_model: (v as { booking_model?: string }).booking_model ?? 'table_reservation',
        enabled_model_labels: enabledLabels,
        created_at: (v as { created_at: string }).created_at,
        updated_at: (v as { updated_at: string }).updated_at,
        subscription_current_period_start:
          (v as { subscription_current_period_start?: string | null }).subscription_current_period_start ?? null,
        subscription_current_period_end:
          (v as { subscription_current_period_end?: string | null }).subscription_current_period_end ?? null,
        stripe_subscription_id: (v as { stripe_subscription_id?: string | null }).stripe_subscription_id ?? null,
        onboarding_completed: Boolean((v as { onboarding_completed?: boolean }).onboarding_completed),
        subscriber_days_on_platform: subscriberDays,
        all_time_bookings: st?.allTime ?? 0,
        period_bookings: st?.period ?? 0,
        period_by_model: st?.byModel ?? {},
        period_model_summary: formatPeriodByModelSummary(st?.byModel),
      };
    });

    let periodBookingsTotal = 0;
    for (const r of rows) periodBookingsTotal += r.period_bookings;

    const activeSnapshot = rows.filter((r) => {
      const s = r.plan_status.toLowerCase().trim();
      return s === 'active' || s === 'trialing';
    }).length;

    return NextResponse.json({
      period: {
        from: from.toISOString(),
        to_exclusive: toExclusive.toISOString(),
      },
      summary: {
        new_venues_in_period: newRes.count ?? 0,
        churned_in_period: churnRes.count ?? 0,
        /** Venues with plan active or trialing (current snapshot, not filtered by period). */
        active_subscriptions_snapshot: activeSnapshot,
        total_venues: rows.length,
        bookings_in_period_total: periodBookingsTotal,
      },
      venues: rows,
    });
  } catch (e) {
    console.error('[platform/subscribers]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
