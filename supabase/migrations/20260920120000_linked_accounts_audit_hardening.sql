-- ReserveNI: Linked Accounts — audit hardening (see Docs/reserveni-linked-accounts-spec.md §4.4)
--
-- The original cross-venue audit trigger (20260919120000_linked_accounts.sql)
-- only wrote an account_link_audit_log row when the linked_apply_* RPCs had set
-- the reserveni.linked_action_* GUCs. A cross-venue actor who wrote to bookings
-- directly through PostgREST (RLS still permits it) produced NO audit row.
--
-- §4.4 requires that every cross-venue mutation is auditable and that no code
-- path can skip the audit. This migration replaces the trigger so that:
--   * same-venue writes (caller is staff of the owning venue) are not audited;
--   * service-role / cron / system writes (caller staffs no venue) are not audited;
--   * cross-venue writes via linked_apply_* use the explicit GUC context;
--   * cross-venue writes WITHOUT the GUC have their authorising link resolved
--     automatically and are audited; if no accepted link can be resolved the
--     write is blocked outright.
-- Also grants SELECT on bookings_linked_anonymised so time_only linked viewers
-- can actually read the redaction view.

-- =============================================================================
-- 1. View grants — time_only linked viewers read through this view
-- =============================================================================

GRANT SELECT ON public.bookings_linked_anonymised TO authenticated, anon;

-- =============================================================================
-- 2. Hardened cross-venue booking audit trigger
-- =============================================================================

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
BEGIN
  acting_venue := NULLIF(current_setting('reserveni.linked_action_venue', true), '')::uuid;
  acting_user  := COALESCE(
    NULLIF(current_setting('reserveni.linked_action_user', true), '')::uuid,
    auth.uid()
  );
  link_id := NULLIF(current_setting('reserveni.linked_action_link', true), '')::uuid;

  -- A write by someone who staffs the owning venue is an ordinary same-venue
  -- write — never a cross-venue action, regardless of GUC state.
  owner_is_caller := NEW.venue_id IN (SELECT public.current_staff_venue_ids());
  IF owner_is_caller THEN
    RETURN NEW;
  END IF;

  IF acting_venue IS NULL THEN
    -- No explicit linked_apply_* context. A caller who staffs no venue at all
    -- is a service-role / cron / system write — not a cross-venue user action.
    IF NOT EXISTS (SELECT 1 FROM public.current_staff_venue_ids()) THEN
      RETURN NEW;
    END IF;
    -- A caller who staffs some venue but NOT the owning venue wrote to this
    -- booking without going through linked_apply_*. Resolve the link that
    -- authorises it; block the write if none exists.
    SELECT al.id INTO link_id
      FROM public.account_links al
     WHERE al.status = 'accepted'
       AND (
         (al.venue_low_id  = NEW.venue_id
            AND al.venue_high_id IN (SELECT public.current_staff_venue_ids()))
         OR
         (al.venue_high_id = NEW.venue_id
            AND al.venue_low_id  IN (SELECT public.current_staff_venue_ids()))
       )
     ORDER BY al.created_at
     LIMIT 1;

    IF link_id IS NULL THEN
      RAISE EXCEPTION
        'Cross-venue booking write on venue % is not authorised by an accepted account link',
        NEW.venue_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- The acting venue is whichever side of the resolved link the caller staffs.
    SELECT CASE
             WHEN al.venue_low_id = NEW.venue_id THEN al.venue_high_id
             ELSE al.venue_low_id
           END
      INTO acting_venue
      FROM public.account_links al
     WHERE al.id = link_id;
  ELSE
    -- Explicit linked_apply_* context. A self-referential context (acting venue
    -- equals owning venue) is not a cross-venue action.
    IF acting_venue = NEW.venue_id THEN
      RETURN NEW;
    END IF;
    -- Resolve the link if the RPC did not supply one.
    IF link_id IS NULL THEN
      SELECT al.id INTO link_id
        FROM public.account_links al
       WHERE al.status IN ('accepted', 'suspended')
         AND (
           (al.venue_low_id  = NEW.venue_id AND al.venue_high_id = acting_venue)
           OR
           (al.venue_high_id = NEW.venue_id AND al.venue_low_id  = acting_venue)
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
      (link_id, acting_venue, acting_user, NEW.venue_id,
       act, 'booking', NEW.id, NULL, to_jsonb(NEW));
    RETURN NEW;
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
      (link_id, acting_venue, acting_user, NEW.venue_id,
       act, 'booking', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- account_link_audit_log.link_id is NOT NULL; a resolved-link failure in the
-- fallback path raises before reaching the INSERT, so the constraint holds.

-- =============================================================================
-- End of audit hardening migration
-- =============================================================================
