import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import {
  resolvePaymentMethodOwnership,
  membershipsBackedByPaymentMethod,
} from '@/lib/account/payment-method-removal';
import { NO_STORE_HEADERS } from '@/lib/api/error-codes';

/**
 * DELETE /api/account/payment-methods/[venueId]/[paymentMethodId] (P4-6, G14).
 *
 * **The venue is in the path because it has to be.** Cards live on per-venue
 * Connect customers, so a payment method id alone does not even name the
 * account it lives on. The plan reached the right conclusion from the wrong
 * precedent: `GET /api/account/payment-methods` does NOT require `venue_id`,
 * it answers 200 with an empty list and a hint. The reasoning stands on its
 * own without that.
 *
 * Removing a card that is paying for a membership is refused once, with 409
 * and the membership named, and allowed on a second call carrying
 * `?acknowledge=true`. That is the shape the venue availability routes already
 * use for "this will affect something, say you meant it".
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ venueId: string; paymentMethodId: string }> },
) {
  try {
    const { venueId, paymentMethodId } = await params;
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorised', code: 'UNAUTHENTICATED' },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const admin = getSupabaseAdminClient();
    const owned = await resolvePaymentMethodOwnership(admin, stripe, {
      userId: user.id,
      venueId,
      paymentMethodId,
    });

    if (!owned.ok) {
      if (owned.reason === 'venue_not_connected') {
        return NextResponse.json(
          { error: 'That venue cannot hold saved cards.', code: 'VALIDATION_FAILED' },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      /*
        `venue_not_found` and `not_yours` answer identically. Telling them
        apart would let somebody with a payment method id discover which venue
        it belongs to by trying venues until the answer changed.
      */
      return NextResponse.json(
        { error: 'Not found', code: 'NOT_FOUND' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const acknowledged = request.nextUrl.searchParams.get('acknowledge') === 'true';
    if (!acknowledged) {
      const backed = await membershipsBackedByPaymentMethod(admin, stripe, {
        userId: user.id,
        venueId,
        customerId: owned.customerId,
        connectedAccountId: owned.connectedAccountId,
        paymentMethodId,
      });
      if (backed.length > 0) {
        // Named, not counted: "this pays for your Unlimited Yoga membership"
        // is a reason to stop, and "1 membership" is a number to click past.
        const names = backed.map((m) => m.name).join(', ');
        return NextResponse.json(
          {
            requires_confirmation: true,
            memberships: backed,
            message:
              backed.length === 1
                ? `This card pays for your ${names} membership. Removing it may stop the next payment going through.`
                : `This card pays for these memberships: ${names}. Removing it may stop the next payments going through.`,
          },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
    }

    await stripe.paymentMethods.detach(paymentMethodId, {
      stripeAccount: owned.connectedAccountId,
    });

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    console.error('[account/payment-methods DELETE]', e);
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
