# Independent services within a visit: plan

Status: BUILT (phases 0 to 4, 2026-09-09, uncommitted on `staging`; manual drag checklist owed). Written 2026-09-09 (baseline `7807cf08` plus the day's uncommitted work
on the `staging` working tree); phases 0 to 2 built the same day, phases 3 and 4 not yet
(see Progress). Supersedes the "one duration, contiguous
rows" decisions of `multi-service-visit-plan.md` (which stays as the record of what was
built and why); nothing in that document's data model changes.

## What the owner asked for

A multi-service booking stays one booking, but staff get control of each service in it:

1. On the calendar, every service of a visit is its own bar with its own move grip and
   its own duration handle. A service can be dragged to another time, another calendar or
   another date. Services may end up separated; that is allowed.
2. In the booking detail panel, Modify lets staff change the start of the whole visit and
   also the start, calendar and duration of any single service. The panel keeps listing
   every service with its times.
3. Each service has its own **Start** and **Complete**. **Confirm** and **Arrived** stay
   visit-wide.
4. The customer flow is untouched: a customer can still move a booking or change its
   services, never a single service's time.

## Facts the design rests on (verified 2026-09-09)

- **Rows are already independent.** A visit is N `bookings` rows sharing
  `group_booking_id`, each with its own `booking_date`, `booking_time`,
  `booking_end_time`, `calendar_id`, `status`, `client_arrived_at`, processing snapshot and
  price. Nothing in the schema ties them together beyond the id. No migration is needed.
- **The "one booking" facade is in the readers, not the writers.** The calendar merges the
  rows of one column into a single bar (`clusterMultiServiceBookings`, one
  `DraggableBookingShell` keyed on the first row, `patchVisitMove`, `patchVisitResize`,
  the `visitTimeline` render). The modify form's visit mode offers one wall-clock duration
  and one start, and saves through `PATCH /api/venue/visits/[groupBookingId]/schedule`,
  which **re-lays** the rows contiguously (`resequenceVisit`, `planVisitSchedule`). The
  detail panel lists the services read-only.
- **A single row can already be moved on its own.** `PATCH /api/venue/bookings/[id]`'s
  reschedule branch has no group handling: date, time, calendar and duration apply to that
  row; the engine check excludes only the row itself. This is exactly the per-service
  move; the calendar simply never sends it for a visit row.
- **Status cascades across the visit today.** `PATCH /api/venue/bookings/[id]` resolves
  `resolveCascadingVisitGroupId` and `applyGroupBookingStatusChange` writes the new status
  to every sibling that allows the transition (Confirmed, Seated, Completed alike). Cancel
  and No-Show cascade through their own paths. `client_arrived` and
  `staff_attendance_confirmed` cascade through `applyGroupClientArrivedChange` /
  `applyGroupStaffAttendanceChange`. The detail panel and the calendar tray mirror this
  optimistically (`applyStatusToAllGroupVisitRows`, `quickPatchBookingCluster`).
- **Pills are floored at a visit-wide anchor.** `resolveVisitPillAnchorStatus` folds every
  non-terminal segment status with `preferLaterBookingStatus`, so one Started service
  makes every sibling's pill read Started. That fold is what has to change for per-service
  Start/Complete to be legible.
- **The customer side moves one row.** `guest-actions/reschedule.ts` has no sibling
  handling; the manage link belongs to one row, and `booking-detail-dto` only flags
  `part_of_course` for courses. The account list and the manage page list sibling
  services (`fetchGroupVisitBookings`, the email enrichment) but never edit them.
- **Comms send once per visit**: reminders from the earliest row and the post-visit
  message from the latest (`visitCommsAnchorIds`, keyed on group and guest, not date).
- **Lists collapse a visit to one line** (`collapseMultiServiceVisits`, earliest row as
  representative) from the rows loaded for that date.
