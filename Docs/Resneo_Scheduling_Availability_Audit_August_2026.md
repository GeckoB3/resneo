# ResNeo scheduling and availability — forensic audit and world-class blueprint

**Date:** 2026-08-15
**Branch:** `claude/venue-availability-audit-ffe6a3`, worktree of `main` at `e7ab9ac0`.
**Scope:** venue opening hours, per-calendar/staff working hours, breaks, business closures, amended hours, staff leave, ad-hoc calendar blocks — their storage, their editing UI, their rendering on the diary, and their effect on what a guest can book.
**Method:** five parallel investigation agents (data model, availability engine, calendar rendering, settings UI, API routes), then four adversarial agents (claim verification, an RLS/grants adjudication, a cross-cutting gap hunt, a target-state architecture), then a third round that re-attacked the unadjudicated findings and red-teamed this document itself.
**Outcome of adversarial review:** round two rejected 8 findings and downgraded 14. Round three downgraded 9 of the 10 remaining unadjudicated findings and corrected 6 errors in the first draft of this document, including a wrong cross-document reference repeated five times and one proposed fix that would have broken the diary. §7 records all of it.

**Sibling documents.** Two prior audits exist and are referenced precisely here:
- `Docs/Resneo_Forensic_Audit_August_2026.md` — contains findings **C0–C13, D1, H43, N1**. This is where item **C3** (appointment double-booking) and **D1** (realtime column grants) live.
- `Docs/Resneo_Remediation_Register.md` — contains findings **P-01, M-01, C-01, Q-01, S-01** style IDs. It does **not** contain a C3.

---

## ADVERSARIAL REVIEW, 2026-08-15 — verified against `fe09c0a4`

This document was written against **`e7ab9ac0`**. The tree is now **`fe09c0a4`**, five PRs later, and the sibling audit's remediation completed in between. Everything below was re-checked against live code.

**The findings hold.** All four Criticals and all seven Highs were re-verified against the current tree and stand, with two trivial citation slips noted inline. The evidence discipline is sound: SA-H3's six-link chain, SA-H1's grid probe, SA-H4's role-blind policy and SA-C4's nine policies were each re-read at the cited lines and match. SA-C4's load-bearing claim — the one that decides whether its fix is safe — was independently tested and holds: **no browser-client code reads any of the nine tables.**

**Five baseline facts are now false**, and one of them changes a fix.

| Document says | Current reality at `fe09c0a4` |
|---|---|
| Migrations **258** | **260** (`20270111120000`, `20270112120000` added since) |
| pgTAP "still runs in no CI pipeline" | **Runs on every push and PR** — `rls-pgtap` job, local Supabase built from the migrations, **24/24 passing** |
| Table-level `REVOKE` in migrations: **"Zero. Every `REVOKE` is `ON FUNCTION`"** | **False.** `20270112120000_bookings_column_grants.sql:57` is `REVOKE ALL ON public.bookings FROM authenticated` |
| **331 files / 3132 tests** | **335 / 3157** |
| `EXCLUDE USING` / `btree_gist` absent | **Still true** |

**SA-C1's headline recommendation is already done.** The document says twice, including in READ THIS FIRST, "ship the interim re-validate-before-insert regardless". That shipped to production as the sibling audit's C3 interim. `createAppointmentSlotRecheck` is wired at five paths: `booking/create`, `booking/create-group`, `booking/create-multi-service`, `venue/bookings` and `lib/booking/create-appointment-from-waitlist`.

**But it exposes a gap this document did not name, and should.** `src/app/api/confirm/route.ts` — the guest reschedule path — has **zero** occurrences of that re-check. So the guest reschedule currently has *both* defects at once: it validates against the parent duration (**SA-C2**) and it performs no re-check before the write. They are one small change in one function and should be fixed together, not as two findings.

**SA-H4's fix guidance is stale in a way that changes it, and in its favour.** It says to keep `SELECT` "since dropping it breaks realtime per **D1**, which is itself unresolved and is a dependency of this fix". **D1 is now complete.** Its A2 narrowed `bookings` to column-level `SELECT` for `authenticated` and **realtime delivery survived**, verified on staging before production. So the dependency is discharged, the "zero table-level REVOKE" corroboration is falsified, and `20270112120000` is now the **worked precedent** for exactly the operation SA-H4 needs. The finding is unaffected; its fix is easier than written.

**Two overlaps with the sibling audit that this document does not cross-reference:**

- **SA-H7** restates the forensic audit's **H1 residual** almost exactly. That audit downgraded H1 to Medium on the grounds that the engine ignoring `allowSameDayBooking` is deliberate and test-pinned, and identified the same real residual: `create-group` and `create-multi-service` never call `isGuestBookingDateAllowed`. Same defect, two IDs.
- **SA-M26** is accurate, and is also a **recorded decision** rather than an oversight. The forensic audit's C11 status block states that rebuilding `/api/confirm` with cascade semantics was deliberately left to C10/C12, because every post-cancel step there is keyed to a single `bookingId`. SA-M26 should be read as re-raising that decision with new evidence, not as reporting something unnoticed.

**Two citation slips, both trivial and neither affecting a finding:** `public_read_service_items` is at `20260430120000:396`, not `:397`; and SA-C2's slot test matches `start_time` **and** `service_id`, not "`start_time` only" — which does not weaken it, because the slot was generated at the parent duration either way.

**Scope of this review.** All four Criticals and all seven Highs were individually re-verified against live code, as were the baseline table and the §14 premises that gate the Critical fixes.

**Medium and Low pass, 2026-08-15.** A representative sample was then re-traced at the cited lines: **SA-M6, M9, M12, M14, M16, M20, M22** and **SA-L2, L9, L14**. Every one holds. Several are exact to the character — SA-M20's `annual`→"Closed" / `sick`→"Unavailable" mapping, SA-M9's `s-maxage=45, stale-while-revalidate=120`, SA-M12's `.in('block_type', ['closed', 'amended_hours'])`, SA-M6's zero `.refine` on `blockPatchSchema`, and SA-M22's complete absence of `beforeunload`. SA-M14's "proof it bites" is real: `admin_hard_delete_venue` does manually `UPDATE ... SET created_by = NULL` on all three tables. SA-L2's dead-code claim is corroborated by the repo's own comments, which describe `getAvailableSlots` as "retained for tests and tooling".

**One Low needs sharpening, and it is the kind of slip that gets a finding wrongly dismissed.** **SA-L14** says "No `(venue_id, block_date)` index on `calendar_blocks`". An index *does* exist — `idx_calendar_blocks_lookup ON calendar_blocks (calendar_id, block_date)` at `20260430120000:144` — so a reader checking the claim as written will find one and close the finding. **The finding is nonetheless correct**, and the corrected statement is stronger: the diary's list query at `src/app/api/venue/practitioner-calendar-blocks/route.ts:90-98` filters `.eq('venue_id', ...)` then `block_date`, and the existing index **leads on `calendar_id`**, so it cannot serve that query. The gap is a wrong leading column, not a missing index.

**Two wording imprecisions, neither affecting a finding.** SA-M16 describes the phantoms payload as "cast with a bare `as PhantomBooking[]`"; it is in fact assigned to a typed variable, which is the same absence of validation by a different mechanism. SA-M28's own entry is new in this review and carries its evidence inline.

The remaining Mediums and Lows not listed above were not individually re-traced. Given that every sampled item held, and that the two corrections found were a sharpening and a wording slip rather than a false finding, the table can be treated as reliable — but re-read a finding at its cited lines before scheduling it, which is what surfaced the SA-L14 refinement.

---

## READ THIS FIRST

**1. The test suite is fully green and covers almost none of this.** Baseline: `tsc --noEmit` clean, **331 test files / 3132 tests, all passing**, in 23 s. There is no test anywhere for a partial-day closure, no month/day parity test, no concurrency test, no DST fixture, and no test at all for `src/app/api/booking/create/route.ts`. "The tests pass" carries no information about this subsystem.

**2. The flagship overbooking finding is already open elsewhere, and its fix is genuinely hard.** `SA-C1` is the same defect as **C3 in `Docs/Resneo_Forensic_Audit_August_2026.md:36`**, where the trigger-based fix was struck. §11.3 proposes a narrower design **and states honestly which of C3's six objections it does not answer.** Do not read §11.3 as a solved problem. Ship the interim re-validate-before-insert regardless.

