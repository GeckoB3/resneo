-- Resneo: the host's calendar writes (20270216160000; plan §6.7, Appendix D; RT2-17, D6, D29).
--
-- Proves, on a replicas-model collective:
--   * a member cannot use the offering function, and the coded refusals come in the plan's order:
--     not a member, calendar at another venue, service not ready there;
--   * the host adds the member's replica to a member calendar once, stamped and audited;
--   * removing it with future bookings returns them without guest fields and writes nothing, and
--     goes through once acknowledged;
--   * the host's own calendar gets the master;
--   * calendar values follow the master's flags: a price only while the price flag is on, never a
--     name on an offered service, a clear always; a card-hold deposit under 100 pence is refused;
--   * a venue outside the collective cannot set another venue's values; values are audited.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(17);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000002a0f01', 'Cal Host', 'cal-host', 'host@cal.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000002a0f02', 'Cal Member', 'cal-member', 'member@cal.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000002a0f03', 'Cal Outsider', 'cal-outsider', 'outsider@cal.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000002a0c01', 'cal-collective', 'Cal Collective',
        '00000000-0000-0000-0000-0000002a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000002a0e01', '00000000-0000-0000-0000-0000002a0c01', '00000000-0000-0000-0000-0000002a0f01', 'active'),
  ('00000000-0000-0000-0000-0000002a0e02', '00000000-0000-0000-0000-0000002a0c01', '00000000-0000-0000-0000-0000002a0f02', 'active');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence, staff_may_customize_price)
VALUES
  ('00000000-0000-0000-0000-0000002a0501', '00000000-0000-0000-0000-0000002a0f01', 'Reiki', 60, 5000, true),
  ('00000000-0000-0000-0000-0000002a0502', '00000000-0000-0000-0000-0000002a0f01', 'Not offered', 30, 2000, false);
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-0000002a0d01', '00000000-0000-0000-0000-0000002a0f01', 'Host room'),
  ('00000000-0000-0000-0000-0000002a0d02', '00000000-0000-0000-0000-0000002a0f02', 'Member room'),
  ('00000000-0000-0000-0000-0000002a0d03', '00000000-0000-0000-0000-0000002a0f03', 'Outsider room');

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000002a0c01', '00000000-0000-0000-0000-0000002a0501',
  '00000000-0000-0000-0000-0000002a0f01', NULL);
CREATE TEMP TABLE item AS SELECT id FROM public.collective_service_items WHERE master_service_id = '00000000-0000-0000-0000-0000002a0501';

-- Before the first apply the member has no replica yet.
SELECT throws_ok(
  format($$ SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', %L, '00000000-0000-0000-0000-0000002a0f02',
            '00000000-0000-0000-0000-0000002a0d02', 'assign', '00000000-0000-0000-0000-0000002a0f01', NULL) $$, (SELECT id FROM item)),
  'P0001', NULL, 'COLLECTIVE_REPLICA_NOT_READY before the member''s copy exists');

SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas WHERE venue_id = '00000000-0000-0000-0000-0000002a0f02';
CREATE TEMP TABLE replica AS SELECT replica_service_id AS id FROM public.collective_service_replicas WHERE venue_id = '00000000-0000-0000-0000-0000002a0f02';

