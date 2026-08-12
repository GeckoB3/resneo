# Multi-service visits: one booking, not N rows

Status: agreed, not yet implemented. Branch: `staging`.

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
