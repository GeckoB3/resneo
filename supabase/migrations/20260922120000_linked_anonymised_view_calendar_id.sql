-- =============================================================================
-- Linked Accounts: harden and complete the time_only redaction view.
--
-- Two corrections to `bookings_linked_anonymised` (introduced in
-- 20260919120000) so it can safely back the linked-calendar read path:
--
--  1. security_invoker = true. The view was created with security_barrier only.
--     A plain view runs with the privileges of its owner, so the base table's
--     RLS would NOT be evaluated against the querying user — a time_only viewer
--     reading the view would see EVERY venue's time blocks. security_invoker
--     makes the view run as the caller, so `linked_venue_can_view_bookings`
--     (RLS on `bookings`) is enforced exactly as §4.4 intends.
--
--  2. Expose `calendar_id`. Appointments-family venues key their bookings on
--     `calendar_id` (unified scheduling), not `practitioner_id`. Without it a
--     time_only viewer's bookings cannot be mapped onto their calendar column
--     and silently vanish from the grid. `calendar_id` is not PII — it only
--     identifies which calendar a block belongs to — so exposing it is safe.
--
-- DROP + CREATE (rather than CREATE OR REPLACE) because the new column is not
-- appended last. The view has no dependents.
-- =============================================================================

DROP VIEW IF EXISTS public.bookings_linked_anonymised;

CREATE VIEW public.bookings_linked_anonymised
WITH (security_invoker = true, security_barrier = true) AS
SELECT
  b.id,
  b.venue_id,
  b.practitioner_id,
  b.calendar_id,
  b.booking_date,
  b.booking_time,
  b.booking_end_time,
  b.status,
  NULL::uuid AS guest_id,
  NULL::uuid AS appointment_service_id,
  NULL::text AS dietary_notes,
  NULL::text AS occasion,
  NULL::text AS special_requests
FROM public.bookings b;

COMMENT ON VIEW public.bookings_linked_anonymised IS
  'Time-only linked-calendar source: bare time blocks per calendar, all PII '
  'columns nulled. security_invoker so the base table RLS applies to the caller.';

GRANT SELECT ON public.bookings_linked_anonymised TO authenticated, anon;
