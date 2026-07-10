import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';
import type { CardHoldTermsSnapshot } from './card-hold-terms';

/**
 * Card-hold capture helpers (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §7.0).
 *
 * A "capture unit" is the set of booking rows confirmed by one payment step
 * (a single booking, a multi-service/group unit, or a class cart). This module
 * resolves how the card is captured for a unit and provides the shared Stripe
 * and persistence helpers used by every create path.
 */

export type CaptureMode = 'payment' | 'setup' | 'payment_with_setup';

export type CaptureUnitLine = {
  bookingId: string;
  chargePence: number; // money due for this row (0 for card-hold and covered rows)
  cardHoldFeePence: number | null; // non-null when this row requires a hold
};

export function resolveCaptureMode(lines: CaptureUnitLine[]): CaptureMode | 'none' {
  const money = lines.reduce((s, l) => s + l.chargePence, 0);
  const holds = lines.some((l) => l.cardHoldFeePence != null);
  if (money > 0 && holds) return 'payment_with_setup';
  if (money > 0) return 'payment';
  if (holds) return 'setup';
  return 'none';
}

/**
 * Create the dedicated, booking-scoped Stripe Customer for a card-hold capture
 * unit on the venue's connected account (D2, §8.2). Never the guest's account
 * wallet customer: this one is not wallet-visible or self-detachable, and is
 * deleted wholesale when the hold is released.
 */
export async function createCardHoldCustomer(params: {
  leadBookingId: string;
  venueId: string;
  stripeConnectedAccountId: string;
  email?: string | null;
  name?: string | null;
}): Promise<Stripe.Customer> {
  const { leadBookingId, venueId, stripeConnectedAccountId, email, name } = params;
  return stripe.customers.create(
    {
      email: email?.trim() || undefined,
      name: name?.trim() || undefined,
      metadata: {
        reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.CARD_HOLD_CUSTOMER,
        booking_id: leadBookingId,
        venue_id: venueId,
      },
    },
    { stripeAccount: stripeConnectedAccountId },
  );
}

/**
 * Create the setup-mode SetupIntent for a card-hold capture unit (§7.0).
 * Card-only so the saved method matches the consent copy and the off-session
 * charge semantics (§8.3); Apple Pay / Google Pay still work as they tokenise
 * to cards.
 */
export async function createCardHoldSetupIntent(params: {
  customerId: string;
  leadBookingId: string;
  venueId: string;
  stripeConnectedAccountId: string;
}): Promise<Stripe.SetupIntent> {
  const { customerId, leadBookingId, venueId, stripeConnectedAccountId } = params;
  return stripe.setupIntents.create(
    {
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.CARD_HOLD_SETUP,
        booking_id: leadBookingId,
        venue_id: venueId,
      },
    },
    { stripeAccount: stripeConnectedAccountId },
  );
}

/** One hold row per booking row in the capture unit, each with its own max chargeable fee (§5.2). */
export type CardHoldRowInput = {
  bookingId: string;
  feePence: number;
};

/** Fields shared by every hold row in the capture unit (§5.2 row granularity). */
export type CardHoldSharedFields = {
  venueId: string;
  stripeConnectedAccountId: string;
  stripeCustomerId: string;
  /** Set in 'setup' mode; null in 'payment_with_setup' mode (linkage is the unit PI on bookings). */
  stripeSetupIntentId: string | null;
  termsSnapshot: CardHoldTermsSnapshot;
};

/**
 * Insert the `booking_card_holds` rows for a capture unit (§5.2). The consent
 * snapshot is written at create; `accepted_at` is stamped at confirm.
 */
export async function insertCardHoldRows(
  admin: SupabaseClient,
  rows: CardHoldRowInput[],
  shared: CardHoldSharedFields,
): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await admin.from('booking_card_holds').insert(
    rows.map((row) => ({
      booking_id: row.bookingId,
      venue_id: shared.venueId,
      stripe_connected_account_id: shared.stripeConnectedAccountId,
      stripe_customer_id: shared.stripeCustomerId,
      stripe_setup_intent_id: shared.stripeSetupIntentId,
      fee_pence: row.feePence,
      terms_snapshot: shared.termsSnapshot,
    })),
  );

  if (error) {
    console.error('[insertCardHoldRows] insert failed', error);
    throw new Error('Failed to store card hold');
  }
}
