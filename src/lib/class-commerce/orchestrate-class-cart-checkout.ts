import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { insertFreeClassSessionBooking } from '@/lib/booking/insert-free-class-session-booking';
import { insertPendingPaidClassSessionBooking } from '@/lib/booking/insert-pending-paid-class-session-booking';
import { findOrCreateGuest } from '@/lib/guests';
import { splitLegacyGuestName } from '@/lib/guests/name';
import { quoteClassCart } from '@/lib/class-commerce/quote-class-cart';
import { persistClassCartCheckoutTransaction } from '@/lib/class-commerce/persist-class-checkout';
import { consumeClassCreditsForBooking } from '@/lib/class-commerce/consume-class-credits';
import { sumAvailableClassCreditsForClassType } from '@/lib/class-commerce/available-class-credits';
import { userCourseCoversClassInstance } from '@/lib/class-commerce/course-instance-coverage';
import { membershipUnlimitedCoversClassType } from '@/lib/class-commerce/membership-class-access';
import { membershipCoversClassType } from '@/lib/class-commerce/membership-allowance-coverage';
import { consumeMembershipAllowanceForBooking } from '@/lib/class-commerce/consume-membership-allowance';
import type { ClassCartCheckoutResponse, ClassCartLineInput, ClassCartQuoteLine, ClassCartQuoteResult } from '@/types/class-commerce';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';

async function rollbackGroup(admin: SupabaseClient, groupId: string): Promise<void> {
  await admin.from('bookings').delete().eq('group_booking_id', groupId);
  await admin.from('class_booking_groups').delete().eq('id', groupId);
}

function checkoutChargeKindFromLines(lines: ClassCartQuoteLine[]): 'deposit' | 'full_payment' {
  const paidLines = lines.filter((l) => l.online_charge_pence > 0);
  if (paidLines.length === 0) return 'deposit';
  return paidLines.every((l) => l.payment_requirement === 'full_payment') ? 'full_payment' : 'deposit';
}

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

  const bookingIds: string[] = [];
  const paidBookingIds: string[] = [];
  const stripeQuoteLines: ClassCartQuoteLine[] = [];
  let primaryPaidBookingId: string | null = null;
  let totalStripePence = 0;

  try {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const qLine = quote.lines[i];
      if (!qLine || !qLine.ok) {
        throw new Error('Quote line mismatch');
      }

      const online = qLine.online_charge_pence;
      let useCredits = false;
      if (payWithClassCredits && online > 0) {
        const avail = await sumAvailableClassCreditsForClassType(admin, {
          userId,
          venueId,
          classTypeId: qLine.class_type_id,
        });
        useCredits = avail >= line.party_size;
      }

      let useCourse = false;
      if (!useCredits && online > 0) {
        useCourse = await userCourseCoversClassInstance(admin, {
          userId,
          venueId,
          classInstanceId: line.class_instance_id,
        });
      }

      let useMembership = false;
      let membershipCoverage: Awaited<ReturnType<typeof membershipCoversClassType>> | null = null;
      if (!useCredits && !useCourse && online > 0) {
        membershipCoverage = await membershipCoversClassType(admin, {
          userId,
          venueId,
          classTypeId: qLine.class_type_id,
          partySize: line.party_size,
        });
        useMembership = membershipCoverage.ok;
        // Keep legacy helper alignment for clarity (unlimited overrides allowance pricing).
        if (!useMembership) {
          // Fallback to the legacy unlimited check in case ledger rows are stale.
          useMembership = await membershipUnlimitedCoversClassType(admin, {
            userId,
            venueId,
            classTypeId: qLine.class_type_id,
          });
        }
      }

      if (useCredits && online > 0) {
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
        });
        if (!res.ok) {
          throw new Error(res.error);
        }
        const consumed = await consumeClassCreditsForBooking({
          admin,
          userId,
          venueId,
          credits: line.party_size,
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
        bookingIds.push(res.bookingId);
        continue;
      }

      if ((useCourse || useMembership) && online > 0) {
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
        });
        if (!res.ok) {
          throw new Error(res.error);
        }
        // When the matched membership is an allowance plan, ledger the consumption.
        if (
          useMembership &&
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
        }
        bookingIds.push(res.bookingId);
        continue;
      }

      if (online > 0) {
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
          throw new Error(res.error);
        }
        bookingIds.push(res.bookingId);
        paidBookingIds.push(res.bookingId);
        stripeQuoteLines.push(qLine);
        totalStripePence += res.deposit_amount_pence;
        if (!primaryPaidBookingId) primaryPaidBookingId = res.bookingId;
        continue;
      }

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
      });
      if (!res.ok) {
        throw new Error(res.error);
      }
      bookingIds.push(res.bookingId);
    }
  } catch (err) {
    console.error('[orchestrateClassCartCheckout] rollback', err);
    await rollbackGroup(admin, groupId);
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : 'Checkout failed',
    };
  }

  if (totalStripePence <= 0) {
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
    await rollbackGroup(admin, groupId);
    return { ok: false, status: 400, error: 'This venue cannot take card payments yet' };
  }

  if (!primaryPaidBookingId || paidBookingIds.length === 0) {
    await rollbackGroup(admin, groupId);
    return { ok: false, status: 500, error: 'No payable class rows in cart' };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalStripePence,
        currency: 'gbp',
        metadata: {
          booking_id: primaryPaidBookingId,
          booking_ids: paidBookingIds.join(','),
          group_booking_id: groupId,
          venue_id: venueId,
          reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.CLASS_CART_CHECKOUT,
        },
        automatic_payment_methods: { enabled: true },
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
      .in('id', paidBookingIds);

    if (piUpdErr) {
      console.error('[orchestrateClassCartCheckout] PI link failed', piUpdErr);
      throw new Error('Failed to link payment');
    }

    await persistClassCartCheckoutTransaction(admin, {
      venueId,
      userId,
      groupBookingId: groupId,
      paymentIntentId: paymentIntent.id,
      amountPence: totalStripePence,
      paidBookingIds,
    });

    return {
      ok: true,
      body: {
        status: 'payment_required',
        group_booking_id: groupId,
        booking_ids: bookingIds,
        primary_booking_id: primaryPaidBookingId,
        client_secret: clientSecret,
        stripe_account_id: stripeAccountId,
        payment_intent_id: paymentIntent.id,
        total_amount_pence: totalStripePence,
        checkout_charge_kind: checkoutChargeKindFromLines(stripeQuoteLines),
      },
    };
  } catch (stripeErr) {
    console.error('[orchestrateClassCartCheckout] PaymentIntent create failed', stripeErr);
    await rollbackGroup(admin, groupId);
    return { ok: false, status: 500, error: 'Payment setup failed' };
  }
}
