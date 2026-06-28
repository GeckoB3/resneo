import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { effectivePlanStatus } from '@/lib/billing/subscription-entitlement';

const PAGE_SIZE = 50;

/**
 * GET /api/platform/venues
 *
 * Returns paginated list of all venues with nested staff members.
 *
 * Query params:
 *   page      – 1-based page number (default 1)
 *   search    – case-insensitive substring match on venue name or slug
 *   tier      – filter by pricing_tier (appointments | restaurant | founding)
 *   status    – filter by plan_status  (active | past_due | cancelled | trialing)
 *   env       – live (default) | cancelled | test | all
 *               live      – real venues that still have access (excludes fully-cancelled)
 *               cancelled – real venues whose subscription has ended (plan_status = cancelled)
 *               test      – dev/test venues
 *               all       – everything, no filtering
 */
export async function GET(req: NextRequest) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const admin = getSupabaseAdminClient();
  const { searchParams } = req.nextUrl;

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const search = searchParams.get('search')?.trim() ?? '';
  const tier = searchParams.get('tier')?.trim() ?? '';
  const status = searchParams.get('status')?.trim() ?? '';
  const env = searchParams.get('env')?.trim() || 'live';

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from('venues')
    .select(
      `id, name, slug, email, phone, pricing_tier, plan_status, billing_access_source,
       stripe_customer_id, stripe_subscription_id,
       subscription_current_period_start, subscription_current_period_end, booking_model,
       created_at, onboarding_completed, is_test,
       staff ( id, email, name, phone, role, created_at )`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
  }
  if (tier) {
    query = query.eq('pricing_tier', tier);
  }
  if (status) {
    query = query.eq('plan_status', status);
  }
  // "Effectively cancelled" = fully ended subscription with no remaining access:
  //   plan_status = 'cancelled', OR a 'cancelling' venue whose paid period has already ended
  //   (a missed/late Stripe `customer.subscription.deleted` webhook can leave a row stuck at
  //   'cancelling' past its period end). A 'cancelling' venue with a future or unknown period
  //   end still has access and stays in 'live'. Milliseconds are stripped from the cutoff so the
  //   timestamp carries no '.' that PostgREST could mis-parse inside an or() group.
  // One cutoff instant shared by the SQL filter and the displayed status, so a row can never sit in
  // the live tab yet render the 'cancelled' label (or vice versa). Milliseconds are stripped so the
  // timestamp carries no '.' that PostgREST could mis-parse inside an or() group; cutoffMs is parsed
  // back from the same (second-floored) string so both sides compare against the identical instant.
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const cutoffMs = Date.parse(nowIso);
  const effectivelyCancelled = `plan_status.eq.cancelled,and(plan_status.eq.cancelling,subscription_current_period_end.lte.${nowIso})`;
  const notEffectivelyCancelled = `plan_status.neq.cancelling,subscription_current_period_end.gt.${nowIso},subscription_current_period_end.is.null`;

  if (env === 'test') {
    query = query.eq('is_test', true);
  } else if (env === 'cancelled') {
    // Real venues whose subscription has fully ended (no remaining access).
    query = query.eq('is_test', false).or(effectivelyCancelled);
  } else if (env !== 'all') {
    // live: real venues that still have access — exclude fully-cancelled and period-ended cancelling.
    query = query.eq('is_test', false).neq('plan_status', 'cancelled').or(notEffectivelyCancelled);
  }

  const { data: venues, count, error } = await query;

  if (error) {
    console.error('[platform/venues] query error:', error);
    return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
  }

  // Present the *effective* status so a row stuck at 'cancelling' past its period end reads as
  // 'cancelled' on the Cancelled / All tabs, matching the env filtering above (same cutoffMs).
  const rows = (venues ?? []).map((v) => ({
    ...v,
    plan_status: effectivePlanStatus(
      (v as { plan_status?: string | null }).plan_status,
      (v as { subscription_current_period_end?: string | null }).subscription_current_period_end,
      cutoffMs,
    ),
  }));

  return NextResponse.json({
    venues: rows,
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil((count ?? 0) / PAGE_SIZE),
  });
}
