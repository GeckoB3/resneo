-- In-person payments (Tap to Pay / Terminal) — booking_payments ledger, booking
-- summary columns, venue capability columns, and the deposit backfill.
-- Spec: Docs/TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md §5.
-- Conventions follow the class-commerce ledgers (20260702120000): service-role
-- access only (RLS enabled, no policies), gen_random_uuid(), pence ints.

-- -----------------------------------------------------------------------------
-- Enums (§5.1)
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_payment_method') THEN
    CREATE TYPE public.booking_payment_method AS ENUM ('card_present','cash','external','online');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_payment_status') THEN
    CREATE TYPE public.booking_payment_status AS ENUM ('pending','succeeded','failed','refunded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_payment_state') THEN
    CREATE TYPE public.booking_payment_state AS ENUM
      ('unpaid','deposit_paid','partially_paid','paid','refunded');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Ledger table (§5.2) — source of truth for in-person settlement
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  venue_id   uuid NOT NULL REFERENCES public.venues (id)   ON DELETE CASCADE,
  -- Connected account the charge settled on; stored so refunds route correctly
  -- even if the venue's account id later changes.
  stripe_connected_account_id text,
  stripe_payment_intent_id text,                 -- null for cash/external
  method public.booking_payment_method NOT NULL,
  status public.booking_payment_status NOT NULL DEFAULT 'pending',
  amount_pence int NOT NULL CHECK (amount_pence >= 0),       -- goods/services (balance)
  tip_amount_pence int NOT NULL DEFAULT 0 CHECK (tip_amount_pence >= 0), -- RESERVED, unused in v1
  currency text NOT NULL DEFAULT 'gbp',
  purpose text NOT NULL DEFAULT 'balance',       -- human label for the ledger row
  staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,  -- who collected it
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One ledger row per PaymentIntent → webhook update is idempotent.
-- (Partial index because cash/external rows have a NULL stripe_payment_intent_id.)
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_pi_uq
  ON public.booking_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking
  ON public.booking_payments (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_payments_venue
  ON public.booking_payments (venue_id, created_at DESC);

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;  -- no policies = service-role only

COMMENT ON TABLE public.booking_payments IS
  'In-person payment ledger (Tap to Pay / Terminal / cash) per booking. Source of truth for bookings.amount_paid_pence / payment_state.';

-- -----------------------------------------------------------------------------
-- Booking summary columns (§5.3) — denormalised, derived from the ledger
-- -----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS amount_paid_pence int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_amount_pence  int NOT NULL DEFAULT 0,  -- reserved, unused in v1
  ADD COLUMN IF NOT EXISTS payment_state public.booking_payment_state NOT NULL DEFAULT 'unpaid';

-- Backfill so the balance is correct day one: a paid deposit counts toward
-- amount_paid. (Waived / Forfeited / Not Required deposits leave amount_paid at
-- 0 → full amount due in person, which is the correct behaviour.)
UPDATE public.bookings
   SET amount_paid_pence = COALESCE(deposit_amount_pence, 0),
       payment_state = 'deposit_paid'
 WHERE deposit_status = 'Paid' AND COALESCE(deposit_amount_pence, 0) > 0;

-- -----------------------------------------------------------------------------
-- Venue capability columns (§5.4)
-- -----------------------------------------------------------------------------
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS in_person_payments_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_terminal_location_id text;  -- lazily provisioned (§6.1)

COMMENT ON COLUMN public.venues.in_person_payments_enabled IS
  'Master per-venue switch for in-person payments (Tap to Pay / Terminal). Default off; §6.7.';

-- -----------------------------------------------------------------------------
-- Communication log type for the payment receipt (§6.5). Strict superset of
-- the 20270101120200 constraint (same pattern): every previously-allowed value
-- plus 'payment_receipt_email'.
-- -----------------------------------------------------------------------------
ALTER TABLE communication_logs
  DROP CONSTRAINT IF EXISTS communication_logs_message_type_check;

ALTER TABLE communication_logs
  ADD CONSTRAINT communication_logs_message_type_check CHECK (message_type IN (
    'booking_confirmation_email',
    'booking_confirmation_sms',
    'deposit_request_sms',
    'deposit_request_email',
    'deposit_confirmation_email',
    'reminder_56h_email',
    'day_of_reminder_sms',
    'day_of_reminder_email',
    'post_visit_email',
    'reminder_1_email',
    'reminder_1_sms',
    'reminder_2_email',
    'reminder_2_sms',
    'unified_post_visit_email',
    'booking_modification_email',
    'booking_modification_sms',
    'cancellation_email',
    'cancellation_sms',
    'confirm_or_cancel_prompt_email',
    'confirm_or_cancel_prompt_sms',
    'deposit_payment_reminder_email',
    'deposit_payment_reminder_sms',
    'pre_visit_reminder_email',
    'pre_visit_reminder_sms',
    'cancellation_confirmation_email',
    'cancellation_confirmation_sms',
    'auto_cancel_notification_email',
    'auto_cancel_notification_sms',
    'custom_message_email',
    'custom_message_sms',
    'no_show_notification_email',
    'post_visit_thankyou_email',
    'appointment_waitlist_offer_email',
    'appointment_waitlist_offer_sms',
    'class_credits_purchased_email',
    'class_credits_expiring_email',
    'class_credits_restored_email',
    'class_course_enrolled_email',
    'class_course_refunded_email',
    'class_membership_started_email',
    'class_membership_renewed_email',
    'class_membership_cancelling_email',
    'class_membership_ended_email',
    'compliance_form_request_email',
    'compliance_form_request_sms',
    'compliance_form_reminder_email',
    'compliance_form_reminder_sms',
    'compliance_record_expiring_email',
    'compliance_record_expiring_sms',
    'owner_booking_notification_email',
    'card_hold_request_email',
    'card_hold_request_sms',
    'card_hold_payment_reminder_email',
    'card_hold_payment_reminder_sms',
    'card_hold_charged_email',
    -- In-person payment receipt (§6.5)
    'payment_receipt_email'
  )) NOT VALID;

ALTER TABLE communication_logs VALIDATE CONSTRAINT communication_logs_message_type_check;
