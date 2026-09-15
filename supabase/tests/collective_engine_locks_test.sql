-- Resneo: the collective engine's locks (20270216120000; plan §6.5, Appendix C.4; RT1-5, RT1-13).
--
-- Proves, on a replicas-model collective, that without the engine flag:
--   * a member cannot change a replica's host columns, delete it, or add, change or delete its options
--     (RN001), but can change its own columns (capacity, instructions) and a heading's order;
--   * a member cannot rename a managed heading (RN001);
--   * a member cannot change a managed add-on group or option (RN003), but can set an option's cost;
--   * a member cannot link its own service to a managed group (RN003);
--   * a member cannot change a managed form or add a version (RN004), nor require a managed form on
--     its own service (RN004), but may require it venue-wide (D10);
--   * a replica's requirements cannot be removed by the member (RN004);
--   * a calendar assignment cannot be re-pointed from a replica (RN001), but can be added and removed;
--   * the host cannot delete a master with an active offering (RN002);
--   * a link row naming another venue's group or form is refused (23514);
--   * the engine still converges through the locks;
--   * once the membership ends, nothing is locked;
--   * on a legacy_copies collective nothing is locked.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(26);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-00000000d0f1', 'Lock Host', 'lock-host', 'host@lock.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000d0f2', 'Lock Member', 'lock-member', 'member@lock.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-00000000d0c1', 'lock-collective', 'Lock Collective',
        '00000000-0000-0000-0000-00000000d0f1', 'active', 'unified_catalog', 'replicas');

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-00000000d0e1', '00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-00000000d0f1', 'active'),
  ('00000000-0000-0000-0000-00000000d0e2', '00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-00000000d0f2', 'active');

-- Master with a heading, an option, an add-on group with an option, and a form.
INSERT INTO public.service_categories (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-00000000d0f1', 'Brows');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence, category_id)
VALUES ('00000000-0000-0000-0000-00000000d051', '00000000-0000-0000-0000-00000000d0f1', 'Shape', 20, 1500, '00000000-0000-0000-0000-00000000d0a1');
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000d0b1', '00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-00000000d051', 'Quick', 15, 1200);
INSERT INTO public.addon_groups (id, venue_id, name, selection_type)
VALUES ('00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-00000000d0f1', 'Finish', 'single');
INSERT INTO public.addons (id, addon_group_id, venue_id, name, additional_price_pence)
VALUES ('00000000-0000-0000-0000-00000000d0b2', '00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-00000000d0f1', 'Tint', 500);
INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id)
VALUES ('00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-00000000d051', '00000000-0000-0000-0000-00000000d0a2');
INSERT INTO public.compliance_types (id, venue_id, name, slug, category, result_type, capture_methods)
VALUES ('00000000-0000-0000-0000-00000000d0a3', '00000000-0000-0000-0000-00000000d0f1', 'Brow consent', 'brow-consent', 'consent', 'signed', ARRAY['client_online']);
INSERT INTO public.compliance_type_versions (id, venue_id, compliance_type_id, version_number, form_schema)
VALUES ('00000000-0000-0000-0000-00000000d0b3', '00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-00000000d0a3', 1, '{"fields":[]}');
UPDATE public.compliance_types SET current_version_id = '00000000-0000-0000-0000-00000000d0b3' WHERE id = '00000000-0000-0000-0000-00000000d0a3';
INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement)
VALUES ('00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-00000000d051', '00000000-0000-0000-0000-00000000d0a3', 'service', 'warn_staff');

-- The member's own service and calendar.
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000d052', '00000000-0000-0000-0000-00000000d0f2', 'Member own', 30, 1000);
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-00000000d0d1', '00000000-0000-0000-0000-00000000d0f2', 'Member chair');

SELECT public.collective_offer_service('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-00000000d051',
  '00000000-0000-0000-0000-00000000d0f1', NULL);
CREATE TEMP TABLE link AS
SELECT id FROM public.collective_service_replicas WHERE venue_id = '00000000-0000-0000-0000-00000000d0f2';
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');

