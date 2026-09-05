# R24 web response (2026-09-05)

Reply to the two handovers in the app repo (`C:\Resneo-app\Docs\CARD_HOLD_FLAG_RETIREMENT_WEB_HANDOVER.md`
and `C:\Resneo-app\Docs\R24-6_WEB_HANDOVER.md`), from the web repo on `staging`.

## 1. `card_hold_deposits` compatibility key: shim stays, retirement recorded

Noted, and nothing removed. The web keeps serving `resolved.card_hold_deposits = true` on
`GET /api/venue` and on the `GET` and `PATCH` responses of `/api/venue/feature-flags` until the
app side says the "ResNeo R24 Web Parity" update (EAS group 556bbef3, runtime 1.1.0) is the
minimum in use. The deletion list from the handover (the `RETIRED_FLAGS_SERVED_AS_ON` shim and
its two helpers in `src/lib/feature-flags/resolve.ts`, the re-export, the three call sites, the
"keeps serving" test, and the two doc sentences) is recorded on the web side so the removal is a
single step when the word comes.

## 2. R24-6: four additive fields on `GET /api/venue/calendar-grid` booking rows

Done, on `staging`. Each booking row now also carries:

| Field | Value |
| --- | --- |
| `appointment_service_id` | `bookings.appointment_service_id`, null when absent |
| `service_item_id` | `bookings.service_item_id`, null when absent |
| `service_variant_id` | `bookings.service_variant_id`, null when absent |
| `processing_time_blocks` | the snapshot taken at create, as `[{ id, start_minute, duration_minutes }]`; null when the row has none |

Precedence matches the web diary's `bookingProcessingBlocksForLayout`: a stored snapshot wins
even when it is empty (a booking whose gap was deliberately removed) or malformed (served as
`[]`), and only a missing snapshot is null, which is the signal to derive the gaps from the
service's or the variant's own `processing_time_blocks`. Nothing else on the route changed.

Where it lives: `getCalendarGrid` in `src/lib/unified-availability.ts` (select, row type,
output, and the `CalendarGridBooking` interface), with tests in
`src/lib/unified-availability.calendar-grid.test.ts` ("processing snapshot columns") and a
section in `Docs/MOBILE_API.md` ("Processing snapshot on calendar-grid rows").

Commit: `e116f8d8` on `staging` ("Calendar grid: serve the service ids and processing snapshot
on booking rows"), the first commit after `cff80edb`, where the app repo's mirror stands.

Related, in case the port of `booking-cluster-layout.ts` starts from the mirror: `cff80edb`
(#177, 2026-09-05, already in the mirror) changed the nesting rule so a booking that starts inside a gap and
stays inside it for as long as the host lasts nests even when it finishes after the host, and
the host's lane stays reserved until the nested booking ends. The tests in
`src/lib/calendar/booking-cluster-layout.test.ts` cover both.
