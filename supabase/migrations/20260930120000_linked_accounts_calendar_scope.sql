-- Resneo: Linked Accounts — calendar-scoped (per-practitioner) sharing (spec §18).
--
-- A link direction can be limited to specific calendars of the *granting* venue
-- (the chair-rental persona: a stylist shares only their own column). NULL =
-- all calendars (backward-compatible; existing links read as "all").
--
-- Enforcement note: the cross-venue read route and the linked_apply_* RPCs run
-- as the service-role admin client, which BYPASSES RLS — so the authoritative
-- scope enforcement lives in the API/lib layer (linked-calendar route +
-- staff-booking-access). These RLS additions are defense-in-depth for any
-- user-JWT path and for the time_only anonymised view.

-- =============================================================================
-- 1. Scope columns (additive, nullable → all calendars)
-- =============================================================================

ALTER TABLE public.account_links
  ADD COLUMN IF NOT EXISTS low_grants_calendar_ids uuid[],
  ADD COLUMN IF NOT EXISTS high_grants_calendar_ids uuid[];

COMMENT ON COLUMN public.account_links.low_grants_calendar_ids IS
  '§18: calendar/practitioner ids venue_low limits venue_high to. NULL = all calendars.';
COMMENT ON COLUMN public.account_links.high_grants_calendar_ids IS
  '§18: calendar/practitioner ids venue_high limits venue_low to. NULL = all calendars.';

-- =============================================================================
-- 2. Scope helper — is calendar p_calendar of p_owner_venue in scope for the caller?
-- =============================================================================
-- Returns true when the calendar is within scope for SOME accepted link the
-- caller holds into the owner venue (owner-direction array NULL = all). A NULL
-- calendar (resource/event/class booking with no practitioner/calendar column)
-- is treated as allowed — the app layer resolves those; this is a backstop.

CREATE OR REPLACE FUNCTION public.link_calendar_allows(p_owner_venue uuid, p_calendar uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p_calendar IS NULL
    OR COALESCE(
      bool_or(ids IS NULL OR p_calendar = ANY(ids)),
      true -- no matching accepted link → not restricted here (other policies gate access)
    )
  FROM (
    SELECT CASE
             WHEN al.venue_low_id = p_owner_venue THEN al.low_grants_calendar_ids
             ELSE al.high_grants_calendar_ids
           END AS ids
    FROM public.account_links al
    WHERE al.status = 'accepted'
      AND (
        (al.venue_low_id  = p_owner_venue AND al.venue_high_id IN (SELECT current_staff_venue_ids()))
        OR
        (al.venue_high_id = p_owner_venue AND al.venue_low_id  IN (SELECT current_staff_venue_ids()))
      )
  ) g;
$$;

-- =============================================================================
-- 3. Bookings RLS policies — add the per-calendar scope to each cross-venue path
-- =============================================================================
-- COALESCE(calendar_id, practitioner_id): appointments-family venues key on
-- calendar_id; legacy venues on practitioner_id. The time_only anonymised view
-- inherits the SELECT policy (security_invoker), so it is scoped too.

DROP POLICY IF EXISTS "linked_venue_can_view_bookings" ON public.bookings;
CREATE POLICY "linked_venue_can_view_bookings" ON public.bookings
FOR SELECT USING (
  venue_id IN (SELECT current_staff_venue_ids())
  OR (
    public.link_calendar_grant(venue_id) IN ('time_only', 'full_details')
    AND public.link_calendar_allows(venue_id, COALESCE(calendar_id, practitioner_id))
  )
);

DROP POLICY IF EXISTS "linked_venue_can_edit_bookings" ON public.bookings;
CREATE POLICY "linked_venue_can_edit_bookings" ON public.bookings
FOR UPDATE USING (
  venue_id IN (SELECT current_staff_venue_ids())
  OR (
    public.link_action_grant(venue_id) IN ('edit_existing', 'create_edit_cancel')
    AND public.link_calendar_allows(venue_id, COALESCE(calendar_id, practitioner_id))
  )
)
WITH CHECK (
  venue_id IN (SELECT current_staff_venue_ids())
  OR (
    public.link_action_grant(venue_id) IN ('edit_existing', 'create_edit_cancel')
    AND public.link_calendar_allows(venue_id, COALESCE(calendar_id, practitioner_id))
  )
);

DROP POLICY IF EXISTS "linked_venue_can_insert_bookings" ON public.bookings;
CREATE POLICY "linked_venue_can_insert_bookings" ON public.bookings
FOR INSERT WITH CHECK (
  venue_id IN (SELECT current_staff_venue_ids())
  OR (
    public.link_action_grant(venue_id) = 'create_edit_cancel'
    AND public.link_calendar_allows(venue_id, COALESCE(calendar_id, practitioner_id))
  )
);

DROP POLICY IF EXISTS "linked_venue_can_delete_bookings" ON public.bookings;
CREATE POLICY "linked_venue_can_delete_bookings" ON public.bookings
FOR DELETE USING (
  venue_id IN (SELECT current_staff_venue_ids())
  OR (
    public.link_action_grant(venue_id) = 'create_edit_cancel'
    AND public.link_calendar_allows(venue_id, COALESCE(calendar_id, practitioner_id))
  )
);

-- =============================================================================
-- End of calendar-scope migration
-- =============================================================================
