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

## IMPLEMENTATION STATUS, 2026-08-16 — rounds 1 and 2 shipped and verified on staging

**Read this before scheduling anything below.** Twelve commits are on `staging` (`0c2f4773..c65fd0ef`); `main` is still at `0c2f4773`. Round 1 was **code only, zero files under `supabase/`**, so it carried no schema window and none of the expand/contract hazard. Baseline after it: `tsc --noEmit` clean, **341 files / 3209 tests** passing, 260 migrations unchanged.

**Closed by round 1.** `SA-C2` · `SA-C3` (made *visible*, not fail-closed — see below) · `SA-H3` · `SA-H5` · `SA-H6` · `SA-H7` · `SA-M2`'s diary lockout · `SA-M3` · `SA-M9`'s cache header · `SA-M13` · `SA-M28` · `SA-C1`'s residual on `api/confirm`. Each finding below carries its own status line.

**Round 3 shipped: `a47fecf9`, staging, hand-tested. Code only, no migration.** `SA-H1` closed by deleting the noon-fallback wall clock and pointing all seven callers at the correct function that was already in the same file. See the finding for what that changes and what it deliberately does not (no `estimated_end_time` backfill, declined by the operator).

**Still carved out.** Closure-aware reminder suppression, the remaining half of `SA-M2`: outbound comms, fails silently, wants its own round.

**With `SA-H1` closed, every Critical and every High in this document is now closed or explicitly deferred by decision.** What remains at High is `SA-H2` (amended hours meaning "replace" to one engine and "intersect" to another), which is **not** a standalone fix — it is the clearest symptom of there being two resolvers, and it closes when Phase 1 lands. And `SA-H4` steps 2 and 3, which are the durable half of a finding whose direct path round 2 closed.

**Round 2 shipped: `20270113120000`, on staging code and staging database.** Nine anon SELECT policies dropped (`SA-C4`), and `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` revoked from `anon, authenticated` on the six scheduling tables (`SA-H4`), `SELECT` kept. The six are excluded from `supabase/scripts/local_baseline_grants.sql` alongside `bookings`, or CI re-grants after migrations run and validates a permission environment that exists nowhere. `supabase/tests/scheduling_grants_test.sql` adds 18 assertions; the suite now runs 42 and passes.

**Verified against the live staging database, not inferred.** Querying with the publishable key — the same request an anonymous attacker makes — `unified_calendars`, `availability_blocks`, `service_items`, `venue_services` and `service_schedule_exceptions` all return `[]`. Empty arrays rather than errors, which is the designed shape: `anon` keeps the privilege, RLS finds no permissive policy, no rows. An anonymous INSERT returns `42501 permission denied for table`, which is the **grant** refusing; before this migration the same request reached RLS and was refused one layer later. Both behavioural gates passed too: the diary still updates live from a second session (the realtime path on the two tables that keep `SELECT`, whose failure mode is silence), and a public booking still completes end to end.

**Enumeration is narrowed, not closed, and the difference matters.** Roughly twenty further `TO anon` SELECT policies remain on the booking-catalogue tables: `appointment_services`, `calendar_service_assignments`, `service_variants`, `addons`, `class_types`, `class_instances`, `venue_resources` and the two collective tables. Several expose venue names and prices platform-wide by the identical mechanism. The nine dropped here are what this audit scoped; the rest are a separate surface with different public-page consumers and want their own pass. Recorded in the migration header as well, so it is not mistaken for a finished job.

### What staging testing changed, and it is not a footnote

Round 1 was hand-tested on staging on 2026-08-16 against venue `plus1@reserveni.com`. **Two of the shipped fixes did not work, and both failures were in the finding this document called its highest-value fix.** Everything else passed: the variant and add-on reschedule durations, the booking-window refusals on the multi-service and group routes, the waitlist closure suppression, and the walk-in refusal onto full-day leave.

| What the document said | What shipping it actually took |
|---|---|
| `SA-H3`/`SA-H5`: "Introducing `isOccupyingBlock(blockType)` and using it in both resolves all three. **Highest value-per-line fix in the audit.**" | The rule change alone **changed nothing a user could do.** `SA-H3` also needed the diary's hit-testing fixed (`cb51f514`); `SA-H5` also needed the `allowDuringBreaks` override threaded through four layers plus the visit dry-run route (`c65fd0ef`). |

The mechanism is worth carrying into every remaining phase. `slotOccupied` returning `false` only **enables** the empty-slot button; the closure block is still drawn as an overlay at z-index 15 over slot buttons at z-0, and its inner button is `disabled`, so it swallowed the click. On an amended-hours day every minute carries a block, so the whole column stayed dead to the mouse. Drag and drop was unaffected — dnd-kit resolves a drop by pointer collision against registered droppable rects, ignoring z-order — which is exactly why the unit tests, the adversarial review and this document all missed it: **the path that was tested was the path that already worked.**

Separately, `SA-H5` assumed one gate where the engine has two. `allowOutsideHours` has never relaxed a break; `allowDuringBreaks` is a distinct option that only the walk-in create path had ever sent. Making `break` non-occupying on the diary unlocked the gesture and the PATCH answered `409 Conflicts with a break`. Threading it also exposed a second hole beside it: the dry run a multi-service visit runs before any row is written accepted neither override, so a **visit** dragged past closing was refused while the identical drag on a single booking succeeded.

**The lesson generalises, and it sharpens §15's closing paragraph rather than contradicting it.** This document is reliable about *where a rule is wrong*. It is not reliable about *how many layers enforce that rule*, and it consistently sized fixes as though the layer it had read were the only one. Before scheduling any remaining item, enumerate the enforcing layers — rule, hit-testing, server gate, dry run — rather than trusting the size estimate.

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

**3. ~~Two findings are new, cheap and worth fixing this week.~~ DONE 2026-08-16, and the "one small fix" was wrong.** `SA-C2` and `SA-H3`/`SA-H5` all shipped in round 1. They do share one root cause, but `SA-H3` and `SA-H5` each needed a **second enforcing layer** this document never mentions, and the first attempt at each passed CI while changing nothing a user could do. See the implementation status above before you trust any size estimate here.

**4. ~~One finding is a personal-data exposure and should be treated as a GDPR matter.~~ Falsified 2026-08-16 by production query.** `availability_blocks.reason` is **empty platform-wide**, so there is no personal data behind the exposure. `SA-C4` is downgraded Critical → **High** and is a venue-enumeration oracle, not a GDPR matter. §8 records the completed assessment; Art. 33/34 are not engaged. The structural exposure is real and the fix is unchanged.

**5. ~~Two claims still need a live database query before you act.~~ Both queries run 2026-08-16.** `SA-H4`'s premise holds and its fix is safe, but `anon`'s grant surface is **wider than this document states** — the full default set including `TRUNCATE` — so the revoke verb list in `SA-H4` is incomplete as written. `SA-C4`'s scope is settled by item 4. Queries and results in §14.

---

## Baseline

| Check | Result, 2026-08-15 |
|---|---|
| `npx tsc --noEmit` | Clean, exit 0 |
| `npx vitest run` | 331 files / 3132 tests at `e7ab9ac0`; 335 / 3157 at `fe09c0a4`; **341 / 3209 at `c65fd0ef`** |
| Migrations | 258 at `e7ab9ac0`; **260 at `fe09c0a4`, unchanged at `c65fd0ef`** — round 1 touched no file under `supabase/` |
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

**Anchor note.** Line numbers are exact at `e7ab9ac0`, re-checked at `fe09c0a4`.

