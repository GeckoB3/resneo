# ResNeo scheduling resolver — gold-standard implementation plan

**Date:** 2026-08-16
**Status:** DRAFT v2, revised after adversarial review. **Four operator decisions outstanding (§7). Not ready to implement.** No code written.

> **Adversarial review, 2026-08-16.** The v1 draft was attacked on seven axes and **four blockers were found, three of them errors in the draft itself**. Every one is corrected below and marked `[AR-n]` so the correction is traceable rather than silently absorbed. The headline lesson matches this project's recurring one: v1 asserted that two mechanisms were "equivalent" without testing the claim, and asserted that a change "preserves today's behaviour" without checking what today's behaviour is.
**Supersedes:** §11.1 and §13 Phase 1 of `Docs/Resneo_Scheduling_Availability_Audit_August_2026.md`.
**Baseline:** `main` and `staging` at `6bc9ef4f`. 344 test files / 3258 tests. 261 migrations.

**Scope:** venue opening hours, venue amended hours, venue closures, calendar working hours, calendar breaks, calendar closures and leave — and the composition of all of them, for **appointments, resources, events and classes**.

**Explicitly out of scope:** table/restaurant venues. The operator confirms there are none on the platform and none expected. Restaurant-only paths (`reduced_capacity`, `area_id` scoping, the dining engine) are left alone; where a change would touch them, this plan says so rather than silently altering them.

---

## §1 Evidence base

Three parallel code reviews were run on 2026-08-16 (calendar-layer inventory, composition comparison, write-surface audit). Every claim below carries a `file:line` citation in the review output. **The reviews falsified a substantial number of the parent audit's claims**, and those corrections are the reason this plan differs from §13's Phase 1.

### 1.1 Corrections to the parent audit

| Audit claim | Reality |
|---|---|
| Phase 1 closes nine findings as one unit | Three unrelated programmes. Only `SA-H2` and `SA-M1` are resolver work; `SA-C3` is the fetcher plus a UI state; `SA-M8` and `SA-M10` are unrelated bugs. |
| "Create `src/lib/availability/resolver/`" | The resolver exists — `venue-wide-business-hours.ts` — and four of five engines already use it. |
| `venue-wide-business-hours.ts` is "well tested" | **2 tests.** |
| The resolver's intersect semantics are canonical | The shipped UI promises "open late", which only works under **replace**. Operator has confirmed replace is intended. |
| Twelve write surfaces across four pages | **16 write call-sites across 9 routes.** The audit missed `/dashboard/appointment-services`, `/dashboard/class-timetable`, `/dashboard/event-manager` and the import references step. |
| `/dashboard/availability` is an hours surface | It redirects appointment venues away and imports no hours editor. Not a surface. |
| Four weekly-hours editors with different copy-day rules | **Three** editors, and all three have **identical** copy-day rules. The period caps do differ (2 vs unlimited vs unlimited). |
| "14+ clicks to change one day's closing time" | **4** (5 with the orphan confirm). |
| "~27 clicks for a lunch break for five stylists" | **37**, or ~122 if the copy-all shortcut is unusable. |
| `SA-L1` (`venue_opening_exceptions`) is "latent, not live" | **Live.** It overrides the `availability_blocks` table on both appointment paths. |

### 1.2 What is actually wrong, ranked

