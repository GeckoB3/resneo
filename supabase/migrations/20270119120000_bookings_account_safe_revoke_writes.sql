-- =============================================================================
-- P0-6 follow-up: bookings_account_safe must be SELECT-only for clients.
-- =============================================================================
--
-- 20270118120000 created the view with `GRANT SELECT ... TO authenticated` and
-- believed that was the whole grant. On a HOSTED project it is not: Supabase
-- applies project-level default privileges outside the migration history, and
-- on view creation it granted authenticated INSERT, UPDATE and DELETE as well.
-- `scripts/check-table-grants.mjs` caught this against staging on 2026-08-27.
--
-- This is not cosmetic. The view is a single-table security_barrier view with a
-- simple WHERE, so Postgres makes it AUTO-UPDATABLE, and it runs as its owner
-- (no security_invoker). A signed-in customer could therefore
--   UPDATE bookings_account_safe SET deposit_status='Paid', amount_paid_pence=...
--   WHERE id = <their own booking>
-- and the write executed as the view owner, bypassing the base-table column
-- grants that 20270112120000 deliberately withholds. Confirmed exploitable on
-- staging with the anon publishable key before this migration: a customer wrote
-- deposit_status and amount_paid_pence to their own booking and it persisted.
--
-- A fresh local/CI build never had the extra grant (no hosted defaults there),
-- so these REVOKEs are a no-op on such builds and the fix is uniform across
-- environments. anon already holds nothing on the view (20270118120000 revoked
-- it), but the REVOKE is repeated here so the intent is stated in one place.

REVOKE INSERT, UPDATE, DELETE ON public.bookings_account_safe FROM authenticated;
REVOKE ALL ON public.bookings_account_safe FROM anon, PUBLIC;

-- Re-assert the one grant the view is meant to carry, so this migration fully
-- describes the intended end state on its own.
GRANT SELECT ON public.bookings_account_safe TO authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICATION - run against the environment just migrated.
--
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_name = 'bookings_account_safe'
--    ORDER BY grantee, privilege_type;
--   -- expect: authenticated / SELECT, and nothing else for authenticated or anon.
--
-- Also: npm run check:table-grants (reads the live hosted grants).
-- ---------------------------------------------------------------------------