- **The mobile app** uses the same PATCH routes and, per Docs/MOBILE_API.md, nests visit
  services on its own diary. A change to what a status PATCH cascades is a contract change
  it must be told about.
- **Linked columns** go through the same cluster code (`clusterMultiServiceBookings` is
  called once, per column, for own and linked rows alike).
- **Drag cannot be exercised in the headless preview** (recorded in memory); calendar
  drag and resize are verified by unit tests on extracted helpers plus a manual checklist.

## Decisions

1. **A visit is one booking made of independent services.** Guest, payment, attribution,
   comms identity and Confirm/Arrived/Cancel/No-Show are visit-level. Time, calendar,
   duration, Start and Complete are service-level.
2. **The calendar draws one bar per service**, not one merged bar. Each bar is the
   ordinary single-booking bar (grip, resize handle, tray, follow-up bar, undo) with the
   visit shown as identity, not geometry: the same palette across siblings, a small chip
   ("Visit · 1 of 2"), the guest's name on every bar, siblings highlighted together on
   hover, and a thin spine joining siblings that touch in the same column. Keeping the
   merged bar and adding per-segment grips was considered and rejected: it would add a
   third drag model to a 10,000-line component, and separated or cross-calendar services
   could not be drawn by it anyway.
3. **Dragging or resizing a service changes that service only.** No cascade, no
   re-sequencing. Siblings stay where they are, even if that leaves a gap or an overlap.
   A move or resize that makes a service overlap its own sibling on the same calendar is
   warned (toast), as any overlap is, and allowed.
4. **The whole visit still moves as one, from the Modify form**: "Visit start" shifts every
   service by the same delta (date and time), preserving gaps and cross-day offsets. The
   re-laying behaviour of the schedule endpoint is retired with the total-duration
   control; nothing re-sequences a visit any more, so the "hole" the old plan closed
   cannot be reopened by accident, only chosen.
5. **The Modify form edits per service**: each service row gets date, start, calendar and
   duration; all rows save as one all-or-nothing write. The service list editing from
   workstream 3b (add, remove, swap) stays.
6. **Start and Complete are per service**; Confirm (and undo), Arrived (and undo), Cancel,
   No-Show stay visit-wide. The detail panel header shows the visit-wide actions; the
   "Services in this visit" card carries Start / Complete per row. The calendar tray on a
   service bar shows Arrived (cascades) and that row's Start / Complete.
7. **Visit-level status is derived for display**: Completed when every live service is
   Completed; Started ("In progress") when any is Started; Confirmed when all are; else the
   earliest stage. Pills are floored at Confirmed only (attendance is visit-wide); Started
   and Completed never lift a sibling.
8. **Customer surfaces are unchanged**, and pinned by tests: the manage-link reschedule
   moves its own row exactly as today; the account list and emails keep listing the
   services. The customer never gains a per-service time control.
9. **Reminders per day.** A visit whose services fall on different days gets a reminder
   for each day (anchor keyed on group, guest and date); the post-visit message stays
   one per visit, from the latest service. The reminder lists the day's services.
10. **Lists collapse per day**: a service on another day is its own line, labelled as part
    of a visit.

## Design

### A. Status model (server)

`PATCH /api/venue/bookings/[id]`:

- `status: 'Seated' | 'Completed'` (and their reverts) write the row only. The
  `groupBookingId` cascade branch is entered only for `Confirmed` / back to `Booked`, and
  the existing Cancelled / No-Show paths stay as they are.
- `client_arrived` and `staff_attendance_confirmed` keep cascading.
- `applyBookingLifecycleStatusEffects` runs per row, as now.
- A new pure helper `visitLifecycleStatus(rows)` in `group-visit-bookings.ts` gives the
  derived visit status (decision 7); `resolveVisitPillAnchorStatus` floors at Confirmed
  only. `applyStatusToAllGroupVisitRows` is kept for Confirmed and removed from the
  Start/Complete paths.