CREATE TEMP TABLE refusals AS
SELECT name, r FROM (VALUES
  ('member_actor', format($$ SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', %L, '00000000-0000-0000-0000-0000002a0f02', '00000000-0000-0000-0000-0000002a0d02', 'assign', '00000000-0000-0000-0000-0000002a0f02', NULL) $$, (SELECT id FROM item))),
  ('outsider_venue', format($$ SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', %L, '00000000-0000-0000-0000-0000002a0f03', '00000000-0000-0000-0000-0000002a0d03', 'assign', '00000000-0000-0000-0000-0000002a0f01', NULL) $$, (SELECT id FROM item))),
  ('wrong_calendar', format($$ SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', %L, '00000000-0000-0000-0000-0000002a0f02', '00000000-0000-0000-0000-0000002a0d01', 'assign', '00000000-0000-0000-0000-0000002a0f01', NULL) $$, (SELECT id FROM item)))
) v(name, r);

CREATE OR REPLACE FUNCTION pg_temp.error_prefix(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  RETURN split_part(SQLERRM, ':', 1);
END $$;

SELECT is((SELECT pg_temp.error_prefix(r) FROM refusals WHERE name = 'member_actor'), 'COLLECTIVE_NOT_HOST', 'A member cannot change the collective''s calendars');
SELECT is((SELECT pg_temp.error_prefix(r) FROM refusals WHERE name = 'outsider_venue'), 'COLLECTIVE_VENUE_NOT_MEMBER', 'A venue outside the collective is refused');
SELECT is((SELECT pg_temp.error_prefix(r) FROM refusals WHERE name = 'wrong_calendar'), 'COLLECTIVE_CALENDAR_NOT_AT_VENUE', 'A calendar at another venue is refused');

-- Assign.
CREATE TEMP TABLE assigned AS
SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', (SELECT id FROM item), '00000000-0000-0000-0000-0000002a0f02',
  '00000000-0000-0000-0000-0000002a0d02', 'assign', '00000000-0000-0000-0000-0000002a0f01', NULL) AS r;
SELECT is(
  (SELECT array[a.service_item_id::text, a.updated_by_venue_id::text, (r->>'written')] FROM assigned, public.calendar_service_assignments a
   WHERE a.id = (r->>'assignment_id')::uuid),
  array[(SELECT id FROM replica)::text, '00000000-0000-0000-0000-0000002a0f01', 'true'],
  'The host puts the member''s copy on the member''s calendar, stamped');
SELECT is(
  (public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', (SELECT id FROM item), '00000000-0000-0000-0000-0000002a0f02',
    '00000000-0000-0000-0000-0000002a0d02', 'assign', '00000000-0000-0000-0000-0000002a0f01', NULL)->>'written'),
  'false', 'Assigning again writes nothing');
CREATE TEMP TABLE host_assigned AS
SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', (SELECT id FROM item),
  '00000000-0000-0000-0000-0000002a0f01', '00000000-0000-0000-0000-0000002a0d01', 'assign', '00000000-0000-0000-0000-0000002a0f01', NULL) AS r;
SELECT is(
  (SELECT service_item_id FROM public.calendar_service_assignments WHERE id = (SELECT (r->>'assignment_id')::uuid FROM host_assigned)),
  '00000000-0000-0000-0000-0000002a0501'::uuid, 'The host''s own calendar gets the master');

-- Unassign with a future booking.
INSERT INTO public.guests (id, venue_id, first_name, last_name, email)
VALUES ('00000000-0000-0000-0000-0000002a0a01', '00000000-0000-0000-0000-0000002a0f02', 'Pg', 'Tap', 'pgtap@cal.test');
INSERT INTO public.bookings (venue_id, guest_id, calendar_id, service_item_id, booking_date, booking_time, booking_end_time,
  party_size, status, source, booking_model)
VALUES ('00000000-0000-0000-0000-0000002a0f02', '00000000-0000-0000-0000-0000002a0a01', '00000000-0000-0000-0000-0000002a0d02',
  (SELECT id FROM replica), DATE '2031-01-10', TIME '10:00', TIME '11:00', 1, 'Booked'::booking_status, 'online'::booking_source,
  'unified_scheduling'::booking_model);

CREATE TEMP TABLE unassign_ask AS
SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', (SELECT id FROM item), '00000000-0000-0000-0000-0000002a0f02',
  '00000000-0000-0000-0000-0000002a0d02', 'unassign', '00000000-0000-0000-0000-0000002a0f01', NULL) AS r;
SELECT is(
  (SELECT array[r->>'written', jsonb_array_length(r->'affected_bookings')::text, (r->'affected_bookings'->0 ? 'guest_id')::text,
                (SELECT count(*)::text FROM public.calendar_service_assignments WHERE calendar_id = '00000000-0000-0000-0000-0000002a0d02')]
   FROM unassign_ask),
  array['false', '1', 'false', '1'], 'Removal with a future booking lists it, with no guest fields, and writes nothing');
SELECT is(
  (public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', (SELECT id FROM item), '00000000-0000-0000-0000-0000002a0f02',
    '00000000-0000-0000-0000-0000002a0d02', 'unassign', '00000000-0000-0000-0000-0000002a0f01', NULL, true)->>'written'),
  'true', 'Once acknowledged, the removal goes through');
SELECT is(
  (SELECT array[(SELECT count(*) FROM public.calendar_service_assignments WHERE calendar_id = '00000000-0000-0000-0000-0000002a0d02'),
                (SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-0000002a0c01' AND event_type IN ('calendar_assigned', 'calendar_unassigned'))]::int[]),
  array[0, 3], 'The row is gone, and every write is audited');

-- Values. Put the service back on the member calendar first.
SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000002a0c01', (SELECT id FROM item), '00000000-0000-0000-0000-0000002a0f02',
  '00000000-0000-0000-0000-0000002a0d02', 'assign', '00000000-0000-0000-0000-0000002a0f01', NULL);

SELECT is(
  (public.collective_set_calendar_values('00000000-0000-0000-0000-0000002a0d02', (SELECT id FROM replica), '{"custom_price_pence": 4500}'::jsonb,
    '00000000-0000-0000-0000-0000002a0f01', NULL)->'after'->>'custom_price_pence'),
  '4500', 'The host sets a member calendar''s price while the price flag is on');
SELECT throws_ok(
  format($$ SELECT public.collective_set_calendar_values('00000000-0000-0000-0000-0000002a0d02', %L, '{"custom_name": "Mine"}'::jsonb, '00000000-0000-0000-0000-0000002a0f02', NULL) $$, (SELECT id FROM replica)),
  'P0001', NULL, 'D29: no calendar name on an offered service');
SELECT throws_ok(
  format($$ SELECT public.collective_set_calendar_values('00000000-0000-0000-0000-0000002a0d02', %L, '{"custom_price_pence": 1}'::jsonb, '00000000-0000-0000-0000-0000002a0f03', NULL) $$, (SELECT id FROM replica)),
  'P0001', NULL, 'A venue outside the collective cannot set the values');
SELECT is(
  (SELECT count(*)::int FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-0000002a0c01' AND event_type = 'values_changed'),
  1, 'A value change is audited');

-- The host turns the price flag off: a set price is refused, a clear still works.
UPDATE public.service_items SET staff_may_customize_price = false WHERE id = '00000000-0000-0000-0000-0000002a0501';
SELECT throws_ok(
  format($$ SELECT public.collective_set_calendar_values('00000000-0000-0000-0000-0000002a0d02', %L, '{"custom_price_pence": 4000}'::jsonb, '00000000-0000-0000-0000-0000002a0f01', NULL) $$, (SELECT id FROM replica)),
  'P0001', NULL, 'With the flag off a price cannot be set');
SELECT is(
  (public.collective_set_calendar_values('00000000-0000-0000-0000-0000002a0d02', (SELECT id FROM replica), '{"custom_price_pence": null}'::jsonb,
    '00000000-0000-0000-0000-0000002a0f02', NULL)->'after'->>'custom_price_pence'),
  NULL, 'D6: clearing is allowed whatever the flag, by the calendar''s own venue too');

-- Card hold floor.
UPDATE public.service_items SET staff_may_customize_deposit = true, payment_requirement = 'card_hold', deposit_pence = 500
WHERE id = '00000000-0000-0000-0000-0000002a0501';
SELECT throws_ok(
  format($$ SELECT public.collective_set_calendar_values('00000000-0000-0000-0000-0000002a0d02', %L, '{"custom_deposit_pence": 50}'::jsonb, '00000000-0000-0000-0000-0000002a0f01', NULL) $$, (SELECT id FROM replica)),
  'P0001', NULL, 'A no-show fee under 100 pence is refused');

SELECT * FROM finish();

ROLLBACK;
