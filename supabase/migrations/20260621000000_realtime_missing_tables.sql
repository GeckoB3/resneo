-- Add the dashboard-subscribed tables that were never added to the
-- `supabase_realtime` publication.
--
-- Why this matters: several dashboard views subscribe to `postgres_changes`
-- on these tables (bookings, guests, waitlist_entries, etc.). In current
-- Supabase Realtime, binding a channel to a table that is NOT in the
-- publication makes the whole channel error out (CHANNEL_ERROR) and it never
-- reaches `SUBSCRIBED`. Our hooks then fall back to a 30s polling loop that
-- runs forever — a large, continuous source of database egress.
--
-- `bookings` is subscribed in ~10 places (bookings dashboards, day sheet,
-- contacts, practitioner calendar, event manager, class timetable, resource
-- timeline, the detail-panel live invalidator, ...), so its absence alone
-- forced almost every dashboard into permanent polling.
--
-- This migration is idempotent: it only adds a table if it exists and is not
-- already in the publication. REPLICA IDENTITY FULL is set so that filtered
-- (e.g. `venue_id=eq.*`) UPDATE/DELETE events still carry the columns the
-- filters reference.

DO $$
DECLARE
  tbl text;
  realtime_tables text[] := ARRAY[
    'bookings',
    'guests',
    'experience_events',
    'waitlist_entries',
    'class_types',
    'class_instances',
    'class_timetable'
  ];
BEGIN
  FOREACH tbl IN ARRAY realtime_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      END IF;

      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', tbl);
    END IF;
  END LOOP;
END$$;
