-- Security: revoke client-role EXECUTE on SECURITY DEFINER functions that have
-- no client caller (audit finding C0).
--
-- WHY THE EARLIER REVOKES DID NOT WORK
--
-- Hosted Supabase grants `anon`, `authenticated` and `service_role` a DIRECT
-- EXECUTE on every function created in `public`, via ALTER DEFAULT PRIVILEGES.
-- `REVOKE ... FROM PUBLIC` removes only the PUBLIC grant and leaves those three
-- direct grants untouched, so it closes nothing.
--
-- This was verified on the live staging database on 2026-08-13.
-- `report_deposit_summary` is the proof: its ACL is
--   {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- Alone among the reporting functions it has no `=X/postgres` (PUBLIC) entry, so
-- 20270101120400's `REVOKE ... FROM PUBLIC` really did apply -- and achieved
-- nothing, because anon and authenticated kept their default-privilege grants.
-- 31 SECURITY DEFINER functions were reachable by `anon` at that point,
-- including `admin_hard_delete_venue(uuid)`, whose body has no authorisation
-- check of any kind (only 'venue id required' / 'venue not found').
--
-- Note that 20270101120400's own header cites `admin_hard_delete_venue` as the
-- house-style example to follow. Both were no-ops. The correct pattern, used
-- below and already used by 20261218120000 / 20261226120100, names all three
-- roles explicitly:
--   REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;
--   GRANT  EXECUTE ON FUNCTION ... TO service_role;
--
-- SCOPE
--
-- Every function below was confirmed to be reached only through the
-- service-role client (`getSupabaseAdminClient()` / `staff.db`), or to have no
-- application caller at all, so removing the client grants cannot break a
-- request path. Signatures are taken verbatim from pg_proc on staging.
--
-- DELIBERATELY NOT INCLUDED -- do not "complete" this list without re-reading
-- the audit, because each omission is load-bearing:
--
--  * The eight RLS helper functions -- current_staff_venue_ids,
--    caller_staff_venue_ids, caller_staff_admin_venue_ids, link_action_grant,
--    link_calendar_grant, link_pii_grant, link_calendar_allows and
--    get_linked_booking_source. These are invoked INSIDE policy evaluation as
--    the querying role. Revoking them from `authenticated` would break every
--    policy that references them and lock the dashboard out entirely. They are
--    parameterised on the caller's own identity and return empty for `anon`.
--
--  * report_booking_summary, report_no_show_series, report_cancellation and
--    report_deposit_summary. These are still called on the SESSION client at
--    src/app/api/venue/reports/route.ts:605-608, where :629 fails the whole
--    response on any error. They must be revoked only AFTER those four calls
--    are switched to `staff.db` and that code is deployed (audit item C1),
--    or the reports page returns 500 for every venue.
--
--  * claim_user_account, request_account_deletion, cancel_account_deletion and
--    touch_user_last_active. These are auth.uid()-scoped, take no venue
--    parameter, and cannot be abused cross-tenant. claim_user_account in
--    particular runs from a browser client on the post-magic-link path
--    (src/app/auth/callback/page.tsx), where the session may not yet be
--    established -- revoking `anon` there risks breaking sign-in for no
--    security gain.
--
-- FOLLOW-UP (not done here, deliberately):
--  * Drop public.report_frequent_visitors -- it has zero callers anywhere in
--    the repo. Revoked below rather than dropped, to keep a security patch free
--    of schema changes. Drop it as ordinary cleanup.
--  * Consider `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--    REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;` so new functions
--    fail closed. That is a behaviour change and needs an audit of genuinely
--    client-called RPCs first.

-- Destructive: deletes a venue and everything cascading from it. No guard in body.
REVOKE ALL ON FUNCTION public.admin_hard_delete_venue(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_hard_delete_venue(uuid) TO service_role;

-- Destructive: severs a venue's partner links. Invoked internally by
-- admin_hard_delete_venue (as owner); the grant below is belt-and-braces.
REVOKE ALL ON FUNCTION public.terminate_account_links_for_venue_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.terminate_account_links_for_venue_deletion(uuid) TO service_role;

-- Destructive: cross-tenant guest merge. Called via staff.db (admin) from
-- src/app/api/venue/guests/merge/route.ts.
REVOKE ALL ON FUNCTION public.merge_guests_into(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_guests_into(uuid, uuid, uuid[]) TO service_role;

-- Reads auth.users directly; an email -> user_id oracle over every account.
REVOKE ALL ON FUNCTION public.lookup_auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lookup_auth_user_id_by_email(text) TO service_role;

-- Platform-wide business metrics across every venue.
REVOKE ALL ON FUNCTION public.platform_venue_booking_stats(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_venue_booking_stats(timestamptz, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.platform_venue_health_stats() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_venue_health_stats() TO service_role;

-- Writes billing counters; an anon caller could inflate any venue's SMS usage.
REVOKE ALL ON FUNCTION public.increment_sms_usage(uuid, date, integer, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_sms_usage(uuid, date, integer, timestamptz, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_guest_booking_aggregates(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_guest_booking_aggregates(uuid) TO service_role;

-- Both call sites use the admin client.
REVOKE ALL ON FUNCTION public.guest_email_collides_for_user_change(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.guest_email_collides_for_user_change(text, uuid) TO service_role;

-- Spends prepaid class credits. No application caller today.
REVOKE ALL ON FUNCTION public.consume_class_credits_atomically(uuid, uuid, integer, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_class_credits_atomically(uuid, uuid, integer, uuid, uuid, text) TO service_role;

-- Cross-venue booking writes. These are the intended sole cross-venue write
-- path, so they must be reachable only by the server.
REVOKE ALL ON FUNCTION public.linked_apply_booking_insert(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.linked_apply_booking_insert(uuid, uuid, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.linked_apply_booking_update(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.linked_apply_booking_update(uuid, uuid, uuid, uuid, jsonb) TO service_role;

-- Returns guest counts and identifiability tiers. Called via staff.db (admin)
-- at src/app/api/venue/reports/route.ts:614.
REVOKE ALL ON FUNCTION public.report_client_summary(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.report_client_summary(uuid, date, date) TO service_role;

-- Invoked only from inside report_booking_summary / report_no_show_series,
-- which are SECURITY DEFINER and therefore call it with owner rights.
REVOKE ALL ON FUNCTION public.report_booking_final_statuses(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.report_booking_final_statuses(uuid, timestamptz, timestamptz) TO service_role;

-- Returns guest names, emails and phone numbers. Zero callers in the repo; no
-- grant issued so any future caller fails closed. See FOLLOW-UP above.
REVOKE ALL ON FUNCTION public.report_frequent_visitors(uuid, date, date, integer) FROM PUBLIC, anon, authenticated;

-- VERIFICATION
--
-- After applying, this should return exactly 16 rows -- the 8 RLS helpers, the
-- 4 report RPCs awaiting C1, and the 4 auth.uid()-scoped functions listed above:
--
--   SELECT p.oid::regprocedure AS signature,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.prosecdef
--     AND p.prorettype <> 'trigger'::regtype
--     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
--          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
--   ORDER BY p.proname;
--
-- Rollback for any single function:
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon, authenticated;
