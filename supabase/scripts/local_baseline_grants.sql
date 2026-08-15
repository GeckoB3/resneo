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

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
