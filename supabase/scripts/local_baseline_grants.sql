-- Baseline table privileges for a LOCAL Supabase, applied before the RLS suite.
--
-- NOT part of the schema, and deliberately not a migration.
--
-- Hosted Supabase grants `anon` and `authenticated` table-level privileges on
-- `public` when a project is created, through project-level default privileges
-- that live outside this repository. A local instance built purely from
-- `supabase/migrations` does not have them, so the first `SELECT` as
-- `authenticated` fails with `permission denied for table staff` before RLS is
-- ever consulted -- privileges are checked first, and RLS only filters what a
-- role is already allowed to read.
--
-- That divergence is the table-level twin of C0, whose root cause was the same
-- mechanism applied to FUNCTIONS. It is worth stating plainly: **the migrations
-- in this repository do not, on their own, reproduce the permission environment
-- the application actually runs in.** Any local-instance check has to close that
-- gap explicitly or it is testing a different database.
--
-- This grants the coarse table access hosted already has, so that the suite
-- tests what it is meant to test: the RLS policies layered on top. It must stay
-- coarse. Narrowing it here would silently weaken the tests, and column-level
-- narrowing is D1's A2, which belongs in a migration where production gets it
-- too.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- `bookings` is EXCLUDED from the blanket grant. D1/A2 (20270112120000)
-- narrows it to column-level SELECT precisely to close C5 and N5, and a
-- blanket `GRANT ... ON ALL TABLES` here would run afterwards and hand the
-- columns straight back — leaving CI testing a permission environment that no
-- longer exists anywhere. The loop skips it so the table keeps exactly what
-- its migration gave it, and the suite asserts that narrowing directly.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'bookings'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t.tablename);
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t.tablename);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
