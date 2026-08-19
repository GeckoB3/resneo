# ResNeo scheduling resolver — gold-standard implementation plan

**Date:** 2026-08-17
**Status:** **v3.4** (2026-08-19). **All twelve decisions (A) to (L) are taken.** **Q0 was run against production on 2026-08-17 and reframes the whole plan: see §6.** The only live composition is venue weekly hours × calendar working hours × breaks × leave, on appointments, at 14 venues. Amended hours have **never** been used, and there are zero resources, zero future classes and zero future events. Q3, Q4, Q5 and Q6 all return zero because the populations are empty, not because the rows are clean. **Every decision (A) to (H) is therefore a zero-risk change against current data**, and the plan's purpose is to make the model correct before venues arrive rather than to stop live bleeding. Re-run Q3 and Q5 before the stages that depend on them: both results expire.

| Stage | Blocked on |
|---|---|
| 0a (exports, Supabase fake) | **DONE 2026-08-17.** tsc clean, lint clean, 345 files / 3274 tests green. |
| 0b (parity harness) | **DONE 2026-08-17.** 46 tests at the time, **107 across 9 files** after Stage 5 and the off-grid fixtures. Its coverage gap was missed before Stage 4 and **cleared 2026-08-18** as the first part of Stage 5. |
| 1 (all eight items) | **DONE 2026-08-17.** Q9 was run first and returned zero rows, so item 2 shipped as a no-op. Items 2, 3 and 8 are what hold Q9's, Q3's and Q5's production zeros true. |
| 2 (event read/write contract) | **DONE 2026-08-17.** 353 files / 3368 tests green. |
| 3 (venue resolver) | **DONE 2026-08-17.** 353 files / 3368 tests green. |
| 4 (diary geometry) | **DONE 2026-08-17.** 354 files / 3377 tests green; diary and month verified in the app. |
| 5 (calendar resolver) | **DONE 2026-08-18.** 361 files / 3470 tests green. Harness debt cleared first (3 files, 32 fixtures, 2 defects found). |
| 6a (expand) | ✅ **COMPLETE 2026-08-19**, except the resource half of (L), deferred with its prerequisite recorded (`[R3-89]`). Migration applied to staging and production and verified; dual-write, item 24, decisions (K) and (L), validation parity and apply-to-all breaks all on `staging` awaiting merge. |
| 6b (contract) | §1.3 tier 2 and tier 3 prerequisites, **Q5**, **Q6**, **Q7**, **Q10**, and 6a live and soaked. |
| 7 (fail closed) | ✅ **COMPLETE 2026-08-19 (decision J).** All five guest availability routes on one shared `withScheduleFailClosed`, plus both UI states. The three carrying real traffic are in production; the two latent ones await the next merge. Guest paths only: staff write validators still fail open, deliberately. |

**Harness debt: CLEARED 2026-08-18 `[R3-73]`.** Stage 0b named four consumers it did not assert and said three were due before Stage 4; they were not done, and Stages 3 and 4 both changed code they run. Cleared as the first part of Stage 5:

| Consumer | Status |
|---|---|
| `booking/create` route branches | Declared non-goal in Stage 0b. Unchanged; hand-reviewed in Stages 2 and 5. |
| Appointment **month path** | ✅ 9 fixtures (`parity-month-path.test.ts`). |
| Diary **closure renderer** | ✅ 13 fixtures (`parity-closure-renderer.test.ts`). **Found two live defects** — see below. |
| `getUnifiedAvailableSlots` | ✅ 10 fixtures (`parity-unified-availability.test.ts`). |

**Clearing it paid for itself immediately `[R3-74]`.** The renderer fixtures found that **Stage 4 was incomplete**: `gridMinuteBounds` called `getCalendarGridBounds` without the venue blocks, so the renderer clipped its stripes to the WEEKLY bounds while Stage 4 had already moved the visible grid to the resolved ones. A day amended past the weekly close showed the extra hours in the grid with no stripe over them — the plan's own Stage 4 breakage 1, fixed on the grid and missed on the renderer. Verified on the staging venue afterwards: a Tuesday (weekly close 18:00) amended to 21:00 now renders a full-width amended stripe to 21:00. They also found an amended stripe being drawn across a day that resolves **closed**, which told the owner two contradictory things at once.

**Two traps for anyone adding fixtures to these paths.** The month path filters every date through the service booking window, whose default caps advance booking at **90 days**. `getUnifiedAvailableSlots` applies `isGuestBookingDateAllowed` before resolving anything, and `entityBookingWindowFromRow` hard-caps `max_advance_booking_days` at **365** — a real product rule. A fixed far-future date is rejected before the resolver is ever consulted, and the whole file then returns empty lists that look exactly like a resolver defect. The unified fixture computes its date relative to today for that reason.

**Stages 0a to 6a are in production, and so is Stage 7's guest-facing slice.** Shipped: the whole resolver programme, the `calendar_date_overrides` migration and leave dual-write, the `schedule-health` cron, decisions (K) and (L)'s editor work, and fail-closed on the three routes carrying real guest traffic.

**What remains, in the order it is worth doing:**
1. **Stage 7's two latent routes** (`class-instances`, `resource-calendar`) — unreachable today, since production has no classes, events or resources.
2. **The resource half of (L)** — blocked on engine support, `[R3-89]`: nothing reads a resource's own leave or breaks.
3. **Stage 6b, contraction** — gated on 6a soaking, and the highest-risk category in the programme.
4. **Mobile app parity** — the app inherits every resolver fix automatically (it is an API consumer), so what it lacks is conveniences, not correctness. The exception is the venue-hours warning: it has the same blind spot the web had until decision (K) step 6.

**Baseline:** tree of `6bc9ef4f`, now squash-merged and shipped as `ea9672f2` on `main` and `staging`. Since the v2 draft: 20 lines of unrelated visits-route code and 63 lines of test. **Nothing this plan cites has moved.** 344 test files, 261 migrations.

**Supersedes:** §11.1 and §13 Phase 1 of `Docs/Resneo_Scheduling_Availability_Audit_August_2026.md`.

**Reverses one decision recorded in that audit.** Its implementation-status block (line 38) records "scheduled instances (classes, events) are gated by explicit closures only and never by the weekly baseline". **Decision (B) below reverses that for events.** The audit line is now stale and must be read through this document.

**Scope:** venue opening hours, venue amended hours, venue closures, calendar working hours, calendar breaks, calendar closures and leave, and the composition of all of them, for **appointments, resources, events and classes**.

**Explicitly out of scope:** table/restaurant venues. The operator confirms there are none on the platform and none expected. Restaurant-only paths (`reduced_capacity`, `area_id` scoping, the dining engine) are left alone; where a change would touch them, this plan says so rather than silently altering them.

---

## §0 What changed in v3, and why you should not read v2

v2 was attacked on four independent axes by four reviewers working from the code: citation verification, model semantics, data safety, and stage sequencing. Findings are marked `[R3-n]` so each correction is traceable. `[AR-n]` markers from the v2 round are retained where they still hold.

**Twelve blocking defects were found in v2 itself.** Four of them would have caused live harm:

| # | v2 said | Reality |
|---|---|---|
| `[R3-1]` | Stage 2 deletes `isWeeklyScheduleClosedForDate`, harmless because Stage 3 gives events the carve-out | Under decision (B) events keep a weekly gate, so nothing restores the carve-out. **Every ticketed event on a venue's normally-closed weekday stops selling.** Revenue loss on already-listed inventory. |
| `[R3-2]` | §1.3: `unified_calendars.availability_exceptions` is dead "on practitioner calendars" | There is no such thing. It is **one column** on **one table**; resources were migrated into `unified_calendars` by `20260502120000`. Dropping it destroys every resource's per-date overrides. |
| `[R3-3]` | §1.3: `days_off` is migration residue; §6: "ISO dates stay honoured" | `days_off` also honours **lowercase weekday names** as permanent recurring closures, live on two engines. The target model cannot express them. Migrating ISO dates alone reopens every such day. |
| `[R3-4]` | §2.3's `bookable()` subtracts ad-hoc blocks, sessions and closures before anchoring | That is the exact re-anchoring §2.5 spends a page forbidding for breaks. It moves every appointment slot after every blocked-time drag, every class, and every partial-leave window. |

**Two v2 claims were over-stated and one was inverted.** §1.2 item 4's "clobbers on every call site" is conditional, not universal, and the fix is three lines rather than fourteen call sites. §1.2 item 12 is latent, not live. "Four of five engines use the resolver" is three of five.

**One claim that appeared in the v3 review round is itself wrong and has not been carried through.** A reviewer argued that a narrow one-day amended block correctly narrows a longer one today, and that §2.3's union would regress it. It does not: `unionAmendedPeriods` (`venue-wide-business-hours.ts:84-96`) already concatenates the periods of **every** amended block on the date before intersecting. The narrowing does not work today either. A specificity rule is still the right design, but it is an **improvement**, not a preservation. It was therefore raised as operator decision **(E)** rather than adopted silently, sized with Q4 (zero rows on production), and then taken on 2026-08-17.

**What v3.3 changed, all of it from deploying and operating the thing `[R3-80]` to `[R3-83]`.** A second review technique the others cannot replace: running it against a real database.

| | Found | Correction |
|---|---|---|
| `[R3-80]` | `[R3-77]` claimed the ritual deploys code before migrations | **Inverted.** Migrations reach production at step 4, code merges at step 5. The missing-table window it described does not exist; the dual-write is fail-soft for a better reason that does not depend on deploy order. |
| `[R3-81]` | Adding the leave check to `validateEventCalendarPlacement` would have looked complete | That helper covers only the two PATCH paths. **Event CREATE validates hours inline**, so the obvious fix would have left creating an event onto leave untouched while fixing editing one. |
| `[R3-82]` | Staging showed 9 leave rows against 8 mirrored | **A backfill is a point-in-time snapshot and a dual-write only covers its own deployment onward.** The seam between them is invisible to both halves. Caught by the invariant query, not by row counts, which looked plausible either way. |
| `[R3-83]` | A comment in the applied migration contradicts its own SQL | Inverted time pairs are **skipped**, not copied as whole-day closures. SQL correct, comment wrong, file applied so not edited. |

**What v3.2 changed, all of it from implementing the plan `[R3-75]`, `[R3-78]`.** Building a thing is a review technique the other four axes cannot replace, and it found two model errors and one false prediction that reading could not:

| | v3.0/3.1 said | Corrected in v3.2 |
|---|---|---|
| `[R3-75]` | §2.4 filed `days_off` and `{closed:true}` under a `hard` `calendarClosures` set | Both are **hours** rules. They sit inside the `allowOutsideHours` gate, so tagging them `hard` would have stopped staff booking a walk-in on a day off, which §8 forbids. **Leave is the only `hard` calendar rule.** |
| `[R3-75]` | §2.4 specified `calendarClosures` and `calendarAdHocBlocks` as functions | Neither was built. There is no honest source for a calendar closure set distinct from leave until Stage 6a lands, and ad-hoc blocks already reach the engine as `practitionerBlockedRanges`. |
| `[R3-78]` | Stage 5 would silently start refusing event creation on staff leave dates (§1.2 item 24) | **It did not, because leave stayed outside the module.** Item 24 is still open, is now scheduled explicitly in Stage 6a, and the asymmetry is stated: class creation checks leave, event creation does not. |

Two further defects were found the same way and are recorded in their stages: Stage 4 part 1 changed nothing on screen because the day-view expansion fed its own generated stripes back in, and the diary renderer clipped amended stripes to weekly bounds. **Both were found by using the application, not by reading it or by running the suite.**

---

## §1 Evidence base

Every claim below carries a `file:line` citation that was re-read at `ea9672f2`. Claims that could not be verified from this repository are marked as such rather than asserted.

### 1.1 Corrections to the parent audit

| Audit claim | Reality |
|---|---|
| Phase 1 closes nine findings as one unit | Three unrelated programmes. Only `SA-H2` and `SA-M1` are resolver work; `SA-C3` is the fetcher plus a UI state; `SA-M8` and `SA-M10` are unrelated bugs. |
| "Create `src/lib/availability/resolver/`" | The resolver exists (`venue-wide-business-hours.ts`) and **three of five** engines already use it `[R3-5]`. `appointment-engine.ts` has its own `venueMinuteRangesForAppointmentDate` (`:483`); the dining engine has neither. |
| `venue-wide-business-hours.ts` is "well tested" | It had **2 tests, both covering `isWeeklyScheduleClosedForDate`**, and `resolveVenueWideAllowedMinuteRanges` had **zero** direct tests `[R3-6]` — which is why Stage 0b was load-bearing in a stronger sense than v2 stated. **Now 14**, after Stage 2, covering `cause`, the closure windows and both gates. |
| The resolver's intersect semantics are canonical | The shipped UI promises "close early **or open late**" (`BusinessClosuresSection.tsx:529-531`), which only works under **replace**. Operator has confirmed replace is intended. |
| Twelve write surfaces across four pages | v2's "16 write call-sites across 9 routes" is **not reproducible** `[R3-7]`: it defines neither term, and three of its four additions (`AppointmentServicesView.tsx:639`, `ClassTimetableView.tsx:275`, `ResourceTimelineView.tsx:584`) write only `defaultNewUnifiedCalendarWorkingHours()` at calendar-creation time. Use the two numbers that are checkable: **three editable weekly-hours editors**, and a larger set of routes that persist an hours column. |
| `/dashboard/availability` is an hours surface | The **route** redirects appointment venues to `/dashboard/calendar-availability` (`page.tsx:78-79`), but that destination renders `AppointmentAvailabilitySettings.tsx` **from the `availability/` directory**, which imports `WorkingHoursControl` at `:12` and renders it at `:1245` `[R3-8]`. **`/dashboard/calendar-availability` is the appointment hours surface and neither the audit nor v2 names it.** |
| Four weekly-hours editors with different copy-day rules | **Three** editors (`OpeningHoursControl.tsx:134`, `WorkingHoursControl.tsx:56`, `resource-timeline-ui.tsx:576`), and all three have **identical** copy-day rules. The period caps do differ (2 vs unlimited vs unlimited). |
| Click counts ("14+", "~27") | v2's counter-numbers (4, 37, ~122) are UX measurements, not code facts, and are neither verified nor relied on by any stage. |
| `SA-L1` (`venue_opening_exceptions`) is "latent, not live" | The audit was **right by accident**. The precedence defect is real (§1.2 item 4) but fires only where the legacy JSON is non-empty, and **Q9 shows no venue carries one**. Latent, and one column write away from live. |

### 1.2 What is actually wrong, ranked

Items 1 to 15 are carried from v2 with corrections. Items 16 to 24 are new in v3.

**Citation convention `[R3-71]`.** An entry marked ✅ or ⚠️ cites files **without line numbers**: the code it described has been changed or deleted, so a line reference is archaeology that would need re-anchoring every stage and could never be verified again. Live findings, the model in §2, the stage instructions and §7b keep exact `file:line` anchors, and those are re-verified at the end of every stage.

#### The composition defects

1. ✅ **FIXED, Stage 3.** Hours overrides now replace the baseline, including replacing a weekly-closed weekday, on every path. Original finding: **amended hours cannot open a weekly-closed day** for classes, events, resources or the diary. `resolveVenueWideAllowedMinuteRanges` returns `closed` at `venue-wide-business-hours.ts` for a weekday with no weekly periods, **before amended hours are examined at `:168`**. Opening specially on a bank-holiday Sunday: appointments sell it, everything else shows nothing, and the diary greys the day out *and* draws amended stripes over it (`schedule-closure-blocks.ts` and `:266`).

2. ✅ **FIXED, Stage 3.** One resolver, replace semantics everywhere. Original finding: **amended hours REPLACE for appointments and INTERSECT for everything else.** `appointment-engine.ts` returns `ex.periods` without ever intersecting the weekly base; `venue-wide-business-hours.ts` intersects.

3. ✅ **FIXED, Stage 3.** The lossy adapter is deleted; part-day closures narrow every path, and are vetoed rather than subtracted so the slot grid keeps its alignment. Original finding: **part-day closures widen to whole-day for appointments only.** `venue-exceptions-adapter.ts` pushes `closed: true` and never reads `time_start`/`time_end`.

4. ✅ **FIXED, Stage 1 item 2.** ~~The legacy `venues.venue_opening_exceptions` JSON outranks the closures table, at venues that have one.~~ The legacy JSON is now a fallback that fills only when the field is absent. Q9 confirmed zero venues carried one, so it shipped as a no-op. **Kept below because the defect is one column write from returning**, and because the count corrections matter for §7b. `[AR-5] corrected again in v3 [R3-9].` There are **fifteen** `attachVenueClockToAppointmentInput` invocation sites and **fourteen** omit `venueBlocks` (v2 said fourteen and thirteen). But v2's headline — "clobbers the block-derived list on every one" — is **false**. All three fetchers already derive `venueOpeningExceptions` from `availability_blocks` (`appointment-engine.ts`, `:1872-1879`, `appointment-month-availability.ts`), and `attachVenueClockToAppointmentInput` overwrites that only when the legacy JSON parses non-empty (`:148-149`); otherwise the derived list survives (`:150-152`). **The defect is a precedence bug in one function, not a plumbing gap across fourteen.** v2's Stage 1 prescription is correspondingly wrong: see Stage 1 item 4.

5. ✅ **FIXED, Stage 5.** Host leave and ad-hoc blocked time are loaded and vetoed per candidate. Original finding: **`resource-booking-engine` ignores staff leave and all block tables** (latent: zero resource calendars per Q0). Grepping the file for `leave`, `calendar_blocks` or `practitioner_leave` returns **zero hits**. A resource on a host column stays bookable while the host is on leave or has manual blocked time.

6. ✅ **FIXED, Stage 5 (decision A).** Both engines veto. Original finding: **breaks are a veto in the appointment engine and a subtraction in the resource engine.** Veto at `appointment-engine.ts:667-672` and `:1032-1034`; subtraction at `resource-booking-engine.ts:229-231`.

7. ⚠️ **FIXED FOR EVENTS, Stage 2.** The event engine now tests closure OVERLAP rather than block presence, so an unrelated closure no longer changes the answer. **Classes still short-circuit on `dayBlocks.length === 0`** in both the engine and the schedule-time validator; that is Stage 5. Original finding: **a single unrelated block on a date flips class/event semantics for that whole date.** Not "both" as v2 said, but **two read paths, one write gate and a renderer** `[R3-10]`: `class-session-engine.ts` (`if (dayBlocks.length === 0) return true`), `class-schedule-availability-conflicts.ts` (`if (dayBlocks.length > 0)`), `event-ticket-engine.ts` via `isWeeklyScheduleClosedForDate` (which returns false the moment any block exists, `venue-wide-business-hours.ts`), and `schedule-closure-blocks.ts`.

8. ✅ **FIXED, Stage 3.** The appointment engine calls the shared resolver, which combines all applicable blocks under decision (E). Original finding: **appointments evaluate one block per date; everything else combines all of them.** `appointment-engine.ts`: `applicable.find((ex) => ex.closed) ?? applicable[0]!`.

9. ✅ **FIXED, Stage 1 item 1.** ~~`unified-availability.ts` omits `special_event`~~, and the list it wiped was already correct `[R3-11]`. A cross-module test now asserts the four venue-wide `block_type` filters agree, so they cannot drift apart again. `getUnifiedAvailableSlots` builds its input via `fetchCalendarAppointmentInput`, whose own query **does** include `special_event` (`appointment-engine.ts`). Line 171 then passes a list built from the narrower query, so on a `special_event`-only date it passes `[]` and `attachVenueClockToAppointmentInput:144-145` clears a correctly-resolved closure. One bug firing twice.

