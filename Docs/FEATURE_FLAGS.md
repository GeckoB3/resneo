# Appointments feature flags (P0.3)

Controlled rollout for Phase 1a work in [ReserveNI-Appointments-Functionality-Review-And-Plan-May2026.md](./ReserveNI-Appointments-Functionality-Review-And-Plan-May2026.md).

## Flags

| Key | Purpose | Phase |
|-----|---------|-------|
| `waitlist_v2` | Appointment schedule waitlist (guest join, staff offer with guest notify, staff book/confirm, auto-offer on appointment cancel, `waitlist_converted` audit event) | P1a.3 |
| `guest_self_reschedule` | Guest reschedule on manage link (`/api/confirm` modify) with min-notice policy (same window as cancellation). **No fee / deposit-forfeit on modify until P1b.1** | P1a.2 (shipped); fees P1b.1 |
| `any_available_practitioner` | “Any available” practitioner pooling on public + staff booking | P1a.1 |

All flags default to **off** until enabled per venue or via environment override.

## Resolution order

1. **Environment** — if set to `true` / `false` (also `1` / `0`, `yes` / `no`, `on` / `off`), wins globally.
2. **Venue** — `venues.feature_flags` JSONB with `"flag_key": true`.
3. **Default** — `false`.

### Environment variables

| Flag | Variable |
|------|----------|
| `waitlist_v2` | `FEATURE_FLAG_WAITLIST_V2` |
| `guest_self_reschedule` | `FEATURE_FLAG_GUEST_SELF_RESCHEDULE` |
| `any_available_practitioner` | `FEATURE_FLAG_ANY_AVAILABLE_PRACTITIONER` |

Example (enable all in staging):

```bash
FEATURE_FLAG_WAITLIST_V2=true
FEATURE_FLAG_GUEST_SELF_RESCHEDULE=true
FEATURE_FLAG_ANY_AVAILABLE_PRACTITIONER=true
```

## API

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/venue/feature-flags` | Staff — returns `{ raw, resolved }` |
| PATCH | `/api/venue/feature-flags` | Admin — body partial `{ waitlist_v2?: boolean, ... }` |

Public booking payload (`GET /api/booking/venue?slug=`) includes `feature_flags.resolved` (subset safe for guests).

Confirm/manage (`GET /api/confirm`) includes `feature_flags.resolved` for the booking’s venue.

## Code usage

```typescript
import {
  assertAppointmentsFeatureEnabled,
  resolveAppointmentsFeatureFlag,
  featureFlagDisabledResponse,
} from '@/lib/feature-flags';

// Server route
assertAppointmentsFeatureEnabled('guest_self_reschedule', venueFlags);
// or
if (!resolveAppointmentsFeatureFlag('waitlist_v2', venueFlags)) {
  return featureFlagDisabledResponse('waitlist_v2');
}
```

Client (dashboard): `useVenueFeatureFlags()` from `@/components/providers/VenueFeatureFlagsProvider`.

## Settings UI

Admins on appointment-capable venues: **Settings → Profile → Beta features** toggles per-venue overrides.

## Implementing a gated feature

1. Check flag in API before mutating state; return `403` with `code: 'feature_disabled'`.
2. Hide or disable UI when `resolved.<flag>` is false.
3. Do not gate unrelated flows (e.g. restaurant table waitlist is **not** `waitlist_v2`).
