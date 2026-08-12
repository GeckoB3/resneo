# Disabled booking models must be inert

Status: agreed, not implemented. Branch: `staging`.

## Root cause

`appointment-engine.ts` contains **zero** references to `enabled_models` or
`venueExposesBookingModel`. It folds resource, class and event windows into
`practitionerBlockedRanges` unconditionally, so turning a model off stops the
grid DRAWING it but does not stop it BLOCKING.

Found via a real case: dev, `plus1@reserveni.com`, Fri 14 Aug 2026, calendar
`39ed91a4` (David). A bookable resource occupied 14:00 to 17:00 while the
resource model was off. The grid drew nothing there, and the engine refused
every appointment in the window with the generic reason "Blocked time". Staff
could not see the constraint they kept hitting.

Ruled out on the way: breaks ("Conflicts with a break"), leave ("Staff is on
leave at this time") and scheduled sessions ("Overlaps a scheduled class or
event") are all tagged and produce distinct messages. RLS is not involved: the
policies on `practitioner_calendar_blocks` and `calendar_blocks` are both plain
`venue_id IN (SELECT venue_id FROM staff ...)`. The grid's endpoint already
merges both block tables and correctly returned none, because the block was
never in either table.

## Requirement

1. While a model is off, it neither appears on the calendar nor blocks anything.
2. A model cannot be turned off while it has active future bookings. The refusal
   names the model and says why, rather than failing silently or generically.

## Surfaces

1. **Engine** (`fetchCalendarAppointmentInput`, `fetchAppointmentInput`). Thread
   the venue's primary + enabled models in and skip the contributions of any
   disabled model when assembling blocked ranges. This is the fix that matters:
   without it the other two only hide the symptom.
2. **Calendar grid.** Do not render columns or blocks belonging to a disabled
   model. Partly true today, which is exactly why the block was invisible rather
   than merely surprising.
3. **Settings** (`BookingTypesSection.tsx`). Guard the toggle server-side, not
   just in the UI, since the model flag is writable through the settings API.

## Decisions

- **"Active future booking"** = status not Cancelled, starting after now,
  including later the same day. A class at 16:00 blocks disabling classes at
  14:00; this morning's finished class does not.
- **The guard is server-side.** The model flag is writable through the settings
  API, so a check that lived only in `BookingTypesSection` would be bypassable
  and would leave exactly the invisible-block state this work exists to remove.
  The UI still needs the message, but the refusal belongs on the route.
- **No migration or backfill.** Only test users have used models other than
  appointments, so no venue is stranded by enforcing this.

## Still to settle during implementation

- The refusal message names the model and why. Worth including the count and
  the next affected date, since "you have future bookings" without a date sends
  staff hunting.
