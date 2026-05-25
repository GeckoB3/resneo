import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';

/**
 * GET /api/account/discover-class-venues?q=... — explicit cross-venue search for
 * class-commerce offerings. Replaces the previous behaviour of unconditionally
 * enumerating every active product/plan on the platform from the per-account
 * catalog routes.
 *
 * Returns venues that:
 *   - have at least one active class credit / course / membership product, AND
 *   - match the query string (substring of venue.name, case-insensitive).
 *
 * Auth required so the endpoint cannot be used as an open venue directory.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) {
      return NextResponse.json({ venues: [], note: 'Type at least 2 characters to search.' });
    }
    if (q.length > 80) {
      return NextResponse.json({ error: 'Query too long' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    // Find matching venues, scoped to those that actually sell class commerce.
    const [{ data: credits }, { data: courses }, { data: memberships }] = await Promise.all([
      admin
        .from('class_credit_products')
        .select('venue_id')
        .eq('active', true)
        .limit(1000),
      admin
        .from('class_course_products')
        .select('venue_id')
        .eq('active', true)
        .limit(1000),
      admin
        .from('class_membership_products')
        .select('venue_id')
        .eq('active', true)
        .not('stripe_price_id', 'is', null)
        .limit(1000),
    ]);

    const sellingVenueIds = new Set<string>();
    for (const r of [...(credits ?? []), ...(courses ?? []), ...(memberships ?? [])]) {
      const v = (r as { venue_id?: string | null }).venue_id;
      if (v) sellingVenueIds.add(v);
    }
    if (sellingVenueIds.size === 0) {
      return NextResponse.json({ venues: [] });
    }

    const { data: venues, error } = await admin
      .from('venues')
      .select('id, name, address')
      .ilike('name', `%${q.replace(/[%_]/g, '\\$&')}%`)
      .in('id', Array.from(sellingVenueIds))
      .order('name', { ascending: true })
      .limit(30);

    if (error) {
      console.error('[discover-class-venues] venues', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    return NextResponse.json({ venues: venues ?? [] });
  } catch (e) {
    console.error('[discover-class-venues] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
