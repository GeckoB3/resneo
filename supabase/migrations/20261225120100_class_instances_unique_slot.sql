-- CDE review C11 — prevent duplicate class instances under concurrent creation.
--
-- class_instances were de-duplicated only in application code (read existing,
-- then insert), so two concurrent bulk submissions could both insert a session
-- at the same (class_type_id, instance_date, start_time). This adds the missing
-- uniqueness guarantee at the database level.
--
-- Best-effort cleanup first: drop duplicate instances that have NO linked
-- bookings, keeping the lowest-id row per slot, so the unique index can be
-- created on existing data. If two duplicates both carry bookings the index
-- creation will fail and that genuine data conflict must be resolved manually.

DELETE FROM public.class_instances ci
WHERE EXISTS (
  SELECT 1 FROM public.class_instances keep
  WHERE keep.class_type_id = ci.class_type_id
    AND keep.instance_date = ci.instance_date
    AND keep.start_time = ci.start_time
    AND keep.id < ci.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.bookings b WHERE b.class_instance_id = ci.id
);

CREATE UNIQUE INDEX IF NOT EXISTS class_instances_unique_slot
  ON public.class_instances (class_type_id, instance_date, start_time);
