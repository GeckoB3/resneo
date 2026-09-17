-- Resneo: when the venues were last told a link is failing (20270217150000; UX spec N5).
--
-- Proves: the column exists, holds a point in time, and may be empty (never told). The rule for when
-- a notice is due lives in collective-failure-notices.ts and is tested there.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'collective_service_replicas'
            AND column_name = 'failure_notified_at'),
  'A link records when its venues were last told it is failing');
SELECT is(
  (SELECT data_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'collective_service_replicas'
     AND column_name = 'failure_notified_at'),
  'timestamp with time zone',
  'as a point in time');
SELECT is(
  (SELECT is_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'collective_service_replicas'
     AND column_name = 'failure_notified_at'),
  'YES',
  'and it is empty until someone has been told');

SELECT * FROM finish();

ROLLBACK;
