-- ReserveNI: Linked Accounts cross-venue RLS test suite
-- Spec: Docs/reserveni-linked-accounts-spec.md §4.4, §11 (Phase 1, step 2).
--
-- Proves the security boundary of the feature:
--   * a linked venue gains visibility/action only while a link is `accepted`;
--   * time_only redaction nulls PII / service columns;
--   * PII visibility is gated independently of calendar visibility;
--   * action level (none / edit_existing / create_edit_cancel) is enforced;
--   * severance is immediate when a link leaves `accepted`;
--   * cross-venue writes are audited even without the linked_apply_* RPC.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(21);

-- =============================================================================
-- Fixtures — seeded as the (superuser) session role, which bypasses RLS.
-- =============================================================================

-- Two appointments-family venues. venue_low_id < venue_high_id, so A is "low".
INSERT INTO venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'RLS Venue A', 'rls-venue-a',
   'a@rls.test', 'appointments', 'active', 'practitioner_appointment'),
  ('00000000-0000-0000-0000-0000000000b1', 'RLS Venue B', 'rls-venue-b',
   'b@rls.test', 'appointments', 'active', 'practitioner_appointment');

-- One admin login per venue. current_staff_venue_ids() matches on email.
INSERT INTO staff (id, venue_id, email, name, role)
VALUES
  ('00000000-0000-0000-0000-0000000000a6',
   '00000000-0000-0000-0000-0000000000a1', 'admin-a@rls.test', 'Admin A', 'admin'),
  ('00000000-0000-0000-0000-0000000000b6',
   '00000000-0000-0000-0000-0000000000b1', 'admin-b@rls.test', 'Admin B', 'admin');

INSERT INTO guests (id, venue_id, name, email, phone)
VALUES
  ('00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a1', 'Guest A', 'guest-a@rls.test', '+447000000001'),
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000b1', 'Guest B', 'guest-b@rls.test', '+447000000002');

INSERT INTO practitioners (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', 'Pract A'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1', 'Pract B');

INSERT INTO appointment_services (id, venue_id, name, duration_minutes)
VALUES
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 'Service A', 30),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b1', 'Service B', 30);

INSERT INTO bookings
  (id, venue_id, guest_id, booking_date, booking_time, booking_end_time,
   party_size, status, source, practitioner_id, appointment_service_id, booking_model,
   special_requests, dietary_notes)
VALUES
  ('00000000-0000-0000-0000-0000000000a5',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
   '2026-06-01', '10:00', '10:30', 1, 'Confirmed', 'online',
   '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4',
   'practitioner_appointment', 'Wheelchair access please', 'Nut allergy'),
  ('00000000-0000-0000-0000-0000000000b5',
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
   '2026-06-01', '11:00', '11:30', 1, 'Confirmed', 'online',
   '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b4',
   'practitioner_appointment', NULL, NULL);

-- Accepted link, full mutual access (full_details / pii / edit_existing).
INSERT INTO account_links
  (id, venue_low_id, venue_high_id, requested_by_venue_id, status,
   low_grants_calendar, low_grants_pii, low_grants_act,
   high_grants_calendar, high_grants_pii, high_grants_act)
VALUES
  ('00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000a1', 'accepted',
   'full_details', true, 'edit_existing',
   'full_details', true, 'edit_existing');

-- =============================================================================
-- Test 1-3 — accepted link grants cross-venue visibility both directions.
-- =============================================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';

SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  1, 'Venue B staff can SELECT venue A bookings under an accepted full link');

SELECT is(
  (SELECT count(*) FROM guests WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  1, 'Venue B staff can SELECT venue A guests when PII is granted');

SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-a@rls.test"}';
SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000b1')::int,
  1, 'Visibility is symmetric — venue A staff can SELECT venue B bookings');

-- =============================================================================
-- Test 4-5 — edit_existing permits a cross-venue UPDATE and it is audited
--            even though no linked_apply_* RPC set the audit GUCs.
-- =============================================================================

SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';
SELECT is(
  (WITH upd AS (
     UPDATE bookings SET party_size = 3
     WHERE id = '00000000-0000-0000-0000-0000000000a5' RETURNING 1)
   SELECT count(*) FROM upd)::int,
  1, 'Venue B staff can UPDATE a venue A booking with an edit_existing grant');

RESET ROLE;
SELECT cmp_ok(
  (SELECT count(*) FROM account_link_audit_log
   WHERE owning_venue_id = '00000000-0000-0000-0000-0000000000a1'
     AND acting_venue_id = '00000000-0000-0000-0000-0000000000b1'
     AND action_type = 'edited_booking')::int,
  '>=', 1,
  'A direct cross-venue UPDATE (no RPC) still wrote a cross-venue audit row');

-- =============================================================================
-- Test 6-7 — act = none removes write access but leaves calendar visibility.
-- =============================================================================