10. ✅ **FIXED, Stages 3 and 5.** One calendar layer (`calendar-hours.ts`) and one venue resolver; the divergent exception pickers are gone. Original finding: **six implementations of "working hours to minutes", four of "breaks to minutes", and three divergent venue-exception pickers** `[R3-12]`. Working hours: `appointment-engine.ts:215`, `resource-booking-engine.ts:101`, `event-hours-vs-venue-calendar.ts:65` and `:144`, `service-custom-availability.ts:128` and `:387`. Breaks: `appointment-engine.ts:233`, `resource-booking-engine.ts:139`, `event-hours-vs-venue-calendar.ts:79`, `class-schedule-availability-conflicts.ts:73`. Pickers: **three**, not two (`appointment-engine.ts:471`, `event-hours-vs-venue-calendar.ts:30`, `service-custom-availability.ts:346`), only one carrying the "keep in sync" comment. **The divergence is a regression of a documented fix:** the closure-beats-amended correction at `appointment-engine.ts:484` was never propagated, so the other two still return first-match-in-list-order.

11. ⚠️ **MOSTLY FIXED, Stage 1 item 4.** Nine schedule reads now report to Sentry, including the fourth (fail-closed) tier. **Two limbs remain:** the month picker still discards its venue-clock error, which moved to Stage 4 as diary work; and the diary itself still renders a fully open grid on a failed venue fetch. Original finding: **failure visibility has four tiers, not three** `[R3-13]`. Sentry (`reportAvailabilityReadFailure`, four files); `console.warn` (`class-session-engine.ts:434,540`, `event-ticket-engine.ts:297,414`, `resource-booking-engine.ts:743,1044`, `validate-event-calendar-placement.ts`); silence (`PractitionerCalendarView.tsx` falls back to `{ blocks: [] }`, producing a **fully open grid** on a failed venue fetch); and a fourth, **fail-closed-and-silent**: `resource-booking-engine.ts` returns `[]` when `host_calendar` is missing, and the only signal that the host fetch failed is a `console.warn` at `:969`. Every hosted resource becomes unbookable with no Sentry event. This inverts the fail-open convention documented at `appointment-engine.ts`.

12. ✅ **FIXED on the read path, Stage 1 item 7.** Events crossing midnight are now judged like classes, by whether their start falls in an open range. The write validator still refuses `end <= start`, deliberately, because that is what enforces §2.2. Original finding: **events ending at or after midnight are rejected, latent not live** `[R3-14]`. The mechanism is real (`isMinuteSubintervalCoveredByRanges` returns false for `end <= start`, `venue-wide-business-hours.ts`), but it only runs when the resolution is `allowed`, and **no write path can create such a row**: `validateStartEndTimes` (`experience-event-validation.ts`) gates the POST (`experience-events/route.ts`), the PATCH (`experience-event-guards.ts`) and the UI (`EventManagerView.tsx`). There is no CHECK constraint, so only a direct DB write or an import could produce one. Fix it defensively, do not rank it as a live defect.

13. ✅ **FIXED, Stage 1 item 3.** The handler now validates the merged stored row, so the patch schema stays partial while the stored result is guaranteed valid. Date and time ordering are checked on both verbs, DELETE parses a schema, and a missing row answers 404 instead of falling through. Original finding: **`PATCH /api/venue/availability-blocks` can create `amended_hours` with null `override_periods`.** `blockSchema` refines against it (`:98-101`); `blockPatchSchema` (`:103-116`) does not, and the handler updates unconditionally (`:228-234`). `[AR-10]` remains correct that porting the refine would break partial updates. **Two refinements** `[R3-15]`: the resulting row is a silent full-day closure for classes/events/resources/diary (`venue-wide-business-hours.ts`) and a **no-op** for appointments (`venue-exceptions-adapter.ts`), so it also *diverges* the two paths; and the handler **already reads the stored row** for its conflict guard (`:210-216`), so the merged-validation remedy is a few lines on an existing fetch, not a new one.

14. ✅ **FIXED, Stages 2 and 5.** Three gates: `venueWideBlocksRejectBookingWindow` for slot generation, `scheduledInstanceRejectBookingWindow` for events, `classInstanceRejectBookingWindow` for classes, with `booking/create` loading `calendar_type` to dispatch. Original finding: **one write-path gate serves three models that need three different rules** `[AR-4]` `[R3-16]`. `venueWideBlocksRejectBookingWindow` is called from `booking/create` at `:1039` (group session), `:1298` (event tickets) and `:1562` (resource). Classes need closures only; events need closures plus weekly coverage; resources need the full gate. Worse, `:1031` is reached from the `event_session_id` branch (`:914-936`), which reads `event_sessions` and **never consults `unified_calendars.calendar_type`** — so one call site must dispatch on a column it does not load.

15. ✅ **FIXED, Stage 5.** `getEventClassSlots` applies the gate matching the column's `calendar_type`, the same dispatch `booking/create` makes. Original finding: **a live read/write disagreement on group sessions.** `getEventClassSlots` (`unified-availability.ts:378-467`) applies **no** venue-wide gate; `booking/create:1039` applies the full one. A 19:00 group session at a 09:00–17:00 venue is listed to the guest and then rejected with "The venue is closed for this date or time."

#### New in v3

16. ✅ **FIXED, Stage 2.** The listing was the correct side under decision (H), so the create gate moved to `scheduledInstanceRejectBookingWindow`. Original finding: **every class and every event on a weekly-closed weekday is listed and then refused at checkout** `[R3-17]`. On a weekday with zero periods and zero blocks, the class engine sells it (`class-session-engine.ts` returns `true`), the event engine sells it (`event-ticket-engine.ts`, the deliberate carve-out), and **both create gates reject it** (`create/route.ts` and `:1298` via `venue-wide-business-hours.ts`). This is live at every venue with configured opening hours. It is the single most important new finding, because it is the pair that decision (B) must resolve and v2 never names it.

17. ✅ **FIXED, Stage 3.** Both paths now resolve through `amendedPeriodsOf` in `venue-wide-business-hours.ts`, which ignores an override with no valid period and lets the weekly base survive (§2.2) — the appointment path's behaviour, chosen because a row with nothing in it is invalid data rather than an intent to shut. The parity harness asserts it directly on the guest path. **Originally:** the two paths meant opposite things and unifying moved availability in *both* directions `[R3-18]`. **(Zero such rows on production as of 2026-08-17; this is a latent defect held closed only by Stage 1 item 3.)** Today such a row is dropped for appointments (`venue-exceptions-adapter.ts:25` requires a non-empty array, so the day sells) and closes the whole day for classes, events, resources and the diary (`venue-wide-business-hours.ts:215`). Unify on "closed" and appointment days that sell today stop selling; unify on "ignore" (§2.2's law) and days that show closed today reopen, putting sessions back on sale. **v2 sized only widenings and this defect can go either way**, which is why Q3 is a repair prerequisite rather than a sizing query: fix the rows and neither direction fires.

18. ⚠️ **WRITE SURFACE CLOSED, Stage 1 item 8.** The API now accepts ISO dates only. **The read paths still honour weekday names**, deliberately, until Stage 6b contracts the column. Original finding: **`unified_calendars.days_off` carries recurring weekday names, and the target model cannot express them** `[R3-3]`. `appointment-engine.ts` and `resource-booking-engine.ts` both test `if (d === dateStr || d === dayName) return [];` where `dayName` is `sun`…`sat`. A value of `"mon"` is a permanent weekly closure. This is why v2's "migration residue" framing is wrong and why decision **(G)** exists. **Q5 on production (2026-08-17) returned zero rows**, so no venue is exposed today; the live risk is that `/api/venue/practitioners` still accepts arbitrary strings into this column from a mobile client this repository cannot see (§7, decision G).

19. ⚠️ **HALF FIXED, Stage 1 item 6.** Ranges are merged and candidate starts deduped, so no duplicate reaches a guest. **The semantic half remains:** a nested override still widens to the union instead of narrowing that day, which is decision (E) in Stage 3. Original finding: **overlapping amended blocks emit duplicate start times to guests** `[R3-19]`. `unionAmendedPeriods` (`venue-wide-business-hours.ts`) is a **concat, not a union**: it pushes every period from every amended block with no merge. `intersectMinuteRangeArrays` (`:81-94`) sorts but does not merge, so it can emit overlapping ranges. `candidateStartMinutes` (`booking-interval.ts`) then iterates ranges and pushes with **no dedup**. Two overlapping amended blocks on one date therefore produce repeated slot times, and `closedRangesFromOpenWindows` (`schedule-closure-blocks.ts`) mis-renders the diary for the same reason.

20. ✅ **FIXED, Stage 1 item 5.** All three now send `no-store`, and a test asserts the restaurant route keeps its cache so that exemption stays deliberate. **The cost is recorded in §8:** three guest routes lost edge caching with no replacement invalidation key. Original finding: **three public month routes CDN-cache schedule-derived answers with no invalidation** `[R3-20]`. `SA-M9` fixed exactly this on the appointment month path, and the comment explaining why sits at `booking/appointment-calendar/route.ts`. Three siblings still carry the bug, **one of them 100 lines above that comment in the same file**: `appointment-calendar/route.ts` (collective branch, `s-maxage=45`), `class-instances/route.ts` (`s-maxage=30`), `resource-calendar/route.ts` (`s-maxage=45`). Stages 3 and 5 change precisely the values these cache, so a staging soak will look correct while production serves up to 165 seconds of pre-change availability per edge node.

21. ✅ **FIXED, Stage 5.** `unified-calendar-mapper` carries the column. Original finding: **the unified path ignores resource `availability_exceptions` entirely** (latent per Q0). `mapCalendarToResource` reads it (`resource-booking-engine.ts:957`), but `unified-availability.ts:301-350` routes resource calendars through the **appointment** engine via `unifiedCalendarRowToPractitioner`, and `unified-calendar-mapper.ts:17-36` does not carry the field. A resource's per-date override is honoured on `/book` and silently ignored on the unified path. The same two paths also read **different break sets**: the host calendar's on one, the resource calendar's own on the other.

22. ✅ **FIXED, Stage 3.** It resolves through the shared function, so the summary and the engine cannot disagree. **A separate gap remains:** it is fed the legacy JSON rather than `availability_blocks`, which is now a Stage 4 item. Original finding: **`service-custom-availability.ts` is the un-synced twin.** Its picker at `:337-347` carries `/** Keep in sync with venueMinuteRangesForAppointmentDate in appointment-engine.ts */` and is **not** in sync (§1.2 item 10). Stage 3 deletes the function that comment points at. No stage in v2 assigns work to this file.

23. ✅ **FIXED, Stage 3.** It accepts venue-wide blocks and resolves through the shared function; the opening-hours route passes real blocks to both sides. Original finding: **`hours-change-orphans.ts` reads weekly opening hours only.** It warns owners which upcoming bookings an hours change strands. It never reads `availability_blocks`, amended hours or closures. Stage 3 redefines "inside hours" for every other consumer and this warning silently drifts. v2 counts its confirm dialog in §1.1 and never assigns it.

24. ✅ **FIXED, Stage 6a, 2026-08-19 `[R3-81]`.** Both event PATCH paths and event CREATE now check leave, so events and classes refuse the same windows. **Stage 5 did NOT turn this on as v3.0 predicted `[R3-78]`:** Leave stayed outside the calendar-hours module by design, so the validator still never reads `practitioner_leave_periods`. **Class creation checks leave; event creation does not** — the same venue, two answers. Scheduled explicitly in Stage 6a rather than left to fall out of a refactor. **Originally:** event creation never checks leave, and Stage 5 was expected to turn that on silently. `validate-event-calendar-placement.ts:53-84` reaches `calendarSegmentsForDate` (`event-hours-vs-venue-calendar.ts:80-93`), which reads `working_hours`, `break_times` and `days_off` and never `practitioner_leave_periods`. Decision (D) keeps this validator, so making leave a calendar closure starts refusing event creation on leave dates, at a write surface, whether or not anyone intends it.

### 1.3 What is dead, what only looks dead, and what must never be dropped

**v2's §1.3 was a deletion checklist containing two entries that would destroy live venue settings.** It is replaced by three tiers. **Nothing in tier 2 or tier 3 may be dropped by any stage of this plan.**

#### Tier 1 — genuinely unreferenced in this repository

- **`PATCH /api/venue/venue-opening-exceptions`, `POST /api/venue/calendar-columns`, `POST/PATCH /api/venue/service-schedule-exceptions`.** No in-repo callers. **All methods on all three are dead, not only those named** `[R3-21]`: `service-schedule-exceptions` also exports a dead `GET` (`:20`) and `DELETE` (`:128`), `venue-opening-exceptions` a dead `GET` (`:7`).

  **"Zero callers" is not provable from this repository** `[R3-22]`. `Docs/MOBILE_API.md:3` records that the React Native app `reserveni-app` is a **separate repository** authenticating with `Authorization: Bearer`, and every `/api/venue/*` route is reachable with that token. Two further live references contradict "dead": `support-session-core.ts:122` treats the `venue-opening-exceptions` PATCH as an expected superuser write surface, and that PATCH is the **only writer** of the legacy JSON that fourteen call sites still read (§1.2 item 4) — deleting the sole editor while the readers remain removes the only escape hatch for a venue whose hours are wrong.

  **Prerequisite before deleting any route:** grep `reserveni-app`, and confirm zero hits in 90 days of production access logs.

#### Tier 2 — looks dead from the dashboard, is live through the API

- **`unified_calendars.days_off`.** Every *UI* writes `[]` (`calendar-columns:74`, `AppointmentServicesView:641`, `ClassTimetableView:277`, `PractitionerCalendarView:418`, `ResourceTimelineView:586`), **but `/api/venue/practitioners` accepts and persists an arbitrary array** (`:213` schema, `:454`/`:480` insert, `:800` PATCH allowlist), and that route serves Bearer/mobile auth. It carries two live semantics, only one of which the target model can express (§1.2 item 18).

  **Q5 on production (2026-08-17): zero rows.** No calendar carries a non-empty `days_off`, so there is nothing to migrate and decision **(G)** costs nothing in data terms. **The column is still not safe to drop**, for two reasons: the write surface can re-populate it at any time from the mobile app, and the engines read it. Sequence is therefore Stage 1 (validate the API input down to ISO dates), keep honouring it through Stage 5, **re-run Q5 immediately before Stage 6b**, and contract only on a second zero.
- **`unified_calendars.break_times` (flat).** Same shape: UIs write `[]`, `/api/venue/practitioners` accepts it at `:210`, `:453`, `:478`, `:798`, and a **staff self-service** path allowlists it at `:557-559`, `:669`, `:677`. It is also the **live fallback** whenever `break_times_by_day` is null or empty, on four engines (`appointment-engine.ts:234-245`, `resource-booking-engine.ts:146-157`, `event-hours-vs-venue-calendar.ts:80-89`, `class-schedule-availability-conflicts.ts:255`, the last with a test named "falls back to the flat break_times list"). Any calendar in the "same breaks every day" mode loses **every break** if it is dropped. **Q0 (2026-08-17): zero calendars are in that mode**, so there is nothing to migrate today. Still migrate-verify-contract in that order, because the write surfaces above can repopulate it and the zero expires.
- **`practitioner_calendar_blocks`.** Zero *inserters* — the legacy insert branch was removed for `SA-M13` (`practitioner-calendar-blocks/route.ts:175-185`). But there are **two live writers**: `[id]/route.ts:199-200` (`const table = existingPrac ? 'practitioner_calendar_blocks' : 'calendar_blocks'` then `.update()`) and `:236` (`.delete()`). Readers: five in engines plus three API reads. Plus four infra references that break in the same commit if missed (`truncate_app_data.sql:121`, `local_baseline_grants.sql:56`, `scheduling_grants_test.sql:69,112,149`) and two venue-delete RPCs that would fail `42P01`. **v2's FK claim is confirmed in-repo** `[R3-23]`: `20260401000000_practitioner_calendar_blocks.sql:6` declares `practitioner_id uuid NOT NULL REFERENCES practitioners (id) ON DELETE CASCADE`, and `supabase/tests/scheduling_grants_test.sql:75-82` records that this FK was **never re-pointed** to `unified_calendars` when its sibling `practitioner_leave_periods` was (`20260918140000`). The table therefore cannot accept a row for any unified calendar, which is why it has no inserters. **Row counts still need checking on both hosted databases; the FK does not.** It is a 15-site change, not a one-liner.

> An earlier draft of this section asserted the migration "contains no `REFERENCES` clause" and sent the implementer to the hosted databases to re-derive it. That was false, and it dismissed a true finding. It is recorded here rather than quietly fixed, because it is the same failure §9 names, committed inside the document that names it.

#### Tier 3 — must never be dropped

- **`unified_calendars.availability_exceptions`** `[R3-2]`. **Q0 (2026-08-17): zero calendars carry a non-empty value**, so a drop would destroy nothing *today* — and it stays in this tier anyway, because three live surfaces still write it and the zero expires the moment a venue adds a resource. **There is no "practitioner calendars" version of this column.** `20260502120000_resources_to_unified_calendars.sql:6` adds one column; lines 12-30 move every `venue_resources` row into the same table with `calendar_type='resource'`. Live writers: `venue/resources/route.ts:416` (POST), `:594` (PATCH), `ResourceTimelineView.tsx:967`. Live readers: `resource-booking-engine.ts:199`, `:940`, `venue/resources/[id]/route.ts:57`, `venue/linked-calendar/route.ts:72,98`, `PractitionerCalendarView.tsx:383,409`. A `DROP COLUMN` destroys every resource's per-date overrides on both environments, irreversibly.

  The true statement v2 was reaching for: **the appointment engine never sees it**, because `unified-calendar-mapper.ts:17-36` does not carry the field (§1.2 item 21). That is a **defect to fix**, not a column to drop. If the goal is to clear stray values on non-resource rows, the only safe operation is a measured, data-scoped `UPDATE`, never a `DROP COLUMN`.

- **`practitioner_leave_periods.leave_type`.** v2's factual claims are all correct: required server-side (`practitioner-leave/route.ts:68`), rendered as a dropdown (`StaffLeaveCalendarPanel.tsx:538-547`), read by no engine, and mislabelled (`annual` renders as "Closed", `sick` as "Unavailable"). One addition: the field's own label reads **"Label (optional)"** (`:536`) while the POST schema requires it `[R3-24]`. **But "unread by an availability engine" is not "safe to drop":** it is HR data a venue typed in and reads back. Carry it, with `notes` and `created_at`, onto whatever replaces the table. **The stated defect is a copy fix at `StaffLeaveCalendarPanel.tsx:536-547`, not a schema change.**

---

## §2 The model

Two layers. Two axes. One composition rule per booking model.

### 2.1 The two axes the code currently encodes by accident

Every defect in §1.2 that is not a plain omission comes from one of these two distinctions being implicit in *where a check sits in a function body* rather than explicit in the data.

**Axis 1 — skippability.** Staff may deliberately book outside hours (`allowOutsideHours`) or over a break (`allowDuringBreaks`). They may **never** book over leave. Today that difference is encoded by leave being checked *above* the `if (!options?.allowOutsideHours)` block (`appointment-engine.ts:986-999`), with a comment naming `SA-M3` as the bug that happened when it was not. Every rule must therefore be tagged:

| Tag | Skippable by | Members |
|---|---|---|
| `hours` | `allowOutsideHours` | venue weekly hours, venue amended hours, venue closures, calendar working hours, calendar Hours overrides, service custom hours |
| `break` | `allowDuringBreaks` | calendar breaks |
| `hard` | nothing | leave, calendar closures, ad-hoc calendar blocks, scheduled sessions, bookings, resource occupancy |

