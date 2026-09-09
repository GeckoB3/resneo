# Staff booking flow: "Override availability" tick box

Status: BUILT 2026-09-09 on the `staging` working tree, uncommitted (see section 9 for what
was built and the owner's decisions). Written the same day against baseline `7807cf08` plus the
day's uncommitted visit work.

## 1. What is being asked for

A tick box at the very start of the staff booking flow that switches the availability
engine off for that one booking. With it ticked, staff can book:

- any active service with any active team member, whether or not that person offers it;
- on any date, at any time, whether or not the person is working then;
- on top of anything already booked (a deliberate over-booking).

The booking then looks and behaves like every other booking: same row, same calendar
bar, same panel, same comms, same drag and resize afterwards. The tick box is the
staff member's way of saying "I know, do it anyway".

## 2. Can it be built easily?

Yes, in the sense that everything it needs already exists in pieces and nothing new has
to be stored. The work is wiring, not invention:

- **The server can already do it for walk-ins.** `POST /api/venue/bookings` with
  `source: 'walk-in'` skips the slot check and runs the engine's interval check with
  `allowBookingOverlap`, `allowOutsideHours`, `allowInsideNoticeWindow` and
  `allowDuringBreaks` all on (`src/app/api/venue/bookings/route.ts`, the `staffWalkIn`
  branch). The override is that branch made available to an ordinary staff booking, with
  two more gates relaxed (the service-to-person assignment, and leave / blocks).
- **The calendar already lets staff do all of this after the fact.** A dragged bar may
  land outside hours, over a break or over another booking (with a warning); a service
  can be moved onto a calendar that does not offer it. The tick box brings the same
  freedom to the moment of creation.
- **The flow already has staff-only affordances to hang this on:** the `staff_pick` step
  is the staff member's first screen, the duration override (`staffDurationOverrides`),
  the walk-in "Start appointment now" button that bypasses the slot list, and the
  multi-service chain builder that lays services out from a typed start
  (`buildChainFromStart`).

What makes it more than an afternoon is the size of the shared flow component
(`AppointmentBookingFlow.tsx`, 6,900 lines, shared with the public booking page) and the
number of places that currently assume "only what the engine offers": the people list,
the service list, the date calendar, the slot list, the chain validation, and two create
routes. Each needs an "override" branch, and each branch needs a test. Estimate: about
two days including tests and a live check, in three small PR-sized steps (section 7).

## 3. Verified current behaviour (anchors on the working tree)

- **Entry.** The dashboard's New / Walk-in buttons open `DashboardStaffBookingModal` →
  `StaffSurfaceBookingStack` → `AppointmentBookingFlow` with `isStaff`,
  `staffBookingSource: 'phone' | 'walk-in'`, `initialDate` / `initialTime` (now). Staff
  open on `staff_pick` ("Who is this appointment with?"), never the guest chooser.
- **People list.** `bookableStaff = catalogStaff.filter(p => p.services.length > 0)`,
  from `appointmentCatalogUrl(venue.id, …, isStaff)`: only calendars with at least one
  assigned service, each carrying only its own assigned services and prices.
- **Service list.** Per person: that person's services (`staffFirstServices`); a service
  nobody is assigned to is not offered at all.
- **Dates and times.** The month calendar marks dates with slots from
  `/api/booking/availability` (`fetchAvailability`, one call per date / person /
  service); the slot list is the engine's answer. A walk-in gets "Start appointment
  now", which sets today / now and skips straight to the review step.
- **Multi-service.** `buildChainFromStart(time)` lays the chosen services end to end
  from a start; `validateMultiServiceChain` then asks
  `/api/booking/validate-appointment-slot` per segment.
- **Create, single service.** `POST /api/venue/bookings`: for `phone`, either the exact
  slot must exist in `computeAppointmentAvailability` or (with `duration_minutes`) the
  interval must pass `validateAppointmentCustomInterval` with no flags; for `walk-in`,
  the interval check runs with the four flags on. Both then require the service to be
  assigned to the person ("Service not available with this practitioner", ~line 1199).
- **Create, several services.** `POST /api/booking/create-multi-service` validates every
  segment with `validateExactAppointmentStart` (slot must exist) for every source; only
  the same-day rule is relaxed for `walk-in`.
- **Hard blocks the engine keeps even with every flag on:** full-day leave
  (`fullDayLeavePractitionerIds`), partial leave, hand-made calendar blocks, classes and
  events on the calendar (`practitionerBlockedRanges`), and the duration limits.
- **Afterwards.** The booking row is just `calendar_id` + `service_item_id` (or the
  legacy pair); nothing checks the assignment again. Price comes from the assignment's
  override when there is one, else the service's base price. The calendar draws from the
  venue's service map, so a service the calendar does not offer still gets its colour,
  duration, buffer and processing blocks. Guest-facing reschedule runs the engine, so a
  guest cannot move an overridden booking anywhere the engine would refuse (staff can,
  from the calendar or the modify form, which already allow outside hours and overlap).

## 4. Design

### 4.1 The tick box

On the `staff_pick` step, above the people list (staff only, never on the public page):

> ☐ **Override availability**
> Book any service with anyone, on any date and at any time, even over other bookings.
> Use this to squeeze someone in. You will see what it overrides before you save.

State: `availabilityOverride: boolean`, off by default, remembered for the life of the
modal only (a deliberate per-booking decision, never sticky). Ticking it after choices
have been made keeps them; unticking it clears any choice the engine would not have
offered (a person without the service, a date or time with no slot) and returns to the
people step, so the flow never holds an impossible selection with the override off.

Available to every staff role. The calendar already lets any staff member overlap and
book outside hours by dragging, so gating the tick box on role would be a new rule with
nothing behind it. A venue setting to restrict it can come later if wanted.

### 4.2 What each step becomes with the override on

- **People.** Every active calendar the venue has (from `/api/venue/practitioners?
  roster=1&active_only=1`, which the modify form already uses), not only the ones with
  assigned services. "Any available" is hidden: there is no engine to pick for you.
- **Services.** Every active service in the venue's catalogue, with variants and add-ons,
  at the person's own price where they are assigned and the base price otherwise. A
  service the person does not normally offer is marked "Not usually offered by Ann" on its
  card so the choice is knowing, not accidental.
- **Date.** A plain date field with the month calendar left in for navigation but with
  no availability shading and every date selectable, including past dates (a booking
  taken over the phone for something that already happened is a real case; the row
  simply appears as a past booking). No availability calls are made at all.
- **Time.** A time field in five-minute steps, pre-filled from the modal's opening time.
  No slot list, no "Start appointment now" (the override covers it: pick now).
- **Duration.** The existing staff duration override, unchanged.
- **Several services.** `buildChainFromStart(time)` lays them out from the typed time
  exactly as it does for a walk-in; `validateMultiServiceChain` is skipped (nothing to
  validate against). Each service may keep its own person, as today.
- **Review step.** A "What this overrides" box listing, in plain words, what the engine
  would have refused: "Ann does not usually offer Balayage", "Outside Ann's hours (she
  finishes at 17:00)", "Overlaps Mia Graydon's 10:00 Cut & Blow Dry", "Ann is on leave
  that day", "Over Ann's break". Nothing in the box stops the save. The list comes from
  one dry run of the create route (`dry_run: true`, section 4.3) so the words are the
  server's own reasons, not a second client-side model.