> **Anchors are stale from 2026-08-16 onward, and `PractitionerCalendarView.tsx` badly so.** `staging` is at `c65fd0ef`, twelve commits past `0c2f4773`. Round 1 added roughly 2,100 lines across 22 files, so **every line number in this document should be treated as a hint, not a citation** — most are now wrong by tens to hundreds of lines. `SA-H3`'s six-link chain is the worst affected: all six of its cited lines have moved.
>
> Grep for the symbol, not the line. File paths are unchanged except where a finding's status note says otherwise, and the new helpers round 1 introduced (`isOccupyingBlock`, `applyReservedDurationToInput`, `reportAvailabilityReadFailure`, `windowCrossesBreakBlock`) are named in the status notes rather than located by line, for this reason.

Files are cited by full path throughout, because the sibling audit records the cost of bare filenames.

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
| Staff leave (full day) | ✅ | ✅ | ~~⚠️ skipped when `allowOutsideHours`~~ **✅ 2026-08-16** | ✅ | ❌ |
| Staff leave (partial) | ✅ | ✅ | ✅ | ✅ | ❌ |
| `calendar_blocks` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `practitioner_calendar_blocks` | ✅ | ✅ | ✅ | ✅ | ❌ |
| Min booking notice | ✅ | ✅ | ✅ | n/a | n/a |
| **Max advance / same-day rule** | ❌ | ✅ | ~~⚠️ **absent on multi-service and group**~~ **✅ 2026-08-16** | n/a | n/a |
| `service_schedule_exceptions` | ❌ inert | ❌ | ❌ | ❌ | ❌ |
| `availability_config.blocked_dates` | ❌ no reader | ❌ | ❌ | ❌ | ❌ |

**On the Staff diary column (added 2026-08-15).** The leave rows were re-verified and both ✅ are correct: `schedule-closure-blocks.ts` handles partial leave via `unavailable_start_time`/`unavailable_end_time` and detects full-day leave by both being null. Note also that on **part-day closures the diary is the more correct surface** — it uses the intersecting resolver and renders the partial window properly; it is the guest-facing appointment engine that widens to a whole day. That ⚠️ is not a diary defect. What the column does **not** capture is that ✅ here means *honoured*, not *labelled*: several constraints are honoured while rendering as the same undifferentiated block. See `SA-M28`.

**Correction against the first draft:** the part-day-closure "create" cell was previously marked ✅. It is not. `src/app/api/booking/create/route.ts:1019` calls the correct resolver but sits in the **class-session** branch; the appointment branch begins at `:1030` and goes through `fetchAppointmentInput` and the widening adapter. Part-day closures are widened on every appointment layer, consistently. That makes it a revenue-loss defect rather than an overbooking one.

The mobile column's consumer is **unverified from this repo**: the only evidence is a comment at `src/lib/unified-availability.ts:57-60`, and `Docs/MOBILE_API.md` does not list the route. The mobile *write* path does run the engine, so this is a display gap, not a booking bypass.

**Updated 2026-08-16.** Two create-column cells flipped to ✅ in round 1: full-day leave (`SA-M3`) and the max-advance rule on the multi-service and group routes (`SA-H7`). **Every remaining ⚠️ and ❌ in this matrix is still accurate**, and the two ⚠️ rows that matter most — part-day closure and amended hours — are Phase 1 work, not Phase 0, because they need the one resolver rather than a patch per column. The Staff diary column's ✅ marks should still be read as *honoured*, not *labelled*, with one improvement: leave now renders distinctly from off-hours (`SA-M28`).

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

> **CLOSED 2026-08-16 · `f56b3209`, staging.** Both adjustments now go on the input *before* the check, via a shared `applyReservedDurationToInput` helper, and the pre-insert re-check landed on the same path in the same commit as the update above advised. Verified on staging: a 150-minute variant of a short parent reschedules to its own length, add-ons survive a same-service move, and a move to a *different* service drops both rather than carrying a variant the new service cannot resolve.
>
> **A trap this fix walked into, worth recording.** The obvious implementation mirrors `booking/create`, and it is wrong. `create` reads `baseSvc` because its `svc` is rebuilt by re-applying the variant on top of the practitioner-link merge, which resets the duration and drops the add-on minutes. On the confirm path `svc` is only the merge, so it keeps both, and reading `baseSvc` there writes the catalogue length for any practitioner holding a `custom_duration_minutes` override. Two defects came from copying the sibling without checking that it builds `svc` differently; both were caught in adversarial review (`143a6c1a`).

---

### SA-C3 — Availability reads fail open: a database error is computed as "nothing is blocked"
**CONFIRMED (VERIFIED) · Critical as a class**

Thirteen sites verified by direct grep, every one logging a warning and substituting an empty result:

- `src/lib/availability/appointment-engine.ts:1244` (leave), `:1360` (`practitioner_calendar_blocks`), `:1377` (`venues.opening_hours`), `:1423` (`unified_calendars`), `:1560` (leave, calendar path), `:1710`, `:1713` (`calendar_blocks`), `:1716`
- `src/lib/availability/appointment-month-availability.ts:245`, `:249`, `:283`
- `src/lib/unified-availability.ts:109`, `:195`

> **The count is wrong, and the error was in the dangerous direction.** Implementation enumerated the sites rather than trusting this list: there are **49**, not thirteen. The thirteen above are the ones that logged a `console.warn`, which is precisely why they were the ones a grep found. The other thirty-six substituted an empty result and said **nothing at all**, so the audit's own instrument — grepping for the warning — could only ever find the visible half of a finding about invisibility. Enumerate before trusting any count in this document.

**Failure:** one PostgREST request inside a `Promise.all` fails while the bookings query succeeds. "I could not read the leave table" becomes "nobody is on leave", and the engine sells the day a stylist is abroad.

The adversarial round rated a single incident High, since it is fault-conditional rather than steady-state. It is recorded Critical **as a class** because it is forty-nine instances of the same inverted default in the one subsystem where the safe default is obvious, and because §9 shows nothing would tell you it had happened.

**The good pattern exists in-repo:** `src/app/api/venue/schedule/route.ts` fails closed on all eight of its sub-queries. §11.2 gives the contract that makes failing closed survivable rather than a blank booking page.

> **PARTIALLY CLOSED 2026-08-16 · `03b0053c`, staging. Made visible, NOT fail-closed — do not read this as done.** All 49 sites now report to Sentry before the substitution, via `src/lib/availability/availability-read-failure.ts`, fingerprinted by call site so a transient wobble and a persistent outage land in one issue per site rather than one per database message.
>
> The behaviour is unchanged: a failed read still becomes "nothing is blocked" and the engine still sells the day. Failing closed needs the third `unavailable` state and a booking UI that can render it, and neither exists yet — that is §11.2, in Phase 1. The reporter's `assumed` field is required rather than optional for this reason: it forces each call site to state what the engine now believes, which is the difference between an alert someone can act on and one they scroll past.
>
> **Operationally:** the `availability-read-failure` fingerprint should be empty. Anything in it is a genuinely broken read that was previously silent, not noise from the change.

---

### SA-C4 — Anonymous, platform-wide read of every venue's schedule, including free-text closure reasons
**CONFIRMED (VERIFIED) · ~~Critical (personal data)~~ → High (venue enumeration). Downgraded 2026-08-16 by production query.**

> **The personal-data limb is dead, and with it the Critical rating.** §14's `reason` query was run against production: **`availability_blocks.reason` is empty platform-wide.** There is no free text, so there is no Art. 9 special-category exposure, no realistic "closed for the funeral" content, and nothing for §8's notification assessment to bite on.
>
> §7.3 item 5 raised this finding from High to Critical **specifically** for personal-data exposure. That reason no longer holds, so it returns to **High**. What remains is real and unchanged: `unified_calendars` exposes every venue on the platform's working hours, breaks, days off, staff names, prices and capacity in one unauthenticated request. That is a **venue-enumeration oracle**, which is exactly what the team's own `20270107120000` called it — a confidentiality and competitive-intelligence matter, not a breach matter.
>
> **The fix does not change.** Drop all nine policies in round 2. The downgrade affects the GDPR obligations in §8 and the urgency, not the work.

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
2. ~~`availability_blocks.reason` is **free text an owner types**, anonymously readable with no predicate at all. Realistic contents: "closed for the funeral", "Sarah's surgery". That is potentially special-category data under UK GDPR Art. 9. See §8.~~ **Falsified 2026-08-16:** the column is empty platform-wide. The exposure is structural (the policy has no predicate) but there is no content behind it. Minimisation per §8 step 4 is still worth doing before anyone starts typing in that field.

