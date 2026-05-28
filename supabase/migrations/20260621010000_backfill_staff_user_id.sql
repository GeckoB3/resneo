-- Backfill staff.user_id from auth.users by email.
--
-- Why: venue API requests resolve the signed-in staff member by `user_id`.
-- When `staff.user_id` is null the resolver falls through to a second
-- case-insensitive lookup by email on every request — doubling the `staff`
-- queries (and database egress) for the identity check. Populating `user_id`
-- lets the indexed `user_id` lookup succeed on the first try.
--
-- Idempotent: only fills rows where user_id is currently null and a single
-- matching auth user exists for that email.

UPDATE public.staff AS s
SET user_id = u.id
FROM auth.users AS u
WHERE s.user_id IS NULL
  AND s.email IS NOT NULL
  AND lower(s.email) = lower(u.email)
  AND (
    SELECT count(*)
    FROM auth.users AS u2
    WHERE lower(u2.email) = lower(s.email)
  ) = 1;
