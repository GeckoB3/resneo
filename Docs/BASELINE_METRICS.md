# Baseline metrics (P0.6)

Phase 1a success metrics in [Resneo-Appointments-Review-And-Roadmap.md](./Resneo-Appointments-Review-And-Roadmap.md) §9.2 need a **before** picture. P0.6 captures that baseline per venue.

## What is measured

| Metric | Definition | Phase 1a target |
|--------|------------|-----------------|
| **No-show rate** | `No-Show` / (`No-Show` + `Seated` + `Completed`), appointment rows, excluding walk-ins | Measurable ↓ vs baseline |
| **Reschedule via email** | Share of schedule changes (`booking_modified` events) where a modification email/SMS was sent | Proxy for pre–self-service staff reschedules |
| **Guest self-reschedule** | Share of schedule changes with `modification_actor: guest` (since P0.6 instrumentation). Counts staff-free moves only — **not** fee collection (fees are P1b.1). | ≥ 15% of eligible moves |
| **Cancel → rebook (7d)** | % of cancelled appointments (with guest) followed by another appointment within 7 days | — |
| **Median cancel → rebook gap** | Hours from cancel to next appointment for same guest | — |
| **Staff time-to-book** | Median `staff_booking_flow_completed.duration_ms` (returning-client subset reported separately) | Median &lt; 45s (returning) |

Scope for dashboard/API defaults: **appointment scheduling only** (`practitioner_appointment` + `unified_scheduling`).

## Where it appears

- **Reports** (`/dashboard/reports`) — “Baseline metrics” card for appointment venues (live compute for selected date range + latest stored snapshot if any).
- **API** — `GET /api/venue/reports?from=&to=` includes `report8_baseline_metrics` and `report8_baseline_snapshot`.

## Storage

Table: `venue_baseline_metrics_snapshots`

- `snapshot_kind`: `rolling_90d` (cron), `weekly`, or `manual`
- `metrics`: JSON document matching `VenueBaselineMetrics` (`src/lib/metrics/baseline-metrics-types.ts`)

## Migration

Apply `supabase/migrations/20260519120000_venue_baseline_metrics_snapshots.sql` on each environment before relying on stored snapshots.

## Cron

`POST /api/cron/baseline-metrics-snapshot` (same auth as other crons: `Authorization: Bearer $CRON_SECRET`)

- Upserts a **rolling 90-day** snapshot for each venue with appointment activity in that window.
- Scheduled in production: **Vercel Cron Sunday 03:00 UTC** (`vercel.json` → `/api/cron/baseline-metrics-snapshot`).

## Instrumentation (new data)

1. **`booking_modified` events** — `payload.modification_actor`: `staff` | `guest`  
   - Staff: `PATCH /api/venue/bookings/[id]`  
   - Guest: `POST /api/confirm` (`action: modify`)

2. **`staff_booking_flow_completed` events** — `duration_ms`, `returning_guest`, `source`  
   - Staff create: `POST /api/venue/bookings` with optional `staff_booking_duration_ms`  
   - Client timing: `AppointmentBookingFlow` / `UnifiedBookingForm` (wall clock from form open to submit)

Historical rows without `modification_actor` count as **legacy** in the guest vs staff split.

## Code map

| Area | Path |
|------|------|
| Compute | `src/lib/metrics/compute-venue-baseline-metrics.ts` |
| Snapshot upsert | `src/lib/metrics/capture-venue-baseline-snapshot.ts` |
| Modification events | `src/lib/booking/log-booking-modified-event.ts` |
| Staff flow events | `src/lib/metrics/log-staff-booking-flow-event.ts` |
| Migration | `supabase/migrations/20260519120000_venue_baseline_metrics_snapshots.sql` |

## Manual snapshot (ops)

Use service-role Supabase client or a one-off script calling `captureVenueBaselineSnapshot(admin, { venue_id, period_start, period_end, snapshot_kind: 'manual' })`.