**Correction worth recording:** staff *leave* notes are **safe**. `practitioner_leave_periods` and `practitioner_calendar_blocks` have no `TO anon` policy. The free-text exposure is `availability_blocks.reason` only.

**These policies are not load-bearing.** All public booking routes and both public page loaders use the service-role client, so they can be dropped without touching a request path.

> **CLOSED 2026-08-16 · `20270113120000`, on staging code and staging database.** All nine dropped. Verified behaviourally rather than by reading the policy list: an anonymous request with the publishable key now returns `[]` from `unified_calendars`, `availability_blocks`, `service_items`, `venue_services` and `service_schedule_exceptions`, and a public booking still completes end to end.
>
> **The "not load-bearing" claim was re-derived before shipping, not inherited.** All 27 files importing the browser client issue no `.from()` against any affected table. Of the 166 files using the anon-key *server* client, the only anonymous ones are the three public create routes, and there every query runs on the admin client while the anon client is used solely for the login gate. Two `security_invoker` views exist in the schema and neither reads these tables. That check is the reason this was safe to ship without a flag.
>
> **Scope, stated so it is not overread.** Roughly twenty `TO anon` policies remain on the booking-catalogue tables and several leak venue names and prices by the same mechanism. This audit scoped nine. Platform-wide enumeration is narrowed, not closed; the remainder wants its own pass with its own consumer check.

> **Independently re-verified 2026-08-15.** All nine policies exist at the cited migrations with the cited predicates. The load-bearing claim was tested the way the sibling audit learned to test one: **no file importing the browser Supabase client reads any of the nine tables.** This is the best-evidenced finding in the document and is safe to action.

---

# §4 High findings

### SA-H1 — `venueLocalDateTimeToUtcMs` silently returns noon UTC for most booking times
**CONFIRMED (VERIFIED) · High**

`src/lib/venue/venue-local-clock.ts:52-58` finds the UTC instant for a venue-local wall time by walking a 15-minute grid outward from noon UTC (`anchor + (step - 96) * 15 * 60 * 1000`), returning `anchor` if nothing matches. Every real IANA offset is a multiple of 15 minutes, so **only wall times whose minute is 0, 15, 30 or 45 can ever match**. Everything else returns noon UTC.

Off-grid times arise four ways: `booking_interval_minutes` accepts 1–60; `booking_start_times` accepts arbitrary `HH:MM`; `src/lib/appointments/booking-interval.ts:116` steps from `range.start` not from `:00`, so hours beginning at 09:05 make *every* slot off-grid; and staff drag snaps to `CALENDAR_MOVE_INCREMENT_MINUTES = 1`, which the shipped help article tells staff to do.

