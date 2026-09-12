# R35 web response: a left-behind booking can be edited again (2026-09-12)

Reply to the app's R35 handover (app repo `C:\Resneo-app`). Web repo `C:\Resneo`, from
`79111976` ("Stopping a calendar offering a service keeps its existing bookings").

## Confirmed, and reproduced

Your reading of the web code is correct on all three points: the offered-services set is
link-derived with no fallback, no override relaxes that gate, and every schedule-shaped PATCH
runs the validator. In the unified path it is worse than the call sites suggest:
`fetchCalendarAppointmentInput` builds the service catalogue FROM `calendar_service_assignments`,
so once the link is gone the service row is not loaded at all.

Reproduced on the dev venue before changing anything. Beard Trim on calendar "Andrew", one
booking at 10:00, link removed through the new dialog with "leave these bookings here":

| Request | Before |
| --- | --- |
| dry run, same column, 10:00 to 10:10 | `Service not available with this staff member` |
| `PATCH /api/venue/bookings/[id]`, same move | 409 `Service not available with this staff member` |

So a ten minute nudge on the column it was already sitting on. Exactly as you described.

## The fix

`src/lib/booking/validate-appointment-modification.ts`. The offered-services check now applies to
the pair being CHOSEN, not to one that is merely being CARRIED, which is the rule you proposed.

How it decides: when the calendar does not currently offer the service, the validator reads the
booking row itself (`bookings.calendar_id ?? practitioner_id`, `service_item_id ??
appointment_service_id`) and treats the edit as exempt only when both match the target. It reads
the row rather than trusting a caller-passed pair, so no call site can get it wrong and none of
the six had to change. One extra read, and only on the path that used to refuse outright.

Your two open questions:

- **Sizing.** The base `service_items` / `appointment_services` row, with no per-calendar override
  merged in, exactly as you suggested. We did not have to invent it: the engine already has
  `allowUnassignedService`, whose fallback is `services.find(...)` on the base row, built for the
  staff "override availability" booking. The validator now sets that flag for a carried pair and
  passes it to both interval runs, so the answer and the hours reporting stay consistent.
- **Variants.** Covered. The base row is put in front of the engine BEFORE
  `applyVariantToAppointmentInput` runs, so the earlier refusal cannot fire either. Verified with
  a real variant booking (Haircut / Short Hair), both with the variant sent explicitly and with it
  inherited from the booking.

Two things we extended beyond the ask, both deliberate:

- **A parked service is exempt on the same terms.** `is_active = false` produces an identical
  refusal for an identical reason, and archiving a service is an everyday gesture. The catalogue
  row is loaded without the `is_active` filter.
- **The whole visit path comes with it**, since `visits/[groupBookingId]/schedule` and
  `.../services` call the same function.

What is still refused, verified case by case on the dev venue:

| Edit | Result |
| --- | --- |
| carried pair, same column | allowed |
| moved to a column that does not offer the service | `Service not available with this staff member` |
| moved to a column that does offer it | allowed |
| a different booking switched TO the unlinked service on that column | `Service not available with this staff member` |
| the same, for a parked service | `Service not available with this staff member` |

Nothing new can reach a calendar that does not offer it.

## The second half, which the handover did not reach

A left-behind booking kept its start and end but stopped holding its BUFFER, and the calendar
offered that buffer to the next guest.

`fetchCalendarAppointmentInput` measures existing bookings through a service map built from the
same link-derived catalogue. With the link gone there is no row, so `mapRowToAppointmentBooking`
fell back to `buffer_minutes: 0` (the core span survived only because `booking_end_time` is on the
row). Proven on the dev venue with "Buffer Time Test", a 30 minute service with a 30 minute
buffer, booked 15:30 to 16:00 on 2026-09-22 with another appointment at 16:30, so the 16:00 to
16:30 gap is held by the buffer alone:

| Probe: place a 15 minute appointment at 16:00 | Result |
| --- | --- |
| link present | `Conflicts with another booking` |
| link removed (before the fix) | **allowed** |
| link removed (after the fix) | `Conflicts with another booking` |

Fixed in `src/lib/availability/appointment-engine.ts`: any service referenced by the day's
bookings but missing from the calendar's catalogue is now loaded for MEASUREMENT only. It is not
added to `services`, so the calendar still offers nothing new for it, and the query only runs when
such a booking exists. This one also affects the public booking page, which was offering the
buffer minutes of a left-behind appointment.

## Your interim copy question

Do not ship it. The dialog's promise is now true, so a warning saying those bookings cannot be
rescheduled would be wrong the moment this deploys. We have not added any such line on the web
side, so there is nothing to match word for word.

## What the app sends: no web change needed

All four bullets match the web contract, including `allow_manual_overlap: false` and the explicit
`booking_end_time`. Two notes rather than corrections:

- `affected_bookings` is capped at 200 rows (`SERVICE_REMOVAL_BOOKING_SAMPLE_LIMIT`) while
  `affected_total` stays exact, which is what your truncation handling assumes. Anything beyond
  the cap is asked about again on the next save, so nothing is removed unseen.
- A separate web fix today that your flow may share: cancelling the confirmation used to leave the
  service form showing the calendar as unticked, so the owner believed the removal had happened
  when the 409 had written nothing. The web dialog now restores the ticks the confirmation was
  about on cancel, and keeps the other edits in the form. Worth checking
  `useServiceRemovalFlow.ts` for the same staleness.

## Status

Built on the web `staging` working tree on 2026-09-12. `tsc --noEmit`, eslint and the unit suites
pass, including six new cases in `src/lib/booking/validate-appointment-modification.test.ts`. All
of the live checks above were run against the dev venue and the fixture was returned to its
original state afterwards. Not yet committed or deployed; it goes out with the owner's next
staging push.
