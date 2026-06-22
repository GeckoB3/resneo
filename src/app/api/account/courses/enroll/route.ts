import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { linkCourseSessionEnrollmentsForEnrollment } from '@/lib/class-commerce/link-course-session-enrollments';

const bodySchema = z.object({
  venue_id: z.string().uuid(),
  product_id: z.string().uuid(),
});

/**
 * POST /api/account/courses/enroll — free courses only (price_pence = 0).
 * Paid course checkout is handled separately (future PaymentIntent flow).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { venue_id, product_id } = parsed.data;

    const { data: product, error: pErr } = await admin
      .from('class_course_products')
      .select('*')
      .eq('id', product_id)
      .eq('venue_id', venue_id)
      .eq('active', true)
      .maybeSingle();

    if (pErr || !product) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const pricePence = (product as { price_pence: number }).price_pence;
    if (pricePence > 0) {
      return NextResponse.json(
        { error: 'This course has a fee. Use “Paid course” on your account Courses page to pay and enroll.' },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const opensAt = (product as { opens_at: string | null }).opens_at;
    const closesAt = (product as { closes_at: string | null }).closes_at;
    if (opensAt && opensAt > now) {
      return NextResponse.json({ error: 'Enrollment is not open yet' }, { status: 400 });
    }
    if (closesAt && closesAt < now) {
      return NextResponse.json({ error: 'Enrollment has closed' }, { status: 400 });
    }

    // Mirror the stale-pending cutoff used by the cleanup cron (C9): count active
    // enrollments plus only *fresh* pending holds so abandoned paid checkouts don't
    // block a new enrollee before the cron releases them.
    const pendingCutoffIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const maxE = (product as { max_enrollments: number | null }).max_enrollments;
    if (maxE != null && maxE > 0) {
      const { count: activeCount, error: aErr } = await admin
        .from('class_course_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('course_product_id', product_id)
        .eq('status', 'active');
      const { count: pendingCount, error: pCountErr } = await admin
        .from('class_course_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('course_product_id', product_id)
        .eq('status', 'pending_payment')
        .gte('created_at', pendingCutoffIso);

      if (aErr || pCountErr) {
        console.error('[account/courses/enroll] count', aErr ?? pCountErr);
        return NextResponse.json({ error: 'Could not verify capacity' }, { status: 500 });
      }
      if ((activeCount ?? 0) + (pendingCount ?? 0) >= maxE) {
        return NextResponse.json({ error: 'This course is full' }, { status: 409 });
      }
    }

    const { data: existing } = await admin
      .from('class_course_enrollments')
      .select('id')
      .eq('user_id', user.id)
      .eq('course_product_id', product_id)
      .in('status', ['pending_payment', 'active'])
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'You are already enrolled in this course' }, { status: 409 });
    }

    const idempotencyKey = `enroll:${user.id}:${product_id}`;
    const { data: enrollment, error: insErr } = await admin
      .from('class_course_enrollments')
      .insert({
        course_product_id: product_id,
        venue_id,
        user_id: user.id,
        guest_id: null,
        status: 'active',
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single();

    if (insErr) {
      const code = (insErr as { code?: string }).code;
      if (code === '23505') {
        return NextResponse.json({ error: 'Already enrolled' }, { status: 409 });
      }
      console.error('[account/courses/enroll] insert', insErr);
      return NextResponse.json({ error: 'Enrollment failed' }, { status: 500 });
    }

    const sessionIds = ((product as { session_instance_ids: string[] | null }).session_instance_ids ?? []).filter(
      Boolean,
    );
    const enrollmentId = (enrollment as { id: string }).id;
    const linked = await linkCourseSessionEnrollmentsForEnrollment(admin, {
      enrollmentId,
      sessionInstanceIds: sessionIds,
    });
    if (!linked.ok) {
      await admin.from('class_course_enrollments').delete().eq('id', enrollmentId);
      return NextResponse.json({ error: linked.error }, { status: 500 });
    }

    return NextResponse.json({ enrollment_id: enrollmentId }, { status: 201 });
  } catch (e) {
    console.error('[account/courses/enroll]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
