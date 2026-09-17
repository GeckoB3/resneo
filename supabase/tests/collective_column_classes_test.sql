-- Resneo: the collective column registry (20270211120000; plan DB-07, W3a).
--
-- Proves:
--   * every column of the nine tables a collective copies is classified, enumerated from
--     pg_attribute rather than listed, so a column added later fails here until someone
--     decides whether it may travel between businesses;
--   * that failure is real: a scratch column makes the unclassified count 1;
--   * the registry names no column that does not exist;
--   * the decisions that change what travels today hold (D11, D40, D53, §6.2);
--   * no client role holds any privilege on the table.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

CREATE TEMP VIEW registry_tables AS
SELECT unnest(ARRAY[
  'service_items', 'service_variants', 'addon_groups', 'addons', 'service_addon_groups',
  'service_categories', 'compliance_types', 'compliance_type_versions',
  'service_compliance_requirements'
]) AS table_name;

CREATE TEMP VIEW live_columns AS
SELECT c.relname::text AS table_name, a.attname::text AS column_name
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN registry_tables r ON r.table_name = c.relname
WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped;

SELECT is(
  (SELECT count(*) FROM live_columns l
   LEFT JOIN public.collective_column_classes k USING (table_name, column_name)
   WHERE k.class IS NULL),
  0::bigint,
  'Every column of the nine copied tables is classified'
);

SELECT is(
  (SELECT count(*) FROM public.collective_column_classes k
   LEFT JOIN live_columns l USING (table_name, column_name)
   WHERE l.column_name IS NULL),
  0::bigint,
  'The registry names no column that does not exist'
);

ALTER TABLE public.service_items ADD COLUMN zz_scratch_unclassified text;

SELECT is(
  (SELECT count(*) FROM live_columns l
   LEFT JOIN public.collective_column_classes k USING (table_name, column_name)
   WHERE k.class IS NULL),
  1::bigint,
  'A newly added column is caught as unclassified'
);

ALTER TABLE public.service_items DROP COLUMN zz_scratch_unclassified;

SELECT is(
  (SELECT array_agg(class ORDER BY column_name) FROM public.collective_column_classes
   WHERE table_name = 'service_items' AND column_name IN ('online_meeting_info', 'online_meeting_url')),
  ARRAY['not_copied', 'not_copied'],
  'D11: a host''s meeting link and joining information never reach a member'
);

SELECT is(
  (SELECT array_agg(class ORDER BY column_name) FROM public.collective_column_classes
   WHERE table_name = 'service_items' AND column_name IN ('capacity_per_session', 'pre_appointment_instructions')),
  ARRAY['venue', 'venue'],
  'D40 and D53: capacity and pre-appointment instructions are seeded, then the venue''s own'
);

SELECT is(
  (SELECT class FROM public.collective_column_classes
   WHERE table_name = 'addons' AND column_name = 'cost_to_business_pence'),
  'not_copied',
  'An add-on''s cost to the business stays at its own venue'
);

SELECT is(
  (SELECT class FROM public.collective_column_classes
   WHERE table_name = 'service_items' AND column_name = 'price_pence'),
  'host',
  'The price follows the host'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.collective_column_classes', 'SELECT, INSERT, UPDATE, DELETE'),
  'anon holds no privilege on the registry'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.collective_column_classes', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated holds no privilege on the registry'
);

SELECT * FROM finish();

ROLLBACK;
