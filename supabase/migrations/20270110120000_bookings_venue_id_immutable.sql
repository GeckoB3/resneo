-- C4 — a linked venue can steal the owner's bookings by re-parenting `venue_id`.
--
-- `linked_venue_can_edit_bookings` (20260930120000:76-90) has a WITH CHECK whose
-- FIRST disjunct is `venue_id IN (SELECT current_staff_venue_ids())`. WITH CHECK
-- is evaluated against the NEW row, so a partner venue B holding an
-- `edit_existing` or `create_edit_cancel` grant on owner venue A can pass the
-- USING clause (as A) and then satisfy WITH CHECK by setting `venue_id` to B.
-- The booking moves to B's diary and leaves A's.
--
-- Nothing else stops it:
--
--   * `trg_enforce_cde_capacity` is BEFORE INSERT OR UPDATE **OF** status,
--     party_size, booking_date, booking_time, booking_end_time,
--     experience_event_id, class_instance_id, resource_id (20261225120000:134-138).
--     `venue_id` is not in that list, so a pure re-parent never fires it.
--   * `cross_venue_booking_audit_trigger` returns early when
--     `NEW.venue_id IN (SELECT current_staff_venue_ids())` (20260920120000:51-53).
--     After the re-parent that is true, so the one write the audit trigger most
--     needs to record is the one it waves past: no audit row, no notification.
--
-- Note the shape of the hole. The hardened audit trigger RAISES for a
-- cross-venue write that keeps `venue_id = A`. Re-parenting is therefore the
-- only way through, and it is the case the early return exempts.
--
-- WHY A TRIGGER RATHER THAN AN RLS CHANGE (D1/A1)
-- RLS is not enforced for the service_role client, and the staff booking routes
-- write via `getSupabaseAdminClient()`. A policy fix would leave every
-- admin-client path unprotected. A trigger runs for every writer, including
-- service_role, the linked_apply_* RPCs and psql. That is the point: this is a
-- data-model invariant, not an authorisation rule.
--
-- SECURITY INVOKER (the default) deliberately. The function reads OLD and NEW
-- and raises; it touches no table and needs no elevated rights. It is also
-- excluded from `audit_client_executable_functions()` by that function's
-- `prorettype <> 'trigger'` clause, so it does not move the allowlist of 12.
--
-- No REVOKE, matching every other trigger function in this repo
-- (`enforce_cde_capacity`, `log_cross_venue_booking_action`,
-- `set_booking_service_name_snapshot`, none of which are revoked). A function
-- returning `trigger` cannot be invoked directly — PostgreSQL rejects it with
-- "trigger functions can only be called as triggers" — so the default PUBLIC
-- EXECUTE grant confers nothing here.
--
-- VERIFIED SAFE BEFORE WRITING THIS (re-measured 2026-08-14 at 509242b4):
--   * `linked_apply_booking_update` (current definition 20260923140000:29-56)
--     writes a fixed list of 13 columns; `venue_id` is not among them.
--   * All 78 `bookings` update sites in `src/` were scanned. Six mention
--     `venue_id` inside the call; every one is an `.eq('venue_id', …)` filter or
--     a following `events` insert, never a payload key. The only dynamically
--     built payload (venue/bookings/[id]/route.ts:1595) is a closed literal over
--     staff_attendance_confirmed_at, updated_at, status,
--     guest_attendance_confirmed_at.
--   * There are no `bookings` upserts anywhere, so no ON CONFLICT DO UPDATE can
--     name `venue_id` implicitly.
--   * No migration has `venue_id` in any SET list.
--
-- If a genuine venue transfer is ever needed, it is a deliberate operation:
-- ALTER TABLE public.bookings DISABLE TRIGGER trg_bookings_venue_id_immutable;
-- do the move, re-enable. Making that awkward is intentional.

CREATE OR REPLACE FUNCTION public.bookings_venue_id_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- IS DISTINCT FROM, not <>, so a payload that re-writes the same value is a
  -- no-op rather than an error, and NULLs compare sanely. The trigger's own
  -- UPDATE OF clause already limits firing to statements that name the column.
  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION 'bookings.venue_id is immutable'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'A booking cannot be moved between venues. Cancel it and rebook at the target venue.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.bookings_venue_id_is_immutable() IS
  'C4 — blocks re-parenting a booking to another venue. Runs for every writer including service_role, which RLS does not cover.';

DROP TRIGGER IF EXISTS trg_bookings_venue_id_immutable ON public.bookings;
CREATE TRIGGER trg_bookings_venue_id_immutable
  BEFORE UPDATE OF venue_id ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_venue_id_is_immutable();

-- ---------------------------------------------------------------------------
-- VERIFICATION — run against the environment just migrated.
--
-- Test the behaviour, not the statement. 28 migrations in this repo's history
-- returned success and changed nothing (see C0); a query confirming the trigger
-- row exists would prove no more than they did.
--
-- 1. A re-parent is rejected. Expect SQLSTATE 42501, 'bookings.venue_id is
--    immutable', and 0 rows changed:
--
--      DO $v$
--      DECLARE b uuid; v_old uuid; v_new uuid;
--      BEGIN
--        SELECT id, venue_id INTO b, v_old FROM public.bookings LIMIT 1;
--        SELECT id INTO v_new FROM public.venues WHERE id <> v_old LIMIT 1;
--        BEGIN
--          UPDATE public.bookings SET venue_id = v_new WHERE id = b;
--          RAISE WARNING 'FAIL: the re-parent was allowed';
--        EXCEPTION WHEN insufficient_privilege THEN
--          RAISE NOTICE 'PASS: rejected with %', SQLERRM;
--        END;
--      END $v$;
--
-- 2. An ordinary update still works — this is the regression that matters, since
--    every staff write goes through paths like it. Expect no error:
--
--      UPDATE public.bookings SET updated_at = now()
--      WHERE id = (SELECT id FROM public.bookings LIMIT 1);
--
-- 3. A no-op rewrite of the same venue_id passes rather than raising:
--
--      UPDATE public.bookings SET venue_id = venue_id
--      WHERE id = (SELECT id FROM public.bookings LIMIT 1);
--
-- 4. The allowlist is unmoved (trigger functions are out of scope for it):
--
--      npm run check:function-grants     -- expect PASS, 12
-- ---------------------------------------------------------------------------
