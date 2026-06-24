import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import {
  cancelByDateFromWindow,
  computeProratedRefundPence,
  countEnrollmentSessions,
  earliestSessionDateForCourse,
  withinCancellationWindow,
} from '@/lib/class-commerce/course-cancellation';
import { sendClassCommerceComm } from '@/lib/communications/send-class-commerce';

const bodySchema = z.object({
  enrollment_id: z.string().uuid(),
});

interface EnrollmentRow {
  id: string;
  course_product_id: string;
  venue_id: string;
  user_id: string;
  status: string;
  stripe_payment_intent_id: string | null;
}

interface CourseRow {
  id: string;
  venue_id: string;
  cancellation_window_days: number | null;
  price_pence: number;
}

/**
 * POST /api/account/courses/cancel — guest cancels an active course enrollment
 * within the configured `cancellation_window_days`. Refunds the Stripe PI on
 * the venue connected account and marks linked session enrollments cancelled.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    const { data: enrollmentRaw, error: enErr } = await admin
      .from('class_course_enrollments')
      .select('id, course_product_id, venue_id, user_id, status, stripe_payment_intent_id')
      .eq('id', parsed.data.enrollment_id)
      .maybeSingle();
    if (enErr) {
      console.error('[courses/cancel] load enrollment', enErr);
      return NextResponse.json({ error: 'Failed to load enrollment' }, { status: 500 });
    }
    if (!enrollmentRaw) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    const enrollment = enrollmentRaw as EnrollmentRow;
    if (enrollment.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (enrollment.status !== 'active') {
      return NextResponse.json(
        { error: 'Only active enrollments can be cancelled here.' },
        { status: 409 },
      );
    }

    const { data: courseRaw } = await admin
      .from('class_course_products')
      .select('id, venue_id, cancellation_window_days, price_pence, name')
      .eq('id', enrollment.course_product_id)
      .maybeSingle();
    const course = courseRaw as (CourseRow & { name: string | null }) | null;
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const firstSessionDate = await earliestSessionDateForCourse(admin, course.id);
    const cancelByDate = cancelByDateFromWindow(firstSessionDate, course.cancellation_window_days);
    if (!withinCancellationWindow(cancelByDate)) {
      return NextResponse.json(
        { error: 'Cancellation window has passed', cancel_by_date: cancelByDate },
        { status: 409 },
      );
    }

    // M2: atomically claim the cancellation BEFORE refunding. The conditional
    // UPDATE (status 'active' → 'cancelled') is the single source of truth —
    // a concurrent double-submit / retry loses the race and gets no second
    // refund. Only the request that flips the row proceeds to refund.
    const { data: claimedRows, error: claimErr } = await admin
      .from('class_course_enrollments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', enrollment.id)
      .eq('status', 'active')
      .select('id');
    if (claimErr) {
      console.error('[courses/cancel] claim enrollment', claimErr);
      return NextResponse.json({ error: 'Failed to cancel enrollment' }, { status: 500 });
    }
    if (!claimedRows || claimedRows.length === 0) {
      // Someone else already cancelled it (or a retry of this same request) —
      // do NOT refund again.
      return NextResponse.json(
        { error: 'Enrollment is already cancelled.', already_cancelled: true },
        { status: 409 },
      );
    }

    // M3: prorate the refund to sessions not yet delivered.
    const { data: venue } = await admin
      .from('venues')
      .select('stripe_connected_account_id, timezone')
      .eq('id', enrollment.venue_id)
      .maybeSingle();
    const venueRow = venue as { stripe_connected_account_id?: string | null; timezone?: string | null } | null;
    const acct = venueRow?.stripe_connected_account_id;

    let refundAmountPence = 0;
    if (enrollment.stripe_payment_intent_id && course.price_pence > 0 && acct) {
      const { total, remaining } = await countEnrollmentSessions(admin, {
        enrollmentId: enrollment.id,
        venueTimezone: venueRow?.timezone,
      });
      refundAmountPence = computeProratedRefundPence({
        pricePence: course.price_pence,
        totalSessions: total,
        remainingSessions: remaining,
      });

      if (refundAmountPence > 0) {
        try {
          // M2: deterministic idempotency key → a retry that re-reaches Stripe
          // (e.g. after the revert below) cannot double-charge the venue.
          await stripe.refunds.create(
            {
              payment_intent: enrollment.stripe_payment_intent_id,
              amount: refundAmountPence,
            },
            { stripeAccount: acct, idempotencyKey: `course_refund:${enrollment.id}` },
          );
        } catch (err) {
          console.error('[courses/cancel] refund failed', err);
          // Refund failed but we already claimed the row → revert to 'active'
          // so a retry can re-attempt. The idempotency key guarantees the
          // retry won't refund twice even if the original silently succeeded.
          await admin
            .from('class_course_enrollments')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('id', enrollment.id);
          return NextResponse.json(
            { error: 'Refund failed. Your enrollment is unchanged. Please try again or contact the venue.' },
            { status: 502 },
          );
        }
      }
    }

    // Cancel linked session enrollments.
    await admin
      .from('class_course_session_enrollments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('enrollment_id', enrollment.id)
      .in('status', ['scheduled']);

    // Cancel bookings tied to those instances for this guest, if any.
    const { data: sessionLinks } = await admin
      .from('class_course_session_enrollments')
      .select('class_instance_id')
      .eq('enrollment_id', enrollment.id);
    const sessionInstanceIds = ((sessionLinks ?? []) as Array<{ class_instance_id: string }>)
      .map((r) => r.class_instance_id)
      .filter(Boolean);

    if (sessionInstanceIds.length > 0) {
      // Resolve guest row(s) for this user at this venue.
      const { data: guestRows } = await admin
        .from('guests')
        .select('id')
        .eq('venue_id', enrollment.venue_id)
        .eq('user_id', enrollment.user_id);
      const guestIds = ((guestRows ?? []) as Array<{ id: string }>).map((g) => g.id);
      if (guestIds.length > 0) {
        await admin
          .from('bookings')
          .update({
            status: 'Cancelled',
            cancellation_actor_type: 'customer',
            updated_at: new Date().toISOString(),
          })
          .in('class_instance_id', sessionInstanceIds)
          .in('guest_id', guestIds)
          .in('status', ['Pending', 'Booked', 'Confirmed']);
      }
    }

    await admin.from('events').insert({
      venue_id: enrollment.venue_id,
      event_type: 'class_course_cancelled',
      payload: {
        enrollment_id: enrollment.id,
        course_product_id: course.id,
        actor: 'guest',
        refund_amount_pence: refundAmountPence,
      },
    });

    try {
      await sendClassCommerceComm({
        venueId: enrollment.venue_id,
        userId: enrollment.user_id,
        payload: {
          key: 'class_course_refunded',
          vars: {
            venueName: '',
            courseName: course.name?.trim() || 'course',
            refundAmountPence,
          },
        },
      });
    } catch (commsErr) {
      console.error('[courses/cancel] comms failed', commsErr);
    }

    return NextResponse.json({
      ok: true,
      refund_amount_pence: refundAmountPence,
      cancel_by_date: cancelByDate,
    });
  } catch (e) {
    console.error('[courses/cancel] POST', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