**This is why v2's central metaphor is wrong.** §2.2 of v2 said "a calendar closure is to a calendar what a venue closure is to a venue". They are not symmetric: venue closures are `hours` and staff can override them today; leave is `hard` and they cannot. Folding leave into a `calendarOpen` that sits inside the `allowOutsideHours` gate **silently reverts `SA-M3`** `[R3-25]`.

**Axis 2 — anchor or veto.** The candidate grid is anchored to **each range's start** (`booking-interval.ts:116`: `for (let t = range.start; t + totalSpan <= range.end; t += step)`). So a rule that *splits* a range moves every slot after it, and a rule that *vetoes a candidate* does not.

| Kind | Effect | Members |
|---|---|---|
| **Anchoring** | defines the ranges the grid is generated from | weekly and amended **hours** only: venue ∩ calendar ∩ service |
| **Occupancy** | splits ranges, legitimately re-anchoring | existing bookings, sibling resource ranges |
| **Veto** | tested per candidate, never splits | breaks, leave, **venue closures**, calendar closures, ad-hoc blocks, scheduled sessions, projected resource ranges |

v2 discovered this for breaks in its §2.5 and then forgot it for four other rule types in its §2.3 `[R3-4]`. **Only hours may anchor.**

**Venue closures are a veto for slot generation, even though `venueOpen` subtracts them `[R3-52]`.** This is the subtlety that a first pass gets wrong. `venueOpen.effective` must subtract closures, because containment consumers (events, classes, the write gates) need a single range set to test a fixed window against. But if `appointmentCandidates` anchors to `effective`, a 12:00–12:45 venue closure splits the day and the afternoon grid moves from 13:00/13:30 to **12:45/13:15** — the exact harm §2.7 forbids for breaks, applied to a different rule, and `validateExactAppointmentStart` then 400s on previously-bookable times. It would also make a venue closure and a break of identical shape produce different slot times, which no owner could explain. **Slot generation therefore anchors to `venueOpen.hours` and vetoes against `venueOpen.closures`** (§2.5). Containment consumers keep using `effective`. The two are equivalent for containment and differ only under anchoring.

### 2.2 Validity, applied to every period list everywhere below

A period is **valid** iff `0 <= start < end <= 1440`.

- `end <= start` means the author tried to cross midnight. **ResNeo cannot express that today.** The period is dropped and reported through `reportAvailabilityReadFailure`.
- An Hours override left with **no valid period is ignored** — it does not exist. **It is not a closure.** This resolves a live contradiction: today an empty venue override closes the whole day (`venue-wide-business-hours.ts:215`) while an empty resource override falls through to the weekly base (`resource-booking-engine.ts:199-217`). One of the two must win. **Ignore wins because such a row is invalid data, not an intent:** the POST schema forbids it, only the unrefined PATCH can produce it (§1.2 item 13), and the UI's own error reads "At least one open period is required for amended hours." Nothing about it expresses a decision to close.

  **This law cuts both ways, and both directions are real** `[R3-53]`. Under "ignore", appointments are unaffected (they already ignore it) but classes, events, resources and the diary — which close the whole day today — would see those days **reopen**, putting sessions back on sale that an owner may believe are off. Under "close", appointments lose days that sell today. **Neither is acceptable as a surprise, so Stage 3 does not rely on either:** every such row is repaired or deleted first (query Q3), after which the law only governs rows created in future, and no venue sees a change at all.
- A Closed window with no `time_start` or no `time_end` covers `[0,1440)`. A Closed window with `end <= start` is dropped.
- **Ranges are merged before use, and candidate lists are deduped.** Fixes §1.2 item 19.

**Past-midnight opening hours are not supported, and this plan does not add them.** Ban them at every write surface with a real error, or accept that a "20:00 to 02:00" venue resolves closed all day. Naming this is the point; silently dropping it is the current bug.

### 2.3 Venue layer

`venueOpen(date)` returns a **struct**, not a single value. Collapsing it to `ranges (empty = closed)` is what made `isWeeklyScheduleClosedForDate` undeletable, what made §1.2 item 7 hard to fix, and what still makes the month grey-out wrong `[R3-26]`. **Stage 2 shipped the first half of this struct** (`cause` and `closures`); Stage 3 adds `hours` and `effective`, and Stage 4 is what consumes the result in the diary and month grid.

```
venueOpen(date) -> {
  weekly:    'unrestricted' | 'weekly-closed' | ranges   // before any override
  hours:     'unrestricted' | 'weekly-closed' | ranges   // after Hours overrides
  closures:  windows[]                                   // materialised
  effective: 'unrestricted' | ranges                     // hours - closures; [] = closed
}

1. BASE, three states, and "closed" must remember WHY.                    [AR-3, R3-1]
     opening_hours absent or {}                    -> weekly = 'unrestricted'
     configured, weekday has >= 1 valid period     -> weekly = those periods
     configured, weekday has no periods            -> weekly = 'weekly-closed'
   All four shapes of "no periods" are the same state: a missing weekday key,
   {closed:true}, {periods:[]}, and a legacy {open,close} missing either half
   (src/lib/availability/index.ts:85-95). A venue that saved only Monday is
   'weekly-closed' Tue to Sun on every path.

2. HOURS OVERRIDES -- REPLACE, including replacing 'weekly-closed'.
   This is what lets a venue open on a normally-closed weekday, and it is defect #1.
     applicable = Hours overrides covering `date` with >= 1 valid period
     if applicable is empty -> hours = weekly (carrying its state through)
     else                   -> hours = the winner's valid periods
   WINNER, decision (E): smallest (date_end - date_start); ties -> latest
   created_at; still tied -> union the tied set. So a one-day override NARROWS a
   multi-month one instead of being swallowed by it.
   Today all applicable overrides are concatenated and then intersected with the
   base, so the narrowing silently does nothing. Q4 confirmed zero live venues
   have overlapping overrides, so adopting this changes no venue today.

3. CLOSURES. closures = every applicable Closed/special_event window, materialised.
   Exposed on the result so a consumer can ask "does a closure overlap MY window?"
   without re-deriving it. Required by the events rule in §2.5.

4. MATERIALISE, THEN SUBTRACT.                                                [AR-3]
     if hours == 'unrestricted' and closures is non-empty: hours := [{0,1440}]
     effective = hours - closures
   Without step 4 a part-day closure at a venue with no weekly hours is a silent
   no-op, and that is the most common appointments shape.

5. RESULT. effective empty means closed; `weekly` and `closures` say which kind:
     weekly == 'weekly-closed' and closures empty -> "does not trade this weekday"
     otherwise                                    -> "an override closed it"
```

### 2.4 Calendar layer

**Two functions, because one is skippable and one is not** (§2.1).

```
calendarHours(date, calendar) -> ranges            // tag: hours
  1. base = weekly working periods for that weekday (valid only)
  2. if any calendar Hours override applies -> REPLACES base, same decision (E)
     specificity rule as venueOpen step 2
       sources: resource availability_exceptions[date] = {periods:[...]}
                (Stage 6) calendar_date_overrides of kind 'hours'
     An override with no valid period is IGNORED and the weekly base survives (§2.2).
  3. if days_off marks the date, OR availability_exceptions[date] = {closed:true},
     OR (Stage 6) a calendar_date_overrides row of kind 'closed' covers the whole day
       -> result is EMPTY. These are hours rules, not closures: see below.
  4. breaks are NOT subtracted here; leave is NOT subtracted here
  5. result: ranges (empty = not working)

calendarLeave(date, calendar) -> windows[]         // tag: hard. NOTHING skips these.
  sources: practitioner_leave_periods -- both times null -> [0,1440);
             both set -> that window, on every date in [start_date, end_date]
  Checked by the engine ABOVE the allowOutsideHours gate, deliberately outside the
  calendar-hours module. These NEVER enter an anchoring range. Partial-day leave is
  a VETO today (appointment-engine.ts:994-997 says so explicitly); subtracting it
  would move every slot after every leave window.                          [R3-27]

calendarBreaks(date, calendar)      -> windows[]   // tag: break
  ad-hoc calendar_blocks are tag: hard, and reach the engine already, as
  practitionerBlockedRanges. No wrapper is built for them (Stage 5).

calendarBookableSegments(date, calendar) = calendarHours - calendarBreaks
  FOR CONTAINMENT CONSUMERS ONLY (event-hours validation, class placement).
  Never used to anchor a candidate grid. For a containment test ("does this fixed
  window fit?") veto and subtract are provably equivalent; they diverge only under
  anchoring, which is the entire subject of §2.6. Without this named function,
  Stage 5's instruction to repoint the event-hours checker at calendarHours would
  silently delete decision (D)'s break clause.                             [R3-28]
```

**`days_off` and `{closed:true}` are HOURS rules, not closures — corrected in Stage 5 `[R3-75]`.** v3.0 filed both under a `hard` `calendarClosures` set that nothing may skip. That is wrong, and shipping it would have been a regression: both sit inside the `allowOutsideHours` gate today, so tagging them `hard` would have stopped staff booking a walk-in on a calendar's day off, which §8 promises this work does not do. They resolve to an empty hours set instead, which is skippable exactly as it is now. **Leave is the only `hard` calendar rule**, and it is checked outside the module. There is no `calendarClosures` function and no honest source for one until Stage 6a's `calendar_date_overrides` provides it.

**`availability_exceptions` maps two ways, not one** `[R3-29]`. v2 filed all of it under Hours. `{closed:true}` is a **Closed** override; `{periods:[...]}` is an **Hours** override; `{periods:[]}` falls through to the weekly base. It is keyed by exact date, never a range, so the Stage 6 migration is many-rows-to-one-row-per-date.

### 2.5 Composition, per booking model

```
appointmentCandidates(date, calendar, service):
  -- ANCHORING SET. Hours only -- NOT venueOpen.effective.               [R3-52]
  -- The ONLY thing allowOutsideHours may skip.
  1. open = calendarHours(date, calendar)                    ; empty -> no slots
  2. v = venueOpen(date)
       v.hours == 'unrestricted'   -> unchanged
       v.hours == 'weekly-closed'  -> no slots
       else                        -> open = open INTERSECT v.hours
     Closures are NOT subtracted here. They are vetoed at step 5, so a part-day
     venue closure removes the candidates it covers without moving the ones after
     it, and a closure and a break of the same shape produce the same grid.
  3. open = open INTERSECT serviceCustomRanges(date, service); empty -> no slots
     (service_items.custom_working_hours is INSIDE the anchoring set, not "after"
      it -- appointment-engine.ts:630-645. v2 named only two of the three.) [R3-30]

  -- ANCHOR. Nothing below this line may split `open`.
  4. candidates = candidateStartMinutes({ranges: open, totalSpan, interval/marks/fixed})

  -- VETOES, each against [t, t + totalSpan).
  5. reject if the candidate overlaps:
       a. venueOpen(date).closures  hours  (allowOutsideHours skips)      [R3-52]
       b. calendarClosures          hard   (incl. partial leave)
       c. calendarBreaks            break  (allowDuringBreaks skips)
       d. calendarAdHocBlocks       hard
       e. scheduled class/event sessions on this calendar   hard
       f. projected hosted-resource ranges                  hard
     (a) is tagged `hours`, not `hard`: staff can book through a venue closure
     today, inside the same gate as opening hours (appointment-engine.ts:998-1012).
     Only leave is `hard`. Do not promote venue closures while moving them.
  6. capacity: peak concurrent bookings < parallel_clients

  Full-day leave stays checked ABOVE the hours gate, exactly as today
  (appointment-engine.ts:993-995). It is not an opening-hours question.

resourceCandidates(date, resource, duration):
  1. hours = calendarHours(date, resource)
  2. if hosted: hours = hours INTERSECT calendarHours(date, host)
  3. v = venueOpen(date)  -- MISSING FROM v2's hostedResourceOpen ENTIRELY.  [R3-31]
     Omitting it removes venue closures from resource reads while
     booking/create:1571 keeps rejecting: a newly-manufactured read/write split.
  4. anchoring = hours MINUS host booking occupancy MINUS sibling resource ranges
     These two are OCCUPANCY (§2.1 axis 2). They legitimately re-anchor, exactly
     as today (resource-booking-engine.ts:611-614). Decision (A) does not touch them.
  5. candidates from each anchoring range's start, step slot_interval
  6. reject if the candidate overlaps:
       calendarClosures(resource)   hard
       calendarClosures(host)       hard   -- fixes resource-ignores-leave
       calendarBreaks(host)         break  -- decision (A): was a subtraction
       calendarAdHocBlocks(host)    hard   -- NEW, not honoured today
  7. capacity: existing bookings on this resource

  Standalone resources (display_on_calendar_id null) run the same rule with
  steps 2 and 6's host clauses omitted. v2 described no rule for them at all.

resourceRangesForHostProjection(date, resource)                             [R3-32]
  = step 4's set, MINUS calendarBreaks(host), MINUS calendarClosures(host).
  A DIFFERENT function from the candidate set, and it MUST KEEP SUBTRACTING breaks.
  It is consumed as a RANGE on the host's own column (appointment-engine.ts:1836-1842,
  appointment-month-availability.ts:929) and vetoed UNCONDITIONALLY at :1038-1042,
  one line below the break check that allowDuringBreaks skips at :1039. Stop
  subtracting host breaks here and a staff walk-in over lunch -- the exact gesture
  allowDuringBreaks exists to permit -- starts failing with a resource-block error
  on every column that hosts a resource. The same set feeds sibling exclusion
  (:244, :568), which is range arithmetic and cannot be expressed as a veto.
  DECISION (A) THEREFORE CHANGES ONE CALL SITE (:368), NOT ONE FUNCTION.
  Stage 0a has already split the two functions apart; only the slot loop moves.
```

### 2.6 Scheduled instances: classes, events, and `event_sessions`

**There are three instance tables, not two model names** `[R3-33]`: `class_instances`, `experience_events`, and `event_sessions` — the last discriminated by `unified_calendars.calendar_type` (`unified-availability.ts:242-246`). Under decision (B) that column now decides **which venue gate applies**, and `booking/create:1039` does not currently load it.

```
scheduledInstanceAllowed(date, start, end, instance):
  window = [start, end); if end <= start then end += 1440
  (Events store an absolute end_time, so a 22:00-01:00 event yields end=60. Copying
   the class helper verbatim, as v2 instructed, returns false on its first line.) [R3-34]

  ALWAYS, for classes and events alike:
    blocked if any venueOpen(date).closures window overlaps `window`
    blocked if instance.calendar is non-null and calendarClosures overlaps
    blocked if instance.calendar is non-null and calendarAdHocBlocks overlaps
      (experience_events.calendar_id and class_types.instructor_id are BOTH
       nullable; the calendar clauses are no-ops when there is no calendar) [R3-35]
    NOT blocked by calendar weekly working hours
    NOT blocked by breaks -- guest-facing READ only. Decision (C) keeps the
       schedule-time break refusal on the WRITE path.

  VENUE WEEKLY HOURS -- this is the whole of decision (B):
    CLASSES (class_instances, and event_sessions on a calendar_type='class' column):
      never consulted. A 7pm yoga class at a 9-5 venue stays bookable, which
      class-session-engine.ts:175-181 documents as intentional.
    EVENTS (experience_events, and event_sessions on calendar_type='event'):
      let h = venueOpen(date).hours
        'unrestricted'                        -> allowed
        'weekly-closed' with no Hours override -> ALLOWED. Decision (H), taken.
              This preserves event-ticket-engine.ts:109-124's carve-out. Removing
              it would take every ticketed event on a Mon-Sat venue's Sunday off
              sale, silently, on already-listed inventory: the [R3-1] BLOCKER.
              An explicit closure on the date still hides the event, via the
              ALWAYS clause above. That is what makes the allowance safe, and it
              is the behaviour Stage 2 must assert in both directions.
        ranges                                 -> `window` must be fully covered
      Tested against `hours`, NOT `effective`: closures are already handled by the
      ALWAYS clause, so an unrelated part-day closure can no longer flip an event
      from visible to hidden. That is §1.2 item 7, fixed for events without giving
      them the classes carve-out.
```

**Consequence for the three `booking/create` gates.** `:1039` dispatches on the host calendar's `calendar_type` (which it must start loading); `:1298` takes the event branch; `:1562` takes the full venue gate. Three rules, three gates. `[AR-4]`'s two-way split is insufficient `[R3-16]`.

**Decision (C) means "keep the break refusal", not "keep the function unchanged"** `[R3-36]`. `class-schedule-availability-conflicts.ts:124-134` also enforces amended-hours coverage and short-circuits on `dayBlocks.length > 0` — which is a **copy of §1.2 item 7 on the write path**. Step 1 of that function must be rewritten to the same `scheduledInstanceAllowed` predicate as the read path, or a 19:00 class at a venue with an amended block is sold to guests and refused when staff schedule the next one. Only its break clause (`:157-163`) survives unchanged.

### 2.7 Breaks: veto, not subtract `[AR-1]`, decision (A) taken

**Verified directly.** `booking-interval.ts:116` anchors to `range.start`; `resource-booking-engine.ts:368` anchors to ranges that already had host breaks subtracted at `:229-231`. The v2 analysis is correct.

> Working 09:00–17:00, break 12:00–12:45, 30-minute interval and span.
> **Veto (appointments today):** … 11:00, 11:30, **13:00**, 13:30 …
> **Subtract (resources today):** … 11:00, 11:30, **12:45**, 13:15, 13:45 …

Unifying on **subtract** would move every appointment slot after every break, returning 400 from `validateExactAppointmentStart` for previously-bookable times. Unifying on **veto** moves resource slot times instead. The operator has chosen **veto**. The exception where the two genuinely agree is `hasHourRestriction`, where `step = 1` and offsets are hour-anchored (`booking-interval.ts:112,117`).

Processing-time gaps are unaffected either way: `serviceSchedulingSpanMinutes` returns `duration + buffer` when processing blocks are set (`appointment-engine.ts:980-984`) and the busy envelope is capped at exactly that (`processing-time.ts:197-206`).

**But decision (A) is not a one-line change**, and §8's "does not change staff override behaviour" is false unless `resourceRangesForHostProjection` is split out first. See §2.5 and Stage 0a.

---

## §3 Decisions taken