- Docs/MOBILE_API.md records the change; the app's Start/Complete on a visit now acts on
  the row it names.

### B. Detail panel

`ExpandedBookingContent` / `BookingDetailPanel`:

- For a visit, the header's forward actions are Confirm and Undo confirm, Arrived and its
  undo, Cancel, No-Show. Start / Complete / Undo start / Undo complete move into each row
  of "Services in this visit", posting to that row's id. The header's status pill shows
  the derived visit status.
- The card's copy stops saying "consecutive services on {date}"; each row shows its date
  when it differs from the anchor's, its calendar when it differs, and its time range.
- Single-service bookings are untouched.

### C. Calendar

`PractitionerCalendarView`:

- `clusterMultiServiceBookings` returns singles only (the group branch is deleted with
  `patchVisitMove`, `patchVisitResize`, `serviceVisitRowsFor`, the visit-level undo entry,
  the `visitTimeline` render and its holes and pieces). Every row renders through the
  single-bar path.
- Visit identity on a bar: palette shared by `group_booking_id` (today's `clusterPalette`
  keyed on the visit), a `VisitChip` ("Visit · 2 of 3", ordered by date then time across
  the day's siblings), `data-visit` for hover highlighting, and a spine drawn between
  bars of the same visit that touch in the same column. Extracted into a pure module
  `src/lib/calendar/visit-siblings.ts` (ordering, chip label, touching pairs, own-sibling
  overlap detection) so it is unit-tested.
- Drag end: the `moveVisitRows` branch is removed; `patchBookingMove` handles every row.
  After a move, the toast adds "This service now overlaps another service of the same
  visit" when it does. The follow-up bar gains an optional "Move the rest of the visit by
  the same amount" action (calls the visit endpoint's shift mode, D below) for the common
  "client is running late" case; it is a shortcut, not a default.
- Resize: the single-row resize applies to the row; siblings do not move; the same
  own-sibling overlap warning.
- Tray: `CalendarBookingRightColumn` receives the row; Arrived cascades through the
  existing `client_arrived` PATCH, Start / Complete post for the row. `quickPatchBookingCluster`
  becomes the single-row quick patch for status and a visit-wide patch for Arrived.
- Layout: sibling rows that overlap take lanes like any overlap; nesting in processing
  gaps keeps working per row.

### D. Modify form and the visit endpoint

`PATCH /api/venue/visits/[groupBookingId]/schedule` gains two explicit modes and loses
`total_duration_minutes`:

- `shift: { booking_date?, booking_time?, practitioner_id? }`: every scheduled row moves by
  the same delta as the visit's earliest row (calendar applies to every row when given).
- `services: [{ booking_id, booking_date?, booking_time?, practitioner_id?, duration_minutes? }]`:
  explicit per-row schedule; unnamed rows are untouched. `known_booking_ids` guards the
  request as the services endpoint does.
- Both plan every affected row, check each through `validateAppointmentModificationInterval`
  (excluding the visit's own rows from the overlap check only where they are also moving
  to the same calendar; a stationary sibling is a real collision and is reported, with
  `allow_manual_overlap` to override), write all or none, and notify the guest once.
  `dry_run` keeps answering in the same shape. `planVisitSchedule` gains the shift and
  per-service planners; `distributeVisitDuration` and `resequenceVisit` stop being called
  by anything and are deleted with their tests.

`StaffAppointmentModifyForm` visit mode:

- "Visit start" (date, time, calendar) at the top: shifts everything. Copy says so.
- One editor per service: date, start, calendar, duration (with the single-service
  processing panel behaviour), each live-checked through the endpoint's `dry_run`. The
  total-duration control goes. Service add / remove / swap keep working through the
  services endpoint; while a service-list edit is in play the per-service editors are
  read-only, as the duration control is today.
- Undo after save restores every row's previous schedule through the `services` mode.

### E. Comms, lists, other readers

- `visitCommsAnchorIds` keys reminders on group, guest and `booking_date`; the post-visit
  anchor stays per group and guest. The reminder email's sibling list is filtered to the
  same day; the enrichment shows dates when siblings span days.
- `collapseMultiServiceVisits` collapses rows sharing a group id **and a date**; the
  representative's status is the derived visit status; a lone row on another day is
  labelled "part of a visit".
- `resolveAppointmentVisit` keeps working (it sorts by time and reports gaps); its
  `orphanedGapAfterMinutes` no longer drives any write. Cross-day rows are ordered by date
  then time.
- Help: `appointments/appointment-calendar` ("A visit with several services moves as one"
  and the drag paragraph), `getting-started/calendar`, `appointments/managing-appointments`
  (Services in this visit: Start and Complete per service), the ResNeo app articles that
  describe starting a visit.

### F. Out of scope

- The customer flow (decision 8).
- Per-service prices, deposits or cancellation: cancel stays visit-wide.
- Moving one service to another **venue** (linked columns keep the linked write path,
  which already handles single rows).
- A visit-level "Start" that starts every service at once.

## Sequencing

Four phases, each shippable, each with its own tests and a live check:

1. **Status model** (A, B, the list fold in E): server cascade rules, derived status,
   detail panel per-service Start / Complete, mobile doc. No calendar change yet: the
   merged bar keeps working because its tray still posts one status, now to one row.
2. **Calendar per-service bars** (C): the largest change to one file; remove the cluster
   path, add the identity chip and spine, single-row drag / resize / tray for visit rows.
3. **Modify form and endpoint** (D): shift and per-service modes, form editors, undo.
4. **Comms and polish** (rest of E, help, docs, memory).

## Test plan

Every phase runs `tsc`, `eslint` on touched files and the full `vitest run` before it is
called done; the customer-flow pins in 0 run in every phase.

**0. Pins written first, before any behaviour changes** (they must pass before and after):
- `guest-actions/reschedule` moves exactly one row of a visit and leaves siblings
  untouched (route-level test with a two-row group).
- The manage-page DTO and the account list still list every sibling.
- `create-multi-service` still writes contiguous rows from the chain (existing tests).
- The Playwright public flows (`appointment-*-book-pay-confirm.spec.ts`, `account-portal*`)
  pass unchanged.

**1. Status model**
- `group-booking-status-sync.test.ts`: Confirmed cascades to every sibling that allows it;
  Seated and Completed (and their reverts) touch one row; Cancelled and No-Show unchanged;
  `client_arrived` and `staff_attendance_confirmed` cascade.
- `group-visit-bookings.test.ts`: `visitLifecycleStatus` table (all Completed, one Started,
  mixed Confirmed / Booked, terminal rows ignored); pill anchor floors at Confirmed only; a
  Started sibling no longer lifts a Booked pill.
- Route test on `PATCH /api/venue/bookings/[id]` with a mocked admin: the status branch's
  cascade matrix, including that a Completed row's `actual_departed_time` lands on that
  row only.
- `ExpandedBookingContent` component test: visit header shows Confirm / Arrived and no
  Start; each service row shows Start then Complete, posting its own id; optimistic state
  updates one row.
- Live: a two-service visit on plus1 (the 9 Sep Balayage + Beard Trim on Staff 1):
  Confirm marks both; Start on Balayage leaves Beard Trim Confirmed; Complete Balayage,
  Start Beard Trim; list line reads In progress; the calendar's merged bar (still
  present in this phase) shows the row statuses.