1. **Amended hours cannot open a weekly-closed day** for classes, events, resources or the diary. `resolveVenueWideAllowedMinuteRanges` returns `closed` at `venue-wide-business-hours.ts:142` for a weekday with no weekly periods, **before amended hours are examined**. Opening specially on a bank-holiday Sunday: appointments sell it, everything else shows nothing, and the diary greys the day out while drawing amended-hours stripes over it.
2. **Amended hours REPLACE for appointments and INTERSECT for everything else** (`appointment-engine.ts:491-496` vs `venue-wide-business-hours.ts:171`).
3. **Part-day closures widen to whole-day for appointments only** — `venue-exceptions-adapter.ts:17-24` discards `time_start`/`time_end`.
4. **The legacy `venues.venue_opening_exceptions` JSON outranks the closures table.** `[AR-5] Corrected in both directions.* It is **not** unconditional — `appointment-engine.ts:141-152` already handles an *empty* block list correctly, so half of the v1 draft's proposed fix was a no-op. But it is far bigger than "three call sites": there are **fourteen** `attachVenueClockToAppointmentInput` call sites and **only one** (`unified-availability.ts:171`) passes `venueBlocks`. The other thirteen all select `venue_opening_exceptions`, so the legacy branch is live and clobbers the block-derived list on every one. Deleting `blocksToVenueOpeningExceptions` in Stage 2 therefore changes the `AppointmentEngineInput` contract across all fourteen.
5. **`resource-booking-engine` ignores staff leave and all block tables.** A resource on a host column stays bookable while the host is on leave or has manual blocked time.
6. **Breaks are a veto in the appointment engine and a subtraction in the resource engine.**
7. **A single unrelated block on a date flips class/event semantics for that whole date** — both short-circuit only when the date has zero blocks.
8. **Appointments evaluate one block per date; everything else combines all of them** (`appointment-engine.ts:469-477`).
9. **`unified-availability.ts:259` omits `special_event`**, and because it passes a non-null list it *clears* the correctly-resolved exception list.
10. **Six implementations of "working hours → minutes"** and **four of "breaks → minutes"**, plus two divergent venue-exception pickers carrying a "keep in sync" comment that are not in sync.
11. **Failure visibility has three tiers** — Sentry, `console.warn`, and silence. The diary is silent and renders a fully open grid on a failed venue fetch; the month picker discards its venue-clock error entirely.
12. **Events ending at midnight are always rejected** (`00:00` → minute 0 → coverage check fails).
13. **`PATCH /api/venue/availability-blocks` can create `amended_hours` with null `override_periods`**, which resolves to a silent full-day closure. The POST schema forbids it; the PATCH schema does not. `[AR-10]` The remedy is **not** porting the refine across — `blockPatchSchema` is a genuine partial-update schema, so a normal `{id, date_end}` PATCH would start failing. It has to read the stored row and validate the merged result, which is a route change.

14. **One write-path gate serves three models that need different rules `[AR-4]`.** `venueWideBlocksRejectBookingWindow` is called from `booking/create` at `:1031` (group session), `:1298` (event tickets) and `:1562` (resource). Under §2.4 the first two must stop consulting weekly hours and the third must keep doing so. One function cannot do both.

15. **A live read/write disagreement the parent audit never found `[AR-4]`.** `getEventClassSlots` (`unified-availability.ts:367-455`) applies **no** venue-wide gate, while `booking/create:1031` applies the full one. A 19:00 group session at a 09:00–17:00 venue is listed to the guest and then rejected at create with "The venue is closed for this date or time."

### 1.3 Dead weight to remove, not preserve

- `practitioner_calendar_blocks`: **zero writers, five readers.** FK points at `practitioners`, which has zero production rows.
- `unified_calendars.days_off`: every UI writes `[]`. Non-empty values are migration residue, and the UI already shows a "Legacy blocked dates" banner telling owners to re-record them as leave.
- `unified_calendars.break_times` (flat): no non-empty writer anywhere in `src/`.
- `unified_calendars.availability_exceptions` **on practitioner calendars**: never written, and dropped by `unified-calendar-mapper.ts` before the engine sees it. (It is live and load-bearing for **resource** calendars.)
- `PATCH /api/venue/venue-opening-exceptions`, `POST /api/venue/calendar-columns`, `POST/PATCH /api/venue/service-schedule-exceptions`: zero callers.
- `practitioner_leave_periods.leave_type`: required server-side, rendered as a dropdown, **read by no engine**. Its labels do not match its values (`annual` → "Closed", `sick` → "Unavailable").

---

## §2 The model

Two layers, each with the same two concepts, and one composition rule.

### 2.1 Venue layer

- **Opening hours** — weekly recurring baseline. Absent ⇒ the venue imposes no constraint.
- **Date overrides**, on a date or date range:
  - **Closed** — optionally with a time window. No window ⇒ the whole day.
  - **Hours** — the hours the venue is open on those dates. **Replaces** the weekly baseline.

### 2.2 Calendar layer (staff and resources, one model)

- **Working hours** — weekly recurring baseline for that calendar.
- **Breaks** — weekly recurring, per weekday.
- **Date overrides**, on a date or date range:
  - **Closed** — optionally with a time window. No window ⇒ the whole day. *This is what leave becomes.*
  - **Hours** — the hours this calendar works on those dates. **Replaces** its weekly baseline. *This is what resource `availability_exceptions` becomes.*
- **Ad-hoc blocks** — one-off, arbitrary windows on a specific date (`calendar_blocks`). Distinct from a date override because they are drawn and dragged on the diary.

The symmetry is the point: **a calendar closure is to a calendar what a venue closure is to a venue.** Today a resource can have a per-date override and a staff member cannot; a staff member can have leave and a resource cannot. One concept replaces both.

### 2.3 The composition rule

One function. One order. Every consumer.

```
venueOpen(date):
  1. THREE base states, not two  [AR-3]:
       opening_hours absent or empty      -> UNRESTRICTED
       configured, weekday HAS periods    -> those periods
       configured, weekday has NO periods -> []   (closed; NOT unrestricted)
  2. if any venue Hours override applies -> base = union of its periods   (REPLACES, and
     replaces [] too -- this is what lets a venue open on a normally-closed weekday)
  3. MATERIALISE before subtracting  [AR-3]: if base is still UNRESTRICTED and any Closed
     window applies, base becomes the full day [0,1440) first.
  4. base = base - every applicable venue Closed window   (no times -> whole day)
  5. result: UNRESTRICTED (only when untouched by any override) | ranges (empty = closed)

