# Multi-model tenancy - API and RLS audit checklist

Reference: [Resneo_Unified_Booking_Functionality.md](Resneo_Unified_Booking_Functionality.md) §4.6.

This document records **application-layer** controls already in place and **database** items to verify in Supabase. Update it when policies change.

## Application API (verified in codebase)

| Area | Expectation | Implementation notes |
|------|-------------|----------------------|
| Public `POST /api/booking/create` | Reject creates for models not in `booking_model` ∪ `enabled_models` | [`resolveVenueMode`](src/lib/venue-mode.ts) + [`venueExposesBookingModel`](src/lib/booking/enabled-models.ts) / [`inferSecondaryBookingModelFromPayload`](src/lib/booking/enabled-models.ts) in [`booking/create/route.ts`](src/app/api/booking/create/route.ts) |
| Venue `PATCH /api/venue` | `enabled_models` only with allow-list, no dupes, no repeat of primary | [`normalizeEnabledModels`](src/lib/booking/enabled-models.ts); **admin-only** via [`requireAdmin`](src/lib/venue-auth.ts) |
| Cron / comms | No duplicate sends for same booking + message type | [`communication_logs` unique `(booking_id, message_type)`](supabase/migrations/20260315000001_communication_settings.sql); [`logToCommLogs`](src/lib/communications/service.ts) |

## Public availability routes

Confirm each entry point that returns slots or catalog for C/D/E checks venue mode (primary + `enabled_models`) where a client could spoof `booking_model` in the body. Search: `resolveVenueMode`, `venueExposesBookingModel`, `normalizeEnabledModels` under `src/app/api/booking/`.

## Supabase RLS (manual verification)

For each table touched by C/D/E, confirm policies restrict **read/write** to the venue’s rows (e.g. `venue_id` matches staff’s venue via `staff` join or `auth` claims). Priority tables:

- `venues` (staff can only see/update own venue)
- `bookings`
- `experience_events`, `experience_event_ticket_types`
- `class_types`, `class_instances`
- `venue_resources`
- `communication_logs`

Use Supabase SQL editor or `migrations/` history; add or tighten policies if any route uses the **anon** key where RLS must block cross-venue access. Server routes using **service role** bypass RLS - ensure those handlers enforce `venue_id` from authenticated staff context.

## Release checklist (per new venue-scoped route)

- [ ] Handler resolves `venue_id` only from session / staff row, not from unchecked client body (unless public booking with rate limits and venue id validated against published slug).
- [ ] Mutations on `enabled_models` or `booking_rules` remain admin-only where specified in product rules.

## Repository pass (migrations reviewed in codebase)

| Area | Finding |
|------|---------|
| `bookings` | `staff_manage_bookings` - `venue_id` must match staff’s venue ([`20260301000007_rls_policies.sql`](../supabase/migrations/20260301000007_rls_policies.sql)). |
| C/D/E catalogue tables | [`20260327000001_multi_model_foundation.sql`](../supabase/migrations/20260327000001_multi_model_foundation.sql): `staff_manage_*` on `experience_events`, `class_types`, `class_instances`, `venue_resources`, `booking_ticket_lines`, etc.; `public_read_*` for guest-facing availability; `service_role_*` for server jobs. |
| Unified scheduling | [`20260430120000_unified_scheduling_engine.sql`](../supabase/migrations/20260430120000_unified_scheduling_engine.sql): RLS on `unified_calendars`, `event_sessions`, etc. |

**Live Supabase:** confirm deployed policies match migrations (no drift). Add a migration only if production review finds a gap.
