# Amended hours for one calendar: plan and status

Status: IMPLEMENTED on the `staging` working tree (written and built 2026-09-09, baseline `7807cf08`). No migration.

## What the owner asked for

A venue can already set amended hours for a date: open late for an event, close early, open
on a day the venue does not normally trade. A single calendar cannot. The Availability tab
sets a calendar's weekly hours and plans changes ahead (whole weekly shapes from a Monday),
and the Closures tab takes time out (all day or part of a day). What is missing is the
opposite of a closure: "on this date, or these dates, this calendar works these hours",
whether that is a day the person does not normally work or a longer day than usual.

The owner asked where this belongs, and whether the "Plan your hours ahead" calendar could
be the way to pick the dates.

## Decision: the Closures tab, mirroring the venue's Business closures (2026-09-09)

Put it on the **Closures** tab as a sibling of calendar closures, not on the planning
timeline.

- **It matches the venue's mental model.** Venue side: the Business hours tab is the rule,
  the Closures & special days card is the dated exceptions, and that card offers "Closure"
  and "Amended Hours" side by side with one date picker. Calendar side today: the
  Availability tab is the rule (weekly hours plus hours planned ahead), the Closures tab is
  the dated exceptions, but only the closing kind. Adding "different hours" there completes
  the symmetry: *Availability is what normally happens, Closures is what happens on
  specific dates instead.*
- **The timeline is the wrong shape for a single date.** A schedule period is a whole
  weekly pattern running Monday to Sunday, with cycle bookkeeping, and `insertSchedulePeriod`
  trims and splits neighbours. "Work this one Saturday" would be a one-week period copying
  the existing hours with Saturday changed, splitting whatever period it lands in. It would
  work, and it would litter the timeline and the planning calendar with periods that are
  really exceptions. An exception sits *above* periods in precedence, not among them.
- **The leave panel already has the interaction.** Pick a day or a range on the month grid,
  fill in a form, see it in the Upcoming list. The new entry is the same gesture with a
  different form body.
- **The planning calendar still earns its place**, as the owner suspected: it should *show*
  an amended day (it already shows leave and venue closures), and picking one there names
  the rule and links to the Closures tab. Showing is its job; writing exceptions is not.

## Facts the design rests on (verified 2026-09-09)

- **The data model already exists and every engine already reads it.**
  `unified_calendars.availability_exceptions` is a per-date map keyed `YYYY-MM-DD`, each
  value `{ closed: true }` or `{ periods: [{ start, end }] }`. `calendarHours` in
  `src/lib/availability/calendar-hours.ts` reads it FIRST: a per-date Hours override
  REPLACES the weekly baseline, the schedule periods and `days_off`, which is the same rule
  venue amended hours follow (resolver plan §2.2). `getWorkingRanges` in the appointment
  engine is `calendarHours`, so the booking engines, the diary's grey closure stripes
  (`buildPractitionerScheduleClosureBlocks`), the class and event validators and the
  linked-calendar route all honour an override the moment the row carries one. There is
  a unit test for the precedence (`calendar-hours.test.ts`, "per-date overrides").
- **Only resources write it today.** `POST/PATCH /api/venue/resources` validate and store
  it; `ResourceTimelineView` edits it. No staff-calendar screen or route writes it, and
  `GET /api/venue/practitioners` does not even return it (`unifiedCalendarToPractitionerRow`
  omits the column), so the diary's `Practitioner` rows never carry one. That is the only
  reason the diary would not draw an override today.
- **The resolver plan anticipated exactly this.** Its `[R3-94]` correction (line 780):
  "point the date-override panel at `availability_exceptions`". Decision (L) merged staff
  and resource date overrides into one panel in principle; the resource half stays deferred
  for the reason recorded at `AppointmentAvailabilitySettings.tsx` (`[R3-89]`: nothing
  reads leave for a resource). This plan does not change that deferral.
- **`calendar_date_overrides` exists and expects this.** Migration `20270114120000` (applied
  to staging and production) created the Stage 6 target table with
  `override_kind IN ('closed', 'hours')`, a `periods` column
  (`[{"open","close"}]`), `notes`, date ranges, and a CHECK that an `hours` row carries
  periods. Leave is dual-written into it fail-soft
  (`src/lib/availability/calendar-date-overrides-mirror.ts`); `practitioner_leave_periods`
  stays authoritative and nothing reads the table yet. An `hours` row has never been
  written.
