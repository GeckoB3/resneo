import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import {
  createCardHoldCustomer,
  createCardHoldSetupIntent,
  insertCardHoldRows,
  resolveCaptureMode,
  type CaptureUnitLine,
} from '@/lib/booking/card-hold-capture';
import { buildCardHoldTermsSnapshot } from '@/lib/booking/card-hold-terms';
import { insertFreeClassSessionBooking } from '@/lib/booking/insert-free-class-session-booking';
import { insertPendingPaidClassSessionBooking } from '@/lib/booking/insert-pending-paid-class-session-booking';
import { findOrCreateGuest } from '@/lib/guests';
import { splitLegacyGuestName } from '@/lib/guests/name';
import { quoteClassCart } from '@/lib/class-commerce/quote-class-cart';
import { persistClassCartCheckoutTransaction } from '@/lib/class-commerce/persist-class-checkout';
import { consumeClassCreditsForBooking } from '@/lib/class-commerce/consume-class-credits';
import { restoreClassCreditsForBooking } from '@/lib/class-commerce/restore-class-credits';
import { restoreMembershipAllowanceForBooking } from '@/lib/class-commerce/restore-membership-allowance';
import { sumAvailableClassCreditsForClassType } from '@/lib/class-commerce/available-class-credits';
import { userCourseCoversClassInstance } from '@/lib/class-commerce/course-instance-coverage';
import { membershipUnlimitedCoversClassType } from '@/lib/class-commerce/membership-class-access';
import { membershipCoversClassType } from '@/lib/class-commerce/membership-allowance-coverage';
import { consumeMembershipAllowanceForBooking } from '@/lib/class-commerce/consume-membership-allowance';
import { decideClassLineEntitlement } from '@/lib/class-commerce/entitlement-engine';
import type { ClassCartCheckoutResponse, ClassCartLineInput, ClassCartQuoteLine, ClassCartQuoteResult } from '@/types/class-commerce';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';

/**
 * Capacity guard signature raised by the DB trigger `enforce_cde_capacity` when a
 * class-session insert would oversell. SQLSTATE 23P01 (exclusion violation) and/or
 * a message containing 'CDE_CAPACITY'. The insert helpers surface this via `code`
 * and/or in the error message.
 */
function isCapacityError(value: { code?: string; error?: string } | null | undefined): boolean {
  if (!value) return false;
  if (value.code === '23P01') return true;
  return typeof value.error === 'string' && value.error.includes('CDE_CAPACITY');
}

const CAPACITY_FULL_MESSAGE = 'One or more sessions just filled up. Your cart was not charged.';

export async function orchestrateClassCartCheckout(
  admin: SupabaseClient,
  params: {
    venueId: string;
    lines: ClassCartLineInput[];
    userId: string;
    userEmail: string;
    displayName: string;
    payWithClassCredits?: boolean;
  },
): Promise<
  | { ok: true; body: ClassCartCheckoutResponse }
  | { ok: false; status: number; error: string; quote?: ClassCartQuoteResult }
