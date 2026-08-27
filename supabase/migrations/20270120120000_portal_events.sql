-- =============================================================================
-- P0-10: portal_events, the sink for §5B's portal metrics.
-- Docs/Resneo_Customer_Portal_World_Class_Plan.md P0-10, enables §5B and §5A's
-- revert thresholds.
-- =============================================================================
--
-- Why a new table rather than `events`: `events.venue_id` is NOT NULL
-- (20260301000006) and its RLS is staff-scoped. Portal entry and sign-in
-- completion are cross-venue and frequently have NO venue context at all: a
-- customer arriving on /account belongs to every venue they have booked with,
-- and to none in particular. Relaxing `events.venue_id` was rejected: that
-- table is venue-scoped, INSERT-only by RLS grant, and read by venue
-- reporting, so loosening it has blast radius well beyond this plan.
--
-- Both `user_id` and `venue_id` are nullable ON PURPOSE. The most important
-- event this table records is an entry that did NOT complete: a token verify
-- that failed has no user, and often no venue either. A NOT NULL on either
-- column would silently discard exactly the failures §5A's revert thresholds
-- are read off.

CREATE TABLE IF NOT EXISTS public.portal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null when the event precedes (or fails) authentication.
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- Null for cross-venue events; the portal is not venue-scoped.
  venue_id uuid REFERENCES public.venues (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_events_event_type_nonempty CHECK (length(trim(event_type)) > 0)
);

COMMENT ON TABLE public.portal_events IS
  'Customer-portal metrics sink (P0-10). Service role only: never read or written by a '
  'client role. user_id and venue_id are nullable because the events that matter most '
  'are pre-auth and cross-venue. Pruned at 13 months by /api/cron/portal-events-prune.';

-- The read queries in src/lib/portal/portal-metrics.ts filter by event_type over
-- a date range, which is exactly this index. The second serves the per-user
-- funnel joins without scanning.
CREATE INDEX IF NOT EXISTS idx_portal_events_type_created
  ON public.portal_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_events_user_created
  ON public.portal_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Service role only. RLS is enabled with NO policies, which denies every
-- client role outright; service_role bypasses RLS. Belt and braces with the
-- REVOKE below, because hosted Supabase grants anon and authenticated table
-- privileges outside the migration history (see 20270119120000, where exactly
-- that turned a read-only view into a writable one).
ALTER TABLE public.portal_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_events FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT ON public.portal_events TO service_role;

-- ---------------------------------------------------------------------------
-- VERIFICATION - run against the environment just migrated.
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'portal_events' ORDER BY grantee;
--   -- expect service_role only; no anon, no authenticated.
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'portal_events';  -- t
--
-- npm run check:table-grants also asserts this contract against the live
-- hosted database, which is the only place default-privilege drift shows up.
-- ---------------------------------------------------------------------------
