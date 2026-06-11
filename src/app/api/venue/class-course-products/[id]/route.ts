import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { classCourseProductPatchSchema } from '@/lib/class-commerce/product-schemas';
import { assertClassInstancesForVenue } from '@/lib/class-commerce/validate-venue-product-refs';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const { data: existing, error: exErr } = await staff.db
      .from('class_course_products')
      .select('*')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (exErr || !existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = classCourseProductPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as Record<string, unknown>;

    const mergedActive = (patch.active !== undefined ? patch.active : (existing as { active: boolean }).active) !== false;
    const mergedSessions =
      patch.session_instance_ids !== undefined
        ? (patch.session_instance_ids as string[])
        : ((existing as { session_instance_ids: string[] }).session_instance_ids ?? []);

    if (mergedActive && mergedSessions.length === 0) {
      return NextResponse.json(
        { error: 'Add at least one class session before publishing this course.' },
        { status: 400 },
      );
    }

    if (patch.session_instance_ids !== undefined) {
      const instCheck = await assertClassInstancesForVenue(staff.db, staff.venue_id, patch.session_instance_ids as string[]);
      if (!instCheck.ok) {
        return NextResponse.json({ error: instCheck.error }, { status: 400 });
      }
    }

    const { data, error } = await staff.db
      .from('class_course_products')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[class-course-products] PATCH', error);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ product: data });
  } catch (e) {
    console.error('[class-course-products] PATCH', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const { count, error: cErr } = await staff.db
      .from('class_course_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('course_product_id', id)
      .in('status', ['pending_payment', 'active']);

    if (cErr) {
      console.error('[class-course-products] DELETE count', cErr);
      return NextResponse.json({ error: 'Could not verify enrollments' }, { status: 500 });
    }
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'This course cannot be deleted while there are active or pending enrollments. Archive it instead.',
        },
        { status: 409 },
      );
    }

    const { error } = await staff.db.from('class_course_products').delete().eq('id', id).eq('venue_id', staff.venue_id);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503') {
        return NextResponse.json({ error: 'This course is still referenced and cannot be deleted.' }, { status: 409 });
      }
      console.error('[class-course-products] DELETE', error);
      return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[class-course-products] DELETE', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