**Downstream:** `src/lib/booking/comms-timing.ts:21,31` (a 2-hour reminder for an 09:35 appointment is computed against noon and fires *after* the appointment), `src/lib/emails/calendar-links.ts:90` (the confirmation email's "add to calendar" link says noon), `src/lib/table-management/booking-status.ts:137` (no-show grace window), `src/lib/booking/venue-booking-model-disable-guard.ts:109`, `src/app/api/booking/create/route.ts:1536`. Nothing normalises `booking_time` on write.

**Fix (M):** replace the grid probe with the standard two-pass offset algorithm — compute the offset at a guess instant, apply, recompute, apply. `timeZoneOffsetMs` already sits in the same file. Add fixtures for 09:35 and both UK DST transition days. **Size the remediation first** with the §14 query for existing off-grid rows.

> **CLOSED 2026-08-16 · `a47fecf9`, staging, hand-tested. Code only, no migration. The fix was S, not M, and the reason is the pattern this whole document keeps finding.**
>
> Nothing had to be written. **`venueLocalWallTimeToUtcMs` was already in the same file**, already the two-pass algorithm, already exact for any minute, and its own docstring already said the grid version "must not be used for booking start times on 5/10-minute marks". One caller used it. Seven used the broken one. The grid probe is **deleted** rather than repaired, so one implementation survives and there is no second one to pick by accident; the signatures were identical, so every call site was a rename.
>
> **The severity was understated, and measurement is what showed it.** This document says only :00/:15/:30/:45 can match, which is right but reads like an edge case. Running both implementations across a full day: the probe was wrong for **1344 of 1440 minutes**. It is not that off-grid times fail, it is that on-grid times were the only ones that ever worked.
>
> **One downstream consequence this document does not name, and it is the worst of them.** `booking-status.ts:137` is the no-show grace window: with the start pinned to noon, an afternoon booking was eligible to be auto-marked **no-show** from noon onward, hours before the guest was due. The listed consequences are all "fires at the wrong time"; this one marks a paying guest absent.
>
> **`estimated_end_time` already holds bad data.** `create/route.ts` writes that column as a stored instant, so noon-derived values exist for off-grid resource bookings made before this. The fix corrects new writes only. **A backfill was considered and declined by the operator on 2026-08-16**; recorded here so the decision is visible rather than rediscovered as a bug.
>
> **Transition risk, checked rather than assumed.** Deploying moves when reminders fire for existing bookings. It cannot duplicate one: the comms dedupe is durable and keyed on `(booking_id, message_type, communication_lane)`, so anything already `sent` stays sent. The bounded cost runs the other way, a booking whose corrected reminder moment falls between deploy and its old noon-based moment gets no reminder rather than a mistimed one. At most 2.6% of bookings, and only those inside that gap.
>
> **One on-grid behaviour changed**: an ambiguous autumn wall time now resolves to the second occurrence, because the deleted probe walked upward from the previous day and found the earlier one. Pinned by test rather than "fixed" — one repeated hour a year in the middle of the night, and `cancellation-deadline` had already shipped on that behaviour.
>
> **The file had no test at all**, which is how a 93%-wrong function survived every review including this audit's. It now has 19, three of which sweep all 1440 minutes of a BST day, a GMT day and the autumn transition day. Spot checks were never going to catch this: the probe passed every on-grid example anyone would think to write, which is exactly the set a reviewer writes.

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

> **CLOSED 2026-08-16 · `79d2d889` + `cb51f514`, staging. It took two commits, and the first one on its own was worth nothing.**
>
> `79d2d889` did what this finding asks: `isOccupyingBlock` in both loops, so `venue_amended_hours` stops counting as occupied. Staging testing then found the window **still unclickable**, because link 6 of the chain above is incomplete. `:7209`'s `disabled={occ}` only controls whether the empty-slot button is *enabled*. The block is drawn as a separate overlay at **z-index 15** over slot buttons at **z-0**, and its inner button is `disabled` for closure types, so it swallowed the click rather than passing it down. On an amended-hours day every minute of the column carries a block, so the entire day stayed dead to the mouse with the rule computing correctly underneath.
>
> `cb51f514` passes pointer events through for exactly the blocks staff may book over, reusing the same predicate so the rule and the hit-testing cannot drift apart. Bookings sit at z-index 20 and up, so they keep their own clicks.
>
> **Why every reviewer missed it, including the adversarial round.** dnd-kit resolves a drop by pointer collision against registered droppable rects, which ignores z-order entirely. So the drag path exercised the fixed rule and passed, and the click path could not reach it. The six-link chain above traces the *rule*, correctly and in detail, and simply never asks whether a click arrives.

---

### SA-H4 — Every API permission check on this subsystem is advisory
**CONFIRMED (VERIFIED) · High · Intra-venue, not cross-tenant**

Every scheduling table's RLS policy is `FOR ALL` with predicate `venue_id IN (SELECT venue_id FROM staff WHERE email = auth.jwt()->>'email')` (`supabase/migrations/20260430120000_unified_scheduling_engine.sql:341` and siblings). The predicate is **role-blind**: no scheduling policy references `staff.role`. The correct helper `caller_staff_admin_venue_ids()` exists (`20261219120000:39`) and is wired to exactly one policy. Meanwhile every API route writes through `getSupabaseAdminClient()`, so `requireAdmin` and `staffManagesCalendar` are the only gate on the route path, and absent from the direct path.

> **UPDATE 2026-08-15 — the blocking dependency is gone, and this fix is now easier than written.** **D1 is complete.** Its A2 narrowed `bookings` to column-level `SELECT` for `authenticated` and **realtime delivery survived**, verified on staging before production. So: the dependency is discharged; the "zero table-level `REVOKE`" corroboration below is **falsified** by `20270112120000`, which is now the worked precedent for exactly this operation; and the RLS pgTAP suite that runs in CI gives this change a safety net the document assumed did not exist. The finding itself is unaffected and re-verified: the policy at `20260430120000:341` is `FOR ALL` with a role-blind venue predicate, and no scheduling policy references `staff.role`.

**Proven by the repo's own test suite** (VERIFIED): `supabase/tests/linked_accounts_rls_test.sql:275-295` runs `SET LOCAL ROLE authenticated`, gets `42501` on an INSERT, then runs the **same INSERT successfully** after changing only an `account_links` data value. The rejection was RLS, not a missing grant. Corroborated by **zero table-level `REVOKE` in any of the 258 migrations** (VERIFIED).

**Effect:** a non-admin staff member can rewrite colleagues' `working_hours`, delete their leave, and create venue-wide closures via PostgREST using the shipped publishable key.

**Correctly scoped:** **intra-venue**, not cross-tenant. The venue predicate is sound; `staff` has no UPDATE or DELETE policy, so there is no self-promotion to admin; valid staff credentials are required.

**Fix (M), in order:** (1) `REVOKE INSERT, UPDATE, DELETE` on the six scheduling tables from `anon, authenticated` — **keep `SELECT`** for realtime; (2) add role predicates to policies that should be admin-only; (3) extend `scripts/check-client-executable-functions.mjs`, which polices `pg_proc` and nothing else. That table-shaped blind spot is why this survived four consecutive hardening migrations. Run the §14 query first.

> **§14 query run 2026-08-16. The grant surface is wider than written; the scoping is not.**
>
> `anon` holds the **full default grant set on all six tables, including `TRUNCATE`**, not merely the INSERT/UPDATE/DELETE this fix names. So the revoke list must be `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`, keeping `SELECT`. Writing the shorter list leaves `TRUNCATE` in `anon`'s hands.
>
> **The writes are nonetheless blocked today**, which is why this stays intra-venue and did not escalate: the `staff_manage_*` policies are `FOR ALL` with no `TO` clause, so they apply to every role, and `auth.jwt()->>'email'` is null for `anon`. The predicate fails and the write is refused. The grant is unused reach, not an open door — but it is reach nobody intended, and `TRUNCATE` in particular is not something to leave to a policy predicate.
>
> Also relevant to sizing: **`practitioners` has zero rows in production.** Any part of this work that reasons about that table is reasoning about an empty set.

> **STEP 1 CLOSED 2026-08-16 · `20270113120000`, on staging code and staging database. Steps 2 and 3 remain open.**
>
> The six verbs are revoked from both client roles on all six tables, `SELECT` kept. Verified live: an anonymous INSERT now returns `42501 permission denied for table`, which is the **grant** refusing. That distinction is the whole proof — before this migration the identical request reached RLS and was refused one layer later by the predicate, so the error moved up a layer, which is exactly what the fix was for.
>
> **`SELECT` is kept deliberately and this is the load-bearing decision.** `PractitionerCalendarView` opens `postgres_changes` channels on `calendar_blocks` and `practitioner_calendar_blocks`. Removing `SELECT` does not error: the channel subscribes successfully and never fires again, silently, which is the failure D1 documented. Gated on staging before production, per D1's own lesson: the diary was confirmed still updating live from a second session on 2026-08-16.
>
> **Steps 2 and 3 are untouched and are what remains of this finding.** The policies are still role-blind — no scheduling policy references `staff.role`, and `caller_staff_admin_venue_ids()` is still wired to exactly one policy — so a non-admin staff member retains, *through the application's own routes*, the reach this finding describes. Revoking the grants closed the direct PostgREST path only. And `scripts/check-client-executable-functions.mjs` still polices `pg_proc` and nothing else, so nothing stops the next table arriving with the same default grants: **this migration fixed six tables, not the mechanism that produced them.**

---

### SA-H5 — Staff cannot book outside hours or over a break, contradicting the code and the shipped help article
**CONFIRMED · High**

The comment at `src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx:5312-5314` states staff *may* book outside hours with a warning rather than a refusal. `src/lib/help/articles/getting-started.ts` promises owners the same: dragging outside opening hours "is allowed. You will see a note that it moved outside opening hours, not a refusal."

Both are dead. `outsideHours` is computed against `dayStartMin`/`dayEndMin`, which are the drawn canvas bounds rather than opening hours, making it near-unreachable; and `appointmentWindowCollides` counts `practitioner_closed`, `venue_closed` and `break` as hard conflicts, producing a refusal first.

**Failure:** a client asks for 17:15 when the salon closes at 17:00 and the owner is happy to stay. The diary refuses. This is the most common real-world reason a receptionist overrides a schedule, and the product documents a behaviour it does not have.

**`SA-H3`, `SA-H5` and the closure-day lockout in `SA-M1` share one root cause:** `slotOccupied` and `appointmentWindowCollides` do not distinguish block types. Introducing `isOccupyingBlock(blockType)` and using it in both resolves all three. ~~**Highest value-per-line fix in the audit.**~~

> **CLOSED 2026-08-16 · `79d2d889` + `c65fd0ef`, staging. The claim struck through above was wrong, and this is the clearest example in the document of the sizing failure described in the implementation status.**
>
> The outside-hours half worked as written: the canvas-bounds test was replaced with the closure blocks themselves as the source, and a drag past closing now saves with an amber note. **The break half did not.** The engine keeps two gates, not one — `allowOutsideHours` has never relaxed a break, and `allowDuringBreaks` is a separate option (`appointment-engine.ts:1031`) that **only the walk-in create path had ever sent**. So the diary permitted the drag, showed the note, and the PATCH answered `409 Conflicts with a break`. The rule changed in the client and the layer that enforces it never heard.
>
> `c65fd0ef` threads that override through `validateAppointmentModificationInterval`, the PATCH route and the diary's move, resize and visit paths, as its own permission rather than folded into the hours one: choosing to work past your own closing time and choosing to work through someone's break are different decisions, and the engine is right to ask separately.
>
> **A second hole surfaced beside it.** The dry run a multi-service visit runs before any row is written accepted only `allow_manual_overlap`, so a **visit** dragged past closing was refused with "The visit was not moved" while the identical drag on a single booking went through. That is this finding failing for visits independently of breaks, and it would have gone unnoticed had the break fix not passed through the same route.
>
> Copy note: crossing a break now says "Moved over a break" rather than claiming opening hours, which was untrue and most confusing in exactly the case staff would be looking at.

---

### SA-H6 — Cancelling bookings to close a day then offers those slots to the waitlist
**CONFIRMED (VERIFIED) · High · New**

`src/lib/booking/offer-appointment-waitlist-on-cancel.ts` imports `isWaitlistFreedSlotStillUnbooked` but **not** `findAppointmentWaitlistAvailability` (VERIFIED by import grep). It checks "has someone else taken this slot" and never "is the venue open". Five sibling waitlist paths do use the availability helper.

**Failure:** an owner books a closure and cancels the day's appointments. Each cancellation fires the waitlist offer; waitlisted guests are texted offers for the closed day.

**Two gates, found on re-verification and recorded here rather than glossed:** the function returns early at `:270` unless the `waitlist_v2` feature flag is enabled, and that flag **defaults to false**; and in `staff_choose` mode it raises a staff alert without notifying any guest. The default mode is `notify_in_order`, which does notify. So exposure equals the set of venues with `waitlist_v2` explicitly on. **This is why it is High and not Critical** — an earlier draft of this document had it as Critical, before the gates were checked.

> **Exposure quantified 2026-08-16 by production query:** `waitlist_v2` is on for **one test venue**. No live venue was ever exposed.

> **CLOSED 2026-08-16 · `29a30a73`, staging.** `findAppointmentWaitlistAvailability` now runs on this path like its five siblings, with three placement decisions worth keeping:
>
> - **After** the cancellation is written, which every caller does before reaching this function. Run before that write, the cancelled booking would occupy its own slot and the check would suppress *every* offer.
> - **After** the match search, so the engine runs only when there is somebody to offer the slot to.
> - **Before** the mode dispatch, so it covers `staff_choose` as well: an alert about a slot nobody can book is noise, not an opportunity.
>
> `desired_time` is passed as the freed start exactly, which the window parser treats as an exact match, so this asks about *this slot* rather than the whole day. Verified on staging in both directions — suppressed on a closure day, and still offered on an ordinary open day, which was the real risk.

---

### SA-H7 — Booking-window rules unenforced on the multi-service and group routes
**CONFIRMED (VERIFIED) · High**

`allowSameDayBooking` is assigned at `src/lib/availability/appointment-engine.ts:122` and **never read anywhere else** (VERIFIED: only the declaration at `:91`, the assignment, and one test locking the dead behaviour in). Real enforcement lives in `isGuestBookingDateAllowed`, which `src/app/api/booking/create-multi-service/route.ts` and `create-group/route.ts` never call. Both are anonymous and are the real public flow. Reachability comes from `SA-M8`: the day API lists slots for out-of-window dates.

`min_booking_notice_hours` **is** enforced (`appointment-engine.ts:645`), so the worst case is a same-day or far-future booking the venue did not want, not a slot conflict.

> **Overlap, 2026-08-15:** this restates the forensic audit's **H1 residual** almost exactly. That audit downgraded H1 to Medium (the engine ignoring `allowSameDayBooking` is deliberate and test-pinned at `appointment-engine.test.ts:146`) and named the same real residual: `create-group` and `create-multi-service` never call `isGuestBookingDateAllowed`. One defect, two IDs — schedule it once.

> **CLOSED 2026-08-16 · `68e3b6e4`, staging. This closes the forensic audit's H1 residual too.** `isGuestBookingDateAllowed` is now called on both routes, using the timezone `attachVenueClockToAppointmentInput` just resolved so the check asks about the same calendar day the engine works in. Checked **per segment** on a visit and **per member** on a group, because the window belongs to the service: a visit can mix services with different windows, and a group is not necessarily same-day. One segment or member out of window refuses the whole request, which is the only coherent answer when they share a date.
>
> Verified on staging in both directions, which mattered more than the refusal: out-of-window dates are refused on both routes, and ordinary in-window bookings still succeed, including on the two edges where a timezone slip would show up — today, and the last day of the advance window.

---

# §5 Medium findings

| ID | Finding | Evidence |
|---|---|---|
| **SA-M1** | **Part-day closures are widened to whole-day for appointments** on every layer including create. The UI **discloses** it with an amber banner naming the behaviour and pointing at Amended Hours, which is why this is Medium; **the API does not**, and accepts the times happily. | `src/lib/availability/venue-exceptions-adapter.ts:17-24` (VERIFIED); `src/app/api/venue/availability-blocks/route.ts:91`; `src/app/dashboard/settings/sections/BusinessClosuresSection.tsx:524-535` |
| **SA-M2** | **PARTIALLY CLOSED 2026-08-16 (`79d2d889` + `cb51f514`).** ~~Via `SA-H3`/`SA-H5` the orphaned bookings are then unclickable on the diary.~~ **The diary lockout is fixed:** a closure day's existing bookings are clickable again, and staff can now *create* on a closed day too, which needed the hit-testing fix as well as the rule (see `SA-H3`). **The rest is open and is the larger half.** Closing a day still has no consequence chain: no customer notification, no bulk cancel, no refund path, and **reminders keep firing** (`src/lib/cron/unified-scheduling-comms.ts:72-81` reads no closure table). Closure-aware reminder suppression was **deliberately carved out of round 1** — it is outbound comms and it fails silently, so it wants its own round. Downgraded from Critical on re-verification: there is **no automated no-show marking anywhere**, so that consequence was speculative. | `src/lib/calendar/closure-booking-conflicts.ts:277` |
| **SA-M3** | **CLOSED 2026-08-16 (`b529bf0d`).** ~~**`allowOutsideHours` disables the full-day staff-leave gate.**~~ Full-day leave is now checked **ahead of** the `allowOutsideHours` block, via a new `fullDayLeavePractitionerIds` on the engine input, so it survives every staff override. The `days_off` fold is **kept alongside** rather than replaced: the fold is what hides the day from guests, and the new list is what survives an override. Original finding, for the record: the skipped block at `appointment-engine.ts:965-990` also contained the leave gate, because full-day leave is folded into `days_off` at `:249-276`, making the comments at `:847-853` and `venue/bookings/route.ts:1134-1136` false. Partial leave never had the problem — it arrives as a blocked range of kind `leave` and was always checked unconditionally. Verified on staging: a walk-in onto full-day leave is refused, and a walk-in outside opening hours on an ordinary day still succeeds. | |
| **SA-M4** | **Deleting a calendar has no booking check**; `bookings.calendar_id` is `ON DELETE SET NULL`. Mitigated: the confirm dialog discloses it and the bookings list still shows the appointments, since `bookings.practitioner_id` is untouched. What is lost is diary rendering. | `src/app/api/venue/practitioners/route.ts:911-921`; `20260430120000:212` |
| **SA-M5** | **Deactivating a calendar (`is_active = false`) has no guard** — the orphan check is gated on `working_hours` changing. Future bookings vanish from the diary while the reminder cron keeps texting. Admin-only and instantly reversible. | `src/app/api/venue/practitioners/route.ts:577-583`; `PractitionerCalendarView.tsx:3576-3585` |
| **SA-M6** | **`blockPatchSchema` is missing the refine that `blockSchema` has** (VERIFIED). Clearing one Period-1 box on an existing amended-hours entry saves `override_periods: null`, closing the whole day for classes/events/resources. Neither schema validates `date_end >= date_start` or `time_end > time_start`, so reversed ranges store as **inert** closures the owner believes are in force. | `src/app/api/venue/availability-blocks/route.ts:98-116` |
| **SA-M7** | **A break can be saved over an existing appointment silently.** The orphan guard is gated on `working_hours` only; the identical action via "Block time" or leave returns a hard 409. | `src/app/api/venue/practitioners/route.ts:577-583` |
| **SA-M8** | **Day API lists slots outside the booking window** while the month API applies it. Dead-end UX alone; the reachability enabler for `SA-H7`. | `src/app/api/booking/availability/route.ts:521-742` |
| **SA-M9** | **CLOSED 2026-08-16 (`501a02df`), by the cheaper half of the fix.** The header is now `no-store`: correct and uncached beats fast and wrong, and a closure an owner has just saved greys out immediately instead of selling green dates for up to 165 s at every edge PoP. **The `availability_epoch` half is deliberately not done** — it needs a column plus a trigger across six tables (§11.5), and the cache comes back when there is something to key it on. Original finding: `s-maxage=45, stale-while-revalidate=120` with zero `revalidateTag`/`revalidatePath` in `src/` (VERIFIED), so nothing could ever flush it. | `src/app/api/booking/appointment-calendar/route.ts:197` |
| **SA-M10** | **Month path double-applies `custom_duration_minutes`**, discarding injected variant and add-on minutes — the hazard the day path documents and avoids. Green dates that offer no slots. | `src/lib/availability/appointment-month-availability.ts:687,696`; contrast `src/lib/availability/appointment-engine.ts:1519-1533` |
| **SA-M11** | **`opening-hours` orphan check reads only the dead column.** It builds `skipDate` from the empty `venue_opening_exceptions`, so a date governed by an `amended_hours` block is never skipped and the warning **falsely alarms** the admin. | `src/app/api/venue/opening-hours/route.ts:45-64` |
| **SA-M12** | **`special_event` closures are dropped** by `src/lib/unified-availability.ts:231`, inside `getUnifiedAvailableSlots`. **Correction to the first draft, which called this consumerless:** it is consumed by `src/app/api/booking/unified-availability/route.ts`, a **public anonymous GET** documented as "guest booking page slot list". No first-party client calls it, but it is reachable by anyone. Fix the `.in()` list or delete the route. | |
| **SA-M13** | **CLOSED 2026-08-16 (`501a02df`), by deletion rather than repair.** ~~**Legacy block branch skips the managed-calendar check.**~~ The branch is **unreachable**, not merely legacy: every venue is on unified scheduling and **production holds zero `practitioners` rows** (confirmed by query), so it could only ever fall through. Deleting it makes the `staffManagesCalendar` check unconditional, which is what the route always intended. The note that this is "cosmetic until `SA-H4`" still holds for the direct PostgREST path and is discharged by round 2. | `src/app/api/venue/practitioner-calendar-blocks/route.ts:175-209` |
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
| **SA-M28** | **CLOSED 2026-08-16 (`58ca0359`).** `practitioner_leave` is now its own emitted type, rendering violet and labelled "On leave", distinct from grey off-hours; a fifth type `linked_venue_closed` was added at the same time so a partner column keeps blocking (working past *your own* closing time is a decision about your own business, which is what `SA-H5` is about; placing an appointment inside another venue's closed hours is not). Partial leave is now **clipped to the hours actually worked** rather than merged with the closed ranges: the minutes greyed are identical, but they are two non-overlapping sets carrying which is which. This was Phase 0's first item and it did unblock `isOccupyingBlock` as predicted — that helper needs a type that carries the leave/off-hours distinction, and now has one. Verified on staging. Original finding follows. ~~**The diary cannot distinguish staff leave from ordinary off-hours, and merges them into one block**~~ (VERIFIED 2026-08-15). `schedule-closure-blocks.ts` emits only three types: `venue_closed`, `venue_amended_hours`, `practitioner_closed`. At `:328-334` partial leave is concatenated into the **same array** as the off-working-hours ranges, passed through `mergeAdjacentRanges`, and emitted as `practitioner_closed` with `reason: null`. So a 16:00-17:00 leave abutting a 17:00 close **fuses into one grey block**, and "Sarah is on annual leave" renders identically to "Sarah does not work Wednesday afternoons". Full-day leave is worse: per `SA-M3` it is folded into `days_off` upstream, so it never reaches the diary as leave at all. Breaks are the exception and **do** render distinctly (amber, via `isBreakCalendarBlock` at `PractitionerCalendarView.tsx:487`), which is what makes the leave case look like an oversight rather than a design. Workaround: the separate leave page. **Blocks Phase 0's first item — see below.** | `src/lib/calendar/schedule-closure-blocks.ts:26,111,328-334`; `PractitionerCalendarView.tsx:486-508` |

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

## 7.4 Errors found by implementing it, 2026-08-16

Round three red-teamed the document. Building from it found five more, and the pattern differs from §7.3's: **round three checked whether claims were true, and they were. These are failures of completeness and of sizing, which re-reading cannot catch.**

1. **The fail-open count was thirteen; it is 49.** The audit grepped for the `console.warn` that made a site visible, in a finding *about* invisibility, so its instrument could only find the harmless half. The 36 silent sites were the dangerous ones. See `SA-C3`.
2. **`SA-H3` and `SA-H5` were sized as one helper in two loops.** Both needed a second layer the document never mentions: DOM hit-testing for `SA-H3`, a separate server-side `allowDuringBreaks` gate threaded through four call sites for `SA-H5`. The struck-through "highest value-per-line fix in the audit" was the most confident claim in the document and the most wrong.
3. **`SA-C4`'s Critical rating rested on data that does not exist.** `availability_blocks.reason` is empty platform-wide. §7.3 item 5 raised the severity specifically for personal-data exposure; that limb is gone and the finding returns to High.
4. **`SA-H4` understated the grant surface.** `anon` holds the full default set including `TRUNCATE`, not the three verbs the fix names. The scoping conclusion is unaffected, because RLS blocks the writes, but the revoke statement written from this document would have been incomplete.
5. **A sixth type was needed that no finding asked for.** `linked_venue_closed`: `SA-H5` argues staff may work past closing, and applying that uniformly would have let one venue book inside a *partner's* closed hours. The audit treats the diary as single-tenant throughout; linked columns are a case it never considers.

**What generalises.** Findings in this document are trustworthy about *where* a rule is wrong and unreliable about *how many layers enforce it*. Before scheduling anything remaining, enumerate the enforcing layers — the rule, the hit-testing, the server gate, the dry run — and verify the *safety* claim rather than the defect claim, since the defect claims have held up almost without exception and the safety claims are where the surprises are.

**Round 2 added a sixth, and it is the same lesson pointed at the schema.** The migration was correct first time and applied cleanly; its pgTAP suite failed CI **twice**, both times dying in setup before a single assertion ran, both times because a fixture was written from a table's `CREATE TABLE` without checking what later migrations did to it. `venue_services.area_id` became `NOT NULL` some 300 migrations after the table was created. `practitioner_leave_periods.practitioner_id` was re-pointed from `practitioners` to `unified_calendars` by `20260918140000`, while its sibling `practitioner_calendar_blocks.practitioner_id` was not — two identically named columns on adjacent tables resolving to different tables in the same UUID space, survivable only because `practitioners` holds zero rows.

The sibling suite carries the identical scar in a comment: its fixture referenced `guests.name` after a later migration dropped it, and the whole file errored during setup, which is why nobody noticed it had never run. **Three occurrences of one mistake now.** `CREATE TABLE` is a historical record, not a description of the table. Read the `ALTER`s, and prefer a failure that is loud: a fixture that dies in setup reports `Tests: 0`, which is a *pass-shaped* failure if you read only the job status.

---

# §8 GDPR assessment for SA-C4

The sibling audit ran a retrospective exploitation-log check for C0. The same discipline applies here.

**What is exposed.** `availability_blocks` with `USING (true)` and no venue predicate, including `reason`, a free-text field an owner types when closing the venue. Plausible contents name a health condition or a bereavement of an identifiable staff member. `unified_calendars` additionally exposes staff names alongside their working patterns and days off, platform-wide.

**Assessment required, in this order:**
1. ~~**Sample the data.**~~ **DONE 2026-08-16. `availability_blocks.reason` is empty platform-wide.** No operational text, no health or bereavement text, nothing. Step 1 was the gate on everything below it and it closes the assessment.
2. ~~**Check for exploitation.**~~ **Not required.** There is no personal data in the exposed column to have been exploited. `unified_calendars` exposes staff *names* alongside working patterns, which is ordinary business-contact data of the kind any salon publishes, not special-category data.
3. ~~**Art. 33 / Art. 34.**~~ **Not engaged.** Neither is triggered: there is no breach and, on the evidence of step 1, no personal-data exposure to constitute one. **This decision, its reasoning and its date are recorded here, which is what step 3 asked for either way.**
4. **Minimise regardless — the one live item.** `reason` should become a controlled taxonomy with an optional private note that is never in an anonymously readable projection. Empty today is not a control; it is luck, and the first owner to type "Sarah's surgery" into that box re-opens everything struck through above. This also serves `SA-M25`'s audit needs. Sits in Phase 6 with the closure reason taxonomy.

> **Net effect on `SA-C4`:** the finding survives at **High** as a venue-enumeration oracle, and its fix is unchanged and still worth doing in round 2. What is gone is the GDPR limb, the Critical rating and the notification clock.
>
> **Round 2 shipped that fix on 2026-08-16 (`20270113120000`), so the exposure described in "What is exposed" above is closed for these nine tables.** Step 4, minimisation, is the only live item left and is now the *whole* of this section's remaining work: `reason` being empty is luck rather than a control, and the field is still writable, so the first owner to type "Sarah's surgery" into it re-opens everything struck through above — on the booking-catalogue tables that are still anonymously readable, if not on this one. Sits in Phase 6 with the closure reason taxonomy.

~~**Note for the fix:** dropping the anon policies is safe for request paths (everything public uses service-role) but interacts with **D1** in the sibling audit, which is unresolved. Sequence them together.~~ **D1 is complete** (see the adversarial review above), so this dependency is discharged. Dropping the anon policies remains safe for request paths: everything public uses the service-role client.

---

# §9 Observability: none of this would be visible in production

**CONFIRMED at the time of writing.** Sentry is installed with **two** capture sites repo-wide. **3 of 22** crons alert. All thirteen fail-open paths report via `console.warn`. There is no slots-offered metric, no consistency cron, and no structured logging in the availability path.

**Every finding in this document would be invisible today.** A venue would discover `SA-C3` when a customer arrives to a locked door.

> **UPDATED 2026-08-16 · `03b0053c`.** Two corrections and one real change.
>
> The count was wrong: there are **49** fail-open paths, not thirteen (see `SA-C3`). And of those 49, only thirteen reported via `console.warn` — the other **36 reported nothing at all**, which is worse than this section describes and is the reason the count was wrong in the first place.
>
> **All 49 now capture to Sentry**, fingerprinted by call site and tagged with the assumption the engine has just made. The locked-door scenario above is no longer silent. The rest of this section stands: **3 of 22** crons alert, and there is still no slots-offered metric, no consistency cron and no structured logging in the availability path. Those belong with §11.2 in Phase 1, because an alert that a read failed is not the same as a booking page that can say so.

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

**Status 2026-08-16: round 1 is merged to `staging` and hand-tested. Round 2, the migration, has not started.** The two rows still open in round 1 were carved out deliberately, not missed.

| Item | Closes | Size | Status |
|---|---|---|---|
| **Widen the diary block type first** so leave, off-hours and breaks are distinguishable (`schedule-closure-blocks.ts:26`) | `SA-M28`, and **unblocks the row below** | **S** | ✅ `58ca0359` |
| `isOccupyingBlock(blockType)` in `slotOccupied` and `appointmentWindowCollides` | `SA-H3`, `SA-H5`, the `SA-M2` lockout | ~~S~~ **S ×3** | ✅ `79d2d889` + `cb51f514` + `c65fd0ef`. **Sized wrong.** The helper was one commit; making it reachable took two more — see `SA-H3` and `SA-H5` |
| Apply variant + add-on duration before the reschedule availability check | `SA-C2` | **S** | ✅ `f56b3209` (+ `143a6c1a`) |
| Availability check in the cancel-driven waitlist offer | `SA-H6` | **S** | ✅ `29a30a73` |
| Suppress reminders for bookings inside a closure (`src/lib/cron/unified-scheduling-comms.ts:72-81`) | part of `SA-M2` | **S** | ⬜ **Carved out.** Outbound comms, fails silently: its own round |
| `Sentry.captureException` at all ~~thirteen~~ **49** fail-open sites | makes `SA-C3` visible | ~~S~~ **M** | ✅ `03b0053c`. Visible, **not** fail-closed |
| ~~Re-validate immediately before insert~~ **DONE, on production** (sibling audit's C3 interim, five write paths) | interim `SA-C1` | ~~S~~ | ✅ prior work |
| **Extend that re-check to `src/app/api/confirm/route.ts`** — the one appointment-writing path it does not cover | `SA-C1` on the reschedule path | **S** | ✅ `f56b3209` |
| Booking-window guards on multi-service and group routes | `SA-H7` | **S** | ✅ `68e3b6e4` |
| Move the full-day leave gate out of the `allowOutsideHours` block | `SA-M3` | **S** | ✅ `b529bf0d` |
| ~~Two-pass offset in `venueLocalDateTimeToUtcMs`~~ **Delete it; every caller to the correct function already in the file** + DST fixtures | `SA-H1` | ~~M~~ **S** | ✅ `a47fecf9`, staging, hand-tested. Sized M on the assumption the algorithm had to be written; it already existed |
| Drop `s-maxage`; ~~add `availability_epoch`~~ | `SA-M9` | **S** | ✅ `501a02df` (header only; the epoch is Phase 1 work, §11.5) |
| Delete the unreachable legacy block branch | `SA-M13` | **S** | ✅ `501a02df` |
| Drop the nine anon policies; `REVOKE INSERT, UPDATE, DELETE, **TRUNCATE, REFERENCES, TRIGGER**` from `anon, authenticated` | `SA-C4`, `SA-H4` step 1 | **M** | ✅ `20270113120000`, staging code + database. Verb list corrected by the §14 query |
| Role predicates on admin-only policies; extend `check-client-executable-functions.mjs` past `pg_proc` | `SA-H4` steps 2-3 | **M** | ⬜ **Open.** The revoke closed the direct path; the policies are still role-blind and nothing stops the next table shipping with the same default grants |
| GDPR assessment per §8 | `SA-C4` | **S** | ✅ Assessment complete; `reason` empty platform-wide, Art. 33/34 not engaged, minimisation deferred to Phase 6 |

**Ordering within Phase 0 (added 2026-08-15).** `isOccupyingBlock(blockType)` has to switch on a type that carries the distinction it needs, and today's does not: leave, off-hours and working-hour boundaries all arrive as `practitioner_closed` (`SA-M28`). Widen the emitted type **before** writing that helper, or the helper cannot tell a break it should permit from leave it should refuse, and the work stalls halfway. It is a small change in one file and it makes the highest-value fix in the audit actually implementable.

> **Confirmed correct in practice, 2026-08-16.** This ordering call held: the widening landed first and the helper was written against a type that could answer. It also proved incomplete in one direction the note does not anticipate — a **sixth** type, `linked_venue_closed`, was needed so that "staff may work past closing" does not become "one venue may book inside a partner's closed hours". See §7.4 item 5.

**Dependencies (UPDATED 2026-08-15).** ~~The revoke item depends on D1 being resolved.~~ **D1 is complete**, so that dependency is discharged: A2 narrowed `bookings` to column-level `SELECT` and realtime survived, `20270112120000` is the worked precedent, and the RLS pgTAP suite now runs in CI as a safety net. Run §14 first regardless. Everything else in Phase 0 is independent and can proceed in parallel.

**Exit (UPDATED).** All merged; a concurrency test proves one winner; a fail-closed test proves 503 not empty. ~~`npm run test:db` runs in CI~~ — **already true**: the `rls-pgtap` job runs on every push and PR against a local Supabase built from the migrations, ~~passing 24/24~~ **now 42/42**. Note the gotcha it carries: `supabase/scripts/local_baseline_grants.sql` applies hosted-equivalent table grants to that local instance, and **any table this phase narrows must be excluded from it**, exactly as `bookings` is, or CI will silently hand the privileges back and validate a permission environment that exists nowhere.

> **The gotcha was real and the exclusion was made, 2026-08-16.** Seven tables are now skipped by that script rather than one. Recorded because the trap is invisible from the test's side: the suite would have passed while asserting against a database that differed from every real environment in exactly the way the migration was written to change.
>
> **Two Phase 0 exit criteria are still unmet and neither is close.** No concurrency test proves one winner (that is `SA-C1`, whose durable guard the operator deferred), and no fail-closed test proves 503 rather than empty, because `SA-C3` was made *visible* and not fail-closed — that needs the third `unavailable` state and a booking UI that can render it, which is §11.2 in Phase 1. **Phase 0 is not complete.** What is complete is every code and grant item in it.

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

> **RESULT 2026-08-16.** Broader than expected: **`anon` holds the full default grant set on all six tables, including `TRUNCATE`**, alongside `authenticated`. So the revoke must read `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`, keeping `SELECT`. The writes are blocked in practice today because `staff_manage_*` is `FOR ALL` with no `TO` clause and `auth.jwt()->>'email'` is null for `anon`, so the grant is unused reach rather than an open door — but write the full verb list.
>
> **This query is now the post-migration verification, not the pre-flight.** After `20270113120000` it must return `SELECT` and nothing else, for both roles, on all six. Anything more means the REVOKE ran as a role that did not hold the grant, which fails silently and is the one way this migration can appear to work and not have.

```sql
-- 2. SA-C4 / §8: is any closure reason personal or health-related?
select id, venue_id, date_start, reason
from availability_blocks
where reason is not null and btrim(reason) <> ''
order by created_at desc
limit 200;
```
> **RESULT 2026-08-16: zero rows. `reason` is empty platform-wide.** This is the query that closes §8 and downgrades `SA-C4` to High.

```sql
-- 3. SA-H1: how many bookings are already off the interval grid?
select count(*) filter (where extract(minute from booking_time)::int % 15 <> 0) as off_grid,
       count(*) as total
from bookings
where booking_date >= current_date - 90;
```
> **RESULT 2026-08-16: 59 off-grid of 2288.** Small enough to be tractable, large enough that the fix moves reminder times for existing bookings — which is why `SA-H1` was carved out of round 1 into its own round.

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
> **RESULT 2026-08-16: zero.** Which is why `SA-M13`'s branch was deleted rather than repaired, and why anything in this document reasoning about `practitioners` is reasoning about an empty set.

```sql
-- 6. SA-C4 blast radius: how many venues have waitlist_v2 on (sizes SA-H6 too)?
select count(*) from venues where feature_flags ->> 'waitlist_v2' = 'true';
```
> **RESULT 2026-08-16: one, a test venue.** No live venue was ever exposed to `SA-H6`.

---

# §15 Open questions

1. **Does the mobile app consume `/api/venue/calendar-grid`?** Only a code comment says so; `Docs/MOBILE_API.md` does not list it. Decides whether `SA-M19` is Medium or Low. Settle in the mobile repo. **Still open.**
2. ~~**Do any venues still have `practitioners` rows?**~~ **ANSWERED 2026-08-16: zero.** `SA-M13` closed by deletion.
3. ~~**How many bookings are already off-grid?**~~ **ANSWERED 2026-08-16: 59 of 2288 over 90 days.** `SA-H1` carved into its own round on this basis.
4. **Is `venue_opening_exceptions` `[]` on production as well as staging?** Confirm before deleting the column (`SA-L1`). **Still open.**
5. **Which venues have amended-hours blocks that widen rather than narrow?** These venues are living `SA-H2` and `SA-H3` together and are the right pilot group for Phase 1. **Still open, and now more useful:** `SA-H3` is fixed, so these venues are the ones who would notice if it regressed.
6. ~~**Is D1 in the sibling audit resolved?**~~ **ANSWERED: yes, complete.** The `SA-H4` revoke is unblocked.

**Added 2026-08-16, from implementing round 1:**

7. **How many other single-layer fixes in this document are actually two-layer?** `SA-H3` and `SA-H5` both were. The remaining diary-facing findings (`SA-M2`'s comms chain, `SA-M7`, `SA-M21`) have not been re-examined with that question in mind. §7.4.
8. **Does anything outside the diary rely on the four block types staff may now book over?** The `isOccupyingBlock` set is consumed in one component today. Phase 1's resolver should own that rule rather than the view.

**Added 2026-08-16, from round 2:**

9. **Which of the ~20 remaining `TO anon` policies are actually load-bearing?** The nine dropped here were provably not, because no browser-client or anon-key server path read them. The booking-catalogue tables (`appointment_services`, `calendar_service_assignments`, `service_variants`, `addons`, the class tables, the collectives) have not had that check and **may genuinely be read anonymously by a public page**, unlike these. Do not assume this round's answer transfers; it is the same "verify the safety claim" trap in a new place.
10. **What stops the next table arriving with the same default grants?** Nothing today. `check-client-executable-functions.mjs` polices `pg_proc` only, which is why this survived four hardening migrations. `SA-H4` step 3 is the durable fix and is unscheduled.

---

## Appendix: method and confidence

Nine agents ran across three rounds. Round one investigated five layers in isolation. Round two attacked round one, adjudicated the RLS question, hunted cross-cutting flows, and designed the target state. Round three adjudicated the cross-cutting findings and red-teamed this document.

**Round two rejected 8 findings and downgraded 14, including three filed as Critical. Round three downgraded 9 of 10 remaining findings and corrected 6 errors in this document.** Five inter-agent contradictions were resolved from the code; all are recorded in §7.

Confidence is highest on §3 and §4, where every claim was read at its line by at least two agents and the highest-stakes were re-read by the author. Confidence is lowest where a finding depends on an unverified consumer (`SA-M19`) or on production data this audit could not see (`SA-C4`'s blast radius, `SA-H1`'s remediation size); those are listed in §15 with the query that settles them.

The recurring lesson, worth more than any single finding: **this codebase gets rules right in one place and does not carry them to their siblings.** The good resolver exists and one engine ignores it. The fail-closed pattern exists in one route and **49** sites fail open. The admin-scoping helper exists and is wired to one policy. `isGuestBookingDateAllowed` exists and two create routes skip it. The fix that generalises is not any individual patch: it is §11.1, one resolver that no caller can bypass.

> **Confirmed a fourth time by `SA-H1`, 2026-08-16.** "The good resolver exists and one engine ignores it" is the lesson, and `SA-H1` is its purest instance: the correct wall-clock function was in the same file as the broken one, with a docstring naming the exact misuse, and seven call sites used the broken one anyway. The audit sized the fix as writing an algorithm. The algorithm was already there. **When this document says a fix must be written, check first whether it has been.**

> **Sharpened by implementation, 2026-08-16.** The lesson is right and it applies to this document as well as to the code. Every finding in §3 and §4 held; **the confidence statement above is calibrated for claims and not for sizes**, and it was the sizes that failed. `SA-H3` and `SA-H5` were each described as one change in one layer and each needed two, because the audit read the layer where the rule lives and not the layer that enforces it. A fix written from this document's own root-cause analysis shipped, passed CI, and changed nothing a user could do — twice.
>
> The practical rule for whoever picks this up: **trust the defect, re-derive the size.** Before scheduling any remaining finding, enumerate its enforcing layers and confirm the *safety* claims, which is where every surprise so far has come from. §7.4 records the five that were found this way.