**3. Two findings are new, cheap and worth fixing this week.** `SA-C2` (guest reschedule validates the parent service duration then writes the variant duration) and `SA-H3`/`SA-H5` (the diary treats a day's *open* window as occupied). The latter two share one root cause and one small fix.

**4. One finding is a personal-data exposure and should be treated as a GDPR matter, not only an engineering one.** `SA-C4`: `availability_blocks` is anonymously readable platform-wide with `USING (true)`, and its `reason` column is free text an owner types. See §8 for the notification assessment and the retrospective log check the sibling audit performed for C0.

**5. Two claims still need a live database query before you act.** `SA-H4`'s fix could break realtime if the premise is wrong, and `SA-C4`'s scope depends on what is actually in `reason`. Queries in §14.

---

## Baseline

| Check | Result, 2026-08-15 |
|---|---|
| `npx tsc --noEmit` | Clean, exit 0 |
| `npx vitest run` | 331 files / 3132 tests at `e7ab9ac0`; **335 / 3157 at `fe09c0a4`** |
| Migrations | 258 at `e7ab9ac0`; **260 at `fe09c0a4`** |
| pgTAP (`supabase/tests/`) | ~~Still runs in no CI pipeline~~ **Now runs on every push and PR (`rls-pgtap`), 24/24 passing** |
| `btree_gist` / `EXCLUDE USING` | **Absent from all 258 migrations** (VERIFIED) |
| `revalidateTag` / `revalidatePath` / `unstable_cache` | **Zero occurrences in `src/`** (VERIFIED) |
| Table-level `REVOKE` in migrations | ~~**Zero.** Every `REVOKE` is `ON FUNCTION`~~ **Now one:** `20270112120000:57` revokes on `public.bookings`. Precedent for SA-H4 |

---

## Severity and status

Severity follows `Docs/Resneo_Remediation_Register.md` §3 exactly, reproduced here so no reader has to guess:

| Severity | Definition |
| --- | --- |
| **Critical** | Money leaves incorrectly, personal data is exposed to a third party, or the system tells a customer something untrue about their rights |
| **High** | A customer or venue suffers a materially wrong outcome, or a legal obligation is unmet |
| **Medium** | Wrong or confusing behaviour with a workaround |
| **Low** | Quality, consistency and polish |

A booking the venue cannot honour is scored **Critical** under "tells a customer something untrue about their rights", since a confirmed appointment is a promise. There is no "Critical (product)" tier; an earlier draft of this document invented one and it has been removed.

| Status | Meaning |
| --- | --- |
| **VERIFIED** | The author read the code at the cited line personally |
| **CONFIRMED** | An agent read it and an adversarial agent re-read it and upheld it |
| **REPORTED** | Cited with file and line by one pass, not independently re-traced |

**Anchor note.** Line numbers are exact at `e7ab9ac0`. Files are cited by full path throughout, because the sibling audit records the cost of bare filenames.

---

# §1 The system as it actually is

## 1.1 Where a schedule lives

| Concept | Storage | Notes |
|---|---|---|
| Venue weekly opening hours | `venues.opening_hours` (jsonb) | Max 2 periods per day in the UI |
| Venue date exceptions (closures, amended hours, special events) | `availability_blocks` where `service_id IS NULL` | The live store, per `supabase/migrations/20260517120000_unified_business_hours_blocks.sql` |
| Venue date exceptions (legacy) | `venues.venue_opening_exceptions` (jsonb) | **Emptied by migration; no UI writer; live PATCH route survives.** `SA-L1` |
| Per-calendar working hours | `unified_calendars.working_hours` | Unlimited periods |
| Per-calendar breaks | `unified_calendars.break_times`, `break_times_by_day` | Two competing shapes |
| Per-calendar days off | `unified_calendars.days_off` | Unvalidated mixed array of weekday names **and** ISO dates |
| Staff leave | `practitioner_leave_periods` | Full-day when times are NULL, partial when both set |
| Ad-hoc blocks (current) | `calendar_blocks` | |
| Ad-hoc blocks (legacy, still reachable) | `practitioner_calendar_blocks` | `20260918140000` mirrored rows **without deleting sources** |

Two further stores are inert for appointments: `service_schedule_exceptions` (read only by the table-model path) and `availability_config.blocked_dates` (no production reader). See §6.

**`venue_schedule_exceptions` does not exist.** Its role is played by `availability_blocks WHERE service_id IS NULL`, despite code comments implying otherwise.

## 1.2 The five engines

The same closure row is interpreted by five resolvers, and they disagree.

| Engine | Entry point | Closure semantics |
|---|---|---|
| Appointments | `src/lib/availability/appointment-engine.ts` | Via `src/lib/availability/venue-exceptions-adapter.ts`. Partial-day closure → **whole day**. Amended hours **replace** weekly hours. |
| Classes | `src/lib/availability/class-session-engine.ts` | `resolveVenueWideAllowedMinuteRanges`. Partial-day honoured. Amended hours **union then intersect**. |
| Events | `src/lib/availability/event-ticket-engine.ts` | As classes |
| Resources | `src/lib/availability/resource-booking-engine.ts` | As classes |
| Staff diary | `src/lib/calendar/schedule-closure-blocks.ts:216` | As classes — **which is why the diary and the appointment engine disagree** |

`src/lib/availability/venue-wide-business-hours.ts` is the good resolver: correct interval arithmetic, closures partitioned from amendments, well tested. The appointment engine, the primary product, is the one path that does not use it.

## 1.3 The editing surfaces

Twelve surfaces write hours, breaks, closures or leave, across four pages: `/dashboard/settings?tab=business-hours`, `/dashboard/availability`, `/dashboard/calendar-availability`, `/dashboard/practitioner-calendar`, plus onboarding, the service modal and `/dashboard/resource-timeline`. **Four different weekly-hours editor components** exist with different period caps, defaults and copy-day rules.

Measured: changing one day's closing time takes **14+ clicks across two pages**; a lunch break for five stylists takes **~27**.

---

# §2 The constraint × layer matrix

Legend: ✅ honoured · ❌ not honoured · ⚠️ honoured differently from its siblings

| Constraint | Day availability API | Month availability API | Booking create (server re-check) | Staff diary | Mobile `calendar-grid` |
|---|---|---|---|---|---|
| Venue opening hours | ✅ | ✅ | ✅ | ✅ | ❌ |
| Calendar working hours | ✅ | ✅ | ✅ | ✅ | ⚠️ raw weekly only |
| Calendar breaks | ✅ | ✅ | ✅ | ✅ | ❌ |
| Whole-day closure | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Part-day closure** | ⚠️ widened to whole day | ⚠️ widened | ⚠️ **widened** | ⚠️ intersecting resolver | ❌ |
| **Amended hours** | ⚠️ **replace** weekly | ⚠️ replace | ⚠️ replace | ⚠️ **intersect** weekly | ❌ |
| Staff leave (full day) | ✅ | ✅ | ⚠️ skipped when `allowOutsideHours` | ✅ | ❌ |
| Staff leave (partial) | ✅ | ✅ | ✅ | ✅ | ❌ |
| `calendar_blocks` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `practitioner_calendar_blocks` | ✅ | ✅ | ✅ | ✅ | ❌ |
| Min booking notice | ✅ | ✅ | ✅ | n/a | n/a |
| **Max advance / same-day rule** | ❌ | ✅ | ⚠️ **absent on multi-service and group** | n/a | n/a |
| `service_schedule_exceptions` | ❌ inert | ❌ | ❌ | ❌ | ❌ |
| `availability_config.blocked_dates` | ❌ no reader | ❌ | ❌ | ❌ | ❌ |

**On the Staff diary column (added 2026-08-15).** The leave rows were re-verified and both ✅ are correct: `schedule-closure-blocks.ts` handles partial leave via `unavailable_start_time`/`unavailable_end_time` and detects full-day leave by both being null. Note also that on **part-day closures the diary is the more correct surface** — it uses the intersecting resolver and renders the partial window properly; it is the guest-facing appointment engine that widens to a whole day. That ⚠️ is not a diary defect. What the column does **not** capture is that ✅ here means *honoured*, not *labelled*: several constraints are honoured while rendering as the same undifferentiated block. See `SA-M28`.

**Correction against the first draft:** the part-day-closure "create" cell was previously marked ✅. It is not. `src/app/api/booking/create/route.ts:1019` calls the correct resolver but sits in the **class-session** branch; the appointment branch begins at `:1030` and goes through `fetchAppointmentInput` and the widening adapter. Part-day closures are widened on every appointment layer, consistently. That makes it a revenue-loss defect rather than an overbooking one.

The mobile column's consumer is **unverified from this repo**: the only evidence is a comment at `src/lib/unified-availability.ts:57-60`, and `Docs/MOBILE_API.md` does not list the route. The mobile *write* path does run the engine, so this is a display gap, not a booking bypass.

---

# §3 Critical findings

### SA-C1 — No database-level guard against double-booking an appointment
**CONFIRMED (VERIFIED) · Critical · Same defect as C3 in `Docs/Resneo_Forensic_Audit_August_2026.md:36`**

`supabase/migrations/20261225120000_cde_capacity_guards.sql:125` reads verbatim `-- Appointment / table rows: not governed here. RETURN NEW;`. Classes, events and resources get `pg_advisory_xact_lock` plus an in-lock recheck. Appointments get nothing: no unique index, no exclusion constraint, no advisory lock, and no transaction spanning the check at `src/app/api/booking/create/route.ts:1169` and the INSERT at `:1820`. Repo-wide, `EXCLUDE USING` and `btree_gist` appear in zero migrations (VERIFIED).

**Failure:** two guests submit the same 10:00 slot inside the check-to-insert window. Both pass, both are written.

**Do not treat §11.3 as a solved fix.** The forensic audit struck the trigger approach for six reasons, and §11.3 answers two of them. Treat the durable fix as a designed piece of work.

> **UPDATE 2026-08-15:** the interim **is shipped** and on production, as the sibling audit's C3 interim: `createAppointmentSlotRecheck` at `booking/create`, `create-group`, `create-multi-service`, `venue/bookings` and `create-appointment-from-waitlist`. **The durable fix is separately deferred by operator decision** on exposure grounds (target venues run ~50 bookings/week); see C3's decision record in the sibling audit for the triggers that would reopen it.
>
> **`src/app/api/confirm/route.ts` is NOT covered** — zero occurrences of the re-check. The guest reschedule therefore carries this defect *and* SA-C2 together. Fix them in one change.

---

### SA-C2 — Guest self-reschedule validates the parent duration, then writes the variant duration
**CONFIRMED (VERIFIED) · Critical · New**

In `src/app/api/confirm/route.ts`, the reschedule path builds its availability input with `fetchAppointmentInput` at `:1457` and **never calls `applyVariantToAppointmentInput`**, so `computeAppointmentAvailability` at `:1467` generates slots at the **parent service** duration. The slot test at `:1474-1478` matches on `start_time` only. Then `:1533` computes `rescheduleDurationMinutes = keptVariant?.duration_minutes ?? svc?.duration_minutes` — the **variant** duration — and `:1546-1552` writes both `estimated_end_time` and `booking_end_time` from it. Add-on minutes (`addons_total_duration_minutes`) are never read here, though `create` folds them in.

The asymmetry is documented in the file itself: the comment at `:1527-1531` explains that recomputing from the parent "silently shrank a 150-minute variant booking". **The write side of this bug was found and fixed. The check side was not.**

**Failure:** a guest holds a 150-minute variant of a 30-minute parent service and self-reschedules to 16:30. The engine asks "is 16:30–17:00 free?", says yes, and writes a booking ending 19:00 — through the next client, through a break, past closing.

**Correction to the first draft:** it claimed `create/route.ts` "calls it twice (VERIFIED by grep: 0 vs 2)". The grep counted lines, not calls: `create` has **one call plus its import**. The finding is unaffected; the verification claim was sloppy and is corrected here.

**Fix (S):** apply the variant and add-on minutes to the input before the availability check in `src/app/api/confirm/route.ts`, exactly as `src/app/api/booking/create/route.ts` does.

> **Verified 2026-08-15 at `fe09c0a4`.** `confirm/route.ts` is absent from the seven callers of `applyVariantToAppointmentInput`, and `:1457`, `:1468`, `:1533-1534` are exact. **One slip:** the slot test matches `start_time` **and** `service_id`, not "`start_time` only"; the finding is unaffected, since the slot was generated at the parent duration regardless. **Do this together with the missing pre-insert re-check on the same path** (see SA-C1's update).

---

### SA-C3 — Availability reads fail open: a database error is computed as "nothing is blocked"
**CONFIRMED (VERIFIED) · Critical as a class**

Thirteen sites verified by direct grep, every one logging a warning and substituting an empty result:

- `src/lib/availability/appointment-engine.ts:1244` (leave), `:1360` (`practitioner_calendar_blocks`), `:1377` (`venues.opening_hours`), `:1423` (`unified_calendars`), `:1560` (leave, calendar path), `:1710`, `:1713` (`calendar_blocks`), `:1716`
- `src/lib/availability/appointment-month-availability.ts:245`, `:249`, `:283`
- `src/lib/unified-availability.ts:109`, `:195`

**Failure:** one PostgREST request inside a `Promise.all` fails while the bookings query succeeds. "I could not read the leave table" becomes "nobody is on leave", and the engine sells the day a stylist is abroad.

The adversarial round rated a single incident High, since it is fault-conditional rather than steady-state. It is recorded Critical **as a class** because it is thirteen instances of the same inverted default in the one subsystem where the safe default is obvious, and because §9 shows nothing would tell you it had happened.

**The good pattern exists in-repo:** `src/app/api/venue/schedule/route.ts` fails closed on all eight of its sub-queries. §11.2 gives the contract that makes failing closed survivable rather than a blank booking page.

---

### SA-C4 — Anonymous, platform-wide read of every venue's schedule, including free-text closure reasons
**CONFIRMED (VERIFIED) · Critical (personal data)**

Nine `TO anon` SELECT policies relevant to scheduling survive; only the waitlist pair was ever dropped (`supabase/migrations/20270107120000_revoke_report_rpcs_and_waitlist_anon.sql:72-73`). Enumerated so Phase 0 is startable:

| Policy | Table | Predicate | Migration |
|---|---|---|---|
| `public_read_availability_blocks` | `availability_blocks` | **`USING (true)`** | `20260308000001:234` |
| `public_read_capacity_rules` | `service_capacity_rules` | `USING (true)` | `20260308000001:216` |
| `public_read_party_durations` | `party_size_durations` | `USING (true)` | `20260308000001:222` |
| `public_read_booking_restrictions` | `booking_restrictions` | `USING (true)` | `20260308000001:228` |
| `public_read_venue_services` | `venue_services` | `USING (is_active = true)` | `20260308000001:210` |
| `public_read_booking_restriction_exceptions` | `booking_restriction_exceptions` | `USING (true)` | `20260323120000:81` |
| `public_read_service_schedule_exceptions` | `service_schedule_exceptions` | `USING (true)` | `20260323120000:86` |
| `public_read_unified_calendars` | `unified_calendars` | `USING (is_active = true)` | `20260430120000:392` |
| `public_read_service_items` | `service_items` | `USING (is_active AND is_bookable_online)` | `20260430120000:396` (doc said `:397`) |

**None has a venue predicate.** Two consequences:

1. `unified_calendars` exposes **every venue on the platform's** working hours, breaks, days off, staff names, prices and capacity in one unauthenticated request. The team's own migration `20270107120000:5-9` already names this table as a venue-id harvesting oracle and fixed the adjacent waitlist case.
2. `availability_blocks.reason` is **free text an owner types**, anonymously readable with no predicate at all. Realistic contents: "closed for the funeral", "Sarah's surgery". That is potentially special-category data under UK GDPR Art. 9. See §8.

**Correction worth recording:** staff *leave* notes are **safe**. `practitioner_leave_periods` and `practitioner_calendar_blocks` have no `TO anon` policy. The free-text exposure is `availability_blocks.reason` only.

**These policies are not load-bearing.** All public booking routes and both public page loaders use the service-role client, so they can be dropped without touching a request path.

> **Independently re-verified 2026-08-15.** All nine policies exist at the cited migrations with the cited predicates. The load-bearing claim was tested the way the sibling audit learned to test one: **no file importing the browser Supabase client reads any of the nine tables.** This is the best-evidenced finding in the document and is safe to action.

---

# §4 High findings

### SA-H1 — `venueLocalDateTimeToUtcMs` silently returns noon UTC for most booking times
**CONFIRMED (VERIFIED) · High**

`src/lib/venue/venue-local-clock.ts:52-58` finds the UTC instant for a venue-local wall time by walking a 15-minute grid outward from noon UTC (`anchor + (step - 96) * 15 * 60 * 1000`), returning `anchor` if nothing matches. Every real IANA offset is a multiple of 15 minutes, so **only wall times whose minute is 0, 15, 30 or 45 can ever match**. Everything else returns noon UTC.

Off-grid times arise four ways: `booking_interval_minutes` accepts 1–60; `booking_start_times` accepts arbitrary `HH:MM`; `src/lib/appointments/booking-interval.ts:116` steps from `range.start` not from `:00`, so hours beginning at 09:05 make *every* slot off-grid; and staff drag snaps to `CALENDAR_MOVE_INCREMENT_MINUTES = 1`, which the shipped help article tells staff to do.

**Downstream:** `src/lib/booking/comms-timing.ts:21,31` (a 2-hour reminder for an 09:35 appointment is computed against noon and fires *after* the appointment), `src/lib/emails/calendar-links.ts:90` (the confirmation email's "add to calendar" link says noon), `src/lib/table-management/booking-status.ts:137` (no-show grace window), `src/lib/booking/venue-booking-model-disable-guard.ts:109`, `src/app/api/booking/create/route.ts:1536`. Nothing normalises `booking_time` on write.

**Fix (M):** replace the grid probe with the standard two-pass offset algorithm — compute the offset at a guess instant, apply, recompute, apply. `timeZoneOffsetMs` already sits in the same file. Add fixtures for 09:35 and both UK DST transition days. **Size the remediation first** with the §14 query for existing off-grid rows.

---

### SA-H2 — Amended hours mean "replace" to the guest engine and "intersect" to the diary
**CONFIRMED · High**

`src/lib/availability/appointment-engine.ts:453-460,472-487` picks one applicable exception and lets its periods **replace** weekly hours. `src/lib/availability/venue-wide-business-hours.ts:168-172` unions amended periods and **intersects** them with weekly hours. The diary uses the second (`src/lib/calendar/schedule-closure-blocks.ts:216`).

**Failure:** a 09:00–17:00 venue sets amended hours of 08:00–20:00 for a late event. The guest engine sells 08:00–09:00 and 17:00–20:00. The diary paints those hours `venue_closed`, and via `SA-H3` staff cannot click the bookings that land there. Two High findings compound at exactly this point; fix them together.

---

### SA-H3 — The diary treats the *open* window of an amended-hours day as occupied
**CONFIRMED (VERIFIED) · High**

Traced end to end; the two decisive links verified personally:

1. `src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx:3363` filters fetched blocks on `service_id` only. **`block_type` is not filtered**, so `amended_hours` rows survive.
2. `src/lib/calendar/schedule-closure-blocks.ts:251` emits `venue_amended_hours` covering the **open** window (pinned by `schedule-closure-blocks.test.ts:100-108`).
3. `PractitionerCalendarView.tsx:2943-2946` merges them into `displayBlocks` with no type filter.
4. `:7188` passes the **whole** `displayBlocks` — not the per-column `pracBlocks` computed at `:7163` — into `slotOccupied`.
5. `slotOccupied` at `:1692-1698` loops every block and returns `true` on overlap. **VERIFIED: no `block_type` discrimination of any kind.**
6. `:7209` sets `disabled={occ}`. The drag path reaches the same loop via `appointmentWindowCollides:1751` → `invalid` → `handleDragEnd:5370` "That time is not available".

**On an amended-hours day, the one window the venue is actually working is the one window staff cannot book into, while the guest engine sells it.**

---

### SA-H4 — Every API permission check on this subsystem is advisory
**CONFIRMED (VERIFIED) · High · Intra-venue, not cross-tenant**

Every scheduling table's RLS policy is `FOR ALL` with predicate `venue_id IN (SELECT venue_id FROM staff WHERE email = auth.jwt()->>'email')` (`supabase/migrations/20260430120000_unified_scheduling_engine.sql:341` and siblings). The predicate is **role-blind**: no scheduling policy references `staff.role`. The correct helper `caller_staff_admin_venue_ids()` exists (`20261219120000:39`) and is wired to exactly one policy. Meanwhile every API route writes through `getSupabaseAdminClient()`, so `requireAdmin` and `staffManagesCalendar` are the only gate on the route path, and absent from the direct path.

> **UPDATE 2026-08-15 — the blocking dependency is gone, and this fix is now easier than written.** **D1 is complete.** Its A2 narrowed `bookings` to column-level `SELECT` for `authenticated` and **realtime delivery survived**, verified on staging before production. So: the dependency is discharged; the "zero table-level `REVOKE`" corroboration below is **falsified** by `20270112120000`, which is now the worked precedent for exactly this operation; and the RLS pgTAP suite that runs in CI gives this change a safety net the document assumed did not exist. The finding itself is unaffected and re-verified: the policy at `20260430120000:341` is `FOR ALL` with a role-blind venue predicate, and no scheduling policy references `staff.role`.

**Proven by the repo's own test suite** (VERIFIED): `supabase/tests/linked_accounts_rls_test.sql:275-295` runs `SET LOCAL ROLE authenticated`, gets `42501` on an INSERT, then runs the **same INSERT successfully** after changing only an `account_links` data value. The rejection was RLS, not a missing grant. Corroborated by **zero table-level `REVOKE` in any of the 258 migrations** (VERIFIED).

**Effect:** a non-admin staff member can rewrite colleagues' `working_hours`, delete their leave, and create venue-wide closures via PostgREST using the shipped publishable key.

**Correctly scoped:** **intra-venue**, not cross-tenant. The venue predicate is sound; `staff` has no UPDATE or DELETE policy, so there is no self-promotion to admin; valid staff credentials are required.

**Fix (M), in order:** (1) `REVOKE INSERT, UPDATE, DELETE` on the six scheduling tables from `anon, authenticated` — **keep `SELECT`** for realtime; (2) add role predicates to policies that should be admin-only; (3) extend `scripts/check-client-executable-functions.mjs`, which polices `pg_proc` and nothing else. That table-shaped blind spot is why this survived four consecutive hardening migrations. Run the §14 query first.

---

### SA-H5 — Staff cannot book outside hours or over a break, contradicting the code and the shipped help article
**CONFIRMED · High**

The comment at `src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx:5312-5314` states staff *may* book outside hours with a warning rather than a refusal. `src/lib/help/articles/getting-started.ts` promises owners the same: dragging outside opening hours "is allowed. You will see a note that it moved outside opening hours, not a refusal."

Both are dead. `outsideHours` is computed against `dayStartMin`/`dayEndMin`, which are the drawn canvas bounds rather than opening hours, making it near-unreachable; and `appointmentWindowCollides` counts `practitioner_closed`, `venue_closed` and `break` as hard conflicts, producing a refusal first.

**Failure:** a client asks for 17:15 when the salon closes at 17:00 and the owner is happy to stay. The diary refuses. This is the most common real-world reason a receptionist overrides a schedule, and the product documents a behaviour it does not have.

**`SA-H3`, `SA-H5` and the closure-day lockout in `SA-M1` share one root cause:** `slotOccupied` and `appointmentWindowCollides` do not distinguish block types. Introducing `isOccupyingBlock(blockType)` and using it in both resolves all three. **Highest value-per-line fix in the audit.**

---

### SA-H6 — Cancelling bookings to close a day then offers those slots to the waitlist
**CONFIRMED (VERIFIED) · High · New**

`src/lib/booking/offer-appointment-waitlist-on-cancel.ts` imports `isWaitlistFreedSlotStillUnbooked` but **not** `findAppointmentWaitlistAvailability` (VERIFIED by import grep). It checks "has someone else taken this slot" and never "is the venue open". Five sibling waitlist paths do use the availability helper.

**Failure:** an owner books a closure and cancels the day's appointments. Each cancellation fires the waitlist offer; waitlisted guests are texted offers for the closed day.

**Two gates, found on re-verification and recorded here rather than glossed:** the function returns early at `:270` unless the `waitlist_v2` feature flag is enabled, and that flag **defaults to false**; and in `staff_choose` mode it raises a staff alert without notifying any guest. The default mode is `notify_in_order`, which does notify. So exposure equals the set of venues with `waitlist_v2` explicitly on. **This is why it is High and not Critical** — an earlier draft of this document had it as Critical, before the gates were checked.

---

### SA-H7 — Booking-window rules unenforced on the multi-service and group routes
**CONFIRMED (VERIFIED) · High**

`allowSameDayBooking` is assigned at `src/lib/availability/appointment-engine.ts:122` and **never read anywhere else** (VERIFIED: only the declaration at `:91`, the assignment, and one test locking the dead behaviour in). Real enforcement lives in `isGuestBookingDateAllowed`, which `src/app/api/booking/create-multi-service/route.ts` and `create-group/route.ts` never call. Both are anonymous and are the real public flow. Reachability comes from `SA-M8`: the day API lists slots for out-of-window dates.

`min_booking_notice_hours` **is** enforced (`appointment-engine.ts:645`), so the worst case is a same-day or far-future booking the venue did not want, not a slot conflict.

> **Overlap, 2026-08-15:** this restates the forensic audit's **H1 residual** almost exactly. That audit downgraded H1 to Medium (the engine ignoring `allowSameDayBooking` is deliberate and test-pinned at `appointment-engine.test.ts:146`) and named the same real residual: `create-group` and `create-multi-service` never call `isGuestBookingDateAllowed`. One defect, two IDs — schedule it once.

---

# §5 Medium findings

| ID | Finding | Evidence |
|---|---|---|
| **SA-M1** | **Part-day closures are widened to whole-day for appointments** on every layer including create. The UI **discloses** it with an amber banner naming the behaviour and pointing at Amended Hours, which is why this is Medium; **the API does not**, and accepts the times happily. | `src/lib/availability/venue-exceptions-adapter.ts:17-24` (VERIFIED); `src/app/api/venue/availability-blocks/route.ts:91`; `src/app/dashboard/settings/sections/BusinessClosuresSection.tsx:524-535` |
| **SA-M2** | **Closing a day has no consequence chain.** No customer notification, no bulk cancel, no refund path, and **reminders keep firing** (`src/lib/booking/unified-scheduling-comms.ts:72-81` reads no closure table). Via `SA-H3`/`SA-H5` the orphaned bookings are then unclickable on the diary. Downgraded from Critical on re-verification: there is **no automated no-show marking anywhere**, so that consequence was speculative, and the design is disclosed to the owner with the rationale in code. | `src/lib/calendar/closure-booking-conflicts.ts:277` |
| **SA-M3** | **`allowOutsideHours` disables the full-day staff-leave gate.** The skipped block at `src/lib/availability/appointment-engine.ts:965-990` also contains the leave gate, because full-day leave is folded into `days_off` at `:249-276`. The comments at `:847-853` and `src/app/api/venue/bookings/route.ts:1134-1136` claiming leave is still honoured are **false**. Not reachable unauthenticated: all four routes sit behind `getVenueStaff`, and the two visit routes add `requireManagedCalendarAccess`. | |
| **SA-M4** | **Deleting a calendar has no booking check**; `bookings.calendar_id` is `ON DELETE SET NULL`. Mitigated: the confirm dialog discloses it and the bookings list still shows the appointments, since `bookings.practitioner_id` is untouched. What is lost is diary rendering. | `src/app/api/venue/practitioners/route.ts:911-921`; `20260430120000:212` |
| **SA-M5** | **Deactivating a calendar (`is_active = false`) has no guard** — the orphan check is gated on `working_hours` changing. Future bookings vanish from the diary while the reminder cron keeps texting. Admin-only and instantly reversible. | `src/app/api/venue/practitioners/route.ts:577-583`; `PractitionerCalendarView.tsx:3576-3585` |
| **SA-M6** | **`blockPatchSchema` is missing the refine that `blockSchema` has** (VERIFIED). Clearing one Period-1 box on an existing amended-hours entry saves `override_periods: null`, closing the whole day for classes/events/resources. Neither schema validates `date_end >= date_start` or `time_end > time_start`, so reversed ranges store as **inert** closures the owner believes are in force. | `src/app/api/venue/availability-blocks/route.ts:98-116` |
| **SA-M7** | **A break can be saved over an existing appointment silently.** The orphan guard is gated on `working_hours` only; the identical action via "Block time" or leave returns a hard 409. | `src/app/api/venue/practitioners/route.ts:577-583` |
| **SA-M8** | **Day API lists slots outside the booking window** while the month API applies it. Dead-end UX alone; the reachability enabler for `SA-H7`. | `src/app/api/booking/availability/route.ts:521-742` |
| **SA-M9** | **Public month picker is CDN-cached with no revalidation.** `s-maxage=45, stale-while-revalidate=120`, zero `revalidateTag`/`revalidatePath` in `src/` (VERIFIED), `next.config.ts` and `vercel.json` clean. **True worst case 165 s per edge PoP.** Bounded: the day route sets no cache header and `create` re-validates. | `src/app/api/booking/appointment-calendar/route.ts:197` |
| **SA-M10** | **Month path double-applies `custom_duration_minutes`**, discarding injected variant and add-on minutes — the hazard the day path documents and avoids. Green dates that offer no slots. | `src/lib/availability/appointment-month-availability.ts:687,696`; contrast `src/lib/availability/appointment-engine.ts:1519-1533` |
| **SA-M11** | **`opening-hours` orphan check reads only the dead column.** It builds `skipDate` from the empty `venue_opening_exceptions`, so a date governed by an `amended_hours` block is never skipped and the warning **falsely alarms** the admin. | `src/app/api/venue/opening-hours/route.ts:45-64` |
| **SA-M12** | **`special_event` closures are dropped** by `src/lib/unified-availability.ts:231`, inside `getUnifiedAvailableSlots`. **Correction to the first draft, which called this consumerless:** it is consumed by `src/app/api/booking/unified-availability/route.ts`, a **public anonymous GET** documented as "guest booking page slot list". No first-party client calls it, but it is reachable by anyone. Fix the `.in()` list or delete the route. | |
| **SA-M13** | **Legacy block branch skips the managed-calendar check.** Reachable: `20260918140000:5-42` mirrors `practitioners` into `unified_calendars` preserving the id without deleting sources. **Fix with `SA-H4` or it is cosmetic**, since RLS already grants what the check withholds. | `src/app/api/venue/practitioner-calendar-blocks/route.ts:175-209` |
| **SA-M14** | **`created_by` FKs have no `ON DELETE`** on `calendar_blocks`, `practitioner_calendar_blocks`, `table_blocks`. Any staff member who ever made a block cannot be deleted; surfaces as an opaque 500. Proof it bites: `admin_hard_delete_venue` manually NULLs those columns. | `20260516130000:30-32` |
| **SA-M15** | **Whole-blob last-write-wins with no concurrency token** on `opening_hours`, `availability_config` and calendar hours. Two admins editing on a Monday silently clobber each other. | `src/app/api/venue/opening-hours/route.ts:86-91` |
| **SA-M16** | **Anonymous availability endpoint accepts an unvalidated `JSON.parse`d `phantoms` array**, cast with a bare `as PhantomBooking[]`, no zod, no length cap, fed into per-request loops. None of the three public availability routes are rate-limited, though the limiter exists and is used on `booking/create`. | `src/app/api/booking/availability/route.ts:574-582` |
| **SA-M17** | **In-tenant over-disclosure**: `calendar-grid`, `schedule` and `practitioner-calendar-blocks` GET apply no managed-calendar scoping, so a one-room staff member reads every colleague's schedule with guest names and payment state. Not cross-tenant. | |
| **SA-M18** | **Collective and linked pages ignore partner booking windows.** The combined page passes `bookingWindow: null`, so min-notice and max-advance are invisible until `create` rejects at the payment step. Narrower than first reported: the bridge's `fetchAppointmentInput` **does** load member closures and leave. | `src/lib/linked-accounts/collective-booking-bridge.ts:157` |
| **SA-M19** | **Mobile `calendar-grid` omits leave, closures, breaks, amended hours and legacy blocks.** Consumer unverified; display gap only. | `src/lib/unified-availability.ts:413-451`, `:620-629` |
| **SA-M20** | **Leave types are stored wrong.** The dropdown maps "Closed" → `annual` and "Unavailable" → `sick` (VERIFIED), and the value is never displayed back. A training day is recorded as sick leave. | `src/app/dashboard/availability/StaffLeaveCalendarPanel.tsx:543-547` |
| **SA-M21** | **Declining the "bookings fall outside new hours" confirm looks exactly like a successful save**, in all three implementations. | `OpeningHoursSection.tsx:76-84`; `AppointmentAvailabilitySettings.tsx:728-736`; `BusinessClosuresSection.tsx:356-365` (all under `src/app/dashboard/settings/sections/` and `src/app/dashboard/availability/`) |
| **SA-M22** | **No dirty-state guard anywhere** (`grep beforeunload` returns nothing). Switching tabs discards a week of unsaved hours. | |
| **SA-M23** | **"Closures" names two different objects on two pages**, and a third sense within one screen. | `src/app/dashboard/availability/StaffLeaveCalendarPanel.tsx:470-471` vs `:544-546` |
| **SA-M24** | **A banner warns that legacy `days_off` still block bookings and offers no way to see or clear them.** `days_off` is an unvalidated mixed array of weekday names and ISO dates; `"Monday"` is accepted and silently does nothing. | `src/app/dashboard/availability/AppointmentAvailabilitySettings.tsx:1049-1059` |
| **SA-M25** | **No audit trail and no undo** on any hours, break, closure or leave change. | |
| **SA-M26** | **Guest manage flow has no `group_booking_id` awareness**, so one leg of a multi-service visit can be moved alone and the visit silently fragments. `guest_self_reschedule` is **default-ON**, so every venue is exposed. The only cross-cutting finding to survive round three intact. | `src/app/api/confirm/route.ts` reschedule branch |
| **SA-M27** | **Overnight windows are structurally impossible** — `refine(end > start)` at four layers plus two DB CHECKs. The practitioners route error tells users to split the shift across two days. | |
| **SA-M28** | **The diary cannot distinguish staff leave from ordinary off-hours, and merges them into one block** (VERIFIED 2026-08-15). `schedule-closure-blocks.ts` emits only three types: `venue_closed`, `venue_amended_hours`, `practitioner_closed`. At `:328-334` partial leave is concatenated into the **same array** as the off-working-hours ranges, passed through `mergeAdjacentRanges`, and emitted as `practitioner_closed` with `reason: null`. So a 16:00-17:00 leave abutting a 17:00 close **fuses into one grey block**, and "Sarah is on annual leave" renders identically to "Sarah does not work Wednesday afternoons". Full-day leave is worse: per `SA-M3` it is folded into `days_off` upstream, so it never reaches the diary as leave at all. Breaks are the exception and **do** render distinctly (amber, via `isBreakCalendarBlock` at `PractitionerCalendarView.tsx:487`), which is what makes the leave case look like an oversight rather than a design. Workaround: the separate leave page. **Blocks Phase 0's first item — see below.** | `src/lib/calendar/schedule-closure-blocks.ts:26,111,328-334`; `PractitionerCalendarView.tsx:486-508` |

---

# §6 Low findings and dead code

| ID | Finding |
|---|---|
| **SA-L1** | `venues.venue_opening_exceptions` — emptied by `20260517120000:56-58`, no UI writer, live PATCH route, two engine paths disagreeing on precedence. **Latent, not live.** Delete the route and column; make `appointment-engine.ts:130` fill only when null. |
| **SA-L2** | `availability_config.blocked_dates`/`blocked_slots` — written by two routes, read by `getAvailableSlots`, which has **zero production callers**; the UI is gated behind `showTableTab && !hasServiceConfig` (VERIFIED at `src/app/dashboard/availability/AvailabilitySettingsClient.tsx:630`), which an appointments venue never satisfies. |
| **SA-L3** | `service_schedule_exceptions` — write route with **no UI caller**; readers are table-model only. |
| **SA-L4** | **Every staff drag posts `allow_manual_overlap: true` unconditionally** (8 sites). Downgraded to Low on re-verification: this is **documented intent** (`PractitionerCalendarView.tsx:5591-5595`: "deliberate double-booking is legitimate, it just should not be silent"), and the client drag check passes `ignoreBookings: true` by design. Residual defect is inconsistency: visit moves toast a collision warning, single moves and resizes do not. |
| **SA-L5** | **Public booking flow computes "today" in the browser timezone.** `todayYmdInTimeZone` exists with a docstring explaining why it must be used and has one caller (the resource flow). Downgraded to Low: the engine is venue-local (`appointment-engine.ts:557-563`, `:885-895`) and `create` enforces `isGuestBookingDateAllowed` in venue time (`:1044`), so **no bad row is reachable**. Affects only guests physically abroad; UX only. |
| **SA-L6** | **Import auto-creates calendars at 09:00–22:00 seven days.** Downgraded to Low: `create-reference-entity.ts` inserts **no `calendar_service_assignments`**, and `getOfferedAppointmentServicesForPractitioner` returns `[]` without a link row (`appointment-engine.ts:529-536`), so the auto-created calendar **is not bookable**. 09:00–22:00 × 7 is the platform-wide default for every new calendar, not an import choice. **Do not "fix" this by setting `is_active: false`** — that would break `booking-import-defaults.ts:95` and hide every imported booking from the diary. |
| **SA-L7** | **Closure conflict finders miss only *empty* class and event sessions.** Downgraded: `findVenueClosureBookingConflicts` applies no booking-model filter, so class and event **attendees** are already counted as ordinary `bookings` rows. An empty session has no customer to strand. |
| **SA-L8** | **Recurring class rules validate against `class_timetable`**, which has zero writers including in migrations. Fails closed and is gated to class venues. |
| **SA-L9** | Empty-body `PATCH /api/venue/opening-hours` writes `{}`, which **widens** availability by erasing the venue-level clip (`isVenueOpeningHoursConfigured({})` returns false — VERIFIED at `src/lib/availability/appointment-engine.ts:389`). API-only, no UI path. |
| **SA-L10** | Em-dash in user-facing copy at `src/lib/calendar/hours-change-orphans.ts:99` (the "Save anyway?" prompt) and at `src/app/dashboard/availability/BookableCalendarsPanel.tsx:491,510,529,594`. **Corrected from the first draft**, which also counted three em-dash-as-empty-value glyphs; the `CLAUDE.md` rule targets punctuation, not placeholder dashes. |
| **SA-L11** | Accessibility: **no `<input type="time">` in these editors has an accessible name**; 24 labels are unassociated siblings; validation errors have no `aria-live`; the calendar-active toggle is a bare `<button>` with no `role="switch"`. |
| **SA-L12** | Mobile: the 4-tab strip overflows at 375px with no `overflow-x-auto` (`src/app/dashboard/availability/AppointmentAvailabilitySettings.tsx:792`); break inputs are ~28px against the 44px rule in `Docs/mobile-touch-layout-conventions.md`. |
| **SA-L13** | Owner-facing jargon: "Legacy blocked dates", "yield overrides", "calendar column", "Override max covers". Title Case and sentence case inconsistent between two copies of one widget. |
| **SA-L14** | **Corrected 2026-08-15.** An index exists — `idx_calendar_blocks_lookup (calendar_id, block_date)` at `20260430120000:144` — but it **leads on the wrong column**. The diary's list query (`api/venue/practitioner-calendar-blocks/route.ts:90-98`) filters `.eq('venue_id', ...)` then `block_date`, which a `calendar_id`-leading index cannot serve. Add `(venue_id, block_date)`. Stated as "no index" originally, which invites a reader to find `idx_calendar_blocks_lookup` and close the finding wrongly. |
| **SA-L15** | No composite `(venue_id, calendar_id)` FKs, so a cross-tenant block row is storable, visible in the staff list, and inert in availability. |
| **SA-L16** | "Any available" repeats the whole fetch per practitioner because `options.venueClockRow`/`bookingWindow` are not passed down. ~150 round trips for a 10-staff venue. |

---

# §7 What was rejected or downgraded, and why

Recording this matters as much as the findings.

## 7.1 Rejected outright in round two

| Claim | Why it fails |
|---|---|
| "Empty PATCH closes the venue permanently" | **Consequence inverted.** `{}` *removes* the clip and **widens** availability. Now `SA-L9`. |
| "`venue_opening_exceptions` is a live phantom-booking path" (filed Critical and High by two agents) | **Latent.** Only 1 of 15 call sites passes `venueBlocks`; the JSON-wins branch fires only when non-empty; migration set it to `[]` for every venue; no client calls the PATCH route. `SA-L1`. |
| "Blocking a date does nothing — Critical" | Control gated to legacy restaurant tier; never rendered for an appointments venue. `SA-L2`. |
| "`service_schedule_exceptions` data loss — High" | Write route with no caller. `SA-L3`. |
| "Part-day closures lose a whole day, silently" | Not silent. An amber banner names the behaviour and points at the working alternative. Re-scoped as `SA-M1`. |
| "Deleting a calendar frees the slot, so it will be double-booked" | The whole column is deleted; no slot exists. `SA-M4`. |
| "Staff can rewrite **any** calendar across venues" | **Intra-venue only.** Re-scoped as `SA-H4`. |

## 7.2 Downgraded in round three

Ten cross-cutting findings were adjudicated late. **Nine were downgraded; one survived.** Every literal code claim checked out — the corrections were all about compensating controls the finder never looked for.

`SA-H6` waitlist Critical→High (feature-flag gated) · `SA-M2` closed-day chain Critical→Medium (no automated no-show exists) · `SA-M3` `allowOutsideHours` High→Medium (staff-authenticated only) · `SA-M5` `is_active` High→Medium (admin-only, reversible) · `SA-M18` collective High→Medium (closures and leave *are* loaded) · `SA-L4` `allow_manual_overlap` High→Low (documented intent) · `SA-L5` browser timezone High→Low (no bad row reachable) · `SA-L6` import High→Low (not bookable) · `SA-L7` closure conflicts Medium→Low (attendees already counted) · `SA-L8` `class_timetable` Medium→Low.

**Pattern worth carrying forward:** three of these asserted a consequence chain whose last link did not hold, and two read documented intent as oversight without quoting the comments that explained it.

## 7.3 Errors corrected in this document

Round three red-teamed the first draft and found six. All are fixed above, and listed here because a report that hides its own corrections cannot be trusted:

1. **C3 and D1 were attributed to `Docs/Resneo_Remediation_Register.md`.** They are in `Docs/Resneo_Forensic_Audit_August_2026.md`. Five occurrences, including the flagship finding.
2. `SA-C2`'s "calls it twice (grep 0 vs 2)" counted lines, not calls.
3. `SA-M12` (`special_event`) was called consumerless. It is served by a **public anonymous route**.
4. The §2 matrix marked part-day closure as honoured exactly on create. It is widened there too.
5. `SA-C4` was filed High; it meets the Critical definition for personal-data exposure.
6. `SA-L10` counted three em-dash-as-empty-value glyphs as copy violations.

Also corrected from the target-state pass: **`recurrence_rule` on `unified_calendars` is not an unused column** (VERIFIED). It is read by `src/app/api/cron/materialize-event-sessions/route.ts:46-65`. Recurrence machinery exists for event calendars and was never extended to staff rota patterns.

---

# §8 GDPR assessment for SA-C4

The sibling audit ran a retrospective exploitation-log check for C0. The same discipline applies here.

**What is exposed.** `availability_blocks` with `USING (true)` and no venue predicate, including `reason`, a free-text field an owner types when closing the venue. Plausible contents name a health condition or a bereavement of an identifiable staff member. `unified_calendars` additionally exposes staff names alongside their working patterns and days off, platform-wide.

**Assessment required, in this order:**
1. **Sample the data.** Run the §14 `reason` query against production. If every row is operational ("stock take", "bank holiday"), this is a confidentiality issue and no more. If any row names a person's health or a bereavement, it engages Art. 9 special-category data and the assessment below becomes live.
2. **Check for exploitation.** Query access logs within the retention window for anonymous PostgREST reads of `availability_blocks` and `unified_calendars` that are not attributable to the app's own service-role traffic. The sibling audit's C0 note records how this was done.
3. **Art. 33 (notify the ICO within 72 hours) and Art. 34 (notify data subjects)** are triggered only by an actual breach, not by exposure alone. Step 2 decides it. Document the decision either way, with the reasoning and the date.
4. **Minimise regardless.** `reason` should become a controlled taxonomy with an optional private note that is never in an anonymously readable projection. This also serves `SA-M25`'s audit needs.

**Note for the fix:** dropping the anon policies is safe for request paths (everything public uses service-role) but interacts with **D1** in the sibling audit, which is unresolved. Sequence them together.

---

# §9 Observability: none of this would be visible in production

**CONFIRMED.** Sentry is installed with **two** capture sites repo-wide. **3 of 22** crons alert. All thirteen fail-open paths report via `console.warn`. There is no slots-offered metric, no consistency cron, and no structured logging in the availability path.

**Every finding in this document would be invisible today.** A venue would discover `SA-C3` when a customer arrives to a locked door.

**Minimum viable instrumentation:**
1. `Sentry.captureException` on every availability fetch error, tagged with venue and date. Converts `SA-C3` from invisible to paged.
2. A daily consistency cron: recompute the next 14 days through both the appointment resolver and the venue-wide resolver, alert on divergence. Catches `SA-M1`, `SA-H2` and future drift.
3. Slots offered versus booked, per venue per day. A step change is the signature of `SA-H3`, `SA-M10` and a mis-saved schedule.
4. Alert on any booking whose `booking_time` minute is off the venue's configured interval grid — the tripwire for `SA-H1`.

---

# §10 Target capability model

Fifty-eight concepts assessed: **15 present, 15 partial, 28 absent.**

**Present and genuinely good.** Wall-clock DST model; processing-time blocks; peak-concurrency capacity sweep; per-service availability windows; buffers and padding; minimum notice; slot granularity; fixed start times; the `venue-wide-business-hours` resolver; `ResourceExceptionsCalendar` and `ServiceCustomAvailabilityEditor` as UI models worth copying.

**Absent, in order of leverage:**

| # | Capability | Why it matters here |
|---|---|---|
| 1 | **Effective-dated hours versioning** | Hours are a single current value. *Every* "changing hours rewrites history" symptom and the whole orphan-warning apparatus exists because of this one gap. |
| 2 | **Consequence chain on closure** | `SA-M2`. Notify, bulk move, bulk cancel with refund, suppress reminders. |
| 3 | **Recurring closures** | "Closed every 25 December" needs one row per year, forever. |
| 4 | **Public-holiday library for UK and Ireland** | Four differing holiday sets across the core market; 12 July matters commercially in NI. |
| 5 | **Part-day venue closure for appointments** | Stored, honoured by four engines, discarded by one adapter. |
| 6 | **Rota and shift patterns** | Week-A/week-B rotas are the salon norm. Recurrence machinery exists for events (see §7.3) and was never extended. |
| 7 | **Leave workflow** | No approval, entitlements, half-days, coverage warnings, or team rota view. The rota view's data is **already returned by the API and never rendered**. |
| 8 | **Split shifts and multiple named breaks** | Venue hours cap at 2 periods; breaks have two competing storage shapes. |
| 9 | **Seasonal / date-ranged hours** | Requires an amended-hours block per range today. |
| 10 | **Bulk operations** | Copy a day to all days, apply across staff, "closed today" quick action. |
| 11 | **Overnight windows** | Blocked at four layers plus two DB CHECKs. |
| 12 | **Per-calendar timezone** | One `venues.timezone` platform-wide. |
| 13 | **Reduced capacity for appointments** | `reduced_capacity` blocks ignored by every non-restaurant engine. |
| 14 | **Closure reason taxonomy** | Free text, anonymously readable. §8. |
| 15 | **Audit trail, undo, optimistic concurrency** | None exist. |
| 16 | **Fail-closed reads and cache invalidation** | `SA-C3`, `SA-M9`. |
| 17 | **One place to manage the schedule** | §12. |

---

# §11 Target architecture

## 11.1 One canonical resolver

Create `src/lib/availability/resolver/`:

- **`loadScheduleContext(supabase, { venueId, calendarIds, dateRange })`** — the single fetcher. Every source declared `mustLoad`. One bounded retry. On unrecoverable failure returns `{ status: 'unavailable', cause }`, never partial data. This is the fix for `SA-C3` and must become the only way schedule data is read.
- **`resolveCalendarDay(context, calendarId, date)`** — pure, synchronous, no I/O. Returns `{ venueOpen, calendarOpen, bookable, occupied, exclusions, unrestricted }`, where `exclusions` carries a typed reason per removed interval so the diary can label it and the guest page can explain it.

Ten callers migrate one PR at a time: the day API, month API, `create`, `create-multi-service`, `create-group`, `confirm`, the venue booking routes, `calendar-grid`, the collective bridge, and `schedule-closure-blocks`. **Migrate `schedule-closure-blocks` and the appointment engine in the same PR** — that is what closes `SA-H2` and `SA-H3` together.

**In-flight bookings during cutover.** The resolver changes which slots are *offered*, not which are *stored*, so no booking is invalidated mid-flight. The risk is a guest who loaded a slot list under the old resolver and submits under the new one: they get a 409 they would not have got before. Mitigate by shipping the resolver behind a per-venue flag, running both in shadow for one week with the divergence cron (§9, item 2) pointed at them, and cutting over only venues with zero divergence. Retain the old path until the flag is removed everywhere.

## 11.2 Failing closed without a dead booking page

Fail-closed is only safe with a third state. Availability becomes `open | closed | unavailable`:

- `open` and `closed` behave as today.
- `unavailable` returns **HTTP 503 with `Retry-After`**, and the booking UI renders a retry card: "We could not load this venue's availability just now. Please try again in a moment."

The rule that makes it correct: **never render an empty week as though it were a closed week.** Today those are indistinguishable, which is exactly what makes `SA-C3` invisible.

## 11.3 The database integrity layer, and an honest account of C3

Straightforward and safe:
- Enable **`btree_gist`** (absent today).
- Ordering **CHECK**s added `NOT VALID` then validated, on `availability_blocks`, `calendar_blocks`, `practitioner_calendar_blocks`, `practitioner_leave_periods`, `service_schedule_exceptions`, `event_sessions`.
- Composite **`(venue_id, id)` FKs** (`SA-L15`); **`created_by … ON DELETE SET NULL`** (`SA-M14`); index `calendar_blocks (venue_id, block_date)` (`SA-L14`).
- **`EXCLUDE USING gist`** on non-overlap for *blocks* and *leave*. **Note: `EXCLUDE` constraints cannot be added `NOT VALID`.** They validate immediately and will fail if existing rows overlap. Run the overlap-count query in §14 first and clean up before adding them.

**On appointments and C3, honestly.** The sibling audit struck the trigger fix for six reasons. A `pg_advisory_xact_lock` branch in `enforce_cde_capacity()` answers **two** of them: adding `practitioner_id`/`calendar_id` to the trigger's firing column list, and counting concurrent bookings inside the lock rather than rejecting on pairwise overlap, which preserves `parallel_clients > 1` and gap-interleaved bookings.

**It does not answer the other four, and this document does not claim it does:**
1. **Occupancy is not derivable from the `bookings` row.** There is no `buffer_minutes` column; the true busy interval comes from six engine helpers. Counting "concurrent bookings" in SQL means porting that logic to plpgsql and keeping two implementations in step forever. This is the objection that killed the original proposal and it is still unanswered.
2. **Phantom bookings have no rows**, so a DB-level guard cannot see them.
3. **A multi-service visit is N rows in N transactions**, potentially across calendars, so the advisory lock releases between segments.
4. **There is no appointment-branch `23P01 → 409` handler** at the nine write sites; without one, a lost race becomes a 500.

**Therefore:** ship the interim (re-validate immediately before insert, in-request) now, and treat the durable guard as designed work with its own spike. **Phase 2's exit criterion must not include removing the application-level recheck** until objections 1–4 are resolved.

## 11.4 Effective-dated schedules

A `schedule_versions` table keyed by `(scope, scope_id, valid_range daterange)` with a `daterange` exclusion constraint, **dual-written into the existing columns by trigger** so the ~40 existing readers keep working during cutover.

Two things the first draft missed:
- **A trigger fires on write, not on a date.** A version whose `valid_range` starts 1 September will never activate on its own. Either a daily job rolls the derived columns forward, or readers resolve through `schedule_versions` directly. Prefer the latter; the derived columns are a migration aid, not the model.
- **Dual-write is one-way.** While it is on, any writer that touches the legacy column directly diverges silently. Audit for direct writers and route them through the new table before enabling.

## 11.5 Cache and revalidation

Drop `s-maxage` from `src/app/api/booking/appointment-calendar/route.ts:197`. Key the data cache on a DB-owned `venues.availability_epoch` bumped by trigger on every schedule write. A saved closure is then visible on the next request, in every region, with no `revalidateTag` fan-out to maintain.

## 11.6 Test strategy

- **Parity tests**: a fixture matrix asserting the day API, month API, `create` and the diary agree for every row in §2. This is the regression net the subsystem has never had. Budget for it: 14 constraints × 4 layers is ~56 assertions over a shared fixture, roughly two days' work, and it is the single highest-leverage test investment here.
- **Property tests** on interval arithmetic (subtract, intersect, union): random ranges, assert no overlap in output and no lost minutes.
- **DST fixtures**: both UK transition days, plus an 09:35 appointment for `SA-H1`.
- **Concurrency test**: two simultaneous inserts into one slot yield exactly one success.
- **Fail-closed test**: mock each schedule query to error, assert 503 rather than an empty week.
- **Put pgTAP in CI.** It runs nowhere, and `SA-H4`'s fix is exactly the change that needs it.

---

# §12 The screen this product is missing

Today: 12 surfaces, 4 pages, 14+ clicks to change one day's closing time, 27 for five stylists' lunch break.

**`/dashboard/schedule` — one workspace.**

- **Left rail: who.** The venue, then each calendar. Selecting the venue edits business hours; selecting a person edits their hours, breaks and leave.
- **Centre: the resolved week.** Not the raw template, the *resolved* result, with the venue's open band painted behind each person's row so the interaction between the two is visible rather than inferred. Closures, leave, breaks and amended hours each in their own colour, with a permanent legend.
- **Right: inspector.** Click any band or block to edit in place. Date-range and repeat controls live here, so "every 25 December" and "every second Tuesday" are one interaction.
- **Bottom: live impact strip.** As the owner edits: "3 appointments fall outside your new hours." Clicking it opens the review step from `SA-M2` — move, cancel and refund, or keep, in bulk or individually, with a notify toggle.

**The inversion that makes it work:** the owner edits the *resolved* week and the system decides which store to write. That collapses "closure versus amended hours versus leave versus block" from a data-modelling question the owner must answer into an outcome they simply describe.

**Copy tone**, per `CLAUDE.md`: plain, warm, second person, no em-dashes. "You are open 9:00 to 17:00 on Saturdays." "Sarah is on leave that week, so nothing can be booked with her."

**Targets:** Saturday closing time in **≤4 clicks on one page**; lunch break for five stylists in **≤6**; zero `window.confirm`.

---

# §13 Delivery blueprint

Sizes: S ≈ under a day, M ≈ a few days, L ≈ a week or more.

### Phase 0 — Stop the bleeding

| Item | Closes | Size |
|---|---|---|
| **Widen the diary block type first** so leave, off-hours and breaks are distinguishable (`schedule-closure-blocks.ts:26`) | `SA-M28`, and **unblocks the row below** | **S** |
| `isOccupyingBlock(blockType)` in `slotOccupied` (`PractitionerCalendarView.tsx:1692`) and `appointmentWindowCollides` (`:1751`) | `SA-H3`, `SA-H5`, the `SA-M2` lockout | **S** |
| Apply variant + add-on duration before the reschedule availability check (`src/app/api/confirm/route.ts:1457`) | `SA-C2` | **S** |
| Availability check in the cancel-driven waitlist offer | `SA-H6` | **S** |
| Suppress reminders for bookings inside a closure (`src/lib/booking/unified-scheduling-comms.ts:72-81`) | part of `SA-M2` | **S** |
| `Sentry.captureException` at all thirteen fail-open sites | makes `SA-C3` visible | **S** |
| ~~Re-validate immediately before insert~~ **DONE, on production** (sibling audit's C3 interim, five write paths) | interim `SA-C1` | ~~S~~ |
| **Extend that re-check to `src/app/api/confirm/route.ts`** — the one appointment-writing path it does not cover | `SA-C1` on the reschedule path | **S** |
| Booking-window guards on multi-service and group routes | `SA-H7` | **S** |
| Move the full-day leave gate out of the `allowOutsideHours` block | `SA-M3` | **S** |
| Two-pass offset in `venueLocalDateTimeToUtcMs` + DST fixtures | `SA-H1` | **M** |
| Drop `s-maxage`; add `availability_epoch` | `SA-M9` | **S** |
| Drop the nine anon policies; `REVOKE INSERT/UPDATE/DELETE` from `anon, authenticated` | `SA-C4`, `SA-H4` | **M** |
| GDPR assessment per §8 | `SA-C4` | **S** |

**Ordering within Phase 0 (added 2026-08-15).** `isOccupyingBlock(blockType)` has to switch on a type that carries the distinction it needs, and today's does not: leave, off-hours and working-hour boundaries all arrive as `practitioner_closed` (`SA-M28`). Widen the emitted type **before** writing that helper, or the helper cannot tell a break it should permit from leave it should refuse, and the work stalls halfway. It is a small change in one file and it makes the highest-value fix in the audit actually implementable.

**Dependencies (UPDATED 2026-08-15).** ~~The revoke item depends on D1 being resolved.~~ **D1 is complete**, so that dependency is discharged: A2 narrowed `bookings` to column-level `SELECT` and realtime survived, `20270112120000` is the worked precedent, and the RLS pgTAP suite now runs in CI as a safety net. Run §14 first regardless. Everything else in Phase 0 is independent and can proceed in parallel.

**Exit (UPDATED).** All merged; a concurrency test proves one winner; a fail-closed test proves 503 not empty. ~~`npm run test:db` runs in CI~~ — **already true**: the `rls-pgtap` job runs on every push and PR against a local Supabase built from the migrations, passing 24/24. Note the gotcha it carries: `supabase/scripts/local_baseline_grants.sql` applies hosted-equivalent table grants to that local instance, and **any table this phase narrows must be excluded from it**, exactly as `bookings` is, or CI will silently hand the privileges back and validate a permission environment that exists nowhere.

### Phase 1 — One resolver
Build `src/lib/availability/resolver/`; migrate all ten callers behind a per-venue flag with a shadow week (§11.1); land the §11.6 parity matrix. Closes `SA-C3`, `SA-H2`, `SA-M1`, `SA-M10`, `SA-M8`, `SA-M12`, `SA-M19`, `SA-L1`, `SA-L3`. **L.**
**Exit:** §2 has no ⚠️ outside deliberately-dead rows; one resolver import per caller; zero divergence for one week on every venue before the flag is removed.

### Phase 2 — Database integrity
`btree_gist`, CHECKs, exclusions, FKs, indexes. Closes `SA-M6`, `SA-M14`, `SA-L14`, `SA-L15`. **M.**
**Exit:** pgTAP green in CI (the job exists and passes; add this phase's assertions to it). **Not** "app-level recheck removed" — see §11.3.
**Note 2026-08-15:** the operator has **deferred C3's durable database guard** on exposure grounds, so the `EXCLUDE`/appointment-overlap portion of this phase is deferred with it. The CHECKs, FKs and indexes closing `SA-M6`, `SA-M14`, `SA-L14` and `SA-L15` are unaffected and remain worth doing.
**Dependencies:** cannot precede Phase 1, or new constraints reject writes the current UI makes. Clean up overlapping rows before adding `EXCLUDE`.
**Rollback:** CHECKs and indexes drop cleanly. `EXCLUDE` constraints do too, but any rows rejected while they were live are simply absent, so keep the failed-write log.

### Phase 3 — Effective-dated schedules
`schedule_versions`, dual-write trigger, reader migration, roll-forward resolution per §11.4. **L.**
**Exit:** future-dated hours work; historic bookings report against the hours in force on their date.
**Dependency the first draft hid:** this **re-opens all ten Phase 1 callers**, because they must resolve through `schedule_versions`. Budget it as Phase 1 plus a third, and do not start Phase 4 in parallel.

### Phase 4 — The Schedule workspace
`/dashboard/schedule` per §12, retiring the 12 surfaces. Closes `SA-M15`, `SA-M20`–`SA-M25`, `SA-L11`–`SA-L13`. **L.**
**Exit:** both click-count targets met; zero `window.confirm`; a11y audit clean.
**Dependency:** cannot precede Phase 1, or the screen shows a resolution nobody else agrees with.

### Phase 5 — Product capabilities
Public-holiday library (UK + IE), recurring closures, rota patterns, leave approval and balances, team rota view, bulk operations, closure notifications and bulk cancel (completing `SA-M2`). **L.**

### Phase 6 — Long tail
Overnight windows (`SA-M27`), per-calendar timezone, reduced capacity for appointments, closure reason taxonomy (also §8's minimisation), audit trail and undo (`SA-M25`), `SA-M13`, `SA-M16`, `SA-M17`, `SA-M18`, `SA-M26`, `SA-L2`, `SA-L4`–`SA-L10`, `SA-L16`. **M–L.**

**Every finding in §3–§6 appears in exactly one phase.** If you re-scope, keep that property.

---

# §14 Confirm before acting: live queries

```sql
-- 1. SA-H4: what do client roles actually hold? Run before any REVOKE.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated')
  and table_name in (
    'unified_calendars','calendar_blocks','availability_blocks',
    'practitioner_leave_periods','practitioner_calendar_blocks',
    'service_schedule_exceptions'
  )
order by table_name, grantee, privilege_type;
```
Expected if the finding holds: `SELECT`, `INSERT`, `UPDATE`, `DELETE` for `authenticated`. **Keep `SELECT`** when revoking.

```sql
-- 2. SA-C4 / §8: is any closure reason personal or health-related?
select id, venue_id, date_start, reason
from availability_blocks
where reason is not null and btrim(reason) <> ''
order by created_at desc
limit 200;
```

```sql
-- 3. SA-H1: how many bookings are already off the interval grid?
select count(*) filter (where extract(minute from booking_time)::int % 15 <> 0) as off_grid,
       count(*) as total
from bookings
where booking_date >= current_date - 90;
```

```sql
-- 4. Phase 2: existing overlaps that would make EXCLUDE fail on creation.
select calendar_id, block_date, count(*)
from calendar_blocks a
where exists (
  select 1 from calendar_blocks b
  where b.calendar_id = a.calendar_id and b.block_date = a.block_date
    and b.id <> a.id and b.start_time < a.end_time and b.end_time > a.start_time
)
group by 1,2 order by 3 desc;
```

```sql
-- 5. SA-M13: are there surviving legacy practitioners rows?
select count(*) from practitioners;
```

```sql
-- 6. SA-C4 blast radius: how many venues have waitlist_v2 on (sizes SA-H6 too)?
select count(*) from venues where feature_flags ->> 'waitlist_v2' = 'true';
```

---

# §15 Open questions

1. **Does the mobile app consume `/api/venue/calendar-grid`?** Only a code comment says so; `Docs/MOBILE_API.md` does not list it. Decides whether `SA-M19` is Medium or Low. Settle in the mobile repo.
2. **Do any venues still have `practitioners` rows?** Settles `SA-M13`. Query 5.
3. **How many bookings are already off-grid?** Sizes `SA-H1` remediation. Query 3.
4. **Is `venue_opening_exceptions` `[]` on production as well as staging?** Confirm before deleting the column (`SA-L1`).
5. **Which venues have amended-hours blocks that widen rather than narrow?** These venues are living `SA-H2` and `SA-H3` together and are the right pilot group for Phase 1.
6. **Is D1 in the sibling audit resolved?** It gates the `SA-H4` revoke.

---

## Appendix: method and confidence

Nine agents ran across three rounds. Round one investigated five layers in isolation. Round two attacked round one, adjudicated the RLS question, hunted cross-cutting flows, and designed the target state. Round three adjudicated the cross-cutting findings and red-teamed this document.

**Round two rejected 8 findings and downgraded 14, including three filed as Critical. Round three downgraded 9 of 10 remaining findings and corrected 6 errors in this document.** Five inter-agent contradictions were resolved from the code; all are recorded in §7.

Confidence is highest on §3 and §4, where every claim was read at its line by at least two agents and the highest-stakes were re-read by the author. Confidence is lowest where a finding depends on an unverified consumer (`SA-M19`) or on production data this audit could not see (`SA-C4`'s blast radius, `SA-H1`'s remediation size); those are listed in §15 with the query that settles them.

The recurring lesson, worth more than any single finding: **this codebase gets rules right in one place and does not carry them to their siblings.** The good resolver exists and one engine ignores it. The fail-closed pattern exists in one route and thirteen sites fail open. The admin-scoping helper exists and is wired to one policy. `isGuestBookingDateAllowed` exists and two create routes skip it. The fix that generalises is not any individual patch: it is §11.1, one resolver that no caller can bypass.