- **Details, deposit, card hold, payment.** Unchanged. Staff discretion on charges works
  as it does for any staff booking.

### 4.3 Server

One additive flag on both staff-capable create routes, `override_availability: boolean`
(default false), honoured only for a staff session with `source` `phone` or `walk-in`;
a public caller sending it is refused (400).

`POST /api/venue/bookings`:

- Skip the slot / interval gate. Run `validateAppointmentCustomInterval` with the four
  existing flags on **and** with a new `allowBlockedRanges` (leave, hand-made blocks,
  classes and events) and `allowFullDayLeave`, collecting the reasons it would have
  refused for rather than failing; only the duration limits and "service or calendar is
  inactive or not this venue's" still refuse.
- Skip the assignment requirement: when no `practitionerServices` row exists for the
  pair, synthesise the offer from the service's own catalogue entry (base duration,
  price, buffer, processing blocks, variants). The booking row is written exactly as an
  assigned booking would be; the price snapshot is the base price.
- `dry_run: true` returns `{ ok: true, warnings: string[] }` without writing, so the
  review step can show them. The real create returns the same `warnings` beside the
  booking so the confirmation can repeat them.
- The `booking_created` timeline event carries `availability_override: true` and the
  warnings, so the panel's Timeline shows that the booking was squeezed in and what it
  overrode. Nothing else about the row is different, which is the point.

`POST /api/booking/create-multi-service`: the same flag, same rules per segment
(`validateExactAppointmentStart` skipped, interval check with every flag on, assignment
synthesised, warnings collected per segment), staff session required. The visit's rows
share a `group_booking_id` as they do today.

`validateAppointmentCustomInterval` gains the two new options and a `collectReasons`
mode that returns `{ ok: true, warnings }` instead of the first refusal. The existing
callers (calendar drag, modify form, visit endpoints) are untouched.

Linked venues (`owner_venue_id`): out of scope for the first version. The override
applies to the staff member's own venue; a linked booking with the flag is refused with
"Override is not available for another venue's calendar" until the grant model says
otherwise.

### 4.4 Afterwards

- Calendar, lists, panel, comms: nothing to change; the row is ordinary.
- Modify form: the person list is already the venue roster filtered to the service's
  links; a booking whose person does not offer the service must keep showing that person.
  Today the form's `practitionerOptions` effect would silently switch the calendar to the
  first person who does offer it (`useEffect` on `practitionerOptions`). Fix: always include
  the booking's current person in the options (the same rule the visit editors already
  use, `calendarOptionsForService`). This is a real bug for overridden bookings and is in
  scope.
- Guest reschedule: unchanged; the engine may offer the guest nothing, which is right.

## 5. Out of scope

- A venue-level switch to hide the tick box from non-admins (can follow).
- Overriding deposits, payment requirements or compliance gates (they are not
  availability).
