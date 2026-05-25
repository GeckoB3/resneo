import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';
import { linkCourseSessionEnrollmentsForEnrollment } from '@/lib/class-commerce/link-course-session-enrollments';
import { sendClassCommerceComm } from '@/lib/communications/send-class-commerce';
import { earliestSessionDateForCourse } from '@/lib/class-commerce/course-cancellation';

export interface FulfillCourseEnrollmentParams {
  admin: SupabaseClient;
  paymentIntentId: string;
  stripeAccountId?: string | null;
}

/**
 * Idempotent: activates enrollment and links course sessions when PI metadata purpose is CLASS_COURSE_ENROLLMENT.
 */
export async function fulfillCourseEnrollmentFromPaymentIntent(
  params: FulfillCourseEnrollmentParams,
): Promise<{ fulfilled: boolean; reason?: string }> {
  const { admin, paymentIntentId, stripeAccountId } = params;

  let pi: Stripe.PaymentIntent;
  try {
    pi = stripeAccountId
      ? await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: stripeAccountId })
      : await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    console.error('[fulfillCourseEnrollment] retrieve PI failed', e);
    return { fulfilled: false, reason: 'retrieve_failed' };
  }

  if (pi.status !== 'succeeded') {
    return { fulfilled: false, reason: 'not_succeeded' };
  }

  const meta = pi.metadata ?? {};
  if (meta.reserve_ni_purpose !== RESERVE_NI_PI_PURPOSE.CLASS_COURSE_ENROLLMENT) {
    return { fulfilled: false, reason: 'wrong_purpose' };
  }

  const enrollmentId = meta.enrollment_id as string | undefined;
  const userId = meta.user_id as string | undefined;
  const venueId = meta.venue_id as string | undefined;
  const productId = meta.product_id as string | undefined;
  if (!enrollmentId || !userId || !venueId || !productId) {
    console.error('[fulfillCourseEnrollment] missing metadata', meta);
    return { fulfilled: false, reason: 'missing_metadata' };
  }

  const { data: enrollment, error: enErr } = await admin
    .from('class_course_enrollments')
    .select('id, status, user_id, venue_id, course_product_id')
    .eq('id', enrollmentId)
    .maybeSingle();

  if (enErr || !enrollment) {
    console.error('[fulfillCourseEnrollment] enrollment not found', enErr);
    return { fulfilled: false, reason: 'enrollment_not_found' };
  }

  const row = enrollment as {
    id: string;
    status: string;
    user_id: string;
    venue_id: string;
    course_product_id: string;
  };

  if (row.user_id !== userId || row.venue_id !== venueId || row.course_product_id !== productId) {
    return { fulfilled: false, reason: 'metadata_mismatch' };
  }

  if (row.status === 'active') {
    return { fulfilled: true, reason: 'already_active' };
  }

  const { data: product, error: pErr } = await admin
    .from('class_course_products')
    .select('session_instance_ids, name')
    .eq('id', productId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (pErr || !product) {
    console.error('[fulfillCourseEnrollment] product not found', pErr);
    return { fulfilled: false, reason: 'product_not_found' };
  }

  const sessionIds = ((product as { session_instance_ids: string[] | null }).session_instance_ids ?? []).filter(Boolean);

  const { error: upErr } = await admin
    .from('class_course_enrollments')
    .update({
      status: 'active',
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollmentId)
    .eq('status', 'pending_payment');

  if (upErr) {
    console.error('[fulfillCourseEnrollment] update enrollment', upErr);
    return { fulfilled: false, reason: 'update_failed' };
  }

  const linked = await linkCourseSessionEnrollmentsForEnrollment(admin, {
    enrollmentId,
    sessionInstanceIds: sessionIds,
  });
  if (!linked.ok) {
    console.error('[fulfillCourseEnrollment] link sessions', linked.error);
    return { fulfilled: false, reason: 'link_sessions_failed' };
  }

  // Phase 2 §5.5 — receipt email. Best-effort.
  try {
    const firstSessionDate = await earliestSessionDateForCourse(admin, productId);
    await sendClassCommerceComm({
      venueId,
      userId,
      payload: {
        key: 'class_course_enrolled',
        vars: {
          venueName: '',
          courseName: (product as { name?: string | null }).name?.trim() || 'course',
          sessionCount: sessionIds.length,
          firstSessionDate,
        },
      },
    });
  } catch (commsErr) {
    console.error('[fulfillCourseEnrollment] receipt comms failed', commsErr);
  }

  return { fulfilled: true };
}
