import type { ClassPaymentRequirement } from '@/types/booking-models';

/** Stripe / webhook metadata discriminator for class-commerce PaymentIntents. */
export const RESERVE_NI_PI_PURPOSE = {
  CLASS_CREDIT_PURCHASE: 'class_credit_purchase',
  /** One PaymentIntent covers multiple class_session rows sharing `group_booking_id`. */
  CLASS_CART_CHECKOUT: 'class_cart_checkout',
  /** Paid course enrollment checkout on the venue connected account. */
  CLASS_COURSE_ENROLLMENT: 'class_course_enrollment',
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
}

/** POST /api/booking/class-cart/checkout success shapes */
export type ClassCartCheckoutResponse =
  | {
      status: 'completed';
      group_booking_id: string;
      booking_ids: string[];
    }
  | {
      status: 'payment_required';
      group_booking_id: string;
      booking_ids: string[];
      primary_booking_id: string;
      client_secret: string | null;
      stripe_account_id: string;
      payment_intent_id: string;
      total_amount_pence: number;
      /** Wording for PaymentStep (deposit vs pay-in-full). */
      checkout_charge_kind: 'deposit' | 'full_payment';
    };
