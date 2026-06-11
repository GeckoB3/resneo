import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { classCourseProductBodySchema } from '@/lib/class-commerce/product-schemas';
import { assertClassInstancesForVenue } from '@/lib/class-commerce/validate-venue-product-refs';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';

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
      .from('class_course_products')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[class-course-products] GET', error);
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
    }
    return NextResponse.json({ products: data ?? [] });
  } catch (e) {
    console.error('[class-course-products] GET', e);
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
    const parsed = classCourseProductBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const instCheck = await assertClassInstancesForVenue(
      staff.db,
      staff.venue_id,
      parsed.data.session_instance_ids ?? [],
    );
    if (!instCheck.ok) {
      return NextResponse.json({ error: instCheck.error }, { status: 400 });
    }

    const { data, error } = await staff.db
      .from('class_course_products')
      .insert({
        venue_id: staff.venue_id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        price_pence: parsed.data.price_pence,
        currency: parsed.data.currency ?? 'gbp',
        max_enrollments: parsed.data.max_enrollments ?? null,
        opens_at: parsed.data.opens_at ?? null,
        closes_at: parsed.data.closes_at ?? null,
        session_instance_ids: parsed.data.session_instance_ids ?? [],
        active: parsed.data.active ?? true,
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[class-course-products] POST', error);
      return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
    }
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (e) {
    console.error('[class-course-products] POST', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
