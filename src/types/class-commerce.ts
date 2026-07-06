import type { ClassPaymentRequirement } from '@/types/booking-models';

/** Stripe / webhook metadata discriminator for class-commerce PaymentIntents. */
export const RESERVE_NI_PI_PURPOSE = {
  CLASS_CREDIT_PURCHASE: 'class_credit_purchase',
  /** One PaymentIntent covers multiple class_session rows sharing `group_booking_id`. */
  CLASS_CART_CHECKOUT: 'class_cart_checkout',
  /** Paid course enrollment checkout on the venue connected account. */
  CLASS_COURSE_ENROLLMENT: 'class_course_enrollment',
  /** Booking-scoped card-hold Customer metadata (D2). */
  CARD_HOLD_CUSTOMER: 'card_hold',
  /** Card-hold SetupIntent metadata. */
  CARD_HOLD_SETUP: 'card_hold_setup',
  /** Off-session no-show fee charge PI metadata. */
  CARD_HOLD_NO_SHOW_FEE: 'card_hold_no_show_fee',
} as const;

export const RESERVE_NI_SUBSCRIPTION_PURPOSE = {
  CLASS_MEMBERSHIP: 'class_membership',
} as const;

export type ResneoPaymentIntentPurpose =
  (typeof RESERVE_NI_PI_PURPOSE)[keyof typeof RESERVE_NI_PI_PURPOSE];

export type ClassCreditLedgerReason =
  | 'purchase'
  | 'redeem'
  | 'refund'
  | 'expire'
  | 'admin_adjust';

export type ClassCourseEnrollmentStatus =
  | 'pending_payment'
  | 'active'
  | 'cancelled'
  | 'completed';

export type ClassMembershipStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'paused'
  | 'incomplete';

export type ClassRecurringReservationStatus = 'active' | 'paused' | 'cancelled' | 'failed';

export type ClassBookingGroupKind = 'multi_session' | 'course' | 'recurring_materialization';

export interface VenueCustomerStripeRow {
  id: string;
  user_id: string;
  venue_id: string;
  stripe_connected_account_id: string;
  stripe_customer_id: string;
  default_payment_method_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassCreditProductRow {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  credits_count: number;
  price_pence: number;
  currency: string;
  validity_days: number | null;
  eligible_class_type_ids: string[] | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserClassCreditBalanceRow {
  id: string;
  user_id: string;
  venue_id: string;
  product_id: string;
  credits_remaining: number;
  expires_at: string | null;
  purchased_at: string;
  created_at: string;
  updated_at: string;
}

export interface ClassCartLineInput {
  class_instance_id: string;
  party_size: number;
}

export interface ClassCartQuoteLine {
  class_instance_id: string;
  party_size: number;
  booking_date: string;
  booking_time: string;
  class_name: string;
  class_type_id: string;
  remaining_before: number;
  /** Total online card charge for this line in pence (deposit or full), after any member discount. */
  online_charge_pence: number;
  /** Pre-discount charge, useful for UI strike-through pricing. Equals `online_charge_pence` when no discount applies. */
  original_pence: number;
  /** Per-line membership savings (pence), already subtracted from `online_charge_pence`. */
  member_discount_pence: number;
  /** Best membership discount percent that applied to this line (0–100). */
  member_discount_percent: number;
  /** How this line is charged online when `online_charge_pence` &gt; 0. */
  payment_requirement: ClassPaymentRequirement;
  /**
   * No-show hold fee for this line (per-person class-type fee x party size) when the
   * class type is `card_hold` and the venue `card_hold_deposits` flag is on; null
   * otherwise. No money is charged today for hold lines: `online_charge_pence` stays 0.
   */
  card_hold_fee_pence: number | null;
  requires_stripe_checkout: boolean;
  ok: boolean;
  error?: string;
}

export interface ClassCartQuoteResult {
  venue_id: string;
  lines: ClassCartQuoteLine[];
  all_ok: boolean;
  requires_authentication: true;
  /** Sum of `online_charge_pence` across lines. */
  total_online_charge_pence: number;
  /** Cart total of `card_hold_fee_pence` across ok lines; null when no line takes a hold. */
  card_hold_fee_pence: number | null;
}

/** How the class-cart payment step captures the card (design doc D7/§7.2). */
export type ClassCartPaymentMode = 'payment' | 'setup' | 'payment_with_setup';

/**
 * POST /api/booking/class-cart/checkout success shapes.
 *
 * `payment_required` covers all three capture modes (D7):
 * - `payment_mode: 'payment'`: money due, no holds. `client_secret` is a PaymentIntent
 *   secret; `payment_intent_id` and `checkout_charge_kind` are present (today's shape).
 * - `payment_mode: 'setup'`: no money due, at least one card-hold line. `client_secret`
 *   is a SetupIntent secret (confirm with `stripe.confirmSetup`); `payment_intent_id`
 *   and `checkout_charge_kind` are ABSENT and `total_amount_pence` is 0.
 * - `payment_mode: 'payment_with_setup'`: money due AND card-hold lines. Same fields as
 *   `'payment'` (one PaymentIntent charges the money and vaults the card).
 */
export type ClassCartCheckoutResponse =
  | {
      status: 'completed';
      group_booking_id: string;
      booking_ids: string[];
    }
  | {
      status: 'payment_required';
      payment_mode: ClassCartPaymentMode;
      group_booking_id: string;
      booking_ids: string[];
      /** Lead booking for the capture unit: first paid line, or first card-hold line in setup mode. */
      primary_booking_id: string;
      client_secret: string | null;
      stripe_account_id: string;
      /** Present in 'payment' and 'payment_with_setup' modes; absent in 'setup' mode. */
      payment_intent_id?: string;
      /** Money charged today in pence; 0 in 'setup' mode. */
      total_amount_pence: number;
      /** Wording for PaymentStep (deposit vs pay-in-full). Absent in 'setup' mode. */
      checkout_charge_kind?: 'deposit' | 'full_payment';
      /** Cart total of no-show hold fees, for consent copy; null when no card-hold lines. */
      card_hold_fee_pence: number | null;
      /**
       * The exact consent line the server snapshotted (§7.5). The payment step
       * displays this string, not a re-derivation, so the shown text cannot
       * drift from the stored dispute evidence. Absent without hold lines.
       */
      card_hold_consent_text?: string;
    };
