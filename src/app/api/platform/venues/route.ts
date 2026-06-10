import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';

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
 *   env       – live (default) | test | all — separates dev/test venues from real data
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
  if (env === 'test') {
    query = query.eq('is_test', true);
  } else if (env !== 'all') {
    query = query.eq('is_test', false);
  }

  const { data: venues, count, error } = await query;

  if (error) {
    console.error('[platform/venues] query error:', error);
    return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
  }

  return NextResponse.json({
    venues: venues ?? [],
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil((count ?? 0) / PAGE_SIZE),
  });
}
