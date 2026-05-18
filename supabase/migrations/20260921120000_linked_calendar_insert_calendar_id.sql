-- =============================================================================
-- Linked Accounts: cross-venue booking insert must support unified scheduling.
--
-- linked_apply_booking_insert originally wrote only `practitioner_id`. Venues on
-- the appointments family key their calendar columns on `unified_calendars` and
-- their bookings on `calendar_id`; a booking created with only `practitioner_id`
-- never lands on the owning venue's calendar grid. This recreates the function
-- so the caller can supply `calendar_id` for unified-scheduling venues.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.linked_apply_booking_insert(
  p_actor_user_id uuid,
  p_acting_venue_id uuid,
  p_link_id uuid,
  p_row jsonb
)
RETURNS bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result bookings;
BEGIN
  PERFORM set_config('reserveni.linked_action_venue', p_acting_venue_id::text, true);
  PERFORM set_config('reserveni.linked_action_user', COALESCE(p_actor_user_id::text, ''), true);
  PERFORM set_config('reserveni.linked_action_link', COALESCE(p_link_id::text, ''), true);

  INSERT INTO bookings (
    venue_id, guest_id, booking_date, booking_time, booking_end_time,
    party_size, status, source, practitioner_id, calendar_id, appointment_service_id,
    special_requests, dietary_notes, booking_model, created_by_linked_venue_id
  )
  VALUES (
    (p_row->>'venue_id')::uuid,
    (p_row->>'guest_id')::uuid,
    (p_row->>'booking_date')::date,
    (p_row->>'booking_time')::time,
    NULLIF(p_row->>'booking_end_time', '')::time,
    COALESCE((p_row->>'party_size')::int, 1),
    COALESCE((p_row->>'status')::booking_status, 'Confirmed'),
    COALESCE((p_row->>'source')::booking_source, 'online'),
    NULLIF(p_row->>'practitioner_id', '')::uuid,
    NULLIF(p_row->>'calendar_id', '')::uuid,
    NULLIF(p_row->>'appointment_service_id', '')::uuid,
    p_row->>'special_requests',
    p_row->>'dietary_notes',
    COALESCE(p_row->>'booking_model', 'unified_scheduling'),
    p_acting_venue_id
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.linked_apply_booking_insert(uuid, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.linked_apply_booking_insert(uuid, uuid, uuid, jsonb) TO service_role;