**2. Calendar**
- `visit-siblings.test.ts`: ordering across dates, chip labels, touching pairs, own-sibling
  overlap detection, palette key.
- `booking-cluster-layout.test.ts`: two rows of one visit that overlap take two lanes; a
  row inside a sibling's processing gap nests.
- `booking-move-footprint.test.ts`: the outline is the single row's footprint.
- Existing calendar unit suites (`booking-corner-actions`, `BookingCardInfo`,
  `ScheduleEditFollowUpBar`) stay green; `patchVisit*` tests are deleted with the code.
- Manual checklist on the dev server, plus1, day view, with the reference visit and a
  fresh three-service walk-in visit (seed via the walk-in recipe, delete after):
  1. Each service is a separate bar, same colour, chip "Visit · n of N", name on each,
     spine between touching ones.
  2. Drag service 2 an hour later: service 1 stays; a gap appears; follow-up bar offers
     notify / undo and "Move the rest of the visit"; undo restores service 2 only.
  3. Drag service 2 onto David's column: it moves; siblings stay on Staff 1; the detail
     panel lists it under David with its calendar named.
  4. Week view: drag service 3 to the next day; the day view for each day shows its own
     rows; the list shows "part of a visit" on the second day.
  5. Resize service 1 to overlap service 2: allowed, warned, two lanes.
  6. Tray: Arrived on any bar marks all; Start / Complete on a bar changes that bar only.
  7. Linked column: a partner's visit renders per service and its tray follows the
     linked write path.
  8. Nothing changes for a single-service booking (drag, resize, tray, undo).

