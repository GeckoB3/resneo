-- W5: telling the host and the member when an update will not go through (UX spec §4 N5; plan §6.16).
--
-- A replica link that has failed three times, or has been behind for 15 minutes, is an incident the
-- host and the member hear about: once when it starts, and again each day it stays unresolved. The
-- engine already records when a link fell behind (`behind_since`, reset when it catches up), so the
-- only thing missing is when the venues were last told. A notice is due when they have never been
-- told, were told about an earlier incident (before this `behind_since`), or were told over a day
-- ago.
--
-- Written by the replicate cron through the service role, never by the engine's apply, so a notice
-- can never hold up or roll back an update.

ALTER TABLE public.collective_service_replicas
  ADD COLUMN IF NOT EXISTS failure_notified_at timestamptz;

COMMENT ON COLUMN public.collective_service_replicas.failure_notified_at IS
  'When the host and member were last told this link is failing or stuck (N5). NULL: never, for any incident.';
