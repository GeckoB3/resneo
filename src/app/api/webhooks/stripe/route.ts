import { NextRequest, NextResponse, after } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import {
  confirmBookingsForSucceededPaymentIntent,
  sendDepositPaidBookingComms,
} from '@/lib/booking/confirm-deposit-payment';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import {
  claimStripeWebhookEvent,
  releaseStripeWebhookEvent,
} from '@/lib/webhooks/stripe-event-idempotency';
import { fulfillClassCreditPurchaseFromPaymentIntent } from '@/lib/class-commerce/fulfill-credit-purchase';
import { fulfillCourseEnrollmentFromPaymentIntent } from '@/lib/class-commerce/fulfill-course-enrollment';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';
import { syncClassMembershipFromStripeSubscription } from '@/lib/class-commerce/sync-membership-from-stripe';
import { recordSalesRevenueRefund } from '@/lib/sales/invoice-revenue';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret) {
  console.warn('STRIPE_WEBHOOK_SECRET is not set; webhook verification will fail');
}

/**
 * Stripe webhook handler. Idempotent: process each event once (track by stripe_event_id).
 * Verifies signature. Handles: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded.
 */
export async function POST(request: NextRequest) {
  let event: Stripe.Event;

  try {
    const rawBody = await request.text();
    const sig = request.headers.get('stripe-signature');
    if (!sig) {
      console.error('[Stripe webhook] No stripe-signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }
    if (!webhookSecret) {
      console.error('[Stripe webhook] STRIPE_WEBHOOK_SECRET is not configured');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }
    event = Stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Stripe webhook] Signature verification failed:', message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();

  const claim = await claimStripeWebhookEvent(supabase, event.id, event.type);
  if (claim === 'already_processed') {
    return NextResponse.json({ received: true });
  }
  if (claim === 'concurrent') {
    return NextResponse.json({ error: 'Event processing in progress' }, { status: 500 });
  }

  const connectedAccountId = (event as Stripe.Event & { account?: string }).account;
  console.log(`[Stripe webhook] ${event.type} (event: ${event.id})${connectedAccountId ? ` connected_account: ${connectedAccountId}` : ''}`);

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const meta = pi.metadata ?? {};
      if (meta.reserve_ni_purpose === RESERVE_NI_PI_PURPOSE.CLASS_CREDIT_PURCHASE) {
        await fulfillClassCreditPurchaseFromPaymentIntent({
          admin: supabase,
          paymentIntentId: pi.id,
          stripeAccountId: connectedAccountId ?? undefined,
        });
        return NextResponse.json({ received: true });
      }

      if (meta.reserve_ni_purpose === RESERVE_NI_PI_PURPOSE.CLASS_COURSE_ENROLLMENT) {
        await fulfillCourseEnrollmentFromPaymentIntent({
          admin: supabase,
          paymentIntentId: pi.id,
          stripeAccountId: connectedAccountId ?? undefined,
        });
        return NextResponse.json({ received: true });
      }

      const bookingId = meta.booking_id;
      if (!bookingId) {
        console.warn(
          'payment_intent.succeeded missing booking_id in metadata (and not a class credit purchase)',
          pi.id,
        );
        return NextResponse.json({ received: true });
      }

      const { data: booking, error: bookingLoadErr } = await supabase
        .from('bookings')
        .select('id, venue_id, guest_id, status, deposit_status, source')
        .eq('id', bookingId)
        .single();

      if (bookingLoadErr) {
        console.error('[Stripe webhook] Booking load failed:', bookingLoadErr, { bookingId });
        throw bookingLoadErr;
      }

      if (!booking) {
        console.log(`[Stripe webhook] Booking ${bookingId} not found \u2014 skipping`);
        return NextResponse.json({ received: true });
      }

      const confirmResult = await confirmBookingsForSucceededPaymentIntent(supabase, {
        paymentIntentId: pi.id,
        venueId: booking.venue_id,
      });

      if (!confirmResult.ok) {
        throw new Error(`confirmBookingsForSucceededPaymentIntent failed: ${confirmResult.reason}`);
      }

      if (confirmResult.alreadyConfirmed) {
        console.log(`[Stripe webhook] No pending bookings to mark Booked for PI ${pi.id} - may already be processed`);
        return NextResponse.json({ received: true });
      }

      const confirmedIds = confirmResult.confirmedIds;

      const { data: venue, error: venueErr } = await supabase
        .from('venues')
        .select('name, address, email, reply_to_email')
        .eq('id', booking.venue_id)
        .single();
      if (venueErr) {
        console.error('[Stripe webhook] Venue load failed:', venueErr, { venueId: booking.venue_id });
        throw venueErr;
      }

      const { data: guest, error: guestErr } = await supabase
        .from('guests')
        .select('first_name, last_name, email, phone')
        .eq('id', booking.guest_id)
        .single();
      if (guestErr) {
        console.error('[Stripe webhook] Guest load failed:', guestErr, { guestId: booking.guest_id });
        throw guestErr;
      }

      const venueData = venueRowToEmailData({
        name: venue?.name ?? 'Venue',
        address: venue?.address ?? null,
        email: venue?.email ?? null,
        reply_to_email: venue?.reply_to_email ?? null,
      });

      const venueIdForAfter = booking.venue_id;
      after(async () => {
        const admin = getSupabaseAdminClient();
        await sendDepositPaidBookingComms(admin, {
          confirmedIds,
          venueId: venueIdForAfter,
          venueData,
          guest,
        });
      });
    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;

      // Plan §4.4 — look up by PaymentIntent, not by metadata.booking_id. Cart
      // checkouts attach the PI id to every paid booking in the group; we must
      // mark them all Failed, not just the primary.
      const { data: failedRows, error: failedSelErr } = await supabase
        .from('bookings')
        .select('id, venue_id')
        .eq('stripe_payment_intent_id', pi.id)
        .eq('deposit_status', 'Pending');

      if (failedSelErr) {
        console.error('[Stripe webhook] payment_failed load by PI failed:', failedSelErr, { pi: pi.id });
        throw failedSelErr;
      }

      const rowsToFail = (failedRows ?? []) as Array<{ id: string; venue_id: string }>;
      if (rowsToFail.length > 0) {
        const { error: failUpdateErr } = await supabase
          .from('bookings')
          .update({
            deposit_status: 'Failed',
            updated_at: new Date().toISOString(),
          })
          .in(
            'id',
            rowsToFail.map((r) => r.id),
          );
        if (failUpdateErr) {
          console.error('[Stripe webhook] payment_failed deposit update failed:', failUpdateErr, {
            paymentIntentId: pi.id,
          });
          throw failUpdateErr;
        }

        // One kitchen alert per venue.
        const venuesSeen = new Set<string>();
        for (const r of rowsToFail) {
          if (venuesSeen.has(r.venue_id)) continue;
          venuesSeen.add(r.venue_id);
          try {
            const { data: venue } = await supabase
              .from('venues')
              .select('name, kitchen_email')
              .eq('id', r.venue_id)
              .maybeSingle();
            if (venue?.kitchen_email) {
              const bookingsForVenue = rowsToFail
                .filter((b) => b.venue_id === r.venue_id)
                .map((b) => b.id);
              await sendCommunication({
                type: 'custom_message',
                recipient: { email: venue.kitchen_email },
                payload: {
                  venue_name: venue.name ?? 'Venue',
                  message: `Deposit payment failed for booking${bookingsForVenue.length > 1 ? 's' : ''} ${bookingsForVenue.join(', ')}. Please follow up with the guest.`,
                },
                venue_id: r.venue_id,
                booking_id: bookingsForVenue[0],
              });
            }
          } catch (commsErr) {
            console.error('Webhook payment failure alert send failed:', commsErr);
          }
        }
      }
      console.error('payment_intent.payment_failed', pi.id, pi.last_payment_error?.message);
    } else if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      if (account.id) {
        const { data: venue } = await supabase
          .from('venues')
          .select('id')
          .eq('stripe_connected_account_id', account.id)
          .maybeSingle();
        if (venue) {
          // Log the status change. The StripeConnectSection UI fetches live
          // status from Stripe on each load, so no DB columns needed here.
          console.log(`[Stripe] account.updated for venue ${venue.id}: charges_enabled=${account.charges_enabled}, details_submitted=${account.details_submitted}`);
        }
      }
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub = event.data.object as Stripe.Subscription;
      try {
        await syncClassMembershipFromStripeSubscription(supabase, sub);
      } catch (e) {
        console.error('[Stripe webhook] class membership sync failed', e);
        throw e;
      }
    } else if (event.type === 'charge.refunded' || event.type === 'charge.refund.updated') {
      let paymentIntentId: string | null = null;
      if (event.type === 'charge.refunded') {
        const charge = event.data.object as Stripe.Charge;
        paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null;
        // Net subscription-invoice refunds out of any salesperson's revenue share. This lives
        // here because `charge.refunded` is delivered to this endpoint; it no-ops for connected
        // deposit charges (no invoice) and for non-sales invoices.
        try {
          await recordSalesRevenueRefund(supabase, charge);
        } catch (e) {
          console.error('[Stripe webhook] recordSalesRevenueRefund failed:', e);
        }
      } else {
        const refund = event.data.object as Stripe.Refund;
        const accountId = connectedAccountId;
        if (refund.charge) {
          const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge.id;
          try {
            const charge = accountId
              ? await stripe.charges.retrieve(chargeId, { stripeAccount: accountId })
              : await stripe.charges.retrieve(chargeId);
            paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null;
          } catch (chargeErr) {
            console.error('[Stripe webhook] Failed to retrieve charge for refund:', chargeErr);
          }
        }
      }
      if (paymentIntentId) {
        const { data: bookings, error: bookingsErr } = await supabase
          .from('bookings')
          .select('id, deposit_status')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .limit(200);

        if (bookingsErr) {
          console.error('[Stripe webhook] Failed to load bookings for refunded payment intent:', bookingsErr);
        }

        const refundableIds = (bookings ?? [])
          .filter((b) => b.deposit_status !== 'Refunded')
          .map((b) => b.id);

        if (refundableIds.length > 0) {
          const { error: refundUpdateErr } = await supabase
            .from('bookings')
            .update({
              deposit_status: 'Refunded',
              updated_at: new Date().toISOString(),
            })
            .in('id', refundableIds);

          if (refundUpdateErr) {
            console.error('[Stripe webhook] Failed to mark bookings refunded:', refundUpdateErr, {
              paymentIntentId,
              refundableIds,
            });
            throw refundUpdateErr;
          }
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    await releaseStripeWebhookEvent(supabase, event.id);
    console.error('Webhook processing failed:', event.id, event.type, err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
