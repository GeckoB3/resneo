-- Card holds (Migration B): booking_card_holds ledger.
--
-- One row per booking row that carries a card hold (unique on booking_id),
-- each with its own fee_pence snapshot. All rows in a capture unit share
-- stripe_customer_id (and stripe_setup_intent_id in setup mode), which lets
-- staff charge exactly the no-showed attendee (per-line in carts, per-member
-- in groups). Service-role access; RLS deny-by-default.

CREATE TABLE IF NOT EXISTS public.booking_card_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  venue_id   uuid NOT NULL REFERENCES public.venues (id)   ON DELETE CASCADE,
  stripe_connected_account_id text NOT NULL,   -- snapshotted so account changes cannot orphan the hold
  stripe_customer_id text,             -- dedicated, booking-scoped customer, shared across the capture unit
  stripe_setup_intent_id text,         -- set in 'setup' mode; NULL in 'payment_with_setup' mode
  stripe_payment_method_id text,       -- set at confirm time from the succeeded intent
  fee_pence int NOT NULL CHECK (fee_pence > 0),   -- max chargeable for THIS booking row, snapshotted at create
  currency text NOT NULL DEFAULT 'gbp',
  -- Consent snapshot shown to the guest at save time (dispute evidence):
  -- { "text": "...", "version": 1, "fee_pence": <unit total>, "accepted_at": "<iso>" }
  terms_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  charge_payment_intent_id text,
  charged_pence int CHECK (charged_pence IS NULL OR charged_pence > 0),
  charged_at timestamptz,
  charged_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  charge_failure_code text,            -- 'card_declined', 'authentication_required', ...
  charge_failure_at timestamptz,
  charge_attempt_count int NOT NULL DEFAULT 0,  -- incremented atomically before each Stripe charge attempt; feeds the idempotency key

  released_at timestamptz,
  release_reason text,                 -- 'cancelled' | 'expired' | 'refunded' | 'abandoned' | 'admin'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_card_holds_booking_uq
  ON public.booking_card_holds (booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS booking_card_holds_charge_pi_uq
  ON public.booking_card_holds (charge_payment_intent_id)
  WHERE charge_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_setup_intent
  ON public.booking_card_holds (stripe_setup_intent_id)
  WHERE stripe_setup_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_venue
  ON public.booking_card_holds (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_open
  ON public.booking_card_holds (venue_id) WHERE released_at IS NULL;

ALTER TABLE public.booking_card_holds ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only

COMMENT ON TABLE public.booking_card_holds IS
  'Card-hold deposit ledger: one row per booking row with a stored payment method; staff may charge a no-show fee up to fee_pence.';