calendarOpen(date, calendar):
  1. base = weekly working periods for that weekday
  2. if any calendar Hours override applies -> base = union of its periods   (REPLACES)
  3. base = base - every applicable calendar Closed window
  4. result: ranges (possibly empty = not working)
     NOTE: breaks are deliberately NOT subtracted here -- see §2.5  [AR-1]

hostedResourceOpen(date, resource):                                          [AR-7]
  1. base = resource's own hours, or its Hours override for the date (REPLACES)
  2. if the resource is displayed on a host calendar:
       base = base INTERSECT calendarOpen(date, host)
       base = base - host breaks
       base = base - host ad-hoc blocks          (NEW: not honoured today)
       base = base - host booking occupancy
       base = base - sibling resource ranges
  3. result: ranges

bookable(date, calendar):
  1. open = calendarOpen INTERSECT venueOpen      (UNRESTRICTED venue -> calendarOpen unchanged)
  2. open = open - ad-hoc calendar blocks
  3. open = open - scheduled class/event sessions on that calendar
  4. candidates are anchored to `open` ranges, THEN vetoed against breaks  (§2.5)
  5. capacity/booking checks run against the surviving candidates
```

**`[AR-3]` why step 1 has three states.** `venue-wide-business-hours.ts:126-142` distinguishes *absent* from *configured-but-empty-weekday*, and the second means closed. The v1 draft named only the first, which an implementer could reasonably read as "empty weekday ⇒ UNRESTRICTED" — flipping every Sunday-closed venue wide open on every path at once.

**`[AR-3]` why step 3 exists.** Today `UNRESTRICTED` materialises to `FULL_DAY` before closures subtract (`venue-wide-business-hours.ts:112,144`). Without that step a part-day closure at a venue with **no weekly hours** becomes a silent no-op — and that is the most common appointments shape, where venue hours are blank and the real hours live on staff calendars.

**Properties this buys.** Order-independent within a kind: multiple Hours overrides union, multiple Closed windows all subtract — no "pick one". Closure beats amended hours, because subtraction happens after replacement. Amended hours can open a normally-closed weekday, which is the case that is broken today. And it composes: the same four steps describe the venue and the calendar.

### 2.4 The scheduled-instances carve-out

Classes and events already have fixed times someone deliberately scheduled. They are **not** slot generation and must not be gated by a weekly baseline.

```
scheduledInstanceAllowed(date, startEnd):
  blocked if any venue Closed window overlaps the instance window
  blocked if any calendar Closed window overlaps it, for the instance's calendar
  blocked if the instance's calendar has an ad-hoc block overlapping it
  NOT blocked by venue weekly opening hours
  NOT blocked by calendar weekly working hours
  NOT blocked by breaks
