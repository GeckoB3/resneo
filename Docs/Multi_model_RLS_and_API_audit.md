# Multi-model tenancy - API and RLS audit checklist

Reference: [Resneo_Unified_Booking_Functionality.md](Resneo_Unified_Booking_Functionality.md) §4.6.

**Last verified against the code: 2026-08-26.** Every literal claim below still holds. What follows is what it does **not** cover.

**This checklist models the database layer as RLS-only, and that is now the smaller half.** The August 2026 hardening wave was about **grants**, not policies: `20270106120000` (revoke definer function client grants), `20270107120000` (revoke report RPCs and waitlist anon), `20270108120000` (default privileges), `20270109120000` (audit client-executable functions), `20270111120000` (linked write paths), `20270112120000` (**`REVOKE ALL ON public.bookings FROM authenticated`** plus nine column grants) and `20270113120000` (scheduling anon reads and write grants). Column and EXECUTE privileges are checked **before** RLS, so a table can be fully policy-protected and still leak, or be fully policy-open and still refuse. `Docs/Resneo_Forensic_Audit_August_2026.md` is the authority on that wave; this file is not.

**Never stop investigating at "the migration is applied".** Hosted Supabase grants `anon` and `authenticated` outside the migration history, at both function and table level, so migration history is **not** a substitute for querying the live database. The Forensic Audit records `report_deposit_summary`'s revoke as *"applied but ineffective"* for exactly this reason. Verify with, in order: `npm run test:rls` (pgTAP, also a CI job), `npm run check:function-grants` against the target project, and a direct table-privilege query. The script prints the project ref it connected to, which is what confirms a shell override actually beat `.env.local`.

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
- `communication_logs`

(`venue_resources` was on this list and is dropped: it was frozen by `20260502120000_resources_to_unified_calendars.sql` and the resource engine never reads it. Verify `unified_calendars` instead.)

Query the **live database**, not `migrations/` history, for the reason given at the top of this file. Add or tighten policies if any route uses the **anon** key where RLS must block cross-venue access. Server routes using **service role** bypass RLS **and column grants** - ensure those handlers enforce `venue_id` from authenticated staff context.

## Release checklist (per new venue-scoped route)

- [ ] Handler resolves `venue_id` only from session / staff row, not from unchecked client body (unless public booking with rate limits and venue id validated against published slug).
- [ ] Mutations on `enabled_models` or `booking_rules` remain admin-only where specified in product rules.

## Repository pass (migrations reviewed in codebase)

| Area | Finding |
|------|---------|
| `bookings` | `staff_manage_bookings` - `venue_id` must match staff’s venue ([`20260301000007_rls_policies.sql`](../supabase/migrations/20260301000007_rls_policies.sql)). **Do not read this row as an all-clear.** Open finding **S-04** (High, VERIFIED) in `Docs/Resneo_Remediation_Register.md`: the policy is `FOR ALL`, carries no `TO` clause, and has no `revoked_at IS NULL` filter, so a **former** staff member retains full read and write on every booking at that venue. `staff.revoked_at` exists (`20260629120000_user_accounts_foundation.sql:125`) and the policy ignores it. Also note `authenticated` now reaches only nine columns of this table (`20270112120000_bookings_column_grants.sql`). |
| C/D/E catalogue tables | [`20260327000001_multi_model_foundation.sql`](../supabase/migrations/20260327000001_multi_model_foundation.sql): `staff_manage_*` on `experience_events`, `class_types`, `class_instances`, `venue_resources`, `booking_ticket_lines`, etc.; `public_read_*` for guest-facing availability; `service_role_*` for server jobs. |
| Unified scheduling | [`20260430120000_unified_scheduling_engine.sql`](../supabase/migrations/20260430120000_unified_scheduling_engine.sql): RLS on `unified_calendars`, `event_sessions`, etc. |

**Live Supabase:** confirm deployed policies **and grants** match expectations by querying the live database. Matching the migrations is necessary but not sufficient, because hosted grants are issued outside the migration history. Add a migration only if production review finds a gap.

---

## Customer-facing reads (portal)

Ownership for a customer session is established through an **account-safe view**, never through a policy on the base table and never through the admin client alone:

- Guests: `guests_account_safe` (live definition `20260810120000_guest_first_last_names.sql:150-180`), created `WITH (security_barrier = true)` and **without** `security_invoker`, so it runs as its owner and applies its own `WHERE g.user_id = auth.uid()`.
- Bookings: `bookings_account_safe`, **to be created by P0-6** of `Docs/Resneo_Customer_Portal_World_Class_Plan.md`, on the same pattern.

**The rule:** the row that establishes ownership is read through the account-safe view; derived context and action payloads may then be read as admin. A view on this pattern must never be switched to `security_invoker`, which would silently reduce it to whatever columns the caller happens to be granted.
