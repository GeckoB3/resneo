-- §17 enhancement — realtime notification bell.
--
-- Add `account_link_notifications` to the `supabase_realtime` publication so the
-- dashboard bell can subscribe to INSERTs (a linked venue acting on a booking,
-- a lifecycle event) and update instantly instead of waiting up to 60s for the
-- poll. RLS already restricts SELECT to the owning venue's active staff, so the
-- subscription only delivers each venue its own rows. Idempotent + REPLICA
-- IDENTITY FULL so filtered events carry the columns the client filters on.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'account_link_notifications'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'account_link_notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.account_link_notifications;
    END IF;
    ALTER TABLE public.account_link_notifications REPLICA IDENTITY FULL;
  END IF;
END$$;
