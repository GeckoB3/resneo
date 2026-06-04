-- Resneo: Linked Accounts — in-app notification center (spec §17).
--
-- A per-venue, durable notification store. Phase 1 carries cross-venue *write*
-- notices: whenever a partner venue creates / edits / cancels a booking in your
-- calendar, the owning venue gets a notification — the trust guarantee that
-- justifies granting write access (§17.1, §17.3).
--
-- Notifications for cross-venue writes are produced by a trigger on
-- account_link_audit_log (AFTER INSERT), so a notice is created in the *same*
-- transaction as the audited write and cannot be skipped by any code path that
-- writes the audit row. NOTE (§16.1 #1): writes made through the service-role
-- admin client do not produce an audit row today, so they also produce no
-- notification — this store inherits exactly the audit log's coverage and
-- becomes complete once the #1 write-path fix lands.

-- =============================================================================
-- 1. Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.account_link_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,   -- recipient (owning venue)
  type            text NOT NULL,
  category        text NOT NULL DEFAULT 'cross_venue_write',
  link_id         uuid REFERENCES public.account_links (id) ON DELETE SET NULL,
  collective_id   uuid,
  actor_venue_id  uuid REFERENCES public.venues (id) ON DELETE SET NULL,           -- who performed the action
  resource_type   text,
  resource_id     uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,                              -- display-ready snapshot (actor name, date/time, …)
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_link_notifications_venue_created
  ON public.account_link_notifications (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_link_notifications_venue_unread
  ON public.account_link_notifications (venue_id) WHERE read_at IS NULL;

COMMENT ON TABLE public.account_link_notifications IS
  'Per-venue in-app notification feed for Linked Accounts (spec §17). Recipient = venue_id.';

-- =============================================================================
-- 2. RLS — a venue''s active staff read and mark-read their own notifications
-- =============================================================================

ALTER TABLE public.account_link_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_link_notifications" ON public.account_link_notifications;
CREATE POLICY "staff_select_link_notifications"
  ON public.account_link_notifications FOR SELECT
  USING (venue_id IN (SELECT public.current_staff_venue_ids()));

-- UPDATE is only ever used to set read_at; RLS cannot restrict to one column, so
-- both USING and WITH CHECK pin the row to the caller''s venue (the read_at value
-- itself is set by the API).
DROP POLICY IF EXISTS "staff_update_link_notifications" ON public.account_link_notifications;
CREATE POLICY "staff_update_link_notifications"
  ON public.account_link_notifications FOR UPDATE
  USING (venue_id IN (SELECT public.current_staff_venue_ids()))
  WITH CHECK (venue_id IN (SELECT public.current_staff_venue_ids()));

-- Inserts come only from the SECURITY DEFINER trigger below (and service_role);
-- clients are never granted INSERT.
DROP POLICY IF EXISTS "service_role_link_notifications" ON public.account_link_notifications;
CREATE POLICY "service_role_link_notifications"
  ON public.account_link_notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 3. Trigger — a cross-venue write audit row creates an owning-venue notification
-- =============================================================================

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
  -- Map the audited write action to a notification type and pick the booking
  -- snapshot to summarise (after_state for create/edit, before_state for cancel).
  IF NEW.action_type = 'created_booking' THEN
    v_type := 'cross_venue_booking_created';
    v_state := NEW.after_state;
  ELSIF NEW.action_type = 'cancelled_booking' THEN
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
    NEW.action_type IN ('created_booking', 'edited_booking', 'cancelled_booking')
    AND NEW.acting_venue_id <> NEW.owning_venue_id
  )
  EXECUTE PROCEDURE public.notify_owning_venue_of_cross_venue_write();

-- =============================================================================
-- End of linked-account notifications migration
-- =============================================================================
