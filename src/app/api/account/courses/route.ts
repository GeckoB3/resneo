import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  cancelByDateFromWindow,
  earliestSessionDateForCourse,
  withinCancellationWindow,
} from '@/lib/class-commerce/course-cancellation';
import {
  extraVenueIdsFromUrl,
  getClassCommerceVenuesForUser,
} from '@/lib/class-commerce/user-venue-scope';

/**
 * GET /api/account/courses — course enrollments for the signed-in user.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data: enrollments, error: eErr } = await admin
      .from('class_course_enrollments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (eErr) {
      console.error('[account/courses] enrollments', eErr);
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
    }

    const rows = enrollments ?? [];
    const productIds = [...new Set(rows.map((r: { course_product_id: string }) => r.course_product_id))];
    const venueIds = [...new Set(rows.map((r: { venue_id: string }) => r.venue_id))];

    const [{ data: products }, { data: venues }] = await Promise.all([
      productIds.length
        ? admin
            .from('class_course_products')
            .select('id, name, venue_id, price_pence, cancellation_window_days')
            .in('id', productIds)
        : Promise.resolve({ data: [] as unknown[] }),
      venueIds.length ? admin.from('venues').select('id, name').in('id', venueIds) : Promise.resolve({ data: [] as unknown[] }),
    ]);

    // Compute per-enrollment refund eligibility.
    const productById = new Map(
      ((products ?? []) as Array<{
        id: string;
        cancellation_window_days: number | null;
      }>).map((p) => [p.id, p] as const),
    );
    const enrichedEnrollments = await Promise.all(
      rows.map(async (r) => {
        const courseId = (r as { course_product_id: string }).course_product_id;
        const prod = productById.get(courseId) ?? null;
        const firstSessionDate = await earliestSessionDateForCourse(admin, courseId);
        const cancelByDate = cancelByDateFromWindow(firstSessionDate, prod?.cancellation_window_days ?? null);
        return {
          ...(r as Record<string, unknown>),
          first_session_date: firstSessionDate,
          cancel_by_date: cancelByDate,
          can_cancel_now: withinCancellationWindow(cancelByDate),
        };
      }),
    );

    // Phase 3 §6.4 — scope the purchase catalog to venues the user has touched,
    // plus any venue passed via `?venue=` deep-link.
    const scopedVenueIds = await getClassCommerceVenuesForUser(
      admin,
      user.id,
      extraVenueIdsFromUrl(request.url),
    );

    const { data: catalogCourses, error: catErr } =
      scopedVenueIds.length > 0
        ? await admin
            .from('class_course_products')
            .select('id, name, venue_id, price_pence, currency')
            .eq('active', true)
            .in('venue_id', scopedVenueIds)
            .order('name', { ascending: true })
            .limit(200)
        : { data: [] as unknown[], error: null };

    if (catErr) {
      console.error('[account/courses] catalog', catErr);
    }

    const cRows = (catalogCourses ?? []) as Array<{ venue_id: string }>;
    const catalogVenueIds = [...new Set(cRows.map((r) => r.venue_id))];
    const { data: catalogVenues } =
      catalogVenueIds.length > 0
        ? await admin.from('venues').select('id, name').in('id', catalogVenueIds).order('name')
        : { data: [] as unknown[] };

    return NextResponse.json({
      enrollments: enrichedEnrollments,
      products: products ?? [],
      venues: venues ?? [],
      purchase_catalog: {
        venues: catalogVenues ?? [],
        courses: catalogCourses ?? [],
      },
    });
  } catch (e) {
    console.error('[account/courses] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
