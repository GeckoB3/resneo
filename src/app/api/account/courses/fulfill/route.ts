import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { fulfillCourseEnrollmentFromPaymentIntent } from '@/lib/class-commerce/fulfill-course-enrollment';

const bodySchema = z.object({
  payment_intent_id: z.string().min(1),
  stripe_account_id: z.string().min(1),
});

/**
 * POST /api/account/courses/fulfill — after client confirms PaymentIntent, activate enrollment idempotently.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const pi = await stripe.paymentIntents.retrieve(parsed.data.payment_intent_id, {
      stripeAccount: parsed.data.stripe_account_id,
    });

    if (pi.metadata?.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (pi.status !== 'succeeded') {
      return NextResponse.json({ error: 'Payment not completed yet', status: pi.status }, { status: 409 });
    }

    const admin = getSupabaseAdminClient();
    const res = await fulfillCourseEnrollmentFromPaymentIntent({
      admin,
      paymentIntentId: pi.id,
      stripeAccountId: parsed.data.stripe_account_id,
    });

    return NextResponse.json({ ok: true, fulfilled: res.fulfilled, reason: res.reason });
  } catch (e) {
    console.error('[account/courses/fulfill]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