```

It removes the three inconsistent implementations of that idea, and fixes the "one unrelated block flips the whole date" bug — because the weekly baseline is never consulted, the presence or absence of a block cannot change which rule applies.

The window must be tested with the **same past-midnight handling classes already have** (`class-session-engine.ts:200-203`), or the carve-out reintroduces the `end <= start` trap it is meant to fix `[AR-minor]`.

> **`[AR-2]` CORRECTION: this does NOT preserve today's behaviour for events.**
>
> The v1 draft claimed classes and events both run outside weekly hours today. **True for classes, false for events.** `event-ticket-engine.ts:98-108` resolves on *every* date and, when the result is `allowed`, requires the event window to fit fully inside the weekly hours. Only the weekday-with-zero-periods case is carved out. **A 19:00 event at a 09:00–17:00 venue is hidden from guests today.**
>
> Adopting the carve-out therefore **starts selling every out-of-hours event at every venue with configured opening hours**, with no flag. That is a real product change, not a refactor, and it is **operator decision (B) in §7** with its own sizing query in §6.

**Partial fix only, on resources `[AR-7]`.** The v1 draft claimed this fixes resource-ignores-leave "as a side effect". It fixes **leave** — which becomes a host Closed override consumed by `calendarOpen`. It does **not** fix host `calendar_blocks`, because a hosted resource's composition is its own rule, not `bookable()`. That is why §2.3 now carries an explicit `hostedResourceOpen`, which subtracts host ad-hoc blocks for the first time.

### 2.5 Breaks: veto, not subtract `[AR-1]`

**The v1 draft said "subtract" and claimed the two were equivalent for slot generation. That was wrong, and it would have shifted every slot time after every break.**

The candidate grid is anchored to **each range's start**, not to the hour (`booking-interval.ts:115-120`). So subtracting a break does not merely remove candidates, it **re-anchors** the ones after it:

> Working 09:00–17:00, break 12:00–12:45, 30-minute interval and span.
> **Veto (today):** … 11:00, 11:30, **13:00**, 13:30 …
> **Subtract:** ranges split to [09:00–12:00] and [12:45–17:00] → … 11:00, 11:30, **12:45**, 13:15, 13:45 …

Every slot after the break moves. Previously-bookable times would start returning 400 from `validateExactAppointmentStart`, and new off-grid times would appear to guests. (The exception is `hasHourRestriction`, where `step = 1` and offsets are hour-anchored — there they genuinely are equivalent, but that is the minority configuration.)

**So the rule is: breaks are a veto applied to candidates generated from unsplit ranges.** That is the appointment engine's current behaviour and it is preserved exactly.

**This inverts which engine changes.** The resource engine anchors to post-subtraction ranges today (`resource-booking-engine.ts:330`) — which is *why* the two engines differ. Unifying on veto therefore shifts **resource** slot times instead of appointment ones. That is a smaller blast radius and the primary product is unaffected, but it is a real change and it is **operator decision (A) in §7**.

Processing-time gaps are genuinely unaffected either way: `serviceSchedulingSpanMinutes` returns `duration + buffer` when processing blocks are set, and the busy envelope never exceeds the span, so veto and fit-inside-range agree.

Staff overrides (`allowDuringBreaks`) continue to apply on the write path, unchanged.

---

## §3 Decisions taken, with rationale

| Decision | Rationale |
|---|---|
| Amended hours **replace** the weekly baseline | Operator decision. The shipped UI promises "close early **or open late** … enter the hours you are actually working". Intersect cannot open late. |
| Amended hours **can open a weekly-closed day** | Follows from replace. It is also the single most broken case today (§1.2 item 1). |
| Part-day closures **subtract** | Operator decision. Makes the times owners already type do what they say, and removes the amber warning banner. |
| Part-day closures are **retained**, not removed | They work correctly today for classes, events and resources; a date-ranged part-day closure preserves each day's own hours in a way one Hours override cannot; the editor caps at two periods so two mid-day gaps are inexpressible. |
| Classes and events are gated by **closures only** | Operator decision. Preserves today's behaviour, unifies three implementations. |
| Breaks **subtract** | §2.5. |
| Leave becomes a **calendar Closed override** | Removes the venue/calendar asymmetry and the "Closure vs Unavailable window" confusion, where both options already produce byte-identical rows. |
| **No per-venue flag** | Operator decision. The parity harness (§5) is the safety net instead. |
| Restaurants are **not** in scope | Operator decision — no venues, none expected. |

---

## §4 Stages

Each stage is independently shippable, independently testable on staging, and independently revertable. **No stage depends on a later one.**

### Stage 0 — The parity harness. No behaviour change.

The safety net that replaces the flag. Build a fixture matrix and assert what **every** consumer produces today, divergences included. Pins current behaviour so that every later stage shows up as a reviewable diff in this file.

- Fixture set: weekly hours (configured / absent / weekday-with-no-periods), venue Closed (whole-day / part-day / multi-day range), venue amended (inside weekly / extending beyond / on a closed weekday / empty periods / **multi-day range spanning a closed weekday**), calendar working hours, breaks, leave (full / partial), ad-hoc blocks.
- **Assert the full ordered list of start times per fixture, not booleans `[AR-§5]`.** A boolean matrix passes straight through the breaks re-anchoring in §2.5 without noticing. This is the single most important property of the harness.
- **Assert read/write agreement pairs, not seven independent columns `[AR-§5]`.** For each fixture: the engine offers time T ⟺ the corresponding write gate (`venueWideBlocksRejectBookingWindow` / `validateExactAppointmentStart`) accepts T. A read-only matrix cannot detect "guest sees the slot, create rejects it" — which is **already live** for group sessions (§1.2 item 15) and is the exact failure mode of a partial Stage 3.
- Consumers asserted: appointment day engine, appointment month path, class engine, event engine, resource engine, diary renderer, `unified-availability`, **plus the group-session listing path and the three `booking/create` write gates**.
- **Do not claim DST coverage here `[AR-minor]`.** The resolver is pure wall-clock minute arithmetic and `getDayOfWeek` reads the weekday off the Y-M-D string, so DST fixtures against `venueOpen`/`calendarOpen` pass trivially. The real DST exposure is in `venueLocalWallTimeToUtcMs`, `sameDaySlotCutoffForBookingDate` and `slotMinutesFromNow`, which this plan does not touch and which `SA-H1` already covered.

**Exit:** the matrix passes and reproduces every divergence in §1.2 as an explicit expectation. Reviewers can see the current behaviour in one file for the first time.

**Risk:** none. Test-only.

### Stage 1 — Standalone bugs that should not wait for a rewrite.

Independent one-liners and small fixes, each its own commit. None of them needs the resolver work.

1. `unified-availability.ts:259` — add `special_event` to the block-type filter (`SA-M12`).
2. Event coverage check — handle an instance ending at `00:00` (`event-ticket-engine.ts:105-107`).
3. `availability-blocks` PATCH — **merge the stored row and validate the result** `[AR-10]`; do not port the POST refine, which would break partial updates. Add `date_end >= date_start` and `time_end > time_start` to both routes.
4. `attachVenueClockToAppointmentInput` — pass `venueBlocks` from the **thirteen** call sites that omit them `[AR-5]`. The "fill only when genuinely absent" half of the v1 proposal is **already implemented** (`appointment-engine.ts:144-145`) and is a no-op. This is a Stage-1-sized job only because it is mechanical; it is not a one-liner.
5. Failure reporting — route the class, event and resource `console.warn` sites through `reportAvailabilityReadFailure`, and stop the month picker discarding its venue-clock error.
6. `getEventClassSlots` — apply the same venue gate the create path applies, closing the live read/write disagreement in §1.2 item 15 `[AR-4]`.

**Exit:** Stage 0's matrix updates in the same commits, showing exactly which cells changed.

### Stage 2 — One venue resolver, with the agreed semantics.

The core change. Implement §2.3's `venueOpen` as the single venue-layer function, in `venue-wide-business-hours.ts` (extend the existing resolver — do not create a sixth module).

- Amended hours replace rather than intersect, and are evaluated **before** the weekly-closed-day short-circuit.
- Part-day closures subtract on every path, including appointments.
- All applicable blocks combine; no "pick one".
- `blocksToVenueOpeningExceptions` and `venueMinuteRangesForAppointmentDate` are **deleted**; the appointment engine and month path call the shared resolver. This changes the `AppointmentEngineInput` contract across **fourteen** call sites `[AR-5]`.
- `isWeeklyScheduleClosedForDate` is **also deleted** `[AR-12]`. Once amended hours are evaluated before the weekly short-circuit it is semantically incoherent, and the event engine gates on it.
- **Diary grid geometry moves too, and it is the larger half `[AR-6]`.** `getCalendarGridBounds` derives the visible grid from **weekly hours only** and falls back to 07:00–21:00 on an empty weekday (`venue-calendar-bounds.ts:74-113`); amended stripes are clipped to those bounds and silently dropped outside them (`schedule-closure-blocks.ts:223,268-278`); and the month grey-out uses a separate weekly-only helper (`getVenueBusinessDayStatus`, `:35-61`). **Without this, Stage 2's headline fix does not work** — an amended 07:00–09:00 window on a closed weekday renders outside the visible grid and the month picker still greys the day out. Ten call sites of `getCalendarGridBounds` across the dashboard.
- Remove the amber warning banner in `BusinessClosuresSection`, which documents behaviour that no longer exists.

**Stage 2 exit criterion added `[AR-12]`:** Stage 2 does not *depend* on Stage 3, but it does ship an intermediate event semantics — events at a venue with an amended block on a weekly-closed day flip from hidden to visible-and-coverage-checked, because `isWeeklyScheduleClosedForDate` returns false whenever any block exists. That intermediate state must be specified and accepted before Stage 2 merges, or Stages 2 and 3 must ship together.

**Closes:** `SA-H2`, `SA-M1`, §1.2 items 1, 2, 3, 8.

**Behaviour changes owners will notice**, all intended:
- A part-day closure now narrows the appointment day instead of removing it.
- Amended hours now open a normally-closed weekday for classes, events, resources and the diary.
- Amended hours extending beyond weekly hours are now honoured everywhere, not just for appointments.

### Stage 3 — One calendar resolver.

Implement §2.3's `calendarOpen` and §2.4's carve-out. Collapse the six working-hours implementations and four break implementations into one each.

- Single `calendarOpen(date, calendar)` used by the appointment engine, resource engine, diary, break-block renderer, class conflict checker and event-hours checker.
- Breaks stay a **veto** (§2.5); the resource engine changes to match, not the reverse `[AR-1]`.
- `hostedResourceOpen` (§2.3) routes the host through `calendarOpen`, fixing resource-ignores-leave **and** newly subtracting host ad-hoc blocks `[AR-7]`.
- Classes and events adopt the §2.4 carve-out, replacing three inconsistent implementations — **subject to operator decision (B)** on the event behaviour change.
- Split `venueWideBlocksRejectBookingWindow` into a scheduled-instance gate and a slot-generation gate `[AR-4]`, and repoint its three `booking/create` call sites accordingly.
- `days_off` remains **read-only** for migrated data; no new writes. Its ISO-date entries are honoured by the new closed-override path.

**Two create-time guardrails this stage would delete `[AR-9]`, both needing an explicit decision (§7 C and D):**
- `event-hours-vs-venue-calendar.ts:178-210` today refuses to create an event unless it fits inside `calendarSegments ∩ venueRanges`, with three distinct user-facing errors. Under "not blocked by calendar weekly working hours" the whole function becomes vacuous.
- `class-schedule-availability-conflicts.ts:157-165` today refuses to schedule a class overlapping a break on that column. Under "not blocked by breaks" a class can be booked over a stylist's lunch — and the appointment engine will then fold it in as a `scheduled_session` block that consumes the break anyway.

**Closes:** §1.2 items 5, 6, 7, 10, 14.

### Stage 4 — Data model and write surface.

The stage that makes the model visible to owners. Largest UI investment.

- **Calendar date overrides** become a first-class table (or a typed extension of the existing leave table — decision deferred to implementation, see §7). Leave rows migrate into it. `leave_type` either gains a reader or is dropped.
- One weekly-hours editor component replaces three; one date-override editor replaces the venue closure editor and the leave panel, which today present identical vocabulary with different semantics and different validation.
- Fix the "Closure vs Unavailable window" options that produce byte-identical rows.
- Validation parity between POST and PATCH on every route.
- Delete the dead routes and dead fields listed in §1.3.
- Add "apply to all calendars" for breaks, which exists for leave and not for breaks — the 37-click path.

### Stage 5 — Fail closed (`SA-C3` proper). Optional, decide separately.

`loadScheduleContext`, the third `unavailable` state, HTTP 503 with `Retry-After`, and a retry card in the booking UI. Independent of Stages 0–4 and the only one needing front-end work on the guest side. **Recommend deciding this separately rather than assuming it rides along.**

---

## §5 The safety net, since there is no flag

The audit's plan relied on a per-venue flag and a shadow week. Without one, three mechanisms replace it:

1. **Stage 0's parity matrix.** Behaviour is pinned before it is changed, so every stage's diff is reviewable as "these cells changed, and here is why each was intended".
2. **One concern per commit.** Every stage is several commits, each independently revertable. A regression is attributable to one change rather than to a week's work.
3. **Staging soak per stage.** The operator tests each stage on staging before merge, as with rounds 1–4.

**Three classes of regression the matrix cannot catch `[AR-§5]`:**

1. **Slot-time drift** — if the matrix asserts booleans. Fixed by asserting the full ordered start-time list per fixture (Stage 0), which is why that is now the harness's most important property rather than a detail.
2. **Configuration shapes not in the fixture set.** Staging is not production. The shape most likely to be missed is the multi-day `amended_hours` range spanning a weekly-closed weekday — invisible today because only appointments honour it. Hence the second sizing query in §6.
3. **Cross-surface disagreement.** A matrix over read engines cannot detect "guest sees the slot, create rejects it". Fixed by asserting read/write agreement pairs (Stage 0) — which would also have caught the group-session divergence that is **already live today**.

**What remains unmitigated, stated honestly:** no production shadow comparison. If a real venue configuration diverges in a way the fixtures do not model, the first signal is a support ticket. Building Stage 0's fixtures from real staging configurations narrows this but does not close it.

---

## §6 Migration and data

- **No destructive migration in Stages 0–3.** All of it is read-path behaviour.
- **Stage 4 migrates leave rows** into calendar date overrides. Reversible: the source rows are not deleted until a later cleanup.
- **`days_off` ISO dates** stay honoured throughout; they are migration residue and the UI already tells owners to re-record them.
- **Existing part-day closure rows change meaning for appointments** at Stage 2, from "closes the whole day" to "closes this window". That is the intended fix, but it **widens availability** on those dates. Size it before shipping Stage 2:

```sql
select count(*) as part_day_closures,
       count(distinct venue_id) as venues_affected,
       min(date_start) as earliest, max(date_end) as latest
