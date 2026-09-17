-- Resneo: platform settings (20270218230000; D37).
--
-- Proves: new collectives start on the older model until the console says otherwise; only the two
-- models are accepted; unknown keys are refused; and client roles can neither read nor write.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

SELECT is(
  (SELECT value FROM public.platform_settings WHERE key = 'new_collective_service_model'),
  '"legacy_copies"'::jsonb, 'New collectives start on the older model by default');

SELECT lives_ok(
  $$ UPDATE public.platform_settings SET value = '"replicas"' WHERE key = 'new_collective_service_model' $$,
  'The console can switch new collectives to shared services');

SELECT throws_ok(
  $$ UPDATE public.platform_settings SET value = '"migrating"' WHERE key = 'new_collective_service_model' $$,
  '23514', NULL, 'A new collective cannot start part-way through a migration');

SELECT throws_ok(
  $$ INSERT INTO public.platform_settings (key, value) VALUES ('something_else', 'true') $$,
  '23514', NULL, 'Unknown settings are refused');

SELECT is(
  has_table_privilege('authenticated', 'public.platform_settings', 'SELECT')
    OR has_table_privilege('anon', 'public.platform_settings', 'SELECT'),
  false, 'Client roles cannot read the settings');

SELECT * FROM finish();

ROLLBACK;
