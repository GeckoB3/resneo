-- =============================================================================
-- P0-6: customer-safe bookings view (AD8)
-- Docs/Resneo_Customer_Portal_World_Class_Plan.md §AD8, closes G12, unblocks G8b.
-- =============================================================================
--
-- Why a view and not an RLS policy on bookings: 20270112120000 deliberately
-- narrowed the `authenticated` column grant on bookings to nine operational
-- columns, because `authenticated` is the same role staff and linked venues use
-- (over PostgREST AND Realtime). An RLS policy for customers would only be
-- useful if the other 46 columns were granted back, reopening C5/N5. A view
-- owned by postgres gives customers the columns they need without giving them
-- to every other authenticated principal. It mirrors guests_account_safe
-- (20260810120000), the established, audited pattern for customer-safe reads.
--
-- Deliberately WITHOUT security_invoker: the view runs as its owner, so neither
-- bookings RLS nor the nine-column grant applies to its reads. Its own WHERE
-- clause is the ownership predicate. The cautionary precedent is
-- bookings_linked_anonymised (20260922120000), which shipped security_barrier
-- with NO ownership predicate and leaked every venue's blocks; this view is
-- only safe because the WHERE below exists. Never remove it.
--
-- The column list is an allowlist (55 columns). Absent by construction:
-- internal_notes, confirm_token_hash, stripe_payment_intent_id,
-- created_by_staff_id, cancelled_by_staff_id, created_by_linked_venue_id,
-- last_modified_by_linked_venue_id, stripe_terminal_location_id,
-- suppress_import_comms, the reminder-sent timestamps and the staff
-- operational timestamps. Adding a column to bookings does not add it here,
-- and supabase/tests/account_safe_views_test.sql pins the exact projection,
-- so widening it is a reviewed decision (§6 calls it a security decision).

CREATE OR REPLACE VIEW public.bookings_account_safe
WITH (security_barrier = true) AS
SELECT
  b.id, b.venue_id, b.guest_id,
  b.booking_date, b.booking_time, b.booking_end_time, b.estimated_end_time,
  b.party_size, b.status, b.booking_model, b.source,
  b.deposit_status, b.deposit_amount_pence, b.payment_state,
  b.cancellation_deadline, b.cancellation_policy_snapshot, b.cancellation_actor_type,
  b.special_requests, b.dietary_notes, b.occasion, b.person_label,
  b.group_booking_id, b.class_instance_id, b.experience_event_id, b.resource_id,
  b.event_session_id, b.ticket_type_id, b.class_recurring_reservation_id,
  b.collective_id, b.collective_service_item_id, b.capacity_used,
  b.practitioner_id, b.calendar_id,
  b.service_id, b.service_item_id, b.service_variant_id, b.appointment_service_id,
  b.service_name_snapshot, b.service_variant_name_snapshot,
  b.booking_total_price_pence, b.amount_paid_pence,
  b.addons_total_price_pence, b.addons_total_duration_minutes, b.tip_amount_pence,
  b.location_type,
  b.client_address_line1, b.client_address_line2,
  b.client_address_city, b.client_address_postcode,
  b.guest_attendance_confirmed_at, b.checked_in_at, b.client_arrived_at,
  b.confirm_token_used_at,
  b.created_at, b.updated_at
FROM public.bookings b
WHERE b.guest_id IN (SELECT id FROM public.guests WHERE user_id = auth.uid());

COMMENT ON VIEW public.bookings_account_safe IS
  'Customer-safe booking projection. Runs as owner (NO security_invoker) so it is not '
  'blocked by bookings RLS or the authenticated column grants from 20270112120000. '
  'Its WHERE clause is the ownership predicate and must never be removed. '
  'Setting security_invoker=true would silently reduce this view to the 9 granted columns.';

GRANT SELECT ON public.bookings_account_safe TO authenticated;

-- Explicit, not assumed: hosted Supabase applies project-level default
-- privileges outside the migration history, so "anon was never granted" is not
-- a fact the migration can rely on. The pgTAP suite checks that authenticated
-- HAS the grant; this line is the only thing that ensures anon does not.
REVOKE ALL ON public.bookings_account_safe FROM anon;

-- =============================================================================
-- Audit RPC for table/view grants, mirroring audit_client_executable_functions
-- (20270109120000). scripts/check-table-grants.mjs calls this over PostgREST
-- with the service key, because migrations do not reproduce the hosted
-- permission environment: hosted Supabase grants anon and authenticated outside
-- the migration history, so the only trustworthy answer comes from the live
-- database. Without this, the "verify hosted grants" ritual has no tool for
-- tables and views (check:function-grants covers functions only).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_client_table_grants()
RETURNS TABLE (
  relation_name text,
  relation_kind text,
  role_name text,
  table_privileges text[],
  column_select_columns text[]
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH rels AS (
    SELECT c.oid, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
  ),
  roles AS (SELECT unnest(ARRAY['anon', 'authenticated']) AS role_name)
  SELECT
    r.relname::text,
    CASE r.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view'
                   WHEN 'm' THEN 'matview' ELSE 'partitioned' END,
    ro.role_name,
    (SELECT coalesce(array_agg(p ORDER BY p), '{}')
       FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
      WHERE has_table_privilege(ro.role_name, r.oid, p)),
    -- Column-ONLY select grants: listed only when relation-wide SELECT is
    -- absent, because has_column_privilege is true for every column otherwise.
    CASE WHEN has_table_privilege(ro.role_name, r.oid, 'SELECT') THEN '{}'::text[]
         ELSE (SELECT coalesce(array_agg(a.attname::text ORDER BY a.attname), '{}')
                 FROM pg_attribute a
                WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                  AND has_column_privilege(ro.role_name, r.oid, a.attnum, 'SELECT'))
    END
  FROM rels r
  CROSS JOIN roles ro
  WHERE has_table_privilege(ro.role_name, r.oid, 'SELECT')
     OR has_table_privilege(ro.role_name, r.oid, 'INSERT')
     OR has_table_privilege(ro.role_name, r.oid, 'UPDATE')
     OR has_table_privilege(ro.role_name, r.oid, 'DELETE')
     OR EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                   AND has_column_privilege(ro.role_name, r.oid, a.attnum, 'SELECT'))
  ORDER BY 1, 3;
$$;

-- The audit itself must not be client-callable.
REVOKE ALL ON FUNCTION public.audit_client_table_grants() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.audit_client_table_grants() TO service_role;

-- ---------------------------------------------------------------------------
-- VERIFICATION - run against the environment just migrated.
--
--   -- authenticated can read, anon cannot:
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_name = 'bookings_account_safe';
--
--   -- owner-rights, barrier on, invoker off:
--   SELECT reloptions FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname = 'bookings_account_safe';
--   -- expect {security_barrier=true} and NO security_invoker entry.
--
-- Hosted grants are also checked by scripts/check-table-grants.mjs, which reads
-- the live database rather than this file.
-- ---------------------------------------------------------------------------
