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

## Open questions

- **"Active future booking"**: presumably status not in (Cancelled, No-Show) and
  starting after now. Confirm whether today's earlier bookings count.
- **Blocking vs warning on the toggle**: the requirement says refuse. Should a
  venue with only PAST bookings for a model be free to disable it (yes, on the
  above definition) and should the refusal offer a link to the offending
  bookings?
- **Existing data**: venues that already disabled a model while holding future
  bookings for it are in the state this guard would have prevented. Decide
  whether to report on them before enforcing.
