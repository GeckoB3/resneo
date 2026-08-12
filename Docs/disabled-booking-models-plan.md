# Disabled booking models must be inert

Status: the engine is fixed. The grid and the settings guard are still open.
Branch: `staging`.

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

1. **Engine** (`fetchCalendarAppointmentInput`, `fetchAppointmentInput`). DONE.
2. **Month engine** (`appointment-month-availability.ts`). DONE. Not in the
   original plan and worth knowing about: it carries its own copy of the same
   assembly, including a duplicate of the class/event fetching. Left alone it
   would have greyed out days on the public booking calendar that the day view
   then offered.
3. **Calendar grid.** Do not render columns or blocks belonging to a disabled
   model. Partly true today, which is exactly why the block was invisible rather
   than merely surprising. STILL OPEN.
4. **Settings** (`BookingTypesSection.tsx`). Guard the toggle server-side, not
   just in the UI, since the model flag is writable through the settings API.
   STILL OPEN.

## How the engine fix went in

`src/lib/availability/blocked-range-models.ts` resolves the venue's models into
three switches: resources, classes, events. Notes on the shape, since the plan
had assumed something different:

- **Resolved inside the fetch functions, not threaded in.** The plan said to
  thread the models through as a parameter. `fetchAppointmentInput` has around
  fifteen call sites, and a missed one fails silently toward ACCEPTING bookings.
  Both fetch functions already had `supabase`, `venueId` and a `venues` query, so
  the columns were added to the query that was already there. No call site
  changed, and there is nothing to half-apply.
- **Not routed through `resolveVenueMode`**, which caches for 30 seconds. A model
  that keeps blocking for another half-minute after being switched off fails the
  requirement outright. Confirmed live: the toggle took effect immediately.
- **Failure keeps blocking.** If the venue row cannot be read, every source stays
  on, which is the old behaviour. Refusing a booking that should have been allowed
  is visible and recoverable; accepting one onto held time is not.
- **Classes and events gate separately**, so a venue with classes off and events
  on gets the right answer for each.
- **Resource ranges now carry `kind: 'resource'`** and report "Overlaps a resource
  booking". They were the only untagged source, which is why an ENABLED resource
  window also said nothing more than "Blocked time".
- The `sources` parameter on both session-block fetchers is **required, not
  defaulted**, so a new call site cannot quietly reinstate unconditional blocking.

Verified on the reported case (Plus 1, Fri 14 Aug 2026, David's calendar, Room 1
hosted on it). Resource model on: 21 slots, nothing offered between 13:30 and
17:00. Resource model off: 34 slots, the whole 14:00 to 16:45 window offered.
Toggled back on: 21 slots again.

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
