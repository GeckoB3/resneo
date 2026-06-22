import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';
import {
  cancelByDateFromWindow,
  computeProratedRefundPence,
  countEnrollmentSessions,
  earliestSessionDateForCourse,
  withinCancellationWindow,
} from '@/lib/class-commerce/course-cancellation';
import { sendClassCommerceComm } from '@/lib/communications/send-class-commerce';

const bodySchema = z.object({
  cancel_reason: z.string().max(500).optional(),
  bypass_window: z.boolean().optional(),
});

/**
 * POST /api/venue/class-course-products/[id]/enrollments/[enrId]/cancel —
 * staff-side cancellation of a course enrollment. Refunds the Stripe PI by default
 * when within the window; with `bypass_window: true` an admin can cancel past the
 * window (no auto-refund — the staff must arrange it manually).
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; enrId: string }> },
) {
  try {
    const { id, enrId } = await ctx.params;
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: enrollmentRaw } = await staff.db
      .from('class_course_enrollments')
      .select('id, course_product_id, venue_id, user_id, status, stripe_payment_intent_id')
      .eq('id', enrId)
      .eq('course_product_id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!enrollmentRaw) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }
    const enrollment = enrollmentRaw as {
      id: string;
      course_product_id: string;
      venue_id: string;
      user_id: string;
      status: string;
      stripe_payment_intent_id: string | null;
    };
    if (enrollment.status === 'cancelled') {
      return NextResponse.json({ ok: true, already_cancelled: true });
    }

    const { data: courseRaw } = await staff.db
      .from('class_course_products')
      .select('id, cancellation_window_days, price_pence, name')
      .eq('id', enrollment.course_product_id)
      .maybeSingle();
    const course = courseRaw as {
      id: string;
      cancellation_window_days: number | null;
      price_pence: number;
      name: string | null;
    } | null;
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const firstSessionDate = await earliestSessionDateForCourse(staff.db, course.id);
    const cancelByDate = cancelByDateFromWindow(firstSessionDate, course.cancellation_window_days);
    const inWindow = withinCancellationWindow(cancelByDate);

    if (!inWindow && !parsed.data.bypass_window) {
      return NextResponse.json(
        {
          error: 'Cancellation window has passed. Pass bypass_window: true to force-cancel without an auto-refund.',
          cancel_by_date: cancelByDate,
        },
        { status: 409 },
      );
    }

    // M2: atomically claim the cancellation BEFORE refunding. The conditional
    // UPDATE (status 'active' → 'cancelled') is the single source of truth so a
    // double-submit / retry cannot trigger a second refund. Only the request
    // that actually flips the row proceeds to refund.
    const { data: claimedRows, error: claimErr } = await staff.db
      .from('class_course_enrollments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', enrollment.id)
      .eq('status', 'active')
      .select('id');
    if (claimErr) {
      console.error('[venue/courses/enrollments/cancel] claim', claimErr);
      return NextResponse.json({ error: 'Failed to cancel enrollment' }, { status: 500 });
    }
    if (!claimedRows || claimedRows.length === 0) {
      // Lost the race / retry of an already-cancelled enrollment — no refund.
      return NextResponse.json({ ok: true, already_cancelled: true });
    }

    // Refund only when in window AND the enrollment was paid. M3: prorate to
    // sessions not yet delivered.
    let refundAmountPence = 0;
    if (inWindow && enrollment.stripe_payment_intent_id && course.price_pence > 0) {
      const { data: venue } = await staff.db
        .from('venues')
        .select('stripe_connected_account_id, timezone')
        .eq('id', staff.venue_id)
        .maybeSingle();
      const venueRow = venue as { stripe_connected_account_id?: string | null; timezone?: string | null } | null;
      const acct = venueRow?.stripe_connected_account_id;
      if (acct) {
        const { total, remaining } = await countEnrollmentSessions(staff.db, {
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
            // M2: deterministic idempotency key so a retry that re-reaches
            // Stripe (e.g. after the revert below) cannot double-charge.
            await stripe.refunds.create(
              {
                payment_intent: enrollment.stripe_payment_intent_id,
                amount: refundAmountPence,
              },
              { stripeAccount: acct, idempotencyKey: `course_refund:${enrollment.id}` },
            );
          } catch (err) {
            console.error('[venue/courses/enrollments/cancel] refund failed', err);
            // Revert the claim so a retry can re-attempt; the idempotency key
            // prevents a double refund even if the original succeeded silently.
            await staff.db
              .from('class_course_enrollments')
              .update({ status: 'active', updated_at: new Date().toISOString() })
              .eq('id', enrollment.id);
            return NextResponse.json(
              { error: 'Refund failed. Enrollment unchanged.' },
              { status: 502 },
            );
          }
        }
      }
    }

    await staff.db
      .from('class_course_session_enrollments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('enrollment_id', enrollment.id)
      .in('status', ['scheduled']);

    // Cancel any related bookings for the guest.
    const { data: sessionLinks } = await staff.db
      .from('class_course_session_enrollments')
      .select('class_instance_id')
      .eq('enrollment_id', enrollment.id);
    const instanceIds = ((sessionLinks ?? []) as Array<{ class_instance_id: string }>).map((r) => r.class_instance_id);
    if (instanceIds.length > 0) {
      const { data: guestRows } = await staff.db
        .from('guests')
        .select('id')
        .eq('venue_id', staff.venue_id)
        .eq('user_id', enrollment.user_id);
      const guestIds = ((guestRows ?? []) as Array<{ id: string }>).map((g) => g.id);
      if (guestIds.length > 0) {
        await staff.db
          .from('bookings')
          .update({
            status: 'Cancelled',
            cancelled_by_staff_id: staff.id,
            cancellation_actor_type: 'staff',
            updated_at: new Date().toISOString(),
          })
          .in('class_instance_id', instanceIds)
          .in('guest_id', guestIds)
          .in('status', ['Pending', 'Booked', 'Confirmed']);
      }
    }

    await staff.db.from('events').insert({
      venue_id: staff.venue_id,
      event_type: 'class_course_cancelled',
      payload: {
        enrollment_id: enrollment.id,
        course_product_id: course.id,
        actor: 'staff',
        refund_amount_pence: refundAmountPence,
        reason: parsed.data.cancel_reason ?? null,
        bypass_window: Boolean(parsed.data.bypass_window),
      },
    });

    try {
      await sendClassCommerceComm({
        venueId: staff.venue_id,
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
      console.error('[venue/courses/enrollments/cancel] comms failed', commsErr);
    }

    return NextResponse.json({
      ok: true,
      refund_amount_pence: refundAmountPence,
      cancel_by_date: cancelByDate,
    });
  } catch (e) {
    console.error('[venue/courses/enrollments/cancel] POST', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
