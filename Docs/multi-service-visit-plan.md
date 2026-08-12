# Multi-service visits: one booking, not N rows

Status: workstreams 1, 2, 4 and 5 built; 3 (modify form) is what is left. See the
Status section at the bottom for where each one stands. Branch: `staging`.

## The problem

A multi-service visit is stored as N rows in `bookings` sharing a
`group_booking_id`. The calendar is the only place that merges them
(`clusterMultiServiceBookings` in `PractitionerCalendarView.tsx`); everything
downstream still deals in single rows. So:

- Clicking a segment calls `openGridBookingDetail` with THAT row, so the detail
  panel's time and service are one service's, not the visit's.
- The Modify form gets the same single row, so its duration is one service's.
- The group bar is rendered `canDrag={false}` with no resize handle at all, so a
  multi-service visit has no duration control.

Reference case (dev, `plus1@reserveni.com`, Fri 14 Aug 2026, David,
`group_booking_id` 44b06776):

| service | start | end |
|---|---|---|
| Cut & Blow Dry | 10:00 | 11:00 |
| Olaplex Treatment | 11:00 | 11:30 |
| Toner / Gloss | 11:45 | 12:15 |

The 11:30 to 11:45 hole is not a buffer. It was created by using the Modify form
to shorten Olaplex, which did not re-sequence the services after it. Under this
plan that edit is no longer offered and the hole cannot recur, so no data repair
is needed (confirmed one-off, dev only).

## Constraints discovered

1. **`group_booking_id` is overloaded.** It carries multi-service visits AND
   multi-person party bookings. They are distinguished by `person_label` being
   present, which `ExpandedBookingContent` already does via `isGroupPeopleVisit`.
   That check must move into the shared resolver, not stay per-caller.
2. **Price is already visit-level** ("Visit total (N services)"), so a
   visit-level facade over per-service rows has precedent. Time and duration
   simply never got the same treatment.
3. **Add-ons are not extra rows.** They live in `booking_addons` against a single
   booking and are summed into `addons_total_duration_minutes`. They only need
   the duration arithmetic to stop ignoring them.
4. **A visit is always on one practitioner** (confirmed). Clustering is per
   column, so this holds today and resize is unambiguous.

## Decisions

- **Architecture: visit facade, keep the rows.** No schema migration. Rows stay
  an implementation detail, exactly as they already are for price.
- **Duration is the wall-clock span**, exposed as ONE control per visit.
  Per-service duration editing is removed for multi-service visits (it is what
  created the hole above). Single-service bookings are unaffected.
- **Shrink comes off the tail service** down to its 5 minute floor, then
  **cascades backwards** into earlier services, each to its own 5 minute floor.
- **Grow always extends the tail service.**
- **Gaps from a service's own buffer or processing settings persist.** Gaps left
  behind by an edit must never exist: services re-sequence to stay contiguous
  apart from their configured gaps.
- **Add a service:** appended to the end, extending the visit.
- **Remove a service:** total shrinks by that service's duration and the visit
  re-sequences. Removing the last remaining service is refused (cancelling is a
  separate deliberate action with its own refund and notification rules).
- **Swap a service:** keep the original price snapshot, change only the service.
- **Notify rule** follows what already shipped: a start-time move offers
  notify / skip / undo, a duration change notifies nobody.
- **Collisions warn.** A single-booking resize passes `allow_manual_overlap` and
  silently permits an overlap. A visit can grow by an hour in one drag, so a
  move or resize that would collide with another booking on that calendar warns
  staff. The edit is still allowed (staff double-booking on purpose is
  legitimate), but it is never silent.

## Workstreams

1. **Shared resolver** (`src/lib/booking/appointment-visit.ts`). Given the rows
   of a `group_booking_id`: service visit vs party; ordered services; visit
   start, end, total minutes (including `addons_total_duration_minutes`); the
   tail row; and the re-sequencing / shrink-cascade arithmetic. Unit-tested
   directly, in the style of `src/lib/calendar/booking-corner-actions.ts`.
2. **Detail panel.** Header shows visit span, total duration and every service.
   The per-service breakdown stays below. Any segment opens the same view.
3. **Modify form.** Opens on the visit. One duration control. Service list
   editing (add / remove / swap) with per-service availability revalidation.
4. **Calendar.** Group bars gain `canDrag` and a resize handle. Resize adjusts
   per the cascade rule; move shifts every row by the same delta.
5. **Cascade writes.** A visit-level endpoint rather than sequential client
   PATCHes, so a failure part-way cannot leave one service moved and two behind.

Sequence: 1, 2, 4 are the reported bug and are self-contained. 3's service
editing is roughly as large as the rest combined and should land separately.

## Status

