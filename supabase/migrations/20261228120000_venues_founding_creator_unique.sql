-- One founding venue per creator.
--
-- Founding-plan signups skip Stripe, so the venues_stripe_customer_id_unique index
-- (partial WHERE stripe_customer_id IS NOT NULL) does NOT protect them: two concurrent
-- "Complete setup" submissions both pass the app-level email pre-check
-- (getExistingVenueForUserEmail) and insert two founding venues — each with a distinct
-- time-based slug (venue-${Date.now()}), so venues.slug UNIQUE does not catch them — plus
-- two admin staff rows for the one owner.
--
-- Record the creating auth user on the venue and enforce one founding venue per creator at
-- the database. The losing racer's INSERT then fails SQLSTATE 23505, which
-- /api/signup/create-checkout catches and resolves to the already-created founding venue
-- instead of erroring. Nullable column + partial index so existing and non-founding venues
-- are unaffected (NULLs are never "equal" in a unique index, and only founding rows that
-- set the new column participate).

ALTER TABLE venues ADD COLUMN IF NOT EXISTS created_by_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS venues_founding_creator_unique
  ON venues (created_by_user_id)
  WHERE pricing_tier = 'founding' AND created_by_user_id IS NOT NULL;
