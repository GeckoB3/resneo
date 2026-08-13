# ResNeo forensic audit and adversarial review — August 2026

**Date:** 2026-08-13
**Branch:** `staging` at `73a40a27`
**Method:** nine parallel audit agents, then **two further rounds of adversarial verification** (six agents, then five), each charged with falsifying the prior round rather than confirming it.
**Status:** three review rounds complete and converging. Round two withdrew two findings, downgraded nine, added six, and rewrote eight fixes. Round three found the flagship C1 fix *still* ineffective, struck the C3 trigger as a near-term fix, and completed five C7-C13 fixes that were right in direction but each missed a case. Every change is tagged inline with the round that made it.

Nothing has been implemented. This is a report only.

---

## READ THIS FIRST

Each review round found fixes that would have broken production. They have been corrected, but the lesson generalises: **do not implement any item here without reading its "Fix" paragraph in full.** Several fixes that look like one-liners are not.

**LIVE DATABASE VERIFICATION, 2026-08-13 — STAGING *AND* PRODUCTION.** The step-0 queries were run against both. They confirm C1, H43 and N1, and found something the static audit missed entirely: **31 `SECURITY DEFINER` functions are executable by `anon` — on production as well as staging — including `admin_hard_delete_venue(uuid)`, which has no authorisation check in its body.** The two environments return the *same 31 functions*; production is exposed exactly as staging is. See C0 — it outranks every other item in this document. **Production customer data is in scope; see C0's "Was it exploited?" note.**

Three items are hard blockers on the whole plan:

0. **`admin_hard_delete_venue` is callable by anyone holding the publishable key.** See C0. Nothing else in this plan matters until it is revoked.

1. **C1's `REVOKE ... FROM PUBLIC` is not enough on Supabase — the fix as first written leaves the exploit open. NOW CONFIRMED ON A LIVE DATABASE.** Hosted Supabase grants `anon`/`authenticated` a direct EXECUTE on `public` functions via default privileges, which `REVOKE FROM PUBLIC` does not touch; the repo's own hardened import migrations revoke from all three roles for exactly this reason. The corrected C1 revokes from `PUBLIC, anon, authenticated`. This also resolves N1: the likeliest state is that `report_deposit_summary`'s existing `FROM PUBLIC`-only revoke is *applied but ineffective*, so the reports page works **and** the function stays exposed. Settle the live grant state with `information_schema.role_routine_grants` first — but do not stop investigating at "migration applied." See C1 and N1.
2. **C3 has no viable database-level fix yet.** Round two's "extend `enforce_cde_capacity`" is struck: the trigger's firing list omits `practitioner_id`/`calendar_id` (so it would not fire on the calendar-move double-book), and it inherits the full engine-semantics duplication problem — a naive branch rejects legitimate `parallel_clients > 1` bookings, gap-interleaved bookings, and a visit's own second segment. Ship only the re-validate-before-insert interim near-term. See C3.
3. **D1's column-grant fix is sound but must be smoke-tested against live Realtime before shipping.** Analysis (WALRUS keys its visibility probe on the primary key, which is granted) says delivery survives and PII is stripped from the payload — the desired outcome. But WALRUS internals are version-specific; verify on a live instance with `REPLICA IDENTITY FULL`, A6 poll fallback ready. See D1.

---

## Baseline

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `vitest run` | 328 files, 3084 tests, all passing |
| Playwright e2e | 4 specs, single-appointment happy paths only |
| **pgTAP (`supabase/tests/`)** | **Runs nowhere.** No `pg_prove` in `.github/workflows/ci.yml`, `package.json` or `scripts/` |

That last row matters: the RLS security suite has never been continuously verified, and the "green suite" figure covers none of it.

---

## Executive summary

The helper layer is careful and the comments are unusually honest. The problem is rarely that a rule was got wrong — it is that a rule was got right in one place and not carried to its siblings. Five structural themes account for most findings:

1. **No transactional integrity on any appointment write.** No database-level double-booking protection; multi-row writes are sequential with best-effort compensating deletes.
2. **Canonical helpers exist and are bypassed.** `applyAddonsToResolvedService` is called only by its own test. `bookings_linked_anonymised` has zero application references. `isGuestBookingDateAllowed` is called by four routes and skipped by two.
3. **Derived fields drift after an edit** — duration, variant snapshot, add-ons, `location_type`, `payment_state`, processing blocks, each on a different path.
4. **Client-side enforcement of server-side invariants** — `source`, `person_label` non-emptiness, add-on `min_select` on modify, target-calendar authorisation.
5. **Two paths for every operation, and they disagree** — staff vs guest, single vs visit, own-venue vs linked, per-booking vs group.

**The most urgent item remains outside the appointment flow**: `SECURITY DEFINER` reporting RPCs callable by anonymous users with the publishable key that ships in every public booking page.

---

## Critical findings

### C0. `admin_hard_delete_venue` and 30 other `SECURITY DEFINER` functions are callable by `anon`
**CONFIRMED ON STAGING AND PRODUCTION, 2026-08-13. This is the most severe finding in the document.**

> **STATUS — STAGING REMEDIATED 2026-08-13.** Migration `20270106120000_revoke_definer_function_client_grants.sql` applied to staging; the verification query returned **exactly the expected 16 rows** (8 RLS helpers, 4 report RPCs awaiting C1, 4 `auth.uid()`-scoped). All 15 targeted functions are closed to `anon`/`authenticated`, including `admin_hard_delete_venue`, `lookup_auth_user_id_by_email`, `merge_guests_into` and both `linked_apply_booking_*`. **Production is still exposed** — same migration, not yet applied. Residual on staging: the 4 report RPCs leak per-venue *aggregates* (covers, no-show rates, cancellations, deposit totals) until C1's `staff.db` switch ships; the guest-PII function `report_frequent_visitors` is already closed.

The step-0 sweep returned 31 `SECURITY DEFINER` functions in `public` with `has_function_privilege('anon', …, 'EXECUTE') = true`. Every ACL shows the same shape — `anon=X/postgres, authenticated=X/postgres` — i.e. **direct per-role grants from Supabase's default privileges**, which no `REVOKE … FROM PUBLIC` has ever touched.

**Root cause, now proven rather than inferred.** `report_deposit_summary`'s ACL is the control case: it alone lacks the `=X/postgres` (PUBLIC) entry, because `20270101120400` really did revoke PUBLIC — and `anon=X` and `authenticated=X` survived regardless. That migration was a **security no-op**, and by extension so were the other ~27 `FROM PUBLIC`-only revokes in the migration history, including the ones on `lookup_auth_user_id_by_email`, `linked_apply_booking_insert/update`, and `admin_hard_delete_venue` itself.

**The worst of them, with bodies verified:**

