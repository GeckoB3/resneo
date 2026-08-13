-- Step 1b, the part that actually provides the guarantee.
--
-- 20270108120000 tried to make new functions fail closed via ALTER DEFAULT
-- PRIVILEGES and could not: PostgreSQL's built-in EXECUTE-to-PUBLIC grant on
-- functions survives it, so a new function in `public` is anon-reachable on
-- creation. See that file for the measurements. Prevention is therefore not
-- available at the schema level here, and the control has to be detection.
--
-- This function is the detection primitive. `scripts/check-client-executable-
-- functions.mjs` calls it and fails if the result does not match a committed
-- allowlist of 12, so a migration that introduces a new client-executable
-- SECURITY DEFINER function breaks the build rather than sitting unnoticed.
-- C0 sat open for months precisely because nothing was watching.
--
-- It catches both directions, which matters:
--
--   * A function ADDED to the set is a new C0/C1. That is the obvious case.
--   * A function MISSING from the set is the DROP+CREATE hazard: re-creating
--     one of the 8 RLS helpers resets its ACL and silently strips the
--     `authenticated` grant that every RLS policy referencing it depends on.
--     The dashboard would go blank-but-not-erroring, which is very hard to
--     diagnose from the app side and trivial to spot here.
--
-- SECURITY INVOKER deliberately, not DEFINER. pg_catalog is world-readable and
-- has_function_privilege() answers for any role regardless of caller, so this
-- needs no elevated rights. Adding another SECURITY DEFINER function to police
-- SECURITY DEFINER functions would be a poor trade.
--
-- Scope: SECURITY DEFINER functions only, excluding trigger functions. Non-
-- definer functions run as the caller and remain subject to RLS, so they are a
-- materially smaller risk and would make the allowlist too noisy to maintain.
-- If that assumption ever stops holding, widen the WHERE clause here and
-- regenerate the allowlist.

CREATE OR REPLACE FUNCTION public.audit_client_executable_functions()
RETURNS TABLE (
  function_name text,
  signature text,
  anon_execute boolean,
  authenticated_execute boolean
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p.proname::text,
         p.oid::regprocedure::text,
         has_function_privilege('anon', p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.prorettype <> 'trigger'::regtype
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
  ORDER BY 1, 2;
$$;

-- Locked to the server. The result is a map of which functions a client role can
-- reach, which is a useful shortcut for anyone probing the database, so it is not
-- something to leave open even though it mutates nothing.
--
-- Note that after 20270108120000 the FROM PUBLIC clause alone would now be
-- sufficient for a newly created function, since anon and authenticated no
-- longer receive direct default grants. All three are named anyway: it costs
-- nothing, it is the habit the rest of this repo should adopt, and it is still
-- required for anything created before that migration.
REVOKE ALL ON FUNCTION public.audit_client_executable_functions() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.audit_client_executable_functions() TO service_role;

-- ---------------------------------------------------------------------------
-- VERIFICATION
--
-- 1. As service_role, expect exactly 12 rows: the 8 RLS helpers and the 4
--    auth.uid()-scoped functions.
--
--      SELECT * FROM public.audit_client_executable_functions();
--
-- 2. The function must not appear in its own output, and must not be callable
--    by a client. Run the script, which asserts both:
--
--      npm run check:function-grants
-- ---------------------------------------------------------------------------
