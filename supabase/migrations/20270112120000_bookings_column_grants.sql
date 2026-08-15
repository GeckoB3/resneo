-- D1/A2 — close C5 and N5 with column-level grants on `bookings`.
--
-- C5: the SELECT policy for a linked venue has no column restriction, so a
-- `time_only` or `pii=false` partner can read every column of the owner's
-- bookings. N5 is the same hole through a different door and is why an
-- API-layer fix cannot close it: `PractitionerCalendarView` opens a
-- `postgres_changes` channel per linked venue, and **Realtime delivers the
-- whole row**. A `time_only` partner's dashboard has been receiving guest
-- emails, phones, `special_requests`, `dietary_notes` and `internal_notes`
-- over the WebSocket on every change to the owner's diary.
--
-- Column grants are checked BEFORE RLS and cannot be forgotten at a call site,
-- which is what makes this structural rather than another redaction that has to
-- be remembered. The SELECT policy stays exactly as it is: Realtime delivery
-- depends on it, and dropping it makes the channel subscribe successfully and
-- never fire, with no error anywhere (see D1).
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE AGAINST THE CODE CURRENTLY RUNNING, verified not assumed.
--
-- `authenticated` reaches `bookings` in exactly two ways:
--
--   1. `useVenueLiveSync.ts:85-86` — `select('id')`, filtered on `venue_id` and
--      `booking_date`. All three are granted below. It is the ONLY browser
--      query against this table in `src/`.
--   2. Realtime delivery for the same hook and the linked-calendar channel.
--
-- Every server path writes and reads through `getSupabaseAdminClient()` /
-- `staff.db`, which is `service_role` and bypasses both RLS and column grants.
-- The `supabase.from('bookings')` calls in the create routes are all on admin
-- clients (`create/route.ts:272`, `create-multi-service:166`,
-- `create-group:162`).
--
-- `bookings_linked_anonymised` (20260922120000) is `security_invoker`, so it
-- reads as the caller. It reads exactly `id, venue_id, practitioner_id,
-- calendar_id, booking_date, booking_time, booking_end_time, status` and
-- aliases every PII field as a `NULL::` literal rather than reading it. All
-- eight are granted, so the view keeps working and keeps returning rows.
--
-- ---------------------------------------------------------------------------
-- THE REMAINING RISK, AND THE FALLBACK.
--
-- Realtime is version-specific. The analysis is that WALRUS keys its row
-- visibility probe on the primary key, which is granted, so delivery survives
-- and the payload is simply narrowed to the granted columns — which is the
-- desired outcome, not a side effect. That must be confirmed against a live
-- instance with `REPLICA IDENTITY FULL` before this reaches production.
--
-- What makes the blast radius small if the analysis is wrong: neither realtime
-- consumer reads the payload. `useVenueLiveSync` keys off ids it already holds,
-- and the linked-calendar handler just calls `debouncedLoadLinkedData()`, which
-- refetches through a server route. So only DELIVERY matters, not content.
--
-- If delivery does not survive, the fallback is D1's A6: drop the linked
-- subscription and poll. Visibly degraded beats silently degraded.

REVOKE ALL ON public.bookings FROM authenticated;

-- The operational shape of a booking: enough to place a block on a calendar and
-- know its state. Nothing here identifies or describes the client.
--
-- `updated_at` is included because a realtime consumer needs to order events;
-- it is not read by the anonymised view.
GRANT SELECT (
  id,
  venue_id,
  calendar_id,
  practitioner_id,
  booking_date,
  booking_time,
  booking_end_time,
  status,
  updated_at
) ON public.bookings TO authenticated;

-- Writes stay table-level so RLS remains the thing that gates them, which is
-- what the policies are written to do and what the pgTAP suite asserts. After
-- N2/N3/N4 the only surviving write disjunct is own-venue, and no browser code
-- writes this table at all, so this grants reach that nothing currently uses.
-- Revoking it would be defence in depth; it is left in place deliberately so
-- this migration changes exactly one thing.
GRANT INSERT, UPDATE, DELETE ON public.bookings TO authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICATION — run against the environment just migrated.
--
-- 1. The pgTAP suite covers the structural claim and runs in CI:
--
--      npm run test:rls
--
--    It asserts that `authenticated` can still read a booking's time block and
--    can NO LONGER read `special_requests` from the base table.
--
-- 2. THE GATE BEFORE PRODUCTION, which no automated check here covers.
--    On staging, as a LINKED venue, open the shared calendar and have the owner
--    venue change one of its bookings. The linked column must still update live.
--    If it does not, the channel has gone silent and A6 is the answer; do not
--    ship this to production on the assumption that it will behave differently
--    there.
--
-- 3. Own-venue realtime is the same mechanism and the wider blast radius: with
--    the dashboard open, create or move a booking from another session and
--    confirm the calendar still reacts.
-- ---------------------------------------------------------------------------