RESET ROLE;
UPDATE account_links SET low_grants_act = 'none'
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';

SELECT is(
  (WITH upd AS (
     UPDATE bookings SET party_size = 5
     WHERE id = '00000000-0000-0000-0000-0000000000a5' RETURNING 1)
   SELECT count(*) FROM upd)::int,
  0, 'Venue B staff cannot UPDATE a venue A booking once act is reduced to none');

SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  1, 'Reducing act to none leaves full_details calendar visibility intact');

-- =============================================================================
-- Test 8-13 — time_only hides PII entirely and the anonymised view nulls it.
-- =============================================================================

RESET ROLE;
UPDATE account_links
SET low_grants_calendar = 'time_only', low_grants_pii = false, low_grants_act = 'none'
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';

SELECT is(
  (SELECT count(*) FROM guests WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  0, 'time_only viewers cannot SELECT venue A guests (PII forced off)');

SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  1, 'time_only viewers can still SELECT venue A bookings as bare time blocks');

SELECT is(
  (SELECT guest_id FROM bookings_linked_anonymised
   WHERE id = '00000000-0000-0000-0000-0000000000a5'),
  NULL::uuid,
  'bookings_linked_anonymised nulls guest_id for time_only viewers');

-- The anonymised view must also null service and free-text PII columns, even
-- though the underlying booking row carries real values for them.
SELECT is(
  (SELECT appointment_service_id FROM bookings_linked_anonymised
   WHERE id = '00000000-0000-0000-0000-0000000000a5'),
  NULL::uuid,
  'bookings_linked_anonymised nulls appointment_service_id for time_only viewers');

SELECT is(
  (SELECT special_requests FROM bookings_linked_anonymised
   WHERE id = '00000000-0000-0000-0000-0000000000a5'),
  NULL::text,
  'bookings_linked_anonymised nulls special_requests for time_only viewers');

SELECT is(
  (SELECT dietary_notes FROM bookings_linked_anonymised
   WHERE id = '00000000-0000-0000-0000-0000000000a5'),
  NULL::text,
  'bookings_linked_anonymised nulls dietary_notes for time_only viewers');

-- =============================================================================
-- Test 14-19 — severance: any non-accepted status cuts off cross-venue reads.
-- =============================================================================

-- revoked
RESET ROLE;
UPDATE account_links SET status = 'revoked', terminated_at = now()
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';

SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  0, 'Revoking a link immediately denies venue B staff all venue A bookings');

SELECT is(
  (SELECT count(*) FROM guests WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  0, 'Revoking a link immediately denies venue B staff all venue A guests');

-- expired
RESET ROLE;
UPDATE account_links SET status = 'expired'
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';
SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  0, 'An expired link denies venue B staff all venue A bookings');

-- suspended (subscription lapse) — visibility must also be cut, not retained
RESET ROLE;
UPDATE account_links SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';
SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  0, 'A suspended link denies venue B staff all venue A bookings');

-- rejected
RESET ROLE;
UPDATE account_links SET status = 'rejected'
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';
SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  0, 'A rejected link denies venue B staff all venue A bookings');

-- pending (never accepted) — a request grants nothing until accepted
RESET ROLE;
UPDATE account_links SET status = 'pending', terminated_at = NULL
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';
SELECT is(
  (SELECT count(*) FROM bookings WHERE venue_id = '00000000-0000-0000-0000-0000000000a1')::int,
  0, 'A pending (unaccepted) link grants venue B staff no venue A visibility');

-- =============================================================================
-- Test 20-21 — INSERT requires create_edit_cancel specifically.
-- =============================================================================

RESET ROLE;
UPDATE account_links
SET status = 'accepted', low_grants_calendar = 'full_details',
    low_grants_pii = true, low_grants_act = 'edit_existing'
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';

SELECT throws_ok(
  $$ INSERT INTO bookings
       (venue_id, guest_id, booking_date, booking_time, party_size, source, booking_model)
     VALUES ('00000000-0000-0000-0000-0000000000a1',
             '00000000-0000-0000-0000-0000000000a2',
             '2026-06-02', '09:00', 1, 'phone', 'practitioner_appointment') $$,
  '42501', NULL,
  'Venue B staff cannot INSERT a venue A booking with only edit_existing');

RESET ROLE;
UPDATE account_links SET low_grants_act = 'create_edit_cancel'
WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-b@rls.test"}';

SELECT lives_ok(
  $$ INSERT INTO bookings
       (venue_id, guest_id, booking_date, booking_time, party_size, source, booking_model)
     VALUES ('00000000-0000-0000-0000-0000000000a1',
             '00000000-0000-0000-0000-0000000000a2',
             '2026-06-03', '09:00', 1, 'phone', 'practitioner_appointment') $$,
  'Venue B staff can INSERT a venue A booking with create_edit_cancel');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
