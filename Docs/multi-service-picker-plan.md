# Multi-service picker: choose every service first, then the times

Status: implemented on staging 2026-09-02. Replaces the "pick one service, pick a time, then add another" system.

## What changes for the person booking

1. The service step lets the guest tick up to four services (`MAX_SERVICES_PER_VISIT`). A summary bar at the foot of the list shows the count, total time and "from" price, with a Continue button. Tapping a ticked service unticks it. Each service can be chosen once per visit.
2. Options (variants, add-ons) are asked for each chosen service in turn, first service first, before the times. On a normal venue page that happens before the practitioner step; on a combined page after the calendar is chosen; on staff-first and per-practitioner pages straight after the list.
3. The practitioner step lists only people who offer every chosen service. "Any available" pools only those people.
4. The date and time step asks the server for starts where the whole chain fits back to back on one person (`services` parameter on `GET /api/booking/availability`). The month view treats the visit as one block of the total length, so a green day can still show no times when breaks or buffers split the day; the day view is exact.
5. The review step ("Review your services") keeps remove and edit-extras. "Add another service" is replaced by "Change services", which returns to the picker with the current choices ticked.
6. Group bookings: each person ticks one or more services. A person with several services becomes several consecutive rows with the same label; the review groups them under the person and removes them together.
7. Edit mode (changing an existing booking) stays single-select: one booking, one service.

## Server

- `src/lib/booking/service-chain.ts`: the `services` query parameter (JSON array of `{ service_id, variant_id?, addon_ids?, duration_minutes? }`, 1 to 4 entries), parsed with zod, plus `chainSpanMinutes`.
- `src/lib/availability/appointment-chain.ts` (pure): `computeChainStartsForPractitioner`. Segment 0's candidates come from `computeAppointmentAvailability`; every later segment is checked with `validateExactAppointmentStart` at the previous end plus buffer, with earlier segments as phantoms. A start survives only when every segment fits.
- `src/lib/availability/appointment-chain-server.ts`: builds one engine input per segment (variant, add-ons, staff custom duration, the service's own booking window) from one base fetch per practitioner, then runs the pure helper. `any_available` intersects the practitioners offering every service, then pools with the existing assignment rules.
- `collective-booking-bridge.ts`: `loadCollectiveChainDayAvailability` resolves every offering per calendar to its owning venue and source service (with the collective's own duration), and labels the slots with the first offering id.
- `POST /api/booking/create-multi-service`: now resolves a collective id in `venue_id` per segment (it did not, so a two-service visit on a combined page failed with "Venue not found"), stores each row's own `collective_service_item_id`, and accepts an optional per-segment `duration_minutes` honoured only for staff sources (`phone`, `walk-in`), mirroring the single-booking staff route.
- `POST /api/booking/create-group`: `people` cap raised from 10 rows to 40 (ten people, four services each).

## Client (`AppointmentBookingFlow.tsx`)

- `pendingServiceIds` (the ticks) and `chainExtras` (services after the first, each with its variant and add-on choices). `selectedServiceId` stays the first service so the existing single-service code keeps working.
- `addonFlowContext` gains `{ kind: 'chain', index, ... }` so the `append_variant` and `addons` steps collect an extra service's options before the times. `drainChainOptions(target)` walks the extras and then moves to `practitioner`, `slot` or the staff calendar prefill.
- `buildChainFromStart(time)` builds every segment from the chosen start (used by the slot pick, the walk-in "Start now" and the staff calendar prefill), then `recomputeMultiServiceChain` lines them up.
- Availability fetch and month prefetch carry the chain (`services` parameter; total span as `duration_minutes` for the month).

## Tests

- `appointment-chain.test.ts`: chain fitting around a break and an existing booking, buffer handling, a service the person does not offer.
- `service-chain.test.ts`: parameter parsing and span maths.
- Flow tests: `clickService` now ticks and continues; new cases tick two services and assert the `services` parameter, the review lines and the create payload.
- `create-multi-service` route: collective resolution and staff-only duration override.

## Not in this version

- Reordering services in the picker (pick order is visit order).
- The same service twice in one visit.
- A chain-exact month view.