| Function | Guard in body | Effect of an anon call |
|---|---|---|
| `admin_hard_delete_venue(uuid)` | **none** — only `'venue id required'` and `'venue not found'` | Permanently destroys any venue and everything cascading from it |
| `terminate_account_links_for_venue_deletion(uuid)` | none beyond null-check | Severs any venue's partner links, writing termination records |
| `merge_guests_into(uuid,uuid,uuid[])` | not verified | Destructive cross-tenant guest merge |
| `linked_apply_booking_insert/update` | audit GUCs only | Writes bookings into any venue, bypassing every app-layer check |
| `lookup_auth_user_id_by_email(text)` | **none** — bare `SELECT id FROM auth.users WHERE email = …` | Email → user-id oracle over the entire `auth.users` table |
| `platform_venue_booking_stats`, `platform_venue_health_stats` | none | Whole-platform business metrics for every venue |
| `increment_sms_usage(...)` | not verified | Inflate any venue's SMS billing counters |
| the six `report_*` + `report_deposit_summary` | none | The C1 PII dump |
| `consume_class_credits_atomically(...)` | none | H43 — burn any user's prepaid credits |

**DO NOT blanket-revoke the 31.** Eight of them are RLS helper functions — `current_staff_venue_ids`, `caller_staff_venue_ids`, `caller_staff_admin_venue_ids`, `link_action_grant`, `link_calendar_grant`, `link_pii_grant`, `link_calendar_allows`, `get_linked_booking_source`. They are invoked *inside policy evaluation as the querying role*, so revoking their EXECUTE from `authenticated` would break every RLS policy that references them and lock the entire dashboard out. They are parameterised on the caller's own identity and return empty for `anon`; leave them alone.

**Fix — the correct revoke pattern, applied per function:**

```sql
REVOKE ALL ON FUNCTION public.admin_hard_delete_venue(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_hard_delete_venue(uuid) TO service_role;
```

Three tiers:
- **Revoke from `anon` + `authenticated`, grant `service_role`:** `admin_hard_delete_venue`, `terminate_account_links_for_venue_deletion`, `merge_guests_into`, `linked_apply_booking_insert`, `linked_apply_booking_update`, `lookup_auth_user_id_by_email`, `platform_venue_booking_stats`, `platform_venue_health_stats`, `increment_sms_usage`, `refresh_guest_booking_aggregates`, `consume_class_credits_atomically`, and the seven `report_*` functions (drop `report_frequent_visitors` — zero callers).
- **Revoke from `anon` only, keep `authenticated`:** `claim_user_account`, `request_account_deletion`, `cancel_account_deletion`, `touch_user_last_active`, `guest_email_collides_for_user_change` — these are `auth.uid()`-scoped and legitimately called by signed-in users. Verify each is a genuine no-op for a null `uid` before relying on that.
- **Leave alone:** the eight RLS helpers above.

