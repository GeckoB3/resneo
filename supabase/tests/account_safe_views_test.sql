-- Resneo: customer-safe booking view test suite (P0-6 / AD8).
-- Spec: Docs/Resneo_Customer_Portal_World_Class_Plan.md §AD8 acceptance.
--
-- Proves the portal's database layer:
--   * a customer session reading bookings_account_safe with NO application
--     filter receives only their own rows (the view's WHERE is the control);
--   * the base table stays closed: any column outside the nine granted by
--     20270112120000 is 42501, and the nine granted columns return zero rows;
--   * one customer cannot reach another's booking by id through the view;
--   * the view is owner-rights (security_barrier, NOT security_invoker), so a
--     linter auto-fix cannot silently reduce it to the nine granted columns;
--   * the projection is EXACTLY the 55-column allowlist, so widening the view
--     is a reviewed decision that fails CI first (§6: adding a column here is
--     a security decision).
--
-- FIXTURE NOTE, and why this file exists apart from the two older suites: the
-- view's predicate is auth.uid(), the JWT **sub** claim, and guests.user_id is
-- an FK to auth.users. Both older suites authenticate by **email** claim and
-- never touch auth.users. This file inserts real auth.users rows (the
-- on_auth_user_created trigger will insert user_profiles from them; empty
-- metadata is fine) and sets role + sub claims.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

-- =============================================================================
-- Fixtures - seeded as the (superuser) session role, which bypasses RLS.
-- =============================================================================

-- Two customers. Minimal auth.users rows: id + email + empty metadata satisfy
-- the not-null set locally, and handle_new_user() tolerates absent metadata.
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
VALUES
  ('00000000-0000-0000-0000-00000000c0a1', 'customer-a@asv.test', '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-00000000c0b1', 'customer-b@asv.test', '{}'::jsonb, '{}'::jsonb);

-- One venue is enough: the boundary under test is customer-to-customer, not
-- venue-to-venue (the linked-accounts suite owns that boundary).
INSERT INTO venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-00000000c0f1', 'ASV Venue', 'asv-venue',
   'venue@asv.test', 'appointments', 'active', 'unified_scheduling');

-- Each customer's guest row is linked by user_id: the exact predicate the view
-- filters on.
INSERT INTO guests (id, venue_id, user_id, first_name, last_name, email, phone)
VALUES
  ('00000000-0000-0000-0000-00000000c0a2', '00000000-0000-0000-0000-00000000c0f1',
   '00000000-0000-0000-0000-00000000c0a1', 'Customer', 'A', 'customer-a@asv.test', '+447000000101'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-00000000c0f1',
   '00000000-0000-0000-0000-00000000c0b1', 'Customer', 'B', 'customer-b@asv.test', '+447000000102');

-- Two bookings for A (the "only A's rows" assertion needs a count above one to
-- mean anything) and one for B, carrying the PII columns the base-table grant
-- withholds so the view demonstrably serves them.
INSERT INTO bookings
  (id, venue_id, guest_id, booking_date, booking_time, booking_end_time,
   party_size, status, source, booking_model, special_requests, dietary_notes)
VALUES
  ('00000000-0000-0000-0000-00000000c0a5', '00000000-0000-0000-0000-00000000c0f1',
   '00000000-0000-0000-0000-00000000c0a2', '2026-06-01', '10:00', '10:30',
   1, 'Confirmed', 'online', 'unified_scheduling', 'Ground floor please', 'Nut allergy'),
  ('00000000-0000-0000-0000-00000000c0a6', '00000000-0000-0000-0000-00000000c0f1',
   '00000000-0000-0000-0000-00000000c0a2', '2026-06-08', '10:00', '10:30',
   1, 'Booked', 'online', 'unified_scheduling', NULL, NULL),
  ('00000000-0000-0000-0000-00000000c0b5', '00000000-0000-0000-0000-00000000c0f1',
   '00000000-0000-0000-0000-00000000c0b2', '2026-06-01', '11:00', '11:30',
   1, 'Confirmed', 'online', 'unified_scheduling', 'Window seat', NULL);

-- =============================================================================
-- 1-4: AD8's acceptance, as customer A's session (role + sub claim).
-- =============================================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000c0a1","email":"customer-a@asv.test"}';

