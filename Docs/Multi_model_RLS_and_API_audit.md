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

## Host-write exception: venue collectives on shared services (added 2026-09-17)

**The rule "a venue's rows are written only by that venue" has one deliberate exception.** In a venue collective on shared services (`venue_collectives.service_model = 'replicas'`, migrations `20270215120000` to `20270218220000`; design in `Docs/collective-one-venue-plan.md` §6.3 to §6.5), the host's changes are written into **member venues' tenancy**. Collectives on `legacy_copies`, which is every collective until `scripts/collective-replicas-migrate.mjs` moves it, are unaffected: every engine function and lock below is gated on the model and does nothing for them.

**Who writes.** Only the collective engine: `SECURITY DEFINER` functions with `SET search_path = ''`, revoked from `PUBLIC`, `anon` and `authenticated` and granted to `service_role` only, called by server routes that have already authorised the caller (see `Docs/api-venue-permissions-matrix.md`) and by the collective crons. Each entry point turns on a transaction-local flag, `resneo.collective_engine`, through `collective_engine_enter()` and restores it with `collective_engine_leave()`; a failure rolls the setting back with the transaction. (Hosted Supabase refused `SET resneo.collective_engine = 'on'` as a function-level clause, 42501 on staging 2026-09-15, which is why the flag is set at run time.) Every engine write is recorded in `collective_audit_events`, which is append-only and has no FK, with actor venue, user and the before and after values.

**What it writes in a member's tenancy** (rows whose `venue_id` is the member's):

| Table | What |
|-------|------|
| `service_items`, `service_variants` | The replica service and its options, from the host's master through the column registry (`collective_column_classes`); venue-controlled columns such as `capacity_per_session` and `pre_appointment_instructions` are seeded once and never overwritten |
| `calendar_service_assignments` | The host's choice of which member calendars offer a service (`collective_set_calendar_offering`, the only writer of another venue's assignments) and a calendar's own values (`collective_set_calendar_values`) |
| `addon_groups`, `addons`, `service_addon_groups` | Managed add-on groups (`managed_by_collective_id`), their options and a replica's links |
| `compliance_types`, `compliance_type_versions`, `service_compliance_requirements` | Managed forms, their versions and a replica's requirements |
| `service_categories` | Managed headings |
| `bookings`, `booking_addons`, `events` | Only `collective_move_booking` (a booking moved to another venue: a new booking at the target venue, and the original cancelled) and the migration's fill of a missing `service_price_snapshot_pence`. Guests are matched or created in the target venue by the route, not the engine. |

The engine's own tables (`collective_service_replicas`, `collective_catalogue_revisions`, `collective_audit_events`, `collective_operations`) are `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, with no client policies.

**Lock triggers.** While a member is active in an active shared-services collective (a suspended member and a paused collective stay locked), `BEFORE` triggers refuse any write without the engine flag, from a route, the app, an import or a support script alike (`20270216120000_collective_engine_locks.sql`):

| Code | Error | Refuses |
|------|-------|---------|
| RN001 | `COLLECTIVE_MANAGED_SERVICE` | Changing a replica service, its options or its managed heading; re-pointing a calendar assignment to or from a replica |
| RN002 | `COLLECTIVE_OFFERED_SERVICE` | Deleting a host master that has an active offering |
| RN003 | `COLLECTIVE_MANAGED_ADDON_GROUP` | Changing managed add-on groups, their options or a replica's group links; a member's own service linking a managed group |
| RN004 | `COLLECTIVE_MANAGED_COMPLIANCE_TYPE` | Changing managed forms, their versions or a replica's requirements; a new requirement on a managed form from the member's own services (D57: requirements that existed before the takeover stay editable) |

Left open on purpose: columns the registry classes as the venue's own or not copied, a replica's `category_id` becoming NULL through the one FK cascade, and inserting or deleting calendar assignments (a member chooses which of its calendars offer a replica). Three related refusals sit outside the locks migration: RN005 (`COLLECTIVE_HOST_CHANGE_REFUSED`, only the engine may change `host_venue_id` on this model), RN007 (`COLLECTIVE_SERVICE_PARKED`, a new booking on a parked service, `20270217120000`), and the legacy sync columns on `service_items`, which `20270214130000` refuses to client writes outright (the plan's RN006). Routes map these codes to a sentence (`src/lib/linked-accounts/replicas/db-errors.ts`).

**Release.** When a membership stops being active, an `AFTER UPDATE OF status` trigger runs `collective_release_member`, which lifts the locks and clears the managed markers in the same transaction, so a venue that leaves can edit everything at once. No engine function writes `account_links` (D41).

**What to check.**

- Grants: the engine functions and tables must stay unreachable for `anon` and `authenticated` on the **live** database (`npm run check:function-grants`, `npm run check:table-grants`), for the reason at the top of this file.
- The flag is a custom setting, not a privilege. It is safe only while client roles have no path to set it: PostgREST exposes the `public` schema, not `pg_catalog.set_config`, and the only functions in the migrations that set it (`collective_engine_enter` and `collective_engine_leave`) are revoked from client roles, as is every function in `20270215120000` to `20270218220000` (none is granted to `anon` or `authenticated`). Confirm those revokes on the live database, and treat any new client-executable function that calls `set_config` as a way round the locks.
- The "one live collective per venue" unique indexes are not yet added (`20270215120000` defers them until invariant I7 returns 0 on production); exclusivity is enforced by the routes and the engine under the collective lock.
- pgTAP coverage: `supabase/tests/collective_*_test.sql`.

---

## Customer-facing reads (portal)

Ownership for a customer session is established through an **account-safe view**, never through a policy on the base table and never through the admin client alone:

- Guests: `guests_account_safe` (live definition `20260810120000_guest_first_last_names.sql:150-180`), created `WITH (security_barrier = true)` and **without** `security_invoker`, so it runs as its owner and applies its own `WHERE g.user_id = auth.uid()`.
- Bookings: `bookings_account_safe` (`20270118120000_bookings_account_safe.sql`), same pattern: `security_barrier`, no `security_invoker`, its own `WHERE b.guest_id IN (SELECT id FROM guests WHERE user_id = auth.uid())`, a 55-column allowlist pinned exactly by `supabase/tests/account_safe_views_test.sql`, and explicit `REVOKE`s so authenticated holds **SELECT only** and anon nothing (20270118120000 granted SELECT; hosted default privileges then added write grants to authenticated, which are auto-updatable through this owner-rights view and were confirmed exploitable, so 20270119120000 revokes them) (hosted defaults grant anon outside the migration history). Loaders still read the base table via admin until P0-6's code switch lands; the view carries no readers yet.
- Hosted grants for tables and views are verified against the **live** database by `npm run check:table-grants` (`scripts/check-table-grants.mjs`, over the `audit_client_table_grants()` RPC), the sibling of `check:function-grants`. Probed 2026-08-27: anon held hosted-default SELECT on `bookings`, `guests` and `guests_account_safe`; RLS keeps all three empty, and the checker reports these without failing. Closing them is an open decision.

**The rule:** the row that establishes ownership is read through the account-safe view; derived context and action payloads may then be read as admin. A view on this pattern must never be switched to `security_invoker`, which would silently reduce it to whatever columns the caller happens to be granted.
