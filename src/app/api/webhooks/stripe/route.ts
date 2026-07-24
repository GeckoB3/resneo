import { NextRequest, NextResponse, after } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import {
  confirmBookingsForSucceededPaymentIntent,
  confirmBookingsForSucceededSetupIntent,
  sendDepositPaidBookingComms,
} from '@/lib/booking/confirm-deposit-payment';
import {
  applyCardHoldChargeRefund,
  completeCardHoldChargeFromWebhook,
  recordCardHoldChargeFailure,
} from '@/lib/booking/card-hold-charge';
import { sendCardHoldChargedReceipt, sendPaymentReceiptEmail } from '@/lib/communications/send-templated';
import {
  applyBalancePaymentRefundFromWebhook,
  confirmBalancePaymentFromPaymentIntent,
  markBalancePaymentFailedForPaymentIntent,
} from '@/lib/booking/confirm-balance-payment';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  releaseStripeWebhookEvent,
} from '@/lib/webhooks/stripe-event-idempotency';
import { fulfillClassCreditPurchaseFromPaymentIntent } from '@/lib/class-commerce/fulfill-credit-purchase';
import { fulfillCourseEnrollmentFromPaymentIntent } from '@/lib/class-commerce/fulfill-course-enrollment';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';
import { syncClassMembershipFromStripeSubscription } from '@/lib/class-commerce/sync-membership-from-stripe';
import { recordSalesRevenueRefund } from '@/lib/sales/invoice-revenue';
import { restoreClassCreditsForBooking } from '@/lib/class-commerce/restore-class-credits';
import { restoreMembershipAllowanceForBooking } from '@/lib/class-commerce/restore-membership-allowance';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import {
  bookingWasCreditPaid,
  bookingWasMembershipPaid,
} from '@/lib/class-commerce/booking-was-credit-paid';
import { applyBookingLifecycleStatusEffects } from '@/lib/table-management/lifecycle';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret) {
  console.warn('STRIPE_WEBHOOK_SECRET is not set; webhook verification will fail');
}

type AdminClient = ReturnType<typeof getSupabaseAdminClient>;

const REVERSIBLE_BOOKING_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

/**
 * M7 (§5.2) — when a class booking paid with credits or membership allowance is
 * refunded/failed at Stripe, the deposit-status flip alone leaves the consumed
 * credits/allowance spent and the seat occupied. For each such booking: restore the
 * credits/allowance (idempotent) AND cancel the booking so class capacity is freed.
 *
 * Stripe refunds are money-only; a credit/membership booking carries no Stripe
 * charge, so without this the value and the seat both leak. Safe to call for any
 * booking — non-credit/non-membership bookings restore nothing, and a booking that
 * is already in a terminal state is left untouched.
 */
