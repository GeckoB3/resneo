-- Fix: infinite recursion in staff RLS (42P17).
--
-- `staff_select_venue_staff` ON public.staff subqueries public.staff in its
-- USING clause. Evaluating the policy requires reading staff, which evaluates
-- the policy again → "infinite recursion detected in policy for relation
-- staff". Any RLS-governed read of a table whose policy references staff
-- (bookings, guests, practitioners, venues, …) fails with 42P17 for anon and
-- authenticated roles. Server routes survive only because they use the
-- service-role client; PostgREST and Realtime (WALRUS) authorization are
-- broken by it.
--
-- Canonical fix: resolve the caller's venue ids in a SECURITY DEFINER
-- function (bypasses RLS inside the function body), then reference the
-- function from the policy.

CREATE OR REPLACE FUNCTION public.caller_staff_venue_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT venue_id FROM public.staff
  WHERE email = (auth.jwt() ->> 'email')
     OR (user_id IS NOT NULL AND user_id = auth.uid());
$$;

-- Lock the function down: only roles that hit RLS need EXECUTE.
REVOKE ALL ON FUNCTION public.caller_staff_venue_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_staff_venue_ids() TO anon, authenticated;

DROP POLICY IF EXISTS "staff_select_venue_staff" ON public.staff;
CREATE POLICY "staff_select_venue_staff"
  ON public.staff FOR SELECT
  USING (venue_id IN (SELECT public.caller_staff_venue_ids()));

-- staff_admin_insert had the same self-referencing shape (recursion on
-- INSERT paths under RLS). Recreate it via the helper with the admin check.
CREATE OR REPLACE FUNCTION public.caller_staff_admin_venue_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT venue_id FROM public.staff
  WHERE (email = (auth.jwt() ->> 'email')
     OR (user_id IS NOT NULL AND user_id = auth.uid()))
    AND role = 'admin';
$$;

REVOKE ALL ON FUNCTION public.caller_staff_admin_venue_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_staff_admin_venue_ids() TO anon, authenticated;

DROP POLICY IF EXISTS "staff_admin_insert" ON public.staff;
CREATE POLICY "staff_admin_insert"
  ON public.staff FOR INSERT
  WITH CHECK (venue_id IN (SELECT public.caller_staff_admin_venue_ids()));