-- 1. The view with NO application-level filter returns exactly A's rows,
--    PII included: the WHERE inside the view is the control being tested.
SELECT results_eq(
  $$ SELECT id::text, special_requests FROM bookings_account_safe ORDER BY id $$,
  $$ VALUES ('00000000-0000-0000-0000-00000000c0a5', 'Ground floor please'),
            ('00000000-0000-0000-0000-00000000c0a6', NULL) $$,
  'Unfiltered view read returns exactly the session customer''s bookings');

-- 2. The base table refuses any column outside the nine granted by
--    20270112120000 with 42501, not an empty result. Column privileges are
--    checked before RLS.
SELECT throws_ok(
  $$ SELECT special_requests FROM bookings
      WHERE id = '00000000-0000-0000-0000-00000000c0a5' $$,
  '42501', NULL,
  'A customer session cannot read ungranted bookings columns, even of their own booking');

-- 3. The nine granted columns pass the privilege check but no bookings SELECT
--    policy admits a non-staff, non-linked session, so the result is empty.
SELECT is_empty(
  $$ SELECT id, venue_id, calendar_id, practitioner_id, booking_date,
            booking_time, booking_end_time, status, updated_at
       FROM bookings $$,
  'The granted operational columns return zero base-table rows for a customer session');

-- 4. Another customer's booking is unreachable by id through the view.
SELECT is_empty(
  $$ SELECT id FROM bookings_account_safe
      WHERE id = '00000000-0000-0000-0000-00000000c0b5' $$,
  'A customer cannot read another user''s booking by id through the view');

-- =============================================================================
-- 5-6: view shape, back as superuser.
-- =============================================================================

RESET ROLE;

-- 5. Owner-rights on purpose: barrier set, invoker NOT set. The coalesce makes
--    a missing view fail this test rather than pass it vacuously. Precedent for
--    the hazard in both directions: bookings_linked_anonymised needed
--    security_invoker added (it lacked an ownership predicate); this view must
--    never gain it (its WHERE is the predicate, and invoker rights would reduce
--    reads to the nine granted columns).
SELECT ok(
  COALESCE((
    SELECT c.reloptions @> ARRAY['security_barrier=true']
       AND NOT (c.reloptions @> ARRAY['security_invoker=true']
                OR c.reloptions @> ARRAY['security_invoker=on'])
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'bookings_account_safe'
  ), false),
  'bookings_account_safe is security_barrier and NOT security_invoker');

-- 6. The projection is exactly the 55-column allowlist. A later
--    CREATE OR REPLACE VIEW that widens (or narrows) it fails here first.
SELECT results_eq(
  $$ SELECT column_name::text
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bookings_account_safe'
      ORDER BY column_name $$,
  ARRAY[
    'addons_total_duration_minutes', 'addons_total_price_pence', 'amount_paid_pence',
    'appointment_service_id', 'booking_date', 'booking_end_time', 'booking_model',
    'booking_time', 'booking_total_price_pence', 'calendar_id', 'cancellation_actor_type',
    'cancellation_deadline', 'cancellation_policy_snapshot', 'capacity_used',
    'checked_in_at', 'class_instance_id', 'class_recurring_reservation_id',
    'client_address_city', 'client_address_line1', 'client_address_line2',
    'client_address_postcode', 'client_arrived_at', 'collective_id',
    'collective_service_item_id', 'confirm_token_used_at', 'created_at',
    'deposit_amount_pence', 'deposit_status', 'dietary_notes', 'estimated_end_time',
    'event_session_id', 'experience_event_id', 'group_booking_id', 'guest_attendance_confirmed_at',
    'guest_id', 'id', 'location_type', 'occasion', 'party_size', 'payment_state',
    'person_label', 'practitioner_id', 'resource_id', 'service_id', 'service_item_id',
    'service_name_snapshot', 'service_variant_id', 'service_variant_name_snapshot',
    'source', 'special_requests', 'status', 'ticket_type_id', 'tip_amount_pence',
    'updated_at', 'venue_id'
  ],
  'The view projects exactly the 55-column allowlist');

SELECT * FROM finish();
ROLLBACK;
