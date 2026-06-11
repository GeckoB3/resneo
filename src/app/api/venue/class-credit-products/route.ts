import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { classCreditProductBodySchema } from '@/lib/class-commerce/product-schemas';
import { assertEligibleClassTypesForVenue } from '@/lib/class-commerce/validate-venue-product-refs';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';

/**
 * GET /api/venue/class-credit-products — list credit packs for the current venue (staff).
 * POST — create a credit pack (staff).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const { data, error } = await staff.db
      .from('class_credit_products')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[class-credit-products] GET', error);
      return NextResponse.json({ error: 'Failed to load products' }, { status: 500 });
    }

    return NextResponse.json({ products: data ?? [] });
  } catch (e) {
    console.error('[class-credit-products] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const body = await request.json().catch(() => ({}));
    const parsed = classCreditProductBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const typeCheck = await assertEligibleClassTypesForVenue(
      staff.db,
      staff.venue_id,
      parsed.data.eligible_class_type_ids ?? null,
    );
    if (!typeCheck.ok) {
      return NextResponse.json({ error: typeCheck.error }, { status: 400 });
    }

    const { data, error } = await staff.db
      .from('class_credit_products')
      .insert({
        venue_id: staff.venue_id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        credits_count: parsed.data.credits_count,
        price_pence: parsed.data.price_pence,
        currency: parsed.data.currency ?? 'gbp',
        validity_days: parsed.data.validity_days ?? null,
        eligible_class_type_ids: parsed.data.eligible_class_type_ids ?? null,
        active: parsed.data.active ?? true,
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[class-credit-products] POST', error);
      return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
    }

    return NextResponse.json({ product: data }, { status: 201 });
  } catch (e) {
    console.error('[class-credit-products] POST', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
