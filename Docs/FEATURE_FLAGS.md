# Appointments feature flags (P0.3)

Controlled rollout for Phase 1a work in [Resneo-Appointments-Review-And-Roadmap.md](./Resneo-Appointments-Review-And-Roadmap.md).

## Flags

| Key | Purpose | Phase |
|-----|---------|-------|
| `waitlist_v2` | Appointment schedule waitlist (guest join, staff offer with guest notify, staff book/confirm, auto-offer on appointment cancel, `waitlist_converted` audit event) | P1a.3 |
| `guest_self_reschedule` | Guest reschedule on manage link (`/api/confirm` modify). Cancellation notice applies to refunds on cancel, not to whether reschedule is allowed. **No fee / deposit-forfeit on modify until P1b.1** | P1a.2 (shipped); fees P1b.1 |
| `any_available_practitioner` | “Any available” practitioner pooling on public + staff booking | P1a.1 |
| `class_commerce_enabled` | Gates the entire class-commerce surface area: credit packs, courses, memberships, recurring reservations, and the dashboard products UI. See [reserveni-class-products-plan.md](./reserveni-class-products-plan.md) §10. Off-state hides the dashboard `/dashboard/class-timetable/products` page and returns 403 from all `/api/venue/class-{credit,course,membership}-products/*` routes. Existing class instances and guest bookings continue to work — the flag strictly gates **prepaid commerce** surfaces. | Class products §10 |
| `compliance_records_enabled` | Gates the Compliance Records feature (patch tests, consent/intake forms, service requirements, public form submission). See [reserveni-compliance-spec.md](./reserveni-compliance-spec.md). Off-state hides the `/dashboard/compliance` nav item, the Settings → Compliance tab, the booking/contact compliance sections, and the service-editor requirements section; all `/api/venue/compliance/*` routes return 403. Also requires `isAppointmentPlanTier(pricing_tier)` (not available on restaurant/founding SKUs). | Compliance v1 |

When `compliance_records_enabled` is on, venues can set a `compliance` config object in the same JSONB (Settings → Compliance → General settings):

| Field | Values | Purpose |
|-------|--------|---------|
| `default_capture_method` | `staff_in_venue` \| `client_online` \| `both` (default `both`) | Pre-selected capture method for new types |
| `default_form_link_channel` | `email` \| `sms` \| `both` (default `email`) | Default channel for sending form links |
| `reminder_cadence_days` | int 0–90 (default 7) | Days before expiry to remind the client (0 = off) |
| `lock_period_hours` | int 0–720 (default 0) | Default lead-time a record must pre-date a booking |
| `form_link_expiry_days` | int 1–90 (default 14) | Venue-level link expiry (per-type override still wins) |
| `incomplete_behaviour` | `warn_only` (v1) | Behaviour when a client arrives with an incomplete form |

> `auto_send_on_booking` was removed in the in-booking-collection work (improvement plan §9.3). Whether a form is shown in the booking flow, emailed in the confirmation, or left for staff is now set per service requirement via `service_compliance_requirements.online_collection` (`inline` \| `confirmation_link` \| `none`).

When `any_available_practitioner` is on, venues can set `any_available_practitioner_config` in the same JSONB:

| Field | Values | Purpose |
|-------|--------|---------|
| `mode` | `priority` (default) or `random` | How to choose a calendar when several are free at the same time |
| `calendar_order` | UUID[] | Priority list (Settings → Beta features → calendar order UI) |

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
| `class_commerce_enabled` | `FEATURE_FLAG_CLASS_COMMERCE_ENABLED` |
| `compliance_records_enabled` | `FEATURE_FLAG_COMPLIANCE_RECORDS_ENABLED` |

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