| Decision | Rationale |
|---|---|
| Amended hours **replace** the weekly baseline | Operator. The shipped UI promises "close early **or open late**". Intersect cannot open late. |
| Amended hours **can open a weekly-closed day** | Follows from replace, and is the single most broken case today. |
| Part-day closures **subtract** | Operator. Makes the times owners type do what they say. |
| Part-day closures are **retained**, not removed | They work correctly today for classes, events and resources; a date-ranged part-day closure preserves each day's own hours in a way one Hours override cannot; the editor caps at two periods. |
| **(A) Breaks are a veto** applied to candidates generated from unsplit ranges | Operator, 2026-08-17. Preserves appointment slot times exactly; shifts resource ones. The resource engine's **slot loop** changes (`:368`); its occupancy and projection ranges keep subtracting via `resourceRangesForHostProjection`, which Stage 0a has already split out (§2.5). |
| **(B) Events are gated by venue weekly hours wherever those hours exist; the §2.6 carve-out applies to classes only** | Operator, 2026-08-17. **Reverses** the audit's line-38 decision. One edge case is settled separately by **(H)**: a weekday with no periods and no override, where applying (B) literally would hide every ticketed event. Where calendar hours are enforced for events is decision **(F)**. |
| **(C) A class is still refused when it overlaps a break** | Operator, 2026-08-17. A schedule-time refusal is not a guest-facing availability rule. Keeps `class-schedule-availability-conflicts.ts:157-163` only; the rest of that function is rewritten (§2.6). |
| **(D) Event creation is still validated against calendar hours** | Operator, 2026-08-17. Requires `calendarBookableSegments` (§2.4) to exist, or Stage 5 deletes the break clause by accident. |
| **(E) The most specific Hours override wins.** Smallest `date_end - date_start` beats a longer one; ties on latest `created_at`; genuinely tied overrides union | Operator, 2026-08-17. A one-day 10:00–14:00 entry inside a three-month 08:00–20:00 entry must narrow that day, and today it silently does not. **Q4 returned zero rows on production**, so no live venue changes and this is adopted purely because it is what owners mean. |
| **(F) Events are validated against calendar hours at CREATE time only** | Operator, 2026-08-17. This is today's behaviour and decision (D) already preserves it. A read-time gate would need calendar data in two engines and two fetchers, has no defined answer for the nullable `calendar_id` case, and fails silently as "creatable but invisible" if the two checks ever disagree. |
| **(G) `days_off` weekday names convert into the calendar's weekly working hours** | Operator, 2026-08-17. **Q5 returned zero rows on production: no calendar carries a non-empty `days_off` at all.** There is nothing to migrate, so (G) becomes a *write-surface* job, not a data job. See §1.3 tier 2. |
| **(H) Events keep the weekly-closed allowance** | Operator, 2026-08-17. A weekday with no periods is an absence of configuration, not a decision to close, and a deliberately scheduled event is the stronger signal. Hiding live inventory fails silently and costs ticket revenue; showing an event on a genuinely closed day is visible and correctable. **An explicit closure on the date still hides it**, which is the safety valve that makes this safe. |
| Leave is a **calendar closure with tag `hard`**, never an hours input | `[R3-25]`. Folding it into an hours function reverts `SA-M3`. |
| **No per-venue flag** | Operator. The parity harness (§5) is the safety net instead. |
| Restaurants are **not** in scope | Operator. No venues, none expected. |

---

## §4 Stages

Reordered from v2. **Stage 2 is new and is the only irreducible read-plus-write atomic unit;** isolating it makes it revertable on its own, which v2's Stage 2 was not. Diary geometry is promoted from a bullet to a stage.

### Stage 0a — Export-only refactor. No behaviour change. ✅ DONE 2026-08-17

The harness cannot be built without it, and the `resourceRangesForHostProjection` split must exist **before** anyone touches breaks.

1. Export `buildResourceEngineInputFromParts` (`resource-booking-engine.ts:528` after this stage) and `getEventClassSlots` (`unified-availability.ts:378` after this stage). Both are currently unexported, which is why v2's Stage 0 could not assert the resource engine or the group-session path `[R3-37]`.
2. Split `getEffectiveAvailabilityRanges` into the candidate set and `resourceRangesForHostProjection` (§2.5). **Both still subtract breaks at this stage.** Pure refactor.
3. Add a shared Supabase fake. There was none: every route test hand-rolled `vi.mock`, and a `mockReturnThis` chain cannot model *which* rows a filter returns. **Delivered at `src/lib/testing/supabase-fake.ts`.**

**Exit:** `tsc --noEmit` clean, suite green, zero behaviour diff. **Met:** tsc clean, `npm run lint` 0 errors (104 pre-existing warnings, none in touched files), **345 files / 3274 tests passing**. The entire non-comment diff is one delegating function, two call-site repoints and two `export` keywords, so behaviour-neutrality is provable by reading rather than asserted.

Delivered:
- `resourceRangesForHostProjection` (`resource-booking-engine.ts`), delegating to `getEffectiveAvailabilityRanges`. `mergedSiblingResourceRangesExcluding` and `mergedResourceEffectiveRangesForHost` now call it; the three own-grid call sites (`:315`, `:394`, `:563` at baseline) still call the original. The doc comment records why they must diverge, so Stage 5 cannot re-merge them by accident.
- `buildResourceEngineInputFromParts` and `getEventClassSlots` exported, each with a comment naming the harness need.
- **Citations re-anchored.** Stage 0a added ~45 lines to `resource-booking-engine.ts` and ~6 to `unified-availability.ts`, shifting every line this document cites in them. All 20 were recomputed and spot-checked against the post-stage file. **Every stage from here does the same, and re-anchoring is part of the stage, not cleanup afterwards** — a plan whose anchors have rotted is how the previous three rounds went wrong (§9).
- `src/lib/testing/supabase-fake.ts` plus 11 tests. It applies filters rather than returning everything, supports exactly the operators the availability fetchers use (eq, neq, in, is, gte, lte, gt, lt, order, limit, `not(col,'is',null)`, `or()` as an eq-disjunction), and **throws on any unsupported operator** rather than silently matching all rows. Typed end to end: no `as any` at call sites, and the one unavoidable structural cast is behind `asSupabaseClient<T>()`.

### Stage 0b — The parity harness. No behaviour change. ✅ DONE 2026-08-17

Pin current behaviour so every later stage is a reviewable diff in one file.

