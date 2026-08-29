import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';

const bodySchema = z.object({
  membership_id: z.string().uuid(),
});

/**
 * POST /api/account/memberships/resume — undo a scheduled cancellation (P2-6).
 *
 * THE GAP THIS FILLS. `POST .../cancel` sets `cancel_at_period_end` and there
 * was no route anywhere that could set it back. A customer who cancelled by
 * accident, or changed their mind the same afternoon, had no way to undo it
 * from the portal, from the app, or from anywhere else: the only remedy was
 * ringing the venue and asking someone to do it in Stripe. The Remediation
 * Register calls this the cheapest mitigation for accidental cancellation,
 * and it is cheap precisely because the subscription has not ended yet.
 *
 * IT IS NOT A RE-SUBSCRIBE. It only clears a scheduled cancellation on a
 * subscription that is still running, so it cannot charge anybody: no new
 * subscription, no new price, no new payment method. Once the period actually
 * ends, Stripe reports the subscription `canceled` and this refuses, because
 * reviving it would be a purchase and a purchase needs its own consent.
 *
 * NO v1 ALIAS (C7a), recorded in `customer-api-contract.test.ts`. Memberships
 * have no representation on `/api/v1/me` AT ALL, so aliasing this one verb
 * would publish a fragment of a family that is not there. P5-1 is where the
 * membership surface is added and aliased, driven by a real consumer.
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
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    // Scoped to the caller in the QUERY, mirroring the cancel route: a
    // membership belonging to somebody else reads as one that does not exist.
    const { data: row, error: fErr } = await admin
      .from('class_memberships')
      .select('id, venue_id, user_id, stripe_subscription_id, cancel_at_period_end')
      .eq('id', parsed.data.membership_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (fErr || !row) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    const membership = row as {
      venue_id: string;
      stripe_subscription_id?: string | null;
      cancel_at_period_end?: boolean | null;
    };

    if (!membership.cancel_at_period_end) {
      // Not an error worth alarming anyone with: the customer wanted the
      // membership to continue and it is continuing.
      return NextResponse.json({ ok: true, already_active: true });
    }

    const subId = membership.stripe_subscription_id?.trim();
    if (!subId) {
      return NextResponse.json({ error: 'No Stripe subscription linked yet' }, { status: 400 });
    }

    const { data: venue } = await admin
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', membership.venue_id)
      .maybeSingle();

    const acct = (
      venue as { stripe_connected_account_id?: string | null } | null
    )?.stripe_connected_account_id?.trim();
    if (!acct) {
      return NextResponse.json({ error: 'Venue Stripe account missing' }, { status: 400 });
    }

    /*
     * Stripe is asked FIRST, and the local row is only written if it agreed.
     * The other order would leave the portal saying the membership renews
     * while Stripe still intends to end it, and the customer would find out
     * when it stopped working. `cancel` takes the same order for the same
     * reason.
     */
    const subscription = await stripe.subscriptions.retrieve(subId, { stripeAccount: acct });
    if (subscription.status === 'canceled') {
      // Past the period end. Clearing the flag here would show an active
      // membership that Stripe has already finished with.
      return NextResponse.json(
        {
          error:
            'This membership has already ended, so it cannot be resumed. You can join again from this page.',
          code: 'CONFLICT',
        },
        { status: 409 },
      );
    }

    await stripe.subscriptions.update(subId, { cancel_at_period_end: false }, { stripeAccount: acct });

    await admin
      .from('class_memberships')
      .update({ cancel_at_period_end: false, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.membership_id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[account/memberships/resume]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
