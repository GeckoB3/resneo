import { NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';

/**
 * GET /api/venue/class-course-products/[id]/enrollments — list enrolled guests
 * for a course with per-session attendance status.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const { data: product } = await staff.db
      .from('class_course_products')
      .select('id, venue_id, name, session_instance_ids, cancellation_window_days')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!product) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const { data: enrollmentsRaw, error: enErr } = await staff.db
      .from('class_course_enrollments')
      .select('id, user_id, status, stripe_payment_intent_id, created_at, updated_at')
      .eq('course_product_id', id)
      .order('created_at', { ascending: false });
    if (enErr) {
      console.error('[venue/class-course-products/[id]/enrollments] GET', enErr);
      return NextResponse.json({ error: 'Failed to load enrollments' }, { status: 500 });
    }
    const enrollments = (enrollmentsRaw ?? []) as Array<{
      id: string;
      user_id: string;
      status: string;
      stripe_payment_intent_id: string | null;
      created_at: string;
      updated_at: string;
    }>;

    // Per-session attendance rows.
    const enrollmentIds = enrollments.map((e) => e.id);
    const { data: sessionLinks } =
      enrollmentIds.length > 0
        ? await staff.db
            .from('class_course_session_enrollments')
            .select('id, enrollment_id, class_instance_id, status')
            .in('enrollment_id', enrollmentIds)
        : { data: [] as unknown[] };

    // Guest display (best-effort — pull venue's guest row by user_id).
    const userIds = [...new Set(enrollments.map((e) => e.user_id))];
    const { data: guestRows } =
      userIds.length > 0
        ? await staff.db
            .from('guests')
            .select('id, user_id, first_name, last_name, email')
            .eq('venue_id', staff.venue_id)
            .in('user_id', userIds)
        : { data: [] as unknown[] };
    const guestByUser = new Map(
      ((guestRows ?? []) as Array<{ user_id: string; first_name: string | null; last_name: string | null; email: string | null }>).map(
        (g) => [g.user_id, g] as const,
      ),
    );

    const enriched = enrollments.map((e) => ({
      ...e,
      guest: guestByUser.get(e.user_id) ?? null,
    }));

    return NextResponse.json({
      product,
      enrollments: enriched,
      session_enrollments: sessionLinks ?? [],
    });
  } catch (e) {
    console.error('[venue/class-course-products/[id]/enrollments] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