- Linked-venue bookings with the override.
- The mobile app: the flag is additive and optional; documented in `MOBILE_API.md`, the
  app may adopt it later.

## 6. Test plan

1. **Engine** (`appointment-engine.test.ts`): `allowBlockedRanges` and `allowFullDayLeave`
   relax exactly those gates; `collectReasons` returns every reason in order (outside
   hours, overlap, break, leave, block) and still refuses on duration limits.
2. **Create route** (`bookings/route.override.test.ts`): public caller with the flag → 400;
   staff `phone` with the flag on an unassigned pair, outside hours, over a booking → 201
   with three warnings and a row whose price is the base price; `dry_run` writes nothing
   and returns the same warnings; the timeline event carries the override; without the
   flag the same request is still a 409 (the existing behaviour, pinned).
3. **Multi-service route**: two segments with the flag, one over a booking → 201 with the
   warning on the right segment; rollback on a failed second insert unchanged.
4. **Flow** (`AppointmentBookingFlow.override.test.tsx`): tick box present for staff and
   absent for the public flow; ticking lists every roster person and every catalogue
   service with the "Not usually offered" mark; the date and time fields replace the
   slot list and no availability request is made; the review step shows the dry-run
   warnings; the create payload carries `override_availability: true`; unticking clears an
   impossible selection and returns to the people step.
5. **Modify form**: a booking whose person does not offer the service opens with that
   person selected and keeps it (`StaffAppointmentModifyForm.override.test.tsx`).
6. **Live** (dev, plus1): book Balayage with Room 1 at 07:00 on a Sunday over an
   existing booking; the calendar draws it like any bar; Timeline shows the override and
   three warnings; drag it, resize it, modify it, start and complete it; the guest email
   lists the right person and service.

## 7. Sequencing

1. **Server first** (engine options, both routes, dry run, timeline event, tests). Ships
   dark: nothing sends the flag yet.
2. **Flow** (tick box, override branches per step, review box, tests) plus the modify-form
   fix.
3. **Docs and help**: `MOBILE_API.md` (additive flag), `Docs/README.md` row, help article
   `getting-started/new-booking` ("Squeeze a booking in"), memory.

## 8. Open questions for the owner

- Past dates: allowed as proposed, or today onwards only?
- Should "Any available" stay hidden with the override on (proposed), or pick the first
  person with the fewest bookings?
- Is "every staff role" right, or should the tick box be admin-only from day one?

## 9. Decisions and what was built (2026-09-09)

Owner's answers to section 8: no past dates (today onwards); "Any available" hidden with the
override on; every staff role; and the override must work for linked venues that have an
active collective exactly as for the venue's own calendars.

Built:

- Engine: `validateAppointmentCustomInterval` gains `allowUnassignedService` and
  `collectReasons` (every gate a staff member may book through becomes a warning; only an
  unknown person or service, a length outside the limits or an impossible processing pattern
  still refuse). `serviceItemRowToEngineService` is shared by the unified loader and
  `loadServiceItemForEngine`, which puts an unassigned service in front of the engine.
- Catalogues: `fetchAppointmentCatalog({ everyCalendarEveryService })` and
  `loadCollectiveAppointmentCatalog({ everyCalendar })` list every active practitioner calendar
  with every service (or every offering the calendar's venue provides), each with `assigned`.
  `GET /api/booking/appointment-catalog?override=1` serves them to a staff session for the
  venue (own, collective member, or `create_edit_cancel` link).
- `src/lib/booking/staff-availability-override.ts`: the actor check, the collective routing
  fallback (any provider copy at the calendar's venue), the past-date rule, the engine call in
  collect mode, the `booking_availability_override` timeline event.
- Routes: `override_availability` on `POST /api/venue/bookings`, `create-multi-service` and
  `validate-appointment-slot` (dry run, `{ ok, warnings }`, optional `duration_minutes`).
  Responses carry `availability_override_warnings`.
- Flow: `AvailabilityOverrideToggle` on the staff member's first step (person picker or
  service list); the override catalogue; "Not usually offered by …" on the service card and
  "Does not usually offer this service" on the person card; typed date (min today) and time;
  the chain checked once with the override; "What this overrides" on the review step; the flag
  on both create calls; unticking clears every choice.
- Modify form: the booking's own person is always listed (`practitionerOptions`), so an
  overridden booking no longer switches calendar on save.
- Tests: `appointment-engine.override.test.ts`, `AppointmentBookingFlow.override.test.tsx`,
  `StaffAppointmentModifyForm.override.test.tsx`. Help: `getting-started/new-booking`
  ("Squeezing a booking in"). `MOBILE_API.md` section.

### Pre-push review (2026-09-09, evening)

- A walk-in with the override on is no longer refused by the walk-in branch's own leave and block
  check (`POST /api/venue/bookings`): the override's collect-mode check stands in for it.
- The service is added to the engine input BEFORE the collective's length is applied, so an
  unassigned offering booked on a combined page gets the offering's length in the single-service
  route as it already did in the multi-service one.
- `validate-appointment-slot` applies the staff custom length after the collective and variant
  lengths, mirroring the create routes, so the dry run checks the interval that will be booked.
