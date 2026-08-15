-- N2, N3 and N4 — the linked-venue write holes and the unscoped guest read.
--
-- These are step 8 of the audit's implementation order, and the document is
-- explicit that they are interim hardening to be SUBSUMED by D1 rather than
-- repeated by it. What lands here is D1's A1 (write policies), A3 (audit the
-- DELETE) and A4 (calendar-scope the guest read). D1's A2, the column-level
-- grant on the read path, deliberately does NOT land here: it needs a live
-- Realtime smoke test against REPLICA IDENTITY FULL first.
--
-- ---------------------------------------------------------------------------
-- N3 — unvalidated cross-venue INSERT, and N2 — unaudited cross-venue DELETE.
--
-- `linked_venue_can_insert_bookings` and `linked_venue_can_delete_bookings` let
-- a `create_edit_cancel` partner write the owner's bookings straight from a
-- browser over PostgREST: rows inserted with no availability, deposit,
-- compliance or capacity check and with `status`/`internal_notes` freely set,
-- and rows deleted outright. The DELETE is the worse of the two, because
-- `cross_venue_booking_audit_trigger` was AFTER INSERT OR UPDATE with no DELETE
-- branch, so the row vanished with no audit entry and no notification. C4 at
-- least re-parented a row that still existed.
--
-- The fix is the one the architecture already intends: `linked_apply_booking_*`
-- becomes the only cross-venue write path. Those RPCs set the audit GUCs,
-- write a fixed column list, and are reachable only by `service_role` after
-- C0. The own-venue disjunct stays on every policy, so nothing about a venue
-- writing its own bookings changes.
--
-- VERIFIED SAFE BEFORE WRITING THIS. Every file importing the browser Supabase
-- client was scanned: `bookings` appears in exactly two places, both READS in
-- `useVenueLiveSync.ts`. There is no browser write to `bookings` anywhere in
-- `src/`, so no application path depends on these three disjuncts. The staff
-- routes write through `getSupabaseAdminClient()` / `staff.db`, which is
-- `service_role` and bypasses RLS entirely.
--
-- C0 is a hard prerequisite and is already met: before it, dropping these
-- policies would only have redirected a determined caller from PostgREST table
-- writes to the equally-open `linked_apply_*` RPCs. Those are now
-- `service_role`-only, verified by `npm run check:function-grants`.

DROP POLICY IF EXISTS "linked_venue_can_edit_bookings" ON public.bookings;
CREATE POLICY "linked_venue_can_edit_bookings" ON public.bookings
FOR UPDATE USING (
  venue_id IN (SELECT current_staff_venue_ids())
)
WITH CHECK (
  venue_id IN (SELECT current_staff_venue_ids())
);

DROP POLICY IF EXISTS "linked_venue_can_insert_bookings" ON public.bookings;
CREATE POLICY "linked_venue_can_insert_bookings" ON public.bookings
FOR INSERT WITH CHECK (
  venue_id IN (SELECT current_staff_venue_ids())
);

DROP POLICY IF EXISTS "linked_venue_can_delete_bookings" ON public.bookings;
CREATE POLICY "linked_venue_can_delete_bookings" ON public.bookings
FOR DELETE USING (
  venue_id IN (SELECT current_staff_venue_ids())
);

-- `linked_venue_can_view_bookings` is deliberately UNTOUCHED. The linked
-- calendar opens a `postgres_changes` channel per linked venue and the comment
-- at PractitionerCalendarView.tsx states the dependency outright: RLS gates
-- delivery. Dropping the SELECT disjunct makes the channel subscribe
-- successfully and never fire, with no error and nothing in Sentry. See D1.

-- ---------------------------------------------------------------------------
-- N2 — the audit trigger gains a DELETE branch.
--
-- Defence in depth rather than the primary control: with the policy above
-- dropped, a cross-venue DELETE can now only originate from `service_role`,
-- and this function returns early for a caller who staffs no venue. It matters
-- if the policy is ever reinstated, and it removes the asymmetry that made a
-- delete the one cross-venue write leaving no trace.
--
-- OLD-awareness is the trap the audit flags: on DELETE, `NEW` is NULL, so the
-- original `NEW.venue_id IN (...)` guard raises before any branch is reached.
-- Every reference is routed through locals resolved from the right record.