CREATE TEMP TABLE m AS
SELECT l.replica_service_id AS service,
       (SELECT id FROM public.service_variants WHERE service_item_id = l.replica_service_id) AS variant,
       (SELECT category_id FROM public.service_items WHERE id = l.replica_service_id) AS heading,
       (SELECT id FROM public.addon_groups WHERE venue_id = l.venue_id AND replica_of_addon_group_id = '00000000-0000-0000-0000-00000000d0a2') AS grp,
       (SELECT a.id FROM public.addons a JOIN public.addon_groups g ON g.id = a.addon_group_id
        WHERE g.venue_id = l.venue_id AND g.replica_of_addon_group_id = '00000000-0000-0000-0000-00000000d0a2') AS opt,
       (SELECT id FROM public.compliance_types WHERE venue_id = l.venue_id AND replica_of_compliance_type_id = '00000000-0000-0000-0000-00000000d0a3') AS form
FROM public.collective_service_replicas l WHERE l.id = (SELECT id FROM link);

-- Services, options, headings (RN001).
SELECT throws_ok(format($$ UPDATE public.service_items SET price_pence = 1 WHERE id = %L $$, (SELECT service FROM m)),
  'RN001', NULL, 'A member cannot change the collective service''s price');
SELECT lives_ok(format($$ UPDATE public.service_items SET capacity_per_session = 4, pre_appointment_instructions = 'Arrive early' WHERE id = %L $$, (SELECT service FROM m)),
  'A member can change its own columns on the collective service');
SELECT throws_ok(format($$ DELETE FROM public.service_items WHERE id = %L $$, (SELECT service FROM m)),
  'RN001', NULL, 'A member cannot delete the collective service');
SELECT throws_ok(format($$ INSERT INTO public.service_variants (venue_id, service_item_id, name, duration_minutes, price_pence)
                          VALUES ('00000000-0000-0000-0000-00000000d0f2', %L, 'Extra', 10, 100) $$, (SELECT service FROM m)),
  'RN001', NULL, 'A member cannot add an option to the collective service');
SELECT throws_ok(format($$ UPDATE public.service_variants SET price_pence = 1 WHERE id = %L $$, (SELECT variant FROM m)),
  'RN001', NULL, 'A member cannot change an option of the collective service');
SELECT throws_ok(format($$ UPDATE public.service_categories SET name = 'Mine' WHERE id = %L $$, (SELECT heading FROM m)),
  'RN001', NULL, 'A member cannot rename the collective''s heading');
SELECT lives_ok(format($$ UPDATE public.service_categories SET sort_order = 9 WHERE id = %L $$, (SELECT heading FROM m)),
  'A member can reorder the collective''s heading among its own');

-- Add-ons (RN003).
SELECT throws_ok(format($$ UPDATE public.addon_groups SET max_select = 3 WHERE id = %L $$, (SELECT grp FROM m)),
  'RN003', NULL, 'A member cannot change the collective''s add-on group');
SELECT throws_ok(format($$ UPDATE public.addons SET additional_price_pence = 1 WHERE id = %L $$, (SELECT opt FROM m)),
  'RN003', NULL, 'A member cannot change a price in the collective''s add-on group');
SELECT lives_ok(format($$ UPDATE public.addons SET cost_to_business_pence = 120 WHERE id = %L $$, (SELECT opt FROM m)),
  'A member can record its own cost for the option');
SELECT throws_ok(format($$ INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id)
                          VALUES ('00000000-0000-0000-0000-00000000d0f2', '00000000-0000-0000-0000-00000000d052', %L) $$, (SELECT grp FROM m)),
  'RN003', NULL, 'RT1-13: a member cannot put the collective''s add-on group on its own service');

-- Forms (RN004).
SELECT throws_ok(format($$ UPDATE public.compliance_types SET name = 'Mine' WHERE id = %L $$, (SELECT form FROM m)),
  'RN004', NULL, 'A member cannot rename the collective''s form');
SELECT throws_ok(format($$ INSERT INTO public.compliance_type_versions (venue_id, compliance_type_id, version_number, form_schema)
                          VALUES ('00000000-0000-0000-0000-00000000d0f2', %L, 99, '{}') $$, (SELECT form FROM m)),
  'RN004', NULL, 'A member cannot publish a version of the collective''s form');
