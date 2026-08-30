-- P0-13 (R3): namespace user_profiles.notification_preferences.
--
-- WHY. One free-form jsonb column holds two unrelated preference sets. The
-- staff app writes `new_booking`, `quiet_hours_start` and thirteen others; the
-- customer portal writes `operational_email` and `marketing_email`. They sit in
-- the same flat object, so a customer profile save could clobber a dual-role
-- user's staff push settings, and linked accounts actively create dual-role
-- users. This splits them into `{ staff: {...}, customer: {...} }`.
--
-- THIS MIGRATION REWRITES JSONB IN PLACE AND HAS NO REVERT. That is the reason
-- the plan sequences it after the tolerant readers, and the reason for
-- everything below.
--
-- MEASURED BLAST RADIUS, 2026-08-27. Production: 416 user_profiles rows, 415
-- with an empty or null column, ONE with stored preferences, holding
-- `booking_scope` and `no_show`. Both are staff keys and both are in
-- STAFF_PREFERENCE_KEYS, so the routing below is already the routing the
-- application tests cover. The decision to ship this in a batched deploy was
-- taken with that number in hand.
--
-- THE DUAL SHAPE, AND WHY IT IS NOT REDUNDANT. Each migrated row keeps its
-- flat staff keys ALONGSIDE the namespace:
--
--   { no_show: false, staff: { no_show: false }, customer: {} }
--
-- `isNamespaced()` keys off the presence of a `staff` object, so new code reads
-- the namespace. Old code, and build 1.0.7 in the stores, still find the flat
-- keys where they left them. That makes this migration safe in EITHER order
-- relative to the code deploy, which removes the one window a batched release
-- could not otherwise avoid. `withStaffMirror()` does the same thing on the
-- read side; P0-14's narrowed writer drops the flat mirror once 1.0.7 is gone.
--
-- IDEMPOTENT. Rows that already carry a `staff` object are skipped, so a
-- re-run, or a partial apply that is retried, cannot double-wrap.

BEGIN;

-- The staff key set, and it must stay identical to STAFF_PREFERENCE_KEYS in
-- src/lib/notifications/notification-preferences.ts. Anything not in this list
-- is a customer key: the staff set is fixed and enumerated, the customer
-- surface is the one that gains keys.
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
    -- Flat keys retained (the dual shape), then the two namespaces added.
    coalesce(up.notification_preferences, '{}'::jsonb)
      || jsonb_build_object(
           'staff',
           coalesce(
             (SELECT jsonb_object_agg(kv.key, kv.value)
                FROM jsonb_each(coalesce(up.notification_preferences, '{}'::jsonb)) AS kv
               WHERE kv.key IN (SELECT key FROM staff_pref_keys)),
             '{}'::jsonb
           ),
           'customer',
           coalesce(
             (SELECT jsonb_object_agg(kv.key, kv.value)
                FROM jsonb_each(coalesce(up.notification_preferences, '{}'::jsonb)) AS kv
               WHERE kv.key NOT IN (SELECT key FROM staff_pref_keys)
                 AND kv.key NOT IN ('staff', 'customer')),
             '{}'::jsonb
           )
         ) AS merged
  FROM public.user_profiles up
  -- Skip anything already namespaced: re-running must not wrap a wrapper.
  WHERE NOT (coalesce(up.notification_preferences, '{}'::jsonb) ? 'staff')
) AS split
WHERE p.id = split.id;

COMMENT ON COLUMN public.user_profiles.notification_preferences IS
  'Namespaced as { staff: {...}, customer: {...} } by 20270122120000. Flat staff '
  'keys are ALSO retained at the top level for build 1.0.7, which reads them '
  'directly; P0-14 removes that mirror once 1.0.7 is gone. Read through '
  'src/lib/notifications/notification-preferences.ts, never directly: it is the '
  'only thing that copes with both shapes.';

-- VERIFICATION, run inside the transaction so a bad backfill rolls back rather
-- than being discovered later. The plan asks for a before-and-after diff over
-- real rows; this is the invariant that diff would be checking.
DO $$
DECLARE
  unnamespaced integer;
  lost_keys integer;
BEGIN
  SELECT count(*) INTO unnamespaced
    FROM public.user_profiles
   WHERE NOT (coalesce(notification_preferences, '{}'::jsonb) ? 'staff');
  IF unnamespaced > 0 THEN
    RAISE EXCEPTION 'namespace backfill missed % row(s)', unnamespaced;
  END IF;

  -- Every flat staff key that survived at the top level must also be present,
  -- with the SAME value, inside the staff namespace. This is the assertion
  -- that would have caught a mis-partition, which is the failure mode with no
  -- revert.
  SELECT count(*) INTO lost_keys
    FROM public.user_profiles up,
         LATERAL jsonb_each(coalesce(up.notification_preferences, '{}'::jsonb)) AS kv
   WHERE kv.key IN ('push_enabled', 'new_booking', 'cancellation', 'reschedule',
                    'payment', 'no_show', 'waitlist', 'daily_summary', 'review',
                    'low_sms_credit', 'billing', 'booking_scope',
                    'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end')
     AND coalesce(up.notification_preferences -> 'staff' -> kv.key, 'null'::jsonb)
         IS DISTINCT FROM kv.value;
  IF lost_keys > 0 THEN
    RAISE EXCEPTION 'namespace backfill changed % staff preference value(s)', lost_keys;
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- AFTER APPLYING, on each environment:
--
--   -- every row namespaced, and the one populated row intact:
--   SELECT count(*) FILTER (WHERE notification_preferences ? 'staff') AS namespaced,
--          count(*) AS total
--     FROM public.user_profiles;
--
--   SELECT id, notification_preferences
--     FROM public.user_profiles
--    WHERE notification_preferences -> 'staff' <> '{}'::jsonb;
--
-- Expected on production as measured 2026-08-27: namespaced = total = 416, and
-- exactly one row with a non-empty staff namespace holding `booking_scope` and
-- `no_show` at their pre-migration values.
-- ---------------------------------------------------------------------------
