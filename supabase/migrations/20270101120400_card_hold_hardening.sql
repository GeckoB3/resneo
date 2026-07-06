-- Card holds (Migration D): security + integrity hardening from the
-- production review.
--
-- 1. report_deposit_summary is SECURITY DEFINER and, via CREATE OR REPLACE,
--    kept the default PUBLIC EXECUTE grant. Migration C extended it with
--    no-show fee aggregates, so an anon PostgREST caller could read a venue's
--    deposit and no-show-fee totals, bypassing bookings RLS. Lock it to the
--    service role, matching the house style for sensitive definer functions
--    (e.g. admin_hard_delete_venue).
-- 2. booking_card_holds.release_reason is documented but unconstrained. The
--    code only ever writes the five allowed reasons; add a CHECK as
--    defense-in-depth so a stray writer cannot store an out-of-vocabulary
--    reason that reporting/UI would then have to guess at.

REVOKE ALL ON FUNCTION report_deposit_summary(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_deposit_summary(uuid, timestamptz, timestamptz) TO service_role;

ALTER TABLE booking_card_holds
  DROP CONSTRAINT IF EXISTS booking_card_holds_release_reason_check;

ALTER TABLE booking_card_holds
  ADD CONSTRAINT booking_card_holds_release_reason_check
  CHECK (
    release_reason IS NULL
    OR release_reason IN ('cancelled', 'expired', 'refunded', 'abandoned', 'admin')
  );
