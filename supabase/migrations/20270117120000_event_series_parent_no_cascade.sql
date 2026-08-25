-- EV-1 (Resneo_Codebase_Audit_August_2026.md, the audit's only Critical).
--
-- `experience_events.parent_event_id` was declared in 20260327000001 as
--   parent_event_id uuid REFERENCES experience_events(id) ON DELETE CASCADE
-- and never altered since. Since the C8 fix every multi-date create designates
-- the EARLIEST occurrence as the series parent and points all siblings at it, so
-- that CASCADE turned "delete the week-1 card" into "delete the entire series".
--
-- The failure was silent and unrecoverable: deleting the parent removed every
-- sibling row, cascaded their `event_ticket_types`, and SET NULL'd their
-- bookings' `experience_event_id`. Confirmed, often prepaid bookings stayed
-- 'Booked' but lost their event link, disappearing from rosters and capacity
-- counts. No guest was cancelled, refunded or notified. The delete guard only
-- ever counted bookings on the target row, so nothing blocked it.
--
-- SET NULL rather than RESTRICT, deliberately. RESTRICT would refuse to delete a
-- parent that has any children at all, which breaks the legitimate and common
-- action of removing one occurrence from a series. SET NULL keeps the siblings
-- alive; the application re-parents them to the next surviving occurrence before
-- the delete (`reparent-event-series.ts`) so the series stays grouped, because
-- the catalogue keys a series on `parent_event_id ?? id`
-- (`event-ticket-engine.ts`). SET NULL is the backstop for anything that deletes
-- a parent without going through those routes.
--
-- Expand-only: this relaxes delete behaviour, so the old code is safe against
-- the new schema for the window between the migration and the deploy.

DO $$
DECLARE
  v_constraint text;
  v_attnum smallint;
BEGIN
  SELECT attnum INTO v_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.experience_events'::regclass
    AND attname = 'parent_event_id'
    AND NOT attisdropped;

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'experience_events.parent_event_id not found';
  END IF;

  -- Find the self-referencing FK on that column by shape, not by name: the
  -- original was created inline and carries whatever name Postgres generated.
  SELECT con.conname INTO v_constraint
  FROM pg_constraint con
  WHERE con.conrelid = 'public.experience_events'::regclass
    AND con.confrelid = 'public.experience_events'::regclass
    AND con.contype = 'f'
    AND con.conkey = ARRAY[v_attnum]::smallint[];

  IF v_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.experience_events DROP CONSTRAINT %I',
      v_constraint
    );
  END IF;
END $$;

ALTER TABLE public.experience_events
  ADD CONSTRAINT experience_events_parent_event_id_fkey
  FOREIGN KEY (parent_event_id)
  REFERENCES public.experience_events(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT experience_events_parent_event_id_fkey ON public.experience_events IS
  'EV-1: SET NULL, never CASCADE. Deleting a series parent must not delete its occurrences or orphan their sold bookings.';
