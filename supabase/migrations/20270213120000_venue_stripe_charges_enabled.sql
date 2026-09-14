-- Venues remember whether their Stripe account can take charges
-- (Docs/collective-one-venue-plan.md W1a, RT2-15).
--
-- THE GAP. Nothing stores whether a venue's connected Stripe account can actually take a card
-- charge. Every reader asks Stripe live (the Settings card, the setup checklist) or checks only
-- that an account id exists. An id is written the moment onboarding STARTS, so a venue that
-- never finished onboarding looks payment-ready to any server-side rule that cannot afford a
-- Stripe round trip per venue per page view. The combined page's rule that hides a venue's paid
-- services from the public until it can take payments is exactly such a rule.
--
-- THE COLUMN. `stripe_charges_enabled`: TRUE or FALSE as Stripe last reported it, NULL when
-- unknown (no account, a new account, or never observed). Maintained by the server only:
--   * the `account.updated` Connect webhook writes it;
--   * GET /api/venue/stripe-connect writes what it just read from Stripe;
--   * scripts/backfill-stripe-charges-enabled.mjs fills existing venues once per environment;
--   * this trigger resets it to NULL when the connected account id changes, so a new account
--     never inherits the old one's answer.
--
-- CLIENT ROLES CANNOT WRITE IT. Venue admins may update their own `venues` row through RLS, so
-- without a guard an admin could mark their own venue payment-ready. The trigger keeps the
-- stored value whenever an `anon` or `authenticated` request tries to change it. It does not
-- raise: a settings form saving a stale copy of the whole row must not fail because a webhook
-- changed this column in the meantime. Direct database sessions and the service role (every
-- server write above) are unaffected.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean;

COMMENT ON COLUMN public.venues.stripe_charges_enabled IS
  'Whether the connected Stripe account can take charges, as Stripe last reported it. NULL = unknown. Written by the server only (webhook, status read, backfill); reset to NULL when stripe_connected_account_id changes.';

CREATE OR REPLACE FUNCTION public.guard_venue_stripe_charges_enabled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_role text := auth.role();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_role IN ('anon', 'authenticated') THEN
      NEW.stripe_charges_enabled := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF v_role IN ('anon', 'authenticated') THEN
    NEW.stripe_charges_enabled := OLD.stripe_charges_enabled;
  END IF;

  IF NEW.stripe_connected_account_id IS DISTINCT FROM OLD.stripe_connected_account_id
     AND NEW.stripe_charges_enabled IS NOT DISTINCT FROM OLD.stripe_charges_enabled THEN
    NEW.stripe_charges_enabled := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_venue_stripe_charges_enabled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_venue_stripe_charges_enabled ON public.venues;
CREATE TRIGGER trg_guard_venue_stripe_charges_enabled
  BEFORE INSERT OR UPDATE OF stripe_charges_enabled, stripe_connected_account_id ON public.venues
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_venue_stripe_charges_enabled();