**Durable fix, so new functions stop inheriting this:**
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
```
This makes future migrations fail closed — any function genuinely needing client access must then grant it explicitly, which is the correct posture. It is a behaviour change: audit existing client-called RPCs before applying it.

**Also verified live (both environments):** `anon` holds SELECT on `unified_calendars` under `USING (is_active = true)`, so the venue-id harvest leg of the C1 exploit chain is confirmed reachable. The full chain works end to end on production.

**One environment divergence, cosmetic.** `admin_hard_delete_venue` retains its PUBLIC grant on staging (`=X/postgres` present) but not on production. Most likely explanation: `20260518120000` does `DROP FUNCTION IF EXISTS admin_hard_delete_venue(uuid)` and recreates it, and a `DROP`+`CREATE` resets the ACL to defaults — so whether the earlier `REVOKE ... FROM PUBLIC` survives depends on rebuild history. It changes nothing about exposure: both environments carry `anon=X` and `authenticated=X`, so the function is equally callable on each. It is worth recording only as evidence that migration-derived grant state genuinely diverges between environments, which is why step 0 must be run per environment rather than inferred.

**Was it exploited?** Unknown, and worth establishing rather than assuming. `report_frequent_visitors` returns guest names, emails and phone numbers; `lookup_auth_user_id_by_email` reads `auth.users`; `admin_hard_delete_venue` destroys venues. All were anon-callable on production for an unknown period. Before closing this out, search the Supabase edge/PostgREST logs for `/rest/v1/rpc/` hits naming any function in C0's revoke list — particularly from IPs that are not your own infrastructure. Log retention is finite, so do this while the window is still open. If guest PII was read by a third party, that is a personal-data breach with notification obligations under UK/EU GDPR, and the decision to notify is the venue operator's and yours to take on advice, not one this document can make.

### C1. Anonymous cross-tenant PII dump via `SECURITY DEFINER` report RPCs
**CONFIRMED — and worse than first stated.**

Six RPCs are `SECURITY DEFINER`, take a caller-supplied `p_venue_id`, perform no authorisation check, and retain default `PUBLIC` EXECUTE: `report_frequent_visitors`, `report_client_summary`, `report_booking_final_statuses`, `report_booking_summary`, `report_cancellation`, `report_no_show_series`. `report_client_summary`'s `GRANT … TO authenticated, service_role` does not remove PUBLIC's grant.

**All six are `STABLE`**, so PostgREST also exposes them over **GET** — the exploit is a query string, not just a POST body. Venue ids are harvestable via `public_read_unified_calendars` (`TO anon USING (is_active = true)`, `venue_id NOT NULL`).

**Fix — REWRITTEN TWICE. Round two's version (`REVOKE ... FROM PUBLIC` + `service_role`) is itself insufficient on Supabase and would ship with the exploit still open.**

Caller reality, verified across the whole repo — only `reports/route.ts` calls any of them:

| RPC | Caller | Client |
|---|---|---|
| `report_booking_summary` | `:605` | session (`authenticated`) |
| `report_no_show_series` | `:606` | session |
| `report_cancellation` | `:607` | session |
| `report_deposit_summary` | `:608` | **session — but already `service_role`-only. See N1.** |
| `report_client_summary` | `:614` | `staff.db` (admin) |
| `report_frequent_visitors` | **none anywhere** | — |
| `report_booking_final_statuses` | none (called only from inside other definer functions, i.e. as owner) | — |

**Why `FROM PUBLIC` alone does not close it (round three).** Hosted Supabase grants `anon` and `authenticated` a direct EXECUTE on functions created in `public` via project default privileges. `REVOKE ... FROM PUBLIC` removes only the `PUBLIC` grant, not those direct role grants. The repo proves the team already knows this — the two hardened import migrations revoke from all three roles explicitly (`20261218120000_import_booking_tx.sql:55-57`, `20261226120100_import_guest_tx.sql:55-57`), and those extra two lines would be pointless if `FROM PUBLIC` sufficed. Meanwhile `report_client_summary` carries an *additive* `GRANT ... TO authenticated` (`20260429120000:78`). Across all 253 migrations only **2** revoke from `anon`; **28** revoke from `PUBLIC` only — every one of those 28 is suspect and worth the same live audit.

Correct fix — revoke from all three roles on all six functions **plus `report_deposit_summary`** (its round-two `FROM PUBLIC`-only revoke is the likeliest N1 culprit), grant `service_role` only where an app caller exists, and drop the caller-less function:

```sql
-- pattern, applied to all six report_* functions AND report_deposit_summary:
REVOKE ALL ON FUNCTION public.report_client_summary(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.report_client_summary(uuid,date,date) TO service_role;
-- report_frequent_visitors: DROP FUNCTION — zero callers anywhere.
-- report_booking_final_statuses: revoke only; it is invoked solely from inside other
--   SECURITY DEFINER functions (as owner), so it needs no role grant.
```

Then switch `reports/route.ts:605-608` from the session client to `staff.db`. **Deploy ordering matters:** `service_role` holds the current default grant, so ship the `staff.db` code switch **first**, verify `/api/venue/reports` returns 200, then apply the REVOKE migration. Bundling both in one deploy risks the migration landing before new lambdas roll, 500ing the reports page during the window.

**Do not** add an in-function `current_staff_venue_ids()` guard *and* switch to `staff.db` — mutually exclusive (`service_role` carries no JWT email, so the guard raises), and five of the six are `LANGUAGE sql` so the guard isn't writable without a plpgsql rewrite. The `staff.db` switch is sufficient because the route already gates `requireAdmin` at `:578` and passes `staff.venue_id`.

### C2. `waitlist_entries` is anon-readable across every venue
**CONFIRMED.** `public_read_own_waitlist … TO anon USING (true)` at `20260308000001_availability_engine_overhaul.sql:292-295`; `public_insert_waitlist … WITH CHECK (true)` at `:287`. The table holds `guest_name`, `guest_email`, `guest_phone`, `notes`, and the appointment waitlist reuses it.

**Fix — VERIFIED SAFE, unchanged.** Drop both anon policies. All 28 references in `src/` go through `getSupabaseAdminClient()`; the only client-side use is a realtime subscription in `WaitlistPageClient.tsx:384` covered by `staff_manage_waitlist`. No embed or widget surface touches the table. Nothing breaks.

### C3. No database-level protection against double-booking
**CONFIRMED, all four legs.** Zero `EXCLUDE USING` / `btree_gist` / `tstzrange` across 253 migrations. `20261225120000_cde_capacity_guards.sql:125` is literally `-- Appointment / table rows: not governed here. / RETURN NEW;`. No advisory lock on any appointment path. Validate at `create/route.ts:1169`, insert at `:1820`.

**Fix — the original (`EXCLUDE USING gist`) was wrong; the first correction (a single advisory-lock RPC) is IMPOSSIBLE AS STATED.**

Why `EXCLUDE` is wrong: `unified_calendars.parallel_clients` defaults to 1 but can be higher; processing-time gaps release the practitioner mid-service so occupancy is a *set* of intervals; and `booking_end_time` is a bare `time` that deliberately wraps past midnight.

Why the RPC is impossible as described:

- **A visit is N rows inserted in a loop**, each in its own transaction ([create-multi-service/route.ts:638](src/app/api/booking/create-multi-service/route.ts:638)). A per-row `pg_advisory_xact_lock` releases between segments, and a chain's segments routinely sit on **different** calendars, so "lock the calendar id" does not name one lock.
- **There are nine route-level appointment-creating write sites plus the linked-insert RPC, not four**: `create`, `create-multi-service`, `create-group`, `venue/bookings` (×2), `walk-in` (×2), `venue/waitlist`, `visits/[groupBookingId]/services`, plus `linked_apply_booking_insert`.
- **Occupancy is not derivable from the `bookings` row.** There is no `buffer_minutes` column; the engine re-merges from the catalogue and per-calendar link. Re-checking in SQL means duplicating `mergeAppointmentServiceWithPractitionerLink`, `resolveEngineBookingProcessingBlocks`, `validateProcessingTimeBlocks`, `practitionerBusyMinuteOffsets`, `peakConcurrentBookings` and `parallelCapacityFor` — and phantom bookings are in-request constructs with no rows, so SQL can never see them.

**Round three struck the "extend `enforce_cde_capacity`" fix.** It relocates the semantics problem rather than solving it, and it silently misses the commonest gesture:

- **The trigger's firing list omits `practitioner_id` and `calendar_id`** — it is `BEFORE INSERT OR UPDATE OF status, party_size, booking_date, booking_time, booking_end_time, experience_event_id, class_instance_id, resource_id` (`20261225120000:135-136`). An appointment overlap branch keyed on the practitioner would **never fire on a pure calendar move** — dragging a booking to a colleague's column at the same time (the C8/C9 gesture) changes `practitioner_id`/`calendar_id`, not the time. The guard would exist and skip the write it most needs to catch.
- **A naive branch false-rejects three legitimate patterns.** A `[booking_time, booking_end_time)` overlap check (modelled on the resource branch) raises `23P01` on: a legitimate `parallel_clients > 1` calendar; a booking placed inside another's processing gap; and **a visit's own second segment**, because segment k's trigger sees segments 1..k-1 as committed rows — which breaks the multi-service create flow outright. A correct branch must port `practitionerBusyMinuteOffsets`, `peakConcurrentBookings`, `parallelCapacityFor` and the duration/buffer re-merge into plpgsql — the exact duplication that disqualified the RPC. A trigger is SQL against the same rows; it does not escape the problem.
- **There is no appointment-branch 409 handler to extend.** The `23P01` handlers live *inside* the event/class/resource branches (`create/route.ts:1831-1843`, `venue/bookings/route.ts:444,664,913`); the appointment branch has none, so an appointment `23P01` falls through to the 500 at `create/route.ts:1845`. Adding one is a route change, contradicting "no route rewrite."

**Near-term fix — the interim only:** re-run `computeAppointmentAvailability` immediately before the insert at every write site, and narrow the create rate limit. This shrinks the window from hundreds of milliseconds to single digits. It does **not** close the race and must not be described as doing so.

**If a real guard is pursued later** it must (a) add `practitioner_id, calendar_id, appointment_service_id` to the trigger's `UPDATE OF` list, (b) port the engine's occupancy semantics into plpgsql, and (c) add appointment-branch `23P01→409` mapping at every write site. That is a scoped project, not a step in this plan. (The bullet above lists nine route-level insert sites plus `linked_apply_booking_insert`, not "seven" — the round-two count was wrong.)

### C4. A linked venue can steal the owner's bookings by re-parenting `venue_id`
**CONFIRMED, severity qualified.** `WITH CHECK`'s first disjunct passes once `venue_id` is B's. No trigger blocks it — notably `trg_enforce_cde_capacity` is `BEFORE INSERT OR UPDATE **OF** status, party_size, booking_date, booking_time, booking_end_time`, so a `venue_id` change does not even fire it. The audit trigger's early return (`20260920120000:51-54`) waves it past.

**Qualification:** the `USING` clause requires `link_action_grant(venue_id) IN ('edit_existing','create_edit_cancel')`. A `time_only` or `act: none` partner cannot do this. The original headline implied any linked venue could.

**Sharpening:** the hardened trigger *raises* for a cross-venue write that keeps `venue_id = A`. So re-parenting is the **only** way through — the early return waves past exactly the write the rest of the function exists to stop.

**Fix — REPLACED with something strictly narrower than D1.** A `venue_id` immutability trigger:

```sql
CREATE FUNCTION public.bookings_venue_id_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION 'bookings.venue_id is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bookings_venue_id_immutable
  BEFORE UPDATE OF venue_id ON public.bookings FOR EACH ROW
  EXECUTE FUNCTION public.bookings_venue_id_is_immutable();
```

Verified safe: `linked_apply_booking_update` writes a fixed column list excluding `venue_id`; no update payload in `src/` contains `venue_id`; no migration sets it. Unlike D1 this **also protects the admin-client routes**, which bypass RLS entirely — and it touches no realtime consumer and breaks no test.

### C5. `time_only` and `pii=false` linked venues can read every booking column
**CONFIRMED, and severity RAISED.** The base SELECT policy has no column restriction; `link_pii_grant` is consulted only for `guests`, never for `bookings`. The anonymised view is `security_invoker = true`, so it grants nothing beyond base-table RLS, and has zero application references.

**Raised because the app itself opens the leak.** `PractitionerCalendarView.tsx:3556-3574` subscribes to `postgres_changes` on `bookings` filtered to the **linked** venue. Realtime delivers the **whole row**. A `time_only` partner's dashboard is already receiving guest emails, phones, `special_requests`, `dietary_notes` and `internal_notes` over the WebSocket on every change to the owner's diary, with no action taken. **API-layer redaction cannot close this.** See D1.

### C6. `/summary` returns un-redacted bookings and the UI prefers it
**CONFIRMED verbatim, both halves**, with one aggravation the first pass missed: `BookingDetailPanel.tsx:262` also calls `primeVenueBookingDetail`, so the un-redacted payload is written into the shared cache and re-served on the next open with no further fetch.

**Bounded correctly:** reachable only by partners holding an accepted link covering that calendar, not "anyone".

**Fix — SAFE.** Add the two gates the sibling GET already has. `isOwnVenue` short-circuits both helpers, so own-venue behaviour is unchanged. Fix the panel's swallowed 403 too, or the next divergence re-opens it. No test covers either file.

### C7. "Accept with changes" lets the recipient seize access unilaterally
**CONFIRMED.** `permissions.ts:319` settles the semantics: *"Grant authored by each venue (what that venue exposes to the other)."* The accepter writes `theirs` and the link goes live in the same update. `respondLinkSchema` imposes no ceiling. The notification diffs only the accepter's own direction, so an untouched `mine` produces empty bullets and a generic "accepted" email.

**Fix — NEW (the first pass proposed none), verified sound with one added guard.** Use machinery that already exists: on `accept_with_changes`, apply only `mine` to the accepter's own columns; if `theirs` differs from the requester's original, write it to `pending_change` — the exact shape `propose_change` already uses (`route.ts:311-319`), which requires the counterparty's `accept_change`. `EditPermissionsModal` already implements this same asymmetry mid-link, so the accept flow just becomes consistent with it. **Added guard (round three):** validate `isLinkConfigurationValid` on the *interim* pair (new `mine`, requester's original `theirs`), not only the proposed pair — otherwise an accepter can lower `mine` to `none` while deferring `theirs`, leaving the live link none/none (and permanently so if the requester later rejects). Also fix the email to diff the requester-facing direction. No test covers this route.

### C8. Non-admin staff can move any booking onto a colleague's calendar
**CONFIRMED, and more reachable than first stated.** `practitioners/route.ts:326` filters to managed calendars only when `roster` is absent — and the calendar fetches `?roster=1`. So all columns render and the drag is a normal gesture, not a crafted request.

**Fix — REWRITTEN. The original would have 403'd almost every PATCH.** `venue-auth.ts:415-417` returns failure *before* the admin bypass when no calendar id is passed, so status changes, notes edits and deposit edits would all break for every role. It would also 403 every non-admin cross-venue move, because `scopeVenueId` is the **owner** venue where venue B's staff hold no calendars.

Correct placement is inside the existing `if (body.practitioner_id && isAppointment)` block at `route.ts:2482`, mirroring the validate route:

```ts
if (body.practitioner_id && isAppointment) {
  if (isOwnVenue) {
    if (staff.role !== 'admin') {
      const access = await requireManagedCalendarAccess(
        admin, scopeVenueId, staff, body.practitioner_id as string,
        'You can only move bookings onto calendars assigned to your account.');
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
    }
  } else if (!linkedGrantAllowsCalendar(linkedGrant, false, body.practitioner_id as string)) {
    return NextResponse.json({ error: '…' }, { status: 403 });
  }
}
```

No test breaks — there is no test for this PATCH route.

### C9. Press-and-hold on a booking reschedules it to the slot under your finger
**CONFIRMED on all three legs, against the dnd-kit 6.3.1 source. Framing OVERSTATED — it is not silent.**

- Timer activation with no movement: `core.cjs.development.js:1464-1468` — `setTimeout(this.handleStart, delay)`. Confirmed.
- `over` is populated: `pointerCoordinates` is the pointer-down position at `translate = 0`, not null. `handleDragStart` sets `dragBooking`, which flips `ignoreBookings` and re-enables the slots under the card. Confirmed.
- The gate is skipped: `target` null → `target?.invalid` undefined → falsy. `patchBookingMove` then sends `allow_manual_overlap: true`, disabling the server check too. Confirmed.
- Tolerance is 10px and `hasExceededDistance` uses Euclidean distance, so sub-10px tremor does not cancel. Confirmed.

**What was wrong:** `beginScheduleEditFollowUp` puts a notify/skip/undo panel on the bar with a live 60-second countdown (`BOOKING_MODIFY_NOTIFY_DEFER_MS = 60_000`) and records an undo entry. **Correct framing: an un-gated write with a 60-second recall window**, not a silent reschedule. The DB write is still immediate and conflict-unchecked.

**Fix — NEW.** Make the no-target case a no-op: `if (!target || target.invalid) return;` at `PractitionerCalendarView.tsx:5362`. Strictly safer than a delta-based guard, which would still let a 1px twitch through the `CALENDAR_MOVE_INCREMENT_MINUTES = 1` path. No test breaks.

### C10. Pressing Save on an untouched Modify form moves the visit
**CONFIRMED on the primary limb. Two framing claims WRONG; second limb downgraded to Speculative.**

Every mechanical leg checks out: `fetchGroupVisitBookings` sends only the group id; the list route drops cancelled rows only for `view=calendar`; cancelled rows reach `visit.segments` unfiltered; `StaffVisitModifySegment` carries no status so the form *cannot* filter; `scheduleChanged` goes false; the server re-plans from `SCHEDULED_STATUSES` and emails on `visitStartChanged`.

**Wrong:** "no notify panel, no undo, no confirmation." A confirmation **is** rendered — `visitRelayNotice` at `StaffAppointmentModifyForm.tsx:1173-1175` — and it is the sole reason Save is enabled at all (`saveDisabled` includes `!hasChanges && !visitRelayNeeded && !servicesChanged`). The real defect is that it says *"This visit has N minutes of dead time in it"* instead of naming the time move.

**Downgraded:** the `durationMinutes = 150` limb requires the on-open dry run to **throw**; a non-`ok` response returns early. Speculative.

**Fix — REWRITTEN. Do not add a status filter to `fetchGroupVisitBookings`.** Cancelled segments are deliberately displayed by the "Services in this visit" card and re-fetched after every cancel — filtering there makes the segment staff just cancelled *vanish*. Instead: add an **optional** `status` to `StaffVisitModifySegment` (optional, or `tsc` fails on the statusless test fixtures), populate it at the one build site (`ExpandedBookingContent.tsx:2354`), and **filter inside the `visitSegments` memo** (`StaffAppointmentModifyForm.tsx:221-225`) — not only in the two named derivations, because `notifyBookingId` (`:236`) and the duration baselines (`:260-270`) also read the unfiltered list, and anchoring the guest notification to a cancelled row is its own bug (round three). Mirror the server's exact `SCHEDULED_STATUSES` list (`Pending, Booked, Confirmed, Seated`); absent status defaults to scheduled so the 14 visit tests stay green. Filtering the memo changes `isVisit` for a visit reduced to one scheduled segment (it opens in single-booking mode) — defensible, but a deliberate choice. Separately, make `visitRelayNotice` name the time move.

### C11. Cancelling one group attendee refunds the entire group's deposit
**CONFIRMED. One claim WRONG, and the original fix would have caused a worse bug.**

Shared PI confirmed (`create-group/route.ts:726-750`, one intent for the total, linked to every row). Amount-less refund confirmed. The per-row deadline variant holds.

**Wrong:** "only the cancelled row is stamped `Refunded`; siblings keep `Paid`." The `charge.refunded` webhook loads **every** booking on the PI and stamps them all (`webhooks/stripe/route.ts:829-886`). Within seconds every sibling reads `Refunded` while still `Booked`.

**Fix — REWRITTEN, four parts in this order:**

1. **First**, gate the bookings branch of `charge.refunded` on `chargeFullyRefunded`, matching its two siblings at `:790` and `:818` which both bail on partial refunds. Without this, passing `amount` converts an over-refund into silent accounting corruption across surviving members (and `restoreAndReleaseClassBookings` at `:896` even frees their class seats). Gating does not orphan the cancelled row's own `Refunded` stamp — all three cancel flows stamp their own rows directly (`staff-cancel-booking.ts:153`, `bookings/[id]/route.ts:1005`, `confirm/route.ts:632`).
2. Then pass **`amount` = Σ `deposit_amount_pence` over the rows actually cancelled, restricted to `deposit_status = 'Paid'`** (the `paidDepositIds` set already exists for this). Paid-only matters twice: NULL card-hold rows must not count, and a sibling refunded individually earlier still carries its `deposit_amount_pence`. A full party/visit/cart cancel still fully refunds, because the paid-row sum equals the PI total.
3. **Fourth refund site — round three, do not miss it:** `deposit/route.ts:356-361` (staff "refund deposit" for non-hold rows) *also* refunds the whole shared PI amount-less for a single group member, with no `deposit_status` re-entry guard. After part 1 lands, this becomes a **silent** over-refund (siblings keep `Paid`, money gone). It needs the same paid-row-sum amount and guard, in this same window. The round-two fix text named only three sites and missed it.
4. Add an idempotency key **over `PI + sorted(idsToCancel)`, namespaced away from the card-hold fee refund** (`deposit/route.ts:298` — same booking, *different* PI, so a shared `refund:${bookingId}` template collides and fails the legitimate fee refund inside Stripe's 24h window). A per-`bookingId` key also fails to dedupe a crash-retry through a different visit segment, now that partial refunds no longer self-block via `charge_already_refunded`.

**The guest path is built from scratch** — `/api/confirm` has zero `group_booking_id` references, refunds the whole PI amount-less (`:592`), and cancels only the clicked row. It needs the resolver's cascade semantics *and* the `charge_already_refunded` convergence at `:603` redesigned for partial refunds. `staff-cancel-booking.test.ts:7` mocks `stripe.refunds.create` with no argument assertions and never reaches `canRefund`, so the amount/key changes break nothing there — **add a fixture that asserts the `amount`** or the fix is unfalsifiable.

**C11 does not depend on D2, but it is coupled to C12** — both rewrite the refund/cascade block in `staff-cancel-booking.ts`. Deriving the amount from the resolver's `idsToCancel` (paid rows) makes them compose in either order; hardcoding "whole intent" for visits does not, because C12 later narrows the cascade and would resurrect the over-refund for a party.

### C12. Class-cart purchases are misclassified as visits
**CONFIRMED, and broader than first stated.** Cart rows share one group id and carry no `person_label`, so `resolveCascadingVisitGroupId` returns the cart id. The no-show cascade hits **future** sessions — `loadGroupBookingSiblings` applies no status and no date filter. `class_booking_groups` has exactly two references in the codebase, both in the writer; nothing reads it.

**Under-stated:** `cancelStaffBookingWithNotify` skips the resolver entirely, so it also cascades across a genuine **multi-person party** — the exact class of bug the resolver exists to stop.

**Fix — REPLACED with something far cheaper that needs no migration.** A cart row is a *class* row; a multi-service visit never is. Add `class_instance_id` to the `loadGroupBookingSiblings` projection and tighten the resolver:

```ts
rows.every((r) => !r.person_label?.trim() && !r.class_instance_id)
```

Existing resolver-test fixtures carry no `class_instance_id`, so `group-booking-status-sync.test.ts` stays green. The predicate is falsification-proof: no legitimate visit or party row ever carries `class_instance_id` (verified across all five group-id writers), and cart rows always set it (both class inserters take it as a required param and 404 before insert without it).

**Correction to the round-two claim (round three):** routing `cancelStaffBookingWithNotify` through the resolver does **not** keep `staff-cancel-booking.test.ts:123` green — that helper has its own inline sibling query (not `loadGroupBookingSiblings`), and the test's mock only resolves at `.in()`, so the resolver's shorter chain returns `undefined` and the cascade collapses. The behaviour is correct; the *test* must be extended in the same commit. Two further traps: the helper's own query at `staff-cancel-booking.ts:96` selects **neither `class_instance_id` nor `person_label`**, so it must gain both columns or the tightened predicate reads every row as `undefined` and cascades *parties* — which, with C11's summed amount, refunds a whole party's PI on one attendee's cancel. And it selects no `stripe_payment_intent_id`/`deposit_amount_pence`, so use the resolver only for the *cascade decision* and keep the inline money query for the refund. Add a class-cart fixture (`class_instance_id` set) so the discriminator is actually exercised.

### C13. Guest self-reschedule launders a non-refundable deposit
**CONFIRMED end to end, and broader. One sentence WRONG.**

`guest_self_reschedule` is default-on (`resolve.ts:20-22`). No guard blocks the reschedule: the only status gate is `modifiableStatuses`, and the route's own comment states *"there is no per-booking modify window"*. The manage link survives — `confirm_token_used_at` is set by confirm and cancel, never by modify. The refund then succeeds.

**Wrong:** "`booking.cancellation_deadline` appears in that file only as a value being written, never as a guard." It **is** a guard at `confirm/route.ts:568-570` in the cancel path. The intended claim — never a guard *in the modify path* — is correct.

**Broader:** all three guest modify branches overwrite the deadline with no old-deadline guard (appointments `:1537`, resource `:1036`, class `:1228`). One defect in three places.

**Fix — NEW, with two caveats (round three).** Capture the pre-modify deadline and preserve it when it has already passed, so a late reschedule cannot improve the refund policy the guest earned; a not-yet-passed deadline still takes the recomputed (later) value, so legitimate within-window reschedules keep working. Apply at all three guest branches and mirror at `venue/bookings/[id]/route.ts:2460`. **Caveat 1:** these sites rewrite `cancellation_policy_snapshot` in the same update — when the deadline is preserved, the snapshot must be preserved with it, or the row promises "full refund if cancelled N+ hours before" while its deadline denies it. **Caveat 2 (policy call):** mirroring at the staff route means a venue-initiated goodwill reschedule of a post-deadline booking can no longer restore refundability — a deliberate behaviour change for staff, not just guests. Scope preservation to rows with a refundable deposit so depositless bookings don't display a stale passed deadline.

---

## New findings from the verification pass

**N1. RESOLVED by live query, 2026-08-13 — state (c) confirmed.** `report_deposit_summary`'s ACL on staging is `{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}` — uniquely among the eight, it has **no `=X/postgres` (PUBLIC) entry**. So `20270101120400` was applied, its `REVOKE … FROM PUBLIC` worked exactly as written, and it achieved **nothing**: `authenticated` and `anon` keep direct default-privilege grants. Consequences: `/api/venue/reports` is **not** 500ing (no P0 there), the function **is** still anon-exposed, and this row is the proof of the systemic root cause in C0. Closed by the C0/C1 revoke pattern.

**N2. Unaudited cross-venue DELETE.** `linked_venue_can_delete_bookings` permits a `create_edit_cancel` partner to delete the owner's bookings from the browser — and `cross_venue_booking_audit_trigger` is `AFTER INSERT OR UPDATE` with **no DELETE branch**, so there is no audit row and no notification. Strictly worse than C4: C4 re-parents a row that still exists. **High.**

**N3. Unvalidated cross-venue INSERT.** `linked_venue_can_insert_bookings` lets a `create_edit_cancel` partner insert arbitrary rows into the owner's venue from the browser, bypassing availability, deposits, compliance and capacity, with `status` and `internal_notes` freely settable. Audited, but not prevented. **High.**

**N4. `linked_venue_can_view_guests` is not calendar-scoped.** It checks `link_calendar_grant = 'full_details' AND link_pii_grant` but **omits `link_calendar_allows`**. The §18 migration updated all four `bookings` policies and left `guests`, `practitioners` and `appointment_services` unscoped. A chair-rental link scoped to one calendar with PII on exposes **every guest of the host venue**. **High.**

**N5. Realtime delivers full booking rows to `time_only` partners.** See C5. **High.**

**N6. The un-redacted `/summary` payload is primed into a shared client cache.** See C6. **Medium.**

---

## Withdrawn and downgraded findings

**Withdrawn as WRONG:**

- **H6** (per-calendar duration override clobbers add-on minutes) — the unified fetcher deliberately sets `custom_duration_minutes: null` with a 15-line comment describing this exact bug as already fixed (`appointment-engine.ts:1517-1532`). Live on the legacy path only, which is dead code. **"Fixing" this would reintroduce the documented regression.**
- **H44** (revoked staff retain RLS access) — **no code path anywhere writes `staff.revoked_at`.** Staff removal is a hard `DELETE` (`staff/[id]/route.ts:104-115`), which closes the row-existence predicate instantly. The missing filter is a latent hardening gap guarding a state the product cannot enter. **High → Low.** The register cross-check row for `S-04` ("still open and worse") is corrected accordingly.

**Reclassified as DELIBERATE:**

- **H17** (visit swap pins the price) — carries an explicit comment: *"The visit keeps the price it was quoted… which is not what changing a service is for."* The residual defect is narrower: pinning also freezes later add-on changes out of the total. **High → Medium.**
- **H1** (`allowSameDayBooking` never read) — the engine ignoring it is the design, pinned by `appointment-engine.test.ts:146`. The date rule lives in `isGuestBookingDateAllowed`. The real residual is that `create-group` and `create-multi-service` never call it, so `max_advance_booking_days` and the same-day rule are unenforced **on those two write paths only**. **High → Medium**, and the fix is two lines in two routes, not an engine change.
- **H13** (cross-midnight) — the engine's no-wrap is deliberate and commented; wrapping would turn stale rows into 23-hour blocks. Fix the **writers** first.
- **H49** — the trigger's early return is commented as an intentional division of labour, and the inverted-span limb is **resource-only**; the appointment path is explicitly hardened. **High → Medium.**

**Other severity moves:**

| ID | From | To | Reason |
|---|---|---|---|
| **H38** | High | **Critical-adjacent** | Because the overlap check is gated on `appointmentServiceId`, every cross-venue booking creatable today is written with **no availability validation at all**. A live double-booking path with an identified trigger, unlike C3's race. |
| H5 | High | Medium | Off-grid start times only; fixed start times and all availability gates still apply. |
| H10 | High | Medium | "Always fails" is wrong — only shrinks past the last gap's end. |
| H23 | High | Medium | Paid rows are already blocked from removal by an explicit money check. |
| H46 | High | Medium | `phone`-source card holds **are** caught by sweep 1; only online/walk-in sources stick. |
| H43 | High | High | Unchanged, but fold into the C1 pass — same one-line `REVOKE`, no application caller. |

**Corrections to secondary claims:** H3 is 21 external call sites, not 24, and `formatRefundDeadlineIso` *also* hardcodes `Europe/London` (so display and computation are consistently wrong together). H4's contrast is false — the legacy fetcher filters `is_active` too; the unified one additionally narrows to `calendar_service_assignments`, so unassigning a service from a column has the same effect. H14 is **three separate defects**, not one root cause found four times: a client omission (the staff **server** already re-validates correctly), a route with no add-on concept at all (`/api/confirm`), and the visit swap. H21's helper never claimed to be a modify-path refresher. H29's line has drifted to `:75`.

---

## Two design decisions

### D1. The linked-venue RLS boundary — REVISED, was UNSAFE

The original recommendation (drop the linked disjuncts from two `bookings` policies) was wrong in three ways.

**It would silently kill a live feature.** `PractitionerCalendarView.tsx:3556-3574` opens a browser-client channel per linked venue, filtered `venue_id=eq.<linkedVenueId>`, with a comment stating the dependency: *"RLS gates delivery — the caller receives an event only for a row a link lets them see."* Drop the SELECT disjunct and the channel subscribes successfully and never fires. `channel.subscribe()` has no status callback: no error, no console warning, nothing in Sentry. Linked columns freeze until the user changes date. For chair-rental venues that means two people double-booking one room.

**It names two of four policies.** INSERT (N3) and DELETE (N2) survive, and DELETE is worse than the C4 it claims to close.

**It closes only half of C5** — `linked_venue_can_view_guests` (N4) is untouched.

The first pass also over-claimed that `security_invoker` proves the spec is wrong. The mechanics are right, but the view's real bug is that it has **no `WHERE` clause of its own**; a `security_definer` view with its own predicate would be a genuine control. It is still not the answer here, because **realtime binds to a table and cannot subscribe to a view**.

**Revised recommendation:**

- **A1.** Drop the linked disjunct from all **three write** policies (edit, insert, delete), so `linked_apply_booking_*` becomes the sole cross-venue write path — which is what the architecture already intends. **Correction from the live query (2026-08-13):** the premise that those RPCs are already "`service_role`-only" is **false**. Their ACLs show `anon=X, authenticated=X`; their `REVOKE … FROM PUBLIC` was another no-op. A1 therefore only achieves its purpose if the C0 revoke lands first — otherwise dropping the RLS write policies just redirects a determined caller from PostgREST table writes to the equally-open RPC. **C0 is a hard prerequisite for A1.**
- **A2.** **Keep** `linked_venue_can_view_bookings` — realtime needs it — and narrow its reach with **column-level grants**, which are checked before RLS and cannot be forgotten at a call site:
  ```sql
  REVOKE ALL ON public.bookings FROM authenticated;
  GRANT SELECT (id, venue_id, calendar_id, practitioner_id, booking_date,
                booking_time, booking_end_time, status, updated_at) ON public.bookings TO authenticated;
  GRANT INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
  ```
  This closes C5 and N5 structurally. **Verify against `REPLICA IDENTITY FULL` that realtime delivery still works with the narrowed grant**; if not, fall back to A6.
- **A3.** Extend `cross_venue_booking_audit_trigger` to `DELETE` (needs an `OLD`-aware branch; the early `NEW.venue_id` guard will NPE otherwise).
- **A4.** Add `link_calendar_allows` to `linked_venue_can_view_guests`, or apply the same column reduction (N4).
- **A5.** Rewrite `supabase/tests/linked_accounts_rls_test.sql` in the same commit and **wire it into CI**. Round three corrected the failure accounting: **exactly three assertions fail** — tests 4, 5 and 21 (the direct-PostgREST cross-venue UPDATE/INSERT that A1 removes). The round-two "four vacuous view passes" claim was wrong — A2 keeps the rows visible and grants every base column the anonymised view reads (its PII columns are `NULL::text` literals, not column reads), so tests 10-13 pass **genuinely**; test 20 passes for a new reason (own-venue `WITH CHECK` denial). Update `plan(22)`.
- **A6.** If A2 proves incompatible with realtime, delete the linked subscription and poll instead — visibly degraded beats silently degraded.

**The D1 corollary is WITHDRAWN.** Making `loadStaffAccessibleBooking` return a pre-redacted booking would strip `special_requests` and `dietary_notes` from the **guest's own confirmation email** at `resend-confirmation/route.ts:80-81` — a safety regression caused by a security fix, invisible to `tsc` because the row type carries `[key: string]: unknown`. Add a separate `loadRedactedStaffAccessibleBooking()` for read paths instead. Forgetting to redact a read gets caught in review; forgetting to un-redact a *send* does not.

### D2. `bookings.group_kind` — REVISED, and demoted behind C12

**Three factual corrections to the first pass:**

1. **There are three meanings, not four.** `materializeRecurringReservation` passes `groupBookingId: null` explicitly. Backfill rule 1 (`class_recurring_reservation_id → class_series`) matches **zero rows** and would write `group_kind` where `group_booking_id IS NULL`, violating the CHECK it proposes. Confirmed independently by two agents.
2. **A writer was missing:** `visits/[groupBookingId]/services/route.ts:656` inserts booking rows. The moment the CHECK lands, every "add a service to this visit" save 500s. It must inherit the anchor row's kind.
3. **The stated justification was false.** `resolveCascadingVisitGroupId` is already `async` and already takes a `SupabaseClient`; "keeps it pure and synchronous" is wrong. The real argument for a column is that the ~30 *client-side* consumers operate on rows in hand.

**Contested and resolved:** one agent claimed the import tool writes `bookings.group_booking_id` at `run-execute.ts:1304`. Verified directly — it does not. That value goes into `refPayload`, a JSON metadata blob passed to `insertBookingExternalRef` for `booking_external_refs`. The same agent miscounted `persist-class-checkout.ts:25`, which writes `class_checkout_transactions`. **The import tool does not write it.**

**Corrected backfill:** (1) group id in `class_booking_groups` → `class_cart`; (2) else any row has non-blank `person_label` → `party`; (3) else → `visit`. With a guard: **never classify a `booking_model = 'class_session'` row as `visit`**, because the cart rollback deletes the `class_booking_groups` row and can leave orphaned bookings that rule 3 would otherwise freeze the C12 bug into.

**Two limits to state honestly:** the backfill reads the same `person_label` field H40 says is broken, so it fixes H40 for *new* rows only and cements existing poisoned rows. And four of the five cascade paths never call the resolver — `staff-cancel-booking.ts:93`, `booking-owes-capture.ts:48`, `payment-summary.ts:419` read the column directly, and `visits/schedule` guards via `isServiceVisit`, which cart rows pass.

**Demoted.** C12's `class_instance_id` fix closes the cascade today with no migration, no backfill and no test churn. D2 should be a later hardening pass, not a blocker. When it is done: nullable column, derive in a `BEFORE INSERT` trigger rather than six route bodies, CHECK `NOT VALID` then `VALIDATE`, and **flip the resolver to fail-closed only after the backfill completes** — doing it earlier loses money, because `idsToCancel` collapses to one row while the refund still targets the shared PI with no `amount`.

**Rolling-deploy hazard:** Vercel runs old and new lambdas simultaneously. A CHECK landing before the writers ship makes every group write 500 for the length of the deploy. Column → writers → backfill → `NOT VALID` → `VALIDATE` → resolver, in that order.

**Long term:** promote `class_booking_groups` to a general `booking_groups` table. Group-level facts — the shared PaymentIntent, the shared cancellation deadline (C11's aggravator), the organiser's identity (H41) — currently have nowhere to live and are smeared across N rows. The column does not foreclose this.

---

## Fixes withdrawn entirely

- **The D1 corollary** (pre-redacting `loadStaffAccessibleBooking`) — inverts a loud failure into a silent one.
- **"C3 must be a single RPC, mapped to 409 at the four write sites"** — not implementable for visits or groups, and undercounts the sites by three. Keep the diagnosis; replace the prescription.
- **H7 as "make `source` server-derived"** — staff multi-service and group bookings go through the **public** create routes with `source: isStaff ? staffBookingSource : 'booking_page'`, and neither route resolves auth at all. Forcing `source` would break staff walk-ins (email requirement), hide staff-only add-ons, and make `block_online` block staff-entered bookings. It would also delete the phone-vs-walk-in distinction, which is load-bearing for deposit suppression. **Instead: derive *trust*.** Resolve the staff session in all three routes, compute `isStaffContext`, accept `phone`/`walk-in` only when it is true, and drive every gate off it. The enum stays a label. Note the enum has a sixth value, `'import'`, used by `run-execute.ts:1148`.
- **H45 as a standalone guard** — a hard block on deleting a calendar with future bookings strands a venue that has lost a staff member, with no reassign flow to route around it. Ship the type-union widening with no route wired to it, then the guard **with** a reassign-or-cancel path.
- **H48 as "throw on `!fulfilled`"** — `already_fulfilled`, `wrong_purpose` and `not_succeeded` also return `fulfilled: false`. Throwing on those releases the idempotency claim and makes Stripe retry forever on benign outcomes. Only `retrieve_failed`, `lock_failed`, `balance_insert_failed` and `ledger_insert_failed` should throw.

---

## Revised implementation order

**0. DONE (staging, 2026-08-13).** Grants verified live. Result: C0 opened, C1/H43 confirmed live, N1 resolved as state (c). **Re-run the same three queries against production before acting** — the whole point of step 0 was that applied-migration state can differ per environment, and only staging has been checked.

**0b. C0 — revoke the destructive and high-value functions from `anon`/`authenticated`, starting with `admin_hard_delete_venue`.** Pure grant changes, no app code, instantly reversible, and they cannot break the dashboard provided the eight RLS helpers are left alone. This precedes everything, including C1, and it is a prerequisite for D1/A1.

**1. C1 + H43 + C2 — code-first, then migration (two deploys, not one).** Deploy the `reports/route.ts:605-608 → staff.db` switch first and verify `/api/venue/reports` returns 200; *then* apply the migration that `REVOKE`s the six report RPCs **from `PUBLIC, anon, authenticated`** (dropping `report_frequent_visitors`, adding `report_deposit_summary`), `REVOKE`s `consume_class_credits_atomically` from all three roles, and drops the two `waitlist_entries` anon policies. Bundling the REVOKE with the code switch risks a rolling-deploy window where the grant is gone but old lambdas still call on the session client → 500s. This is the entire anonymous-exposure surface.

**2. C4 via the immutability trigger.** One trigger, protects admin routes too, no realtime impact, no test churn.

**3. C11**, three parts in order (webhook gate → amount → idempotency key). Money leaving the account; do not gate behind a schema project.

**4. C6, C8, C9** — three small, well-understood, loudly-failing fixes.

**5. C13** across all three guest branches plus the staff mirror.

**6. C12** via `class_instance_id`, plus routing `cancelStaffBookingWithNotify` through the resolver.

**7. C10 and H8 together**, as a derivation fix — filter at point of use, never at the fetch.

**8. N2, N3, N4** — the linked write and guest-scope holes, independently of D1.

**9. C7** via `pending_change`.

**10. D1 re-scoped** — three write policies, column grants on the read, audit trigger extended, pgTAP rewritten and wired into CI. A two-week item, not a one-migration reduction.

**11. C3 interim** (re-validate immediately before insert at every write site), then scope the trigger work as a separate project (see C3).

**12. H38** — cross-venue bookings written with no availability validation. Upgraded; treat as urgent once the linked work is under way.

**13. D2**, five phases, as hardening.

**14. H7 as a trust boundary** — a feature, not a hardening patch.

**Sequencing constraints:** C1 is code-first then migration (step 1). C11's refund amount must be derived from the resolver's `idsToCancel` so C11 (step 3) and C12 (step 6) compose in either order; hardcoding "whole intent" couples them dangerously. C10 must land with H8 or H8 will look closed and will not be. D2 must not precede its backfill. H49 must not be tightened before the midnight wrap is resolved. Steps 8 (N2/N4) and 10 (D1's A3/A4) overlap — treat step 8 as interim hardening to be *subsumed* by D1, not repeated; if D1 slips, step 8 stands alone.

---

## Verification method and residual risk

Three review rounds: nine discovery agents, then six falsification agents on the findings and fixes, then five more targeting only the round-two *rewrites* and new findings. Every Critical and every rewritten fix has been re-derived from code by an agent whose brief was to break it, and the C7-C13 fixes each gained a completing correction in round three (C11's fourth refund site, C12's test/projection trap, C10's filter placement, C13's snapshot pairing, C7's interim-pair guard). The Highs H11, H16, H24, H25, H32–H37, H39, H41 were **not individually re-verified** and should be treated as first-pass confidence.

Two inter-agent disagreements were resolved by direct inspection: the import-tool writer question (round two — it does not write `bookings.group_booking_id`) and whether the anonymised view breaks under A2's column grant (round three — it does not; the view reads only granted columns and aliases `NULL` for the rest). A round-two agent's "six pgTAP failures / four vacuous passes" was one such error, corrected to three genuine failures in A5.

**What this document still cannot tell you** — settle each with a live database or a running app before scheduling the work:
- ~~Production grant state.~~ **RESOLVED 2026-08-13: production verified and identically exposed** — same 31 anon-executable functions as staging, same anon-readable `unified_calendars` harvest leg. The only divergence is a cosmetic PUBLIC-grant difference on `admin_hard_delete_venue` that does not affect reachability. What remains open is whether the exposure was ever *used* — see C0's "Was it exploited?" note.
- Whether the five `auth.uid()`-scoped functions in C0's middle tier are genuine no-ops for a null `uid`, and whether `merge_guests_into` / `increment_sms_usage` / `refresh_guest_booking_aggregates` carry internal guards — their bodies were not read.
- Whether Supabase Realtime with `REPLICA IDENTITY FULL` delivers column-filtered payloads under A2's narrowed grant (analysis says yes; smoke-test before shipping D1).
- Whether the row shapes D2's backfill would misclassify actually exist in your data.
- The four Probable/Speculative findings (H12, H17's residual, `enforce_cde_capacity` NULL capacity, `estimateSmsSegments`).

No code was changed in any of the three rounds.