async function restoreAndReleaseClassBookings(
  admin: AdminClient,
  rows: Array<{ id: string; venue_id: string; guest_id: string | null; status: string }>,
  source: 'stripe_refund' | 'stripe_payment_failed',
): Promise<void> {
  for (const b of rows) {
    try {
      let restoredAnything = false;

      if (await bookingWasCreditPaid(admin, b.id)) {
        const res = await restoreClassCreditsForBooking(admin, {
          bookingId: b.id,
          idempotencyPrefix: `${source}:${b.id}`,
        });
        if (res.ok && res.restoredCredits > 0) {
          restoredAnything = true;
          await admin.from('events').insert({
            venue_id: b.venue_id,
            booking_id: b.id,
            event_type: 'class_credit_restored',
            payload: { restored_credits: res.restoredCredits, source },
          });
        }
      }

      if (await bookingWasMembershipPaid(admin, b.id)) {
        const res = await restoreMembershipAllowanceForBooking({
          admin,
          bookingId: b.id,
          idempotencyPrefix: `${source}:${b.id}`,
        });
        if (res.restoredSessions > 0) {
          restoredAnything = true;
          await admin.from('events').insert({
            venue_id: b.venue_id,
            booking_id: b.id,
            event_type: 'class_membership_allowance_restored',
            payload: { restored_sessions: res.restoredSessions, source },
          });
        }
      }

      // Only credit/membership-paid bookings need the seat freeing here — a
      // card-paid booking's capacity is managed by its own cancel flow. Cancel
      // (freeing capacity) when we restored entitlement and the row is still live.
      if (restoredAnything && REVERSIBLE_BOOKING_STATUSES.includes(b.status)) {
        const { error: cancelErr } = await admin
          .from('bookings')
          .update({
            status: 'Cancelled',
            cancellation_actor_type: 'system',
            updated_at: new Date().toISOString(),
          })
          .eq('id', b.id)
          .in('status', REVERSIBLE_BOOKING_STATUSES);
        if (cancelErr) {
          console.error('[Stripe webhook] release cancel failed:', cancelErr, { bookingId: b.id });
        } else {
          await applyBookingLifecycleStatusEffects(admin, {
            bookingId: b.id,
            guestId: b.guest_id ?? '',
            previousStatus: b.status,
            nextStatus: 'Cancelled',
            actorId: null,
          });
          // Spec §9.3: every cancel path releases holds. Entitlement-paid rows
          // do not normally carry holds (D8), so this is defence in depth.
          try {
            await releaseCardHoldsForBookings(admin, [b.id], 'cancelled');
          } catch (releaseErr) {
            console.error('[Stripe webhook] hold release after cancel failed:', releaseErr, {
              bookingId: b.id,
            });
          }
        }
      }
    } catch (err) {
      console.error('[Stripe webhook] restore/release failed', err, { bookingId: b.id });
    }
  }
}

