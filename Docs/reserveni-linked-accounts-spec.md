# Resneo: Linked Accounts Feature Specification

**Status:** Living specification — **Phase 1 shipped**; **Phase 2 partially implemented** (see §15); **code-vs-spec audit + world-class gap analysis added 2026-06-04 (see §16–§20)**
**Plan scope:** Appointments-family venues only (`light`, `plus`, `appointments` pricing tiers)
**Settings location:** `/dashboard/settings` → **Linked Accounts** tab (`?tab=linked-accounts`)
**Last updated:** 2026-06-04
**Related scope doc:** `Docs/archive/reserveni-linked-calendar-grid-integration-scope.md` (archived — calendar grid integration shipped on `/dashboard/calendar`; day-sheet deferred)

> **2026-06-04 audit note.** A full code-vs-spec audit was performed across the DB/RLS,
> API, settings UI, calendar/bookings integration, collectives, and cron/notifications
> layers. The core is strong. A **P0** (§16.1 #1) — cross-venue booking edits via the *main*
> booking route running on the service-role admin client and **not** being written to the audit
> log — was found, mistakenly "withdrawn" mid-audit, re-confirmed by reading `venue-auth.ts`, and
> then **fixed** (see the §16.1 correction history). The audit also surfaced (a) lifecycle bugs,
> (b) documentation drifts now corrected inline, and (c) a set of **unspecced functions and UX
> standards a world-class product must carry** — newly specified in §16–§20. Shipped the same day:
> the §16.1 #1 audit fix, the two missing cron termination emails (#4), the orphaned-host cascade
> (#2), render-time collective eligibility (#3), and **§17 Phase 1** (the notification store +
> audit-log trigger + feed API). Read §16 first for the executive summary.

---

## 0. Terminology mapping — read this first

The earlier draft of this document was written against a generic data model. Resneo's
actual schema uses different names, and this rewrite is bound to the real tables. Whenever this
spec says "account" it means a Resneo **venue** (`public.venues` row). The mapping is:

| This spec / UI term | Resneo schema reality |
|---|---|
| **Account** | A `public.venues` row. One venue = one Resneo subscription = one "account". |
| **Linked account** | Another `venues` row connected via an `account_links` row. |
| **Calendar** | A bookable calendar entity. For Appointments venues this is a `public.practitioners` row. (Class types, events, and resources are the calendar entity for other booking models.) |
| **Client** | A `public.guests` row — the venue-scoped customer record. `UNIQUE (venue_id, email)`. |
| **Booking** | A `public.bookings` row, keyed by `venue_id`, `guest_id`, and (for appointments) `practitioner_id` + `appointment_service_id`. |
| **Service** | A `public.appointment_services` row. |
| **Admin user** | A `public.staff` row with `role = 'admin'` and `revoked_at IS NULL`. |
| **Audit log** | New `account_link_audit_log` table (the existing append-only `public.events` table remains the per-venue booking audit log and is reused — see §10). |

There is **no `accounts` table, no `account_id` column, no `calendar_id` column, and no
`current_account_id()` function** in Resneo. Bookings carry `venue_id`, not `account_id`.
Times are stored as `booking_date date` + `booking_time time` + `booking_end_time time`, not
`start_time`/`end_time` timestamps. RLS identifies the caller via
`auth.jwt() ->> 'email'` and/or `staff.user_id = auth.uid()`. Every SQL fragment in this
document uses the real column names.

---

## 1. Purpose and use cases

The Linked Accounts feature lets two or more independent Resneo venues share calendar
visibility, booking access, and (Phase 2) a combined public booking page, while keeping all
client and booking data fully separate at rest in each venue.

Primary use cases:

- A salon owner who rents chairs to independent stylists, where each stylist runs their own
  Resneo venue and `guests` list but they want to coordinate scheduling and present a
  unified booking experience to walk-in customers.
- Co-located independent practitioners (physiotherapists, chiropractors, beauty therapists)
  who want to see each other's availability to manage shared rooms or refer overflow clients.
- Multi-practitioner clinics where each clinician runs their own books on a separate venue
  but the building/brand is shared.

The feature is built on one rule: **each venue remains the sovereign owner of its own data.
Linking is a relationship, not a merge.**

---

## 2. Core principles

These principles govern every design decision. Any future change must preserve all of them.

1. **Data separation is absolute.** `bookings`, `guests`, `practitioners`, `appointment_services`,
   `class_types`, `experience_events`, `venue_resources` and all related rows are stored only
   under their owning `venue_id`. A linked venue gains *visibility* and optionally *action
   rights*, never *ownership*. No row is ever copied between venues.
2. **Consent is required and revocable.** Any venue can refuse a link request, and either
   venue can break an existing link unilaterally at any time.
3. **Plan source governs availability.** A shared calendar exists only while the owning venue
   has an eligible, active subscription (`plan_status = 'active'`, eligible `pricing_tier`).
   Visibility is always contingent, never persistent.
4. **No data persists after unlinking.** Once a link ends, RLS denies all cross-venue reads
   and writes immediately. Because nothing was ever copied, severance is automatic — each
   venue simply keeps the rows it always owned.
5. **Every cross-venue action is auditable.** Both venues can see a complete record of what
   the other did in their data (`account_link_audit_log`, plus the owning venue's own
   `events` log).
6. **Permissions are explicit and granular.** Defaults are sensible but every dimension is
   independently controllable, per direction.

---

## 3. Eligibility and scope

- Available to **Appointments-family venues only** — venues whose `pricing_tier` is one of
  `light`, `plus`, or `appointments`. The practical discriminator in code is
  `venues.booking_model <> 'table_reservation'` (use the existing
  `isRestaurantTableProductTier()` helper in `src/lib/tier-enforcement.ts` to detect the
  restaurant case).
- **Restaurant (table-reservation) venues cannot create or receive link requests.** The
  Linked Accounts tab does not render for them, mirroring how `SettingsView.tsx` already
  gates restaurant-only sections.
- A venue with `plan_status` other than `'active'` (e.g. `'past_due'`, `'cancelled'`) cannot
  create new links. Existing links remain visible in settings but are **suspended** (see §9).
- No hard cap on the number of links a venue may hold. A soft UI warning above ~10 links is
  acceptable but not enforced.
- No minimum subscription age. A Light-plan venue still inside its 3-month free period
  (`light_plan_free_period_ends_at` in the future, `plan_status = 'active'`) is fully
  eligible.

### 3.1 User-level authorisation within a venue

Link management is restricted to **Admin staff** — `staff` rows with `role = 'admin'` and
`revoked_at IS NULL`. Specifically:

- The Linked Accounts tab is only rendered when the current user is an Admin (`SettingsView`
  already receives an `isAdmin` flag and uses it to hide the `staff` and `data-import` tabs;
  `linked-accounts` follows the same pattern in `resolveInitialTab()`).
- Only Admin users can create, send, accept, reject, modify, or break links, and (Phase 2)
  manage venue collectives.
- Non-Admin `staff` on a venue inherit the visibility and action permissions the link grants
  (a read-only linked calendar appears read-only to all staff), but cannot manage links.

**Note on the Light plan.** A `light`-tier venue has exactly **one** staff login, which is
the owner/Admin. So on Light the Admin-only rule is satisfied trivially. `plus` venues allow
up to 5 staff and `appointments` venues unlimited; both already support the
`staff_role` enum `('admin','staff')`, so no new role system is required — this feature
reuses the existing `staff` table as-is.

---

## 4. Data model

Two new tables for Phase 1 (`account_links`, `account_link_audit_log`) and two more for
Phase 2 (`venue_collectives`, `venue_collective_members`). All follow Resneo conventions:
`uuid` PKs via `gen_random_uuid()`, `timestamptz` columns, snake_case, RLS enabled, created
through a dated migration in `supabase/migrations/`.

### 4.1 `account_links` — pairwise relationship between two venues

Each row is a single link between exactly two venues. Permissions are defined independently
in each direction. To keep the unique constraint simple, the two venues are stored as an
ordered pair: `venue_low_id` always holds the smaller UUID, `venue_high_id` the larger.
`requested_by_venue_id` records who initiated.

```
account_links
├── id                      uuid PK default gen_random_uuid()
├── venue_low_id            uuid NOT NULL FK → venues(id) ON DELETE CASCADE
├── venue_high_id           uuid NOT NULL FK → venues(id) ON DELETE CASCADE
├── requested_by_venue_id   uuid NOT NULL FK → venues(id)   -- venue_low or venue_high
├── status                  link_status NOT NULL default 'pending'
│       enum link_status: 'pending' | 'accepted' | 'rejected'
│                        | 'revoked' | 'expired' | 'suspended'
│
│   -- Permissions GRANTED BY venue_low TO venue_high (what high may do to low's data)
├── low_grants_calendar     link_calendar_visibility NOT NULL default 'full_details'
├── low_grants_pii          boolean NOT NULL default true
├── low_grants_act          link_action_level NOT NULL default 'edit_existing'
│
│   -- Permissions GRANTED BY venue_high TO venue_low
├── high_grants_calendar    link_calendar_visibility NOT NULL default 'full_details'
├── high_grants_pii         boolean NOT NULL default true
├── high_grants_act         link_action_level NOT NULL default 'edit_existing'
│
├── request_message         text                       -- optional personal note
├── pending_change          jsonb                      nullable  -- mid-link negotiation (see below)
├── created_by_user_id      uuid FK → auth.users(id) ON DELETE SET NULL
├── responded_by_user_id    uuid FK → auth.users(id) ON DELETE SET NULL  nullable
├── created_at              timestamptz NOT NULL default now()
├── responded_at            timestamptz                nullable
├── suspended_at            timestamptz                nullable  -- when a lapse suspended the link
├── terminated_at           timestamptz                nullable
├── termination_reason      link_termination_reason    nullable
│       enum: 'unlinked' | 'subscription_lapsed' | 'venue_deleted'
│            | 'plan_ineligible' | 'request_expired'
├── updated_at              timestamptz NOT NULL default now()
│
└── enums:
    link_calendar_visibility: 'none' | 'time_only' | 'full_details'
    link_action_level:        'none' | 'edit_existing' | 'create_edit_cancel'
```

**`pending_change` (shipped; documented here 2026-06-04).** Mid-link permission renegotiation
(§6.5) is stored inline as a JSONB blob rather than in a separate table:
`{ by_venue_id, proposed_at, low_grants_calendar, low_grants_pii, low_grants_act,
high_grants_calendar, high_grants_pii, high_grants_act }`. It is `NULL` when no change is
in flight, set by the propose-change API path, applied (copied onto the six grant columns)
on accept, and cleared on accept/reject/cancel/unlink/termination. `suspended_at` records
when a subscription lapse moved the link to `suspended` (§6.7). Both columns exist in
`20260919120000_linked_accounts.sql` and were previously absent from this data model.

**Constraints and indexes:**

- `CHECK (venue_low_id < venue_high_id)` — enforce ordering.
- `CHECK (requested_by_venue_id IN (venue_low_id, venue_high_id))`.
- Partial unique index preventing a duplicate live link:
  `CREATE UNIQUE INDEX account_links_active_pair ON account_links (venue_low_id, venue_high_id)
   WHERE status IN ('pending','accepted','suspended');`
  Once a link is `rejected`, `revoked`, or `expired`, a fresh request can be created.
- CHECK constraints encoding the permission-coherence rules in §5.5 (e.g. `time_only` forces
  `pii = false` and `act = 'none'`; `pii = false` forces `act = 'none'`). Apply to both
  `low_grants_*` and `high_grants_*` triples. **Shipped** as a single per-direction CHECK
  keyed on `calendar <> 'full_details'`, which correctly also covers the `calendar = 'none'`
  case (§5.5).
- CHECK `account_links_not_zero_way` — at least one direction's calendar grant must be
  non-`none` (encodes the §5.5 "no zero-way links" rule at the DB level, not only in the UI).
  *Implication:* the unilateral `reduce` path must pre-validate that it does not drive a
  one-way link to `none`/`none`, or the DB raises a constraint error instead of a clean 4xx
  (see §16.1).
- Indexes on `(venue_low_id, status)` and `(venue_high_id, status)` for settings/RLS lookups.

**Notes:**

- `pii` is only meaningful when `calendar = 'full_details'`; with `time_only` PII is hidden
  regardless. `act` is only meaningful when `calendar = 'full_details'` AND `pii = true`.
- Pending requests expire after 30 days. A daily cron (`/api/cron/account-link-maintenance`,
  registered in `vercel.json` alongside the existing `light-plan-expiry` cron and secured
  with `CRON_SECRET`) transitions them to `expired` and notifies both venues.

### 4.2 `account_link_audit_log` — cross-venue action record

Every action one venue takes on another venue's data via a link writes a row here. Visible
to **both** venues, and retained after the link ends.

The existing append-only `public.events` table already records `booking_created` /
`booking_status_changed` per venue via `booking_events_trigger`; those rows continue to be
written into the **owning** venue's `events` log automatically. `account_link_audit_log` is
the *additional* cross-venue record: it captures the acting venue, the acting user, and
read-events (which `events` does not track), and it is the surface both venues query from the
Linked Accounts tab.

```
account_link_audit_log
├── id                  uuid PK default gen_random_uuid()
├── link_id             uuid NOT NULL FK → account_links(id) ON DELETE CASCADE
├── acting_venue_id     uuid NOT NULL FK → venues(id)   -- who performed the action
├── acting_user_id      uuid FK → auth.users(id)        -- which staff user
├── owning_venue_id     uuid NOT NULL FK → venues(id)   -- whose data was affected
├── action_type         text NOT NULL
│       'viewed_calendar' | 'viewed_booking' | 'created_booking'
│     | 'edited_booking'  | 'cancelled_booking'
├── resource_type       text                 -- 'booking' | 'guest' | 'practitioner' | 'service'
├── resource_id         uuid                 nullable
├── before_state        jsonb                nullable  -- for edits / cancels
├── after_state         jsonb                nullable  -- for creates / edits
├── created_at          timestamptz NOT NULL default now()
└── indexes: (owning_venue_id, created_at DESC), (acting_venue_id, created_at DESC),
             (link_id, created_at DESC)
```

**Notes:**

- `viewed_calendar` / `viewed_booking` rows are debounced: dedupe by
  `(acting_user_id, resource_id)` within a 5-minute window so a calendar render does not spam
  the log.
- Write actions (`created_booking`, `edited_booking`, `cancelled_booking`) are inserted
  inside the **same transaction** as the mutation, by a database trigger on `bookings`, not
  by application code — this mirrors how the existing `booking_events_trigger` already writes
  `events` rows and prevents any code path from skipping the audit.
- The log is **never deleted**. It survives link termination and survives either venue
  cancelling its Resneo subscription — it is each venue's own record of access to its own
  data. (`ON DELETE CASCADE` on `link_id` is acceptable only because `account_links` rows are
  themselves never hard-deleted; if that ever changes, switch to `ON DELETE SET NULL` plus a
  denormalised link descriptor.)

### 4.3 `venue_collectives` and `venue_collective_members` — Phase 2

A *venue collective* is a combined public booking page joining two or more linked venues
under shared branding. "Collective" is used deliberately instead of "venue group" because in
Resneo each account already **is** a venue — a group of venues needs a distinct word.

Collectives are independent of pairwise links: a venue can be linked without joining any
collective, but joining a collective requires accepted pairwise links with full mutual
visibility (`full_details` in both directions) between every pair of members.

```
venue_collectives
├── id                       uuid PK default gen_random_uuid()
├── slug                     text NOT NULL UNIQUE   -- /book/c/{slug} (see §7.2.1)
├── name                     text NOT NULL
├── host_venue_id            uuid NOT NULL FK → venues(id)  -- controls branding + slug
├── branding                 jsonb NOT NULL default '{}'  -- logo_url, primary_colour, description
├── service_grouping         text NOT NULL default 'by_practitioner'
│       'by_practitioner' | 'by_service_type'
├── allow_any_practitioner   boolean NOT NULL default false
├── status                   text NOT NULL default 'active'   -- 'active' | 'dissolved'
├── created_at, updated_at   timestamptz NOT NULL default now()

venue_collective_members
├── id                       uuid PK default gen_random_uuid()
├── collective_id            uuid NOT NULL FK → venue_collectives(id) ON DELETE CASCADE
├── venue_id                 uuid NOT NULL FK → venues(id) ON DELETE CASCADE
├── status                   text NOT NULL default 'invited'
│       'invited' | 'active' | 'left' | 'removed'
├── display_order            integer NOT NULL default 0
├── visible_practitioner_ids uuid[] NOT NULL default '{}'  -- practitioners exposed on the page
├── visible_service_ids      uuid[] NOT NULL default '{}'  -- appointment_services exposed
├── allow_any_practitioner_substitution boolean NOT NULL default false
├── invited_by_user_id       uuid FK → auth.users(id) ON DELETE SET NULL  -- who sent the invite
├── joined_at, left_at       timestamptz nullable
└── partial UNIQUE (collective_id, venue_id) WHERE status IN ('invited','active')
```

> `venue_collectives` additionally ships CHECK constraints validating `service_grouping`
> and `status` against their allowed values, and `bookings.collective_id` is a bare `uuid`
> column **without** an FK to `venue_collectives` (within the §7.7 letter, but note there is
> no referential integrity — a dissolved collective's id can persist on historical rows).

**Constraints:**

- A collective needs ≥ 2 `active` members to render a public page.
- Adding a member requires accepted pairwise `account_links` with `full_details` in **both**
  directions between the new venue and every existing member. Enforced at insert time and
  re-verified on every public page render (the link could have been broken since).
- The host venue cannot leave without transferring host status or dissolving the collective.
- The collective auto-dissolves when `active` membership drops below 2 (see §7.5).

### 4.4 RLS — cross-venue data access

**Critical:** these policies are the single source of truth for cross-venue access. They must
be written and tested before any UI code. They extend — never replace — the existing
venue-scoped staff policies (e.g. `staff_manage_bookings`, `staff_manage_guests` in
`20260301000007_rls_policies.sql`).

Resneo has no `current_account_id()`. A staff user may work at multiple venues, so "the
current venue" is not a single value — it is the set of venues where the caller is active
staff. Cross-venue access is therefore expressed through `SECURITY DEFINER` helper functions
that, for a given *owning* venue, report what the current user is permitted to do via any
link to a venue they staff.

```sql
-- The set of venue ids the current caller is active staff at.
CREATE OR REPLACE FUNCTION public.current_staff_venue_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT venue_id FROM public.staff
  WHERE revoked_at IS NULL
    AND (email = (auth.jwt() ->> 'email')
         OR (user_id IS NOT NULL AND user_id = auth.uid()));
$$;

-- Best calendar visibility the caller has into p_owner_venue via any accepted link.
-- Returns 'none' | 'time_only' | 'full_details'.
CREATE OR REPLACE FUNCTION public.link_calendar_grant(p_owner_venue uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT g.v FROM (
       SELECT CASE
         WHEN al.venue_low_id = p_owner_venue THEN al.low_grants_calendar::text
         ELSE al.high_grants_calendar::text
       END AS v
       FROM public.account_links al
       WHERE al.status = 'accepted'
         AND (
           (al.venue_low_id  = p_owner_venue AND al.venue_high_id IN (SELECT current_staff_venue_ids()))
           OR
           (al.venue_high_id = p_owner_venue AND al.venue_low_id  IN (SELECT current_staff_venue_ids()))
         )
     ) g
     -- pick the strongest: full_details > time_only > none
     ORDER BY CASE g.v WHEN 'full_details' THEN 2 WHEN 'time_only' THEN 1 ELSE 0 END DESC
     LIMIT 1),
    'none');
$$;
```

Analogous helpers: `link_pii_grant(p_owner_venue uuid) RETURNS boolean` and
`link_action_grant(p_owner_venue uuid) RETURNS text`. Each evaluates the direction
*owner → caller* (i.e. what the owner venue has granted to the venue the caller staffs).

**Bookings — SELECT.** A booking row in venue X is visible if the caller staffs X, or has at
least `time_only` calendar visibility into X via a link:

```sql
CREATE POLICY "linked_venue_can_view_bookings" ON public.bookings
FOR SELECT USING (
  venue_id IN (SELECT current_staff_venue_ids())
  OR public.link_calendar_grant(venue_id) IN ('time_only', 'full_details')
);
```

**Bookings — UPDATE.** Editing another venue's booking requires `act` of `edit_existing` or
higher:

```sql
CREATE POLICY "linked_venue_can_edit_bookings" ON public.bookings
FOR UPDATE USING (
  venue_id IN (SELECT current_staff_venue_ids())
  OR public.link_action_grant(venue_id) IN ('edit_existing', 'create_edit_cancel')
)
WITH CHECK (
  venue_id IN (SELECT current_staff_venue_ids())
  OR public.link_action_grant(venue_id) IN ('edit_existing', 'create_edit_cancel')
);
```

**Bookings — INSERT / DELETE.** Same shape, but require `act = 'create_edit_cancel'`
specifically. (Cancellation in Resneo is normally a status change to `'Cancelled'`, i.e. an
UPDATE — but creating a brand-new booking in a linked venue, or hard-deleting, needs the full
level.)

**Guests — SELECT.** A linked venue can read another venue's `guests` rows only with
`full_details` + PII granted:

```sql
CREATE POLICY "linked_venue_can_view_guests" ON public.guests
FOR SELECT USING (
  venue_id IN (SELECT current_staff_venue_ids())
  OR (public.link_calendar_grant(venue_id) = 'full_details'
      AND public.link_pii_grant(venue_id) = true)
);
```

The customer-safe `guests_account_safe` view (used by `/account`) is unaffected — it filters
on `user_id = auth.uid()` and is unrelated to linking.

**Other booking-model tables.** `practitioners`, `appointment_services`,
`practitioner_services`, `class_types`, `class_instances`, `experience_events`,
`venue_resources` already have public read policies for active rows (anon can read active
practitioners/services/etc.). Linked-venue staff therefore already see enough to *render* a
calendar. Add linked-venue SELECT policies only where a table has no public read policy and
the linked view needs it (e.g. inactive practitioners or buffer/break configuration). Do not
broaden write access on these — a linked venue never edits another venue's practitioners or
service menu; the `act` permission covers `bookings` only.

**Field-level redaction for `time_only`.** RLS cannot cleanly hide individual columns. When
the caller's grant is `time_only`, the application must query through an anonymised view
rather than the base table:

```sql
-- IMPORTANT (security): the view MUST be security_invoker so the base table's RLS is
-- evaluated as the *caller*, not the view owner. The original definition used only
-- security_barrier, which (because a plain view runs as its owner) would have let a
-- time_only viewer read EVERY venue's time blocks. Fixed in
-- 20260922120000_linked_anonymised_view_calendar_id.sql; this is the live definition.
CREATE OR REPLACE VIEW public.bookings_linked_anonymised
WITH (security_invoker = true, security_barrier = true) AS
SELECT
  b.id, b.venue_id, b.practitioner_id, b.calendar_id,
  b.booking_date, b.booking_time, b.booking_end_time,
  b.status,
  NULL::uuid AS guest_id,
  NULL::uuid AS appointment_service_id,
  NULL::text AS dietary_notes,
  NULL::text AS occasion,
  NULL::text AS special_requests
FROM public.bookings b;
```

The application layer chooses the source per owning venue: own venue and `full_details`
links read `public.bookings`; `time_only` links read `bookings_linked_anonymised`. A helper
`get_linked_booking_source(p_owner_venue uuid)` returns the correct relation name. The
anonymised view inherits the base table's RLS, so a `time_only` viewer still passes the
SELECT policy above but sees only time blocks (`booking_date`, `booking_time`,
`booking_end_time`, `status`, `practitioner_id`) with everything else nulled.

**Mutation safety.** Every cross-venue mutation must:

1. Pass the RLS policy above.
2. Generate an `account_link_audit_log` row in the **same transaction**, written by the
   `cross_venue_booking_audit_trigger` on `bookings` (`AFTER INSERT OR UPDATE`), not by
   application code — this mirrors how the existing `booking_events_trigger` already writes
   `events` rows and prevents any code path from skipping the audit.
3. Carry attribution. `bookings` ships nullable `created_by_linked_venue_id` and
   `last_modified_by_linked_venue_id` (both FK → `venues`, `ON DELETE SET NULL`) as
   **denormalised convenience columns for UI attribution** ("last edited by {linked venue}").
   They are `NULL` for ordinary same-venue bookings.

**How the trigger actually resolves the acting venue (corrected 2026-06-04).** The shipped
trigger (`log_cross_venue_booking_action`, hardened in
`20260920120000_linked_accounts_audit_hardening.sql`) does **not** read the attribution
columns. It resolves the acting venue in two ways:

- **Explicit context** — the `SECURITY DEFINER` RPCs `linked_apply_booking_insert()` /
  `linked_apply_booking_update()` set three transaction-local GUCs
  (`reserveni.linked_action_venue`, `…_user`, `…_link`) which the trigger reads. This is the
  intended cross-venue write path and supports unified-calendar fields (`calendar_id`,
  `estimated_end_time`, `service_item_id`) added in `20260921120000` / `20260923140000`.
- **Auto-resolution fallback** — for a direct PostgREST write with no GUCs, the trigger
  derives the acting venue from `current_staff_venue_ids()` and finds the authorising
  accepted link; **if none exists it raises `insufficient_privilege` and blocks the write.**
  Same-venue writes (caller staffs the owning venue) and pure service-role/cron writes
  (caller staffs *no* venue) are correctly skipped.

> **⚠ P0 — see §16.1 #1.** The auto-resolution fallback depends on the writer having a staff
> identity (`auth.jwt()`/`auth.uid()`). A cross-venue mutation performed through the
> **service-role admin client** has *no* staff identity, so the trigger's "staffs no venue →
> system write" branch fires and **no audit row is written (and the write is not blocked).**
> The main booking route (`/api/venue/bookings/[id]`) performs its `bookings` writes through
> exactly such a client — `getVenueStaff().db` is the service-role admin client by design
> (`venue-auth.ts:166-168,216`) — so **cross-venue edits via the main route are currently
> unaudited.** Only the dedicated `/api/venue/linked-calendar/booking` route audits, because it
> calls the `linked_apply_*` RPCs which set the GUC. **Fix required:** route cross-venue
> (`!isOwnVenue`) booking mutations through `linked_apply_*` (or a user-scoped client). The
> hard-`DELETE` path is unaudited for a second reason — the trigger is INSERT/UPDATE-only
> (§16.1 #1c).

Note: `bookings.created_by_staff_id` references the **owning** venue's `staff`. A cross-venue
actor has no `staff` row in the owning venue, so `created_by_staff_id` must be left `NULL`
for cross-venue creates (it is already nullable); attribution lives in
`created_by_linked_venue_id` + the audit log instead.

---

## 5. Permission model

Three orthogonal dimensions, set independently per direction on the link.

### 5.1 Calendar visibility (`link_calendar_visibility`)

| Value | Meaning |
|---|---|
| `none` | Cannot see any of the other venue's calendar/booking data. |
| `time_only` | Sees time blocks (busy/free with duration) per practitioner. No guest name, no service, no notes. Served via `bookings_linked_anonymised`. |
| `full_details` | Sees full booking detail: time, practitioner, service, status. |

### 5.2 Client PII visibility (`low_grants_pii` / `high_grants_pii`)

| Value | Meaning |
|---|---|
| `false` | Even with `full_details`, `guests` rows (name, email, phone, notes) stay hidden. |
| `true` | Full `guests` information visible. Only meaningful with `full_details`. |

### 5.3 Action permissions (`link_action_level`)

| Value | Meaning |
|---|---|
| `none` | Read-only. |
| `edit_existing` | Can UPDATE existing `bookings` (reschedule, change service/practitioner, edit notes, set status). Cannot INSERT new bookings. |
| `create_edit_cancel` | Full booking management: INSERT new bookings, UPDATE, and cancel (status → `Cancelled`) in the linked venue. |

A linked venue never edits the other venue's `practitioners`, `appointment_services`,
working hours, or settings — `act` scopes to `bookings` only.

### 5.4 Default preset

A new link request is pre-filled, mutually, with:

- Calendar visibility: `full_details`
- Client PII: `true`
- Action: `edit_existing`

This errs toward useful access while keeping create/cancel rights deliberate (accidentally
cancelling another venue's booking is high-impact). The requester may adjust any dimension
before sending; the recipient may adjust again on acceptance (§6.2).

### 5.5 Constraint rules (enforced in UI **and** as DB CHECK constraints)

- A link cannot grant `none` in **both** directions — that is a no-op. One-way links (e.g.
  A sees B but B does not see A) are valid; zero-way links are rejected at submission.
- `calendar = 'time_only'` forces `pii = false` and `act = 'none'`.
- `pii = false` forces `act = 'none'`.
- `calendar = 'none'` forces `pii = false` and `act = 'none'` for that direction.

---

## 6. Link lifecycle

### 6.1 Request creation

1. An Admin on Venue A opens `/dashboard/settings?tab=linked-accounts` → "Send link request".
2. They identify Venue B. **Resolved decision (§12):** identify by Venue B's public
   booking-page **slug** (`venues.slug`, already unique and already the public identifier
   used in `/book/[venue-slug]`). The form does a live lookup against an Admin-only endpoint
   that returns only the venue's display `name` for confirmation — never PII. Email is *not*
   used as the identifier (it couples the link to one person and venues already have a
   stable public slug).
3. They configure permissions for both directions (defaults per §5.4).
4. They optionally add a `request_message`.
5. Submit.

System actions on submit (server route, e.g. `POST /api/venue/account-links`):

- Validate both venues are Appointments-family and `plan_status = 'active'`.
- Insert an `account_links` row, `status = 'pending'`, ordering the two venue ids into
  `venue_low_id`/`venue_high_id`, setting `requested_by_venue_id`.
- Send an email (SendGrid, authenticated domain) to Venue B's contact email (`venues.email`)
  and to every active Admin on Venue B.
- Surface a dashboard banner to Admins on Venue B (§8.3).

### 6.2 Request acceptance

When an Admin on Venue B loads any dashboard page, a persistent banner shows:

> 🔗 **{Venue A name} wants to link with you.** [Review request] [Dismiss for 24h]

"Review request" opens a modal showing Venue A's name, the `request_message`, and a plain
summary of permissions per direction:

> **{Venue A} will be able to:** see your calendar in full, see your client details, edit
> existing bookings.
> **You will be able to:** see {Venue A}'s calendar in full, see their client details, edit
> existing bookings.

Buttons: **Accept**, **Accept with changes**, **Reject**.

- **Accept** — applies the requested permissions verbatim; `status → 'accepted'`,
  `responded_at`, `responded_by_user_id` set.
- **Accept with changes** — reopens the permission editor; on submit the modified grants are
  saved and `status → 'accepted'`. Venue A is emailed/notified with a diff of what changed.
- **Reject** — `status → 'rejected'`. Venue A receives a brief notification; no reason
  collected.

### 6.3 Request expiry

Pending requests expire 30 days after `created_at`. The daily
`/api/cron/account-link-maintenance` job sets `status = 'expired'`,
`termination_reason = 'request_expired'`, and notifies both venues.

### 6.4 Active link

An accepted link appears in both venues' Linked Accounts tab with: the other venue's name,
the permissions in each direction (framed as "you can…" / "they can…"), the date linked, a
"View audit log" action, and buttons **Edit permissions** and **Unlink**.

### 6.5 Permission changes mid-link

Either venue can propose a permission change; it behaves like a new request — the other venue
sees a banner and must accept, with the current grants shown for comparison. Until accepted,
the existing grants stay in force.

There are therefore **three** distinct ways a grant can change. The distinction is "whose
data is becoming more exposed", because exposing *your own* data more is your decision alone,
but exposing *the other venue's* data more is theirs:

| Path | API | Consent | Direction | Effect |
|---|---|---|---|---|
| **Reduce access now** | `POST …/reduce` | None — unilateral | Caller's own grant only; reduction-only (rejects increases) | Immediate |
| **Grant access now** | `POST …/[id]/grant` | None — unilateral | Caller's own grant only; increase-only (rejects reductions) | Immediate |
| **Edit permissions** (negotiated) | `PATCH …/[id]` (`propose_change`/`accept_change`) | Counterparty must accept | Either direction | On acceptance |

**Exception — unilateral reduction.** A venue may *reduce* the permissions it grants at any
time with no consent from the other party (e.g. immediately revoke PII access).

**Exception — unilateral grant of your own data (shipped; documented 2026-06-04).** A venue
may *increase* the access it grants the other venue into **its own** data without consent,
via the `grant` route — this is voluntary sharing of your own data, not seizing access to
theirs. This refines the earlier blanket statement "it may never unilaterally increase what
the other venue can do": the prohibition holds for *grabbing* access to the other venue's
data (that always requires their acceptance through the negotiated flow), but loosening
access to *your own* data is the granting venue's prerogative. Both unilateral paths only
ever touch the caller's own grant columns and reject no-op or wrong-direction changes; both
notify the other venue (§9). The negotiated `Edit permissions` flow remains for any change
that affects what the *other* venue exposes.

### 6.6 Termination

| Cause | Trigger | `termination_reason` | Notification |
|---|---|---|---|
| Manual unlink | Either Admin clicks "Unlink" | `unlinked` | Email + dashboard notice to the other venue |
| Subscription lapse | Owning venue's `plan_status` leaves `'active'` or `pricing_tier` becomes ineligible | `subscription_lapsed` | 7-day advance email when the lapse is foreseeable; immediate suspension on lapse (§6.7) |
| Venue deleted | A venue row is deleted (`ON DELETE CASCADE` removes the link) | `venue_deleted` | Surviving venue emailed |
| Plan ineligibility | Venue moves to the restaurant table-reservation product | `plan_ineligible` | Both venues emailed |

On termination:

- All cross-venue visibility ceases immediately — the RLS helpers in §4.4 return `none`
  because the link is no longer `accepted`. No purge job is needed.
- `account_link_audit_log` is preserved and stays accessible to both venues under "Past
  links".
- Bookings that the linked venue created or edited **remain in the owning venue** — they were
  always owned by `venue_id`. `created_by_linked_venue_id` is retained for the historical
  record. **This is the data-sovereignty guarantee: breaking a link changes only access, never
  ownership.**
- Any venue collective depending on this pairwise link is re-evaluated (§7.5).

### 6.7 Subscription lapse handling

Resneo venues carry `plan_status` and (for Light) `light_plan_free_period_ends_at`. When a
linked venue's subscription is heading for lapse:

- **Foreseeable lapse** (Light free period ending without a payment method, or a scheduled
  cancellation): 7 days before the effective date, email all venues linked to it.
- **On lapse** (`plan_status` becomes `'past_due'` or `'cancelled'`): the daily maintenance
  cron sets affected links `status = 'suspended'`. Cross-venue visibility ceases; the audit
  log is preserved; the link still shows in both settings tabs as "Suspended — {venue}'s
  subscription is inactive".
- **Restored within 30 days** (`plan_status` back to `'active'`): the cron transitions the
  link back to `accepted` with its original grants.
- **Still suspended after 30 days:** the cron sets `status = 'expired'`,
  `termination_reason = 'subscription_lapsed'`. A fresh request is required to relink.

---

## 7. Venue collectives — combined booking page (Phase 2)

### 7.1 Concept

A venue collective is a public booking page combining two or more pairwise-linked venues
under shared branding:

- A single URL: `/book/c/{slug}` (the `c` segment keeps the collective namespace separate
  from the existing per-venue `/book/[venue-slug]` and per-practitioner
  `/book/[venue-slug]/[practitioner-slug]` routes).
- Combined service browsing, grouped `by_practitioner` or `by_service_type`.
- Optional "any available practitioner" routing for substitutable services.
- Shared branding (logo, colour, description) controlled by the host venue.

Each member venue's own `/book/[venue-slug]` page continues to operate unchanged. The
collective page is supplementary, served by the existing `BookPublicBookingFlow` component
(reused, as the embed route already does — see `Embed_Public_Booking_URL_Contract.md`) fed
with a multi-venue dataset.

### 7.2 Eligibility to form or join

Every (prospective) member must:

- Be an Appointments-family venue with `plan_status = 'active'`.
- Hold accepted pairwise `account_links` with **`full_details` in both directions** with
  every other member (a combined real-time-availability page cannot work with `time_only` or
  asymmetric visibility).
- Have explicitly accepted a collective invitation.

The Admin creating the collective must be Admin on the host venue. Invitations go to each
invitee's `venues.email` and active Admins, and must be accepted by an Admin on the invitee
venue.

**Render-time eligibility re-check (shipped 2026-06-04).** Membership eligibility is not just an
entry gate — it is re-evaluated on **every public page render**. `loadPublicCollective` excludes
any active member whose venue is not currently eligible (`evaluateLinkEligibility(...).canCreate`
— Appointments-family with `plan_status='active'`), and renders the page only if ≥2 *eligible*
members remain. A member with a lapsed subscription is **excluded, not removed**: it disappears
from the public page immediately (closing the ≤24h window before the cron suspends the link) and
**reappears automatically** once its subscription is restored, mirroring the link suspend/resume
model (§6.7). Terminal removal from the collective still occurs through the §7.5 link cascade if
and when the underlying link actually ends.

### 7.2.1 Naming and slug uniqueness

- **Name:** a collective's `name` must be unique (case-insensitive) across all `active`
  `venue_collectives`. Names of dissolved collectives are released for reuse after 30 days.
- **Slug:** `venue_collectives.slug` has a DB `UNIQUE` constraint. Because collective pages
  live under the dedicated `/book/c/{slug}` path, the slug namespace does **not** collide
  with `venues.slug`; it must only be unique among collectives. Lowercase, hyphen-separated,
  validated live as the user types and re-checked on submit.
- Conflict errors must not disclose *which* venue or collective holds a conflicting name.

### 7.3 Creation flow

1. An Admin with ≥ 1 full-mutual link opens Linked Accounts tab → "Create venue collective".
2. Configure: `name`, `slug` (live availability check), `branding`, `service_grouping`,
   `allow_any_practitioner`.
3. Invite linked venues. Each invitee gets an email + dashboard banner.
4. Each invitee accepts and configures `visible_practitioner_ids`, `visible_service_ids`,
   `allow_any_practitioner_substitution`, and `display_order`.
5. Once ≥ 2 members are `active`, `/book/c/{slug}` goes live.

### 7.4 Host responsibilities and transfer

The host venue controls `name`, `slug`, `branding`, `service_grouping`,
`allow_any_practitioner`, member removal, and dissolution. The host may transfer host status
to any `active` member (who must accept). If the host venue leaves or is deleted, the system
requires host transfer first or auto-dissolves the collective.

**Automatic host reassignment (shipped 2026-06-04).** A host can also lose its membership
*involuntarily* — the §7.5 cascade removes any member that drops below full-mutual links,
including the host. To avoid orphaning the collective (a host pointing at a removed venue makes
every admin action impossible), `reconcileCollective` automatically reassigns hosting to the
**longest-tenured surviving active member** (earliest `joined_at`, deterministic `venue_id`
tiebreak) whenever the current host is no longer an active member, provided ≥2 members survive
(otherwise the collective dissolves per §7.5). This emergency transfer is immediate and does
**not** require acceptance — the consent-based transfer above is for *deliberate* handover; an
involuntary one cannot block on a removed host's input. The new host is emailed
(`notifyCollectiveHostTransferred`). The check is idempotent and self-heals any collective left
orphaned by an earlier reconcile.

### 7.5 Membership changes and link dependencies

If a pairwise link between two collective members ends, or is reduced below full mutual
visibility:

- Both affected venues are auto-removed (`status = 'removed'`).
- Remaining members are notified.
- If `active` membership drops below 2, the collective is dissolved (`status = 'dissolved'`).
- If the removed venue was the **host** and ≥2 members survive, hosting is automatically
  reassigned to the longest-tenured survivor (§7.4) rather than orphaning the collective.

This cascade is re-checked both on link-change events and on every public page render, since
RLS will already have cut off the data.

### 7.6 "Any practitioner" routing

When `allow_any_practitioner` is on at the collective level and a member opts in per service
(`allow_any_practitioner_substitution`), the page offers "Any available practitioner". On
selection the system finds the earliest slot across eligible `practitioners` (across member
venues), and the resulting `bookings` row is created **in the chosen practitioner's owning
venue** — `venue_id` and `practitioner_id` of that venue. Data ownership is unchanged.

### 7.7 Booking attribution and data flow

Collective pages are a routing layer, never a data layer. Every booking made through
`/book/c/{slug}` is a normal `bookings` row under exactly one `venue_id` / `practitioner_id`.
There is no "collective-level booking". A booking routed through the collective uses the
existing `booking_source` enum value `'online'` and may record the collective via a nullable
`bookings.collective_id` column if attribution reporting is wanted (optional; decide at
Phase 2 build).

### 7.8 Branding scope

Collective branding applies only to `/book/c/{slug}` and to confirmation communications for
bookings made through that page. Each venue's own booking page and comms keep their own
branding (`venues.logo_url`, etc.).

---

## 8. UI specification

### 8.1 Linked Accounts tab

Add a `linked-accounts` entry to the `TABS` array in
`src/app/dashboard/settings/SettingsView.tsx`, gated on `isAdmin` exactly as the `staff` and
`data-import` tabs are in `resolveInitialTab()`. Hide the tab entirely for
table-reservation venues. Direct navigation to `?tab=linked-accounts` by a non-Admin or a
restaurant venue falls back to `profile`.

The tab has four sections (rendered with the existing `SectionCard` component for visual
consistency):

1. **Active links** — accepted `account_links`. Each row: other venue name, permission
   summary per direction, date linked, "View audit log", "Edit permissions", "Reduce access
   now", "Unlink".
2. **Pending requests** — split "Sent by you" / "Received". Received rows offer Accept /
   Accept with changes / Reject; sent rows offer Cancel.
3. **Venue collectives** (Phase 2) — collectives the venue belongs to, with role (host /
   member), member count, status; "Create venue collective" when eligible.
4. **Past links** — `rejected`/`revoked`/`expired` links, retained for audit access. Each
   row: other venue name, period, termination reason, "View audit log". No reactivation from
   here — a fresh request is required.

### 8.2 Calendar and bookings page integration

**Target behaviour:**

- Own `practitioners` render solid; linked-in practitioners must be **visually distinct**
  (desaturated/tinted/patterned) and labelled with the source venue name. **The cards on the
  day/week grid do not yet carry this treatment — see §19.1.**
- Each linked-in calendar can be toggled in the view (a local view preference; does not
  affect the link).
- Bookings the viewer cannot edit (`act = 'none'`, or `time_only`) are read-only in the UI.
- `time_only` linked bookings render as bare time blocks: "{Venue} — busy", no other detail.

**Implementation status (corrected 2026-06-04):**

| Surface | Status | Notes |
|---|---|---|
| `/dashboard/calendar` (`PractitionerCalendarView`, `linkFeature` gated) | **Shipped (day + week)** | Linked practitioners appear as extra columns keyed `linked:{venueId}:{practitionerId}`, persisted in session preferences, data from `/api/venue/linked-calendar`. **Correction:** linked columns render in a **dedicated "Linked venues" block** (grouped by venue name), *not* inside `CalendarColumnsChecklist` — only own-venue columns use that component. |
| Linked booking interactivity | **Shipped — interactive, not read-only** | **Correction (supersedes the old "not draggable" claim and §15.6):** `full_details` + `edit_existing`/`create_edit_cancel` linked columns route through the **native grid** and are **draggable/resizable/editable via the native `BookingDetailPanel`**, PATCHing `/api/venue/bookings/[id]`. Only `none`/`time_only` columns are read-only (`LinkedDayColumn`). The dedicated `LinkedBookingDetailModal` / `EditLinkedBookingModal` / `CreateLinkedBookingModal` are used by the standalone `LinkedCalendarView`, not by the main grid's edit gesture. The native path writes through the service-role admin client; it is now **explicitly audited** via `recordBookingWriteAudit` at each write site (§16.1 #1, fixed 2026-06-04), which also drives §17 notifications. |
| `/dashboard/calendar` month view | **Shipped (summary)** | Per-day linked booking count badge (`+N`) + marker dot; click day → day view for column detail. Month markers *are* desaturated; day/week cards are not. |
| `/dashboard/day-sheet` | **Synced list** | `LinkedCalendarView` uses the day-sheet date (no second date picker); CTA to `/dashboard/calendar`. |
| `/dashboard/linked-calendar` | **Fallback page** | Standalone linked-calendar page retained; not linked from main nav. |
| `/dashboard/bookings` (appointments list) | **Shipped** | `AppointmentBookingsDashboard`: own / linked-in / all source filter; grant-aware actions (time_only rows open read-only). **Correction:** it flattens linked rows into the main registry (`flattenLinkedDashboardRows`); the `LinkedBookingsPanel` component the spec previously cited was unused/legacy and has now been **deleted (2026-06-04)**. |

**Linked classes/events on the grid (undocumented; documented 2026-06-04).** Although the
feature is appointments-scoped, `full_details` links also surface the owning venue's
**classes and experience-events as read-only blocks** on the linked columns
(`src/lib/linked-accounts/linked-schedule-blocks.ts`, `GET …/linked-calendar/event`). These
are view-only (no cross-venue class/event booking exists), and `time_only` links never see
titles. This is an acceptable read-only enrichment, but it stretches the "appointments-only"
framing of §3 and should be acknowledged: a linked venue *sees* (never edits) the other
venue's non-appointment calendar entities.

### 8.3 Incoming-request banner

Persistent across dashboard pages until actioned, shown only to Admins:

> 🔗 **{Requester venue} wants to link with you.** [Review request] [Dismiss for 24h]

"Dismiss for 24h" hides it for 24 hours without rejecting. After 30 days the request expires
and the banner disappears.

### 8.4 Audit log view

Per-link, opened from the Linked Accounts tab. Paginated, filterable list backed by
`account_link_audit_log`:

- Date/time, acting user + acting venue, action, affected resource (linked if it still
  exists), before/after diff for edits.
- Filters: action type, date range, acting user.
- CSV export of the full log.

### 8.5 Booking widget behaviour

The embeddable widget configuration lives in
`src/app/dashboard/settings/widget/WidgetSection.tsx`:

- A venue with pairwise links but **no** collective: the widget is unchanged — it embeds only
  that venue's own `/embed/[venue-slug]` flow.
- A venue that is an `active` member of a collective: the widget config offers **two** embed
  options — "My venue only" (unchanged) and "Venue collective" (the combined
  `/book/c/{slug}` flow). Both remain available; the venue chooses per embed.
- No combined widget is offered for `time_only` links — they never qualify for a collective.

### 8.6 Cross-suggestion when fully booked

Collective-scoped only (not pairwise). When a customer finds no availability on a member
venue's own `/book/[venue-slug]` page:

- If that venue is in a collective: "{Venue} is fully booked this week. Other practitioners
  at {Collective name} have availability — [Try the {Collective} page]".
- If the venue only has pairwise links and no collective: no cross-suggestion (pairwise links
  imply no shared brand and may be between competitors).

---

## 9. Notifications

All link-related emails are sent via the existing **SendGrid** integration on the
authenticated domain, to the recipient venue's `venues.email` and to its active Admin staff.
Dashboard banners and in-app notices are shown only to Admins.

| Event | Channels | Recipient |
|---|---|---|
| Link request received | Email + dashboard banner | Receiving venue's `email` + Admins |
| Link request accepted | Email + dashboard notice | Requesting venue |
| Link request accepted with changes | Email + dashboard notice (with diff) | Requesting venue |
| Link request rejected | Email + dashboard notice | Requesting venue |
| Link request expired | Email | Both venues |
| Link unlinked by other venue | Email + dashboard notice | Surviving venue |
| Permission change proposed | Email + dashboard banner | Other venue |
| Permission reduced unilaterally | Email + dashboard notice | Other venue |
| Subscription lapse warning (7 days) | Email | All venues linked to the lapsing venue |
| Link suspended (lapse) | Email | All linked venues |
| Link resumed (subscription restored) | Email | All linked venues |
| Venue collective invitation | Email + dashboard banner | Invitee venue |
| Removed from venue collective | Email + dashboard notice | Removed member |
| Venue collective dissolved | Email | All members |
| Venue collective host reassigned (automatic, §7.4) | Email | New host venue |

**SMS is out of scope for this feature.** Resneo's SMS path is metered per-venue (Twilio,
`increment_sms_usage`, billed to Stripe) and SMS is customer-facing operational/marketing
messaging — link administration is internal and email-only.

**Status notes (2026-06-04 audit):**

- **The "dashboard notice" channel is now real (2026-06-04).** Beyond the incoming-request
  banner (pending requests + permission-change proposals), **all §9 lifecycle events now write an
  in-app notification** to the recipient venue's bell (accepted / rejected / unlinked / reduced /
  suspended / resumed / removed-from-collective / dissolved / collective invitation / etc.), via
  the `notifyVenue` chokepoint (§17 Phase 4). The notification center is §17.2.
- **Two cron termination emails were missing and are now fixed (2026-06-04):** cron
  `plan_ineligible` termination (§6.6 says "both venues emailed") and the 30-day
  `subscription_lapsed` expiry now send `notifyLinkTerminatedIneligible` /
  `notifyLinkLapseExpired` to both venues. See §16.1 #4.
- **"Accept with changes" now shows a true diff (2026-06-04)** — a before→after delta of the
  changed permissions in both the email and the bell. See §17.5.
- **Cross-venue *write* notices** (a partner cancelled/rescheduled/created a booking in your
  calendar) are sent as of 2026-06-04 — in-app always, plus email per the owning venue's
  preferences (§17.3/§17.4).

---

## 10. Audit and compliance

### 10.1 What is logged

Every cross-venue action writes an `account_link_audit_log` row (§4.2):

- **Reads:** calendar and booking-detail views, debounced to 5-minute windows per
  `(acting_user_id, resource_id)`.
- **Writes:** all cross-venue `bookings` INSERT / UPDATE (including status → `Cancelled`),
  with `before_state` / `after_state` JSON, written by the `bookings` audit trigger in the
  same transaction.

In addition, the owning venue's existing `events` log continues to receive
`booking_created` / `booking_status_changed` rows from `booking_events_trigger` — so the
owning venue has its native record regardless of who acted.

Both venues can read the full `account_link_audit_log` for a link at any time, including
after termination.

### 10.2 GDPR posture

A link is a controller-to-controller data-sharing arrangement between two venues. Each venue
remains the data controller for its own `guests`. The arrangement provides: explicit recorded
consent (link acceptance), a specified purpose (calendar coordination and booking
management), a full audit trail, easy revocation, and automatic data severance on
termination (severance is intrinsic — nothing is ever copied).

This should be reflected in:

- Resneo's customer Terms of Service, updated to describe linked accounts. **✅ Done** —
  subsection under §7 in `src/app/terms/customer/page.tsx` (May 2026). Website Terms of Use
  unchanged (public-site scope only).
- A short data-sharing notice shown in the link-acceptance modal. **✅ Done** — copy in
  `LinkedAccountsSection.tsx` accept/review modal (controller-to-controller arrangement,
  revocation, data-controller retention).
- Guidance to venues to update their own privacy policy when they link. **⬜ Not done** — no
  in-product onboarding doc / checklist item yet.

These legal/product copy updates should be reviewed by Resneo's Northern Ireland commercial
solicitor before treating the feature as production-ready for all founding venues.

### 10.3 Customer-facing disclosure

There is no per-booking customer-facing disclosure when a booking is made with a venue that
holds linked-account relationships. To the customer a booking appears as a normal booking
with the practitioner they chose. The linked relationship is operational and disclosed at the
venue's privacy-policy level, not per booking. Resneo onboarding documentation should
advise venues to update their privacy policy when they link.

---

## 11. Implementation phasing

Status key: ✅ shipped · 🟡 partial · ⬜ not started

### Phase 1 — pairwise links (MVP) — ✅ shipped (with production gaps in §15)

| # | Deliverable | Status |
|---|---|---|
| 1 | Migration + enums + `account_links` / `account_link_audit_log` + `bookings` attribution columns + RLS helpers + `bookings_linked_anonymised` + audit trigger | ✅ `20260919120000_linked_accounts.sql`, `20260920120000…_audit_hardening.sql`, `20260921120000…_insert_calendar_id.sql`, `20260922120000…_anonymised_view_calendar_id.sql`, **`20260923140000…_update_calendar_id.sql`** (unified-calendar support on the cross-venue UPDATE RPC — previously omitted from this list), `20260518120000…_venue_delete_terminate_account_links.sql` |
| 2 | RLS test suite before UI | ✅ `supabase/tests/linked_accounts_rls_test.sql`; unit tests in `src/lib/linked-accounts/permissions.test.ts` |
| 3 | Linked Accounts settings tab | ✅ `LinkedAccountsSection.tsx`, gated in `SettingsView.tsx` |
| 4 | `/api/venue/account-links/*` (create, respond, edit, reduce, unlink, lookup, audit) | ✅ |
| 5 | Incoming-request + pending-change banner | ✅ `LinkedAccountBanner.tsx` in dashboard shell; 24h dismiss via `localStorage` |
| 6 | Calendar / bookings integration | 🟡 Day + week grid + month summary on `/dashboard/calendar` shipped; day-sheet synced list. `full_details`+edit linked bookings are interactive on the native grid (not read-only); that edit path is now **audited** via explicit `recordBookingWriteAudit` calls (§16.1 #1, fixed). Linked cards lack the muted treatment (§19.1). |
| 7 | Audit log UI + CSV export | ✅ `LinkedAccountAuditModal.tsx` → `GET …/audit?format=csv` |
| 8 | Daily cron | ✅ `/api/cron/account-link-maintenance` in `vercel.json` |
| 9 | Email notifications (§9) | ✅ `src/lib/linked-accounts/notifications.ts` + `src/lib/emails/templates/linked-account-emails.ts` |
| 10 | Subscription lapse / resume / 30-day suspended expiry | ✅ Cron + `notifyLinkLapseWarning` / `Suspended` / `Resumed` |
| — | Cross-venue calendar API | ✅ `/api/venue/linked-calendar`, `…/booking`, `…/guests`, `…/booking/view` |
| — | Read-audit debouncing | ✅ `recordReadAudit()` (5-minute window) |
| — | Pending outgoing cap + rejected cooldown | ✅ `MAX_PENDING_OUTGOING_REQUESTS`, `REJECTED_REQUEST_COOLDOWN_DAYS` in create route |
| — | Mid-link permission negotiation (`pending_change`) | ✅ API + settings UI + banner |

**Phase 1 code map:** `src/lib/linked-accounts/*`, `src/components/linked-accounts/*`,
`src/app/api/venue/account-links/*`, `src/app/api/venue/linked-calendar/*`.

### Phase 2 — venue collectives — 🟡 partial

| Deliverable | Status |
|---|---|
| `venue_collectives` / `venue_collective_members` + RLS | ✅ Same migration family as Phase 1 |
| Settings UI (`VenueCollectivesPanel`) + `/api/venue/collectives/*` | ✅ Create, invite, accept, configure, remove, dissolve, `transfer_host` |
| `/book/c/{slug}` public page | ✅ `src/app/book/c/[slug]/` + `CollectiveBookingFlow.tsx` |
| Collective-aware widget embed | ✅ `WidgetSection.tsx` |
| `bookings.collective_id` attribution | ✅ Validated on create routes |
| Link-change → collective reconcile | ✅ `reconcileCollective` / cron hook |
| **"Any practitioner" routing (§7.6)** | 🟡 Flag now hidden as "coming soon" (no false promise); cross-venue slot search in `CollectiveBookingFlow` still deferred |
| **Cross-suggestion when fully booked (§8.6)** | ✅ `CollectiveCrossSuggestion` in the appointment no-availability state (collective-scoped, public guests) |
| Collective name reuse after dissolve (30 days, §7.2.1) | ✅ Create rejects names dissolved within 30 days (case-insensitive, non-disclosing) |
| Host transfer with accept step (§7.4) | 🟡 API updates `host_venue_id` immediately; no separate acceptance flow |
| Collective branding on confirmation comms (§7.8) | ⬜ Not verified / likely still per-venue templates only |

### Phase 2.5 — world-class completion (specced 2026-06-04, §16–§20) — 🟡 started

- **Cross-venue activity awareness & write notifications + in-app notification center** (§17)
  — the trust guarantee for write grants. **✅ Phases 1–4 shipped** (notifications store + RLS +
  audit-log trigger + feed/mark-read API + formatter + `NotificationBell` UI + per-venue email
  preferences + per-pref cross-venue write emails + **all §9 lifecycle events in the bell** +
  the **accept-with-changes true diff**, §17.0/§17.5). Firing for all cross-venue write paths
  since the §16.1 #1 P0 fix. Remaining enhancements: the notes-email daily digest (Phase 3.1),
  per-event notification types, per-category in-app muting, and realtime bell refresh.
- **Calendar-scoped (per-practitioner) sharing** (§18) — ✅ **shipped 2026-06-04** (unlocks the
  chair-rental persona): per-direction calendar scope, enforced in the read route + write gate +
  RLS backstop, with a "which calendars?" picker on the granting side.
- **UX/accessibility/design standards** applied across every surface (§19).
- **Connection & invitation experience** — name search + shareable invite link/QR (§20).
- **Collective management & branding UI** (§16.2) — make Phase 2 fully usable from the product.

### Phase 3 — post-launch, demand-driven — ⬜ not started

- Saved permission presets / link templates.
- Bulk link requests.
- Analytics / transparency dashboard on linked-calendar usage and cross-venue access.
- Soft UI warning when a venue holds many links (~10, §3) — *(note: already shipped, §15.3.)*
- Time-of-day / per-service scoping on top of §18's per-calendar scope.

---

## 12. Open questions — resolved

- **Venue identifier for link requests:** use `venues.slug` (already unique, already the
  public identifier). Email is not used. *(Resolved — §6.1.)*
- **Link request rate limits:** cap outgoing `pending` requests at 10 per venue and apply a
  7-day cooldown before re-requesting a venue that rejected a request. *(Resolved — to be
  enforced in the create route.)*
- **Audit log retention after subscription cancellation:** retained indefinitely;
  `account_link_audit_log` is each venue's own record of access to its own data and is never
  deleted. *(Resolved — §4.2, §10.)*
- **User-level authorisation:** Admin staff only. *(Resolved — §3.1.)*
- **Notification recipient:** `venues.email` plus active Admin staff. *(Resolved — §9.)*
- **Customer disclosure:** none per booking; policy-level only. *(Resolved — §10.3.)*
- **Collective naming/slug:** name unique among active collectives; slug unique among
  collectives under the dedicated `/book/c/{slug}` namespace. *(Resolved — §7.2.1.)*

---

## 13. Out of scope

- Merging or sharing `guests` rows across venues. Each `guests` row lives under one
  `venue_id` and is matched by `UNIQUE (venue_id, email)`.
- Cross-venue reporting/analytics dashboards spanning multiple venues.
- Cross-venue staff messaging or chat.
- Shared `venue_resources` (e.g. a wash basin) blocking availability across linked venues.
- Cross-venue staff rota or `practitioners` working-hours management.
- Revenue-sharing or chair-rent tracking between linked venues.
- Restaurant (table-reservation) venue participation in any form.
- SMS notifications for link events.

---

## 14. Decision log

**2026-06-04 (audit + world-class gap analysis):** Full code-vs-spec audit across DB/RLS, API,
settings UI, calendar/bookings, collectives, and cron/notifications. Synced §4 data-model
drift (`pending_change`, `suspended_at`, `invited_by_user_id`, `not_zero_way`, the
`security_invoker` redaction-view fix, the GUC/RPC audit plumbing and trigger auto-resolution,
the `20260923140000` migration). Corrected §8.2/§15.6 (linked bookings *are* interactive on the
native grid; `LinkedBookingsPanel` is legacy/unused; linked classes/events render read-only;
`venue-profile` route). Refined §6.5 to document the unilateral *grant* path. **P0 audit-integrity
gap (§16.1 #1) — confirmed.** This finding was raised, then mistakenly *withdrawn* on the
inference that the booking route's cross-venue writes are user-scoped, then **re-confirmed** by
reading `venue-auth.ts`: `getVenueStaff().db` is the service-role admin client, so cross-venue
edits via the main route bypassed the audit trigger and wrote no `account_link_audit_log` row —
then **fixed the same day** (item 5 below). Added five normative sections: §16 audit & roadmap, §17 cross-venue
activity awareness & in-app notifications, §18 calendar-scoped (per-practitioner) sharing,
§19 UX/accessibility/design standards, §20 connection & invitation experience. **Implemented the
same day (clearing every P1):** (1) the two missing cron termination emails (§6.6/§6.7) —
`notifyLinkTerminatedIneligible` / `notifyLinkLapseExpired`; (2) the stale-host orphaning fix
(§7.4) — `reconcileCollective` reassigns `host_venue_id` to the longest-tenured survivor
(`selectReplacementHost`, unit-tested) and emails the new host (`notifyCollectiveHostTransferred`),
self-healing any orphaned collective; (3) render-time collective eligibility (§7.2) —
`loadPublicCollective` excludes lapsed/ineligible members from the public page (recoverable, not
terminal), with `evaluateLinkEligibility` now unit-tested; (4) **§17 Phase 1** — the
`account_link_notifications` store (table + RLS + audit-log trigger), the `GET/POST
/api/venue/notifications` feed + mark-read, and a unit-tested display formatter; (5) **§16.1 #1 P0
fix** — the `[id]` booking route now calls the existing `recordBookingWriteAudit` at all eight
cross-venue PATCH write sites (best-effort, `!isOwnVenue`-guarded), so main-route edits/cancels/
reschedules write an audit row and the §17 trigger turns it into a notification; covered by
`audit.test.ts` and pgTAP Test 22; (6) **§16.1 #1c** — the DELETE handler now records a
`deleted_booking` audit row (no notification — the row is gone); (7) **§17 Phase 2** — the
`NotificationBell` dashboard UI (unread badge, day-grouped popover, mark-read, deep-links, 60s
poll), mounted in the shell and verified rendering in preview; (8) **§17 Phase 3** — per-venue
email preferences (`venues.linked_notification_prefs`, resolver + classifier unit-tested),
`notifyCrossVenueBookingWrite` wired post-response into all cross-venue write paths gated by the
owning venue's prefs, the `GET|PATCH /api/venue/notifications/preferences` API, and the
`NotificationPrefsCard` settings UI (preview-verified). v1 deviations: in-app always-on (email
column only); notes-email immediate rather than digested (digest = Phase 3.1); (9) **§17 Phase 4**
— all §9 lifecycle events now write a bell row via the `notifyVenue` chokepoint (opt-out for the
cross-venue write email the trigger already records), and the **§17.5 accept-with-changes true
diff** (`diffGrant`, unit-tested) flows to both email and bell. §17 is now functionally complete
(Phases 1–4); remaining items are minor enhancements (notes-email digest, realtime bell,
per-event types); (10) **§16.2 collective management UI** — branding (logo/colour) in create + a
host **Edit settings** modal, plus **Invite venue / Remove member / Make host** controls, all via
in-app `ConfirmModal`s (no `window.confirm`); `CollectiveView` gained `hostVenueId`/`myVenueId`.
(11) **§16.2 member-visibility config** — a "Configure my listing" modal (show-all / choose-specific
practitioners + appointment-services + display order), prefilled from new `CollectiveView.myConfig`;
substitution toggle deliberately omitted until §7.6. **§16.2 is now complete** (branding + host
management + member visibility).
(12) **§18 calendar-scoped (per-practitioner) sharing** — `*_grants_calendar_ids` columns +
`LinkGrant.calendarIds` threaded through the permission model (narrow=reduce / widen=increase);
enforced in the linked-calendar read route + the `loadStaffAccessibleBooking` write gate + the
linked booking create/edit routes, with an RLS `link_calendar_allows` backstop
(`20260930120000…sql`); a "Which of your calendars?" picker on the granting direction of the
permission editor, fed by `GET …/account-links/my-calendars`. Preview-verified.
(13) **§19 UX/accessibility/design standards** — brought the feature to the stated bar across
surfaces: **§19.2** the shared `Modal` is now a thin wrapper over the Radix `Dialog` primitive
(focus trap, focus restoration, body-scroll-lock, visible close, full ARIA, busy-locked dismissal),
every action now raises a success/failure **toast** (a `ToastProvider` is mounted around the tab,
which the settings page lacks) with an inline `ActionError` (role="alert", auto-scrolls into view)
*near the control* rather than behind the modal, the section-wide busy flag became **per-link**
`busyLinkId` so one action no longer freezes every row, the data-sharing/GDPR notice now also shows
in the **Accept-with-changes** sub-view, and **Decline change** gained a `ConfirmDialog`; **§19.1**
linked grid cards now carry a non-colour distinction — a dashed border + diagonal hatch + desaturating
veil via `bookingCalendarBlockCardStyle(p, { linked })` (unit-tested) applied across every linked
render path (read-only day columns, week strip, native merged grid, overlap clusters), plus a
source-venue chip on week-strip cards and a real **padlock SVG** (replacing the 🔒 emoji) with a
"why it's read-only" tooltip; **§19.3** skeletons replace bare "Loading…" in the settings section
and the linked-bookings panel, and `/book/c` already renders a branded unavailable state; **§19.4**
host-chosen collective branding is **contrast-guarded** — `readableAccentForWhiteText` auto-darkens a
too-light accent until white text clears WCAG AA (unit-tested) rather than rejecting it, and
`prefers-reduced-motion` now also disables the global interactive-element transition; **§19.6** a
first-run explainer (dismissible, localStorage-remembered) and a staff-facing help note on the
linked-bookings panel ("another venue's data, shown for coordination"). Typecheck/lint/108 unit
tests green; preview-verified. Remaining §19 polish (calendar partial-load error state distinct from
"no columns", audit-log mobile card fallback, `linked-*` design tokens) tracked as P2.

**2026-05-18 (P1):** Month linked-count helper + tests; day-sheet date-synced linked section;
`LINK_COUNT_SOFT_WARNING` banner; PRD + QA checklist updates.

**2026-05-18 (P0):** Customer Terms Linked Accounts subsection; venue-delete link termination +
partner email (`terminate_account_links_for_venue_deletion`, `hardDeleteVenueWithLinkedAccountNotifications`);
cron `finalizeCronRun` (Sentry + optional `CRON_ALERT_EMAIL`); vitest coverage for account-links POST,
venue-deletion parsing, banner dismiss, cron finalize.

**2026-05-18:** Added §15 implementation status and production-readiness checklist; updated §8.2,
§10.2, and §11 to reflect shipped Phase 1, partial Phase 2, and known gaps (month view, day-sheet,
any-practitioner routing, cross-suggestion, ToS, venue-deleted email).

**2026-05-17:** Rewritten against the live Resneo schema. Replaced the generic
account/calendar/client/booking model with `venues` / `practitioners` / `guests` /
`bookings`. Replaced `current_account_id()` with `current_staff_venue_ids()` and the
`link_*_grant()` helper functions, reflecting that a staff user may work at multiple venues.
Adopted the ordered-pair `account_links` shape (`venue_low_id` / `venue_high_id`). Reused the
existing `events` table + `booking_events_trigger` pattern for the owning-venue audit and
added `account_link_audit_log` for the cross-venue record. Renamed "venue groups" to "venue
collectives" to avoid colliding with Resneo's existing "venue" = account terminology, and
gave them a dedicated `/book/c/{slug}` route namespace. Confirmed eligibility is the
Appointments family (`light` / `plus` / `appointments` tiers) and that restaurant
table-reservation venues are excluded. Resolved the identifier question in favour of
`venues.slug`.

---

## 15. Implementation status and production readiness

This section is the **operational companion** to §11. It records what is in the codebase today
and what remains before Linked Accounts meets a **production-ready** bar: correct behaviour
under failure, legal clarity, test confidence, and polished UX on every surface named in the
spec.

### 15.1 Summary

| Phase | Overall | Safe to use today? |
|---|---|---|
| **Phase 1** — pairwise links | Core path shipped end-to-end | **Yes, for controlled rollout (incl. write grants).** The §16.1 #1 audit gap is **fixed** — cross-venue edits via the main route now write an audit row (and a §17 notification), and cross-venue hard-delete is audited too (#1c). RLS + cron + settings + calendar + bookings list are sound. |
| **Phase 2** — venue collectives | Browse + per-venue booking works; management UI + advanced routing missing | **Yes for simple, single-host collectives** (pick a member venue/practitioner, book normally). **No** for "any practitioner" routing, and the collective is effectively **unbranded and unconfigurable from the product** until the §16.2 UI ships. |
| **Phase 3** | Not started | N/A |

### 15.2 Phase 1 — implemented (reference)

**Database & security**

- Migrations: `20260919120000_linked_accounts.sql`, `20260920120000_linked_accounts_audit_hardening.sql`, `20260921120000_linked_calendar_insert_calendar_id.sql`, `20260922120000_linked_anonymised_view_calendar_id.sql`.
- RLS helpers: `current_staff_venue_ids()`, `link_calendar_grant()`, `link_pii_grant()`, `link_action_grant()`.
- Cross-venue write attribution on `bookings` + trigger-written `account_link_audit_log`.
- pgTAP-style RLS tests: `supabase/tests/linked_accounts_rls_test.sql`.

**Server**

- `GET|POST /api/venue/account-links`, `GET|PATCH|DELETE /api/venue/account-links/[id]`, `POST …/reduce`, `GET …/lookup`, `GET …/incoming`, `GET …/[id]/audit` (JSON + CSV).
- `GET /api/venue/linked-calendar` (+ booking CRUD, guests, view audit).
- `GET /api/cron/account-link-maintenance` (pending expiry, lapse warning, suspend/resume, long-suspended expiry, plan ineligibility, collective reconcile).

**Dashboard UI**

- Settings → Linked Accounts: active / pending / past links, permission editor, reduce access, unlink, audit modal.
- `LinkedAccountBanner`: incoming link requests + pending permission changes; dismiss 24h.
- Calendar: integrated linked columns (day + week) in `PractitionerCalendarView.tsx`.
- Bookings: source scope filter (linked rows flattened into the registry; the old `LinkedBookingsPanel` was removed 2026-06-04).
- Fallback: `/dashboard/linked-calendar` + `LinkedCalendarView` component (still used by day-sheet).

**Communications**

- All §9 email events wired through `notifications.ts` and `linked-account-emails.ts` (email-only, as specified).

### 15.3 Phase 1 — production gaps (priority order)

**P0 — before broad production launch**

| Gap | Spec | Status (2026-05-18 / 2026-06-04) |
|---|---|---|
| **Cross-venue edit audit bypass** | §4.4, §16.1 #1 | **✅ Fixed 2026-06-04.** Was a real P0 (confirmed after a mistaken interim withdrawal): main-route cross-venue edits ran on the service-role admin client and skipped the audit trigger. Now each cross-venue PATCH write calls `recordBookingWriteAudit` (audit row + §17 notification), and the DELETE handler audits hard-deletes (#1c). Unit + pgTAP tested. |
| Missing cron termination emails | §6.6, §6.7, §16.1 #4 | **Done (2026-06-04)** — `notifyLinkTerminatedIneligible` + `notifyLinkLapseExpired` wired into the cron's plan-ineligible and 30-day-expiry paths (both venues). |
| Legal / ToS | §10.2 | **Done** — Linked Accounts subsection in `src/app/terms/customer/page.tsx`. Solicitor review of acceptance-modal copy still recommended before GA. |
| Venue-deleted survivor notice | §6.6 | **Done** — `terminate_account_links_for_venue_deletion()` + `admin_hard_delete_venue` returns partner JSON; `hardDeleteVenueWithLinkedAccountNotifications()` sends `notifyLinkPartnerVenueDeleted`. Migration: `20260518120000_venue_delete_terminate_account_links.sql`. Dev script: `npx tsx scripts/hard-delete-venue.ts`. |
| Automated test depth | §11 item 2 | **Done (vitest)** — `route.test.ts`, `venue-deletion.test.ts`, `LinkedAccountBanner.test.ts`, existing `permissions.test.ts` + pgTAP. Full DB E2E / Playwright still optional follow-up. |
| Cron observability | §6.3, §6.7 | **Done** — `finalizeCronRun()` → Sentry on `errors > 0`, optional `CRON_ALERT_EMAIL` / `OPS_ALERT_EMAIL`, HTTP 500 when unhealthy; counters documented in `src/lib/cron/finalize-cron-run.ts`; smoke script includes this cron. |

**P1 — professional polish (soon after launch)**

| Gap | Spec | Status (2026-05-18) |
|---|---|---|
| Month-view linked calendars | §8.2 | **Done** — month grid shows linked booking counts (`+N` badge + slate dot) via `linkedCountByDate` / `linkedBookingCountByDate()`; full column grid remains day/week only. |
| Day-sheet integration | §8.2 | **Done (synced list)** — `LinkedCalendarView` follows day-sheet date; link to full calendar. Full column grid on day-sheet deferred (restaurant/legacy surface). |
| ~10 links soft warning | §3 | **Done** — `LINK_COUNT_SOFT_WARNING` (10); banner counts active + pending links in `LinkedAccountsSection`. |
| PRD / founder-facing docs | Project rules | **Done** — row in §4 “What Is Not in the MVP” + glossary entries in `Docs/PRD.md`. |
| Manual QA matrix | Scope doc §6.1 | **Done** — checklist in `Docs/archive/reserveni-linked-calendar-grid-integration-scope.md` §6.1 (execute before GA). |

**P2 — nice to have**

| Gap | Action |
|---|---|
| Remove `/dashboard/linked-calendar` orphan page once day-sheet is integrated | Redirect to calendar with linked columns enabled. |
| Realtime linked-calendar refresh | Today: Supabase channel + debounced refetch on `PractitionerCalendarView`; verify under load. |
| Staff (non-admin) training copy | Short in-app help on what linking does *not* do (no shared clients). |

### 15.4 Phase 2 — implemented (reference)

- Tables `venue_collectives`, `venue_collective_members` with RLS (Phase 1 migration).
- `VenueCollectivesPanel` in settings: create (name/slug/branding/grouping), **Edit settings**, **Invite venue**, **Remove member**, **Make host** (transfer), accept/decline invite, leave, dissolve — all via in-app `ConfirmModal`s (no `window.confirm`). **Updated 2026-06-04 (§16.2):** branding (logo/colour) + full host management are now built; the only remaining piece is the member-visibility config (visible practitioners/services/order/substitution).
- APIs (ahead of the UI): `/api/venue/collectives`, `/api/venue/collectives/[id]`, `…/members` (including `transfer_host`), `…/slug-available`.
- Public page: `/book/c/[slug]` → `CollectiveBookingFlow` → per-member `BookPublicBookingFlow` with `collectiveId` attribution.
- Widget: collective embed option when venue is an active member (`WidgetSection.tsx`).
- Maintenance: `reconcileCollective` on link termination / cron; invitation and dissolution emails.

### 15.5 Phase 2 — production gaps (complete Phase 2 as specified)

| Gap | Spec | Action |
|---|---|---|
| **Collective branding UI** | §7.8, §16.2 | **✅ Fixed 2026-06-04.** Create + host Edit-settings modal now collect logo URL / brand colour / description (shared `BrandingFields`); colour previews on each row. |
| **Member-visibility config UI** | §7.3, §16.2 | **✅ Fixed 2026-06-04.** "Configure my listing" modal: Show-all / Choose-specific multiselects for practitioners + appointment-services + display order; prefilled from `CollectiveView.myConfig`. Substitution toggle omitted until §7.6 ships. |
| **Host-management UI** | §7.4, §16.2 | **✅ Fixed 2026-06-04.** Edit settings, invite member, remove member, and transfer host (Make host) are now in the panel; `window.confirm` replaced by an in-app `ConfirmModal`. |
| **Stale host after cascade** | §7.4/§7.5, §16.1 #2 | **Bug, found 2026-06-04.** `reconcileCollective` removes the host without reassigning `host_venue_id`, orphaning the collective. Auto-transfer or dissolve. |
| **Render-time plan/tier eligibility** | §7.2, §16.1 #3 | **Fixed 2026-06-04.** `loadPublicCollective` excludes ineligible (lapsed/ineligible-product) members from the public page and requires ≥2 eligible members; exclusion is recoverable (members reappear when eligibility is restored). |
| **Any-practitioner routing** | §7.6 | **Flag hidden 2026-06-04 (item 15).** The create/edit toggle is now a disabled "coming soon" affordance (no live false promise) and create never sets it true. Cross-venue earliest-slot search in `CollectiveBookingFlow` remains the deferred feature. |
| **Fully-booked cross-suggestion** | §8.6 | **✅ Done 2026-06-04 (item 15).** `loadActiveCollectiveForVenue` + public `GET /api/public/venue-collective` feed `CollectiveCrossSuggestion` in the appointment flow's no-availability state (collective-scoped; public guests only). |
| **Dissolved name cooldown (30 days)** | §7.2.1 | **✅ Done 2026-06-04 (item 15).** Collective create rejects a name matching one dissolved within 30 days (case-insensitive, non-disclosing). |
| **Host transfer acceptance** | §7.4 | Require new host Admin to accept before `host_venue_id` changes (today: immediate API update; no UI). |
| **Collective confirmation branding** | §7.8 | Apply collective logo/colour to confirmation emails for bookings with `collective_id` set (email-only; SMS out of scope). |
| **Public page load / SEO** | §7.1 | OG/meta tags, branded "collective unavailable" state when &lt; 2 active members (§19.3), caching for the per-member N-query service list. |
| **E2E collective booking** | — | Test: create collective → accept invite → book via `/book/c/{slug}` → `collective_id` on row → link break removes member. |

### 15.6 Known deviations from this spec (intentional or pending doc sync)

| Topic | Spec says | Code does |
|---|---|---|
| Calendar layout | Single integrated grid on calendar + day-sheet (§8.2) | **Calendar:** integrated day/week grid (own columns via `CalendarColumnsChecklist`; linked columns in a separate "Linked venues" block). **Day-sheet:** still separate `LinkedCalendarView` section. |
| Linked calendar drag | "Linked bookings are not draggable (correct)" *(was wrong)* | **`full_details`+`edit`/`create` linked bookings ARE draggable/editable** via the native grid → `/api/venue/bookings/[id]`. Only `none`/`time_only` are read-only. Corrected in §8.2. That edit path now writes an audit row + §17 notification via explicit `recordBookingWriteAudit` (§16.1 #1, fixed). |
| Cross-venue write audit | Trigger resolves link from attribution columns (§4.4) | Trigger **auto-resolves from `current_staff_venue_ids()`** under a user JWT. The main route writes via the service-role admin client (empty set → trigger skips), so it now records the audit row **explicitly** via `recordBookingWriteAudit` (§16.1 #1, fixed). The `linked_apply_*` RPC path also audits in-transaction. |
| `LinkedBookingsPanel` | Used on `/dashboard/bookings` (§8.2) | **Removed 2026-06-04.** Was unused/legacy; the dashboard flattens linked rows instead. |
| Linked event/class blocks | Appointments-only (§3) | Read-only classes/events also shown on linked columns (`linked-schedule-blocks.ts`). |
| `grant` route | "Never unilaterally increase" (§6.5, old text) | **Unilateral grant of *own* data** shipped; §6.5 refined. |
| Unilateral grant of own data | Not specified | `POST …/[id]/grant`; now documented in §6.5. |
| `linked-calendar/venue-profile` | Not specified | Read-only public-booking surface for cross-venue create; gated on `create_edit_cancel`; PII-safe (no guest data). |
| Booking source for collective bookings | `booking_source='online'` (§7.7) | Uses `'booking_page'` (treated as online-equivalent). |
| Host transfer | New host must accept (§7.4) | Immediate `host_venue_id` update; **"Make host" UI shipped** (§16.2). Acceptance step still not required (deviation stands). |
| Stale host after cascade | Host transfer or dissolve required (§7.4/§7.5) | **Fixed 2026-06-04** — `reconcileCollective` now auto-reassigns hosting to the longest-tenured survivor (or dissolves if <2 remain); new host emailed. |
| Collective name reuse | 30 days after dissolve (§7.2.1) | Active-name uniqueness only. |
| Collective branding | Host sets logo/colour (§7.1, §7.8) | **UI shipped 2026-06-04** — create + Edit-settings collect logo URL / brand colour / description (§16.2). |
| Member visibility config | Per-member practitioner/service/order (§7.3) | **UI shipped 2026-06-04** — "Configure my listing" modal (show-all / choose-specific practitioners + services + display order); `myConfig` on `CollectiveView` prefills it (§16.2). |
| GDPR notice | Short notice in acceptance modal (§10.2) | **Implemented** in review modal — but not shown in the "Accept with changes" sub-view (§19.2). |

When closing a deviation, update this table and the relevant normative section (§7 / §8 / §10).

### 15.7 Suggested release sequencing

1. **Linked Accounts Phase 1 GA** — the §16.1 #1 audit-integrity fix is **done** (cross-venue
   edits now audited + notified); remaining P0 gaps are legal, venue-deleted notice, test depth,
   cron monitoring (the §16.1 #4 cron emails are **done**). The §17 in-app write-notice foundation
   is shipped and now fires correctly; the bell UI (§17 Phase 2) and email + preferences (§17
   Phase 3) and lifecycle events + the accept-with-changes diff (§17 Phase 4) are all **shipped**;
   §17 is functionally complete. Remaining: minor §17 enhancements (notes-email digest, realtime
   bell) and the other workstreams (§16.2 collective UI, §18, §19, §20).
2. **Collectives "simple mode" GA** — collective browse + explicit practitioner/venue choice
   only; **build the §16.2 branding + host-management UI** so a collective is usable from the
   product; document that "any practitioner" is coming and hide its flag.
3. **Collectives Phase 2 complete** — any-practitioner routing + cross-suggestion + name
   cooldown + confirmation branding + host-transfer acceptance.
4. **Phase 2.5 world-class** — §17 (activity awareness) ✅ and §18 (per-calendar scope) ✅
   shipped; remaining §19 (UX/a11y standards) and §20 (connection experience).
5. **Phase 3** — only if venue demand warrants presets / bulk / analytics.

---

## 16. 2026-06-04 implementation audit & gap analysis

This section is the report-of-record from the 2026-06-04 code-vs-spec audit. It is the entry
point for anyone asking "what is the real state of Linked Accounts and what stands between it
and a world-class bar?" §16.1 is verified correctness work; §16.2 is specified-but-unbuilt
product surface; §16.3 is the new functionality this audit concluded *should* be specced and
now is (§17–§20); §16.4 is the prioritised roadmap.

### 16.0 Verdict

The **core is genuinely solid** — and in several places (audit hardening, the
`security_invoker` redaction view, the strongest-grant RLS helpers, server-side rate limits,
the negotiated/unilateral permission split) it *exceeds* what the original spec asked for.
The schema, RLS, lifecycle cron, and email layer are production-grade. **The P0 (§16.1 #1) —
cross-venue booking edits via the main route bypassing `account_link_audit_log` — is now fixed
(2026-06-04)**, after a mistaken interim "withdrawal" (see the §16.1 correction history). What
otherwise separates today's build from "designed and iterated on by Apple" is **not** the data
model — and the collective-management UI gap is now **closed** (branding, host management, and
member-visibility curation all shipped 2026-06-04 — §16.2). What remains is (1) a consistent
layer of interaction polish, proactive awareness, and accessibility that has to be specified as a
standard rather than left to each component (§19), and (2) the §18/§20 differentiators. The verified lifecycle bugs (orphaned-host cascade,
render-time collective eligibility, two missing cron emails), the P0, and the #1c hard-delete
audit were all **fixed 2026-06-04**; the residual correctness items are the P2/P3 hardening in
#5–#11. The highest-value *additive* capability — cross-venue write awareness (§17) — is
**functionally complete** (Phases 1–4: store, bell, email + preferences, lifecycle events, diff).

### 16.1 Verified correctness gaps (fix before/at GA)

> **Correction history (read this).** This row #1 flip-flopped during the audit; the final,
> verified answer is: **the P0 was real, and is now fixed (2026-06-04).** Timeline: (a) raised;
> (b) *wrongly withdrawn* on the inference that the booking route's cross-venue writes use a
> user-scoped client; (c) re-confirmed by reading `src/lib/venue-auth.ts` — `getVenueStaff().db`
> is the **service-role admin client** (`db: admin`, by design, `venue-auth.ts:166-168`), so under
> service-role `current_staff_venue_ids()` is empty and the audit trigger took its "system write →
> `RETURN NEW`" branch, writing **no** audit row; (d) **fixed** by calling the existing
> `recordBookingWriteAudit` helper at every cross-venue write site (see row #1). **Lesson:** verify
> the *definition* of a client before reasoning about RLS/audit behaviour, not just its variable
> name. (Note: the existing pgTAP Test 4-5 "passed" because it simulates a *user JWT*, not the
> service-role path the app actually uses — which is why the gap hid. A service-role-path test is
> now covered by the §17 notification assertion, Test 22.)

| # | Sev | Gap | Evidence | Fix |
|---|---|---|---|---|
| 1 | ✅ **Fixed 2026-06-04** | **Cross-venue booking edits via the main route bypassed the audit log.** `/api/venue/bookings/[id]` writes through the **service-role admin client** (`getVenueStaff().db`), so the audit trigger saw no staff identity and skipped — the common cross-venue gestures (drag-reschedule, status change, cancel, notes) wrote **no `account_link_audit_log` row**, violating core principle #5 and §4.4 and starving §17. | `venue-auth.ts:166-168,216`; `bookings/[id]/route.ts`. | **Done** — the route now resolves `linkId` from `loadStaffAccessibleBooking` and calls the existing best-effort `recordBookingWriteAudit` helper at all eight cross-venue PATCH write sites (guarded by `!isOwnVenue`), so each edit/cancel/reschedule writes one audit row — which the §17 trigger turns into an owning-venue notification. Unit-tested (`audit.test.ts`); end-to-end pgTAP (Test 22). **Approach note:** chosen over rerouting writes through `linked_apply_*` to avoid any regression to the write path (the helper is additive and non-fatal); it is therefore a *separate-transaction, best-effort* audit rather than in-transaction. The in-transaction RPC rerouting + hard-delete coverage (#1c) remain as hardening. |
| 1c | ✅ **Fixed 2026-06-04** | **Cross-venue hard-delete was unaudited.** The DELETE handler uses the admin client and hard-`delete()`s; the trigger is `AFTER INSERT OR UPDATE` only. | `bookings/[id]/route.ts` DELETE handler. | **Done** — the DELETE handler now records a `deleted_booking` audit row via `recordBookingWriteAudit` after a successful cross-venue delete (no notification: the booking row is gone, so there's nothing to deep-link to). |
| 2 | ✅ **Fixed 2026-06-04** | **Stale host orphaned a collective.** `reconcileCollective` could set the host's own membership to `removed` (host lost a full-mutual link) while ≥2 other members remained, without reassigning `host_venue_id` — leaving the collective un-administrable (PATCH/DELETE/`transfer_host` all require the caller to be the now-removed host). | `src/lib/linked-accounts/collectives.ts`. | **Done** — `reconcileCollective` now reassigns `host_venue_id` to the longest-tenured surviving member (pure, unit-tested `selectReplacementHost`) when the host is no longer active, or dissolves if <2 survive; the new host is emailed (`notifyCollectiveHostTransferred`). Self-healing for any pre-existing orphaned collective on the next reconcile. |
| 3 | ✅ **Fixed 2026-06-04** | **Collective eligibility not re-checked for plan/tier on render.** `hasFullMutualLinks` checks only calendar grants, not that each member is still Appointments-family with `plan_status='active'`, so a lapsed-plan member stayed live on `/book/c/{slug}` until the daily cron suspended the link (≤24h lag). | `collectives.ts`. | **Done** — `loadPublicCollective` now re-evaluates each active member's eligibility (`evaluateLinkEligibility(...).canCreate`) and **excludes** ineligible members from the rendered page, requiring ≥2 *eligible* members. It excludes rather than terminally removes, so members reappear automatically when their subscription is restored (mirrors the link suspend/resume model); terminal removal still flows from the §7.5 link cascade. `evaluateLinkEligibility` is now unit-tested. |
| 4 | ✅ **Fixed 2026-06-04** | **Two specified cron notifications were missing.** Cron `plan_ineligible` termination (§6.6 says "both venues emailed") and the 30-day `subscription_lapsed` expiry updated status but sent no email. | `account-link-maintenance/route.ts`. | **Done** — `notifyLinkTerminatedIneligible` and `notifyLinkLapseExpired` added to `notifications.ts` and wired into both cron paths (both venues, `Promise.allSettled`). |
| 5 | ✅ Fixed | **`reduce` can raise a DB error instead of a clean 4xx.** The reduce route validates only the caller's own direction; reducing a one-way link's only active direction to `none` violates the `account_links_not_zero_way` CHECK and surfaces as a 500. | `…/reduce/route.ts`; CHECK at `20260919120000…sql:81`. | Pre-validate against the zero-way rule and return a 422 with guidance to unlink instead. |
| 6 | ✅ Fixed | **Tier gate is too permissive.** `isLinkFeatureVenue` ORs "any non-`table_reservation` `booking_model`", so a restaurant/founding-tier venue with a non-table model can pass the feature gate, against §3. | `eligibility.ts:24-30`. | Gate strictly on `isRestaurantTableProductTier()` / Appointments tiers per §3. |
| 7 | ✅ Fixed | **Lapse-warning is not idempotent.** Duplicate-suppression relies on the 6–7-day window aligning with the once-daily schedule, not a persisted flag; a manual re-run double-sends. | `account-link-maintenance/route.ts:109-177`. | Persist `lapse_warning_sent_at` on the link and gate on it. |
| 8 | ✅ Fixed | **Email-send failures are invisible.** `notifyVenue` swallows errors and they are not counted in the cron's `errors`, so `finalizeCronRun` can report `ok:true` while deliveries failed. | `notifications.ts:50-55`. | Count send failures into the cron health signal; consider a delivery-tracking/retry record. |
| 9 | ✅ Fixed | **Audit CSV export is unthrottled and N+1.** Up to 10k rows with per-row venue/user lookups, no rate-limit; `propose_change`/`reduce`/`grant` are also unthrottled. | `…/[id]/audit/route.ts`. | Batch the lookups; add per-venue rate-limiting to all mutating + export routes. |
| 10 | ✅ Fixed | **Revoked-admin 30s window.** A just-revoked admin keeps link-management for up to 30s via the staff-identity cache. | `venue-auth.ts:84`. | Acceptable; document, or bust the cache on revoke. |
| 11 | ✅ Fixed | **`generateMetadata` double-reconcile.** The collective page reconciles (a write path that can dissolve) twice per request. | `book/c/[slug]/page.tsx:19-34`. | Make the metadata pass read-only. |
| 12 | ✅ Fixed | **Timezone in secondary linked components.** `LinkedCalendarView` computed "today" in local/UTC, not venue-local, so "Today" could land on the wrong day far from the venue TZ. (The other component the original finding cited, `LinkedBookingsPanel`, was dead code and has since been deleted.) | `LinkedCalendarView.tsx`. | **Done** — `LinkedCalendarView` now defaults to a browser-local date and accepts a server-computed venue-local `initialDate`. |

### 16.2 Specified-but-unbuilt product surface (Phase 2 completion)

The collective **API was far ahead of the collective UI**. That gap is now **fully closed**
(2026-06-04) — branding, host management, and member-visibility curation all have UI:

- **Collective branding — ✅ built (2026-06-04).** Create and a new host **Edit settings** modal
  now collect `logo_url` (URL), `primary_colour` (colour picker), and `description` (shared
  `BrandingFields`), so collectives render with their logo/colour. A colour dot also previews on
  each collective row. (`venues`-style upload is out of scope — the logo is a URL field, matching
  the `branding.logo_url` schema.)
- **Host-management UI — ✅ built (2026-06-04).** The host can now **Edit settings**
  (name/branding/grouping/allow-any), **Invite venue** (any eligible full-mutual venue not yet a
  member), **Remove** a member, and **Make host** (transfer). The per-member list shows host /
  invited tags. Dissolve, remove, transfer, and leave now use a styled in-app `ConfirmModal`
  instead of `window.confirm` (§19.2). `CollectiveView` gained `hostVenueId`/`myVenueId` so the
  UI can identify the host member reliably.
- **Member-visibility config UI — ✅ built (2026-06-04).** A **"Configure my listing"** modal
  (active members) fetches the member's own `/api/venue/practitioners` +
  `/api/venue/appointment-services` and offers, per catalogue, **Show all** (saves `[]`, so
  future additions are auto-included) or **Choose specific** (a checkbox multiselect), plus a
  **display order** input. `CollectiveView` now carries `myConfig` so the modal prefills from the
  saved state. The `allow_any_practitioner_substitution` toggle is **deliberately omitted** — it
  only matters once §7.6 "any-practitioner" routing ships, and exposing it now would be a
  false promise (§15.5); add it with §7.6.
- The previously-tracked §15.5 gaps remain open: any-practitioner routing (§7.6) — and the
  create modal still **shows the flag** despite §15.5 saying to hide it, which is a live false
  promise; fully-booked cross-suggestion (§8.6); dissolved-name 30-day cooldown (§7.2.1);
  collective confirmation-email branding (§7.8); host-transfer acceptance step (§7.4); and
  public-page SEO/OG tags, branded "collective unavailable" state, and a caching strategy for
  the per-member N-query service load (§7.1).

### 16.3 New functionality this audit concluded should be specced

These were **absent from the plan** and are now specified normatively:

- **§17 — Cross-venue activity awareness & write notifications.** Today a linked venue can
  cancel or reschedule your client's appointment and you only find out by reading the audit
  log. A sovereign-data product must *tell* the owning venue, in near-real-time, when its data
  is changed by a partner. Includes the in-app notification center the §9 "dashboard notice"
  channel always implied but never had.
- **§18 — Calendar-scoped (per-practitioner) sharing.** Visibility is currently venue-wide.
  The flagship use case (a salon renting chairs to independent stylists) needs a stylist to
  share *only their own column*. Specced as a permission-model extension.
- **§19 — UX, accessibility & design standards.** The interaction layer that lifts the feature
  to the Apple bar: a linked-data design language, modal/focus/toast standards, empty/loading/
  error states, accessibility, and mobile — specified as a standard, not per-component.
- **§20 — Connection & invitation experience.** Replaces "type the other venue's slug" (jargon
  that dead-ends if you don't know it) with venue-name search and a shareable invite link/QR.

### 16.4 Prioritised roadmap to "world class"

1. **GA hardening.** **#1 (P0 — main-route cross-venue edits unaudited) is fixed**, which also
   unblocked §17. The P1 lifecycle items are **done** — #2 (orphaned-host cascade), #3
   (render-time collective eligibility), #4 (missing cron emails), and #1c (hard-delete audit).
   The §17 bell UI (Phase 2) is **shipped**. Remaining correctness items are the P2/P3 hardening
   (#5–#11); §17 is **functionally complete** (Phases 1–4 shipped), with only minor enhancements
   left (notes-email digest, realtime bell, per-event types).
2. **Phase 2 completion.** §16.2: collective branding + member-config + host-management UI;
   close the §15.5 gaps; hide the any-practitioner flag until §7.6 ships.
3. **World-class polish.** §19 design/interaction/accessibility standards applied across every
   surface; §20 connection experience; the §16.1 P2/P3 items.
4. **Differentiators.** §18 calendar-scoped sharing **✅ shipped**; remaining: §19 UX/a11y
   standards, §20 connection experience, and richer activity analytics (Phase 3, §11).

---

## 17. Cross-venue activity awareness & write notifications (new — normative)

**Problem.** The system *records* every cross-venue action (§10) but does not *surface* it.
Granting another venue `edit_existing` or `create_edit_cancel` means they can move, cancel, or
create bookings in your calendar — and the owning venue currently has no proactive signal that
it happened. For a feature whose entire premise is data sovereignty, "you can find out if you
go read the audit log" is not enough. This is the single highest-value missing capability.

### 17.0 Implementation status & phasing

> **Dependency on §16.1 #1 — now satisfied.** §17 is built on the principle that *every
> cross-venue write produces an `account_link_audit_log` row*, off which a notification is
> generated. The §16.1 #1 P0 (main-route cross-venue edits unaudited) is now **fixed**, so §17
> fires for both the dedicated `linked_apply_*` path *and* native-grid drag/edit/cancel. The one
> cross-venue hard-delete is now audited too (§16.1 #1c); by design it does not notify (the
> booking row is gone, so there is nothing to deep-link to).

- **Phase 1 — foundation + cross-venue write notices — ✅ shipped 2026-06-04.**
  - `account_link_notifications` table + RLS (`current_staff_venue_ids()`; staff read + mark-read,
    service-role write) — `20260924120000_linked_account_notifications.sql`.
  - DB trigger `notify_owning_venue_of_cross_venue_write` on `account_link_audit_log` (AFTER
    INSERT, write actions only) — creates an owning-venue notification **in the same transaction**
    as the audited write, so it cannot be skipped by any path that writes the audit row.
  - `GET /api/venue/notifications` (feed + unread count) and `POST /api/venue/notifications/read`
    (mark some/all read).
  - Pure, unit-tested display formatter `buildNotificationView` / `formatNotificationCopy`
    (`src/lib/linked-accounts/notification-center.ts`).
- **Phase 2 — in-app notification center UI — ✅ shipped 2026-06-04.**
  `NotificationBell` (`src/components/linked-accounts/NotificationBell.tsx`), mounted in the
  dashboard shell gated `isAdmin && !isRestaurantTableProductTier`. Unread badge, popover feed
  grouped by day (Today / Yesterday / date), per-item + "Mark all read" with optimistic update,
  deep-link to the affected day, outside-click/Escape close, graceful empty + error states.
  **Refresh:** 60s polling + refetch on open (realtime via the Supabase channel is a Phase 2.5
  enhancement — would require adding `account_link_notifications` to the realtime publication).
- **Phase 3 — email + preferences (§17.3/§17.4) — ✅ shipped 2026-06-04.**
  - Per-venue email prefs in `venues.linked_notification_prefs jsonb` (defaults: cancel/reschedule
    **on**, create/notes **off**); pure resolver + `classifyCrossVenueWrite` (unit-tested) in
    `notification-prefs.ts`.
  - `notifyCrossVenueBookingWrite` (in `notifications.ts`, reusing `formatNotificationCopy` for
    copy parity with the in-app notice) sends the email gated by the owning venue's per-category
    pref, to `venues.email` + active admins. Wired post-response into **every** cross-venue write
    path: the main `/api/venue/bookings/[id]` (edit/cancel/notes), the staff create route
    (`/api/venue/bookings`), and the dedicated `/api/venue/linked-calendar/booking` (create/edit/cancel).
  - `GET|PATCH /api/venue/notifications/preferences` (PATCH admin-only) + the **Notification
    emails** toggle matrix in the Linked Accounts settings tab (`NotificationPrefsCard`,
    preview-verified).
  - **Deviations from §17.3/§17.4 (intentional, v1):** (a) **in-app is always on** and not
    per-category configurable — the matrix exposes only the *email* column (the trigger creates
    in-app rows unconditionally); (b) **notes-only edits email immediately when enabled** rather
    than via a **daily digest** — the digest batching is deferred to Phase 3.1 (notes email
    defaults off, so the default experience is already quiet).
- **Phase 4 — lifecycle events + true diff (§17.5) — ✅ shipped 2026-06-04.**
  - **All §9 lifecycle events now write a bell row.** Implemented at the single `notifyVenue`
    chokepoint: it writes an `account_link_notifications` row by default (title = email subject,
    body = first paragraph, so in-app and email copy stay in sync), with an opt-out (`inApp:
    false`) used only by the cross-venue booking-write email (the DB trigger already records that
    one). So accepted / rejected / unlinked / reduced / increased / change-accepted /
    change-declined / suspended / resumed / expired / terminated / lapse-warning / partner-deleted
    / collective invitation / removal / dissolved / host-transferred all appear in the bell.
    `formatNotificationCopy` prefers the stored title/body for these.
  - **§17.5 accept-with-changes true diff:** `diffGrant(before, after)` (pure, unit-tested) emits
    a before→after delta per changed dimension ("Calendar visibility: full calendar detail → time
    blocks only"; "Client details: shared → hidden"), suppressing PII/action noise when the
    calendar bullet already implies them. The accept-with-changes route computes the requester's
    original-vs-final grant and passes the diff to `notifyLinkAccepted` (email + bell), falling
    back to the final-state summary when the requester's direction did not change.
  - v1 scope notes: bell rows use a generic `link_lifecycle` type (per-event typing for icons /
    filtering is a future enhancement); the diff covers the requester's *gain* direction (the
    "accepted" email's framing) — diffing the reverse direction too is a minor future addition.

### 17.1 Principle

**Whenever a partner venue mutates your data, you are told — promptly, in-product, and
(by your preference) by email.** The owning venue is always the audience for changes to its
own rows, regardless of who made them.

### 17.2 In-app notification center

§9 repeatedly promises a "dashboard notice", but the only in-app surface today is the
incoming-request banner (pending requests + pending permission-change proposals). The persistent
store specified here is now **shipped (Phase 1, §17.0)**:

- Table `account_link_notifications` (✅ shipped): `id`, `venue_id` (recipient), `type`,
  `category`, `link_id` nullable, `collective_id` nullable, `actor_venue_id` nullable,
  `resource_type`/`resource_id` nullable, `payload jsonb`, `read_at` nullable, `created_at`.
  RLS: a venue's active staff read and mark-read only their own rows; only the trigger /
  service-role insert.
- A bell/inbox affordance in the dashboard shell shows unread count and a reverse-chronological
  list grouped by day. Items deep-link to the relevant surface (the affected booking, the
  Linked Accounts tab, the audit log filtered to the event).
- Every §9 event that the table marks "+ dashboard notice/banner" writes a notification row
  (currently those are email-only). Collective invitations must also appear here (today they
  do not surface in the banner at all).

### 17.3 Cross-venue write notices

When a partner creates/edits/cancels a booking in your venue (i.e. an
`account_link_audit_log` row with `acting_venue_id ≠ owning_venue_id` is written):

- **Cancellations and reschedules of an existing booking → immediate notice** (in-app always;
  email per recipient preference, default on). These are high-impact: a client's appointment
  moved or removed by another venue must not be discovered late. Copy names the partner venue,
  the client (if PII is granted to *you* — it is your own data, so always), the service, and
  the before/after time.
- **New cross-venue bookings → immediate notice** (in-app; email optional, default off) so the
  calendar owner is aware a partner booked into their book.
- **Edits to notes/service only → batched into a daily digest** to avoid noise.
- Realtime delivery rides the Supabase channel the calendar already subscribes to
  (§15.3 P2); the notification row is the durable record.

### 17.4 Preferences

Per-venue, Admin-managed, on the Linked Accounts tab: a small matrix of "notify me when a
linked venue [cancels / reschedules / creates / edits notes]" × [in-app / email]. Sensible
defaults per §17.3. SMS remains out of scope (§9).

**Shipped (2026-06-04):** the **email** column of this matrix — four per-venue toggles
(`venues.linked_notification_prefs`), defaults cancel/reschedule on, create/notes off, edited
via `GET|PATCH /api/venue/notifications/preferences` and the `NotificationPrefsCard` UI. **In-app
is always on** in v1 (not per-category configurable — the trigger creates in-app rows
unconditionally), so only the email column is exposed; per-category in-app muting is a future
option.

### 17.5 "Accept with changes" must show a true diff

§6.2/§9 promise a diff of what changed when a request is accepted-with-changes; the shipped
email lists the *final* permissions, not a before/after delta. Compute the delta against the
originally-proposed grants and render it ("PII access: requested **on** → set to **off**") in
both the email and the in-app notice.

**Shipped (2026-06-04):** `diffGrant(before, after)` (`permissions.ts`, unit-tested) and the
accept-with-changes route now pass a true before→after delta to `notifyLinkAccepted`, which
carries to both the email and the bell. Falls back to the final-state summary when the
requester's access direction was not changed.

---

## 18. Calendar-scoped (per-practitioner) sharing (✅ shipped 2026-06-04)

**Problem.** Permissions today are venue → venue: granting `full_details` exposes *every*
practitioner's calendar in the owning venue. The spec's own flagship use case — "a salon owner
who rents chairs to independent stylists, where each stylist runs their own venue" (§1) — wants
the *opposite default*: a stylist sharing only their own column with the chair-renting host,
not the whole book. Venue-wide-only sharing is too blunt for the primary persona.

> **Implementation (2026-06-04).** Shipped end-to-end:
> - **Data + plumbing:** `low_grants_calendar_ids` / `high_grants_calendar_ids uuid[]` on
>   `account_links` (NULL = all); `LinkGrant.calendarIds` threaded through `normaliseGrant`
>   (cleared when calendar=`none`), `grantsToColumns`, `viewLinkForVenue`, `resolveCallerGrantOverVenue`,
>   `loadAccessibleLinkedVenueIds`, the create/respond/grant/reduce/propose-change routes, and the
>   grant schema. Narrowing scope counts as a *reduction* (unilateral); widening as an *increase*
>   (`isReductionOnly`/`isIncreaseOnly` extended). Unit-tested.
> - **Enforcement (primary = app layer, since cross-venue reads use the admin client):** the
>   linked-calendar read route filters practitioners/columns/bookings to the scope; the central
>   `loadStaffAccessibleBooking` write gate + the linked-calendar create/edit routes reject
>   out-of-scope calendars and out-of-scope reschedule targets. **Backstop (RLS):**
>   `link_calendar_allows(owner, calendar)` helper + scope added to the four bookings policies
>   (`20260930120000_linked_accounts_calendar_scope.sql`); the time_only anonymised view inherits it.
> - **UI:** a "Which of your calendars?" picker (All / Choose specific) on the *granting* (`mine`)
>   direction of `GrantEditor`/`GrantPairEditor`, sourced from `GET /api/venue/account-links/my-calendars`;
>   shown in Send / Review / Edit / Reduce. The requesting (`theirs`) direction is never scoped
>   (you can't choose another venue's calendars). Summaries note "only for N selected calendars".
> - **Deferred (per §18.3):** time-of-day windows and per-service scoping.
> - **Verification:** typecheck + lint + unit tests + preview (picker renders, lists the venue's
>   calendars). Full data-flow enforcement needs the migration applied + a live scoped link.

### 18.1 Model extension

Add an optional per-direction calendar scope to `account_links`:

- `low_grants_calendar_ids uuid[] NULL` and `high_grants_calendar_ids uuid[] NULL`
  (FK semantics to `practitioners` / unified calendar entities of the *granting* venue).
- `NULL` (or empty) = **all calendars** — preserves today's behaviour and is fully
  backward-compatible. A non-empty array restricts visibility/action to those calendars only.
- The grant scope is meaningful only when `calendar <> 'none'`. It constrains *both* read
  (which columns appear) and write (which bookings can be edited/created) for that direction.

### 18.2 Enforcement

- Extend the RLS helpers: `link_calendar_grant` / `link_action_grant` already key on the
  owning venue; add a row-level predicate so a `bookings` row is only visible/editable when
  `practitioner_id`/`calendar_id` is in the granting direction's scope array (or the array is
  NULL). Because RLS cannot read a parameterised set cleanly per-row, implement as a
  `SECURITY DEFINER` helper `link_calendar_allows(p_owner_venue uuid, p_calendar uuid)
  RETURNS boolean` used in the policy `USING`/`WITH CHECK`.
- The anonymised `time_only` view path is unaffected in shape but must apply the same scope.

### 18.3 UX

- The permission editor (§8.1 send/accept/edit modals) gains a "Which calendars?" control per
  direction: **All practitioners** (default) or a multi-select of the granting venue's
  practitioners. Hidden when calendar visibility is `none`.
- The plain-English summary updates accordingly: "see **Jess's** calendar in full detail"
  rather than "see your calendar in full detail" when scoped.
- Out of scope for the first cut: time-of-day windows and per-service scoping (note as future).

### 18.4 Migration & compatibility

Additive, nullable columns; existing links read as "all calendars". No data migration. Ship
behind the existing `linkFeature` gate; no new tier requirement.

---

## 19. UX, accessibility & design standards (new — normative)

The audit found the *functionality* is largely present but the *interaction quality* is below
the stated Apple bar. These standards are normative for every Linked Accounts surface; a
surface is not "done" until it meets them.

**Status (2026-06-04):** the bulk of §19 is **✅ shipped** — see decision-log item (13). Modal
foundation, toasts + inline errors, per-row busy, Accept-with-changes GDPR notice, Decline-change
confirmation (§19.2); linked-card non-colour treatment + venue chip + real read-only padlock
(§19.1); settings/panel skeletons + branded `/book/c` unavailable state (§19.3); branding
contrast guard + reduced-motion (§19.4); first-run explainer + staff help note (§19.6). **Still
open (P2):** the calendar's partial/failed linked-load state distinct from "no columns" (§19.3),
the audit-log mobile card fallback + sticky modal footer on short viewports (§19.5), and a shared
`linked-*` design-token set (§19.1). Inline ✅/⏳ markers below.
(14) **§20 connection & invitation experience** — **search-by-name**: a new admin-only
`GET …/account-links/search?q=` matches the fragment against venue `name` *or* `slug` (input
sanitised to neutralise ILIKE wildcards + PostgREST `.or()` separators) and returns a short
pick-list with per-venue eligibility (public name + slug only, never PII); the send-request form's
slug input became a **search combobox** (debounced, keyboard-navigable listbox, "Available/Unavailable"
badges, a chosen-venue card with "Change") — typing a full slug still resolves since slug is matched.
**Shareable invite links**: `createLinkInviteToken`/`verifyLinkInviteToken` (compact HMAC, 16-byte
venue id + 4-byte expiry, domain-separated, 30-day TTL, `LINK_INVITE_SECRET` → `PAYMENT_TOKEN_SECRET`
fallback; unit-tested incl. expiry/tamper/cross-domain); `POST …/account-links/invite` mints a link +
server-rendered QR (`qrcode`) + expiry, `GET …/account-links/invite?token=` verifies and resolves the
initiating venue's name/slug/eligibility (self-link guarded); an `InviteLinkModal` (copy + QR) and a
"Get invite link" action, plus a `?invite=token` handler on the tab that verifies, pre-fills a request
*back to the initiator* with the default preset, toasts the outcome, and strips the param. The link
grants nothing until a normal request is sent and accepted — the `account_links` lifecycle is
unchanged. Typecheck/lint/114 unit tests green; preview-verified (search dropdown, invite mint+QR,
verify round-trip, param auto-handling). **§20 complete.**
(15) **Remaining-items hardening pass (§16.1 #5–#12, §7.2.1, §7.6, §8.6, §19 P2, §17 realtime).**
**§16.1 #5** — the reduce route now pre-validates the `account_links_not_zero_way` rule and returns
a clean **422** ("use Unlink instead") rather than a 500. **#6** — `isLinkFeatureVenue` now excludes
restaurant/founding tiers *before* the legacy booking-model fallback, so a table-product venue can
never pass the gate (regression-tested). **#7** — added `account_links.lapse_warning_sent_at`
(migration `20261208120000`); the cron gates the §6.7 warning on it and clears it on resume, so a
manual re-run can't double-send. **#8** — `notifyVenue` returns an `emailFailures` count;
the cron tallies it across every send and folds it into the health signal, so a run can't report
`ok:true` while deliveries failed. **#9** — audit lookups were already batched (`loadVenueLookup` /
`.in()`); added per-venue rate-limiting (`enforceLinkRateLimit`) to the CSV export and to all
mutating routes (PATCH/reduce/grant). **#10** — staff role-change/removal now busts the identity
cache (`invalidateCachedStaffIdentity`), so a revoked admin loses access immediately, not after the
30s TTL. **#11** — `/book/c` `generateMetadata` is now read-only (`loadCollectiveBrandingBySlug`),
so the reconcile/dissolve write happens once in the page body, not twice per request. **#12** —
`LinkedCalendarView` now defaults to a **browser-local** date (not UTC) and accepts a
server-computed venue-local `initialDate` from the standalone page. **§7.2.1** — collective create
now rejects a name matching one **dissolved within 30 days** (non-disclosing message). **§7.6** —
the `allow_any_practitioner` toggle is now a disabled **"coming soon"** affordance in both create
and edit (the live false promise is gone); create never sets it true; the per-member substitution
toggle remains omitted. Full cross-venue earliest-slot routing stays deferred. **§8.6** —
`loadActiveCollectiveForVenue` + a public `GET /api/public/venue-collective` feed a self-contained
`CollectiveCrossSuggestion` shown in the appointment flow's *no-availability* state for public
guests (collective-scoped only; never for pairwise-only venues; not shown inside a collective page).
**§19.3** — the main calendar now shows a distinct **"Couldn't load linked calendars — Retry"**
notice instead of silently collapsing to "no columns". **§19.5** — the audit-log modal gains a
mobile **card fallback** (no horizontal-scroll trap). **§19.1** — shared `--linked-surface` /
`--linked-border` / `--linked-muted-text` tokens + a `.linked-chip` utility now back the linked
affordances. **§17 realtime bell** — `account_link_notifications` added to the realtime publication
(migration `20261209120000`); the bell subscribes to per-venue INSERTs (RLS-scoped) and refreshes
instantly, with the 60s poll kept as a backstop. **Deliberately deferred:** the §17 *notes-email
digest* (Phase 3.1) — it needs a new pending-digest store + a scheduled aggregation cron that can't
be DB-verified here, and the per-category email opt-out already lets a venue silence notes emails;
and full §7.6 any-practitioner routing. Typecheck/lint clean; 112 unit tests green (incl. the new
tier-gate regression); search/invite/endpoint/calendar/settings preview-verified. New migrations
(`20261208120000`, `20261209120000`) need applying to a real env + `npm run test:db` before GA.
(16) **Final pre-ship review of the `/dashboard/calendar` linked experience + venue-facing UI
(two-agent audit).** Calendar correctness: **(a)** `handleDragEnd` now refuses to move a booking
across venue boundaries — a linked booking can only be dropped on its own venue's columns, and an
own booking can't land on a linked column (previously the move would PATCH a foreign
practitioner/calendar id); **(b)** the main `bookings/[id]` PATCH now validates the **move-target**
calendar against the §18 link scope for cross-venue edits (the load check only covered the
booking's *current* calendar, and the admin-client write isn't backstopped by RLS); **(c)** clicking
an empty slot on a `full_details`+`edit_existing` (no-create) linked column no longer falls through
to the own-venue slot menu (wrong-venue create) — linked columns only ever open the linked create
flow when a create grant exists, else a clear toast; **(d)** a feature-enabled venue with **zero
links** now shows "No linked venues yet" instead of a perpetual "Loading linked calendars…"
(added a `linkedLoaded` flag); **(e)** §19.1 — native-grid editable linked cards now carry the
persistent source-venue chip (read-only cards already did); **(f)** the week-strip card tooltip now
says "View" vs "Edit in {venue}" based on `b.editable`, not just clickability. Venue-facing: **(g)**
§8.6 — `loadActiveCollectiveForVenue` now requires ≥2 *eligible* active members (read-only), so the
fully-booked cross-suggestion never lands on the branded "unavailable" page, and its link colour is
contrast-guarded (§19.4); **(h)** §7.2.1 — the collective **rename** path now enforces the 30-day
dissolved-name cooldown (create already did), and the host-transfer confirm copy is now honest that
it takes effect immediately (the §7.4 acceptance handshake remains a documented deferral); **(i)**
§19.3 — skeletons replace the bare "Loading…" in the audit-modal desktop table and the collectives
panel/visibility loaders; **(j)** the dead `LinkedBookingsPanel` component was deleted and its stale
spec references (§8.2, §15.2, §16.1 #12, retired-code table) corrected. Verified solid by the audit:
tier gating, card visual distinction across every render path, read-only-vs-editable enforcement,
time_only PII suppression, §18 read scope, audit + §17 notify on every cross-venue write, accepted-
only data exposure, month/realtime/refresh. Typecheck/lint clean; **331 unit tests green**;
calendar + Filter panel ("No linked venues yet") preview-verified.
(17) **Linked-calendar opening hours + after-hours bookings + chip removal (post-go-live review).**
With two venues genuinely linked (full-mutual), a live review surfaced four items, all fixed:
**(a) Linked columns now reflect the LINKED venue's opening hours.** Previously a linked column
drew no closed-hours shading (it inherited none from the viewing venue). `buildLinkedColumnClosureBlocks`
derives "closed" blocks from the linked venue's own `working_hours` template (in the linked venue's
timezone) over the grid window, so e.g. a venue that opens an hour later shows that earlier hour
greyed on its column (native-grid editable path; unit-tested). **(b) Walk-ins past closing are
allowed.** The walk-in create path now passes `allowOutsideHours` to `validateAppointmentCustomInterval`,
so a walk-in taken after close (any duration) is no longer 409'd "Outside working hours". **(c) Staff
can move/extend a booking past opening hours.** A new `allowOutsideHours` option on the interval
validators (threaded through `validateAppointmentModificationInterval` → the `[id]` PATCH via an
`allow_outside_hours` flag) drops only the hours gates (breaks/blocks/overlap/duration still apply).
Client-side, a drag-move outside hours is now an **amber "outside opening hours" warning** (allowed),
distinct from a red **conflict** (blocked); resize can extend up to ~2h past the grid close (capped at
midnight) and flags the same warning; both send `allow_outside_hours`. **(d) Removed the per-card
linked-venue name chip** on native-grid booking bars — it overlapped the action buttons on short bars
and was redundant (the column header already reads "Linked · {venue}"); the dashed/hatch treatment
still marks linked cards, and the week-strip chip (where columns are days) + the read-only lock badge
remain. Typecheck/lint clean; 1175 unit tests green (incl. new closure-block + outside-hours bypass
tests); production build clean; live calendar render verified against the dev plus1↔light3 link.
Note: linked-column shading on the *read-only* `LinkedDayColumn` (time-only / no-edit links) is a
small follow-up; the full-mutual (editable) path is covered.

A linked-in entity must be instantly distinguishable from own data **without relying on colour
alone** (WCAG 1.4.1):

- Day/week grid: linked booking cards render in a consistent muted/tinted treatment (reduced
  saturation **and** a subtle diagonal-hatch or left-border motif), with a persistent
  "{Venue}" chip. Today the cards reuse the own-venue status palette and are distinguished only
  by a small header sub-label — **bring the cards themselves to the muted treatment** (month
  markers already are; make the grid consistent).
- One shared token set (`linked-surface`, `linked-border`, `linked-muted-text`) so every
  surface — grid, list rows, modals, month markers, notification items — speaks the same
  visual language.
- Read-only affordances use a real icon (not an emoji `🔒`/`🔗`) with an accessible label and a
  tooltip explaining *why* it's read-only ("view-only: {Venue} granted you calendar visibility
  without edit rights").

### 19.2 Modal & interaction standards

The shared `Modal` and every flow built on it must provide:

- **Focus trap**, **initial focus** on the first actionable element, and **focus restoration**
  to the trigger on close; **body scroll lock** while open. (None are present today.)
- A visible close control in every modal header (the read-only audit modal currently has only
  Esc/backdrop — a touch dead-end).
- **Toasts** for success and failure, anchored to the action, plus inline error near the
  control. Success is currently silent ("Request sent", "Access reduced", "Unlinked" must
  confirm). Errors must scroll/focus into view, not sit at the top of a long page.
- **Per-row busy state** — acting on one link must not disable controls on every other link
  (today a single section-wide `busy` flag freezes the whole list).
- **One confirmation idiom.** Replace the native `window.confirm` used for "Dissolve" with the
  in-app `Modal`, and add confirmations for the consequential immediate actions that have none
  (Decline change, Leave collective, Reduce access).
- The data-sharing/GDPR notice (§10.2) must also appear in the **"Accept with changes"**
  sub-view, not only the plain accept view.
- Reconcile the permission-editor framing: the editor's two columns and the read-only
  `GrantSummary` must use the **same order and the same "you / them" labelling**, and avoid the
  internal `mine`/`theirs` mismatch the audit flagged.

### 19.3 Empty, loading & error states

- Skeletons (not bare "Loading…" text) for the settings sections, audit modal, collectives
  panel, and linked calendar columns.
- The main calendar's linked-data fetch currently **fails silently to "no columns"** — a load
  error must be visually distinct from "no links" (a quiet inline "Couldn't load {Venue}'s
  calendar — retry"), and a **partial** failure (one linked venue errors) must not look like
  "that venue has no bookings today".
- The `/book/c/{slug}` page must render a **branded "this collective is unavailable" state**
  (not a bare 404) when `< 2` active members or dissolved.

### 19.4 Accessibility

WCAG 2.1 AA across the feature: full keyboard operability (including the linked-column picker
and grid empty-slot "new booking" targets, which today create dozens of focusable overlay
buttons per column), correct ARIA roles/labels on the custom column checklist, colour-contrast
validation for host-chosen collective branding (reject or auto-adjust low-contrast
colour/text combinations on `/book/c`), and `prefers-reduced-motion` honoured on transitions.

### 19.5 Mobile

The audit-log and any data-dense table must have a card-based responsive fallback rather than a
horizontal-scroll trap inside a modal; modal primary actions must remain reachable (sticky
footer) on short viewports.

### 19.6 Onboarding & first-run

First visit to the Linked Accounts tab (no links yet) shows a short, dismissible explainer:
what linking does, what it explicitly does **not** do (no shared clients, no merged data —
§13), the data-sovereignty guarantee, and a single primary CTA. A brief staff-facing (non-admin)
help note clarifies that a linked calendar is another venue's data shown for coordination.

---

## 20. Connection & invitation experience (new — normative)

**Status (2026-06-04): ✅ shipped** — see decision-log item (14). Search-by-name combobox + shareable
invite link (copy + QR) both built and preview-verified. v1 deviation: the invite token is a
stateless, domain-separated HMAC (30-day expiry) rather than a DB-backed single-use row — it grants
nothing on its own and the initiator approves every resulting request, so revocation is implicit via
expiry; a stored/revocable token is a future enhancement.

**Problem.** §6.1 resolved the identifier question in favour of `venues.slug`, and the send-
request form asks the user to type the other venue's slug. "Slug" is developer jargon, and the
flow dead-ends if you don't know the other venue's slug — there is no graceful path.

Keep slug as the canonical identifier, but make *getting there* humane:

- **Search by name.** The send-request field accepts a name fragment and queries the existing
  Admin-only lookup, returning a short pick-list of matching venues (display `name` + town/area
  if available — never PII) to disambiguate, then resolves to the slug under the hood. Typing a
  full slug still works.
- **Shareable invite link.** An Admin can generate a one-time, expiring invite link/QR
  ("Connect with {My Venue} on Resneo") to hand to a venue they know off-platform. Opening it
  (as an Admin of any eligible venue) pre-fills a link request *from that venue back to mine*
  with the default preset, so neither party has to look up an identifier. The link encodes the
  initiating venue and expires with the same 30-day window as a pending request; it grants
  nothing until a normal request is sent and accepted.
- Conflict/lookup errors must never disclose whether a given slug/name exists beyond what the
  public booking pages already reveal.

This is additive to §6.1; the underlying `account_links` lifecycle is unchanged.

---

## End of specification

This document is the source of truth for the linked accounts feature. Any deviation during
implementation should be reflected back into this document (especially §15.6 and §16). When
briefing an AI coding agent, reference sections by number rather than restating requirements.