- **Leave outranks hours.** Leave is `hard` and checked in the engine above the hours gate,
  deliberately outside the calendar-hours module (its header explains why). An Hours
  override under full-day leave never takes effect.
- **Venue hours still gate guests.** A calendar's hours only sell where they fall inside the
  venue's resolved hours for the date (`resolveVenueWideAllowedMinuteRanges`). Opening a
  calendar on a Sunday the venue is closed lets staff book (`allowOutsideHours`) and shows
  guests nothing until the venue's own Closures & special days amend that date too. The
  Availability tab already says this in prose and per weekday
  (`calendarHoursOutsideVenue`).
- **Narrowing hours warns, closures refuse.** `PATCH /api/venue/practitioners` returns
  `409 requires_confirmation` naming upcoming bookings a weekly-hours change would strand
  (`hours-change-orphans.ts`), and the editor asks before saving anyway. A leave save
  over a booking is refused outright (`closure-booking-conflicts.ts`). An amended day is
  an hours change, so it warns.
- **The diary header reads the weekly shape directly.**
  `PractitionerCalendarView.tsx` builds the column header line from
  `effectiveWorkingHoursForDate(col.practitioner, date)`, which knows about schedule
  periods but not overrides (or `days_off`). The grid beside it goes through
  `calendarHours`. On an amended day the two halves would disagree.
- **The planning calendar reads periods only.** `summariseDay` in
  `ScheduleCalendarPreview.tsx` resolves `resolveScheduleForDate` plus leave, days off and
  the venue; it has no input for overrides.
- **The mobile app carries its own copy of the schedule resolver** (`resolveScheduleForDate`
  ported into `app/(app)/availability.tsx`) and edits hours and closures through the same
  routes. It is a separate repository; see "Handover" below.

## Design

### Storage

`unified_calendars.availability_exceptions[date] = { periods: [{ start, end }], reason? }`,
one key per date in the chosen range. The override type in `calendar-hours.ts` is already
open-ended (`Record<string, unknown>` is a member of the union), so `reason` rides along and
the resolver ignores it. No migration.

`{ closed: true }` keys are not written for staff calendars by this work (closures stay in
`practitioner_leave_periods`). If one is present on a staff calendar, the month grid draws
the date as closed rather than hiding it, since the engines honour it; it is not listed or
editable here.

**Mirror.** Every write rebuilds the calendar's `hours` rows in `calendar_date_overrides`:
delete `WHERE calendar_id = ? AND override_kind = 'hours' AND source_leave_id IS NULL`,
insert one row per run of consecutive dates with identical periods and reason, `periods`
converted to the table's `{open, close}` shape, `notes` from `reason`. Fail-soft, in the
same module and with the same reporting as the leave mirror, for the same reason: the JSON
column is authoritative and a mirror problem must never fail a save. Rebuilding from the
whole map (rather than editing rows) means the mirror is always a function of the
authoritative value and self-repairs on the next write.

### Precedence (unchanged, now stated for the form)

1. Leave (`hard`): a full-day leave hides the override completely; part-day leave blocks its
   window inside the override.
2. Per-date Hours override (this work) or Closed override.
3. `days_off`.
4. Schedule period for the date, else weekly `working_hours`.
5. Then the venue's resolved hours intersect everything above for guests.

### Write surface: `/api/venue/calendar-amended-hours`

A dedicated route, not more keys on `PATCH /api/venue/practitioners`: that PATCH replaces
whole columns and would make two people editing different dates clobber each other, and its
staff allowlist is deliberately narrow. Auth mirrors `practitioner-leave`: admin may target
any active host calendar or `apply_to_all_active`; staff only calendars in their managed set
(`requireManagedCalendarAccess`), never all. Resources are refused with 404 as the leave
route refuses them (`requireVenueHostCalendarId`).

- `GET ?practitioner_id=&from=&to=` returns `{ entries }`, each
  `{ calendar_id, calendar_name, date_start, date_end, periods, reason, kind: 'hours' | 'closed' }`,
  runs of consecutive identical dates grouped so the panel lists "16 to 20 Sep, 08:00 to
  20:00" as one line. Without `practitioner_id`, admins get every host calendar, staff their
  managed set.