**3. Modify form and endpoint**
- `visit-schedule-plan.test.ts`: shift mode preserves gaps and cross-day offsets and
  applies a calendar to every row; per-service mode changes named rows only, refuses an
  unknown `booking_id`, and rejects a 412 when `known_booking_ids` disagree.
- Route test on the schedule endpoint: a failing row rolls back the ones already written
  (the existing all-or-nothing test, extended to the two modes); a stationary sibling on
  the same calendar is reported as a collision and `allow_manual_overlap` overrides it;
  one guest notification per save.
- `StaffAppointmentModifyForm.visit.test.tsx` rewritten: visit start shift, per-service
  editors with live validation messages, save payload shape, undo payload, service-list
  editing still works and makes the editors read-only.
- Live: from the detail panel, move the visit start by 30 minutes (both move, gap kept);
  set service 2's calendar to David and its duration to 45; save; the calendar shows it;
  undo puts it back.

**4. Comms and lists**
- `visit-comms-anchor.test.ts`: two rows on different days give two reminder anchors; one
  post-visit anchor from the latest.
- `booking-list-row-schedule.test.ts`: collapse per date; representative status is the
  derived status; the lone row on another day is labelled.
- Help label audit script (the help centre's verification report) after the article
  edits.

**Regression watch-list** (things that read visit rows and are easy to break):
`booking-detail-dto` (customer), `booking-email-enrichment` (sibling list), `payment-summary`
and `payment-display` (visit totals), `staff-cancel-booking` (cascade), `auto-cancel-bookings`
cron, the linked-accounts redaction, the import's reference extraction, `booking-owes-capture`.
Each is covered by an existing test file; the full suite is the gate.

## Open questions for the owner (answered assumptions, flagged)

- The old plan's undo for a whole-visit move goes; undo becomes per action (a service
  move, a service resize, a form save). Assumed acceptable.
- "Move the rest of the visit by the same amount" on the follow-up bar is a convenience
  the request did not ask for; included because "client is late, shift everything" is the
  commonest reason to move a visit and the form is two clicks further away. Easy to drop.
- Reminders per day for a cross-day visit (decision 9) is my reading of "the customer flow
  should remain as it is": one reminder naming a service that is actually tomorrow would
  mislead.

## Progress