> {
  const { venueId, lines, userId, userEmail, displayName, payWithClassCredits = false } = params;
  const emailLower = userEmail.toLowerCase();

  const quote = await quoteClassCart(admin, { venueId, lines, userId });
  if (!quote.all_ok) {
    return { ok: false, status: 409, error: 'Cart is not valid', quote };
  }

  const { data: venue, error: vErr } = await admin
    .from('venues')
    .select('id, name, address, email, reply_to_email, timezone, stripe_connected_account_id')
    .eq('id', venueId)
    .maybeSingle();

  if (vErr || !venue) {
    return { ok: false, status: 404, error: 'Venue not found' };
  }

  const venueRow = venue as Record<string, unknown>;
  const stripeAccountId = venueRow.stripe_connected_account_id as string | null | undefined;

  const { first, last } = splitLegacyGuestName(displayName);
  const { guest } = await findOrCreateGuest(
    admin,
    venueId,
    {
      first_name: first || null,
      last_name: last || null,
      email: emailLower,
      phone: null,
    },
    { silentAuthSignup: true },
  );

  if (guest.user_id && guest.user_id !== userId) {
    return { ok: false, status: 409, error: 'Guest profile is linked to a different account' };
  }

  const groupId = randomUUID();
  const { error: grpErr } = await admin.from('class_booking_groups').insert({
    id: groupId,
    venue_id: venueId,
    user_id: userId,
    kind: 'multi_session',
    metadata: { line_count: lines.length, pay_with_class_credits: payWithClassCredits },
  });

  if (grpErr) {
    console.error('[orchestrateClassCartCheckout] group insert', grpErr);
    return { ok: false, status: 500, error: 'Failed to start checkout' };
  }

  // Track bookings that consumed value so a rollback can restore it. The restore
  // helpers reverse the `redeem` ledger rows by booking id, so this must run
  // BEFORE the booking rows (and any cascading ledger rows) are deleted.
  const creditConsumedBookingIds: string[] = [];
  const allowanceConsumedBookingIds: string[] = [];

  // Booking-scoped Stripe Customer created for card-hold capture (D2); deleted
  // best-effort on rollback so no orphaned customer outlives a failed checkout.
  let cardHoldCustomerId: string | null = null;

  async function rollbackGroup(): Promise<void> {
    for (const bId of creditConsumedBookingIds) {
      const restored = await restoreClassCreditsForBooking(admin, {
        bookingId: bId,
        idempotencyPrefix: `redeem_cart:${groupId}`,
      });
      if (!restored.ok) {
        console.error('[orchestrateClassCartCheckout] credit restore on rollback failed', bId, restored.reason);
      }
    }
    for (const bId of allowanceConsumedBookingIds) {
      await restoreMembershipAllowanceForBooking({
        admin,
        bookingId: bId,
        idempotencyPrefix: `redeem_allowance_cart:${groupId}`,
      });
    }
    await admin.from('bookings').delete().eq('group_booking_id', groupId);
    await admin.from('class_booking_groups').delete().eq('id', groupId);
    if (cardHoldCustomerId && stripeAccountId) {
      try {
        await stripe.customers.del(cardHoldCustomerId, { stripeAccount: stripeAccountId });
      } catch (delErr) {
        console.error('[orchestrateClassCartCheckout] card-hold customer cleanup failed', delErr);
      }
    }
  }

  const bookingIds: string[] = [];
  const paidBookingIds: string[] = [];
  // Confirmation comms for Booked (covered/credits/free) lines are deferred
  // until the whole cart is final: queueing them at insert time would email a
  // confirmation for a booking a later line's failure then rolls back.
  const deferredGuestNotifications: Array<() => void> = [];
  const flushDeferredGuestNotifications = () => {
    for (const queue of deferredGuestNotifications) queue();
  };
  const stripeQuoteLines: ClassCartQuoteLine[] = [];
  /** Card-hold lines in the capture unit: booking row + its max chargeable no-show fee (§7.2). */
  const cardHoldLines: { bookingId: string; feePence: number }[] = [];
  let primaryPaidBookingId: string | null = null;
  let totalStripePence = 0;
  let capacityFull = false;

  try {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const qLine = quote.lines[i];
      if (!qLine || !qLine.ok) {
        throw new Error('Quote line mismatch');
      }

      const online = qLine.online_charge_pence;

      // Card-hold lines bypass the entitlement engine entirely (D8): no money is due
      // and nothing is consumed, so members and non-members book identically. The row
      // waits Pending/Pending with `deposit_amount_pence` NULL until the card is
      // saved; the hold row (inserted after capture-mode resolution) carries the fee.
      if (qLine.card_hold_fee_pence != null) {
        const res = await insertPendingPaidClassSessionBooking({
          admin,
          venueId,
          venue: venueRow,
          guest,
          guestEmail: emailLower,
          classInstanceId: line.class_instance_id,
          partySize: line.party_size,
          source: 'online',
          groupBookingId: groupId,
          cardHold: true,
        });
        if (!res.ok) {
          if (isCapacityError(res)) {
            capacityFull = true;
            throw new Error(CAPACITY_FULL_MESSAGE);
          }
          throw new Error(res.error);
        }
        bookingIds.push(res.bookingId);
        cardHoldLines.push({ bookingId: res.bookingId, feePence: qLine.card_hold_fee_pence });
        continue;
      }

      // Resolve entitlement coverage in product-rule precedence order:
      // course bundle → membership → class credits (opt-in) → card.
      // Course and membership are checked BEFORE credits so a covered session
      // never burns a credit. Credits are only considered when the guest opted
      // to pay with credits.
      let courseCovers = false;
      let membershipCovers = false;
      let membershipCoverage: Awaited<ReturnType<typeof membershipCoversClassType>> | null = null;
      let creditsAvailable = 0;

      if (online > 0) {
        courseCovers = await userCourseCoversClassInstance(admin, {
          userId,
          venueId,
          classInstanceId: line.class_instance_id,
        });

        if (!courseCovers) {
          membershipCoverage = await membershipCoversClassType(admin, {
            userId,
            venueId,
            classTypeId: qLine.class_type_id,
            partySize: line.party_size,
          });
          membershipCovers = membershipCoverage.ok;
          if (!membershipCovers) {
            // Fallback to the legacy unlimited check in case ledger rows are stale.
            membershipCovers = await membershipUnlimitedCoversClassType(admin, {
              userId,
              venueId,
              classTypeId: qLine.class_type_id,
            });
          }
        }

        if (!courseCovers && !membershipCovers && payWithClassCredits) {
          creditsAvailable = await sumAvailableClassCreditsForClassType(admin, {
            userId,
            venueId,
            classTypeId: qLine.class_type_id,
          });
        }
      }

      const decision = decideClassLineEntitlement({
        onlineChargePence: online,
        paymentRequirement: qLine.payment_requirement,
        courseCovers,
        membershipCovers,
        payWithClassCredits,
        creditsAvailableForClassType: creditsAvailable,
        partySize: line.party_size,
      });

      if (decision.kind === 'course' || decision.kind === 'membership') {
        const res = await insertFreeClassSessionBooking({
          admin,
          venueId,
          venue: venueRow,
          guest,
          guestName: displayName,
          guestEmail: emailLower,
          guestPhoneE164: '',
          classInstanceId: line.class_instance_id,
          partySize: line.party_size,
          source: 'online',
          groupBookingId: groupId,
          settleWithoutOnlineCard: true,
          deferGuestNotifications: true,
        });
        if (!res.ok) {
          if (isCapacityError(res)) {
            capacityFull = true;
            throw new Error(CAPACITY_FULL_MESSAGE);
          }
          throw new Error(res.error);
        }
        if (res.queueGuestNotifications) deferredGuestNotifications.push(res.queueGuestNotifications);
        // When the matched membership is an allowance plan, ledger the consumption.
        if (
          decision.kind === 'membership' &&
          membershipCoverage &&
          membershipCoverage.ok &&
          membershipCoverage.mode === 'allowance'
        ) {
          const consumed = await consumeMembershipAllowanceForBooking({
            admin,
            membershipId: membershipCoverage.membershipId,
            userId,
            venueId,
            sessions: line.party_size,
            bookingId: res.bookingId,
            idempotencyKey: `redeem_allowance_cart:${groupId}:${line.class_instance_id}`,
          });
          if (!consumed.ok) {
            await admin.from('bookings').delete().eq('id', res.bookingId);
            throw new Error('Could not apply membership allowance.');
          }
          allowanceConsumedBookingIds.push(res.bookingId);
        }
        bookingIds.push(res.bookingId);
        continue;
      }

      if (decision.kind === 'credits') {
        const res = await insertFreeClassSessionBooking({
          admin,
          venueId,
          venue: venueRow,
          guest,
          guestName: displayName,
          guestEmail: emailLower,
          guestPhoneE164: '',
          classInstanceId: line.class_instance_id,
          partySize: line.party_size,
          source: 'online',
          groupBookingId: groupId,
          settleWithoutOnlineCard: true,
          deferGuestNotifications: true,
        });
        if (!res.ok) {
          if (isCapacityError(res)) {
            capacityFull = true;
            throw new Error(CAPACITY_FULL_MESSAGE);
          }
          throw new Error(res.error);
        }
        if (res.queueGuestNotifications) deferredGuestNotifications.push(res.queueGuestNotifications);
        const consumed = await consumeClassCreditsForBooking({
          admin,
          userId,
          venueId,
          credits: decision.creditsToRedeem,
          bookingId: res.bookingId,
          idempotencyKey: `redeem_cart:${groupId}:${line.class_instance_id}`,
          classTypeId: qLine.class_type_id,
        });
        if (!consumed.ok) {
          await admin.from('bookings').delete().eq('id', res.bookingId);
          throw new Error(
            consumed.reason === 'insufficient_credits'
              ? 'Not enough class credits for one or more sessions.'
              : 'Could not apply class credits.',
          );
        }
        creditConsumedBookingIds.push(res.bookingId);
        bookingIds.push(res.bookingId);
        continue;
      }

      if (decision.kind === 'stripe') {
        const res = await insertPendingPaidClassSessionBooking({
          admin,
          venueId,
          venue: venueRow,
          guest,
          guestEmail: emailLower,
          classInstanceId: line.class_instance_id,
          partySize: line.party_size,
          source: 'online',
          groupBookingId: groupId,
          overrideOnlineChargePence: qLine.online_charge_pence,
        });
        if (!res.ok) {
          if (isCapacityError(res)) {
            capacityFull = true;
            throw new Error(CAPACITY_FULL_MESSAGE);
          }
          throw new Error(res.error);
        }
        bookingIds.push(res.bookingId);
        paidBookingIds.push(res.bookingId);
        stripeQuoteLines.push(qLine);
        totalStripePence += res.deposit_amount_pence ?? 0;
        if (!primaryPaidBookingId) primaryPaidBookingId = res.bookingId;
        continue;
      }

      // decision.kind === 'free' — no online charge required.
      const res = await insertFreeClassSessionBooking({
        admin,
        venueId,
        venue: venueRow,
        guest,
        guestName: displayName,
        guestEmail: emailLower,
        guestPhoneE164: '',
        classInstanceId: line.class_instance_id,
        partySize: line.party_size,
        source: 'online',
        groupBookingId: groupId,
        deferGuestNotifications: true,
      });
      if (!res.ok) {
        if (isCapacityError(res)) {
          capacityFull = true;
          throw new Error(CAPACITY_FULL_MESSAGE);
        }
        throw new Error(res.error);
      }
      if (res.queueGuestNotifications) deferredGuestNotifications.push(res.queueGuestNotifications);
      bookingIds.push(res.bookingId);
    }
  } catch (err) {
    console.error('[orchestrateClassCartCheckout] rollback', err);
    await rollbackGroup();
    if (capacityFull) {
      return { ok: false, status: 409, error: CAPACITY_FULL_MESSAGE };
    }
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : 'Checkout failed',
    };
  }

  // Resolve how the payment step captures the card for this cart (D7/§7.2):
  // money-only carts keep today's PaymentIntent path, hold-only (or fully covered
  // + hold) carts save the card on a SetupIntent, and mixed carts do both on one
  // PaymentIntent. Covered/free lines are already Booked and never wait on this.
  const captureLines: CaptureUnitLine[] = [
    ...paidBookingIds.map((id, i) => ({
      bookingId: id,
      chargePence: stripeQuoteLines[i]?.online_charge_pence ?? 0,
      cardHoldFeePence: null,
    })),
    ...cardHoldLines.map((l) => ({ bookingId: l.bookingId, chargePence: 0, cardHoldFeePence: l.feePence })),
  ];
  const captureMode = resolveCaptureMode(captureLines);

  if (captureMode === 'none') {
    flushDeferredGuestNotifications();
    return {
      ok: true,
      body: {
        status: 'completed',
        group_booking_id: groupId,
        booking_ids: bookingIds,
      },
    };
  }

  if (!stripeAccountId) {
    await rollbackGroup();
    return { ok: false, status: 400, error: 'This venue cannot take card payments yet' };
  }

  const venueName = typeof venueRow.name === 'string' && venueRow.name ? venueRow.name : 'this venue';
  const cardHoldFeeTotal =
    cardHoldLines.length > 0 ? cardHoldLines.reduce((s, l) => s + l.feePence, 0) : null;

  if (captureMode === 'setup') {
    // No money due: save the card on a SetupIntent (§7.0). Covered/free lines are
    // already Booked (existing semantics); only the card-hold lines await the card.
    // Note: setup carts intentionally have NO class_checkout_transactions row.
    // persistClassCartCheckoutTransaction is PI-path only; the booking_card_holds
    // rows (terms snapshot included) are the audit record for a setup cart (§7.2).
    const leadBookingId = cardHoldLines[0]!.bookingId;
    try {
      const customer = await createCardHoldCustomer({
        leadBookingId,
        venueId,
        stripeConnectedAccountId: stripeAccountId,
        email: emailLower,
        name: displayName,
      });
      cardHoldCustomerId = customer.id;

      const setupIntent = await createCardHoldSetupIntent({
        customerId: customer.id,
        leadBookingId,
        venueId,
        stripeConnectedAccountId: stripeAccountId,
      });

      await insertCardHoldRows(
        admin,
        cardHoldLines.map((l) => ({ bookingId: l.bookingId, feePence: l.feePence })),
        {
          venueId,
          stripeConnectedAccountId: stripeAccountId,
          stripeCustomerId: customer.id,
          stripeSetupIntentId: setupIntent.id,
          termsSnapshot: buildCardHoldTermsSnapshot(venueName, cardHoldFeeTotal ?? 0),
        },
      );

      // Covered/free lines stay Booked whatever happens to the card save, so
      // their confirmations go out now that rollback is no longer possible.
      flushDeferredGuestNotifications();
      return {
        ok: true,
        body: {
          status: 'payment_required',
          payment_mode: 'setup',
          group_booking_id: groupId,
          booking_ids: bookingIds,
          primary_booking_id: leadBookingId,
          client_secret: setupIntent.client_secret,
          stripe_account_id: stripeAccountId,
          total_amount_pence: 0,
          card_hold_fee_pence: cardHoldFeeTotal,
        },
      };
    } catch (setupErr) {
      console.error('[orchestrateClassCartCheckout] card-hold setup failed', setupErr);
      await rollbackGroup();
      return { ok: false, status: 500, error: 'Payment setup failed' };
    }
  }

  if (!primaryPaidBookingId || paidBookingIds.length === 0) {
    await rollbackGroup();
    return { ok: false, status: 500, error: 'No payable class rows in cart' };
  }

  const isPaymentWithSetup = captureMode === 'payment_with_setup';

  try {
    // payment_with_setup: the single PaymentIntent charges the money AND vaults the
    // card (§7.0). It gains customer + setup_future_usage, and goes card-only
    // (replacing automatic_payment_methods for this mode ONLY) so the vaulted method
    // matches the consent copy and the off-session charge semantics.
    if (isPaymentWithSetup) {
      const customer = await createCardHoldCustomer({
        leadBookingId: primaryPaidBookingId,
        venueId,
        stripeConnectedAccountId: stripeAccountId,
        email: emailLower,
        name: displayName,
      });
      cardHoldCustomerId = customer.id;
    }

    const cardHoldBookingIds = cardHoldLines.map((l) => l.bookingId);
    // In payment_with_setup mode the card-hold booking rows also carry the unit PI id
    // (their hold rows have stripe_setup_intent_id NULL; the PI is the linkage).
    const piLinkedBookingIds = isPaymentWithSetup
      ? [...paidBookingIds, ...cardHoldBookingIds]
      : paidBookingIds;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalStripePence,
        currency: 'gbp',
        metadata: {
          booking_id: primaryPaidBookingId,
          booking_ids: piLinkedBookingIds.join(','),
          group_booking_id: groupId,
          venue_id: venueId,
          reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.CLASS_CART_CHECKOUT,
        },
        ...(isPaymentWithSetup
          ? {
              customer: cardHoldCustomerId!,
              setup_future_usage: 'off_session' as const,
              payment_method_types: ['card'],
            }
          : { automatic_payment_methods: { enabled: true } }),
      },
      { stripeAccount: stripeAccountId },
    );

    const clientSecret = paymentIntent.client_secret;

    const { error: piUpdErr } = await admin
      .from('bookings')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        updated_at: new Date().toISOString(),
      })
      .in('id', piLinkedBookingIds);

    if (piUpdErr) {
      console.error('[orchestrateClassCartCheckout] PI link failed', piUpdErr);
      throw new Error('Failed to link payment');
    }

    if (isPaymentWithSetup) {
      await insertCardHoldRows(
        admin,
        cardHoldLines.map((l) => ({ bookingId: l.bookingId, feePence: l.feePence })),
        {
          venueId,
          stripeConnectedAccountId: stripeAccountId,
          stripeCustomerId: cardHoldCustomerId!,
          stripeSetupIntentId: null,
          termsSnapshot: buildCardHoldTermsSnapshot(venueName, cardHoldFeeTotal ?? 0),
        },
      );
    }

    // Money audit row covers the charged lines only; hold lines have no money today
    // (their record is the booking_card_holds row).
    await persistClassCartCheckoutTransaction(admin, {
      venueId,
      userId,
      groupBookingId: groupId,
      paymentIntentId: paymentIntent.id,
      amountPence: totalStripePence,
      paidBookingIds,
    });

    // Covered/free lines stay Booked whatever happens to the payment, so
    // their confirmations go out now that rollback is no longer possible.
    flushDeferredGuestNotifications();
    return {
      ok: true,
      body: {
        status: 'payment_required',
        payment_mode: isPaymentWithSetup ? 'payment_with_setup' : 'payment',
        group_booking_id: groupId,
        booking_ids: bookingIds,
        primary_booking_id: primaryPaidBookingId,
        client_secret: clientSecret,
        stripe_account_id: stripeAccountId,
        payment_intent_id: paymentIntent.id,
        total_amount_pence: totalStripePence,
        checkout_charge_kind: checkoutChargeKindFromLines(stripeQuoteLines),
        card_hold_fee_pence: cardHoldFeeTotal,
      },
    };
  } catch (stripeErr) {
    console.error('[orchestrateClassCartCheckout] PaymentIntent create failed', stripeErr);
    await rollbackGroup();
    return { ok: false, status: 500, error: 'Payment setup failed' };
  }
}

function checkoutChargeKindFromLines(lines: ClassCartQuoteLine[]): 'deposit' | 'full_payment' {
  const paidLines = lines.filter((l) => l.online_charge_pence > 0);
  if (paidLines.length === 0) return 'deposit';
  return paidLines.every((l) => l.payment_requirement === 'full_payment') ? 'full_payment' : 'deposit';
}
