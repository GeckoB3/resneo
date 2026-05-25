import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  extraVenueIdsFromUrl,
  getClassCommerceVenuesForUser,
} from '@/lib/class-commerce/user-venue-scope';

/**
 * GET /api/account/credits — balances + ledger for the signed-in user.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = getSupabaseAdminClient();

    const { data: balances, error: bErr } = await admin
      .from('user_class_credit_balances')
      .select('*')
      .eq('user_id', user.id)
      .order('expires_at', { ascending: true, nullsFirst: false });

    if (bErr) {
      console.error('[account/credits] balances', bErr);
      return NextResponse.json({ error: 'Failed to load balances' }, { status: 500 });
    }

    const { data: ledger, error: lErr } = await admin
      .from('class_credit_ledger')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (lErr) {
      console.error('[account/credits] ledger', lErr);
      return NextResponse.json({ error: 'Failed to load ledger' }, { status: 500 });
    }

    const balRows = (balances ?? []) as Array<{ product_id: string; venue_id: string }>;
    const productIds = [...new Set(balRows.map((b) => b.product_id))];
    const venueIds = [...new Set(balRows.map((b) => b.venue_id))];

    const [{ data: products }, { data: venues }] = await Promise.all([
      productIds.length
        ? admin.from('class_credit_products').select('id, name, venue_id').in('id', productIds)
        : Promise.resolve({ data: [] as unknown[] }),
      venueIds.length ? admin.from('venues').select('id, name').in('id', venueIds) : Promise.resolve({ data: [] as unknown[] }),
    ]);

    // Phase 3 §6.4 — scope the purchase catalog to venues the user has touched.
    // Unauthenticated discovery is via /api/account/discover-class-venues.
    // `?venue=<id>` is honoured as an additive scope so a first-time buyer
    // arriving via deep-link from the public booking page can see the product
    // they came to buy.
    const scopedVenueIds = await getClassCommerceVenuesForUser(
      admin,
      user.id,
      extraVenueIdsFromUrl(request.url),
    );

    const { data: catalogProducts, error: catErr } =
      scopedVenueIds.length > 0
        ? await admin
            .from('class_credit_products')
            .select('id, name, venue_id, credits_count, price_pence, currency')
            .eq('active', true)
            .in('venue_id', scopedVenueIds)
            .order('price_pence', { ascending: true })
            .limit(200)
        : { data: [] as unknown[], error: null };

    if (catErr) {
      console.error('[account/credits] catalog products', catErr);
    }

    const catRows = (catalogProducts ?? []) as Array<{ venue_id: string }>;
    const catalogVenueIds = [...new Set(catRows.map((r) => r.venue_id))];
    const { data: catalogVenues } =
      catalogVenueIds.length > 0
        ? await admin.from('venues').select('id, name').in('id', catalogVenueIds).order('name')
        : { data: [] as unknown[] };

    return NextResponse.json({
      balances: balances ?? [],
      ledger: ledger ?? [],
      products: products ?? [],
      venues: venues ?? [],
      purchase_catalog: {
        venues: catalogVenues ?? [],
        products: catalogProducts ?? [],
      },
    });
  } catch (e) {
    console.error('[account/credits] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
