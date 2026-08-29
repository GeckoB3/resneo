-- P2-3a: close the appointment reschedule race, without touching staff.
--
-- THE HOLE. `enforce_cde_capacity` (20261225120000) guards class, event and
-- resource bookings and explicitly excludes appointments: its trigger fires
-- only on `experience_event_id, class_instance_id, resource_id`. So the
-- appointment reschedule path reads availability, then writes, and two guests
-- rescheduling at once can both pass the read and both write the same slot.
-- `createAppointmentSlotRecheck` narrows that window and its own comment says
-- it does not close it.
--
-- WHY THIS IS A FUNCTION AND NOT A TRIGGER, which corrects the task. P2-3a
-- specified "a partial unique index, or extend enforce_cde_capacity to
-- appointment rows". Both are table-wide: they fire for every writer. Measured
-- on production 2026-08-29 (scripts/sql/measure-appointment-concurrency.sql),
-- one calendar carries 42 colliding bookings across 21 shared start times, 22
-- of them in the future, involving 15 distinct guests, spread over six months.
-- Their source is 22 `phone` and 20 `import`: **not one was booked online**.
-- A table-wide guard would reject that salon's next phone booking and refuse a
-- reschedule on the 22 future rows, so the venue would experience the fix as an
-- outage in a workflow it has used since May. Meanwhile the race this closes
-- has produced zero production rows.
--
-- So the guard lives where the race is: the guest reschedule path calls this,
-- and nothing else does. Staff, imports and the public create flow are
-- untouched because they do not call it.
--
-- WHY THE WRITE IS IN HERE. The lock, the capacity check and the write must
-- share one transaction or the race reopens between them, and PostgREST gives
-- one transaction per request. A function that only checked would release its
-- lock before the caller's UPDATE arrived.
--
-- THE RULE IT ENFORCES is `unified_calendars.parallel_clients`, which is the
-- same column `appointment-engine.ts:637` reads to decide what to offer. It
-- cannot disagree with the engine whatever that column says, and correcting a
-- miscofigured calendar later corrects both together.
--
-- Deliberately EXACT-SLOT, not overlap. Two guests racing for one offered slot
-- pick the same `booking_time`, so that is the collision to prevent; and an
-- overlap rule would need `processing_time_blocks` reconstructed in SQL, where
-- 12 production bookings have a non-contiguous busy span and a naive span check
-- would be stricter than the engine.

