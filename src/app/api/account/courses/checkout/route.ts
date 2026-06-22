import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';

const bodySchema = z.object({
  venue_id: z.string().uuid(),
  product_id: z.string().uuid(),
});

/**
 * POST /api/account/courses/checkout — paid course: creates pending enrollment + PaymentIntent on venue Connect.
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

    const { data: venue, error: vErr } = await admin
      .from('venues')
      .select('id, stripe_connected_account_id')
      .eq('id', venue_id)
      .maybeSingle();

    if (vErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const acct = (venue as { stripe_connected_account_id?: string | null }).stripe_connected_account_id?.trim();
    if (!acct) {
      return NextResponse.json({ error: 'Venue has not connected Stripe' }, { status: 400 });
    }

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
    if (pricePence <= 0) {
      return NextResponse.json({ error: 'This course is free — use enroll instead.' }, { status: 400 });
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

    // Stale `pending_payment` holds are released by the
    // `expire-pending-course-enrollments` cron after 2h. Mirror that cutoff here so
    // an abandoned checkout never blocks a new buyer in the window before the cron
    // runs: count active enrollments plus only *fresh* pending holds (C9).
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
        console.error('[account/courses/checkout] count', aErr ?? pCountErr);
        return NextResponse.json({ error: 'Could not verify capacity' }, { status: 500 });
      }
      if ((activeCount ?? 0) + (pendingCount ?? 0) >= maxE) {
        return NextResponse.json({ error: 'This course is full' }, { status: 409 });
      }
    }

    const idempotencyKey = `course_checkout:${user.id}:${product_id}`;

    const { data: activeEnroll } = await admin
      .from('class_course_enrollments')
      .select('id')
      .eq('user_id', user.id)
      .eq('course_product_id', product_id)
      .eq('status', 'active')
      .maybeSingle();

    if (activeEnroll) {
      return NextResponse.json({ error: 'You are already enrolled in this course' }, { status: 409 });
    }

    const { data: pendingEnroll } = await admin
      .from('class_course_enrollments')
      .select('id, status, stripe_payment_intent_id')
      .eq('user_id', user.id)
      .eq('course_product_id', product_id)
      .eq('status', 'pending_payment')
      .maybeSingle();

    if (pendingEnroll) {
      const row = pendingEnroll as { id: string; stripe_payment_intent_id: string | null };
      if (row.stripe_payment_intent_id) {
        const pi = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id, { stripeAccount: acct });
        if (pi.status === 'succeeded') {
          return NextResponse.json({ error: 'Payment already completed' }, { status: 409 });
        }
        // The PI may have been cancelled by the stale-pending cleanup cron (C9).
        // Don't hand back a dead client_secret — drop the row and mint a fresh one.
        if (pi.status === 'canceled') {
          await admin.from('class_course_enrollments').delete().eq('id', row.id);
        } else if (pi.client_secret) {
          return NextResponse.json({
            enrollment_id: row.id,
            client_secret: pi.client_secret,
            stripe_account_id: acct,
            amount_pence: pricePence,
            payment_intent_id: pi.id,
          });
        }
      } else {
        await admin.from('class_course_enrollments').delete().eq('id', row.id);
      }
    }

    const { data: enrollment, error: insErr } = await admin
      .from('class_course_enrollments')
      .insert({
        course_product_id: product_id,
        venue_id,
        user_id: user.id,
        guest_id: null,
        status: 'pending_payment',
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single();

    if (insErr || !enrollment) {
      const code = (insErr as { code?: string })?.code;
      if (code === '23505') {
        return NextResponse.json({ error: 'Already enrolled' }, { status: 409 });
      }
      console.error('[account/courses/checkout] insert', insErr);
      return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 });
    }

    const enrollmentId = (enrollment as { id: string }).id;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: pricePence,
        currency: 'gbp',
        metadata: {
          reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.CLASS_COURSE_ENROLLMENT,
          user_id: user.id,
          venue_id,
          product_id,
          enrollment_id: enrollmentId,
        },
        automatic_payment_methods: { enabled: true },
      },
      { stripeAccount: acct },
    );

    const { error: upErr } = await admin
      .from('class_course_enrollments')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrollmentId);

    if (upErr) {
      console.error('[account/courses/checkout] link PI', upErr);
      await admin.from('class_course_enrollments').delete().eq('id', enrollmentId);
      return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
    }

    return NextResponse.json({
      enrollment_id: enrollmentId,
      client_secret: paymentIntent.client_secret,
      stripe_account_id: acct,
      amount_pence: pricePence,
      payment_intent_id: paymentIntent.id,
    });
  } catch (e) {
    console.error('[account/courses/checkout]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