from availability_blocks
where block_type in ('closed','special_event')
  and time_start is not null and time_end is not null
  and date_end >= current_date;
```

If that returns rows, those venues should be told before Stage 2 lands, because appointments will start being offered in windows currently closed.

**The larger exposure, which the v1 draft failed to size `[AR-8]`.** §1.2 ranks *amended hours opening a weekly-closed day* as defect #1, and Stage 2 makes amended hours replace **across a whole date range**. A venue that recorded "summer hours 08:00–20:00, 1 Jun – 31 Aug" as one block currently has each day clipped to its own weekly shape, staying shut on its closed weekday. After Stage 2 that block **opens every Sunday in the range** for classes, events, resources and the diary. Appointments already behave this way, which is exactly why nobody has noticed:

```sql
-- Multi-day amended-hours blocks that span a weekday the venue has no periods for.
-- Each row is a venue that will start opening on a currently-closed weekday.
select b.venue_id, b.id, b.date_start, b.date_end, b.override_periods
from availability_blocks b
where b.block_type = 'amended_hours'
  and b.date_end > b.date_start
  and b.date_end >= current_date
order by b.venue_id, b.date_start;
```

Cross-check each row against `venues.opening_hours` for weekdays with no periods inside the range.

**And the event exposure, if decision (B) adopts the carve-out `[AR-2]`:**

```sql
-- Events scheduled outside the venue's weekly hours: currently hidden, would become visible.
select venue_id, count(*) as events_outside_weekly_hours
from experience_events
where is_active and event_date >= current_date
group by venue_id;
```

Cross-check `start_time`/`end_time` against `venues.opening_hours` for that weekday.

---

## §7 Decisions the operator must take before implementation

The adversarial review surfaced four that change behaviour owners will see. **None can be made silently by the implementer.**

**(A) Breaks: whose slot times move? `[AR-1]`**
Unifying on veto preserves appointment slot times exactly and shifts **resource** slot times (resources currently re-anchor after each break). Unifying on subtract would do the reverse and is much worse — it moves every appointment slot after every break. Recommend **veto**, accepting the resource shift. Alternative: leave the two engines anchored differently and abandon that part of the unification.

**(B) Events: adopt the carve-out and start selling out-of-hours events? `[AR-2]`**
Today a 19:00 event at a 09:00–17:00 venue is hidden from guests. The carve-out makes it visible everywhere, at once, with no flag. Options: adopt it (consistent with classes, but a live product change — size with the §6 query first); or keep the weekly gate for events and apply the carve-out to classes only, accepting that the two models stay different by design.

**(C) Should a class still be refused when it overlaps a break? `[AR-9]`**
Deleting that guardrail lets a class be scheduled over a stylist's lunch. Recommend **keeping** it — a schedule-time refusal is not the same thing as a guest-facing availability rule, and the carve-out was only ever about the latter.

**(D) Should event creation still be validated against calendar hours? `[AR-9]`**
Same shape as (C), for `event-hours-vs-venue-calendar.ts`. Recommend **keeping** it, for the same reason.

Then the four carried from v1:

5. **Stage 4's storage.** New `calendar_date_overrides` table, or extend `practitioner_leave_periods` with a type discriminator? Recommend a new table, named for what it is.
6. **Is Stage 5 (fail-closed) in or out?** Largest single piece, only one touching the guest booking UI.
7. **`leave_type`** — give it a reader or drop it? Currently required, displayed, mislabelled and unread.
8. **Run both §6 queries before Stage 2** and decide whether affected venues need telling.

---

## §7b Consumers the v1 draft missed entirely `[AR-11]`

Nine further paths resolve venue hours or closures and appeared in no stage and in none of Stage 0's asserted consumers. All must be in scope:

| Path | File |
|---|---|
| Waitlist offer availability | `src/lib/booking/waitlist-offer-availability.ts:129` |
| Waitlist → appointment conversion | `src/lib/booking/create-appointment-from-waitlist.ts:211` |
| Booking modification / reschedule validation | `src/lib/booking/validate-appointment-modification.ts:177` |
| Linked / collective booking bridge | `src/lib/linked-accounts/collective-booking-bridge.ts:157` |
| Mobile availability route | `src/app/api/venue/appointment-availability/route.ts:182` |
| Deposit / confirm re-validation | `src/app/api/confirm/route.ts:1531` |
| Reminder suppression (cron) | `src/lib/cron/reminder-closure-suppression.ts` → `venue-closure-covers-booking.ts:58-120` |
| Event calendar placement validator | `src/lib/experience-events/validate-event-calendar-placement.ts:55-78` |
| Group-session guest listing | `src/lib/unified-availability.ts:367` |

**The comms one needs an explicit exemption, not a migration.** `venue-closure-covers-booking.ts` is a **seventh** hand-rolled venue-exception reader — §1.2 item 10 counts six — and it diverges *deliberately*: it reads closure blocks only and never the weekly schedule, because `SA-H5` establishes that staff legitimately book outside opening hours and those guests must still get reminders. Folding it into the unified resolver without care would start suppressing reminders for exactly those bookings. Its divergence is documented in its own header and must survive this work.

`service_items.custom_working_hours` composes *after* the venue clip and is unaffected by the venue-layer change — but it will inherit whatever the breaks decision (A) produces.

---

## §8 What this plan does not do

- Does not touch table/restaurant paths. `reduced_capacity` and `area_id` scoping are left exactly as they are.
- Does not address `SA-M8` (day API booking window) or `SA-M10` (month path duration maths). Real, small, unrelated to closures, and mis-filed into Phase 1 by the parent audit. They should be their own fixes.
- Does not rebuild the twelve editing surfaces into the §12 "Schedule workspace". That is Phase 4 and depends on this landing first.
- Does not change staff override behaviour (`allowOutsideHours`, `allowDuringBreaks`). `SA-H5` is shipped and correct.