/**
 * Stripe webhook handler. Idempotent: process each event once (track by stripe_event_id).
 * Verifies signature. Handles: payment_intent.succeeded, payment_intent.payment_failed,
 * payment_intent.canceled, setup_intent.succeeded, setup_intent.setup_failed, charge.refunded.
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

  // The claim is not "processed" until this returns successfully: mark
  // completion only after the handler resolves, and release (delete the claim)
  // on error so Stripe's retry reprocesses. A hard crash between claim and
  // completion leaves completed_at null, so a redelivery reclaims it once the
  // claim goes stale rather than dropping the event.
  const runHandlers = async (): Promise<NextResponse> => {
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

      // Card-hold no-show fee PI (spec §8.6.1): source-of-truth completion.
      // MUST run before the generic booking confirm path: the fee PI carries
      // metadata.booking_id and would otherwise be misread as a deposit payment.
      if (meta.reserve_ni_purpose === RESERVE_NI_PI_PURPOSE.CARD_HOLD_NO_SHOW_FEE) {
        const completion = await completeCardHoldChargeFromWebhook(supabase, {
          paymentIntentId: pi.id,
          bookingId: meta.booking_id ?? null,
          amountReceivedPence: pi.amount_received ?? pi.amount,
          connectedAccountId: connectedAccountId ?? null,
        });
        if (completion?.applied) {
          // Receipt email after the response (idempotent: dedupe comm log).
          const receiptParams = {
            bookingId: completion.bookingId,
            venueId: completion.venueId,
            chargedPence: completion.chargedPence,
            chargedAt: new Date(event.created * 1000).toISOString(),
          };
          after(async () => {
            try {
              await sendCardHoldChargedReceipt(receiptParams);
            } catch (emailErr) {
              console.error('[Stripe webhook] card-hold receipt email failed:', emailErr, receiptParams);
            }
          });
        }
        return NextResponse.json({ received: true });
      }

      // In-person appointment balance PI (§6.4): source-of-truth completion of
      // the booking_payments ledger. MUST run before the generic deposit
      // confirm path — the balance PI carries metadata.booking_id too.
      if (meta.reserve_ni_purpose === RESERVE_NI_PI_PURPOSE.APPOINTMENT_BALANCE) {
        const result = await confirmBalancePaymentFromPaymentIntent(supabase, {
          paymentIntentId: pi.id,
          bookingId: meta.booking_id ?? null,
          venueId: meta.venue_id ?? null,
          amountReceivedPence: pi.amount_received ?? pi.amount,
          connectedAccountId: connectedAccountId ?? null,
        });
        if (result?.applied) {
          // Receipt after the response (§6.5). Failure only loses the email —
          // the ledger and summary are already written.
          const receiptParams = {
            bookingId: result.bookingId,
            venueId: result.venueId,
            amountPaidPence: result.amountPence,
            paidAt: new Date(event.created * 1000).toISOString(),
          };
          after(async () => {
            try {
              await sendPaymentReceiptEmail(receiptParams);
            } catch (emailErr) {
              console.error('[Stripe webhook] payment receipt email failed:', emailErr, receiptParams);
            }
          });
        }
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

      // Thread the payment method through so payment_with_setup units get
      // their hold rows completed (spec §7.4 payment branch).
      const paymentMethodId =
        typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id ?? null;

      const confirmResult = await confirmBookingsForSucceededPaymentIntent(supabase, {
        paymentIntentId: pi.id,
        venueId: booking.venue_id,
        paymentMethodId,
      });

      if (!confirmResult.ok) {
        if (confirmResult.reason === 'booking_cancelled') {
          // The abandonment sweep cancelled the unit before this event landed
          // (J2 race). Retrying cannot resurrect it; flag for reconciliation
          // (money may have been taken for a cancelled unit) and acknowledge.
          console.error(
            `[Stripe webhook] PI ${pi.id} succeeded but its booking unit is Cancelled; needs reconciliation`,
            { bookingId },
          );
          const { error: alertErr } = await supabase.from('reconciliation_alerts').insert({
            booking_id: bookingId,
            expected_status: 'Booked',
            actual_stripe_status: pi.status,
          });
          if (alertErr) {
            // The alert is the only durable trace that money was taken for a
            // cancelled unit: if it fails to persist, do NOT ack. Throw so the
            // claim is released and Stripe redelivers (a duplicate alert on
            // retry is far better than losing it).
            console.error('[Stripe webhook] reconciliation alert insert failed', alertErr, { bookingId });
            throw new Error('Failed to record reconciliation alert for cancelled unit');
          }
          return NextResponse.json({ received: true });
        }
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

      // Card-hold no-show fee PI (spec §8.6.3): record the failure fields on
      // the hold only; NEVER touch booking status for a fee PI. The generic
      // failure path below stays scoped to deposit-Pending rows.
      const failedMeta = pi.metadata ?? {};

      // In-person balance PI (§6.4 hygiene): keep the ledger truthful — a
      // declined tap flips its pending row to failed. A later retried collect
      // on the same PI can still succeed (failed → succeeded is allowed).
      if (failedMeta.reserve_ni_purpose === RESERVE_NI_PI_PURPOSE.APPOINTMENT_BALANCE) {
        await markBalancePaymentFailedForPaymentIntent(supabase, pi.id);
        console.error('payment_intent.payment_failed (appointment balance)', pi.id, pi.last_payment_error?.message);
        return NextResponse.json({ received: true });
      }
      if (failedMeta.reserve_ni_purpose === RESERVE_NI_PI_PURPOSE.CARD_HOLD_NO_SHOW_FEE) {
        await recordCardHoldChargeFailure(supabase, {
          paymentIntentId: pi.id,
          bookingId: failedMeta.booking_id ?? null,
          failureCode:
            pi.last_payment_error?.code ?? pi.last_payment_error?.decline_code ?? 'payment_failed',
          failureAtIso: new Date(event.created * 1000).toISOString(),
          connectedAccountId: connectedAccountId ?? null,
        });
        console.error('payment_intent.payment_failed (card-hold fee)', pi.id, pi.last_payment_error?.message);
        return NextResponse.json({ received: true });
      }

      // Plan §4.4 — look up by PaymentIntent, not by metadata.booking_id. Cart
      // checkouts attach the PI id to every paid booking in the group; we must
      // mark them all Failed, not just the primary.
      const { data: failedRows, error: failedSelErr } = await supabase
        .from('bookings')
        .select('id, venue_id, guest_id, status')
        .eq('stripe_payment_intent_id', pi.id)
        .eq('deposit_status', 'Pending');

      if (failedSelErr) {
        console.error('[Stripe webhook] payment_failed load by PI failed:', failedSelErr, { pi: pi.id });
        throw failedSelErr;
      }

      const rowsToFail = (failedRows ?? []) as Array<{
        id: string;
        venue_id: string;
        guest_id: string | null;
        status: string;
      }>;
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

        // M7 — a failed payment on a credit/membership-paid line must hand back the
        // consumed entitlement and free the seat too. No-op for card-only bookings.
        await restoreAndReleaseClassBookings(supabase, rowsToFail, 'stripe_payment_failed');

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
    } else if (event.type === 'payment_intent.canceled') {
      // §6.4 hygiene: an abandoned in-person balance attempt (staff dismissed
      // the sheet; the PI was cancelled client-side or expired) must not leave
      // its ledger row at 'pending' forever. Only balance PIs are handled —
      // other cancelled PIs keep their existing lifecycles.
      const pi = event.data.object as Stripe.PaymentIntent;
      const canceledMeta = pi.metadata ?? {};
      if (canceledMeta.reserve_ni_purpose === RESERVE_NI_PI_PURPOSE.APPOINTMENT_BALANCE) {
        await markBalancePaymentFailedForPaymentIntent(supabase, pi.id);
      }
    } else if (event.type === 'setup_intent.succeeded') {
      // Card-hold setup mode backup confirm (spec §8.6 item 4). The
      // confirm-payment route is the primary path; this covers 3DS redirects
      // and clients that never came back.
      const si = event.data.object as Stripe.SetupIntent;
      const meta = si.metadata ?? {};
      if (meta.reserve_ni_purpose !== RESERVE_NI_PI_PURPOSE.CARD_HOLD_SETUP) {
        console.log(`[Stripe webhook] setup_intent.succeeded ${si.id} is not a card-hold setup, skipping`);
        return NextResponse.json({ received: true });
      }

      // Resolve the venue from the connected account the event arrived on,
      // falling back to the SI metadata (covers a venue whose current account
      // has changed since the hold snapshotted it).
      let venueId: string | null = null;
      if (connectedAccountId) {
        const { data: venueRow } = await supabase
          .from('venues')
          .select('id')
          .eq('stripe_connected_account_id', connectedAccountId)
          .maybeSingle();
        venueId = venueRow?.id ?? null;
      }
      if (!venueId) venueId = (meta.venue_id as string | undefined) ?? null;
      if (!venueId) {
        console.warn(`[Stripe webhook] setup_intent.succeeded ${si.id}: could not resolve venue, skipping`);
        return NextResponse.json({ received: true });
      }

      const setupPaymentMethodId =
        typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id ?? null;

      const confirmResult = await confirmBookingsForSucceededSetupIntent(supabase, {
        setupIntentId: si.id,
        paymentMethodId: setupPaymentMethodId,
        venueId,
      });

      if (!confirmResult.ok) {
        if (confirmResult.reason === 'hold_not_found') {
          console.warn(`[Stripe webhook] setup_intent.succeeded ${si.id}: no hold rows found, skipping`);
          return NextResponse.json({ received: true });
        }
        if (confirmResult.reason === 'booking_cancelled') {
          // The abandonment sweep cancelled the unit before this event landed
          // (J2 race). No money moved (setup mode); retrying cannot resurrect
          // the unit, so acknowledge and skip.
          console.warn(
            `[Stripe webhook] setup_intent.succeeded ${si.id}: booking unit already Cancelled, skipping`,
          );
          return NextResponse.json({ received: true });
        }
        throw new Error(`confirmBookingsForSucceededSetupIntent failed: ${confirmResult.reason}`);
      }

      if (confirmResult.alreadyConfirmed) {
        console.log(`[Stripe webhook] No pending bookings to mark Booked for SI ${si.id} - may already be processed`);
        return NextResponse.json({ received: true });
      }

      const confirmedIds = confirmResult.confirmedIds;

      const { data: leadBooking } = await supabase
        .from('bookings')
        .select('id, guest_id')
        .eq('id', confirmedIds[0])
        .maybeSingle();

      const { data: venue, error: venueErr } = await supabase
        .from('venues')
        .select('name, address, email, reply_to_email')
        .eq('id', venueId)
        .single();
      if (venueErr) {
        console.error('[Stripe webhook] Venue load failed:', venueErr, { venueId });
        throw venueErr;
      }

      let guest: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null = null;
      if (leadBooking?.guest_id) {
        const { data: guestRow } = await supabase
          .from('guests')
          .select('first_name, last_name, email, phone')
          .eq('id', leadBooking.guest_id)
          .maybeSingle();
        guest = guestRow ?? null;
      }

      const venueData = venueRowToEmailData({
        name: venue?.name ?? 'Venue',
        address: venue?.address ?? null,
        email: venue?.email ?? null,
        reply_to_email: venue?.reply_to_email ?? null,
      });

      const venueIdForAfter = venueId;
      after(async () => {
        const admin = getSupabaseAdminClient();
        await sendDepositPaidBookingComms(admin, {
          confirmedIds,
          venueId: venueIdForAfter,
          venueData,
          guest,
        });
      });
    } else if (event.type === 'setup_intent.setup_failed') {
      // Informational only (spec §8.6 item 5): the client handles inline
      // failure and the abandonment cron cleans up unsaved holds.
      const si = event.data.object as Stripe.SetupIntent;
      console.warn(
        'setup_intent.setup_failed',
        si.id,
        si.last_setup_error?.message ?? 'no error detail',
      );
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
      // True only when the charge is FULLY refunded (amount_refunded covers the
      // full amount). Card-hold fee refunds gate on this: a partial refund must
      // not release the hold or flip the booking off 'Charged'.
      let chargeFullyRefunded = false;
      if (event.type === 'charge.refunded') {
        const charge = event.data.object as Stripe.Charge;
        paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null;
        chargeFullyRefunded = (charge.amount_refunded ?? 0) >= charge.amount;
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
            chargeFullyRefunded = (charge.amount_refunded ?? 0) >= charge.amount;
          } catch (chargeErr) {
            console.error('[Stripe webhook] Failed to retrieve charge for refund:', chargeErr);
          }
        }
      }
      if (paymentIntentId) {
        // Card-hold fee PI (spec §8.6.6): the existing lookup by
        // bookings.stripe_payment_intent_id misses fee PIs (they live on the
        // hold row), so resolve the hold first. A refunded fee flips the
        // booking to 'Refunded', releases the hold ('refunded'), and inserts
        // the card_hold_charge_refunded event. Idempotent.
        const { data: feeHoldData, error: feeHoldErr } = await supabase
          .from('booking_card_holds')
          .select('id, booking_id, venue_id, charged_pence')
          .eq('charge_payment_intent_id', paymentIntentId)
          .maybeSingle();
        if (feeHoldErr) {
          console.error('[Stripe webhook] fee-PI hold lookup failed:', feeHoldErr, { paymentIntentId });
          throw feeHoldErr;
        }
        const feeHold = feeHoldData as
          | { id: string; booking_id: string; venue_id: string; charged_pence: number | null }
          | null;
        if (feeHold) {
          // Only a FULL refund ends the fee's lifecycle. A partial refund keeps
          // the booking 'Charged' and the hold alive; the operator finishes the
          // refund in Stripe (or via the deposit route) to complete it.
          if (!chargeFullyRefunded) {
            console.warn('[Stripe webhook] partial refund on card-hold fee PI; leaving state Charged', {
              paymentIntentId,
              bookingId: feeHold.booking_id,
            });
            return NextResponse.json({ received: true });
          }
          await applyCardHoldChargeRefund(supabase, {
            bookingId: feeHold.booking_id,
            venueId: feeHold.venue_id,
            chargedPence: feeHold.charged_pence,
          });
          return NextResponse.json({ received: true });
        }

        // In-person balance PI (§6.4): its id lives only in booking_payments,
        // never in bookings.stripe_payment_intent_id, so resolve the ledger
        // before the deposit lookup. v1 refunds are full-per-payment: a partial
        // refund arriving from the Stripe dashboard leaves the row's state
        // untouched (the operator completes the refund to finish it).
        const { data: balanceRow, error: balanceRowErr } = await supabase
          .from('booking_payments')
          .select('id')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .maybeSingle();
        if (balanceRowErr) {
          console.error('[Stripe webhook] balance ledger lookup failed:', balanceRowErr, { paymentIntentId });
          throw balanceRowErr;
        }
        if (balanceRow) {
          if (!chargeFullyRefunded) {
            console.warn('[Stripe webhook] partial refund on balance PI; leaving ledger untouched', {
              paymentIntentId,
            });
            return NextResponse.json({ received: true });
          }
          await applyBalancePaymentRefundFromWebhook(supabase, paymentIntentId);
          return NextResponse.json({ received: true });
        }

        const { data: bookings, error: bookingsErr } = await supabase
          .from('bookings')
          .select('id, deposit_status, venue_id, guest_id, status')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .limit(200);

        if (bookingsErr) {
          console.error('[Stripe webhook] Failed to load bookings for refunded payment intent:', bookingsErr);
        }

        // Spec §8.6.6: constrain the generic flip. In a payment_with_setup
        // unit the card-hold-only rows share the money PI, so refunding the
        // money part must not stamp sibling 'Card Held' rows 'Refunded'
        // (which would kill their holds without release). Rows with a hold
        // row are handled exclusively by the fee-PI branch above.
        const candidateRows = (bookings ?? []) as Array<{
          id: string;
          deposit_status: string | null;
          venue_id: string;
          guest_id: string | null;
          status: string;
        }>;
        let heldBookingIds = new Set<string>();
        if (candidateRows.length > 0) {
          const { data: holdRows, error: holdRowsErr } = await supabase
            .from('booking_card_holds')
            .select('booking_id')
            .in(
              'booking_id',
              candidateRows.map((b) => b.id),
            );
          if (holdRowsErr) {
            console.error('[Stripe webhook] hold sibling lookup failed:', holdRowsErr, { paymentIntentId });
            throw holdRowsErr;
          }
          heldBookingIds = new Set(((holdRows ?? []) as Array<{ booking_id: string }>).map((h) => h.booking_id));
        }

        const refundable = candidateRows.filter(
          (b) => b.deposit_status !== 'Refunded' && !heldBookingIds.has(b.id),
        ) as Array<{
          id: string;
          venue_id: string;
          guest_id: string | null;
          status: string;
        }>;
        const refundableIds = refundable.map((b) => b.id);

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

          // M7 — restore any class credits/allowance consumed by these bookings and
          // free their capacity (cancel). No-op for card-only bookings.
          await restoreAndReleaseClassBookings(supabase, refundable, 'stripe_refund');
        }
      }
    }

    return NextResponse.json({ received: true });
  };

  try {
    const response = await runHandlers();
    await markStripeWebhookEventProcessed(supabase, event.id);
    return response;
  } catch (err) {
    await releaseStripeWebhookEvent(supabase, event.id);
    console.error('Webhook processing failed:', event.id, event.type, err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