- 2026-09-09: plan written after investigation.
- 2026-09-09, phase 0 and phase 1 built on the `staging` working tree:
  - Pins: `src/lib/booking/visit-customer-surfaces.pin.test.ts` (customer reschedule has no
    sibling handling; the email enrichment still lists the visit; the portal offers no
    per-service control).
  - `src/lib/booking/visit-status-scope.ts` (`statusChangeCascadesAcrossVisit`,
    `isServiceLevelStatus`) with tests; `PATCH /api/venue/bookings/[id]` consults it, so
    Seated and Completed (and their reverts) write one row while Confirmed and its undo,
    Arrived, attendance, Cancelled and No-Show keep cascading.
  - `group-visit-bookings.ts`: `visitLifecycleStatus` (derived visit status) and the pill
    floor capped at Confirmed; `collapseMultiServiceVisits` gives the list line the derived
    status.
  - Detail panel: a visit's header offers Confirm / Arrived only; each row of "Services in
    this visit" carries Start, then Undo start / Complete, then Undo complete, posting to
    that row; the card no longer says "consecutive".
  - Calendar (merged bar still, until phase 2): the badge shows the derived status and the
    tray acts on the visit's current service (`visitTrayRow`); Arrived still marks all.
  - Docs/MOBILE_API.md records the cascade change.
  - Verified live (dev, Staff 1's Balayage + Beard Trim on 9 Sep): Confirm cascaded to
    both; Start and Complete on Balayage left Beard Trim Confirmed; Beard Trim started on
    its own; the bar badge read Started and its tray offered Beard Trim's Undo start /
    Complete. Statuses restored afterwards.
- 2026-09-09, phase 2 built on the `staging` working tree:
  - `PractitionerCalendarView`: `clusterMultiServiceBookings` now yields one bar per row;
    the merged-bar render (`visitTimeline`, holes, segment stack), `patchVisitMove`,
    `patchVisitResize`, `undoVisitMove`, `serviceVisitRowsFor`, `visitRowFor`,
    `quickPatchBookingCluster` and the visit-level undo entry are deleted (about 900 lines).
    Every row goes through the single-bar path: its own grip, resize handle, tray,
    follow-up bar and undo. The detail modal's status callback patches one row.
  - Identity: `src/lib/calendar/visit-siblings.ts` (`visitSiblingIndex`, `visitChipLabel`,
    `ownSiblingOverlapCount`, tested); a `VisitChip` ("Visit 1/2") on each bar's name line;
    siblings share the earliest service's colour. Dropping a service on one of its own
    siblings toasts "This now overlaps another service of the same visit." and is kept.
    The hover highlight and the spine between touching siblings are not drawn yet, and a
    LINKED column's bars carry no chip: `linkedBookingToGridBooking` does not map
    `group_booking_id`, so the sibling index cannot see them (they still draw and move per
    service). Both are phase 4 polish.
  - Help: `appointments/appointment-calendar` and `getting-started/calendar` no longer say
    a visit moves as one; `validate-appointment-modification.test.ts` pins recounted (the
    visit dry run, visit resize and visit undo sends are gone with the merged bar).
  - Verified live (dev, 9 Sep): every visit on the day drew as separate bars with
    "Visit 1/2" / "Visit 2/2" chips; no console or server errors. Drag itself cannot be
    driven headless (memory), so the manual checklist below is still owed by hand.
- 2026-09-09, phase 3 built on the `staging` working tree:
  - `src/lib/booking/visit-schedule-plan.ts` rewritten: `planVisitSchedule({ rows, shift | services, knownBookingIds })`
    returns every scheduled row's previous and new slot (date, start, end, length, calendar),
    ordered by the new date and time, with `moved` / `calendarChanged` / `durationChanged`
    per row and `startChanged` / `visitStartChanged` for the visit. Cross-day offsets and
    gaps survive a shift; a per-service edit touches only the rows it names. Refusals carry
    a code (`stale_visit`, `unknown_service`, `duplicate_service`, `not_a_visit`, `empty`,
    `nothing_to_change`). `distributeVisitDuration`, `resequenceVisit` and
    `minimumVisitMinutes` are deleted from `appointment-visit.ts` with their tests; the
    module now only describes a visit.
  - `PATCH /api/venue/visits/[gid]/schedule`: body is `shift: {...}` OR `services: [...]`
    (exactly one; both or neither is a 400), plus optional `known_booking_ids` (412
    `stale_visit` on mismatch). `total_duration_minutes` and the top-level
    `booking_date` / `booking_time` / `practitioner_id` are gone. An empty `shift: {}` is
    allowed and describes the visit as it stands (the form's on-open call). Only changed
    rows are checked and written; each is checked with its fellow MOVING rows excluded, so
    a stationary sibling is a real collision (`allow_manual_overlap` overrides). Calendar
    access is checked for every calendar a changed row leaves or lands on. When the
    visit's earliest slot moves, the cancellation deadline is re-pinned on every scheduled
    row, unchanged ones included. Reminders reset for the rows that moved; one guest
    notification, against the earliest row, when any row moved. Route test:
    `schedule/route.test.ts` (modes, rollback, stationary-sibling collision and override,
    deadline re-pin, one notification, dry run writes nothing).
  - `StaffAppointmentModifyForm` visit mode: "Visit start" (the picker plus a calendar for
    the whole visit) sends a shift; each service line carries date, start, calendar and
    length editors (`Date for …`, `Start for …`, `Calendar for …`, `Length for …`) and sends
    the per-service list naming only the rows that differ from what the form opened with.
    The two are exclusive on screen: moving the visit start locks the per-service editors
    and vice versa (copy says why); a service-list edit (swap, add, remove) locks the
    editors as before. The total-duration control, quick durations and end preview are
    gone from visit mode. Undo after a save restores every row's opening slot through the
    per-service mode with overlap allowed. The follow-up panel's "moved to" is the visit's
    new earliest slot from the response. `StaffVisitModifySegment` and
    `GroupVisitBookingRow` carry `booking_date` and `calendar_id` (the list route already
    projected both). `StaffAppointmentModifyForm.visit.test.tsx` rewritten (24 tests).
  - Verified live (dev, 9 Sep, Staff 1's Balayage + Beard Trim): endpoint dry runs (empty
    shift, +30 shift keeping the 60 minute gap, per-service length, stale 412, sibling
    collision 409); real shift and per-service writes and their restore; from the panel,
    Beard Trim's length 15 to 45 saved on its own, then a visit-start shift to 17:15 moved
    both (17:15 to 18:45, 19:45 to 20:30) and Undo from the follow-up put both back.
- 2026-09-09, phase 4 built on the `staging` working tree:
  - Comms: `visitCommsAnchorIds(rows, 'earliest')` keys on group, guest AND `booking_date`,
    so a visit split across days gets one reminder per day, timed off that day's earliest
    service; the post-visit anchor stays one per visit from its last service. The reminder
    lane passes `siblingScope: 'same_day'` to `enrichBookingEmailForComms`, so the reminder
    lists that day's services only (the template already shows each line's date, so a
    confirmation for a cross-day visit reads correctly without change).
  - Lists: `collapseMultiServiceVisits` collapses per group AND day, gives each day's line
    that day's derived status, and marks a line whose visit has services on another day
    (`visit_spans_days`); the bookings list shows "Part of a visit" on it. Class carts are
    left alone. `resolveBookingListBarSchedule` spans only the same day's siblings
    (`booking_date` on the seed and the cached rows).
  - Calendar: `DraggableBookingShell` carries `data-visit`; hovering any bar of a visit
    lights every bar of it (`setVisitHover`, plain DOM class `calendar-visit-hover` in
    globals.css, no re-render); `visitTouchingEdges` draws a short spine at the seam where
    two services of a visit meet edge to edge in the same column. The linked-calendar
    route now projects `group_booking_id` and `person_label`, `LinkedBooking` and
    `linkedBookingToGridBooking` carry them, so a linked column's bars get the chip and
    the shared colour too.
  - Help: `getting-started/bookings-list` describes the visit dialog (visit start vs one
    service, mutually locking) and the "Part of a visit" line. Label audit run: no new
    zero-hit labels.
  - Tests: `visit-comms-anchor.test.ts` (one reminder per day, one thank-you),
    `booking-list-row-schedule.test.ts` (collapse per day, derived status per day, lone
    day marked, parties and carts never marked), `visit-siblings.test.ts`
    (`visitTouchingEdges`). Full suite 5,301 passing.
  - Verified live (dev, 9 Sep): with Beard Trim moved to 15:30 the Staff 1 pair drew the
    spine (bottom on Balayage, top on Beard Trim), hovering one lit both, and John Light
    3's linked Balayage + Beard Trim carried "Visit 1/2" / "Visit 2/2"; with Beard Trim
    moved to 10 Sep the 9 Sep list showed Balayage 14:00–15:30 marked "Part of a visit".
    Fixture restored afterwards.
- 2026-09-09, follow-ups: the drop outline is sized from the painted card
  (`bookingMoveFootprintMinutes` takes `activeMinutes`; processing that reaches or passes
  the end of the service, and a buffer band detached by it, are left out). "Services in
  this visit" shows for every appointment (a single service is listed as its one row,
  with Start and Complete left to the header) and for bookings on a linked venue: the
  panel reads a linked booking's siblings through `owner_venue_id`, which the list route
  now serves for `group_booking_id` under a `full_details` grant, and linked list rows
  carry `group_booking_id` / `person_label`.
