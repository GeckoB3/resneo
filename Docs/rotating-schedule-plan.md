# Rotating schedule (multi-week working hours): plan and status

Status: IN PROGRESS (started 2026-09-02, baseline `a46fdb98` on `staging`).

## What the owner asked for

A calendar whose hours differ week by week: Monday, Tuesday and Saturday morning one week;
Tuesday to Friday the next; then the pattern repeats. Set it once for one or more calendars,
for a set number of weeks, and have it repeat a chosen number of times or until further
notice. The first idea was to express it as a repeating block of closures on top of wide
opening hours; this plan explains why it is built as a schedule instead.

## Why a schedule, not repeating closures (decision, 2026-09-02)

- Closures on the Closures tab are `practitioner_leave_periods`, which the resolver tags
  `hard`: nothing may book through them, and full-day leave survives `allowOutsideHours`.
  Working hours are tagged `hours`, which staff may deliberately book through for a walk-in.
  A rota expressed as closures would stop the owner booking themselves an off-rota
  appointment from the dashboard, which working hours allow.
- The diary renders leave as leave, and reminder suppression treats closures as closed, so a
  rota-as-closures calendar would look permanently on holiday.
- Repeating closures would have to be materialised (N cycles times M days of rows per
  calendar) and would drift when one week was edited. A rota is one small record the
  resolver evaluates on the fly.
- Rota staff think "in week one I work these hours", which is what Fresha and Timely call
  rotating shifts.

## Facts the design rests on (verified 2026-09-02)

- Every engine, month grid, diary reader and write gate computes "what hours does this
  calendar work on this date" through one function, `calendarHours` in
  `src/lib/availability/calendar-hours.ts`. Its order: per-date override wins, then a day
  off, then `working_hours` keyed by weekday. Nothing caches or precomputes availability.
- Nothing in the schema expresses a week-of-cycle or a repeat. The only recurring-closure
  concept ever built (weekday names in `days_off`) was locked out of the write surface by the
  resolver programme because the target model could not express it.
- Working hours are written only by `PATCH /api/venue/practitioners`, which raises a
  confirmation (409) when narrowing hours leaves upcoming bookings outside them
  (`src/lib/calendar/hours-change-orphans.ts`).
- The diary header line (`format-working-hours-for-date.ts`) reads `working_hours` directly;
  everything else goes through `calendarHours`.
- Resources hosted on a staff calendar intersect with the host's `calendarHours`, so a rota on
  the host reaches hosted resources automatically.

## Design

### Storage (one expand-only migration)

`unified_calendars.working_hours_rota jsonb NULL`, migration `20270203120000`:

```
{
  "version": 1,
  "cycle_start": "2026-09-07",       // a Monday; week 1 of the cycle begins here
  "weeks": [ <WorkingHours>, <WorkingHours> ],   // 2 to 6 weeks, same shape as working_hours
  "repeat_until": "2026-11-29" | null  // last date the rota applies (inclusive); null = until further notice
}
```

`working_hours` stays the ordinary weekly shape and applies before `cycle_start` and after
`repeat_until`. Decisions taken with the owner: breaks stay keyed by weekday for version one
(no per-week breaks); the editor offers "until further notice", "for N cycles" and "until a
date", and stores the resulting end date, which is what the resolver needs and what the owner
reads back.

### Resolution

`src/lib/availability/working-hours-rota.ts` (pure): `parseWorkingHoursRota` validates the
record; `rotaWeekIndexForDate` is the number of whole weeks since `cycle_start` modulo the
cycle length, or null outside the window; `effectiveWorkingHoursForDate(row, date)` returns the
rota week's hours or the ordinary weekly hours. `calendarHours` calls it in place of its direct
`working_hours` lookup, so the rota sits exactly where the plan's §2.4 puts weekly hours:
below per-date overrides and days off, tagged `hours`, skippable by `allowOutsideHours`.

### Write surface

`PATCH /api/venue/practitioners` accepts `working_hours_rota` (the record or null to remove),
validated to the shape above (Monday start, 2 to 6 weeks, end on or after start). The
narrowing-hours confirmation compares old and new effective hours through `calendarHours`, so
a rota that leaves bookings outside its hours is confirmed the same way a plain hours change
is. Staff may set a rota on calendars they manage, as they may set hours.

### Availability tab

Under the weekly hours editor, per calendar: "This calendar works a rotating schedule"
switch; cycle length; the Monday week one starts; the shared weekly hours control once per
week (Week 1, Week 2 tabs), with the venue-hours context each day already shows; repeat as
until further notice, for N cycles (end date shown in words) or until a date; Save, and
Remove. "Copy this rota to other calendars" reuses the apply-to-all pattern that breaks use
(one PATCH per calendar).

The diary header line uses the effective hours for the date; break blocks, the month grid,
hosted resources and the public booking page all read through `calendarHours` and need no
change.

## Out of scope

- Per-week breaks (weekday-keyed breaks apply to every week).
- Rotas on resource calendars' own hours (a resource follows its host's rota already).
- The pending Stage 6a editor consolidation; the rota editor is built on the shared
  `WorkingHoursControl` so that work absorbs it.

## Progress (2026-09-02)

- [x] Migration `20270203120000_calendar_working_hours_rota.sql`
- [x] `working-hours-rota.ts` + tests; `calendarHours` reads the rota; resolver tests
      (`calendar-hours.test.ts`, `hours-change-orphans.test.ts`)
- [x] Route: schema (`rota-validation.test.ts`), staff and admin write paths, narrowing
      confirmation through `calendarHours`
- [x] Roster and diary carry the field; diary header uses effective hours; hosted resources
      follow the host's rota
- [x] Availability tab editor (`RotatingScheduleEditor.tsx` + test) with copy to calendars
- [x] Help centre section in "Business & calendar hours", README row, schema inventory

Owed: apply the migration to staging, test the Availability tab, the diary header and a
booking page against a rota calendar live, apply to production, merge. Until the column
exists, saving a rota fails at the database; reading is unaffected (the column is absent, so
every calendar resolves as it does today).