- `PUT` body `{ practitioner_id | apply_to_all_active, date_start, date_end, periods, reason?, replace? }`
  sets the keys for every date in the range. `replace: { date_start, date_end }` names the
  run being edited; its keys are removed first so shortening a run does not leave stragglers.
  Validation: ISO dates, `date_end >= date_start`, at most 92 dates, `HH:mm` periods with
  `end > start` (no past-midnight, resolver plan §2.3), at least one period, periods merged
  when they overlap, `reason` at most 200 characters.
  - **Leave check:** if any date in the range carries full-day leave on that calendar,
    refuse with 409 naming the first such date: "Sarah is closed all day on Mon 21 Sep.
    Remove that closure first, or shorten the range." Part-day leave is allowed; the form
    shows it as a note.
  - **Orphan check:** `findBookingsOrphanedByHoursChange` with `calendarColumnId`, old and new
    `PeriodsForDate` built from `calendarHours` on the row before and after, and
    `skipDate` for dates outside the range. Returns the same `409 requires_confirmation`
    shape as the practitioners PATCH, bypassed by `?acknowledge_affected_bookings=true`.
- `DELETE` body `{ practitioner_id, date_start, date_end }` removes the keys in the range.
  No booking check: removing an override restores the weekly hours, which is the same act as
  editing weekly hours, and a booking stranded by that is grandfathered like any other.

### Closures tab

`StaffLeaveCalendarPanel` becomes the panel for both kinds. Heading "Calendar closures
and amended hours". The form gains a choice at the top:

- **Closed** (existing: blank times = all day, times = that window each day)
- **Working different hours**: the period rows used by the venue's amended-hours form
  (open and close, add another period), an optional note, and the same "Apply to all active
  calendars" checkbox for admins.

Month grid: `ResourceExceptionsCalendar` in `calendar_unavailability` mode learns the
`{ periods }` value it already draws in venue mode (amber, "Hrs"), with an "Amended hours"
legend entry. A day that carries both leave and an override shows leave, since leave wins.

Upcoming and Past lists interleave both kinds by date, with an "Amended hours" chip and the
periods on the line. Editing a run loads it back into the form; Delete removes it.

Two notes on the form, computed as the dates and periods change:

- **Venue hours.** For each date in the range, the venue's resolved ranges
  (`resolveVenueWideAllowedMinuteRanges` with the venue's weekly hours and its
  availability blocks). If any period falls outside on any date: "Your venue is closed on
  Sun 27 Sep" or "Hours outside 09:00 to 17:00 on Tue 22 Sep are not bookable by guests",
  with the link to Settings → Business hours. Saving is still allowed, exactly as the
  weekly editor allows hours outside the venue's; the note is the difference between a
  surprise and a decision.