- **Assert the full ordered list of start times per fixture, not booleans `[AR-§5]`.** A boolean matrix passes straight through the §2.7 re-anchoring without noticing. This is the harness's single most important property.
- **Assert read/write agreement pairs.** For each fixture, the engine offers T ⟺ the corresponding gate accepts T. This is what catches §1.2 items 15 and 16, both already live.
- Fixture set, including the shapes v2 omitted: weekly hours configured / absent / **one weekday key only** / weekday-with-no-periods; venue Closed whole-day / part-day / multi-day / **`time_end <= time_start`**; venue amended inside / beyond / on a closed weekday / **empty periods** / **two overlapping blocks on one date** / multi-day spanning a closed weekday; calendar hours, breaks, leave full and **partial**, ad-hoc blocks, `days_off` **ISO date and weekday name**; **a walk-in with `allowDuringBreaks` on a column hosting a resource**; **a walk-in with `allowOutsideHours` on a partial-leave day**; **a resource with `availability_exceptions` read through both paths**; **an event ending after midnight**.
- Consumers asserted: appointment day engine, appointment month path, class engine, event engine, resource engine (via 0a's export), diary closure renderer, `unified-availability`, the group-session listing path, and the three `booking/create` gates **at helper level**.

**Scope limit, stated honestly `[R3-37]`.** `create/route.ts` is 2163 lines with **zero tests**, and the house route-test pattern mocks the engines out wholesale. Read/write agreement is therefore asserted against `venueWideBlocksRejectBookingWindow` and `validateExactAppointmentStart` **directly**. That does **not** catch *which* gate a route branch selects — which is precisely §1.2 item 14. **Non-goal, reviewed by hand in Stages 2 and 5.**

**Do not claim DST coverage `[AR-minor]`.** The resolver is wall-clock minute arithmetic. Note also that there are **three** date-to-weekday implementations (`engine.ts:56-58` server-local, `resource-booking-engine.ts:89-93` UTC, `venue-local-clock.ts:110-116` via `Intl` at 12:00 UTC, which is wrong for UTC+13/+14), so the diary can disagree with the engines about which weekday a date is.

**Exit:** the matrix reproduces every divergence in §1.2 as an explicit expectation. **Met:** tsc clean, lint 0 errors, **347 files / 3315 tests** green, of which **46 are the harness**.

Delivered, in `src/lib/availability/parity/`:
- `scheduling-world.ts` — one fixture type describing a venue + calendar + blocks world, with adapters feeding it to the appointment engine, class engine, event engine, resource engine, the venue resolver and the `booking/create` venue gate. Appointment fixtures deliberately route through `blocksToVenueOpeningExceptions`, because that adapter's lossiness *is* several of the divergences.
- `parity-matrix.test.ts` (23 tests) — ordered start-time lists per consumer. Ten assertions are labelled `DIVERGES` and pin a defect rather than a desired behaviour.
- `parity-read-write.test.ts` (18 tests) — the read/write pairs.
- `parity-group-sessions.test.ts` (5 tests) — `getEventClassSlots` driven through the Stage 0a fake.

**What the harness proved, rather than argued `[R3-64]`.** §2.7's worked example is now measured, not reasoned. Working 09:00–17:00, break 12:00–12:45, 60-minute service:

| Path | Offered starts |
|---|---|
| Appointments (veto) | 09:00, 10:00, 11:00, **13:00**, 14:00, 15:00, 16:00 |
| Hosted resource (subtract) | 09:00, 10:00, 11:00, **12:45**, 13:45, 14:45, 15:45 |

Every slot after the break moves. This is the single strongest argument for decision (A) and for ordered-list assertions, and it was a prediction until now.

**A correction to this stage's own stated property `[R3-65]`.** The instruction "the engine offers time T ⟺ the corresponding write gate accepts T" is **too strong in the reverse direction**, and a harness built to it fails on correct code. There are **three** write validators answering three different questions (`revalidate-appointment-slot.ts:58-66`): `grid` re-runs the engine and looks for membership, `exact` runs `validateExactAppointmentStart`, `interval` runs `validateAppointmentCustomInterval`. `exact` deliberately accepts **off-grid** starts, because a multi-service visit books them and a staff duration override books an arbitrary interval. The invariant that holds, and the only one asserted, is the **forward** direction: everything offered is accepted. Pair the right validator with the right read path.

**Coverage gap, stated rather than implied `[R3-66]`.** Four consumers this stage named are **not** asserted: the **appointment month path**, the **diary closure renderer**, `getUnifiedAvailableSlots`, and the **`booking/create` route branches**. The last is a declared non-goal (see the scope limit above). ⚠️ **This gap was due before Stage 4 and was not closed** — Stages 3 and 4 both changed code these consumers run, uncovered. It is now the first item of Stage 5; see the harness-debt table in the status block.

**Risk:** none beyond 0a's exports.

### Stage 1 — Standalone bugs. Each its own commit. ✅ DONE 2026-08-17

1. `unified-availability.ts:264` — add `special_event` to the block-type filter (`SA-M12`).
2. **`attachVenueClockToAppointmentInput` precedence `[R3-9]`.** Fill from the legacy JSON **only when `input.venueOpeningExceptions == null`**. Roughly three lines at `:148-152`. **Do not** implement v2's prescription of passing `venueBlocks` from fourteen call sites: all fourteen already hold a correctly block-derived list from their fetcher, so that change adds a duplicate `availability_blocks` round-trip per site — including one inside a per-practitioner loop (`waitlist-offer-availability.ts:121-129`) — for no behavioural gain. Deleting `venue_opening_exceptions` from the fourteen `venues` selects is separate cleanup.
3. `availability-blocks` PATCH — validate the **merged** stored row `[AR-10]`, reusing the fetch already at `:210-216`. Add `date_end >= date_start` and `time_end > time_start` to both schemas. Also parse a schema on `DELETE` (`:245-259` takes `body.id` raw) and stop skipping the conflict guard when the stored row is missing (`:216`).
4. Failure reporting — nine schedule reads moved from `console.warn` to `reportAvailabilityReadFailure`, across the class, event and resource engines plus `venue-wide-blocks-fetch.ts` (the fetcher behind `booking/create`'s venue gate, where a silent failure lets a booking through on a closed day rather than merely widening a listing). **The fourth tier is covered**: `attachHostCalendarsToResources` fails *closed* and silent, so every hosted resource goes unbookable with no signal.

   **Not done, and deliberately out of this item's scope `[R3-68]`:** the month picker discarding its venue-clock error. That is a client component in the diary, not a fetcher, and it belongs with the diary work in Stage 4 rather than with the engine reads. Six further `console.warn` reads remain in `calendar-session-blocks.ts`, `blocked-range-models.ts` and `appointment-catalog.ts`; they are catalogue and session reads rather than hours resolution, and are listed here so the gap is visible rather than assumed closed.
5. **Three `no-store` fixes `[R3-20]`** — apply the `SA-M9` remedy to `appointment-calendar/route.ts:95`, `class-instances/route.ts:88`, `resource-calendar/route.ts:110`. Without this the staging soak for every later stage is invalid.
6. Merge and dedup ranges (§2.2), fixing the duplicate-slot bug (§1.2 item 19).
7. Event end-time hardening on the **read** path only `[R3-67]`. `event-ticket-engine.ts` now treats `end <= start` as crossing midnight and, like the class engine, judges such an instance by whether its **start** falls inside an open range. Defensive cover for imported or hand-inserted rows, per §1.2 item 12.

   **v3's original instruction to apply "the same in `event-hours-vs-venue-calendar.ts:121`" was wrong and is not implemented.** That line is a *write* validator returning "End time must be after start time.", and it is precisely what enforces §2.2's rule that ResNeo does not support past-midnight windows. Making it wrap would not be hardening; it would silently add unsupported past-midnight event creation, contradicting §2.2 in the same document. Reads stay defensive about data that should not exist, writes keep preventing it. That asymmetry is deliberate and should survive.
8. **Close the `days_off` write surface** (decision G, `[R3-61]`). `/api/venue/practitioners:213` accepts `z.array(z.string())` with no validation of contents; tighten it to ISO dates only, and reject weekday names with a real error. Production is empty today (Q5), and this is what keeps it empty while Stages 2 to 5 stop expecting recurring entries. **Do this before Stage 5**, not alongside the contraction.

**Removed from v2's Stage 1.** Its item 6 ("`getEventClassSlots` — apply the same venue gate the create path applies") **would hide every out-of-hours class** `[R3-38]`, because `getEventClassSlots` serves both calendar types (`unified-availability.ts:244-246`). It is calendar-type-aware work and moves to Stage 5.

**Exit:** Stage 0b's matrix updates in the same commits. **Met:** all eight items shipped as eight commits; tsc clean, lint 0 errors, **3354 tests** green. The matrix caught item 6 and its expectation was updated in the same commit, which is the §5 mechanism working as designed.

**Two items were changed by contact with the code, and both are recorded above rather than silently adjusted:** item 7's write-validator half was **not** implemented, because it would have added the past-midnight support §2.2 says this plan does not add; item 4's month-picker limb moved to Stage 4, because it is a diary client component rather than a fetcher.

**Three production zeros now rest on Stage 1 code**, and all three expire if it is reverted: Q3 on item 3 (the merged-row validation), Q5 on item 8 (the `days_off` schema), Q9 on item 2 (the exception precedence).

### Stage 2 — The event read/write contract. The one atomic unit. ✅ DONE 2026-08-17

Ship alone, revert alone. Closes §1.2 items 16 and, for events, 7.

- Give `venueOpen` the discriminated result of §2.3 (`weekly` / `hours` / `closures` / `effective`).
- Repoint the event engine at `hours` with the `weekly-closed → allowed` rule (§2.6), **preserving today's carve-out**.
- **Delete `isWeeklyScheduleClosedForDate` in favour of the struct.** Do **not** "fix its guard in place" `[R3-59]`: `venue-wide-business-hours.ts:41` returns false the moment any block exists, and relaxing that so it returns true on a weekly-closed weekday regardless of blocks makes `event-ticket-engine.ts:109-124` fire even when the owner has posted an **explicit full-day closure**, putting events on sale on a day the venue deliberately shut. Only the struct path is safe, because §2.6's ALWAYS clause tests closure overlap independently of the weekly state.
- Align `booking/create:1039` and `:1307` with the read paths in the **same commit**. Read and write move together or the disagreement simply changes direction.

**Exit:** the weekly-closed-weekday fixtures for class and event show read and write agreeing, in both the listing and the create gate. **Met:** tsc clean, lint 0 errors, **353 files / 3368 tests**. `venue-wide-business-hours.ts` went from **2 tests to 14**, including the case the deleted helper got wrong.

**One refinement the matrix forced, on the first run `[R3-69]`.** `cause` is deliberately **not** `'weekly'` when an amended-hours row applies to the date. That row is the venue naming hours for that specific date, and until Stage 3 makes amended hours replace the weekly baseline the resolver cannot honour them — granting the allowance would have put an instance on sale at any hour while the venue had named a window. Scoping `cause` this way preserves today's behaviour for that shape exactly, which is what keeps Stage 2 atomic. **Stage 3 must revisit it:** once amended hours replace, the amended window becomes `hours` and the event is coverage-checked against it, so the `amended.length > 0` guard in the resolver should be removed in the same commit.

**Not needed after all.** The plan expected `booking/create:1039` to dispatch on `calendar_type`. It does not, yet: on a weekly-closed weekday decision (H) makes classes and events agree, so one instance gate serves both. The dispatch is genuinely Stage 5 work, for the out-of-hours-on-an-open-weekday case where classes are allowed and events are not.

### Stage 3 — One venue resolver. ✅ DONE 2026-08-17

- Amended hours replace rather than intersect, evaluated **before** the weekly short-circuit.
- **Carried from Stage 2 `[R3-69]`:** remove the `amended.length > 0` guard that scopes `cause` to `override`. Once amended hours replace, an amended row on a weekly-closed weekday produces `hours = ranges`, so the instance is coverage-checked against the venue's own stated window and the guard becomes both unnecessary and wrong. **Same commit as the replace change**, or the two contradict.
- **`venueOpen` gains `hours` and `effective`** (§2.3), completing the struct Stage 2 started. Slot generation anchors to `hours` and vetoes `closures` (`[R3-52]`); containment consumers keep using `effective`.
- **An Hours override with no valid periods is IGNORED, not a closure** (§2.2, `[R3-53]`). Q3 confirmed zero such rows on production, so this fires for nobody today; re-run Q3 immediately before merge.
- Part-day closures subtract on every path, including appointments.
- All applicable blocks combine, under decision **(E)**'s rule.
- `blocksToVenueOpeningExceptions` and `venueMinuteRangesForAppointmentDate` deleted; the appointment engine and month path call the shared resolver.
- **`service-custom-availability.ts:346-357`** adopts the shared picker `[R3-39]`. Its "keep in sync" comment points at a function this stage deletes, and it still carries the closure-beats-amended bug that `appointment-engine.ts:484` fixed.
- **`hours-change-orphans.ts`** starts reading blocks, or its warning is knowingly declared weekly-only in a comment `[R3-40]`.
- Remove the amber banner in `BusinessClosuresSection` **and the three help-centre passages that document the behaviour being reversed** `[R3-41]`: `getting-started.ts:49` ("a **Closure** always removes the whole day, even if you fill in the optional start and end times"), the "A whole day vanished" troubleshooting row, and the "Filling only one saves an entry with no hours" line, plus the `two-closures` and `closures-form` figures. Per `CLAUDE.md`, that copy is user-facing: plain second-person language, no em-dashes.
- Add a booking-conflict guard for `amended_hours` on POST `[R3-42]`: `CLOSING_BLOCK_TYPES` (`availability-blocks/route.ts:12`) excludes it, but under replace semantics an amended block narrows a day and can strand bookings exactly as a closure does.

**Prerequisite:** **Q3 returned zero rows on production (2026-08-17)**, so nothing needs repairing. The dependency that remains is ordering: **Stage 1 item 3 must have landed**, because the unrefined PATCH schema is what would let a new such row appear. Re-run Q3 immediately before merge. Q1 and Q2 are advisory and decide which venues to tell.

**Closes:** `SA-H2`, `SA-M1`, §1.2 items 1, 2, 3, 8, 22, 23.

**Behaviour changes owners will notice**, all intended:
- A part-day closure narrows the appointment day instead of removing it. **The remaining slot times keep their grid alignment**, because closures are vetoed rather than subtracted at slot generation (§2.1, `[R3-52]`). Without that, a 12:00–12:45 closure would move the afternoon from 13:00/13:30 to 12:45/13:15 and `validateExactAppointmentStart` would 400 on previously-bookable times.
- Amended hours open a normally-closed weekday for classes, events, resources and the diary.
- Amended hours extending beyond weekly hours are honoured everywhere.

**No change fires for empty-period amended blocks**, because Q3's rows are repaired before this stage (§2.2, `[R3-53]`).

**Met:** tsc clean, lint 0 errors (104 pre-existing warnings, none in touched files), **353 files / 3368 tests**. Shipped as five commits.

**Three things found by implementing it `[R3-70]`:**

1. **A whole-day closure must still DROP the calendar**, not return it with an empty slot list. Vetoing closures uniformly left staff listed with no times on a fully closed day. Only a part-day closure reaches the veto; `venueAnchorRangesForDate` returns `[]` when the resolution is `closed`.
2. **The venue-closure veto belongs INSIDE the `allowOutsideHours` gate.** A venue closure is an `hours` rule staff can deliberately book through today; leave is `hard` and stays checked above it. Putting the veto in the wrong place would have quietly changed what staff can do, which §8 promises this plan does not.
3. **The decision (E) tie-break must not fall back to `id`.** Doing so makes a genuine tie impossible and picks a winner at random between two overrides an owner saved for the same date. `created_at` only, then union.

**Two items were smaller than the plan expected, and one was larger.** The `two-closures` and `closures-form` figures needed no edit: they describe closure *scope*, which this work does not change. The `service-custom-availability` fix, by contrast, exposed that the whole service-summary surface is fed the **legacy JSON** rather than `availability_blocks`, so it has never seen a real closure. It now resolves through the shared function, but pointing it at the right data source is a dashboard fetch change and is **added to Stage 4**.

**The `amended_hours` booking-conflict guard was extended, not just added.** It checks the **complement** of the override periods, because a closure asks what is covered and an override asks what is no longer covered.

### Stage 4 — Diary and month geometry. ✅ DONE 2026-08-17

A stage, not a bullet: five client components need a new data dependency, three call sites are out of scope, and persisted UI state can defeat the whole fix.

**v2's example does not reproduce and must be replaced `[R3-43]`.** On a weekday with no periods, `getCalendarGridBounds` hits `periods.length === 0` and returns the 07:00–21:00 fallback (`venue-calendar-bounds.ts:145-147`), so the stripe renders. An implementer testing the stated case concludes the stage is unnecessary. The real breakages:

1. Amended hours **outside an open weekday's bounds** — weekly 09:00–17:00 amended to 20:00 gives bounds of 09:00–17:00 and the stripe is clipped (`schedule-closure-blocks.ts:275-279`).
2. The **month grey-out** is weekly-only and blind to blocks (`MonthScheduleGrid.tsx:93` → `getVenueBusinessDayStatus`, `venue-calendar-bounds.ts:36-63`). This is the claim that stands as written, and Stage 2's discriminated struct is what makes it fixable.
3. Day view's auto-expansion (`PractitionerCalendarView.tsx:3030-3063`) is **circular** — it widens bounds to cover blocks that were already clipped to the old bounds — and is gated `if (viewMode !== 'day')`, so **week view never expands at all**.

**Carried in from Stage 3 `[R3-70]`.** The **service-availability summary** now resolves through the shared function but is still fed the legacy `venues.venue_opening_exceptions` JSON, parsed client-side in `AppointmentServicesView.tsx:312`, so it has never seen a real closure or amended-hours row. Point that view at `availability_blocks` and drop the conversion in `ServiceAvailabilityCalendar.tsx`. It is a dashboard fetch change, which is why it belongs here rather than in Stage 3.

**Also carried in from Stage 1 `[R3-68]`:** the month picker discarding its venue-clock error. It is a diary client component, not a fetcher, so it did not belong with the engine reads.

**Method:** `getCalendarGridBounds` gains an **optional** `venueWideBlocks` parameter defaulting to today's behaviour, so the three restaurant call sites (`TableGridView.tsx:1692`, `FloorPlanLiveView.tsx:395`, `:468`) are **provably untouched** `[R3-44]`. Of the ten call sites, `PractitionerCalendarView` already fetches blocks (`:2536`, `:3382`) and `schedule-closure-blocks.ts:223` already receives them; three are the exempt restaurant sites. **Five** client components need the new data dependency: `AppointmentBookingsDashboard.tsx:477`, `BookingsDashboard.tsx:455`, `DaySheetView.tsx:507`, `StaffScheduleHub.tsx:50`, `StaffScheduleMergedDayGrid.tsx:102` `[R3-55]`.

**Acceptance criteria v2 omitted:** drag-and-drop bounds clamp move validity, so staff still cannot drag into an amended window until this lands; the persisted `startHourOverride`/`endHourOverride` wins over derived bounds, so an owner who once pinned 09:00–17:00 never sees amended hours regardless of the fix; scroll reset keys on `startHour, endHour`.

**Met:** tsc clean, lint 0 errors, **354 files / 3377 tests**. Shipped as three commits, and **verified in the running app** against the staging venue, which already carried the fixtures.

| Date | Data | Before | After |
|---|---|---|---|
| 16 Sep 2026 | amended 09:00–11:00, 15:00–17:00 | grid 09:00–**22:00** | grid 09:00–**17:00**, stripes visible |
| 28 Aug 2026 | whole-day closure | month said **Open** | month says **Closed** |
| 17 Aug 2026 | no blocks | 09:00–22:00 | unchanged |

**The finding no test could have caught `[R3-72]`.** Part 1 made `getCalendarGridBounds` resolve correctly and **changed nothing on screen**. `buildVenueScheduleClosureBlocks` generates the Closed and Amended stripes *from* the bounds, those land in `displayBlocks`, and the day-view auto-expansion then widened the grid to cover every one of them — so the generated "Closed 17:00–22:00" stripe dragged the grid straight back out to 22:00. An output cannot be an input. v2 predicted this as breakage 3 and called it circular; it is exactly that, and it exists only in the component's data flow, which is why the unit tests were all green while the screen was wrong.

**The persisted-override hazard did not fire here.** The staging venue has no stored calendar preference, so the From/Until control was merely displaying the derived bounds and now reads 17:00. The hazard remains real for a venue that has pinned hours, and is **not** addressed by this stage.

**What was NOT verified in the browser, stated rather than implied.** The appointments nav carries no day-sheet or table grids, so `DaySheetView`, `BookingsDashboard` and `AppointmentBookingsDashboard` were covered by types and unit tests only. The service availability summary renders only behind the custom-schedule toggle, and enabling it showed the service's own empty schedule rather than the venue layer, so that path was not isolated either. Nothing was saved to the venue.

### Stage 5 — One calendar resolver. ✅ DONE 2026-08-18

**✅ Harness debt cleared 2026-08-18** — 3 files, 32 fixtures, and two live defects found in the diary renderer (see the status block). **Every item below is now done**; the corrections each one forced are recorded inline.


- ✅ **DONE 2026-08-18.** `calendarHours` / `calendarBreaks` / `calendarBookableSegments` / `calendarDayOff` in `src/lib/availability/calendar-hours.ts`, 21 tests. Six working-hours and four break implementations collapsed onto it (appointment engine, resource engine, event-hours validator). `event-hours-vs-venue-calendar` repointed at `calendarBookableSegments`, not `calendarHours`, so decision (D)'s break clause survives.

  **Two corrections to §2.4, both load-bearing `[R3-75]`:**

  1. **`days_off` is an HOURS rule, not a closure.** §2.4 listed it under `calendarClosures`, which is tagged `hard` and skippable by nothing. It sits inside the `allowOutsideHours` gate today, so making it `hard` would have stopped staff booking a walk-in on a calendar's day off — a change §8 promises this work does not make. Leave remains the only `hard` calendar rule and is deliberately checked *outside* this module, exactly where it is now.
  2. **`calendarClosures` and `calendarAdHocBlocks` are not built as functions.** There is no honest source for a calendar-closure set distinct from leave, and ad-hoc blocks already reach the engine as `practitionerBlockedRanges`. Inventing wrappers with no callers would have been shape without substance. If Stage 6a's `calendar_date_overrides` lands, that is when a real `calendarClosures` gains a source.
- ✅ **DONE 2026-08-18.** Breaks are vetoed per candidate in the resource slot loop **and** the exact-start validator; `resourceRangesForHostProjection` keeps subtracting. The parity matrix's flagship `DIVERGES` fixture became a `CONVERGED` one on the first run: both engines now answer `09:00, 10:00, 11:00, 13:00, 14:00, 15:00, 16:00` where the resource engine used to re-anchor to `12:45, 13:45, 14:45, 15:45`. The `allowDuringBreaks` guard is asserted directly — the own grid keeps the break inside its range, the projection carves it out.
- ✅ **DONE 2026-08-18.** The host routes through `calendarHours`, and host **leave and ad-hoc blocked time** are now loaded and vetoed per candidate — the engine previously read neither table, so a room on a stylist's column sold straight through their holiday (§1.2 item 5). The venue layer was **already** applied in `buildResourceEngineInputFromParts`; v2's model text claimed `hostedResourceOpen` dropped it, which was true of the prose and not of the code.
- ✅ **DONE 2026-08-18.** Classes are gated by closures only, on read and write, via `classInstanceRejectBookingWindow`. Events do not take the carve-out (decision B) and their side was already done in Stage 2.

  **This widens class availability in two ways, both intended `[R3-76]`:** an unrelated closure elsewhere in the day no longer changes the rule (§1.2 item 7, class half), and **amended hours no longer hide a class at all**. An Hours override constrains slot generation; a class is a fixed time staff scheduled deliberately, which is why the weekly baseline never hid one either. Two existing tests asserted the old behaviour and were updated with the reasoning.
- ✅ **DONE 2026-08-18.** `class-schedule-availability-conflicts.ts` step 1 rewritten to the class gate. Its **break** refusal survives untouched, which is what decision (C) actually asked for — (C) meant "keep the break refusal", not "keep the function unchanged".
- ✅ **DONE 2026-08-18** in part 1. Repointed at `calendarBookableSegments`, so decision (D)'s "it cannot overlap a break" clause survives; `calendarHours` would have deleted it silently.
- ✅ **DONE 2026-08-18.** `unified-calendar-mapper.ts` carries `availability_exceptions`, so a resource's per-date override resolves identically on the `/book` and unified paths (§1.2 item 21).
- ✅ **DONE 2026-08-18.** **Made the write-gate split three-way.** Stage 2 already created `scheduledInstanceRejectBookingWindow` and repointed `booking/create:1039` and `:1307` at it, which is the two-way split; resources keep `venueWideBlocksRejectBookingWindow`. What remains is the third rule: `:1039` must load `calendar_type` alongside the session row (it currently selects only `capacity, name`) and apply the **class** rule on a `class` column and the **event** rule on an `event` one. Stage 2 did not need this because decision (H) makes the two agree on a weekly-closed weekday; they diverge on the out-of-hours-on-an-open-weekday case (§2.6).
- ✅ **DONE 2026-08-18.** `getEventClassSlots` applies the **class** gate on a `class` column and the **event** gate on an `event` one, the same dispatch `booking/create` makes. It applied no venue gate at all before, which is §1.2 item 15. The fixtures assert the divergence directly: the same 19:00 session is hidden on an event column and listed on a class column.
- ❌ **The predicted new refusal did NOT happen, and item 24 stays open `[R3-78]`.** v3.0 said event creation on a staff leave date would start failing as a side effect of this stage. It did not, and could not: correction 1 above keeps leave **outside** the calendar-hours module, so `calendarBookableSegments` reads `working_hours`, `break_times`, `days_off` and `availability_exceptions` and still never reads `practitioner_leave_periods`. The asymmetry is now explicit and worth stating plainly: **class creation checks leave** (`calendar-event-window-conflicts.ts` routes through `findClassScheduleWindowAvailabilityConflict`, whose comment names closures, leave, days-off and breaks), **event creation does not**. Closing it is a deliberate one-line change to the event validator under decision (D), not a by-product of a refactor — scheduled below, not silently assumed.
- `days_off` keeps being **honoured** for both its semantics (ISO dates and weekday names), read-only. Decision (G) converts weekday names into weekly working hours, and Q5 confirms there are none on production to convert — but the engines must keep reading it until Stage 6b, because Stage 1 item 8 is the only thing standing between the mobile API and a new entry.

**Closes:** §1.2 items 5, 6, 10, 14, 15, 21, and the **class half** of item 7 (its event half closed in Stage 2).

**Met:** tsc clean, lint 0 errors, **361 files / 3470 tests**. Shipped as five commits plus the harness debt.

**Behaviour changes owners would notice**, all intended and all latent per Q0 (zero resource, class and event calendars in production):
- Resource slot times move where a host has breaks: they now match the appointment grid instead of re-anchoring after each break.
- A class is no longer hidden by amended hours, nor by an unrelated closure elsewhere in the day.
- A 19:00 group session on an **event** column stops being listed at a venue that closes at 17:00; on a **class** column it stays.
- A hosted resource stops selling through its host's leave and blocked time.

### Stage 6 — Data model and write surface.

**Split into 6a (expand) and 6b (contract), which is not optional** `[R3-45]`. The standing deploy ritual applies migrations to production **before** merging the code, so production runs old code against the new schema for the whole window. A `DROP COLUMN` in that window is not a degradation, it is a `42703` and the route 500s. `resource-booking-engine.ts:981` selects `id, working_hours, days_off, break_times, break_times_by_day` explicitly, so dropping either column **takes the entire resource booking engine down**. Three more single-line explicit selects break the same way: `venue/practitioners/route.ts:110`, `venue/resources/route.ts:201`, `class-schedule-availability-conflicts.ts:197` `[R3-56]`.

**Stage 6a — expand only.** ⏳ **PART DONE.** The migration, the dual-write and the item 24 fix are all shipped; **the write-surface consolidation is the whole of what remains**, plus production's catch-up run. The migration was written and pushed to `origin/staging` (`20270114120000_calendar_date_overrides.sql`, 2026-08-18) with all nine RLS/grant artefacts, the leave backfill, and three pgTAP assertions (plan 18 → 21).

**✅ Executed and verified, 2026-08-18.** CI's `rls-pgtap` job passed on the introducing commit (run `32182208996`, against a local Supabase built from the migrations), and the operator pushed it to **staging**, where the verification block returned exactly the expected posture: `SELECT` only for `anon` and `authenticated`, 8 overrides against 8 leave rows, and **nothing left behind** (8 distinct `source_leave_id` values against 8 leave rows accounts for every one). It was never run locally, as there is no Docker in the working environment.


**`[R3-77]` was INVERTED and is corrected here `[R3-80]`.** It claimed the ritual deploys *code before* the migration, and that the dual-write would therefore hit a missing table. **The ritual is the other way round**: migrations are applied to production by hand at step 4, and `staging` merges into `main` at step 5. The table exists in production *before* any code that reads it arrives, so the missing-table window it described does not exist. The hazard that IS real is the one the Stage 6 header already states and the one this migration is expand-only to avoid: production runs **old code against the new schema** for the length of that window, which is safe for an added table and fatal for a contraction.

**The dual-write should still be fail-soft, for a different and better reason.** `calendar_date_overrides` is a secondary mirror until Stage 6b; `practitioner_leave_periods` stays authoritative. A write to a mirror must never be able to fail the primary write path a venue is actually depending on, so it reports and continues rather than throwing. That argument does not depend on deploy ordering and holds in every environment, including a developer's machine with the migration unapplied.

**Operator steps, all completed 2026-08-19:**
1. ✅ `supabase db push` to **staging**, and the migration's verification block run against it: grants returned `SELECT` only for `anon` and `authenticated`, 8 overrides against 8 leave rows, nothing left behind.
2. ✅ CI's `rls-pgtap` job green on the introducing commit.
3. ✅ Production `db push`, then `staging` merged to `main`, then staging reset. Q3 was re-run against production first and returned zero rows.
4. ✅ **Production permissions verified 2026-08-19.** `npm run check:function-grants` against production (`njualfobtudvlugqkqho`) returned **PASS, 13 of 13 allowlisted**, with no `UNEXPECTED` and no `MISSING`. The table grant query, run separately against production, returned `SELECT` only for `anon` and `authenticated`. Both were required because hosted grants are not reproduced by migration history and the two checks are independent: the script inspects **function** EXECUTE grants, the query inspects **table** privileges. The script prints the project ref it connected to, which is what confirms a shell override actually beat `.env.local` rather than silently falling back to staging.

**Then the rest of 6a**, in this order. The table now exists in the migration, so what follows is code:

1. ✅ **DONE 2026-08-19. Fail-soft dual-write** in `src/lib/availability/calendar-date-overrides-mirror.ts`, wired into all four write points of `practitioner-leave/route.ts` (two inserts, the update, the delete), 15 tests. `practitioner_leave_periods` stays authoritative. **`mirrorLeaveUpdate` inserts when no mirror row matched**, so a row lost to an earlier fail-soft failure is repaired the next time anyone edits that leave period, which is why no reconciliation job is scheduled. Live-checked on staging: POST 201 and PATCH 200 against the real table.
1b. ⚠️ **REQUIRED CATCH-UP RUN, once per environment, after the dual-write is live there `[R3-82]`.** The migration's backfill is a **point-in-time snapshot** and the mirror only covers writes from the moment it ships. Leave created in the window between the two is invisible to both, permanently, until someone re-runs the backfill. **Found on staging: 9 leave rows, 8 mirrored, one created after the migration and before the dual-write.** The window on production is still open and widening, because production took the migration on 2026-08-19 and the dual-write has not merged yet.

  The migration's `INSERT ... SELECT` is idempotent by construction (`WHERE NOT EXISTS` plus the partial unique index on `source_leave_id`), so the repair is to run that exact statement again against each environment **after** the dual-write is deployed there. Running it before merely re-opens the same window.

  **✅ Both environments caught up 2026-08-19, and Stage 6a's data work is complete.**
  - **Staging:** one row, a 12:00 to 12:45 partial leave on 2026-09-15 created at 20:37 UTC on 18 August, after the backfill. Now 9 leave rows, 9 mirrored.
  - **Production:** one row, predicted exactly by the dry-run count and picked up after the merge deployed. Now **7 leave rows, 7 mirrored, 0 orphans, invariant 0**. The two environments have different populations; do not carry a count from one to the other, which is a mistake made once in this session.

  **Leave is the only part of the composition model with live production data** (7 rows across real venues). Amended hours have never been used, and there are no resources, classes or events. It is therefore the one place a resolver or editor regression can reach a real venue today, which is worth weighing when sequencing the write-surface work below.

  **Verify with the invariant, not the counts:** `leave_without_mirror` must be 0 ignoring rows that are legitimately unmirrorable (no matching `unified_calendars` row, or an inverted time pair). Counts alone cannot distinguish "never inserted" from "inserted then deleted".

  **A comment in the applied migration is misleading and the SQL is right `[R3-83]`.** The defensive clause says an inverted time pair is copied "as a whole-day closure instead"; the `AND (...)` predicate **skips** such rows. The behaviour is correct and deliberate, and the file is applied to both environments, so it is not being edited. Recorded here so the next reader trusts the SQL over the comment.

2. ✅ **DONE 2026-08-19. §1.2 item 24 closed** in `src/lib/experience-events/event-leave-conflict.ts`, 12 tests.

  **The shared helper alone would have missed the thing being asked for `[R3-81]`.** `validateEventCalendarPlacement` covers only the two PATCH paths; **event CREATE validates hours inline** in `experience-events/route.ts` POST, because it builds many dates from one payload and fetches the venue and calendar once for all of them. Adding the check to the helper and stopping would have fixed editing an event onto leave while leaving creating one straight onto leave untouched. Both paths now carry it, and the POST path fetches leave once for the whole create range.

  Four fixtures assert events and classes returning the **same verdict** on the same windows, which is the actual defect: one venue, two answers. Refusal is 400, not 409: leave is a property of the calendar, like hours, not a collision with another booked item.
3. **One weekly-hours editor replaces three** — specified as decision (K) below — and **one date-override editor replaces the venue closure editor and the leave panel**.

  **Decision (K), taken 2026-08-19: one shared component, two locations, no period cap.**

  v3.3 and earlier said "one editor replaces three" and never said *where*, which left the most consequential half of the work unspecified. The three today are `OpeningHoursControl` (**venue** hours, in Settings and onboarding), `WorkingHoursControl` (**calendar** hours, in `/dashboard/availability`, onboarding and `ServiceCustomAvailabilityEditor`) and the inline editor in `resource-timeline-ui` (**resource** hours, in `/dashboard/resource-timeline`).

  **One component, but NOT one page.** Venue hours and calendar hours answer different questions: *when is the business open* versus *when does this person or room work*. They **compose**, and a calendar cannot sell outside venue hours. Collapsing them onto one surface would hide the relationship this entire programme exists to make correct, and would invite a venue to believe editing one edits the other. So:
  - **Venue hours stay in Settings.** Set rarely, usually once at onboarding.
  - **Calendar and resource hours merge into `/dashboard/availability`**, retiring `/dashboard/resource-timeline`'s inline editor. Three pages becomes two.
  - **The calendar editor shows the venue's hours as read-only context**, so setting hours outside them is visible at the point of editing rather than discovered later as a missing slot.

  **No period cap anywhere.** Today `OpeningHoursControl` renders `periods[0]` and `periods[1]` and **cannot display a third**, while the other two are unlimited. The cap is also enforced server-side at `config-schemas.ts` `openingHoursDaySchema` (`.max(2)`), which is what stops the truncation becoming data loss today: a third period cannot be stored, so opening Settings and saving cannot silently drop one. **Relaxing it is contained**, verified 2026-08-19: `/api/venue/opening-hours` is the only writer of `venues.opening_hours`, the only consumer of that schema, and **nothing outside the editor indexes `periods[1]`**. The resolver unions any number of periods already. A venue with a genuine third window (morning, afternoon, evening) can then express it.

  **Order of work, so the risky part lands last:** (1) relax `.max(2)`; (2) render N periods; (3) repoint `OpeningHoursControl`; (4) repoint `WorkingHoursControl`; (5) move resource hours into `/dashboard/availability` and retire the inline editor; (6) add the read-only venue-hours context. Steps 1 to 4 are invisible to a venue. **Step 5 is the first user-visible navigation change in the whole programme.**

  **✅ Steps 1 to 4 done 2026-08-19.** `src/components/scheduling/WeeklyHoursEditor.tsx` is the shared editor; `OpeningHoursControl` and `WorkingHoursControl` are now thin adapters that own only their storage shape. Those shapes genuinely differ, which is why the editor normalises rather than either format migrating: venue hours are `{ closed: true } | { periods: [{ open, close }] }` **plus a legacy single `{ open, close }` that still has to be read**, calendar hours are a bare `[{ start, end }]` where an **absent key** means not working. `toWorkingHours` keeps deleting the key rather than writing `[]`, because callers persist the object as-is and the two are not the same stored value. Day order and per-screen wording ("+ Add period" against "+ Add split") are props, not forks.

  **Verified end to end on staging, not just rendered:** both screens display correct stored values, and after a real save through the rewritten venue editor the guest slot lists are **identical to those measured before any of this work existed** (Tuesday 32 slots ending 17:30, Wednesday ending 21:30). Editor to database to resolver to guest page, lossless.

  **✅ Step 5 done 2026-08-19, and it was NOT what the plan assumed `[R3-86]`.** Two corrections:

  1. **Resource hours are already `unified_calendars.working_hours`.** `/api/venue/resources` only ALIASES the column as `availability_hours` (`resources/route.ts:281` reads `row.working_hours`, `:593` writes it); the `venue_resources.availability_hours` column was migrated away by `20260502120000`. So there was no data to move. What was missing was simply that `/dashboard/calendar-availability` **filtered resource calendars out of its picker**, which is what forced a second editor on the same column to exist elsewhere. Resources now appear there, for hours, breaks and closures alike, matching decision (L).
  2. **The `resource-timeline` editor could not be retired.** It is step 5 of the resource CREATION wizard, not a standalone duplicate, and it carries a "Match selected calendar hours" control the shared editor has no reason to know about. Removing it would mean a resource could not be given hours until after it existed. It is now a **shell around `WeeklyHoursEditor`** instead: the toggle and its per-day `onChange` contract stay local, everything else is shared. Three editors, one implementation.

  **A bug this introduced, found on staging and fixed `[R3-87]`.** Making resources selectable was not enough: the selection is recomputed after every save from a pool that still excluded them, so a selected resource silently fell back to the first staff calendar. The screen looked untouched, and the next edit landed on the wrong calendar. **Saving what appeared to be Room 1's Friday hours rewrote Andrew's**, from 09:00-22:00 to 09:00-18:00. Caught by reading the PATCH body, not by looking at the UI; restored immediately and verified against the values captured earlier in the session. The rule is now in `src/lib/calendar/pick-schedule-calendar.ts` with 9 fixtures, because an inline `setState` callback inside a fetch handler is not somewhere a bug can be pinned: **keeping** a selection considers every calendar, **choosing a fresh one** still prefers a staff calendar.

  **✅ Step 6 done 2026-08-19, and decision (K) is complete.** The prose explainer stays; each day now also shows the venue's ACTUAL hours beside the calendar's, and says when the calendar's fall outside them. `src/lib/calendar/venue-hours-context.ts`, 17 fixtures.

  **The interesting half is the warning, not the display.** Hours set outside the venue's are not rejected and are not an error: they simply never become bookable, which is the most confusing possible outcome because nothing anywhere said so. Deliberately **no clamping on save** — the venue layer already decides what sells, and silently discarding the setting would throw away something a venue wants back the moment its opening hours widen.

  Two distinctions the arithmetic has to keep: **`unset` is not `closed`** (a venue that has never set opening hours imposes no constraint, so warning it would be wrong and alarming), and a calendar period spanning the **gap between two venue windows** is outside them while one spanning two contiguous windows is not.

  **The diary column header was showing the wrong number, and now agrees with its own grid `[R3-88]`.** Asked whether the calendar page shows bookable hours correctly, and it half did: the **grid** was right (09:00 to 18:00 on that Tuesday, correctly stopping at the venue close) while the **column header beside it** printed the calendar's raw `09:00–22:00`. Two halves of one screen disagreeing, and the header is the only place stating hours as numbers, so staff reading it would reasonably believe a 19:00 appointment was possible. **Pre-existing, not introduced by this work.**

  `formatWorkingHoursLineForDate` now takes optional venue ranges and reads `09:00–18:00 (calendar 09:00–22:00)`, staying terse when the two agree. **Passed for native columns only:** linked columns belong to another venue with its own opening hours, and constraining them by this venue's would be actively wrong. Closures are deliberately not subtracted, since a part-day closure would fragment the line and the grid already draws the stripe. Verified on staging across three cases: the divergent Tuesday, a Wednesday where the two agree (no bracket), and the same Tuesday under an `amended_hours` block, where the header correctly followed to `09:00–21:00` rather than the weekly 18:00.

  **It fired on real staging data at once.** The venue closes at 18:00 on Tuesdays while both staff calendars are set to 22:00, so four hours every Tuesday have never been bookable and nothing had ever said so. That is the defect class this step exists for, found the moment it was switched on. `GET /api/venue/opening-hours` was added for it (read-only, not admin-only: anyone who can see a calendar's hours needs the context to read them, and it exposes nothing the public booking page does not).
4. **Decision (L), taken 2026-08-19: date overrides mirror (K) exactly, on the same two pages.**

  - **Venue date overrides** (closures, amended hours) **stay in Settings**, next to venue hours. `settings/sections/BusinessClosuresSection.tsx` is already there.
  - **Calendar and resource date overrides merge into `/dashboard/availability`**, next to calendar hours: one component replacing `availability/StaffLeaveCalendarPanel.tsx` and `resource-timeline/ResourceExceptionsCalendar.tsx`.

  **Why the same axis and not a single "date overrides" page.** The current layout already works this way, so following it means no venue relearns where anything lives. It keeps one axis across the whole rebuild, leaving each page complete for its subject rather than making a venue ask whether closures are a Settings thing or a Dates thing. And it **finishes retiring `/dashboard/resource-timeline`**: (K) moves its hours editor, this moves its exceptions calendar, so the page goes rather than lingering with one orphaned panel. The rejected alternative was one "what is different on a specific date" page holding venue closures and staff leave together; it reads well, but it cuts across the venue/calendar distinction this programme exists to make explicit. If the two-trip problem proves real, a shortcut between the pages is the cheaper fix, and the diary's quick-add already offers both.

  **✅ Partly done 2026-08-19, and the resource half is BLOCKED, not forgotten `[R3-89]`.**

  **Done:** the duplicated choice is gone (item 5 below), and `StaffLeaveCalendarPanel` already used `ResourceExceptionsCalendar` internally, so the "one component" half of (L) was structurally true before this stage began. Venue closures stay in Settings as specified.

  **Blocked: resource date overrides cannot merge here yet.** Wiring resources into the closures picker produced a control that appeared to work and then failed: `POST /api/venue/practitioner-leave` returns **404 "Calendar not found"** for a resource, because `requireVenueHostCalendarId` filters `calendar_type = 'resource'` deliberately. Relaxing that would be worse than the 404, because **nothing would read the row**: `fetchHostUnavailableWindows` is called with HOST calendar ids only, so leave stored against a resource is invisible to every engine. That is a setting which saves and does nothing, the exact defect class this programme exists to remove. Reverted, with the reasoning in the code beside the prop.

  **The same applies to breaks, from step 5 `[R3-89]`.** Step 5 put resources on the hours, breaks and closures tabs together. **Hours are genuinely supported** and were verified end to end (the engine reads resource `working_hours`; an edit propagated and read back through the resources API). **Breaks are not:** the resource engine reads `break_times` from the host row, never the resource's own. The breaks tab now says so for a resource rather than offering a control that silently does nothing.

  **CORRECTION 2026-08-19 `[R3-94]`: this is not an engine gap, and calling it one was wrong.** Resources already have a working per-date override mechanism of their own: `unified_calendars.availability_exceptions`, written through `/api/venue/resources` and genuinely read by `getBaseResourceAvailabilityRanges` (`resource-booking-engine.ts`). It expresses `{closed:true}` for a whole day and `{periods:[...]}` for different hours that day, and two periods express "blocked in the middle" perfectly well. **A room can already be closed for a date, and the engine honours it.**

  So the remaining gap is **consolidation, not capability**: staff closures live on one screen and resource closures on another, which is what (L) set out to fix. The earlier finding stands but was narrower than it read — what no engine reads for a resource is `practitioner_leave_periods` and the resource's own `break_times`, which is why wiring the shared panel at those tables would have produced a setting that saves and does nothing.

  **The work, when it is worth doing, is an ADAPTER not engine support:** when the selected calendar is a resource, point the date-override panel at `availability_exceptions` instead of the leave table. Teaching the engines to read leave for resources would be the larger job AND would duplicate a mechanism that already works, so it is the wrong branch to take.

  **Priority: low.** Production has zero resources, and the venue that does have one can already do everything it needs on the resource screen.

  **The diary keeps its quick-add.** `PractitionerCalendarView` can already create closures and leave. That is a shortcut from where the problem was noticed, not a home for the setting, and it stays.

5. **Fix the "Closure vs Unavailable window" options** that write byte-identical rows. **This is internal to the leave panel, not an IA problem `[R3-84]`.** `StaffLeaveCalendarPanel.tsx:471` offers `Closure` and `Unavailable window`, and its own helper text concedes the overlap: "Closure blocks the whole day **unless you add optional times**." Adding times to a Closure produces exactly an Unavailable window, and both write the same two columns of `practitioner_leave_periods`. **One control, times optional, blank means all day** — which is what the data model already says. `ResourceExceptionsCalendar.tsx:195` carries the same wording and is absorbed by (L).
6. ✅ **DONE 2026-08-19. Validation parity between POST and PATCH** `[R3-90]`. The real gap was on `practitioner-leave` PATCH: the date-order check fired only when the patch carried **both** dates, so sending `end_date` alone could move it before the stored `start_date`. POST validates a complete row because it always has one; PATCH now merges over what is stored and validates that, which is what parity means. **The half-set time pair was already guarded** by a pre-existing check, contrary to first appearances, and is recorded here so nobody claims credit for it twice.

  **A hazard this nearly introduced.** Validating the merged pair unconditionally would have rejected any patch to an unrelated field on a row whose stored pair is already invalid, so a legacy half-set row could never have its notes or dates corrected. Refusing to let someone repair bad data because the data is bad is the wrong trade; the check now applies only when the patch touches the times. Verified against the live API: partial date patch 400, notes-only patch 200.

7. ✅ **DONE 2026-08-19. "Apply to all calendars" for breaks.** A lunch break is nearly always the same across a team and had to be retyped per calendar, which is how two calendars come to disagree by a typo nobody notices. The leave panel has had `apply_to_all_active` all along; breaks now have the equivalent. It **confirms first** since it overwrites, is hidden when there is nothing else to write to, and **excludes resources** for the reason in `[R3-89]`. Written one PATCH per calendar because the route takes a single id, so the count reported is what actually succeeded rather than what was attempted. Verified on staging: exactly the two staff calendars were patched and the resource was not.

Items 3 to 6 are the write surface and are the **largest remaining block of work in the whole programme**; items 1 and 2 are small and independently shippable. **Leave every old column and table in place throughout** — contraction is 6b.

**Stage 6b — contract, a separate pass of the full ritual**, only after 6a is live on production and soaked. **No `DROP COLUMN`, `DROP TABLE`, new `CHECK` or new `NOT NULL` may share a migration with the code that stops using it.** Before every contraction: `create table _archive_<name>_20260817 as select * from <source>`, retained one release cycle, plus a confirmed PITR window on both projects. Only tier 1 and tier 2 items are eligible, and only after their prerequisites in §1.3.

**RLS and grants for `calendar_date_overrides` `[R3-46]`.** v2 said nothing. Nine artefacts are required, modelled on `practitioner_leave_periods` (`20260428120000:27-47`) and `20270113120000`: enable RLS; a staff `FOR ALL` policy with no `TO` clause; a `service_role FOR ALL` policy (**without it the table is unreachable by the app**); `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER FROM anon, authenticated` then `GRANT SELECT`; **no `TO anon` SELECT policy**; add to `local_baseline_grants.sql`; add to `truncate_app_data.sql`; add pgTAP assertions; and if the diary subscribes, add to `supabase_realtime` **keeping the SELECT grant**, whose removal fails silently.

**Verify grants on the hosted projects, not from the migrations.** Hosted Supabase grants `anon`/`authenticated` a full default privilege set through project-level defaults that live outside this repository, and table privileges are checked **before** RLS, so a local pgTAP pass proves nothing. Run `20270113120000`'s verification query against staging and production **separately** after each push, plus `npm run check:function-grants` per environment.

### Stage 7 — Fail closed (`SA-C3` proper). ✅ **COMPLETE, 2026-08-19.** All five guest availability routes fail closed, on one shared rule.

`loadScheduleContext`, the third `unavailable` state, HTTP 503 with `Retry-After`, a retry card in the booking UI. Independent of everything above and the only stage touching the guest booking UI.

**⏳ IN PROGRESS. The mechanism is built and proven; the guest UI and the remaining routes are not.**

**Done 2026-08-19:**
- `schedule-read-context.ts` collects, per request, every schedule read that failed open. **It hooks the reporter all 44 fail-open sites already call**, rather than threading a return value through 11 files: the diff would have been enormous and its real risk is the one site someone forgets, silently keeping the old behaviour exactly where it matters. The `node:async_hooks` import lives in this module and registers a listener, because the engines reach browser bundles and a static Node import would break them.
- `schedule-unavailable-response.ts` returns **503 with `Retry-After: 15` and `no-store`**, not 500: this is temporary and retrying is right, which is what 503 means. The body carries `unavailable: true` and the failing table names, and deliberately **no venue or calendar ids**, since it reaches an unauthenticated guest.
- `/api/booking/unified-availability` uses both. **Proven end to end on staging** by injecting a failure deep inside the engine: the route returned 503 with the right headers instead of a slot list, and reverted cleanly to 200.

**Added and PROVEN 2026-08-19 `[R3-91]`:**
- `/api/booking/availability` wraps its whole handler, which covers appointments, events, classes and resources at once and cannot miss a branch the way per-return edits would. **This is the route the guest appointment flow actually uses**; `unified-availability` serves the embed and the mobile app, so wiring that one first covered the smaller audience.
- A **retry card** in `AppointmentBookingFlow`, at both the single and group render sites. It is deliberately not the "no times available" card: that one advises trying a different date, which is wrong when the date is fine and the lookup is not. "Try again" replays the last lookup from a ref rather than reloading and losing the wizard state.
- **The 503 handling matters more than it looks.** The fetch ignored `res.ok` and did `data.practitioners ?? []`, so a 503 rendered as "fully booked" -- the same screen a genuinely full day produces. A guest would have given up on a venue that was open.

**✅ The route is now PROVEN, 2026-08-19 `[R3-91]`.** Injecting at handler level (guaranteed on the path, unlike `fetchAppointmentInput`, which this request shape does not reach) returned **503 with `Retry-After: 15`**. The earlier failure was the injection point, not the wrap.

**✅ The card is now pinned, 2026-08-19.** `AppointmentBookingFlow.slots-unavailable.test.tsx`, 5 fixtures: the retry card renders on a 503, the "no times available" copy and its wrong "try a different date" advice do NOT, "Try again" replays the lookup and recovers to real slots, the card stays absent on success, and the copy carries no em-dash.

**Tested the test:** disabling the 503 branch turns exactly four of the five red, the fifth being the success path that should not depend on it. A component test was the right answer over driving the UI, which had already failed twice: the slot step sits inside a panel the headless browser could not open.

**✅ The month path is done, 2026-08-19.** It was the most exposed surface in the programme: `appointment-month-availability.ts` carries **twelve** fail-open reads, more than any other file, and a failure there does not remove one time, it removes whole DATES from the picker. A guest sees a month with nothing green and concludes the venue is busy for weeks.
- `/api/booking/appointment-calendar` wraps its handler. **Proven on staging: 503 with `Retry-After: 15`**, recovering to a normal month once the injection was removed.
- The month fetch already checked `res.ok` and threw, which is better than the slot path did, but a throw still leaves an empty picker that reads as "fully booked". It now flags the 503 specifically and shows its own notice, worded for a month rather than a day.
- **Any successful month load clears the flag**, whether or not anyone pressed Try again: one month answering means the venue is reachable again.
- 3 further fixtures (8 in the file). Tested the test: disabling the branch turns exactly the two month fixtures red.

**A test-design note worth keeping `[R3-92]`.** The first attempt at the retry fixture failed because the flow **prefetches more than one month**, so "fail the first call, then succeed" let a later success clear the notice before the assertion ran. The fix was an explicit switch the test flips, not a call counter. Any fixture that assumes one request per user action on this flow will be flaky in the same way.

**✅ Stage 7 is COMPLETE, 2026-08-19.** `class-instances` and `resource-calendar` are wired, and the five copies of the rule became one.

**Neither could be proven by exercising the route `[R3-93]`.** `class-instances` needs a `class_type_id` and `resource-calendar` is gated behind the venue's booking models, so on a venue with no classes or resources they cannot reach a successful response at all: injecting a failure returned the routes' own 400 and 403, exactly as the rule says it should. **That absence of proof is the finding.** Rather than reconfigure a venue to manufacture a test, the three-line rule five routes were each carrying was extracted into `withScheduleFailClosed`, which is the same shape that produced the six working-hours implementations Stage 5 collapsed: identical by coincidence, free to drift, and provable only by exercising every caller.

The shared helper has **8 fixtures** covering what the copies never tested: 503 replaces a SUCCESS, a 400 / 403 / 500 is left alone (a 400 already answers correctly about the request, and turning it into "come back later" would hide a client bug behind an apparent outage), table names are deduplicated, **no venue or calendar id reaches the guest-visible body**, and a throw is not swallowed. That is a better proof than five separate live checks, and it is the only proof available for the two latent routes.

**Re-proven live after the refactor**, because the wrap moved: injecting into `appointment-calendar` still returned 503 with `Retry-After: 15`, recovering to 200. All five routes verified returning their normal responses, with no false 503.

**Decision (J), taken 2026-08-19.** Today every availability fetcher reads `res.data ?? []`, so a failed read of the leave or closure table is indistinguishable from "nothing there" and the engine sells the day. The operator's call: **a wrong booking costs staff time and goodwill to untangle, while a retry message costs one refresh**, so the system should refuse to answer rather than answer wrongly. Stage 1 item 4 already made these failures visible in Sentry, which is the prerequisite; this stage makes them safe.

**Scope note.** The decision covers the GUEST booking path, which is what `SA-C3` is about. The staff write-path validators (`findClassScheduleWindowAvailabilityConflict`, `findEventLeaveConflict`) still fail open, deliberately and consistently with each other. Changing those is not part of Stage 7 and should not be smuggled into it: refusing to let staff schedule anything during a database wobble is a different trade with a different answer.

---

## §5 The safety net, since there is no flag

1. **Stage 0b's parity matrix**, asserting ordered start times and read/write pairs. **Built, at `src/lib/availability/parity/` — 9 files, 107 tests as of 2026-08-19.** Ten assertions are labelled `DIVERGES` and pin a defect rather than a desired behaviour, so a stage that changes one must change its expectation in the same commit. Its coverage gap (month path, diary renderer, `getUnifiedAvailableSlots`) was recorded in Stage 0b and **was cleared in Stage 5**, which found two live diary-renderer defects in the process.
2. **One concern per commit**, each independently revertable.
3. **Staging soak per stage** — now actually valid, because Stage 1 item 5 removes the CDN caching that would otherwise mask changes for 165 seconds per edge node.

**A fixture can assert an ordered list and still be blind `[R3-79]`.** Asserting start times rather than booleans is necessary and **not sufficient**. The guest path's part-day closure fixture ran 12:00 to 13:00 on a 60-minute grid, where subtracting the closure re-anchors to 13:00 — exactly where vetoing leaves it. Identical output, defect invisible, assertion green either way. This was **proved, not reasoned about**: injecting a subtraction into `venueAnchorRangesForDate` left that fixture passing while the matrix's own appointment-path fixture went red, because its 12:00 to 12:45 closure sits off the 30-minute grid. The appointment path was covered; the guest path, where a defect reaches a customer rather than a member of staff, was not.

**The rule this yields: a fixture guarding an anchoring rule must place at least one boundary OFF the interval grid**, or it cannot distinguish veto from subtract. Two such fixtures were added on 2026-08-18 (105 → 107 tests), each asserting the ordered list *and* the specific times that appear only under subtraction, so a regression names itself. **Test the test**: inject the defect and confirm the fixture fails. A fixture never seen red is a fixture of unknown value.

**Four classes of regression the matrix cannot catch.**

1. **Slot-time drift**, if the matrix asserts booleans. Fixed by asserting ordered start-time lists. **See the sufficiency caveat above** — ordered lists on grid-aligned boundaries are still blind.
2. **Configuration shapes not in the fixture set.** Build fixtures from real staging configurations, and run §6's queries against production. **Q0 shows production has 17 calendars, all `practitioner`**, so resource, event-column and class-column scheduling cannot be soaked at all: for those paths the Stage 0b fixtures are the only net, not a second one.
3. **Cross-surface disagreement.** Fixed by read/write agreement pairs, which would have caught §1.2 items 15 and 16 — both live today.
4. **Route-level branch selection `[R3-37]`.** The matrix reaches gates at helper level, not through `create/route.ts`. §1.2 item 14 is exactly a branch-selection defect. Hand review in Stages 2 and 5 is the only mitigation, and it is weaker than a test.

**Partly mitigated 2026-08-19: the `schedule-health` cron.** `/api/cron/schedule-health` (daily, 05:00) runs the mirror-drift invariant that caught `[R3-82]` by hand, and reports to Sentry when `calendar_date_overrides` has drifted from `practitioner_leave_periods`. Three properties make it worth trusting: it compares **ids, not counts** (equal totals hide one row never mirrored against one mirror orphaned, and a fixture pins exactly that case); it **refuses to answer** rather than reporting healthy when a read fails, because an empty set from a failed read looks identical to a clean system; and it treats rows the backfill deliberately skips as **information rather than a fault**, so it cannot settle into permanent alerting that teaches everyone to ignore it. It is **read-only on purpose** — self-healing nightly would hide the cause while the symptom kept returning.

**⚠️ All of this reporting is inert without `SENTRY_DSN` `[R3-85]`.** `sentry.server.config.ts` only calls `init` when `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN` is set, and `reportAvailabilityReadFailure`, the mirror reporter and `reportScheduleHealth` all return early without one. It is **not** in `.env.local`. **Confirm it is set in the production environment**, or Stage 1 item 4's nine reporting call sites and everything added since are console warnings nobody reads.

**What remains unmitigated, stated honestly.** No production shadow comparison, and no observability on the resolver itself: there is still no counter on `reportAvailabilityReadFailure`, no post-deploy canary comparing pre- and post-resolution for the venues §6 identifies, and no owner-comms step. The two materialisation crons (`class-recurring-materialize`, `materialize-event-sessions`) read no hours at all and will keep minting sessions on dates the new semantics hide. If a real configuration diverges in a way the fixtures do not model, the first signal is a support ticket.

---

## §6 Migration and data

- **No destructive migration before Stage 6b.** Stages 0 to 5 are read-path behaviour.
- **Stage 6a is additive**; the source rows are not deleted. Stage 6b is where irreversibility begins, and it carries the archive-table and PITR requirements above.
- Weekday keys in `opening_hours` are numeric strings with **0 = Sunday** (`index.ts:87`, `engine.ts:56-58`), matching `extract(dow from date)`. Verified.

All queries are read-only. **Run §6 as one script**, or at least paste the helper immediately above Q2 and Q8: `pg_temp` is session-scoped, so running Q2 alone in a fresh SQL-editor tab fails with `function pg_temp.weekly_period_count(jsonb, date) does not exist` `[R3-57]`. Start with `set timezone = 'UTC';` — on a non-UTC session `generate_series` in Q2 resolves to the `timestamptz` overload and `d::date` can skip or repeat a day across a DST boundary.

**Every venue-wide query filters `service_id is null`**, because every live venue-wide reader does (`venue-wide-blocks-fetch.ts:22,39`, `venue-exceptions-adapter.ts:16`, `venue-wide-business-hours.ts:24`); service-scoped rows point at `venue_services` and are unaffected. **v2's queries omitted that filter and overstated every count `[R3-47]`.**

### Q0 — Instrument check. Run this FIRST, and re-run it whenever a query returns zero.

Q3, Q4 and Q5 all returned zero rows against production on 2026-08-17. That is a good result, but three consecutive zeros is also what a query pointed at the wrong table, the wrong environment or the wrong filter looks like. **A zero is only informative once you know the population is non-empty** `[R3-62]`. This is the same discipline §9 describes: verify the safety claim, not just the defect claim.

```sql
set timezone = 'UTC';

select block_type,
       count(*)                                                        as rows_total,
       count(*) filter (where service_id is null)                      as venue_wide,
       count(*) filter (where service_id is null
                          and date_end >= current_date)                as venue_wide_future,
       count(*) filter (where date_end > date_start)                   as multi_day,
       count(*) filter (where time_start is not null
                          and time_end is not null)                    as part_day
from availability_blocks
group by block_type
order by rows_total desc;

-- How many venues even have weekly hours configured? Q2 and Q8 return nothing
-- for a venue whose opening_hours is absent or {} -- correctly, since that is
-- UNRESTRICTED (venue-wide-business-hours.ts:12-14) -- so a platform with few
-- configured venues yields small result sets for honest reasons.
select count(*)                                                         as venues_total,
       count(*) filter (where opening_hours is not null
                          and opening_hours <> '{}'::jsonb)             as with_weekly_hours
from venues;

-- Calendars and their break/hours shapes, for Q10 and the §1.3 tier 2 work.
select calendar_type,
       count(*)                                                          as calendars,
       count(*) filter (where jsonb_typeof(break_times_by_day) = 'object'
                          and break_times_by_day <> '{}'::jsonb)         as using_by_day_breaks,
       count(*) filter (where jsonb_typeof(availability_exceptions) = 'object'
                          and availability_exceptions <> '{}'::jsonb)    as with_date_overrides
from unified_calendars
group by calendar_type;
```

**How to read it.** If `amended_hours` has a healthy `venue_wide_future` count, Q3's and Q4's zeros are real and meaningful. If it is zero or near zero, the feature is barely used and the zeros say little about what happens once venues start using it — in which case Stage 0b's fixtures carry the whole weight, because there is no production data to falsify anything.

**Run it as ONE statement.** The Supabase SQL editor returns only the last result set, so three statements show one answer and silently discard the two that matter most. Use this instead:

```sql
set timezone = 'UTC';

select 'venues (total)' as metric, count(*)::bigint as value from venues
union all select 'venues with weekly opening_hours', count(*) from venues
  where opening_hours is not null and opening_hours <> '{}'::jsonb
union all select 'blocks: '||block_type||' (all)', count(*) from availability_blocks group by block_type
union all select 'blocks: '||block_type||' (venue-wide, future)', count(*) from availability_blocks
  where service_id is null and date_end >= current_date group by block_type
union all select 'calendars: '||calendar_type, count(*) from unified_calendars group by calendar_type
union all select 'calendars: flat breaks with no by-day', count(*) from unified_calendars
  where jsonb_typeof(break_times) = 'array' and jsonb_array_length(break_times) > 0
    and (break_times_by_day is null or jsonb_typeof(break_times_by_day) <> 'object'
         or break_times_by_day = '{}'::jsonb)
union all select 'experience_events (active, future)', count(*) from experience_events
  where is_active and event_date >= current_date
union all select 'class_instances (future)', count(*) from class_instances
  where instance_date >= current_date
union all select 'event_sessions (future, live)', count(*) from event_sessions
  where session_date >= current_date and not is_cancelled
union all select 'leave periods (current/future)', count(*) from practitioner_leave_periods
  where end_date >= current_date
order by 1;
```

### Q0 result, production, 2026-08-17. Read this before sizing any stage `[R3-63]`

| Metric | Value |
|---|---|
| venues (total) | **16** |
| venues with weekly `opening_hours` | **14** |
| `availability_blocks`: `closed` (all) | **2** |
| `availability_blocks`: `amended_hours` (all) | **0 — no row emitted** |
| `availability_blocks`: any type, venue-wide **and** future | **0 — no row emitted** |
| `unified_calendars`: `practitioner` | **17** |
| `unified_calendars`: `resource` / `event` / `class` | **0 each** |
| calendars on the flat `break_times` fallback | **0** |
| calendars using `break_times_by_day` | **2** |
| `experience_events` active and future | **0** |
| `class_instances` future | **0** |
| `event_sessions` future and live | **0** |
| `practitioner_leave_periods` current or future | **2** |

**What is actually live on this platform is one composition:** venue weekly opening hours × calendar weekly working hours × breaks × leave, on the appointment path, at 14 configured venues across 17 practitioner calendars. That is the whole of it.

**What has no production data at all:** amended hours (never used once), venue-wide future closures, resources, classes, events, per-date calendar overrides, and the flat-break fallback.

#### This reframes the plan, and the reframing must not be soft-pedalled

- **Q3's, Q4's and Q6's zeros do not mean "no problematic rows". They mean "no rows".** The instrument was working; the population is empty. Every conclusion drawn from those zeros still holds, but for a weaker reason than it appeared: nothing is at risk because nothing is there.
- **Every decision (A) to (H) is a zero-risk change against current data.** (A) touches resources: none exist. (B), (C), (D) and (H) touch classes and events: none are scheduled. (E) touches overlapping amended hours: none have ever existed. (G) touches `days_off`: empty. This is a good position to be in and it should be stated plainly rather than left implied.
- **§5's staging soak is close to worthless as a safety net for most of this plan**, because there is no configuration to diverge. It remains meaningful only for the live composition named above. **For everything else, Stage 0b's fixtures are not a second net, they are the only one.**
- **A claim made during this plan's own drafting is falsified here.** The flat `break_times` fallback was called the most likely site of real data loss, on the strength of only 2 of 17 calendars using per-day breaks. Zero calendars are on the fallback. §1.3 tier 2's sequencing for `break_times` stands as written on correctness grounds, but its risk was overstated and Q10 answers zero.

#### What this changes about priority, and what it does not

It does **not** license skipping stages or merging them. The code defects in §1.2 are real, the read/write disagreements are real, and they will bite the first venue that turns on amended hours, a resource or a ticketed event. **It does change what the stages are for:** this is now a programme to make the model correct *before* venues arrive, not to stop live bleeding.

Two consequences worth acting on:

1. **The appointment composition is the only thing that can regress a real venue today.** Stage 1's items and Stage 3's part-day-closure and grid-anchoring behaviour deserve the most careful review and the fullest fixture coverage, because they are the only changes with a live blast radius.
2. **The rest can be sequenced for engineering convenience rather than risk.** The strict one-concern-per-commit discipline in §5 was designed against a live blast radius that, for resources, classes and events, does not exist. Keeping it is defensible for reviewability; relaxing it for those specific paths is now a legitimate option and is the operator's call, not the implementer's.

### Q1 — Part-day closures that change meaning for appointments at Stage 3

```sql
select b.venue_id, v.name as venue_name, b.block_type,
       count(*)                                            as rows_total,
       count(*) filter (where b.time_end >  b.time_start)  as day_narrows_to_window,
       count(*) filter (where b.time_end <= b.time_start)  as day_reopens_completely,
       min(b.date_start) as earliest_still_relevant, max(b.date_end) as latest_end
from availability_blocks b
join venues v on v.id = b.venue_id
where b.service_id is null
  and b.block_type in ('closed','special_event')
  and b.time_start is not null and b.time_end is not null
  and b.date_end >= current_date
group by b.venue_id, v.name, b.block_type
order by rows_total desc;
```

`day_reopens_completely` are the rows that close the whole appointment day today (the venue-exceptions adapter discarded the times before Stage 3) and will impose **no** constraint after Stage 3, because `venue-wide-business-hours.ts:206` requires `c > a`. Those venues widen the most and must be told first. `block_type` is split out because `unified-availability.ts:264` omits `special_event` until Stage 1.

### Q2 — Amended hours that will open a currently-closed weekday

**v2's version excluded single-date blocks (`date_end > date_start`), which is the shape of its own defect #1** ("opening specially on a bank-holiday Sunday") `[R3-48]`.

```sql
with expanded as (
  select b.id, b.venue_id, b.date_start, b.date_end, b.override_periods, d::date as affected_day
  from availability_blocks b
  cross join lateral generate_series(
    greatest(b.date_start, current_date), b.date_end, interval '1 day') as d
  where b.service_id is null
    and b.block_type = 'amended_hours'
    and b.date_end >= current_date
    and jsonb_typeof(b.override_periods) = 'array'
    and jsonb_array_length(b.override_periods) > 0
)
select e.venue_id, v.name as venue_name, e.id as block_id, e.date_start, e.date_end,
       e.affected_day, to_char(e.affected_day, 'Dy') as weekday, e.override_periods
from expanded e
join venues v on v.id = e.venue_id
where pg_temp.weekly_period_count(v.opening_hours, e.affected_day) = 0
order by e.venue_id, e.affected_day;
```

### Q3 — NEW, and blocking. Amended-hours rows that will CLOSE the appointment day

```sql
select b.venue_id, v.name as venue_name, b.id, b.date_start, b.date_end,
       b.override_periods, b.reason
from availability_blocks b
join venues v on v.id = b.venue_id
where b.service_id is null
  and b.block_type = 'amended_hours'
  and b.date_end >= current_date
  and (b.override_periods is null
       or jsonb_typeof(b.override_periods) <> 'array'
       or jsonb_array_length(b.override_periods) = 0)
order by b.venue_id, b.date_start;
```

**Run against production 2026-08-17: zero rows.** No venue-wide `amended_hours` block with a future end date has null or empty `override_periods`, so neither population changes and Stage 3's last data prerequisite is clear.

**This zero expires, and the expiry has a fix already in the plan.** `blockPatchSchema` still lacks the POST route's refine (§1.2 item 13), so a PATCH can create one of these rows at any time. **Stage 1 item 3 must land before Stage 3**, which the stage order already gives, but the dependency is now load-bearing rather than incidental: it is the only thing that keeps this result true. Re-run Q3 immediately before Stage 3 merges.

Historic context, if a row ever does appear: it is **ignored** by appointments (the day sells) and **closes the whole day** for classes, events, resources and the diary. Whichever way §2.2's law resolves it, one of those two populations changes, which is why the remedy is repair rather than a semantic choice.

For each row, the operator needs both sides of the picture before deciding whether it was meant as a closure:

```sql
-- Per empty-period amended block: what is currently ON SALE on those dates
-- (appointments, which ignore the row) and what is currently HIDDEN
-- (classes/events, which see the whole day closed).
select b.id as block_id, b.venue_id, v.name as venue_name, d::date as affected_day,
       (select count(*) from class_instances ci
         where ci.venue_id = b.venue_id and ci.instance_date = d::date)   as classes_hidden_today,
       (select count(*) from event_sessions es
         where es.venue_id = b.venue_id and es.session_date = d::date
           and not es.is_cancelled)                                        as sessions_hidden_today,
       (select count(*) from bookings bk
         where bk.venue_id = b.venue_id and bk.booking_date = d::date)     as bookings_already_taken
from availability_blocks b
join venues v on v.id = b.venue_id
cross join lateral generate_series(
  greatest(b.date_start, current_date), b.date_end, interval '1 day') as d
where b.service_id is null
  and b.block_type = 'amended_hours'
  and b.date_end >= current_date
  and (b.override_periods is null
       or jsonb_typeof(b.override_periods) <> 'array'
       or jsonb_array_length(b.override_periods) = 0)
order by b.venue_id, affected_day;
```

Confirm `class_instances.instance_date` and `bookings.booking_date` against the live schema before running; both are named from the migrations, not verified in this pass.

### Q4 — Overlapping amended blocks, sizing decision (E)

**Run against production 2026-08-17: zero rows.** Decision (E) was taken on design grounds with no live venue affected. Re-run before Stage 3 in case an overlapping pair has been created since.

```sql
select a.venue_id, v.name as venue_name, a.id as block_a, b2.id as block_b,
       a.date_start, a.date_end, b2.date_start, b2.date_end,
       a.override_periods, b2.override_periods
from availability_blocks a
join availability_blocks b2
  on b2.venue_id = a.venue_id and b2.id <> a.id
 and b2.service_id is null and b2.block_type = 'amended_hours'
 and b2.date_start <= a.date_end and b2.date_end >= a.date_start
join venues v on v.id = a.venue_id
where a.service_id is null and a.block_type = 'amended_hours'
  and a.date_end >= current_date and a.id < b2.id
order by a.venue_id, a.date_start;
```

Non-zero means decision (E) changes live behaviour. Zero means (E) is free to take on design grounds alone, which is what happened.

### Q5 — NEW. `days_off` contents, before anything touches it (decision G)

**Run against production 2026-08-17: zero rows** — no calendar carries a non-empty `days_off` of any kind, so (G) has nothing to migrate. **This result expires.** The column is still writable through `/api/venue/practitioners` by a mobile client outside this repository, so re-run immediately before Stage 6b and contract only on a second zero.

```sql
select uc.venue_id, v.name as venue_name, uc.id, uc.name as calendar_name, uc.calendar_type,
       uc.days_off,
       (select count(*) from jsonb_array_elements_text(uc.days_off) x
         where x ~ '^\d{4}-\d{2}-\d{2}$')                                as iso_date_entries,
       (select count(*) from jsonb_array_elements_text(uc.days_off) x
         where lower(x) in ('sun','mon','tue','wed','thu','fri','sat'))  as recurring_weekday_entries,
       (select count(*) from jsonb_array_elements_text(uc.days_off) x
         where x !~ '^\d{4}-\d{2}-\d{2}$'
           and lower(x) not in ('sun','mon','tue','wed','thu','fri','sat')) as inert_entries
from unified_calendars uc
join venues v on v.id = uc.venue_id
where jsonb_typeof(uc.days_off) = 'array' and jsonb_array_length(uc.days_off) > 0
order by recurring_weekday_entries desc, iso_date_entries desc;
```

`recurring_weekday_entries > 0` are **live recurring closures the target model cannot express**. `inert_entries` (for example `"Monday"`) are genuine no-ops and safe to discard. Both were zero on production.

### Q6 — NEW. Resource per-date overrides, before anyone touches `availability_exceptions`

```sql
select uc.calendar_type, count(*) as calendars_with_overrides,
       sum((select count(*) from jsonb_object_keys(uc.availability_exceptions))) as dated_overrides
from unified_calendars uc
where uc.availability_exceptions is not null and uc.availability_exceptions <> '{}'::jsonb
group by uc.calendar_type;
```

Any non-zero row on `calendar_type='resource'` is settings a `DROP COLUMN` would destroy (§1.3 tier 3).

### Q7 — NEW. Leave semantics the Stage 6a migration must preserve

```sql
select l.venue_id, v.name as venue_name,
       count(*)                                                     as leave_rows,
       count(*) filter (where l.unavailable_start_time is not null)  as partial_day_rows,
       count(*) filter (where l.end_date > l.start_date)             as multi_day_rows,
       count(*) filter (where coalesce(l.notes,'') <> '')            as rows_with_notes,
       count(*) filter (where l.leave_type <> 'annual')              as non_default_leave_type
from practitioner_leave_periods l
join venues v on v.id = l.venue_id
where l.end_date >= current_date
group by l.venue_id, v.name
order by leave_rows desc;
```

`partial_day_rows` are the rows §2.4 keeps as vetoes. If they were subtracted instead, every appointment slot after every one of those windows would move `[R3-27]`.

### Q8 — Events outside weekly hours, for the record under decision (B)

Decision (B) keeps today's event gate, so **no live event is hidden by this plan**. This query is still needed because Stage 3 lets amended hours open a weekly-closed day, which newly **exposes** events on those dates. **v2's version was mislabelled**: it had no join to `opening_hours` and no time comparison, so `events_outside_weekly_hours` counted *every* active future event `[R3-49]`. It also queried only `experience_events`, missing `event_sessions` entirely.

```sql
select 'experience_events' as surface, e.venue_id, v.name as venue_name, e.id,
       e.name as event_name, e.event_date, e.start_time, e.end_time, e.is_recurring
from experience_events e
join venues v on v.id = e.venue_id
where e.is_active and e.event_date >= current_date
  and pg_temp.weekly_period_count(v.opening_hours, e.event_date) is not null
  and not exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(v.opening_hours -> (extract(dow from e.event_date)::int::text) -> 'periods') = 'array'
             then v.opening_hours -> (extract(dow from e.event_date)::int::text) -> 'periods'
           when (v.opening_hours -> (extract(dow from e.event_date)::int::text) ->> 'open') is not null
             then jsonb_build_array(v.opening_hours -> (extract(dow from e.event_date)::int::text))
           else '[]'::jsonb end) p
    where (p ->> 'open')::time <= e.start_time and (p ->> 'close')::time >= e.end_time)

union all

select 'event_sessions', s.venue_id, v.name, s.id, uc.name, s.session_date,
       s.start_time, s.end_time, (s.recurrence_key is not null)
from event_sessions s
join venues v on v.id = s.venue_id
join unified_calendars uc on uc.id = s.calendar_id
where not s.is_cancelled and s.session_date >= current_date
  and pg_temp.weekly_period_count(v.opening_hours, s.session_date) is not null
  and not exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(v.opening_hours -> (extract(dow from s.session_date)::int::text) -> 'periods') = 'array'
             then v.opening_hours -> (extract(dow from s.session_date)::int::text) -> 'periods'
           when (v.opening_hours -> (extract(dow from s.session_date)::int::text) ->> 'open') is not null
             then jsonb_build_array(v.opening_hours -> (extract(dow from s.session_date)::int::text))
           else '[]'::jsonb end) p
    where (p ->> 'open')::time <= s.start_time and (p ->> 'close')::time >= s.end_time)
order by 2, 6;
```

Recurring occurrences beyond the stored `event_date` still need expansion from `recurrence_rule`; treat `is_recurring = true` rows as a floor.

Rows where `pg_temp.weekly_period_count` is **0** for that date are the events decision **(H)** protects: shown and sold today, and still shown and sold after this plan. Every other row is an event **inside** a configured weekday's hours, unaffected either way. The remaining reason to run Q8 is Stage 3: once amended hours can open a weekly-closed day, events on those dates become visible where they are hidden today.

### Q9 — NEW. Venues whose appointment hours change the moment Stage 1 item 2 ships

**Run against production 2026-08-17: zero rows.** No venue carries a non-empty `venues.venue_opening_exceptions`, so `SA-L1` is **latent, not live**, and item 2 shipped as a pure no-op against current data. The legacy column is still writable through `PATCH /api/venue/venue-opening-exceptions` (§1.3 tier 1), so this zero expires like the others.

§1.1 records that `SA-L1` is live **only** at venues whose legacy JSON is non-empty. Stage 1 item 2 makes `availability_blocks` win the precedence, which silently changes resolved appointment hours at exactly those venues. v2 and the first v3 draft both described Stage 1 as having no data prerequisite `[R3-58]`.

```sql
select v.id, v.name,
       jsonb_array_length(coalesce(v.venue_opening_exceptions, '[]'::jsonb)) as legacy_entries,
       (select count(*) from availability_blocks b
         where b.venue_id = v.id and b.service_id is null
           and b.block_type in ('closed','special_event','amended_hours')
           and b.date_end >= current_date)                                   as live_blocks
from venues v
where jsonb_typeof(v.venue_opening_exceptions) = 'array'
  and jsonb_array_length(v.venue_opening_exceptions) > 0
order by legacy_entries desc;
```

Rows with **both** columns non-zero are venues where the two sources disagree and the block table starts winning. Zero rows means item 2 is a pure no-op and can ship unannounced, **which is what happened**.

### Q10 — NEW. Calendars that lose every break if `break_times` is contracted

§1.3 tier 2 requires `break_times` to be migrated into `break_times_by_day` before Stage 6b, and nothing counted the affected calendars.

```sql
select uc.venue_id, v.name as venue_name, uc.id, uc.name as calendar_name, uc.calendar_type,
       jsonb_array_length(uc.break_times) as flat_breaks
from unified_calendars uc
join venues v on v.id = uc.venue_id
where jsonb_typeof(uc.break_times) = 'array'
  and jsonb_array_length(uc.break_times) > 0
  and (uc.break_times_by_day is null
       or jsonb_typeof(uc.break_times_by_day) <> 'object'
       or uc.break_times_by_day = '{}'::jsonb)
order by flat_breaks desc;
```

Every row is a calendar in "same breaks every day" mode whose breaks vanish on a `DROP COLUMN`. **Q0 (2026-08-17) answers this in advance: zero.** Re-run before Stage 6b anyway, since `/api/venue/practitioners` can still write the column.

---

## §7 Decisions

### Taken, and why

**(A) to (D)** were taken by the operator on 2026-08-17 and are recorded with their rationale in §3. **(E) to (H)** were raised by the v3 review round and taken the same day, after Q4 and Q5 were run against **production**.

**(E) The most specific Hours override wins.** Today all applicable amended blocks are **concatenated** and then intersected with the weekly base (`venue-wide-business-hours.ts:84-96`, `:171`), so a one-day 10:00–14:00 override nested inside a three-month 08:00–20:00 override **does not narrow that day**. Under (E), smallest `date_end - date_start` wins, ties break on latest `created_at`, and genuinely tied overrides union. **Q4 returned zero rows on production**, so no live venue is affected and this is adopted because it is what owners mean rather than to fix an active problem. It also removes the main way overlapping ranges arise, which is the trigger for §1.2 item 19.

**(F) Calendar hours for events are checked at create time only.** That is where the check lives today (`event-hours-vs-venue-calendar.ts:118-156`, kept by decision D), and the event **read** engine carries no calendar data at all (`EventEngineInput`, `event-ticket-engine.ts:28-45`) `[R3-50]`. A read-time gate would need a calendar input on the engine, a join in two fetchers plus their range variants, a defined answer for the nullable `calendar_id` case, and exact agreement with the create validator's break subtraction. Any drift between the two surfaces as "staff created it, guests never see it", with no error anywhere.

**(G) `days_off` weekday names convert into weekly working hours — and there are none to convert.** They are live recurring closures the target model cannot express (§1.2 item 18), and the intended remedy is to untick that weekday on the calendar's working hours, which says the same thing in a concept the owner can see and edit. **Q5 returned zero rows on production: no calendar carries a non-empty `days_off` of any kind.** So the migration limb of (G) is empty.

> **This does not close `days_off`, it changes which limb is dangerous `[R3-61]`.** The column is empty *now*, but `/api/venue/practitioners` still accepts `days_off: z.array(z.string()).optional()` with no validation of contents (`:213`, persisted at `:454`, `:480`, `:800`), and that route serves Bearer/mobile auth from a repository this one cannot see. A single mobile write re-creates the problem after the engines have stopped expecting it. **(G)'s work is therefore a write-surface job:** reject non-ISO-date entries at the API in Stage 1, keep honouring the column defensively until Stage 6b contracts it, and re-run Q5 immediately before that contraction rather than trusting today's result.

**(H) Events keep the weekly-closed allowance.** Recorded in §3 and coded in §2.6. The load-bearing detail is that an **explicit** closure on the date still hides the event, so an owner who genuinely shuts that Sunday is obeyed. Stage 2 must assert both directions: allowed with no blocks, hidden with a closure.

**(I) Stage 6a stores per-date overrides in a NEW `calendar_date_overrides` table**, not a type discriminator on `practitioner_leave_periods`. Taken 2026-08-18, when the migration was written. That table is FK'd to `practitioners`, which has zero production rows, while every calendar lives in `unified_calendars`: extending it would mean re-pointing an FK on a table with live readers. A new table costs one backfill and leaves the old one untouched for 6b to retire on its own schedule. `leave_type`, `notes` and `created_at` are carried across (§1.3 tier 3).

**(J) The system fails CLOSED when it cannot read a venue's schedule.** Taken 2026-08-19. See Stage 7 for the reasoning and for what the decision deliberately does not cover.

### Still open

1. **`leave_type`** — the mislabelling is a copy fix (§1.3 tier 3), not a schema change. Confirm no reader is wanted before Stage 6a freezes the shape.
2. **No data prerequisite is outstanding.** Q3, Q4 and Q5 all returned zero rows on production (2026-08-17). Q1, Q2, Q8 and Q9 remain advisory: run them to decide which venues need telling. **Run Q0 first** to confirm the population is non-empty before trusting any zero, and re-run Q3 immediately before `staging` merges to `main` (Stage 3 is already on `staging`, so that merge is when it reaches production data).
3. **Confirm the `reserveni-app` grep and the production access-log check** before any route in §1.3 tier 1 is deleted.

---

## §7b Consumers

All nine of v2's entries were verified at the cited lines and stand. Three of them were already accounted for elsewhere in the plan (`unified-availability.ts:378` is §1.2 item 15; `appointment-availability:182` and `confirm:1531` are two of the fifteen in item 4).

**v2's claim that `venue-closure-covers-booking.ts` is "a seventh hand-rolled reader" does not follow from anything** `[R3-51]`: §1.2 item 10 counts six *working-hours* implementations and three *exception pickers*, so this is the **fourth** picker. **Its exemption is correct and must survive.** It reads closure blocks only and never the weekly schedule, because `SA-H5` establishes that staff legitimately book outside opening hours and those guests must still get reminders. The divergence is documented in its own header (`:9-24`) and pinned by its test (`venue-closure-covers-booking.test.ts:69`). Folding it into the unified resolver would start suppressing reminders for exactly those bookings.

**Consumers in neither v2's §7b nor any v2 stage.** All must be covered by Stage 0b's matrix or explicitly exempted.

| Consumer | file:line | Why it matters |
|---|---|---|
| Hours-change orphan detector | `calendar/hours-change-orphans.ts:13-18` | Weekly hours only; drifts at Stage 3 (item 23) |
| Service custom-availability summary | `service-custom-availability.ts:337-373` | Divergent twin; its "keep in sync" target is deleted (item 22) |
| Public class month calendar | `booking/class-instances/route.ts:60-88` | CDN-cached, no invalidation (item 20) |
| Public resource month calendar | `booking/resource-calendar/route.ts:75-110` | CDN-cached (item 20) |
| Collective month calendar branch | `booking/appointment-calendar/route.ts:83-95` | CDN-cached; sibling branch already fixed (item 20) |
| Public unified-availability route | `booking/unified-availability/route.ts:49` | Guest embed path; item 9 reaches guests here |
| Deposit/confirm slot revalidation | `booking/revalidate-appointment-slot.ts:119` | v2 lists `confirm:1531`, not this shared helper |
| Resource booking reschedule | `booking/validate-resource-booking-modification.ts:70-78` | Decision (A) moves its answers |
| Class session write gates | `booking/insert-free-class-session-booking.ts:136`, `insert-pending-paid-class-session-booking.ts:153` | The read/write pair for classes |
| Class cart quote | `class-commerce/quote-class-cart.ts:177` | Prices a cart against availability |
| Staff appointment-modification route | `api/venue/bookings/[id]/validate-appointment-modification/route.ts` | v2 lists the lib, not the route |
| Multi-service visit scheduler | `api/venue/visits/[groupBookingId]/schedule/route.ts`, `.../services/route.ts` | The only code to change since baseline |
| Linked-accounts staff booking | `api/venue/linked-calendar/booking/route.ts` | Collective **write** path; v2 lists only the read bridge |
| Staff availability routes | `api/venue/class-availability`, `resource-availability`, `class-offerings`, `event-offerings` | Dashboard twins of the guest routes |
| Resource mint-slots helper | `calendar/resource-availability-mint-slots.ts:35` | Decision (A) moves it |
| Diary break renderer | `calendar/practitioner-break-blocks.ts:3` | Shares the helpers Stage 5 rewrites |
| Closure-over-booking guard | `calendar/closure-booking-conflicts.ts:1-9` | Write gate on the surface Stage 6a migrates |
| Event window conflict guard | `experience-events/calendar-event-window-conflicts.ts:1-15` | Reached by decisions (C) and (D) |
| Column assignment config check | `calendar/column-assignment-conflicts.ts:15-19` | Config-time gate on the same weekly data |
| Working-hours line formatter | `calendar/format-working-hours-for-date.ts:6-24` | A seventh weekday-key reader, uncounted in item 10 |
| Import tool reference writer | `import/create-reference-entity.ts:79-82,138-140` | **Writes** `working_hours`, `break_times`, `days_off` |
| Public booking page hours display | `booking/get-public-venue-for-book.ts`, `build-venue-public.ts`, `map-api-venue-to-public.ts`, `venue-settings-to-preview-public.ts` | Shows hours that will disagree with the new resolution on amended dates |
| Month grey-out grid | `dashboard/practitioner-calendar/MonthScheduleGrid.tsx:93` | Named in Stage 4 prose; needs the discriminated struct from Stage 2 |
| Help centre closure articles | `lib/help/articles/getting-started.ts:49` and its figures | **Documents the behaviour Stage 3 reverses** (item `[R3-41]`) |

`service_items.custom_working_hours` composes **inside** the anchoring set, not after the venue clip as v2 said (§2.5), and inherits decision (A).

---

## §8 What this plan does not do

- Does not touch table/restaurant paths. `reduced_capacity` and `area_id` scoping are unchanged, and Stage 4's optional parameter keeps the two restaurant grid call sites provably untouched.
- Does not address `SA-M8` (day API booking window) or `SA-M10` (month path duration maths). Real, small, unrelated to closures, mis-filed into Phase 1 by the parent audit.
- Does not rebuild the twelve editing surfaces into the §12 "Schedule workspace". That is Phase 4 and depends on this landing.
- Does not add past-midnight opening hours (§2.2). It names the gap and stops the silent full-day closure.
- Does not add observability, a divergence canary, or an owner-comms mechanism (§5). **This is the largest honest gap in the plan.**
- **Removes CDN caching from three public month routes and does not restore it** `[R3-60]`. Stage 1 item 5 is necessary for every later stage's staging soak to mean anything, but the `SA-M9` comment it copies says the cache "comes back when there is something to key it on" and wants a `venues.availability_epoch` bumped by trigger on every schedule write. No stage schedules that. Three guest-facing month endpoints lose edge caching permanently. That is a real cost, taken deliberately.
- **Does change staff override behaviour in one respect**, contrary to v2's §8: `allowOutsideHours` and `allowDuringBreaks` keep their user-visible semantics, but decision (A) requires the `resourceRangesForHostProjection` split (§2.5) or `allowDuringBreaks` breaks on every column that hosts a resource. Stage 0a exists for that reason.

---

## §9 Appendix: how v3 was produced

**Round 1.** Four independent reviewers worked from the code at `ea9672f2` with disjoint mandates: citation verification, model semantics, data safety, and stage sequencing. Findings were re-verified at source before adoption. **One reviewer finding was rejected on inspection** (the claim that nested amended blocks narrow correctly today — see §0).

**Round 2.** A fifth reviewer attacked the resulting draft of this document rather than the code, and found three blocking defects in it: a false correction (`[R3-23]`), a model law contradicted by three stages (`[R3-53]`), and an operator decision inverted while being presented as compliance (`[R3-54]`). It also found that the draft had reintroduced the re-anchoring harm it condemns, on a different rule (`[R3-52]`). All are fixed above, and the false correction is left visible in §1.3 rather than quietly repaired.

**The recurring failure in this project's planning is now four rounds old: asserting that current behaviour is X without reading X.** It has been committed by the parent audit, by v1, by v2, by a round-1 reviewer, and by this document's own first draft. Two conclusions follow, and they are the reason for the shape of this plan:

1. **Every behavioural claim that decides a stage carries a citation**, and any claim that could not be verified from this repository says so instead of asserting.
2. **Stage 0b exists because citations are not enough.** A `file:line` proves what a line says, not what a system does. The parity matrix is the only artefact here that can falsify a claim about composed behaviour, which is why it is ordered before every stage that changes one.