CREATE OR REPLACE FUNCTION public.claim_appointment_slot(
  p_booking_id uuid,
  p_calendar_id uuid,
  p_practitioner_id uuid,
  p_booking_date date,
  p_booking_time time,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap int;
  v_taken int;
  v_owner uuid := COALESCE(p_calendar_id, p_practitioner_id);
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'APPOINTMENT_SLOT: no calendar or practitioner given'
      USING ERRCODE = '22023';
  END IF;

  -- Serialise every claim on this calendar. Held to commit, which is what
  -- makes the count below and the update after it one indivisible decision.
  PERFORM pg_advisory_xact_lock(hashtextextended('appt_slot:' || v_owner::text, 0));

  -- The engine's own cap. A legacy practitioner row has no such column, so it
  -- falls back to one, which is what the engine assumes for that path too.
  SELECT GREATEST(1, COALESCE(uc.parallel_clients, 1)) INTO v_cap
  FROM public.unified_calendars uc
  WHERE uc.id = p_calendar_id;
  v_cap := COALESCE(v_cap, 1);

  -- Everything already holding this exact slot, excluding the booking being
  -- moved so that rescheduling a booking onto its own time is not a conflict.
  SELECT COUNT(*) INTO v_taken
  FROM public.bookings b
  WHERE b.id <> p_booking_id
    AND b.booking_date = p_booking_date
    AND b.booking_time = p_booking_time
    AND b.status::text IN ('Pending', 'Booked', 'Confirmed', 'Seated')
    AND (
      (p_calendar_id IS NOT NULL AND b.calendar_id = p_calendar_id)
      OR (p_calendar_id IS NULL AND b.practitioner_id = p_practitioner_id)
    );

  IF v_taken >= v_cap THEN
    -- 23P01 exclusion_violation, matching enforce_cde_capacity, so callers can
    -- map one SQLSTATE to their 409 regardless of which guard raised it.
    RAISE EXCEPTION 'APPOINTMENT_SLOT: slot already taken'
      USING ERRCODE = '23P01';
  END IF;

  /*
    The patch carries only what the caller means to change, and "absent" must
    mean "leave alone" while "present and null" must mean "set to null".
    COALESCE cannot express that difference, and the difference is real here:
    the caller sets `service_variant_name_snapshot` to null deliberately when
    the service changes, and COALESCE would have silently kept the old name.
    `p_patch ? 'key'` tests presence, which is the semantic the TypeScript
    conditional spreads actually have.

    The columns are named rather than applied generically, so a column that is
    renamed fails here loudly instead of being skipped.
  */
  RETURN QUERY
  UPDATE public.bookings b SET
    booking_date = p_booking_date,
    booking_time = p_booking_time,
    calendar_id = p_calendar_id,
    practitioner_id = p_practitioner_id,
    service_item_id = NULLIF(p_patch->>'service_item_id', '')::uuid,
    appointment_service_id = NULLIF(p_patch->>'appointment_service_id', '')::uuid,
    party_size = COALESCE((p_patch->>'party_size')::int, b.party_size),
    estimated_end_time = CASE WHEN p_patch ? 'estimated_end_time'
      THEN (p_patch->>'estimated_end_time')::timestamptz ELSE b.estimated_end_time END,
    booking_end_time = CASE WHEN p_patch ? 'booking_end_time'
      THEN (p_patch->>'booking_end_time')::time ELSE b.booking_end_time END,
    service_variant_id = CASE WHEN p_patch ? 'service_variant_id'
      THEN NULLIF(p_patch->>'service_variant_id', '')::uuid ELSE b.service_variant_id END,
    service_name_snapshot = CASE WHEN p_patch ? 'service_name_snapshot'
      THEN p_patch->>'service_name_snapshot' ELSE b.service_name_snapshot END,
    service_variant_name_snapshot = CASE WHEN p_patch ? 'service_variant_name_snapshot'
      THEN p_patch->>'service_variant_name_snapshot' ELSE b.service_variant_name_snapshot END,
    processing_time_blocks = CASE WHEN p_patch ? 'processing_time_blocks'
      THEN p_patch->'processing_time_blocks' ELSE b.processing_time_blocks END,
    cancellation_deadline = CASE WHEN p_patch ? 'cancellation_deadline'
      THEN (p_patch->>'cancellation_deadline')::timestamptz ELSE b.cancellation_deadline END,
    cancellation_policy_snapshot = CASE WHEN p_patch ? 'cancellation_policy_snapshot'
      THEN p_patch->'cancellation_policy_snapshot' ELSE b.cancellation_policy_snapshot END,
    updated_at = COALESCE((p_patch->>'updated_at')::timestamptz, now())
  WHERE b.id = p_booking_id
    -- The caller's optimistic-concurrency check, kept here so it stays part of
    -- the same atomic step rather than becoming a second round trip.
    AND b.updated_at = p_expected_updated_at
  RETURNING b.id;
END;
$$;

COMMENT ON FUNCTION public.claim_appointment_slot(uuid, uuid, uuid, date, time, timestamptz, jsonb) IS
  'P2-3a - advisory-lock-serialised appointment slot claim for the GUEST reschedule path only. '
  'Raises 23P01 when the target slot already holds parallel_clients bookings. '
  'Deliberately not a trigger: production data shows every existing collision came from phone or '
  'import, never from an online booking, so a table-wide guard would break staff workflow.';

-- The guest reschedule runs on the service role, which bypasses RLS and needs
-- no grant. Nothing client-facing may call this: it writes booking rows and
-- performs no authorisation of its own, relying on the caller having already
-- established that the actor may act on the booking.
REVOKE ALL ON FUNCTION public.claim_appointment_slot(uuid, uuid, uuid, date, time, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_appointment_slot(uuid, uuid, uuid, date, time, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.claim_appointment_slot(uuid, uuid, uuid, date, time, timestamptz, jsonb) FROM authenticated;

-- Supports the count above; the slot lookup is by calendar, date and time.
CREATE INDEX IF NOT EXISTS idx_bookings_calendar_slot
  ON public.bookings (calendar_id, booking_date, booking_time)
  WHERE calendar_id IS NOT NULL;
