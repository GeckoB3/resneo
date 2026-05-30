# Unified booking - manual verification matrix

Derived from [Resneo_Unified_Booking_Functionality.md](Resneo_Unified_Booking_Functionality.md) (verification checklist and E2E matrix). Use before release or after multi-model changes.

## Public booking

| # | Scenario | Steps | Pass criteria |
|---|----------|-------|---------------|
| 1 | Multi-tab URL | Open `/book/{slug}` with `?tab=events` (or other enabled tab). Refresh. | Same tab; invalid `?tab=` falls back to primary per `public-book-tabs`. |
| 2 | Embed parity | Open `/embed/{slug}?tab=classes` (if classes enabled). | Same tab behaviour as full page (`BookPublicBookingFlow`). |
| 3 | Disabled model tampering | POST `/api/booking/create` with C/D/E payload for a venue that has not enabled that model. | 400 with clear error. |

## Staff dashboard

| # | Scenario | Steps | Pass criteria |
|---|----------|-------|---------------|
| 4 | Today by type | Dashboard home with primary + `enabled_models`; no bookings today for one type. | “Today by booking type” shows that type with **0** (dashed chip). |
| 5 | Setup checklist | Enable a secondary in Settings; leave its catalogue empty. | Checklist shows secondary row until catalogue exists. |
| 6 | Calendar merged C/D/E | Venue with secondaries; Day view. | Schedule blocks / legend for events, classes, resources as enabled. |

## Cancellations and refunds

| # | Scenario | Steps | Pass criteria |
|---|----------|-------|---------------|
| 7 | Guest cancel C/D/E | Cancel from manage link before deadline; paid deposit. | Booking cancelled; refund attempted; `[booking-op]` log with `operation` `cancel` or `refund_failed` as appropriate. |
| 8 | Staff cancel | Cancel booking from dashboard / PATCH venue booking. | Status cancelled; `[booking-op]` structured log for `cancel` or `refund_failed`. |

## Cron / comms

| # | Scenario | Steps | Pass criteria |
|---|----------|-------|---------------|
| 9 | C/D/E reminders | Non-unified venue with event booking; cron `send-communications`. | `cde_reminder_1` / `cde_reminder_2` counters can increment; no duplicate email for same `message_type` (dedup via `communication_logs`). |

## Optional automation

If CI adds E2E later, map rows 1–3 and 7 to API or browser tests; keep this document as the human regression list.