SELECT throws_ok(format($$ INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement)
                          VALUES ('00000000-0000-0000-0000-00000000d0f2', '00000000-0000-0000-0000-00000000d052', %L, 'service', 'warn_staff') $$, (SELECT form FROM m)),
  'RN004', NULL, 'RT1-13: a member cannot require the collective''s form on its own service');
SELECT lives_ok(format($$ INSERT INTO public.service_compliance_requirements (venue_id, compliance_type_id, scope, enforcement)
                         VALUES ('00000000-0000-0000-0000-00000000d0f2', %L, 'venue', 'warn_staff') $$, (SELECT form FROM m)),
  'D10: a member can require the collective''s form venue-wide');
SELECT throws_ok(format($$ DELETE FROM public.service_compliance_requirements WHERE service_item_id = %L $$, (SELECT service FROM m)),
  'RN004', NULL, 'A member cannot remove the collective service''s form requirement');

-- Calendar assignments: add and remove freely, never re-point.
SELECT lives_ok(format($$ INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
                         VALUES ('00000000-0000-0000-0000-00000000d0d1', %L) $$, (SELECT service FROM m)),
  'A member can offer the collective service on its calendar');
SELECT throws_ok(format($$ UPDATE public.calendar_service_assignments SET service_item_id = '00000000-0000-0000-0000-00000000d052'
                          WHERE service_item_id = %L $$, (SELECT service FROM m)),
  'RN001', NULL, 'A calendar''s collective service cannot be swapped for another');
SELECT lives_ok(format($$ DELETE FROM public.calendar_service_assignments WHERE service_item_id = %L $$, (SELECT service FROM m)),
  'A member can take the collective service off its calendar');

-- The host.
SELECT throws_ok($$ DELETE FROM public.service_items WHERE id = '00000000-0000-0000-0000-00000000d051' $$,
  'RN002', NULL, 'RT1-5: the host cannot delete a service offered on the collective page');
SELECT throws_ok(format($$ INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id)
                          VALUES ('00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-00000000d051', %L) $$, (SELECT grp FROM m)),
  '23514', NULL, 'A service cannot link another venue''s add-on group');
SELECT throws_ok(format($$ INSERT INTO public.service_compliance_requirements (venue_id, compliance_type_id, scope, enforcement)
                          VALUES ('00000000-0000-0000-0000-00000000d0f1', %L, 'venue', 'warn_staff') $$, (SELECT form FROM m)),
  '23514', NULL, 'A venue cannot require another venue''s form');

-- The engine goes through the locks.
UPDATE public.service_items SET price_pence = 1800 WHERE id = '00000000-0000-0000-0000-00000000d051';
UPDATE public.addons SET additional_price_pence = 700 WHERE id = '00000000-0000-0000-0000-00000000d0b2';
SELECT is(
  (SELECT (public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline')->>'ok')::boolean),
  true, 'The engine still converges the member''s copies');
SELECT is(
  (SELECT array[(SELECT price_pence FROM public.service_items WHERE id = (SELECT service FROM m)),
                (SELECT additional_price_pence FROM public.addons WHERE id = (SELECT opt FROM m))]),
  array[1800, 700], 'and the member''s copies carry the host''s new prices');

-- Once the membership ends, nothing is locked.
UPDATE public.venue_collective_members SET status = 'left' WHERE id = '00000000-0000-0000-0000-00000000d0e2';
SELECT lives_ok(format($$ UPDATE public.service_items SET price_pence = 1 WHERE id = %L $$, (SELECT service FROM m)),
  'After leaving, the member can change the service');

-- On a legacy_copies collective nothing is locked.
UPDATE public.venue_collective_members SET status = 'active' WHERE id = '00000000-0000-0000-0000-00000000d0e2';
UPDATE public.venue_collectives SET service_model = 'legacy_copies' WHERE id = '00000000-0000-0000-0000-00000000d0c1';
SELECT lives_ok(format($$ UPDATE public.addons SET additional_price_pence = 1 WHERE id = %L $$, (SELECT opt FROM m)),
  'On today''s collectives the locks refuse nothing');

SELECT * FROM finish();

ROLLBACK;