CREATE OR REPLACE FUNCTION log_cross_venue_booking_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting_venue uuid;
  acting_user  uuid;
  link_id      uuid;
  act          text;
  owner_is_caller boolean;
  rec_venue_id uuid;
  rec_id       uuid;
BEGIN
  -- DELETE carries the row in OLD and leaves NEW null.
  IF TG_OP = 'DELETE' THEN
    rec_venue_id := OLD.venue_id;
    rec_id       := OLD.id;
  ELSE
    rec_venue_id := NEW.venue_id;
    rec_id       := NEW.id;
  END IF;

  acting_venue := NULLIF(current_setting('reserveni.linked_action_venue', true), '')::uuid;
  acting_user  := COALESCE(
    NULLIF(current_setting('reserveni.linked_action_user', true), '')::uuid,
    auth.uid()
  );
  link_id := NULLIF(current_setting('reserveni.linked_action_link', true), '')::uuid;

  -- A write by someone who staffs the owning venue is an ordinary same-venue
  -- write — never a cross-venue action, regardless of GUC state.
  owner_is_caller := rec_venue_id IN (SELECT public.current_staff_venue_ids());
  IF owner_is_caller THEN
    RETURN NULL;
  END IF;

  IF acting_venue IS NULL THEN
    -- No explicit linked_apply_* context. A caller who staffs no venue at all
    -- is a service-role / cron / system write — not a cross-venue user action.
    IF NOT EXISTS (SELECT 1 FROM public.current_staff_venue_ids()) THEN
      RETURN NULL;
    END IF;
    -- A caller who staffs some venue but NOT the owning venue wrote to this
    -- booking without going through linked_apply_*. Resolve the link that
    -- authorises it; block the write if none exists.
    SELECT al.id INTO link_id
      FROM public.account_links al
     WHERE al.status = 'accepted'
       AND (
         (al.venue_low_id  = rec_venue_id
            AND al.venue_high_id IN (SELECT public.current_staff_venue_ids()))
         OR
         (al.venue_high_id = rec_venue_id
            AND al.venue_low_id  IN (SELECT public.current_staff_venue_ids()))
       )
     ORDER BY al.created_at
     LIMIT 1;

    IF link_id IS NULL THEN
      RAISE EXCEPTION
        'Cross-venue booking write on venue % is not authorised by an accepted account link',
        rec_venue_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- The acting venue is whichever side of the resolved link the caller staffs.
    SELECT CASE
             WHEN al.venue_low_id = rec_venue_id THEN al.venue_high_id
             ELSE al.venue_low_id
           END
      INTO acting_venue
      FROM public.account_links al
     WHERE al.id = link_id;
  ELSE
    -- Explicit linked_apply_* context. A self-referential context (acting venue
    -- equals owning venue) is not a cross-venue action.
    IF acting_venue = rec_venue_id THEN
      RETURN NULL;
    END IF;
    -- Resolve the link if the RPC did not supply one.
    IF link_id IS NULL THEN
      SELECT al.id INTO link_id
        FROM public.account_links al
       WHERE al.status IN ('accepted', 'suspended')
         AND (
           (al.venue_low_id  = rec_venue_id AND al.venue_high_id = acting_venue)
           OR
           (al.venue_high_id = rec_venue_id AND al.venue_low_id  = acting_venue)
         )
       ORDER BY al.created_at
       LIMIT 1;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    act := 'created_booking';
    INSERT INTO account_link_audit_log
      (link_id, acting_venue_id, acting_user_id, owning_venue_id,
       action_type, resource_type, resource_id, before_state, after_state)
    VALUES
      (link_id, acting_venue, acting_user, rec_venue_id,
       act, 'booking', rec_id, NULL, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
      act := 'cancelled_booking';
    ELSE
      act := 'edited_booking';
    END IF;
    INSERT INTO account_link_audit_log
      (link_id, acting_venue_id, acting_user_id, owning_venue_id,
       action_type, resource_type, resource_id, before_state, after_state)
    VALUES
      (link_id, acting_venue, acting_user, rec_venue_id,
       act, 'booking', rec_id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    -- There is no after_state: the row is gone. `before_state` is redacted by
    -- trg_redact_link_audit_booking_state exactly as it is for an update.
    act := 'deleted_booking';
    INSERT INTO account_link_audit_log
      (link_id, acting_venue_id, acting_user_id, owning_venue_id,
       action_type, resource_type, resource_id, before_state, after_state)
    VALUES
      (link_id, acting_venue, acting_user, rec_venue_id,
       act, 'booking', rec_id, to_jsonb(OLD), NULL);
  END IF;

  RETURN NULL; -- AFTER trigger: the return value is discarded.
END;
$$;

DROP TRIGGER IF EXISTS cross_venue_booking_audit_trigger ON public.bookings;
CREATE TRIGGER cross_venue_booking_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW
  EXECUTE PROCEDURE log_cross_venue_booking_action();

-- The owner's notification for a deletion. TWO things are needed, and doing
-- only the first would have been a change that succeeds and does nothing:
--
--   1. The mapper's ELSE would otherwise label a vanished booking 'edited',
--      which is the one thing it is not. Reuses the existing
--      `cross_venue_booking_cancelled` type rather than introducing one the
--      notification UI does not render: from the owner's side the actionable
--      fact is the same, the booking is no longer there.
--   2. The trigger carries a WHEN clause listing the three action types it
--      fires for. A `deleted_booking` row would never reach the mapper at all
--      unless that list is extended too, so it is recreated below.
CREATE OR REPLACE FUNCTION public.notify_owning_venue_of_cross_venue_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type        text;
  v_actor_name  text;
  v_state       jsonb;
BEGIN
  IF NEW.action_type = 'created_booking' THEN
    v_type := 'cross_venue_booking_created';
    v_state := NEW.after_state;
  ELSIF NEW.action_type IN ('cancelled_booking', 'deleted_booking') THEN
    v_type := 'cross_venue_booking_cancelled';
    v_state := COALESCE(NEW.before_state, NEW.after_state);
  ELSE
    v_type := 'cross_venue_booking_edited';
    v_state := COALESCE(NEW.after_state, NEW.before_state);
  END IF;

  SELECT name INTO v_actor_name FROM public.venues WHERE id = NEW.acting_venue_id;

  INSERT INTO public.account_link_notifications
    (venue_id, type, category, link_id, actor_venue_id, resource_type, resource_id, payload)
  VALUES (
    NEW.owning_venue_id,
    v_type,
    'cross_venue_write',
    NEW.link_id,
    NEW.acting_venue_id,
    NEW.resource_type,
    NEW.resource_id,
    jsonb_build_object(
      'actor_venue_name', COALESCE(v_actor_name, 'A linked venue'),
      'booking_date',     v_state->>'booking_date',
      'booking_time',     v_state->>'booking_time',
      'old_booking_date', CASE WHEN NEW.action_type = 'edited_booking'
                               THEN NEW.before_state->>'booking_date' END,
      'old_booking_time', CASE WHEN NEW.action_type = 'edited_booking'
                               THEN NEW.before_state->>'booking_time' END
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cross_venue_write_notification_trigger ON public.account_link_audit_log;
CREATE TRIGGER cross_venue_write_notification_trigger
  AFTER INSERT ON public.account_link_audit_log
  FOR EACH ROW
  WHEN (
    NEW.action_type IN ('created_booking', 'edited_booking', 'cancelled_booking', 'deleted_booking')
    AND NEW.acting_venue_id <> NEW.owning_venue_id
  )
  EXECUTE PROCEDURE public.notify_owning_venue_of_cross_venue_write();

-- ---------------------------------------------------------------------------
-- N4 — `linked_venue_can_view_guests` is not calendar-scoped.
--
-- It checks `link_calendar_grant = 'full_details' AND link_pii_grant` and stops
-- there. The §18 calendar-scope migration added `link_calendar_allows` to all
-- four `bookings` policies and left `guests` alone, so a chair-rental link
-- scoped to ONE calendar, with PII on, exposes every guest of the host venue:
-- names, emails, phones, and the whole customer-profile record.
--
-- A guest has no calendar of its own, so the scope has to come from its
-- bookings: visible when the guest has at least one booking on a calendar this
-- link is allowed to see. The expression is `COALESCE(calendar_id,
-- practitioner_id)`, exactly the one the four bookings policies already use, so
-- this introduces no new assumption about what the granted id list contains.
--
-- SECURITY DEFINER, matching every other `link_*` helper, so the EXISTS is not
-- itself subject to the caller's RLS on `bookings`. That keeps the rule
-- explicit rather than emergent from nested policy evaluation. It adds a
-- thirteenth entry to the client-executable allowlist, updated in the same
-- commit in `scripts/check-client-executable-functions.mjs`.

CREATE OR REPLACE FUNCTION public.link_guest_calendar_allows(p_owner_venue uuid, p_guest uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.bookings b
     WHERE b.guest_id = p_guest
       AND b.venue_id = p_owner_venue
       AND public.link_calendar_allows(p_owner_venue, COALESCE(b.calendar_id, b.practitioner_id))
  );
$$;

COMMENT ON FUNCTION public.link_guest_calendar_allows(uuid, uuid) IS
  'N4 — true when the guest has a booking on a calendar the caller''s link is scoped to. RLS helper: evaluated as the querying role, returns false for anon.';

DROP POLICY IF EXISTS "linked_venue_can_view_guests" ON guests;
CREATE POLICY "linked_venue_can_view_guests"
  ON guests FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR (public.link_calendar_grant(venue_id) = 'full_details'
        AND public.link_pii_grant(venue_id) = true
        AND public.link_guest_calendar_allows(venue_id, id))
  );

-- `practitioners` and `appointment_services` are left unscoped, deliberately.
-- Both are named alongside `guests` in N4, but neither carries personal data,
-- and scoping `practitioners` needs a fact this migration does not have:
-- `link_calendar_allows` is called elsewhere with a booking's
-- COALESCE(calendar_id, practitioner_id), so whether a granted id list holds
-- practitioner ids or unified-calendar ids decides whether scoping that table
-- hides one row or all of them. Establish that against live data before
-- touching it. Nothing in `src/` reads either table through a browser client,
-- so the exposure is a direct-PostgREST one and unchanged by this migration.

-- ---------------------------------------------------------------------------
-- VERIFICATION — run against the environment just migrated.
--
-- 1. The allowlist gains exactly one entry and nothing else moves:
--
--      npm run check:function-grants     -- expect PASS, 13
--
-- 2. The three write policies carry no linked disjunct, and the SELECT one
--    still does:
--
--      SELECT policyname, cmd, qual, with_check
--        FROM pg_policies
--       WHERE tablename = 'bookings' AND policyname LIKE 'linked_venue%'
--       ORDER BY policyname;
--
--    Expect `link_action_grant` to appear in NONE of edit/insert/delete, and
--    `link_calendar_grant` still present on view.
--
-- 3. The audit trigger fires on all three operations:
--
--      SELECT tgname, tgtype FROM pg_trigger
--       WHERE tgrelid = 'public.bookings'::regclass
--         AND tgname = 'cross_venue_booking_audit_trigger';
--
-- 4. Smoke-test the dashboard as a LINKED venue: the shared calendar must still
--    render the owner's bookings (the SELECT policy is untouched) and still
--    update live when the owner changes one. Cross-venue edits now go through
--    linked_apply_booking_update, which is what the app already calls.
-- ---------------------------------------------------------------------------