- **Leave.** Part-day leave inside the range is named ("Sarah is unavailable 14:00 to 15:00
  on Tue 22 Sep; that window stays blocked"). Full-day leave is named too, and the API
  refuses the save.

### Readers that change so the diary agrees with itself

1. `GET /api/venue/practitioners`: `unifiedCalendarToPractitionerRow` returns
   `availability_exceptions`. This alone makes the diary's closure stripes and every
   engine-side check on the dashboard honour overrides.
2. Diary column header: a new `formatResolvedHoursLineForDate(ranges, venueRanges)` in
   `format-working-hours-for-date.ts`, fed from `calendarHours(col.practitioner, date)`, so
   the line shows the amended hours (and "Closed" on a day off, which it never did). Linked
   columns keep the weekly formatter: their rows come from another venue's route.
3. Planning calendar: `summariseDay` takes `overrides` (the calendar's map) and returns
   `reason: 'amended'` with the override's hours inside the venue's; the cell carries an
   "Amended" chip; the side panel names the rule and links to the Closures tab. The
   Availability tab passes `selectedPrac.availability_exceptions`, and the Closures tab
   tells the page to reload practitioners after a save so the preview is current.
4. `calendarWorkingMinutesForDate` in `hours-change-orphans.ts` resolves through
   `calendarHours` rather than `effectiveWorkingHoursForDate`, and the practitioners PATCH
   selects `availability_exceptions` and `days_off` into the row it compares. On an amended
   date old and new resolve identically, so a weekly-hours change stops warning about
   bookings on a date it does not touch.

### Tests

- `src/lib/availability/calendar-amended-hours.test.ts`: applying a range to a map
  (including `replace`), removing a range, grouping runs, period normalisation and
  refusals, mirror rows from a map.
- `schedule-closure-blocks.test.ts`: a calendar with an override greys outside the override
  on that date and is unchanged on other dates.
- `ScheduleTimelineEditor.test.tsx`: `summariseDay` with an override, and leave beating it.
- `format-working-hours-for-date.test.ts` (new or extended): the resolved-line formatter.
- Route: a request-level test of the leave refusal and the orphan 409, following the
  pattern of the existing `route.*.test.ts` files where one exists for a sibling route.

### Help centre

`appointments/working-hours.ts` ("The Closures tab") and
`getting-started/business-and-calendar-hours.ts` gain the steps for amended hours on one
calendar, the leave-wins rule and the venue-hours note. `api-venue-permissions-matrix.md`
gains a row for the new route.

## Out of scope

- Resources: they keep their own editor in `ResourceTimelineView`, per `[R3-89]`.
- Recurring amended hours ("every third Saturday"): that is a schedule period.
- A "closed" override for staff calendars: closures stay leave.
- Reading `calendar_date_overrides` anywhere: Stage 6b's cut-over, not this.

## Handover: the mobile app (separate repository)

`Resneo-app` edits hours, breaks and closures through the same routes and has ported
`resolveScheduleForDate`, so its per-date summaries will not show an amended day until it
also reads `availability_exceptions` (returned by `GET /api/venue/practitioners` after this
work) in whatever it uses for per-date hours. Additive on the API side; no app change is
needed for anything to keep working.

## Progress

- 2026-09-09: plan written, then built the same day. As built:
  - `src/lib/availability/calendar-amended-hours.ts` (pure: map edits, run grouping,
    period normalisation, leave check, mirror rows) with tests.
  - `src/app/api/venue/calendar-amended-hours/route.ts`: GET, PUT, DELETE as designed,
    including the full-day-leave refusal (409) and the orphan `409 requires_confirmation`.
  - `mirrorCalendarHoursOverrides` in `calendar-date-overrides-mirror.ts`, rebuild-per-write.
  - `GET /api/venue/practitioners` returns `availability_exceptions`; the PATCH's orphan
    check and `calendarWorkingMinutesForDate` resolve through `calendarHours`.
  - Diary column header: `formatResolvedHoursLineForDate` fed from `calendarHours`.
  - `ScheduleCalendarPreview.summariseDay` takes `overrides`, reason `amended`, chip on
    the cell; the timeline editor's side panel names the rule and links to the Closures tab.
  - `StaffLeaveCalendarPanel`: "Closed" / "Working different hours" choice, up to three
    periods, notes, apply-to-all, venue-hours and leave notes, unified Upcoming and Past
    lists; `ResourceExceptionsCalendar` draws `{ periods }` in calendar mode.
  - Help: `appointments/working-hours` and `getting-started/business-and-calendar-hours`;
    `api-venue-permissions-matrix.md` row.
  - Verified live on the dev venue (plus1, calendar Andrew, Sun 27 Sep 2026 amended to
    10:00 to 14:00 against weekly 09:00 to 17:00): the Closures tab saves and lists it, the
    JSON key and the `hours` mirror row are both present, the planning calendar shows the
    chip and the rule, the diary header reads the amended hours and the grid greys outside
    them. The test entry was removed afterwards.
- Same day: the tab itself was renamed **Closures & amended hours** (label, help articles, both help figures). Tab labels no longer wrap; on a phone the strip wraps to a second row.
- Not done, by design: resources (own editor), a `closed` override for staff calendars,
  any reader of `calendar_date_overrides`. The mobile app handover above still stands.

### Pre-push review (2026-09-09, evening)

The Closures tab's save handlers return whether they saved; a validation message (or a declined
narrowing confirm) now stays on screen with the draft intact instead of being cleared by the
reset that followed. `canonicalServiceShape` and the backfill leave a service alone when the merged
tail would exceed the 480 minute cap, so a rewritten row always passes validation.