- **1 Shared resolver: DONE** (`8aebabde`).
- **2 Detail panel: DONE.** Visit span in `cc9152a7`; total duration and the
  service list in the header after it. Any segment opens the whole visit.
- **4 Calendar: DONE.** Move and resize in `df0aa8c7`, the all-or-nothing move
  guard in `281d1d8d`, and the notify follow-up pill in `a30006e8`. Undo restores
  the whole visit rather than the last service written (see below).
- **5 Cascade writes: DONE.** `PATCH /api/venue/visits/[groupBookingId]/schedule`
  moves a visit, changes its wall-clock span, or both, as one write: every
  service is planned (`src/lib/booking/visit-schedule-plan.ts`), then checked
  against the availability engine, then written, and a write that fails part-way
  puts back the rows that already landed. **Nothing calls it yet**; the calendar
  still uses its own dry-run plus per-row PATCHes, which is safe because
  `281d1d8d` gave it the same all-or-nothing check.
- **3a Modify form, opened on the visit: DONE.** `StaffAppointmentModifyForm`
  takes an optional `visit` (the rows, passed down from `ExpandedBookingContent`
  through `StaffExpandedBookingModifyModal`) and then edits the VISIT: the
  services are listed read-only with their planned times, the duration control is
  the whole visit's wall-clock span, and the live check plus the save both go
  through the visit endpoint. Per-service duration, service and variant editing
  are not offered on a visit, which is what closes the hole for good.
- **3b Service list editing: NOT STARTED.** The only workstream left.

### Using the visit endpoint from workstream 3

`PATCH /api/venue/visits/[groupBookingId]/schedule` takes any of
`booking_date`, `booking_time` (the visit's start; the rest follow),
`practitioner_id` (target calendar) and `total_duration_minutes` (the whole
visit's wall-clock span, gaps included). It answers 409 with a message naming
the service and the time it could not take, and leaves every row where it was.
Passing no change is legitimate and re-lays the visit, which is what closes dead
time an earlier per-service edit left behind.

`dry_run: true` plans and checks without writing, and answers in the same shape
the save does, so a form's live check and its save cannot disagree. The modify
form also uses it on open, because the rows' own span is not the visit's span
when an earlier edit left dead time in it.

Two things worth knowing before wiring it up:

- It does **not** switch off the overlap gate. The calendar's drag sends
  `allow_manual_overlap: true` and so never sees a clash with another guest; the
  endpoint defaults to refusing one, and takes the same flag to override. The
  visit's own rows are always excluded from the check, so a service is never
  reported as conflicting with the sibling it is about to follow
  (`excludeBookingIds` on `validateAppointmentModificationInterval`).
- It notifies the guest once, against the visit's first service, and takes the
  same `defer_` / `skip_booking_modification_guest_notification` flags the
  per-booking PATCH does.

Service list editing (3b) is not in it: this endpoint writes a schedule, not a
visit's contents.

### Fixed: undo after a visit move

Undo restored only ONE service, because `patchBookingMove` recorded
`lastScheduleEditUndo` per row and the loop in `patchVisitMove` left it holding
whichever service moved last. It now records one visit-level entry holding every
row's exact old slot, and undo checks all of them before writing any, the same
all-or-nothing rule as the move. Reachable from the toolbar Undo and from the
pill; both verified against the reference visit.

Still open next door: `patchVisitResize` records no undo at all, so a visit
resize shows no pill and leaves the toolbar Undo armed on whatever edit came
before it.

### Where workstream 3 stands

`StaffAppointmentModifyForm` (831 lines) is single-service throughout: one
`serviceId`, one `durationMinutes`, one `variantId`, one PATCH to
`/api/venue/bookings/{id}`. `StaffExpandedBookingModifyModal` hands it a single
row, chosen by `inferModifyBranch`. Nothing in the form knows about
`group_booking_id`.

Worth splitting in two, since the first half stops the hole recurring on its own:

- **3a. Open on the visit, one duration control.** Pass the visit's rows in
  (`ExpandedBookingContent` already resolves them as `multiServiceVisitSegments`
  and `visitSpan`). Replace per-service duration editing with a single wall-clock
  control, and re-sequence through `resequenceVisit` / `distributeVisitDuration`,
  which the calendar's `patchVisitResize` already uses.
- **3b. Service list editing.** Add / remove / swap with per-service availability
  revalidation and the price-snapshot rule on swap.

Both need workstream 5, which is now built. Sequential client PATCHes are what
tore a visit in the calendar (fixed in `281d1d8d` by dry-running every service
before moving any), and the same trap was waiting here: a duration change
rewrites every row, so a failure part-way leaves a visit half re-sequenced. 3a
sends one wall-clock duration to the visit endpoint rather than re-laying the
rows itself.
