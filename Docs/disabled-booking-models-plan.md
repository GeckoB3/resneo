# Disabled booking models must be inert

Status: done. Branch: `staging`.

The engine was the only thing actually broken. The grid was already correct, and
the settings guard already existed and worked; it needed a better refusal and the
tests it never had. See the surface notes below before assuming otherwise.

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
3. **Calendar grid.** ALREADY CORRECT, nothing was needed. Resource calendars are
   excluded from grid columns unconditionally (`columnPractitioners` in
   `PractitionerCalendarView.tsx`, which merges a resource into its host column
   instead), and the `/api/venue/resources` fetch is already behind
   `venueExposesBookingModel(..., 'resource_booking')`. The grid was never drawing
   the block. The engine was disagreeing with the grid, and the engine was wrong.
   Note that `/api/venue/practitioners?roster=1` does still return resource
   calendars whatever the models say, but no grid column comes of it, and the
   admin screens that manage those calendars need the unfiltered list.
4. **Settings** (`BookingTypesSection.tsx`). The server-side guard ALREADY EXISTED,
   in `src/lib/booking/venue-booking-model-disable-guard.ts`, wired into
   `PATCH /api/venue` and answering 409. It shipped in `d717b237` (April 2026).
   Verified firing. What was missing is below.

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

## The refusal message

Settled. It now names the model, the count and the next affected booking:

> Appointments cannot be turned off yet. You have 12 upcoming bookings of that
> type, the next on Thu 13 Aug 2026 at 9:30am. Cancel or complete them first,
> then try again.

Two things that had to change to get there. The guard used to throw on the first
matching row the query returned, which is arbitrary order, so it could not name the
NEXT booking, only some booking. It now tallies every match before reporting. And
the date is assembled by hand rather than through `toLocaleDateString`, whose
separators move with the runtime's ICU data; this is copy an owner reads, so it
should not depend on which Node the server is running.

The guard had no tests at all despite being a refusal path on a settings route.
It has eleven now, including the recorded same-day rule (a booking later today
blocks the toggle, this morning's finished one does not).