- 2026-09-09, post-visit thank-you: `visitPostVisitAnchorIds` replaces the "latest
  Completed row" anchor. The lane reads every row of the window's visits (any status or
  date); a visit sends only once every live service is Completed, from its last live
  service at that service's hour, and never from an earlier service on its own hour.
  Before sending, `communication_logs` is checked for a sent
  `post_visit_thankyou_email` against every sibling row, so a visit can never get two.
  A cancelled or no-show service neither holds the visit back nor sends. Also: the
  drop outline no longer overshoots the scroll position on drop
  (`scrollTopBeforeGridShiftRef`).
- Still owed: the manual calendar drag checklist (Test plan → 2. Calendar), which cannot
  be driven headless.

### Pre-push review (2026-09-09, evening)

Fixed before the day's work went to staging:

- A visit-level Confirm or Undo confirm no longer pulls a Seated or Completed service back to a
  booking-level status (`applyGroupBookingStatusChange` skips service-level siblings; tests).
- The modify form's Visit start shift sends `practitioner_id` only when the calendar was changed, so
  a date or time shift leaves each service on its own calendar.
- The schedule endpoint compares the NEW slots of services moved in the same request: two landing on
  top of each other on one calendar is a 409 unless `allow_manual_overlap` is set (test).
- Linked venues: the endpoint also gates the calendar a service is leaving (not only its target), and
  the bookings list's sibling read under a calendar-scoped link returns only rows on the link's
  calendars, as the linked-calendar route does.
- The list chip distinguishes a visit that spans days (`visit_spans_days`, other day in view) from a
  lone service whose siblings are simply not in view (`visit_rest_hidden`), with honest copy.

### Per-service colour and status on the diary (2026-09-10)

- Each bar of a visit is now coloured by its own status. The shared colour (decision above, "same
  colour", earliest service's palette on every bar) made a Start or Complete on one service look
  like every service starting or finishing together. The chip, the spine and the hover still say the
  bars are one visit.
- Three client paths were copying one service's PATCH result (status included) onto every sibling
  row: the calendar popover's `onUpdated` overlay, and the two list dashboards' optimistic and
  post-response updates. `visitSiblingOverlay` now hands siblings the visit-wide fields only
  (arrived, attendance confirmations) and the status only when `statusChangeCascadesAcrossVisit`
  says the transition cascades; `applyOptimisticStatusToBookingRows` applies the same rule. The
  server had been writing the one row since phase 1; the calendar's retained overlay never matched
  the row underneath, so the wrong colour outlived the refetch.
