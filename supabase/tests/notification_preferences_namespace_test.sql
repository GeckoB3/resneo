-- pgTAP: migration 20270122120000 namespaces notification_preferences without
-- losing a value (P0-13, R3).
--
-- This migration rewrites jsonb IN PLACE and has no revert, so the only chance
-- to catch a mis-partition is before it runs on production. The unit tests
-- assert the application can READ what the migration writes; this asserts the
-- migration writes the right thing in the first place, which is the half that
-- SQL alone decides.
--
-- Run by the rls-pgtap CI job against a local Supabase instance.

BEGIN;
SELECT plan(9);

-- ---------------------------------------------------------------------------
-- Fixture: one row of each kind production actually has.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'staffonly@resneo-test.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'empty@resneo-test.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'dualrole@resneo-test.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'already@resneo-test.invalid')
ON CONFLICT (id) DO NOTHING;

-- The shape of production's single populated row, plus the cases it does not
-- have but will: an empty one, a dual-role one, and one already migrated.
INSERT INTO public.user_profiles (id, notification_preferences)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001',
   '{"booking_scope": "mine", "no_show": false}'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000002', '{}'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000003',
   '{"new_booking": false, "quiet_hours_start": "22:00", "marketing_email": true, "operational_email": false}'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000004',
   '{"staff": {"no_show": true}, "customer": {}}'::jsonb)
ON CONFLICT (id) DO UPDATE SET notification_preferences = EXCLUDED.notification_preferences;

-- ---------------------------------------------------------------------------
-- The migration has already run by the time tests execute, so these assert its
-- effect on rows inserted BEFORE it would be re-applied. Re-run its body here
-- against the fixture to test it directly.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE staff_pref_keys (key text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO staff_pref_keys (key) VALUES
  ('push_enabled'), ('new_booking'), ('cancellation'), ('reschedule'),
  ('payment'), ('no_show'), ('waitlist'), ('daily_summary'), ('review'),
  ('low_sms_credit'), ('billing'), ('booking_scope'),
  ('quiet_hours_enabled'), ('quiet_hours_start'), ('quiet_hours_end');

UPDATE public.user_profiles p
SET notification_preferences = split.merged
FROM (
  SELECT
    up.id,
    coalesce(up.notification_preferences, '{}'::jsonb)
      || jsonb_build_object(
           'staff',
           coalesce((SELECT jsonb_object_agg(kv.key, kv.value)
                       FROM jsonb_each(coalesce(up.notification_preferences, '{}'::jsonb)) AS kv
                      WHERE kv.key IN (SELECT key FROM staff_pref_keys)), '{}'::jsonb),
           'customer',
           coalesce((SELECT jsonb_object_agg(kv.key, kv.value)
                       FROM jsonb_each(coalesce(up.notification_preferences, '{}'::jsonb)) AS kv
                      WHERE kv.key NOT IN (SELECT key FROM staff_pref_keys)
                        AND kv.key NOT IN ('staff', 'customer')), '{}'::jsonb)
         ) AS merged
  FROM public.user_profiles up
  WHERE NOT (coalesce(up.notification_preferences, '{}'::jsonb) ? 'staff')
) AS split
WHERE p.id = split.id;

-- ---------------------------------------------------------------------------
-- 1 to 3: production's real row. Both keys are staff keys and both must land
-- in the staff namespace at their original values.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT notification_preferences -> 'staff' FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '{"booking_scope": "mine", "no_show": false}'::jsonb,
  'staff keys land in the staff namespace with their values intact'
);

SELECT is(
  (SELECT notification_preferences -> 'customer' FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '{}'::jsonb,
  'no staff key leaks into the customer namespace'
);

SELECT is(
  (SELECT notification_preferences ->> 'no_show' FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'false',
  'the flat key is RETAINED for build 1.0.7, which reads it directly'
);

-- ---------------------------------------------------------------------------
-- 4 and 5: the 415 empty rows.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT notification_preferences FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  '{"staff": {}, "customer": {}}'::jsonb,
  'an empty column becomes an empty pair, not null'
);

SELECT ok(
  (SELECT notification_preferences ? 'staff' FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  'an empty row still reads as namespaced, so it is never re-migrated'
);

-- ---------------------------------------------------------------------------
-- 6 and 7: a dual-role user, which is the case the namespace exists for.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT notification_preferences -> 'staff' FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003'),
  '{"new_booking": false, "quiet_hours_start": "22:00"}'::jsonb,
  'a dual-role user keeps every staff key'
);

SELECT is(
  (SELECT notification_preferences -> 'customer' FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003'),
  '{"marketing_email": true, "operational_email": false}'::jsonb,
  'and every customer key, in the other namespace'
);

-- ---------------------------------------------------------------------------
-- 8: idempotence. A retried apply must not wrap a wrapper.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT notification_preferences FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  '{"staff": {"no_show": true}, "customer": {}}'::jsonb,
  'an already-namespaced row is left exactly as it was'
);

-- ---------------------------------------------------------------------------
-- 9: the invariant the migration itself asserts, checked independently. Any
-- flat staff key must equal its namespaced twin.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int
     FROM public.user_profiles up,
          LATERAL jsonb_each(coalesce(up.notification_preferences, '{}'::jsonb)) AS kv
    WHERE kv.key IN (SELECT key FROM staff_pref_keys)
      AND coalesce(up.notification_preferences -> 'staff' -> kv.key, 'null'::jsonb)
          IS DISTINCT FROM kv.value),
  0,
  'no staff preference value changed anywhere in the table'
);

SELECT * FROM finish();
ROLLBACK;
