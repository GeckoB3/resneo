# Venue collectives as one venue: forensic audit and implementation plan

Status: PLAN, not implemented. Written 2026-09-13 against the `staging` branch at `c6020eb6`
(the working tree also held unrelated uncommitted compliance and export fixes, since committed as
`818ed5a` and `973bd3e`). Nothing in this document has been built. Evidence is cited as
`path:line`; "staging" means the database in `.env.local` (project `zkppmyyvkjvbsvemakbb`), read
with SELECT-only scripts. Production was not read.

Reviewed 2026-09-14 at `c0b5eb0` by a second forensic pass, which re-verified the citations and
widened the scope: see "Reading the citations" below and §6.14, §6.15, D37 to D40, SB-28, PB-16
and W16 for what that pass added.

**Reading the citations.** Line numbers anchor at `c6020eb6` plus the two commits above; the
collective code itself is byte-identical between that commit and `c0b5eb0`, so every citation in
this document still resolves. Three conventions are worth stating once, because a reader who does
not know them will fail to find the file:

- Migrations are cited by bare filename and live under `supabase/migrations/`.
- `local_baseline_grants.sql` lives under `supabase/scripts/`, not `supabase/migrations/`.
- A bare `route.ts:NNN` or `create/route.ts:NNN` usually means the appointment-services route or
  the public booking create route (`src/app/api/venue/appointment-services/route.ts`,
  `src/app/api/booking/create/route.ts`). Where this document means another route it says so in
  the same sentence: the guests list (`src/app/api/venue/guests/route.ts`), the venue PATCH
  (`src/app/api/venue/route.ts`) and the schedule-health cron
  (`src/app/api/cron/schedule-health/route.ts`) are each named where they are cited.
- One citation in this document, and four across the two companions, point at the ResNeo mobile
  app repository (`C:/Resneo-app` at `d90dece`), not at this one.

How it was produced. Round one: eight forensic readers mapped the data model, the lifecycle,
the combined-page manager with copies and sync, the Services page, the Calendar Availability
page, the Booking Page tab with the public pages, the booking engine, and every other consumer
(mobile app, diary, reports, help, principles). A cross-examiner resolved their contradictions
and re-verified the 25 claims the redesign rests on against code and staging. Two architects
then designed competing approaches. Round two: the lead chose one, two red teams attacked it,
and a designer and a test architect wrote the page-by-page specification and the testing plan
with the red-team amendments applied. The working files are summarised in Appendix A.

---

## 0. Executive summary

**What is wrong today.** A collective is a routing layer bolted onto separate venues, so almost
every collective edit reaches fewer places than the person making it expects.

- **Every collective service exists three times** (the host's service, a copy in each member
  venue, and an offering row with its own name, description and defaults), and **"this calendar
  offers this service" is stored twice** (provider rows the page lists, assignments the engine
  books). Nothing keeps them in step.
- **Only length, buffer, processing periods and options' shape follow the host.** A host price,
  deposit, description, add-on or form change reaches only the host's calendars; a member's price
  edit silently changes what the collective sells; staging already shows Haircut at 25.00 at the
  host and 10.00 at Light 3, while the manager reports them "in step".
- **Guests can be charged differently from what they were shown.** Four create routes follow three
  price rules and two duration rules, and the combined page applies one calendar's custom values to
  every calendar at that venue.
- **Two storefronts for the same calendars.** Members' own booking pages stay live beside the
  collective page with different names, prices and policies; an adopted address keeps serving the
  collective after its venue leaves; dissolving 404s every old link; the collective embed is
  refused on external sites.
- **Leaving does not give control back.** Copies stay linked and resume syncing if the venues ever
  share a collective again. (The account links underneath a collective, and the client access they
  grant, rightly carry on after it: D41.)

The second forensic pass (2026-09-14) added five more, all of which stop a collective feeling like
one venue even after everything above is fixed:

- **The collective is invisible in every report.** `bookings.collective_id` is written and read by
  nothing; `source` has no collective value. Meanwhile Booked revenue already blends every member's
  takings into one untotalled figure in both directions, because membership forces a full link mesh.
  Nobody can answer "how is the collective doing", and every member can see the others' money.
- **One person cannot work at two venues in it.** A staff row at a second venue makes the dashboard
  refuse to resolve a venue at all and redirects the person into the signup flow. A collective of
  two venues under one owner, the most likely collective there is, cannot be run from one login.
- **The collective page is appointments only.** The synthetic venue declares a single booking model,
  so a member that also runs classes, events or bookable rooms loses those from the web the moment
  its own page starts redirecting. Nothing in the product says so.
- **Guests are split in two and cannot be put back.** The same person booking two member venues
  becomes two client records, and the merge tool refuses cross-venue pairs. Marketing consent is per
  venue, so unsubscribing at one member does not stop the others, and marketing emails carry no
  unsubscribe link at all.
- **Nobody is watching the engine, and nobody can support it.** There is no monitoring, alerting or
  runbook in the design, and the platform support console has no collective view, so the first
  report of a stuck replica would come from the host.

In total: 42 split-brain cases (§3), 53 collective bugs, 11 of them high severity, and 19 platform
bugs found on the way (§4).

**What we recommend.** Host-managed replicas with one truth per fact (§5, §6). The host's own
service is the master and the host edits it on its own Services page. Each member holds a locked
replica of every service on the collective page, rewritten by one transactional, audited engine
whenever anything about the master changes. Assignments become the only record of which calendar
offers what, so a member ticking a service on Calendar Availability updates the page at once, and
the host adds or removes member calendars from the same service page it already uses. One resolver
prices and sizes every calendar identically on every path, and bookings keep the price they were
made at. Every venue's own page, the host's included, hands over to the collective page while it
is live and the venue is listed (D3). Leaving is one transaction: every service, calendar choice
and booking stays, and the locks lift. Two red teams found 5 critical and 16 high problems in the first version of this design; all
are resolved in §6 (table in §6.13).

**What it takes.** A first pass of fixes that are worth doing on today's model anyway (§8.1), then
seven deploy passes (owed migrations, two expand passes, migrate existing collectives, switch new
collectives, remove old code, contract) across 22 workstreams (W0 to W21), the largest
being the booking correctness work, the engine and the lifecycle (§8). Two of the six added by the second pass, multi-venue people
(W16) and reporting (W17), carry live bugs and start immediately rather than waiting on the engine.
Testing is designed as the safety net: 170 tests including
database-level convergence and real two-connection race tests, SQL invariants run by CI, a daily
verifier and every deploy step, rollback drills, and an acceptance checklist written for you (§9 and
`Docs/collective-one-venue-test-plan.md`).

**What we need from you** (§11). Most urgent:

1. **Legal counsel (D9, D27): complete.** The owner recorded counsel as complete on 2026-09-14.
   Host prices apply everywhere unless the host turns on the per-calendar price permission for a
   service (D27, through D4 and D29); the consent text, the trader line and the unticked
   marketing consent stand as designed.
2. **D41 revised (2026-09-14, later the same day).** A collective is extra functionality on top of
   full-access account links and never changes them; leaving or ending it affects only the
   collective. §6.5, §6.7, §7 and §11.4 are rewritten to that, and W7a is withdrawn.
3. **The three points the readiness review left open were answered the same day** (2026-09-14):
   - **Venues in a collective offer only the collective's services (D2 and graft 5 revised).** While
     a venue is live in a collective, every appointment service it has that is not on the page is
     parked: derived from state, never stored, and lifted the moment the venue leaves. Every diary
     column opens the collective form. A service that only one venue or calendar offers can still be
     added to the page, so nothing is lost, and existing bookings on a parked service stay fully
     manageable (§6.6).
   - **Venue-level settings (D32 decided).** Guest sign-in, guest self-reschedule, the waitlist on
     the page, "Any available" and the staff-first flow follow the host; communication policies and
     in-person payments stay with each venue, and the host sees "Different at {venue}" (§6.10).
   - **Adopting a member's page address.** The member venue's admin must confirm before the host
     adopts it; until then the collective keeps its own address (§6.9).
   What remains is operational: signing each environment's dry-run report before its collective
   migrates (D21, §11.3).

Every row in §11 is decided, and the team builds to it. The nine the
second pass raised (D38, D39, D41, D42, D44, D49, D50, D51, D52) were answered on 2026-09-14 and
are recorded in §11.4. Three of those answers change work described elsewhere in
this document, so read §11.4 before §6.5, §6.7 or §9.

## 0.1 What actually matters

This document lists 42 split-brain cases, 72 bugs, 54 decisions and 170 tests. That is the right
level of detail for someone building it and the wrong level for someone deciding whether to. Six
things change the shape of the work. Everything else is execution.

1. **Leave account links alone (D41, owner, 2026-09-14).** A collective is extra functionality on
   top of account links with full access. Joining requires those links, and nothing the collective
   does (join, leave, removal, dissolve, host transfer, migration) creates, narrows or ends one. A
   venue that leaves keeps full access to create, edit and cancel bookings for the venues it is
   linked with. An earlier version of this item said the opposite; it is withdrawn, and with it the
   interim workstream W7a and the `account_links.created_for_collective_id` column.
2. **Fix the silent lockout, then stop (D38, W16).** A person who works at two venues cannot sign
   in at all today, and the invite route creates that state without warning. The decision is to
   refuse the invite with a clear message rather than build a venue chooser, so W16 is now small.
   It is still a live bug and still starts immediately.
3. **Say out loud that the collective page is appointments only (D44).** It is, structurally, and
   the product never mentions it. A member that also runs classes or bookable rooms loses that trade
   from the web the day its page starts redirecting.
4. **Get the money right before anything propagates (W1).** The price snapshot, one resolver and
   per-calendar values are the difference between "the host changed a price" and "every past
   booking silently repriced". This was already the first pass's top workstream and remains it.
5. **Ship the bulk lane with the fold, not after it (§6.8).** Moving service and calendar work onto
   the Services page is right. Doing it without the bulk actions the old manager had turns a
   ten-service, three-venue setup from about 72 interactions into about 101.
6. **Give the engine somewhere to be watched from (§6.16).** Two crons, a handful of alerts and a
   support panel. Small, and the difference between finding out from a dashboard and finding out
   from the host.

Everything below is tiered in §8.0 into what to fix before building, what to fix while building,
and what is recorded deliberately so that nobody builds it.

---

## 1. What the owner asked for

A venue collective must make every calendar in it work as one venue, while each venue keeps its
own contacts and bookings. Numbered so the rest of this document can trace them:

| # | Requirement |
|---|---|
| R1 | All calendars in a collective work as one venue; each venue keeps independence over its own contacts and bookings. |
| R2 | One host venue and one or more non-host venues (members). |
| R3 | The host picks which services are on the collective page; any not present at a member are created there. |
| R4 | The host controls every attribute of those services: title, description, add-ons, variants, processing periods, price, duration and everything else. |
| R5 | The host controls which calendars offer each service, including members' calendars, and can add or remove them. |
| R6 | Services are linked and kept in step by default from the moment the collective exists. |
| R7 | The host edits services on its own Services page and every change reaches every member; the host sees every calendar offering a service, including linked calendars, and can add or remove them there. |
| R8 | Per-calendar permissions (`staff_may_customize_*`) and per-calendar values apply to members' calendars exactly as to the host's own. |
| R9 | Members' calendars feel exactly like the host's own calendars. |
| R10 | A member selecting or deselecting services on its own Calendar Availability page updates the collective automatically. |
| R11 | No split-brain: nobody edits services or settings believing an edit applies more or less widely than it does. |
| R12 | Inside a collective everything runs through the host, apart from the per-calendar attributes the host delegates. |
| R13 | A member can leave at any time and regain full control of its services and its own booking page. |
| R14 | When a collective breaks (a member leaves, the collective dissolves), the link breaks and venues return to their own booking pages. |

The reasoning the owner gave: people who form a collective want their software to feel like one
venue. If they wanted independence they would not have formed one.

---

## 2. How collectives work today

### 2.1 The shape in one paragraph

A collective is a routing layer over separate venues. The public page `/book/c/{slug}` and the
staff collective form address a synthetic venue whose id is the collective id; every booking API
detects that id and resolves the chosen offering and calendar to the calendar's owning venue and
that venue's own service, then runs the ordinary single-venue pipeline
(`src/lib/linked-accounts/collective-booking-bridge.ts:38-83`,
`src/app/api/booking/create/route.ts:213-318`). So one "service" on the collective exists in
three places that drift apart: the host's own `service_items` row, a copy in each member venue,
and a `collective_service_items` offering row with its own name, description, defaults, image
and heading. And "this calendar offers this service" is stored twice: in
`collective_service_providers` (what the combined page lists) and in
`calendar_service_assignments` (what the engine books). Nothing keeps either set in step.

### 2.2 Data model

- Collective tables: `venue_collectives` (host, status, page address and config, a timezone
  copied once at creation, though a shared timezone is also checked live whenever the page is
  built, `catalogue.ts:172-200`), `venue_collective_members` (invited, active, left, removed; the
  host has a row too), `collective_service_items` (offerings), `collective_service_providers` (one
  row per calendar pointing at that venue's service, with no foreign key to either),
  `collective_service_categories` (page headings). Created by
  `supabase/migrations/20260919120000_linked_accounts.sql`,
  `20261210120000_combined_booking_page.sql`, `20261211120000_combined_page_single_venue.sql`,
  `20270202130000_collective_service_categories.sql`.
- Bookable objects stay venue-owned: `service_items`, `calendar_service_assignments`,
  `service_variants`, `addon_groups` / `addons` / `service_addon_groups`, `service_categories`,
  `compliance_types` / `service_compliance_requirements`.
- The only thing that records host influence over a member service is three sync columns on
  `service_items` (`synced_from_service_id`, `sync_state`, `synced_at`,
  `20270209120000_service_sync_from_origin.sql:14-17`), with no collective id.
- `calendar_service_assignments` holds only `custom_duration_minutes` and `custom_price_pence`
  (`20260430120000_unified_scheduling_engine.sql:115-122`). The other five per-calendar fields the
  Services form offers have no storage on any venue.
- A booking snapshots the service name (trigger), variant name, add-ons, processing blocks, end
  time, deposit and cancellation policy, but not the appointment price
  (`20270103125000_bookings_service_name_snapshot.sql:47-95`,
  `src/lib/booking/payment-summary.ts:109-152`). Totals are recomputed live, so any price edit
  rewrites history, and any future price sync would too.
- RLS is not what the first pass described, in three ways that matter for this design.
  - **Service tables are not venue-only.** `service_variants`, `addon_groups`, `addons`,
    `service_addon_groups` and `calendar_service_assignments` all carry `TO anon` SELECT policies
    with no venue predicate (`20260730120000:64-66`, `20261201120000:225-253`,
    `20260430120000:400-402`). The worst is
    `public_read_calendar_service_assignments`: `FOR SELECT TO anon USING (true)`, every row on
    the platform, verified in the migration and explicitly left in place by
    `20270113120000:73-80`. Its legacy twin `practitioner_services` has the identical policy
    (`20260327000001:344`), and `venue_collective_members` is `TO anon USING (status = 'active')`
    (`20260919120000:558-559`), which makes the platform-wide collective membership graph
    anonymously enumerable. This is load-bearing for §6.3: the five new per-calendar columns and
    the three new attribution columns would land on an anonymously readable table, and
    `updated_by_user_id` is an `auth.users` identifier. Either drop that policy and serve the
    public catalogue through the admin client (which `20270113120000:104` already did for
    `service_items`), or those columns cannot be added as designed.
  - **The staff policy on assignments checks the calendar and not the service.**
    `staff_manage_calendar_service_assignments` (`20260430120000:351-362`) constrains
    `calendar_id` in both `USING` and `WITH CHECK` and never mentions `service_item_id`, and no
    FK or CHECK ties the two venues together. Under §6.6, where assignments become the only truth
    about what a calendar offers, that row is the thing being trusted. Invariant I13 reports the
    violation; it needs a constraint, not only a report.
  - **Every `staff_manage_*` policy on these tables matches any `staff` row by JWT email with no
    `revoked_at IS NULL` filter**, which is finding S-04's shape extended to the service tables.
- Collective tables allow client SELECT through SECURITY DEFINER helpers, and carry **no** INSERT,
  UPDATE or DELETE policy for any client role (only `FOR ALL TO service_role`), so PostgREST
  writes to them are refused by RLS whatever the grant says. That distinction matters: the grant
  question below bites on the **service** tables, where `staff_manage_*` is `FOR ALL` and does
  permit writes, not on the collective tables.
- Every app read and write runs on the service-role client. One consequence to carry into §6.5:
  `log_cross_venue_booking_action()` returns early for a caller who staffs no venue
  (`20270111120000:119-122`), so it never audits an app write. RT2-12's fix depends on that being
  understood rather than assumed.
- On staging, `anon` and `authenticated` are believed to hold full DML grants on every service and
  collective table (hosted defaults). Treat this as unproven from the repository: no migration has
  ever granted or revoked anything on those tables, which is consistent with the hosted defaults
  standing, but the files cannot show what those defaults are. Per the repo's standing rule,
  verify grants against the live database, not the migration history.
- Membership exclusivity is assumed but not enforced: only create refuses a venue already in a
  live collective; invite, accept and host transfer do not look, and there is no constraint
  (`src/app/api/venue/collectives/route.ts:51-76`,
  `src/app/api/venue/collectives/[id]/members/route.ts:107-140,218-251`).

### 2.3 Lifecycle

- Create, invite and accept require every pair of members to hold an accepted link with full
  calendar detail and create/edit/cancel both ways, and the `account_links` CHECK allows that only
  with client details shared (`src/lib/linked-accounts/catalogue.ts:172-201`,
  `20260919120000_linked_accounts.sql:69-79`). Every pair of members therefore already shares
  client details through its account link before the collective exists. That is the foundation the
  owner wants (D41): the collective sits on top of the links, and leaving or dissolving it never
  touches them (SB-42, withdrawn).
- Accepting an invitation gives the venue nothing. Services arrive only when the host later
  ticks one of its calendars in the manager.
- Leave and removal flip the membership row. Reconcile then marks the venue's providers
  `suspended` (or leaves them `active` when a two-venue collective dissolves), revives them on a
  re-join, and never touches copies, assignments, sync state or an adopted address
  (`collectives.ts:268-285,535-553,578-591`). Copies stay `linked` and resume syncing if the two
  venues ever share any live collective again (`service-sync.ts:221-242`).
- Dissolve tombstones the slug to `dissolved-{id}`, so every old `/book/c/{slug}` link 404s.
- Host transfer rewrites `host_venue_id` only. Copies keep following the old host's services,
  while the page's address, hours, currency, wording and flags switch to the new host at once.
- `reconcileCollective` runs on anonymous renders of the public page and can remove members,
  dissolve or transfer hosting with no notification (`collectives.ts:473-594,919-934`).
- Lifecycle writes are non-transactional and most ignore database errors; no lifecycle event is
  audited.

### 2.4 The combined-page manager, copies and sync

- The host curates offerings and ticks calendars in `CombinedPageManagerPanel`
  (`src/components/linked-accounts/CombinedPageManager.tsx`, 2,340 lines), from Settings → Booking
  Page or a modal in Linked accounts. Members see a read-only summary.
- Ticking a member calendar calls `ensureServiceForCalendar`
  (`src/lib/linked-accounts/service-duplication.ts:755-884`): reuse a same-named service at that
  venue (a loose normaliser that merges "Balayage (Short hair)" with "Balayage (Long hair)"), or
  copy the offering's origin exactly and stamp it `linked`. The origin is recomputed on every call
  (the host's provider, else the earliest provider), so it can be a member's service and can flip.
- Sync (`src/lib/linked-accounts/service-sync.ts`) pushes only duration, buffer, processing
  periods and variant shape, only after a unified `PATCH /api/venue/appointment-services` that
  changes that shape, fail-soft inside `after()`. A member saving one of those fields silently
  sets its copy `customised`. Price, deposit, payment rule, name, description, colour, category,
  booking window, schedule, location, add-ons, compliance and staff flags never follow.
- Offering fields (`default_price_pence`, `default_duration_minutes`, `pricing_display`,
  `allow_any_available`, the provider price and duration overrides and the member approval step)
  are stored but never used when pricing or gating a booking.

### 2.5 The Services page

- `AppointmentServicesView` edits one venue's services only; every route filters on
  `staff.venue_id` on the service-role client. The GET returns `sync_state`, but nothing shows it:
  no badge, lock, origin or member calendar anywhere.
- A member admin can edit, deactivate or delete a copy freely. The host's Services page lists and
  assigns only the host's own calendars; the server rejects foreign calendar ids
  (`src/app/api/venue/appointment-services/route.ts:1335-1339`).
- Per-calendar values: only non-admin staff who manage the calendar can set them (admins get
  403), only duration and price persist, and the other five are dropped
  (`src/app/api/venue/practitioner-service-overrides/route.ts:89-94,169-188`). "Dropped" is
  silent only when the same request also carries a duration or price; a request carrying only
  the other five gets a 400 reading "No valid fields to update (unified scheduling supports
  duration and price overrides only)" (`:172,183-188`). So a calendar whose only enabled
  permission is Colour meets a confusing error rather than a no-op. Stored values apply even
  when the permission flag is off (`src/lib/appointments/merge-service-with-overrides.ts:8-34`).
- The same seven flags do a second, undocumented job: `STAFF_SERVICE_FIELD_PERMISSIONS`
  (`src/app/api/venue/appointment-services/route.ts:91-99`) uses them to decide which fields a
  non-admin may change on the **venue-wide service row**, for a service that staff member
  created (`:420-446,1305,1640`), and any staff-created service stores all seven as `true`
  (`:918,939-945`). The creator check is at `:1256-1262`. This matters for the redesign: see
  §6.5, where a host staff member who created a service could otherwise still rewrite the
  master.
- The deposit is further along than the other four missing fields in name only. Even on the
  legacy shape that has `custom_deposit_pence`, the unified engine never applies it:
  `deposit_pence` comes from the service row alone
  (`src/lib/availability/appointment-engine.ts:1552`), while the price on the line above does
  read a custom value, and `GET /api/venue/appointment-services` returns a hard-coded null
  (`:683`). The 1.00 card-hold floor is checked only on the route's legacy branch
  (`practitioner-service-overrides/route.ts:294-306`), which its own comment at `:166-167`
  calls the dead one. D5 is therefore not just a migration: the deposit needs a resolver path
  and a floor check that runs.

### 2.6 The Calendar Availability page

- The Edit calendar dialog lists every service of the venue by name, active or not, and saves by
  deleting every assignment for the calendar and re-inserting the chosen set
  (`src/app/api/venue/practitioner-services/route.ts:110-129`). No collective awareness at all.
- A member deselecting a copied service leaves the provider row active: the calendar either
  vanishes from the offering or stays listed with no bookable times (a "ghost"), and the host's
  manager still shows it ticked. A member ticking a copy on another calendar never reaches the
  combined page. Nobody is told.

### 2.7 The Booking Page tab and public pages

- A venue in a live collective gets a two-way switch: the combined scope (the host's inline
  manager; a member's read-only summary) and a fully editable own scope for both roles
  (`src/app/dashboard/settings/SettingsView.tsx:1629-1690`).
- Every member's own `/book/{slug}` stays live by default (`solo_page_behavior = 'keep_live'`,
  redirect has no UI), `/book/{venue}/{calendar}` and `/embed/{venue}` never check the collective,
  and guests meet two storefronts for the same calendars with different names, descriptions,
  photos, prices, identity, policies and login rules.
- The combined page reads the host venue's address, phone, website, hours, currency, wording and
  two flags live; borrows the host's tabs, About, gallery and social links only until any tab key
  is saved on the collective; ORs every member's login requirement; merges members' team bios.
- The combined-page embed frames `/book/c/{slug}`, which the frame headers refuse on any external
  site (`next.config.ts:60-67`).

### 2.8 The booking engine

- Name, description, heading and order come from the offering; everything a guest actually books
  (price, duration, buffer, variants, add-ons, deposit, window, compliance, Stripe account, emails,
  manage link) comes from the owning venue's own service and settings.
- Price and duration are resolved in several incompatible ways (see CB-01 and CB-02 below): the
  catalogue uses the first calendar's merged values for every calendar at a venue; single and
  staff creates charge the base price and reserve the base duration; group creates charge the
  calendar price with the base duration; visit creates use the first calendar's duration.
- Staff inside a live collective get the offerings-only collective form from every entry point,
  including their own diary columns, so member-only services cannot be booked from the diary
  while the member's own page still sells them. Under D2 as revised on 2026-09-14 the
  offerings-only form is the intended behaviour; what changes is that services not on the page stop
  being sold anywhere else too, because they are parked (§6.6).
- Money, guest records, compliance and comms belong to the owning venue. A member without Stripe
  is offered for paid offerings and the guest is refused at the final step (live on staging).

### 2.9 Other consumers

- The mobile app (`C:/Resneo-app`, read at `d90dece`) is a full client of the services,
  calendar-assignment, overrides, add-ons, compliance and combined-page builder endpoints,
  including the sync badges and Link/Unlink actions. It builds a service's calendar ids from
  `practitioner_services` and sends them back as `practitioner_ids`, which replaces the whole set,
  so member calendars must never be merged into that array.
- The written principles contradict the owner's model: spec §1 ("a relationship, not a merge"),
  §2.1 ("No row is ever copied between venues"), §7.7 ("a routing layer, never a data layer"),
  §7.7.3 (price and description "are the member's own"), and PRD §3.10.

### 2.10 Staging facts (read-only, 2026-09-13)

- Two collectives, both hosted by Plus 1 Staging (`c6eb0e01`): "Plus 1 Staging" (`1a1cd9f3`,
  slug `plus-1`, active, member Light 3 `443c5495`) and one dissolved (`9f1e4ddf`).
- The live collective: 21 active offerings, each provided by the host's own original and a
  `linked` copy at Light 3; 84 active providers, all pinned to a calendar, none without an
  assignment. On the 21 copies, scheduling shape is in step but price differs on 2 (Haircut 25.00
  at the host, 10.00 at Light 3), deposit and payment rule on 1 (Senior (65+ Yrs): card hold at
  the host, none at Light 3), location on 3, category presence on 16, staff flags on 1.
- Light 3 has no Stripe account while its copies of Hair Up and Full Head Foils require a 20.00
  deposit. Light 3 offers 10 more calendar-service pairs that are not on the combined page.
- 68 bookings carry `collective_id`; none has a stored price; 35 staff-source ones have no actor.
- The dissolved collective still holds 33 active providers (8 on deleted services), 2 pending
  approvals and 11 legacy null-calendar rows. No venue is in two live collectives.

---

## 3. Split-brain inventory

Every place where a host or member edit applies to fewer (or more) surfaces than a reasonable
person would expect, or where two surfaces disagree about the same fact. Deduplicated across the
eight maps; severity is the highest any auditor assigned.

| id | You do this | You would expect | What actually happens | Sev | Evidence |
|---|---|---|---|---|---|
| SB-01 | Host changes price, deposit, payment rule, name, description, category, window, location, add-ons or forms on its Services page | The collective follows | Only host calendars change; member copies keep old terms; the page advertises the lowest price | High | `service-sync.ts:31,258-313`; `catalogue.ts:903-906,939` |
| SB-02 | Member edits price, deposit, description, add-ons or window on a copy | Nothing to do with the collective | The combined page sells the member's values for its calendars; copy stays "linked"; host not told | High | `appointment-services/route.ts:1472-1501`; `catalogue.ts:903-906` |
| SB-03 | Member changes duration, buffer, processing or options on a copy | Its own tweak | The copy silently stops following the host (`customised`) | Medium | `route.ts:1498-1501` |
| SB-04 | Member deselects a service on Calendar Availability | Only its own calendar changes | The calendar vanishes from the offering, or stays listed with no times; host manager still shows it ticked | High | `practitioner-services/route.ts:110-129`; `collective-venue.ts:440-454` |
| SB-05 | Member or host ticks a service on another calendar | The calendar appears on the collective page | Never reaches the combined page (providers are pinned per calendar) | High | `catalogue.ts:876-889` |
| SB-06 | Host unticks a member calendar or removes an offering in the manager | The calendar stops offering the service | Only the provider row changes; the member's own page, diary and staff form still sell it | High | `catalogue/route.ts:549-564,726-753` |
| SB-07 | Host views a service on its Services page | Every calendar offering it | Only host calendars; member calendars live in a second list in the manager | High | `AppointmentServicesView.tsx:1004-1009,1393-1412`; second list `CombinedPageManager.tsx:565-581` |
| SB-08 | Host renames an offering in the manager, or its service on the Services page | The name changes everywhere | Only one of {offering, host service, copies} changes; emails and diaries show the owning venue's service name; later ticks create duplicates | Medium | `catalogue/route.ts:521-547`; `service-duplication.ts:852-883` |
| SB-09 | Host sets offering default price, duration or pricing display | A collective price | Ignored by the live page; the editor preview shows them | Medium | `catalogue.ts:903-906`; `CombinedPageManager.tsx:565-581` |
| SB-10 | Host reorganises headings or drags service order on its Services page | The collective page follows | Two heading systems with one-shot inheritance; member sort orders tie-break the page | Medium | `collective-category-inheritance.ts:86-129`; `catalogue.ts:944-953` |
| SB-11 | A staff member sets a per-calendar price or length | Applies wherever that calendar is booked | The combined page uses the first calendar's values for every calendar at the venue; single creates charge the base price | High | `catalogue.ts:100-121`; `collective-booking-override.ts:94-119` |
| SB-12 | Host turns a staff permission flag on or off | Member calendars follow | Flags copied once, never synced; a member admin can change them; stored values apply with the flag off | Medium | `service-duplication.ts:48-60`; `merge-service-with-overrides.ts:8-34` |
| SB-13 | Host adds a patch test requirement or edits add-on options | The whole collective enforces or offers them | Compliance copied once and never again; add-ons only follow when the host presses a manager button | High | `service-duplication.ts:714-748`; `service-sync.ts:258-313` |
| SB-14 | Host deactivates or deletes a service | Gone from the collective page | Still bookable through member calendars; later copies cloned from the member's version | Medium | `appointment-services/route.ts:1877-2015`; `service-duplication.ts:138-163` |
| SB-15 | Host has no calendar on an offering | The host stays master | A member's service becomes the origin; member shape edits overwrite host copies; mutual-follow cycles are possible. Worse than "Medium" once traced: `pickOriginProvider` falls back to `list[0]` when the host is not a provider, and the sync gate `venuesShareLiveCollective` never checks that the origin venue is the host or that the copy came from this collective, so **one member's ordinary service save writes into a second member's venue with no host in the loop**, through `after()` with no host check | High | `service-duplication.ts:138-163`; `service-sync.ts:222-241,395-424`; `appointment-services/route.ts:1560` |
| SB-16 | Owner edits "their page" in the own scope of the Booking Page tab | Only their own page | Host tabs, About, gallery and social links feed the combined page until a tab key is saved there; team bios merge; an adopted venue's slug moves the combined address | High | `collective-page-config.ts:44-80`; `collective-venue.ts:108-141` |
| SB-17 | Host edits its profile, hours, booking settings or wording | Its own venue | Rewrites the shared page for every member | Medium | `collective-venue.ts:88-179` |
| SB-18 | A member turns on "require an account" | Its own guests | Forces sign-in for every guest on the combined page | Medium | `collective-venue.ts:114-127` |
| SB-19 | Guest follows different links for the same venue | One storefront | Sidebar and most emails open the combined page; portal Book again, waitlist offers, calendar links, practitioner deep links and `/embed/{venue}` open the member's own page; embed and QR disagree | High | `venue-booking-page-link.ts:17-29`; `rebook-url.ts:30-51`; `embed/[venue-slug]/page.tsx:12-26` |
| SB-20 | Guest books the collective | One business | Charged by, emailed by and managed through the member venue, under that venue's service name | Medium | `create/route.ts:2029-2039,2162-2172` |
| SB-21 | Guest chooses "Any available" | Same terms whoever is picked | Pools calendars with different prices, deposits and card holds; ignores the host's assignment order | Medium | `collective-venue.ts:413-421`; `collective-booking-bridge.ts:285-297` |
| SB-22 | Member leaves, or is removed | Its own page and services back | Copies stay linked and dormant; an adopted address keeps serving the collective; the Leave dialog says the own page is unaffected | High | `catalogue.ts:616-626`; `VenueCollectivesPanel.tsx:357-369` |
| SB-23 | Host transfer | Mastership moves | Copies still follow the old host; the page's address, hours and rules switch at once; the confirmation mentions none of it | Medium | `members/route.ts:151-174`; `collective-venue.ts:88-172` |
| SB-24 | Reducing a link's write grant | A booking-permission tweak | Both venues' calendars silently vanish from the page while both stay members | Medium | `collectives.ts:627-645` |
| SB-25 | Staff book from the diary | The calendar's services | Every column, including own columns, opens the offerings-only form; member-only services cannot be booked there. **Resolved by D2 as revised 2026-09-14:** the offerings-only form is kept as the intended behaviour, and services not on the page are parked everywhere, so the diary and the own page no longer disagree | Medium | `collective-staff-scope.ts:133-156`; `PractitionerCalendarView.tsx:9188-9195` |
| SB-26 | Receptionist picks a known client in the collective staff form | That venue's client | Search covers the acting venue, but the client is written into the calendar's venue | Medium | `DetailsStep.tsx:253,457-459`; `venue/bookings/route.ts:345-358` |
| SB-27 | Five definitions of "live collective" | One answer | Settings, staff form, sidebar, emails, widget and cross-suggestion disagree when a member lapses | Medium | `collective-staff-scope.ts:77-114`; `collectives.ts:824-841,873-886` |
| SB-28 | One person works at two venues in the collective and is given a login at each | One account that reaches both | `resolveUniqueStaffRow` refuses implicit venue selection, so they are redirected to `/signup/business-type` and locked out of both dashboards, with no message and no chooser. There is no venue switcher in the product | High | `src/lib/venue-auth.ts:55-65,330-332`; `src/app/dashboard/layout.tsx:89-93`; `supabase/migrations/20260301000003_create_staff.sql:16` |
| SB-29 | A host staff member created a service before the collective existed, and the host puts it on the page | Only host admins control what the collective sells | The same seven `staff_may_customize_*` flags gate a non-admin's edits to the service row itself, and a staff-created service stores all seven as true, so the creator keeps the right to rewrite the master | High | `appointment-services/route.ts:91-99,420-446,918,939-945,1256-1262` |
| SB-30 | Anyone opens a report or an export and looks for collective bookings | Bookings taken through the collective are identifiable | `bookings.collective_id` is written by three create paths and read by no report, export or metric; `source` has no collective value either, so the collective flow records `booking_page`. Collective trade is invisible everywhere money is counted | High | `20260919120000_linked_accounts.sql:149-150`; `20270118120000_bookings_account_safe.sql:42`; `create/route.ts:135` |
| SB-31 | A host, or a member, opens Booked revenue | The collective's money, with each venue named | Because the collective forces a full mutual link mesh, the report blends every member's calendars into one total, symmetrically, with no per-venue subtotal, labelled only "shared with you through a linked account". D49 keeps the mutual visibility but requires it to be named, broken down by venue and consented to at join, so what is left to fix is the presentation and the consent, not the access. Narrowing a link still silently drops the whole column while membership continues | Medium | `reports/booked-revenue.ts:83-85,300,316-317`; `collectives.ts:507-512`; `BookedRevenueSection.tsx:331-340,361-366` |
| SB-32 | A guest books at two member venues on the same collective page | One client record for one business | Two guest rows in two venues, and `merge_guests` refuses a cross-venue pair, so the split is permanent. Visit counts, tags, notes and loyalty are halved from the guest's point of view. D42 accepts this and covers it in the help centre only, with no product UI | Low | `guests` scoping per venue; `merge_guests_into` refuses a source or target outside `p_venue_id` (`20270103122000_merge_guests_carry_user_id.sql:41-46`) |
| SB-33 | A guest wants to join the waitlist from the collective page | The same waitlist the member's own page offers | The synthetic venue hand-builds two resolved flags and omits `waitlist_v2`, and the waitlist route has no collective branch, so the form never renders. Waitlist offer links also lose their query string on redirect | Medium | `collective-venue.ts:174-179` vs `venue-public-feature-flags.ts:34-42`; `api/booking/appointment-waitlist/route.ts:42-54`; `book/[venue-slug]/page.tsx:16-19` |
| SB-34 | A guest unsubscribes from marketing after booking through the collective | They stop hearing from the business they booked | Consent and unsubscribe are per venue guest row, so opting out at one member leaves every other member free to send. Marketing emails carry no unsubscribe link at all, and `createMarketingUnsubscribeUrl` is dead code | High | `send-marketing-contact-message.ts:97-104`; `marketing-unsubscribe.ts` |
| SB-35 | A member that also runs classes, events or bookable resources joins, and its own page starts redirecting | Its whole business keeps its online channel | The combined page is appointments only: the synthetic venue is built with `booking_model: 'unified_scheduling'` and a single active model, and the catalogue reads only services and practitioner calendars. The redirect fires before the member's own page is built, so its other models leave the web entirely (only `/embed/{slug}` survives) | High | `collective-venue.ts:163-165`; `catalogue.ts:69-84`; `appointment-catalog.ts:214-216`; `book/[venue-slug]/page.tsx:16-19`; `embed/[venue-slug]/page.tsx:16-17` |
| SB-36 | Two venues in a collective share a physical room and each puts it on a calendar | The room cannot be booked twice at once | `unified_calendars.venue_id` is NOT NULL and resources are pinned to one venue by the API but not by the database, and nothing compares across venues, so the shared room is silently double-booked | Medium | `unified_calendars.venue_id NOT NULL` at `20260430120000_unified_scheduling_engine.sql:53`; `venue/resources/route.ts:191-196` pins the display host by venue; `20260504120000:9-12` is cited for what it omits, a venue check |
| SB-37 | The collective adopts a member's booking address | One address for one storefront | `/book/c/{slug}` and `/book/{adopted}` then serve byte-identical pages with no canonical between them, and `/book/{venue}/{calendar}` and `/embed/{venue}` never check the claim at all, so sibling URLs serve different identities | Medium | `resolveCombinedSlugClaim` callers; `book/[venue-slug]/[practitioner-slug]/page.tsx`; `embed/[venue-slug]/page.tsx:16-17` |
| SB-38 | One practitioner works at two venues in the collective and has a calendar at each | They cannot be booked twice at the same time | There is no cross-venue person: `unified_calendars` is venue-scoped, `staff` is one row per venue, every availability read is venue-scoped, and the only conflict checker is venue-scoped and resource-only. The same human is silently double-booked | High | `unified_calendars` venue scoping; `staff` per venue; `collective-booking-bridge.ts:202-262` |
| SB-39 | A host looks at a member's column in the diary to see when they are free | The member's real hours | Partner columns are drawn from `working_hours` alone, so the header line, the grey stripes and the working-hours filter ignore schedule periods, rotas, days off, amended hours, leave, the partner venue's opening hours and its closures. The host is shown a member as open all day on a day that business is shut | High | `linked-calendar/route.ts:182-207`; `practitioners/route.ts:34-61` already returns schedule periods, the rota, days off and amended hours |
| SB-40 | A guest picks "Any available" on the collective page | A fair spread across the venues offering it | The collective branch returns before the flags block, so `any_available_practitioner_config` (priority or random, and the host's calendar order) never runs, and the bridge takes a first-wins dedupe over a list hard-coded host first. The host is handed every contested slot, permanently | High | `booking/availability/route.ts:577-611` vs `:613`; `collective-booking-bridge.ts:287-292`; `collective-venue.ts:586-596` |
| SB-41 | Staff try to move a booking to a calendar at another venue in the collective | It moves, as it would within one venue | The drag is refused and the dialog explains that the calendars "are on different ResNeo accounts". The offered path is rebook then cancel: a new booking id, the service picked again by hand, a cancellation and a confirmation both sent to the guest, and the deposit and card hold abandoned | High | `PractitionerCalendarView.tsx:6180-6212,9325,5016-5053` |
| SB-42 | A member leaves the collective, or the collective is dissolved | **Withdrawn 2026-09-14 (D41): not a defect.** The owner's rule is that a collective is extra functionality on top of account links with full access, and ending or leaving it changes only the collective | Leave, removal and dissolve flip the membership row and touch no `account_links` row, so each account link and everything it grants (client records, bookings, and create, edit and cancel at the other venue) carries on after the collective. That is correct and must stay. It was first logged here as a High defect in the belief that the owner wanted access to end | n/a | `collectives/[id]/members/route.ts:189,280` and `collectives/[id]/route.ts:259-263`; create, invite and accept require the full account-link mesh first, through `checkCombinedEligibility` (`collectives/route.ts:138`, `members/route.ts:123,228`) |

---

## 4. Bugs found in passing

Two lists. The first is inside the collective feature; most disappear with the redesign, but the
ones marked **Fix now** hurt today and are cheap to fix on the current model. The second affects
every venue.

### 4.1 Collective bugs

| id | Bug | Sev | Fix now? | Evidence |
|---|---|---|---|---|
| CB-01 | Combined catalogue applies the first calendar's custom price and duration to every calendar at that venue | High | Yes (W1) | `catalogue.ts:100-121,903-906` |
| CB-02 | Four create paths, three price rules: single and staff creates charge the base price and reserve the base length; groups charge the calendar price at base length; visits use the first calendar's length | High | Yes (W1) | `collective-booking-override.ts:94-119`; `create/route.ts:1102-1110,1240-1243`; `create-group/route.ts:356-366,431-438`; `create-multi-service/route.ts:272-277,408-413` |
| CB-03 | Ghost calendars: a provider keeps a calendar listed after it stops offering the service; no times, create 409 | High | Yes | `collective-venue.ts:440-454`; `catalogue.ts:876-889` |
| CB-04 | An adopted member that leaves keeps serving the combined page at its own address | High | Yes | `catalogue.ts:616-626` |
| CB-05 | Dissolving 404s every combined-page link, QR code, embed and emailed link | High | Yes | `collectives.ts:537-540`; `collectives/[id]/route.ts:253-258` |
| CB-06 | The combined-page embed is refused on any external site | High | Yes | `WidgetSection.tsx:125-134`; `next.config.ts:60-67` |
| CB-07 | A member without Stripe is offered for paid offerings and the guest is refused at the last step (live on staging) | Medium | Yes | `collective-venue.ts:440-492`; `create/route.ts:1658-1663` |
| CB-08 | Collective day and month availability ignore a variant's buffer and processing | Medium | Yes | `collective-booking-bridge.ts:100-110,252-255,360-364` |
| CB-09 | Collective visit availability skips each service's booking window | Medium | Yes | `collective-booking-bridge.ts:459-471` |
| CB-10 | A variant rename through sync breaks existing member bookings (variants matched by name) | Medium | Retire with sync | `service-sync.ts:155-190` |
| CB-11 | `decline` is accepted from active members and the host | Medium | Yes | `members/route.ts:79-85,253-266` |
| CB-12 | Lifecycle writes ignore database errors (200 and emails when nothing was written) | Medium | Yes | `members/route.ts:134-146,168-193`; `collectives/[id]/route.ts:255-270` |
| CB-13 | A venue can be an active member of two live collectives | Medium | Yes | `collectives/route.ts:51-76`; `members/route.ts:107-140,218-251` |
| CB-14 | Departed members' providers are suspended, not removed, and revive on re-join | Medium | Retire with providers | `collectives.ts:268-285,578-591` |
| CB-15 | Reconcile runs on anonymous renders and can remove, dissolve or transfer silently | Medium | Yes | `collectives.ts:473-594,919-934` |
| CB-16 | Venue hard delete skips collectives; deleting a host cascades the whole collective; deleting an adopted venue plausibly aborts on a CHECK | Medium | Yes | `20260518120000_venue_delete_terminate_account_links.sql:67-116`; `20261210120000_combined_booking_page.sql:25,44-47` |
| CB-17 | Tick-time "Link it" on a host calendar is a silent no-op | Medium | Retire | `catalogue/route.ts:302-310,755-781` |
| CB-18 | UI and server match service names differently; the server merges distinct services | Medium | Retire | `catalogue.ts:143-153`; `service-duplication.ts:852-876` |
| CB-19 | `set_providers` reports success on partial failure | Medium | Retire | `catalogue/route.ts:755-788` |
| CB-20 | Renaming an offering makes later ticks create duplicates, including a same-venue linked duplicate at the host | Medium | Retire | `service-duplication.ts:786-788,852-883` |
| CB-21 | Copy rollback leaves categories, compliance types and an unassigned copy behind | Medium | Retire | `service-duplication.ts:692-711,801-823,878-883` |
| CB-22 | A deleted origin degrades new copies to plain 30-minute unpriced services and strands linked copies | Medium | Retire | `service-duplication.ts:143-162,337-356` |
| CB-23 | A client-chosen `source` waives deposits and compliance on the anonymous create routes (platform-wide, affects collectives too) | Medium | Yes | `create-multi-service/route.ts:126,209-213`; `create-group/route.ts:170-179`; `staff-visit-charge-discretion.ts:20-22,48-66` |
| CB-24 | Group parties split across venues fail only at the final step | Low | Yes | `create-group/route.ts:225-233` |
| CB-25 | Group compliance can reject forms drawn from the wrong venue (plausible, not reproduced) | Low | Yes | `booking-requirements/route.ts:95-124`; `booking-capture.ts:79-121` |
| CB-26 | Staff visits and groups carry no actor stamp (35 staging bookings) | Low | Yes | `create-multi-service/route.ts:913-966`; `create-group/route.ts:817-870` |
| CB-27 | `linkCopyToOrigin` allows mutual-follow cycles | Low | Retire | `service-sync.ts:395-424` |
| CB-28 | The combined Services tab shows the cheapest venue's price with no "from" | Low | Yes | `catalogue.ts:939` |
| CB-29 | Dissolution emails go to every historical membership row; host remove emails any venue id supplied | Low | Yes | `members/route.ts:184-205,291-300` |
| CB-30 | Collective invitations never expire | Low | Yes | `collectives.ts:535-536` |
| CB-31 | Invite and accept ignore the venue's own subscription eligibility | Low | Yes | `members/route.ts:97-174,218-251` |
| CB-32 | The catalogue memo is per process and not invalidated by calendar setup writes or dissolve | Low | W4 | `collective-venue.ts:259-268` |
| CB-33 | A slug `dissolved-{id}` can block that collective's dissolution; names are held 30 days but slugs are freed at once | Low | Yes | `validation.ts:101-105`; `collectives/[id]/route.ts:255-258` |
| CB-34 | Name uniqueness uses `ilike`, so `%` and `_` act as wildcards | Low | Yes | `collectives/route.ts:93-99,117-127` |
| CB-35 | Linked diary columns use the raw weekly template for hours (ignore schedule periods, leave, amended hours) | Low | Yes | `linked-calendar/route.ts:183-195` |
| CB-36 | Staff month and day date rules differ on a collective (same-day) | Low | Yes | `booking-flow-api.ts:81-88`; `availability/route.ts:597-610` |
| CB-37 | The host is never alerted to combined-page bookings on member calendars | Low | Decision | `create/route.ts:2136-2172` |
| CB-38 | A member can change its timezone while in a collective | Low | Yes | `src/app/api/venue/route.ts:322` |
| CB-39 | Leaving the Booking Page tab with staged changes relies on `window.confirm`, which is auto-dismissed in the owner's browser | Low | Yes | `SettingsView.tsx:1164-1167,1236-1255` |
| CB-40 | Former and declined members keep read access to the collective under RLS | Low | Yes | `20270202140000_collective_policies_no_recursion.sql:28-49` |
| CB-41 | Creating a collective fails silently. The dialog's catch hands the message to the parent panel, which renders it inside `SectionCard.Body` behind the still-open dialog, so all nine server refusals (address taken, name taken, name on hold, not eligible, already in a collective, plan) and the 500 are invisible: the button simply stops spinning | High | Yes | `VenueCollectivesPanel.tsx:532-534` rendering at `:149-151`; refusals in `collectives/route.ts:30-163` |
| CB-42 | The collective row shows a green "Active" pill from the moment of creation, while the public page serves its unavailable state until two members are active. "Active" describes the membership row's status column, not the page, and it is the first thing a new host reads | Medium | Yes | `VenueCollectivesPanel.tsx:307-309`; `collectives.ts:872,946,978-981` |
| CB-43 | The collective row's member line counts only active members but names invited ones too, so a new collective reads "1 active member, Riverside Clinic, Northside Studio" | Low | Yes | `VenueCollectivesPanel.tsx:312-316`; `collectives.ts:327-333,438` |
| CB-44 | The catalogue's `ops` array is capped at 200, so a realistic collective setup (5 venues, 40 services, roughly 800 to 1,600 operations) is refused outright with "Invalid request". Any bulk action has to chunk, and nothing in the current design says so | Medium | Yes | `src/lib/linked-accounts/validation.ts:337-354` |
| CB-45 | `set_providers` swallows per-operation failures: it skips a failed op with `continue` and returns `{ ok: true }` unless every single one failed, so a host is told a bulk change succeeded when part of it did not. `addCalendarToOffering` already builds a structured error per op, so the envelope is the missing piece, not the information | High | Yes | `collectives/[id]/catalogue/route.ts:767,784-786`; errors built at `:228-237` |
| CB-46 | A host can strip a calendar that has upcoming bookings and is never told, while a member doing the same is stopped with a 409 and shown the bookings. The protection exists; it is only wired to one side | Medium | Yes | `catalogue/route.ts:726-736,739-751` against `AppointmentAvailabilitySettings.tsx:819-844` |
| CB-47 | **D3 is not implemented and cannot be reached.** `solo_page_behavior` defaults to `keep_live`, is read by the redirect resolver and is settable over the API, but **no screen or form anywhere writes it** (only a test fixture sets it). So nothing is superseded today except at an adopted address, and the host's own page is never superseded at all. Meanwhile the sidebar already hides "Your Booking Page" once two members are active, so the normal case is a live own page its owner can no longer find | High | Yes | `collectives.ts:397`; `catalogue.ts:634`; `members/route.ts:318`; no writer in `src/components` or `src/app/dashboard`; sidebar `collectives.ts:886` |
| CB-48 | The host previews a page that differs from the one guests get. `collective-settings-to-preview-public.ts:40-52` hard-codes address, phone, website and opening hours to null, currency to GBP and `booking_paused` to false, while the live page fills all of them from the host. The client already holds the real values in `collective.hostContact`, and the single-venue preview passes four of the five properly (it hard-codes currency too, at `:45`) | Medium | Yes | `collective-settings-to-preview-public.ts:40-52` against `collective-venue.ts:151-170` and `venue-settings-to-preview-public.ts:21-23,43-44` |
| CB-49 | Share and embed is never rendered on the collective scope at all: it sits in the `else` branch. Where the QR is reachable it encodes the collective address but prints the venue's name and names the file after the venue slug | Medium | Yes | `SettingsView.tsx:1638-1686`; `WidgetSection.tsx:146,182,186` |
| CB-50 | A collective's address can never be changed after creation. The PATCH accepts name, config, logo, cover, slug strategy and adopted venue, but never `slug`, while the page name is freely editable, so the name and the address drift apart permanently | Medium | Yes | `collectives/[id]/route.ts:74-200` |
| CB-51 | **The invitation email tells a joining venue the opposite of the truth about its data.** Its only description of the arrangement reads "A venue collective is a combined public booking page that shows your services alongside other linked venues, under shared branding. Your booking and client data stay fully separate." Both halves are wrong: under D3 the collective page replaces the member's page rather than sitting alongside it, and membership forces a full mutual link mesh whose grant is exactly what carries client-record access and revenue reporting, which D41 now keeps deliberately. This is the one sentence a member reads about their data before agreeing | High | Yes | `notifications.ts:436-442`; `collectives.ts:501-512`; `reports/booked-revenue.ts:83-85,316-317` |
| CB-52 | Accepting an invitation publishes more than the member knows. Accept defaults `visible_practitioner_ids` and `visible_service_ids` to `[]`, and empty means **all** (`visiblePractitioners.length === 0 ? true`), so one unconfirmed click puts every calendar and every service the venue has onto a public page it does not control. No screen ever showed them which | High | Yes | `collectives/[id]/members/route.ts:244-247`; `collectives.ts:988-1000` |
| CB-53 | The first venue invited cannot see the page it is being asked to join: the "View combined booking page" link is gated on two active members, and a fresh collective has exactly one | Low | Yes | `VenueCollectivesPanel.tsx:317`; `collectives.ts:438` |

### 4.2 Platform bugs found on the way (every venue)

| id | Bug | Sev | Evidence |
|---|---|---|---|
| PB-01 | Five of seven per-calendar overrides (name, description, buffer, deposit, colour) are dropped under unified scheduling, silently when paired with a duration or price and otherwise as a confusing 400; help documents all seven | Medium | `practitioner-service-overrides/route.ts:169-188`, 400 at `:172,183-188`; `20260430120000_unified_scheduling_engine.sql:115-122` |
| PB-02 | Stored per-calendar values apply even when the permission flag is off; admins can neither see nor set them (1 staging row) | Medium | `merge-service-with-overrides.ts:8-34`; `practitioner-service-overrides/route.ts:89-94` |
| PB-03 | Calendar assignment writes delete everything, then insert, with no transaction (two routes) | Medium | `practitioner-services/route.ts:110-129`; `appointment-services/route.ts:1394-1401` |
| PB-04 | An open Edit calendar dialog deletes assignments added since it opened (lost update) | Medium | `AppointmentAvailabilitySettings.tsx:572-586,794` |
| PB-05 | The services PATCH writes links and the row before it finishes validating, then returns 400 | Medium | `appointment-services/route.ts:1351-1402,1503-1561` |
| PB-06 | A service price cannot be cleared once set | Medium | `appointment-service-form-to-payload.ts:163`; `appointment-services/route.ts:192,929` |
| PB-07 | Appointment prices are not snapshotted, so price edits rewrite historic totals | Medium | `payment-summary.ts:109-152` |
| PB-08 | `PUT /api/venue/practitioner-services` accepts service ids from other venues | Low | `practitioner-services/route.ts:18-21,112-124` |
| PB-09 | A non-admin PATCH applies the payment rule and location from the unfiltered body (API only) | Low | `appointment-services/route.ts:327-357,1299-1310,1404-1439` |
| PB-10 | Creator edit and delete buttons never render (`currentStaffId` not passed) | Low | `appointment-services/page.tsx:40-45` |
| PB-11 | "Edit your settings" can preselect a calendar that does not offer the service | Low | `AppointmentServicesView.tsx:575-583` |
| PB-12 | Removing a variant hard-deletes it and rewrites booking totals | Low | `service-variants.ts:189-200` |
| PB-13 | `window.confirm` gates switching to one fixed offering and deleting an add-on group | Low | `AppointmentServiceFormFields.tsx:216-224`; `AddonsLibraryView.tsx:183-190` |
| PB-14 | `service_items.updated_at` is never maintained | Low | no trigger on `service_items` in any migration |
| PB-15 | The public details step pre-ticks marketing consent ("offers and news from this business"); worth a consent review on every page | Low | `DetailsStep.tsx:243-244,674-681` |
| PB-16 | Inviting someone who already works at another venue succeeds, then locks them out of both dashboards: the invite route checks only "already a staff member for this venue" and nothing warns either side | High | `staff/invite/route.ts:135`; `venue-auth.ts:55-65` |
| PB-17 | No booking page has usable metadata. `/book/{venue}` has neither `generateMetadata` nor a `metadata` export and there is no `src/app/book/layout.tsx`, so every venue booking page on the platform serves the root layout's title. `/book/c/{slug}` sets title and description only: no Open Graph image, no Twitter card, no canonical, no robots directive, and no structured data anywhere | High | `book/[venue-slug]/page.tsx`; `book/c/[slug]/page.tsx:26-34`; `src/app/layout.tsx:37-42`; `robots.ts:17-44` |
| PB-18 | Marketing emails carry no unsubscribe link: the sender writes a bare paragraph and `createMarketingUnsubscribeUrl` is dead code. This is a compliance problem on every venue, not only in a collective | High | `send-marketing-contact-message.ts:97-104`; `marketing-unsubscribe.ts` |
| PB-19 | `GET /api/venue/export?type=bookings` is not admin-gated while returning every guest's email and phone, although the same file gates another export | Medium | `export/route.ts:31-37` vs `:146` |

---

## 5. Options considered and the decision

### 5.1 Option A: host-managed replicas (chosen)

Keep every booking, calendar assignment and service row owned by its venue. The host's own
service becomes the single stored master; every member holds one locked replica of every offered
service, rewritten by one transactional engine whenever the master or anything it references
changes, from any write path. Members choose which of their calendars offer each replica and set
the per-calendar values the host delegates; nothing else. `calendar_service_assignments` becomes
the only record of which calendar offers what, and the combined page is derived from it. Leaving
releases the member's replica link rows in one transaction (the rows are kept with `released_at`
set, never deleted) and every replica becomes an ordinary service the member controls.

### 5.2 Option B: one master service, no copies while in a collective

Member calendars are assigned directly to the host's `service_items` rows (the assignment table
already accepts a calendar and a service from different venues). There is exactly one row per
service and nothing to sync. Member bookings reference the host's service; a per-venue projection
function tells every venue-scoped reader which services a venue may use. Leaving materialises the
services the member used as its own rows and re-points its calendars, bookings, add-on
selections, compliance records and waitlist rows.

### 5.3 Comparison

| Question | A: replicas | B: one master |
|---|---|---|
| Owner's words "created on the non-host account" | Literally created | Visible but not created until leaving |
| Split-brain | Prevented by locks, engine and one assignment store | Structurally impossible |
| Consistency | Eventual: seconds of lag, surfaced and narrowed | Immediate |
| Blast radius | One engine plus lock layer; readers unchanged | About 30 venue-scoped readers must adopt a new access layer; a missed one silently breaks member calendars |
| Data ownership | Every row a booking touches stays at its venue | Member bookings, compliance records and waitlist rows point at host rows |
| Leaving | One fast transaction, nothing lost | A resumable multi-minute data migration that can pause on failure |
| Host transfer | Role swap per offering plus library forks | Re-home master rows and split shared library objects |
| "Any available" across venues with options | Needs id mapping (phase 2) | Natural |
| Mobile app | Member replicas are ordinary member rows; locks explained by coded 409s | Old builds list host rows as editable and get refusals |
| Storage | Rows multiply by offerings times members | One row per service |
| Effort | Large (engine, lifecycle) | Large (reader migration, lifecycle, leave) |

### 5.4 Decision

**Option A, host-managed replicas, with five ideas taken from Option B.** The deciding reasons:

1. It keeps ResNeo's central invariant. Every booking, guest, payment, compliance record, report,
   export, import, support script, RLS policy and the mobile app assumes a booking's rows belong
   to the booking's venue. Option B breaks that in about 30 places, and a missed reader fails
   silently. This codebase has a recent record of silent read failures (the compliance dashboard
   showed an all-clear for months because a query error was swallowed).
2. It matches R3 literally, and it makes R13 (leave at any time and regain full control) a single
   fast transaction rather than a data migration run at the moment a relationship is ending.
3. The new complexity sits in one place that can be tested exhaustively inside Postgres.
4. Its main cost, a lag of seconds between a host save and each member, is narrowed by applying
   inline on save, applying again before any booking is priced, hiding a calendar whose replica
   has been stale for 15 minutes, and snapshotting prices on bookings.

Grafted from Option B:

1. **One resolver** (`resolveCalendarServiceTerms`) for a calendar's name, price, duration,
   buffer, processing, deposit and window, used by every catalogue, availability, create, modify,
   reschedule, email and payment-summary path.
2. **Optimistic concurrency** on the Services page: `service_items.updated_at` maintained by a
   trigger and `expected_updated_at` on save (412 `STALE_RESOURCE`).
3. **Diff-based assignment writes**: `expected_service_ids` on `PUT practitioner-services`, and
   the services PATCH diffs links for the caller venue's own calendars only, never replacing the set.
4. **Timezone and currency gates**: same timezone and currency at invite and accept; timezone
   changes refused while a venue is in a live collective. Note the asymmetry this corrects:
   timezone is already gated, both at create, invite and accept and again whenever the page is
   built (`catalogue.ts:172-200`), but **currency is gated nowhere**. The combined page simply
   takes the host's currency (`collective-venue.ts:170`), so a member trading in another currency
   would have its prices relabelled rather than converted. That is a money bug, not a tidiness
   one, and it is the half of this gate that does not exist yet.
5. **Diary routing (REVISED 2026-09-14, D2)**: every diary column, the venue's own and its
   partners', plus New and Walk-in, opens the collective staff form, which lists the collective's
   offerings only. The routing first grafted here (own columns to the venue's own staff form, so
   member-only services stayed bookable from the diary) is withdrawn: a service that is not on the
   page is parked while the venue is live (§6.6).

---

## 6. The design, as amended

Section 5 chose host-managed replicas. Two red teams then attacked that design against the code,
Postgres and PostgREST behaviour and staging data. They found 5 critical and 16 high problems in
the design as first written (listed with their resolutions in §6.13). Everything below is the
amended design. Detail that belongs to one audience lives in the two companion documents:

- `Docs/collective-one-venue-ux-spec.md`: the page-by-page specification, the "where is this
  edited" matrix, every string of copy, the lifecycle journeys and the notifications.
- `Docs/collective-one-venue-test-plan.md`: the full test inventory (170 tests), the invariant
  SQL, the rollout gates and the owner's acceptance checklist.

### 6.1 Principles

1. **One truth per fact.** Every fact has one store and one screen that edits it; every other
   surface shows it read-only and names who owns it.
2. **Ownership never moves.** A booking, its guest, payment, compliance record and every row it
   references belong to the booking's own venue, before, during and after membership.
3. **The database enforces host control.** Route guards give friendly answers, but locks in
   Postgres are what stop a member, an old app build, an import or a support script from changing
   a host-managed row.
4. **Cross-venue writes are transactional, idempotent and audited.** One engine writes into
   another venue's account, inside a single transaction per change, recording who asked.
5. **Nobody is charged a price they were not shown.** Every path prices a calendar the same way,
   and a booking keeps the price it was made at.
6. **Anonymous traffic never mutates anything.** Page views, crawlers and guests only read.
7. **Leaving is lossless.** A member that leaves keeps every service, calendar choice and booking,
   and can edit all of it straight away.

### 6.2 One truth per fact

| Fact | Stored in | Edited by, and where |
|---|---|---|
| Service definition: name, description, heading, length, buffer, processing periods, start times, schedule, price, payment rule, deposit, options, add-ons, forms, booking window, cancellation notice, location type, colour, staff permission flags, active state | The host's own `service_items` row and its children (the master) | Host admins, on the host's Services, Add-ons, Categories and Compliance pages |
| The same service at a member | The member's own `service_items` row and children (the replica), locked | Only the replication engine |
| Online meeting link and joining information | Each venue's own service row (venue-controlled column) | That venue's admins (decision D11) |
| `capacity_per_session` | Each venue's own service row (venue-controlled column): a `created` replica takes the master's value once, at creation, and no apply ever overwrites it | That venue's admins (D40) |
| Add-on cost to the business | Never copied (the host's internal cost stays at the host) | Each venue for its own groups |
| Which calendar offers a service | `calendar_service_assignments` at the calendar's venue. The only store; `collective_service_providers` is dropped in C2 | Host admins for any calendar in the collective; each venue for its own calendars |
| Per-calendar values: length, buffer, price, deposit, colour (and name and description on services not on the collective page) | Assignment custom columns, applied only while the master's permission flag is on | Calendar staff within the flags, that venue's admins, and host admins (D4) |
| Offering on the collective page | `collective_service_items.master_service_id`; everything shown is derived from the master | Host admins: "Show on the {collective} page" on the Services page |
| Which services a venue can take new bookings for while live | Derived, never stored: the collective's offerings (masters on the page at the host, replicas at a member); every other appointment service is parked (D2, §6.6) | Nobody directly: putting a service on the page, taking it off, or leaving decides it |
| Staff bookings only (`is_bookable_online`) | The master (host-controlled column, Appendix F) | Host admins, on the service page (`svc.form.staffOnly.label`) |
| Page identity: name, page address, branding, tabs, About, gallery, team | `venue_collectives` and its `booking_page_config`; the host's address, phone and opening hours, labelled as the host's (a collective-owned set is Tier 3, §8.0) | Host admins, Booking Page tab, collective scope |
| Calendar hours, breaks, closures, leave | The calendar's own venue | That venue |
| Bookings, guests, payments, compliance records, waitlist | The owning venue | The owning venue |

### 6.3 Data model

All migrations follow the standing ritual (staging push, staging code, test, production push,
merge). Expand changes ship first; contracting changes only after the code that stops needing
the old shape is live on both environments.

**New tables**, five of them (RLS enabled, service-role policies only, explicit `REVOKE ALL ...
FROM PUBLIC, anon, authenticated` on each table and its sequences; DDL in Appendix C, engine DDL):

- `collective_service_replicas`: one replica link row per (offering, member). `collective_id`,
  `collective_service_item_id` (the offering; `item_id` in earlier drafts), `venue_id`,
  `member_id`, `replica_service_id` (unique, `ON DELETE SET NULL`, so a member may delete a
  released service it owns under D52 while a live replica stays undeletable behind the lock
  trigger), `provenance`
  (`created` | `adopted` | `migrated` | `reconnected`; not "origin", which keeps its legacy
  meaning of `synced_from_service_id`), `desired_revision` and `applied_revision` (bigint),
  `applied_fingerprint`, `behind_since`, `attempts`, `next_attempt_at`, `lease_until`,
  `last_error_code`, `last_error`, `last_applied_at` and `released_at`. A release sets
  `released_at` and never deletes the row: the partial unique index
  `(collective_service_item_id, venue_id) WHERE released_at IS NULL` keeps one live replica link
  per pair, and a reconnect at re-join finds the released row. The FKs on `collective_id` and
  `member_id` are `ON DELETE CASCADE`, which only ever runs after `admin_hard_delete_venue` has
  released or dissolved explicitly (§6.7).
- `collective_catalogue_revisions`: one row per collective, bumped by statement-level triggers.
  Kept off `venue_collectives` so it is not a hot row and does not disturb `updated_at`, which the
  30-day name hold reads.
- `collective_audit_events`: append-only (BEFORE UPDATE/DELETE refuses), no FK so history survives;
  actor venue, actor user, target venue, item, service, calendar, `changes` jsonb with before and
  after values. Three requirements the first draft leaves implicit, each learned from a table that
  already got it wrong:
  - **"No FK" must include the venue columns, not only the item and service ones.**
    `account_link_audit_log`'s comment promises exactly this table's guarantees
    (`20260919120000:137-138`) and delivers neither: it has no append-only trigger, it is updated
    in place (`20270103120000:104-111`), and `link_id` plus both venue ids cascade, so a member
    that leaves and then deletes its venue erases the host's copy of every cross-venue write it
    ever made. Denormalise venue names as text alongside the ids.
  - **Record who was really acting.** A superuser support session is indistinguishable from a
    venue admin in everything downstream: `getVenueStaff` returns the apparent staff row with
    `support` metadata attached and nothing obliged to read it (`venue-auth.ts:236-266`). For a
    dispute about who raised a member's price, "the host's admin" and "a platform engineer signed
    in as the host's admin" is the entire question. Add `support_session_id` and
    `actor_is_platform_superuser`, populated from that metadata, and cross-reference
    `support_audit_events`, which is append-only and already records a reason.
  - **Record system actors.** Every cron-driven apply writes an event with `actor_type = 'system'`
    and the job name, so an unattended write is never indistinguishable from a person's.
- **The cron secret is one static token, and it will gate writes into other people's venues.**
  `src/middleware.ts:352` excludes `api/cron` from the matcher, and `requireCronAuthorisation`
  (`src/lib/cron-auth.ts:8-24`) is a constant-string comparison of one shared secret with no
  rotation, no per-route scoping and no replay protection. `reconcileCollectivesAfterLinkChange`
  already runs behind it and can remove members, dissolve and transfer hosting; §6.16's 5-minute
  apply would add engine-flagged writes into every member venue behind the same token. Per-job
  secrets, or a signed and timestamped header, plus the system audit rows above.
- `collective_operations`: idempotent, resumable lifecycle jobs (join, release follow-ups, host
  transfer, migration) with `kind`, `idempotency_key`, status, `progress`, lease.
- `collective_column_classes`: the column registry described below, one row per (table, column)
  with its class, read by the engine's apply and, until C1, by `service-duplication.ts`.

Not counted among the five, because it is the booking audit's home rather than the engine's:
`collective_booking_audit` (or `account_link_audit_log.link_id` made nullable with a
`collective_id` and a CHECK), holding cross-venue booking writes authorised by collective role
rather than a pairwise link (RT2-12).

**Changed tables:**

- `collective_service_items`: add `master_service_id` (FK, partial unique per collective for
  active offerings) and `entity_type text NOT NULL DEFAULT 'service' CHECK (entity_type IN
  ('service'))`, D44's discriminator, which lives here and never on provider rows, because C2 drops
  them. The combined page stops reading the offering's own name, description, price, duration,
  heading and order.
- `venue_collectives`: add `service_model` (`legacy_copies` | `migrating` | `replicas`; the
  middle value is the migration's own state, §7), `paused_at` and `paused_reason` (the paused
  state, §6.7), `pending_host_venue_id` and `host_transfer_at` (the transfer window, §6.7); a
  BEFORE UPDATE OF `host_venue_id` trigger refuses changes outside the engine, and
  `collective_transfer_host` is the one writer it lets through; drop the
  `venue_collectives_adopt_requires_venue` CHECK, which conflicts with its own `ON DELETE SET NULL`.
- `venue_collective_members`: add `suspended_at`, `consent_version`, `consented_at`,
  `consented_by_user_id`; an AFTER UPDATE OF status trigger calls `collective_release_member`
  whenever a membership stops being active, which releases the venue's replica links and unmanages
  its library objects in the same transaction (RT1-4; this is the answer to DB-04's question of
  what that statement's transaction covers). It never writes `account_links` (D41).
- `account_links`: unchanged. No column is added and no engine function writes the table (D41). An
  earlier draft added `created_for_collective_id` so the release could end links; that is
  withdrawn.
- Children get identity mappings, `ON DELETE NO ACTION` with engine-managed cleanup rather than
  SET NULL (RT2-4): `service_variants.replica_of_variant_id`;
  `addon_groups.managed_by_collective_id` and `replica_of_addon_group_id`;
  `addons.replica_of_addon_id` (options updated in place, RT1-16);
  `service_categories.managed_by_collective_id` and `replica_of_category_id` (headings mapped by
  id and renamed in place); `compliance_types.managed_by_collective_id`,
  `replica_of_compliance_type_id`, `accepts_records_from_type_id`;
  `compliance_type_versions.replica_of_version_id`;
  `service_compliance_requirements.replica_of_requirement_id`.
- `calendar_service_assignments`: add `custom_name`, `custom_description`,
  `custom_buffer_minutes`, `custom_deposit_pence`, `custom_colour` (CHECKs mirroring the overrides
  route), plus `updated_at`, `updated_by_venue_id`, `updated_by_user_id` for "Last changed by".
  This also fixes PB-01 for every venue.
- `bookings`: add `service_price_snapshot_pence`, written by every appointment insert and by any
  modification that changes service or option, with a BEFORE INSERT fallback that fills a null
  snapshot for appointment rows (RT1-8). Not added to the authenticated column grants.
- `service_items`: an `updated_at` trigger (fixes PB-14) so the Services page can send
  `expected_updated_at`.
- `venues`: add `stripe_charges_enabled`, maintained from the `account.updated` webhook (RT2-15).
- One live membership per venue and one live hosting per venue: partial unique indexes, added in
  Pass A once invariant I7 returns 0 on production (join, offer and transfer rely on them for race
  safety, RT1-9).

**Column classification** (RT1-10, RT2-16). An explicit registry, the table
`collective_column_classes`, classifies every column of `service_items`, `service_variants`,
`addon_groups`, `addons`, `compliance_types` and `service_categories` as *host-controlled*
(copied), *identity-mapped*, *venue-controlled* (never overwritten) or *not copied*. A pgTAP test
enumerates columns from `pg_attribute` and fails on any unclassified column, so a future
venue-scoped column can never be copied silently. The two classes that were still marked
undecided are settled as D53 (§11.4): `pre_appointment_instructions` is venue-controlled, seeded
from the master at creation because it describes the venue the guest visits, and
`online_unmet_message` is host-controlled because it belongs to the form definition.
`capacity_per_session` is venue-controlled (D40). Two behaviours are rules of the apply rather than
classes, and §6.4 records them: the D29 flags forced false on replicas of offered services, and the
once-only seeding of a venue-controlled column from the master at creation. The seeded registry is
Appendix F (column registry), and it ships first, as W3a, the first part of W3 and its own
deliverable, because `service-duplication.ts` has to read it before the engine exists (§8.2,
hazard 3).

**Dropped** (contract pass C2, with `IF EXISTS`): `collective_service_providers`,
`collective_service_categories`, `collective_service_items` dead columns, the members'
`visible_*` and `solo_page_behavior` columns, the `service_items` sync columns, and finally
`service_model`.

### 6.4 The replication engine

**Revision bookkeeping (replaces the per-master queue, RT1-1).**

1. Dirty triggers (one statement-level trigger per event per table, because Postgres forbids
   transition tables on multi-event triggers; SECURITY DEFINER; `SET search_path = ''`, like every
   engine function below) run on
   `service_items`, `service_variants`, `service_addon_groups`, `addon_groups`, `addons`,
   `service_compliance_requirements`, `compliance_types`, `compliance_type_versions` and
   `service_categories`. They increment `desired_revision` on every replica link of every
   affected offering inside the writer's own transaction. UPDATE triggers compare OLD and NEW and skip
   presentation-only columns (`sort_order` alone). A host venue-wide form maps to every offered
   master. Triggers exit immediately when the venue has no replicas-mode collective.
2. `collective_apply_replica(p_link_id, ...)` takes the replica link row `FOR UPDATE` (blocking,
   with a lock timeout), reads `desired_revision`, then the master, converges the replica, and sets
   `applied_revision` to the value it read. A host write that commits during an apply bumps the
   revision again, so no change is ever skipped, and siblings are never cleared by another replica
   link's apply.
3. Engine functions are `VOLATILE`, SECURITY DEFINER, service-role only, and carry a function-level
   `SET resneo.collective_engine = 'on'`, which Postgres restores on exit (a `set_config` call would
   leak to the end of the transaction, RT1-7).
   **The flag is not a security boundary, and should not be built as one.** Anyone holding the
   database connection string (the Studio SQL editor, `psql`, a `pg_cron` job, a migration, CI's
   `SUPABASE_DB_URL`) can `SET LOCAL resneo.collective_engine = 'on'` and write any replica at any
   venue. That is worth stating plainly, and then leaving alone: someone with the connection string
   can already write any row in any table, so hardening the flag defends against an attacker who
   has already won. The flag's job is to let the engine through its own locks, not to keep anyone
   out.
   **The operational consequence does matter, and it is about evidence, not attackers.** The
   ordinary case is one of your own engineers fixing something by hand in the SQL editor. Audit
   rows are written by the engine functions, so that write leaves none. The fingerprint then
   differs and I3 flags the replica link as drifted. A verifier that repaired it by overwriting
   with the master's values and filed it as an ordinary apply would make a legitimate manual fix
   disappear without trace, and if a host and a member later disagreed about who changed a price
   there would be nothing to look at. So the verifier does not do that. The fix is one behaviour,
   not a lock: the verifier writes drift it cannot explain as
   its own audit type, `unexplained_drift_repaired`, carrying the before-image, and alerts on it
   rather than absorbing it. I41 reports the same condition.
   **`SET search_path = public` is not hardening.** It leaves `pg_temp` searched first for
   relation names, and this repository has the habit already: 81 of 85 `SET search_path` clauses
   use the unhardened form, and existing definer functions reference tables unqualified, for
   example `INSERT INTO account_link_audit_log` at `20270111120000:178,190,200`. Every new engine
   function uses `SET search_path = ''` with fully qualified names, or `pg_catalog, public`. DB-01
   must assert the **value** of `proconfig`, not merely that one is present, and fail on any
   unqualified relation reference in `prosrc`.
   **`collective_set_calendar_values` needs its authorisation stated.** It is `service_role` only,
   with `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; the route is the authorisation point;
   and it takes `p_actor_venue_id` and `p_actor_user_id` and re-checks host membership inside the
   function as defence in depth. Left unstated, a bug in one route becomes a cross-venue write.
4. Lock order everywhere: the collective advisory lock (shared for apply, offer, join and calendar
   changes; exclusive for release, dissolve and transfer), then replica link rows in id order, then the
   master. Membership is re-checked after the locks are held.
   **The dirty triggers were outside this order, and that is a deadlock.** A trigger runs inside
   the host's own save transaction, which already holds the row lock on the master (the
   `service_items` UPDATE that fired it), and then takes locks on `collective_service_replicas`.
   That is master, then replica links. The apply is replica links, then master. Two transactions
   in opposite order is a textbook ABBA inversion, and a host venue-wide form change fans out to
   every replica link of every offering at once, so it is not a rare shape. Two corrections make the order true rather
   than merely stated: a dirty trigger does nothing but bump `desired_revision`, in a single
   `UPDATE ... WHERE id IN (SELECT ... ORDER BY id)` so replica link rows are taken in id order, and it
   never touches the master again afterwards; and the apply reads the master **without** a row
   lock, because comparing fingerprints is enough and it already holds the replica link row. CON-03 must
   include this pair: its list today covers release, offer, join, transfer and apply, and omits
   the one pair that actually inverts, host save against apply.
5. Due work is `applied_revision < desired_revision`, respecting `next_attempt_at` and
   `lease_until`; the cron claim sets `lease_until` in its own transaction (a `FOR UPDATE SKIP
   LOCKED` claim gives no lease through PostgREST).

**When applies run.**

- Inline after every host save that can change a master, within a time budget, returning
  `collective_sync` in one shape everywhere: `{ venues: n, applied: n, pending: [{ venue_id,
  venue_name }], failed: [{ venue_id, venue_name, message, code }], audit_event_id }`, so the host
  sees `svc.save.allDone` ("Saved. {service} is up to date at {venueList}.") or
  `svc.save.pending` ("Saved. {venue} is updating. Its calendars take new bookings for {service}
  again in a moment."). `audit_event_id` is what the 60-second undo sends back (below). Built
  2026-09-16 with one more optional key, `calendar_failures: [{ venue_id, calendar_id, message }]`:
  a save carries the host's calendar choices too, and a calendar the engine refuses must be named
  without losing the save that succeeded (`svc.save.calendarFailed`).
- A cron every 5 minutes with backoff (1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours).
- In staff and host booking routes before pricing: apply within a short budget, and refuse a
  commercial term that is still behind with the retryable 409 `COLLECTIVE_SERVICE_UPDATING`
  ("This service is being updated. Please try again in a moment.").
- Never on anonymous traffic (RT2-18). Public availability and create compare the replica's
  fingerprint with the master's and omit a behind calendar for that offering at once; create
  refuses with the existing slot-taken answer.
- A daily verifier (`collective-verify`, §6.16) runs the invariants. It repairs lag (I3b,
  `applied_revision < desired_revision`) by running the apply, releases replica links outside an
  active membership (I5), and repairs unexplained drift (I3: a replica link marked current whose
  fingerprint differs from the expected fingerprint, which is never ordinary lag) only with an
  `unexplained_drift_repaired` audit row carrying the before-image and an alert. Everything else it
  reports without touching.

**What an apply writes, in one transaction per replica link.**

1. The service row: host-controlled columns only, per the classification registry.
   `is_active` = master active and offering active. Two rules of the apply that are not registry
   classes: `capacity_per_session` is venue-controlled, so a `created` replica takes the master's
   value once at creation and no apply ever overwrites it (D40); and on a replica of an offered
   service the apply writes `staff_may_customize_name` and `staff_may_customize_description` as
   false whatever the master holds (D29, the recommended default, §11.2).
2. Heading: the managed heading mapped by id, created once and renamed in place.
3. Options: upserted by `replica_of_variant_id`; a master option that disappears is deactivated at
   the replica, never deleted, because bookings reference it.
4. Add-ons: one managed group per (member, collective, master group); options updated in place by
   position (no id churn); the replica linked to exactly the managed groups. The member's own
   groups are never touched.
5. Forms: adoption order for the member's managed type (RT1-3, RT2-7): a member type from the same
   library template, active or archived, is unarchived and becomes managed with
   `accepts_records_from_type_id` pointing at itself; otherwise the same name; otherwise a new type
   with a suffixed slug. Host service and venue-wide requirements for the same type are merged
   (strictest enforcement, longest lock period, online collection if either has it). A new form
   version is written only when the schema changed.
6. Bookkeeping: fingerprint, `applied_revision`, audit row, catalogue revision bump.

Never written by an apply: calendar assignments and their per-calendar values, venue-controlled
columns, the member's own library objects, bookings, guests, compliance records, payments.

**Failure handling.** An apply that fails rolls back its own writes, records a coded error
(`slug_collision`, `unique_violation`, `fk_violation`, `timeout`, and so on) that the host's page
explains in plain words, and retries with backoff. A replica link behind for more than 15 minutes
(`behind_since`) hides that member's calendars for that offering and tells the host and member why
(N5); a replica link behind for more than 60 minutes pages ops (§6.16).

**Conventions every engine function follows.** Parameters end with `p_actor_venue_id uuid,
p_actor_user_id uuid, p_now timestamptz DEFAULT now()`; both actor ids are NULL for the system.
Functions a cron calls also take `p_job text DEFAULT NULL` (`'collective-replicate'`,
`'collective-verify'`, `'inline'`, `'retry'`), and functions the platform console calls take
`p_support_session_id uuid DEFAULT NULL`. All are `SECURITY DEFINER`, `SET search_path = ''` with
schema-qualified names, `SET resneo.collective_engine = 'on'`, revoked from `PUBLIC, anon,
authenticated` and granted to `service_role`. `p_now` is what makes the 60-second undo window, the
15-minute hide, the 30-day clocks and the backoff table testable without sleeping.

**The functions, by name** (bodies in Appendix D, engine functions):
`collective_apply_replica(p_link_id, p_actor_venue_id, p_actor_user_id, p_job, p_now, p_support_session_id)`
(the last parameter only because the platform console's Retry calls it);
`collective_claim_due_links(p_limit, p_lease, p_now)`;
`collective_offer_service(p_collective_id, p_master_service_id, p_actor_venue_id, p_actor_user_id, p_now)`;
`collective_withdraw_service(p_item_id, p_actor_venue_id, p_actor_user_id, p_now)`;
`collective_set_calendar_offering(p_collective_id, p_item_id, p_venue_id, p_calendar_id, p_action, p_actor_venue_id, p_actor_user_id, p_acknowledge_affected boolean DEFAULT false, p_now)`;
`collective_set_calendar_values(p_calendar_id, p_service_item_id, p_values jsonb, p_actor_venue_id, p_actor_user_id, p_now)`;
`collective_join_member(p_member_id, p_consent_version, p_choices jsonb, p_actor_venue_id, p_actor_user_id, p_now)`;
`collective_release_member(p_member_id, p_reason, p_actor_venue_id, p_actor_user_id, p_now)`;
`collective_dissolve(p_collective_id, p_reason, p_actor_venue_id, p_actor_user_id, p_now)`, called
by the host's DELETE and by both crons, one path;
`collective_transfer_host(p_collective_id, p_new_host_venue_id, p_actor_venue_id, p_actor_user_id, p_now)`;
`collective_undo_master_change(p_audit_event_id, p_actor_venue_id, p_actor_user_id, p_now)`;
`collective_invariant_report(p_since, p_collective_id)`;
`collective_replica_projection(p_link_id, p_side)`, `collective_replica_fingerprint(p_link_id)`,
`collective_expected_fingerprint(p_link_id)` and `collective_engine_test_point(p_name)`.

**Errors.** Six refusals are raised with their own SQLSTATE, `RN001` to `RN006`:
`COLLECTIVE_MANAGED_SERVICE`, `COLLECTIVE_OFFERED_SERVICE`, `COLLECTIVE_MANAGED_ADDON_GROUP`,
`COLLECTIVE_MANAGED_COMPLIANCE_TYPE`, `COLLECTIVE_HOST_CHANGE_REFUSED` and
`COLLECTIVE_SYNC_COLUMNS_LOCKED`, mapped to coded 409s by one helper,
`src/lib/linked-accounts/replicas/db-errors.ts` (a new file). Everything else an engine function
raises is `P0001` and surfaces as a 500, which is deliberate: a route is expected to have checked
the friendly conditions first (§6.5), so an engine raise outside the six is a bug to page on, not
a message to prettify.

**Audit.** Every engine write lands one `collective_audit_events` row with an `event_type` from
the closed list in Appendix C (engine DDL), `actor_type`, `actor_venue_id`, `actor_user_id`,
`target_venue_id`, `changes` holding `before` and `after`, and `system_job` or
`support_session_id` where the actor was not a person at a venue.

**Undo (D50).** `collective_undo_master_change` is allowed within 60 seconds of the audited save,
by a host admin. It restores `changes.before` on the master and its children from the
`collective_audit_events` row the save wrote (the `audit_event_id` in `collective_sync`), bumps
revisions like any master write so every replica link re-applies, writes `master_change_undone`
(shown as `history.masterChangeUndone`), and sends N6 again with the "put back" wording. Route `POST /api/venue/collectives/[id]/undo
{ audit_event_id }`; after the window, 410 `COLLECTIVE_UNDO_EXPIRED` and `ov.undo.expired`. The
offer (`ov.undo.offer`) and the result (`ov.undo.done`) render in the save summary under the page
header, in a `role="status"` region, never in the error slot (OFF-05).

### 6.5 Authority, locks and audit

**Who may write what while a collective is live:**

| Actor | Master | Replica | A calendar offers a service | Per-calendar values | Offering on the page | Page, members |
|---|---|---|---|---|---|---|
| Host admin | Every attribute | None directly | Any calendar in the collective | Any calendar (`collective_set_calendar_values`, audited) | Offer, withdraw | Yes |
| Host staff | As today, except that a service on the collective page is admin-only whoever created it (see below) | None | Own managed calendars | Own calendars within flags | No | No |
| Member admin | None | Read-only; venue-controlled columns only | Own calendars | Own calendars | No | Read-only summary; leave |
| Member staff | None | Read-only | Own managed calendars | Own calendars within flags | No | No |
| Engine | Reads | Writes host-controlled columns and children | Only when a host admin asks | Only when a host admin asks | Writes offerings and replica links | No |
| Clients through PostgREST | Refused by triggers where locked | Refused | RLS as today | RLS as today | No | No |

**Locks.** BEFORE triggers refuse writes to replica rows, their children and managed library
objects when the replica belongs to an active membership of an active replicas-mode collective,
unless the engine flag is set. They raise a dedicated SQLSTATE that the shared error helper maps
to a coded 409. The master of an active offering cannot be deleted outside the engine (RT1-5). A
member cannot link its own services to a managed add-on group or require a managed form (RT1-13).

**The tables the locks cover, named.** Leaving this to "their children" is how RT1-13 got half
fixed. The trigger list is `service_items`, `service_variants`, `addons`, `addon_groups`,
`compliance_types`, `compliance_type_versions`, `service_categories`, and the three link tables
that the first draft's phrasing misses because they are join rows rather than children:
`service_addon_groups`, `service_compliance_requirements` and `calendar_service_assignments`.
`calendar_service_assignments` is in the list for one column only: the trigger refuses any change
to `service_item_id` on a row whose service is a locked replica, so a row cannot be re-pointed.
Inserting and deleting a member's own rows stays open to the member's own routes, because §6.7
makes the member the owner of that choice, and the host writes them only through
`collective_set_calendar_offering`. A literal lock on the whole table would refuse the member's
own tick on Calendar Availability, which R10 requires.
`service_addon_groups` matters most: its RLS policy checks only the row's own `venue_id`
(`20261201120000:206-209`), which the member sets, and `addon_group_id` has no venue-consistency
check, so a direct PostgREST insert links a member's own service to a host-managed group. RT1-13's
route guard and hidden picker do not reach that path. The same venue-consistency composite FK that
I13 and I15 currently only report on should be added for real.

**"Unless the write is an FK cascade" is under-specified, and has been removed above.** It is not
a hole so much as a clause nobody can act on: PostgreSQL gives a trigger no reliable way to tell a
referential action from a user write, and `pg_trigger_depth()`, the nearest approximation, fires
for every other trigger-driven write too. So whoever builds it will either find it impossible or
implement it as "any nested write", which is much wider than intended, and the difference will not
be visible in review. Decide what it means before the trigger is written.

The case that makes it concrete is small and benign, which is why it is worth naming:
`service_items.category_id REFERENCES service_categories(id) ON DELETE SET NULL`
(`20270202120000:52-54`), so a member deleting one of their own unmanaged headings issues a
referential update against a locked replica. Nothing harmful follows from that particular write.
The point is only that the exemption has to be an enumerated allowance rather than a blanket one:
a diff confined to `category_id` becoming NULL, and nothing else. DB-03 gains a case proving a
member's own heading delete cannot change any other column of a locked replica.

**A member can still withdraw a calendar silently, by deleting it.**
`calendar_service_assignments.calendar_id REFERENCES unified_calendars(id) ON DELETE CASCADE`
(`20260430120000:117`), so deleting a calendar deletes the host's per-calendar terms with it, and
§6.6 makes assignments the only truth, so the offering quietly loses a provider. No existing
invariant catches it: I2 checks that a replica link exists, I4 is legacy-only and runs only from Pass B to
C1, and I13 catches wrong-venue assignments rather than absent ones. An AFTER DELETE trigger on
`calendar_service_assignments` writes a `collective_audit_events` row and bumps the catalogue
revision whenever the row belonged to a live replica, and invariant I33 reports any live replica
with no assignment at its own venue.

**Route guards** (friendly answers before the database refuses):

- `PATCH /api/venue/appointment-services` on a replica never calls the service update,
  `replaceServiceVariants` or `replaceServiceAddonGroupLinks`. It builds the replica's projection
  with the same normalisers the route uses (payment rule, location, booking start, canonical shape,
  add-on links as an ordered list of ids, options by id), refuses a real difference with
  `COLLECTIVE_MANAGED_SERVICE` before any write, and otherwise applies `practitioner_ids` and
  venue-controlled columns only (RT1-6, RT2-19). The guard and the `STALE_RESOURCE` check run
  before any assignment write. The four edits to this route land in the order W2 (diff writes
  that preserve every custom and attribution column, so a host save can never null the five D5
  columns), W8 (the five columns themselves), W6 (this guard, which runs before the assignment
  diff is written) and W5 (`collective_calendars` and `collective_sync`); the route accepts both a
  full `practitioner_ids` set from an older build and `expected_calendar_ids` with
  `calendars { add, remove }`, and diffs a full set against the current rows (§8.3).
- `DELETE` of a replica: `COLLECTIVE_MANAGED_SERVICE`; of an offered master:
  `COLLECTIVE_OFFERED_SERVICE`.
- Add-on group routes (including `PUT /api/venue/addon-groups`, which the first design missed),
  compliance requirements and types: `COLLECTIVE_MANAGED_ADDON_GROUP`,
  `COLLECTIVE_MANAGED_COMPLIANCE_TYPE`.
- Import undo skips replicas and offered masters, checks every error and tells the user what was
  kept (RT1-5, RT2-21).
- A registry test lists every writer of the service tables (the red team's inventory) and fails
  when a new writer appears without a guard or an allowlist entry.

**Staff authority and contacts** (D17 as amended by D41, RT2-12, RT2-13). Collective staff booking
is authorised by collective role, audited in the collective booking audit, stamps the acting venue,
and notifies the owning venue.

Contacts work differently from the first pass's recommendation, because D41 settled the question it
was hedging. Inside a live collective, shared client access **is** the arrangement, so the staff
form does not clear a picked contact and does not force details to be typed. It searches across
every active member venue, shows the owning venue on every result, and writes the booking against
the record that already exists rather than creating a second one at the acting venue. The typed
details rule survives only outside a live collective, where a pairwise link may or may not share
client details.

Two consequences follow, and both are new work:

- **The contact search has to reach across venues.** `/api/venue/guests` is scoped to
  `staff.venue_id` on every query (`route.ts:150,237,285,317`), so today there is no cross-venue
  search at all: a partner's client is reachable only per guest, through a shared diary booking.
  The list, the search and the contact picker all need an explicit "in this collective" scope, with
  the owning venue named on every row and a hard refusal for any venue outside the live collective.
- **Ownership still never moves.** A record found this way belongs to its own venue, is edited
  under that venue's name, and is counted in that venue's reports. The access itself comes from
  the account link, not from the collective.

Nothing is offered for downgrade, at migration or at any other time, and nothing is ended when a
membership ends: the account links belong to the venues, not to the collective (D41). What ends
with the membership is the collective's own functionality: the "in this collective" contact
search scope, the collective staff form and the collective view of the reports. Everything an
account link grants on its own (a partner's bookings in the diary, create, edit and cancel at the
other venue, per-guest access through a shared booking, linked revenue) carries on exactly as it
does for any two linked venues.

**Host staff and the creator exception.** The seven `staff_may_customize_*` flags gate two
different things, and the second one is a hole in host control. Besides saying what a calendar
may vary, they say which fields a non-admin may change on the venue-wide service row of a
service that staff member created (`STAFF_SERVICE_FIELD_PERMISSIONS`,
`src/app/api/venue/appointment-services/route.ts:91-99,420-446`; creator check at
`:1256-1262`), and any staff-created service stores all seven as `true` (`:918,939-945`). So a
host staff member who created a service before the collective existed would keep the right to
rewrite what every member sells. Offered masters are therefore admin-only to edit, whoever
created them: the creator check is skipped for a service with an active offering, the card says
why, and the flags keep their per-calendar meaning only. This is a guard, not a lock, because
the row is the host's own; the database lock is on replicas, not masters.

**Grants.** The five engine tables (`collective_service_replicas`,
`collective_catalogue_revisions`, `collective_audit_events`, `collective_operations`,
`collective_column_classes`) and their sequences hold no client privileges; CI's
`local_baseline_grants.sql` (which lives under `supabase/scripts/`, not with the migrations)
excludes them, otherwise CI re-grants what the migration revokes;
`check-table-grants.mjs` asserts it on each hosted environment after every push.

### 6.6 Booking engine

- **One resolver.** `resolveCalendarServiceTerms(serviceRowWithFlags, assignment, variant,
  addons, staffCustomLength)` owns precedence and flag gating: option, else calendar value while
  the flag is on, else service value; add-on minutes and prices on top. Its callers: the unified
  engine loader, the month loader, the venue and combined catalogues, day, month and chain
  availability, validate-slot, every create route, the visits services route, waitlist conversion,
  staff modify, guest reschedule, email enrichment, the payment batch resolver and import defaults.
  Four more readers were missed in the first pass and must be on the list, because each reads a
  custom value today: `src/lib/availability/appointment-chain-server.ts:95,145-152`; the parity
  harness `src/lib/availability/parity/scheduling-world.ts:159-160`; and the two client-side
  merges this bullet's last sentence retires,
  `src/app/dashboard/appointment-services/AppointmentServicesView.tsx:1143-1148` and
  `src/app/dashboard/appointment-services/StaffServiceOverrideModal.tsx:78-81`. Name them
  explicitly, because TERMS-04 sweeps for custom-value reads outside the resolver and cannot
  pass against an unwritten allowlist.
  One reader is a deliberate exemption rather than a caller:
  `src/lib/unified-availability.ts:347-352` writes `custom_duration_minutes` as a **forced
  length for resource calendars**, not as a stored override. Either rename that field so it no
  longer collides with a CSA column name (preferred, it is a local variable name) or exempt it
  by name in TERMS-04.
  Their local precedence code is deleted (RT2-5). `GET /api/venue/appointment-services` returns
  effective, gated values so neither the web card nor the app merges client-side; today it
  returns raw customs plus five hard-coded nulls (`:666-684`), which is why an old app build
  that keeps merging locally would show values the flags no longer allow.
- **The deposit needs a path, not just a column.** Of the five fields D5 adds, four are new
  storage; the deposit also needs the resolver to apply it (`appointment-engine.ts:1552` reads
  the service row only, while the price on the line above already honours a custom value) and
  needs the 1.00 card-hold floor moved off the route's dead legacy branch
  (`practitioner-service-overrides/route.ts:294-306`, `:166-167`) into the resolver, so it runs
  wherever a deposit is set.
- **Delete the base-price override.** `resolveCollectiveServiceOverride` returns attribution only;
  single, staff and group creates stop charging the base price and reserving the base length
  (CB-02).
- **Derived combined catalogue.** Offerings with an active master; the master at the host and the
  converged replica at each member; one provider per calendar that has an assignment, with that
  calendar's own values (CB-01, CB-03). Exclusions for the public audience: venues whose Stripe
  cannot take charges for paid services, members with compliance switched off for services with
  forms, suspended members, behind replicas. Staff keep those calendars with a note ("Card
  payments are not set up at {venue}, so take payment in person.").
- **Parked services (D2, revised 2026-09-14).** While a venue is live in a collective (its
  membership `active` and not suspended, the collective `active`, not paused, in replicas mode and
  live, as the one live-collective resolver answers it), its bookable appointment catalogue is the
  collective's offerings only: at the host, the masters of active offerings; at a member, the
  replicas of its live replica links. Every other appointment service at that venue is parked: not
  listed or bookable in any staff form, diary, walk-in flow, availability read or public page, and
  refused by every create route. That includes a master whose offering the host withdrew, a
  member's same-named service kept separate at join (D1) and any service created while live (a
  venue may still create and edit its own services; they are simply parked). Parking is derived
  from state, exactly like D3's redirect rule: no `is_active` change, no stored list, nothing
  written at join or release, so it lifts by itself the moment the membership ends, the member is
  suspended, the page pauses or the collective dissolves. It does not wait on convergence or
  listing, so a service never flickers between parked and bookable while a replica catches up.
  Existing bookings on a parked service stay fully manageable: view, staff modify within the same
  service, cancel, guest self-reschedule, payments, reminders and reports all work as before, so
  the exclusion sits where a service is offered for a new booking and never on a path that serves an
  existing one. Classes, events and resources are untouched (§6.14).
- **Staff bookings only (`is_bookable_online`).** `service_items.is_bookable_online` (default true,
  `20260430120000_unified_scheduling_engine.sql:104`) is read nowhere in the booking path today: its
  only reader is the anon RLS policy at `:398`, which the admin-client public path bypasses. W4 wires
  it: a service with `is_bookable_online = false` appears in the staff form (the collective staff
  form, for an offered service) but not on any public page, public availability read or public
  create route. The host sets it on the service page ("Staff bookings only",
  `svc.form.staffOnly.label`); it is host-class in the column registry (Appendix F), so replicas
  follow. Honouring the column changes behaviour on every venue, not only in collectives, so the W0
  production survey counts rows with `is_bookable_online = false` first and reports them before W4
  ships.
- **Price snapshot, read where money is settled** (RT2-1). The snapshot is the first fallback
  after a stored total in `resolveBookingTotalPence`, `resolveBookingTotalPenceFromRow` and
  `loadRowTotalResolver`, and is selected by the visit payment picture, the charge route, booking
  detail and summary, templated emails, the booked revenue report and a new version of
  `staff_booking_detail_bundle`. Pass A backfills every non-cancelled appointment booking at every
  venue, past and future, before any apply, so no report or balance moves when a host edits a
  price.
- **Forms on member calendars** (RT2-2). For a chosen calendar the requirements lookup serves the
  owning venue's own managed type and version and names that venue for uploads, exactly as today.
  For "Any available", inline forms are collected once the calendar is fixed.
- **Pre-booking form uploads can land at the wrong venue.** On "any available" the calendar is not
  yet known, so `resolveCollectiveRequirements` merges every providing venue's requirements and
  draws the forms against the first venue that has any, which is also where the upload goes
  (`api/public/compliance/booking-requirements/route.ts:52-57,105-124`). A guest can therefore
  complete a patch test that files at venue A and then be booked on venue B's calendar, which now
  has no record and either asks again or proceeds believing it has one. This is a correctness and
  safety problem, not a privacy one: the venue that needs the record is not the venue that holds
  it. Fix it by collecting inline forms once the calendar is fixed, which §6.6 already requires for
  a different reason (RT2-2), and by naming the receiving venue wherever a form genuinely must be
  served before the calendar is known. SEC-03 covers it.
- **What this is not.** An earlier draft of this section called the same route a cross-venue health
  oracle. That was wrong and is recorded here so nobody re-raises it. The response merges by form
  type, worst state wins, into one list with no per-venue breakdown, so a collective query says
  only "somewhere in this group this email does or does not hold a current record" and never says
  where. Every member's own booking page is live by default and answers the same question more
  precisely for that one venue, so the collective endpoint is less informative than what is already
  public, not more. The underlying single-venue exposure is deliberate and the route says so in its
  own docstring ("with an email it reveals whether that address has a record on file, the same
  exposure the old POST pre-check had"). It is a platform decision already taken, and nothing about
  collectives changes it.
- **Groups** (RT2-11, D28). Later people in a group are limited to calendars at the first person's
  venue, with the explanation shown before the details step, unless the owner chooses split groups.
- **Staff visits and groups** require a staff session and stamp the actor (CB-23, CB-26).
- **Availability fixes** that also apply today: variant-aware collective day and month
  availability (CB-08) and real booking windows on chains (CB-09).

### 6.7 Lifecycle

- **Create.** Exclusivity, same currency and timezone; replicas mode for new collectives only once
  a platform flag is switched on after the staging soak (RT2-28). The page stays unavailable until
  two venues are active and a service has a calendar.
- **Invite.** Adds exclusivity, currency, timezone and the invitee's own plan eligibility (CB-31);
  warns when the invitee cannot take card payments or has forms switched off. The host may withdraw
  an open invitation from the Collective area's Venues tab: the row goes `removed`, History shows
  `history.inviteWithdrawn`, the invitee's admins get one plain email (N34: the invitation was
  withdrawn and nothing has changed for them) and the invitation link shows `invite.closed`. An invitation not answered in 30 days expires (CB-30, DL8):
  the row goes `removed`, N1 is sent again as a reminder at day 7, N35 tells the invitee and the
  host, and History shows `history.inviteExpired` (LIFE-12).
- **Accept (join).** A disclosure and a recorded consent version are required; an accept without
  `consent_version` is refused with `COLLECTIVE_CONSENT_REQUIRED` ("Please open ResNeo on the web to
  read what joining means, then accept there."), which also covers old app builds (RT2-8). The
  member then chooses, per same-named service, "Add the host's as new" (default) or "Use mine",
  which opens a reviewed adoption: option mapping, before and after preview of price, length,
  deposit, payment rule and forms, and snapshots of that service's bookings in the same
  transaction (RT2-20). Member-only services: "Park it until I leave" (default) or "Ask the host to
  add it" (RT2-10; D2 as revised on 2026-09-14). Parking is derived (§6.6), so choosing it writes
  nothing; "Ask" sends N28. The earlier third choice, "Keep for bookings your team makes", was
  withdrawn on 2026-09-14. (This document calls the state *parked*, so that "paused" keeps one
  meaning, the page after the host leaves.) A member holding a form from the
  same library template chooses "Use your existing form" (default). Forms must be switched on at
  the member for form-bearing offerings to be bookable at its calendars (D10, RT2-6, §6.6), and the
  join dialog says so; the product never flips the member's compliance flag itself, at join or at
  migration (§7). Accept still requires the full account-link mesh, as today, and creates or changes
  no account link (D41, DL6); because leaving and dissolving leave the links in place, a re-form is
  one invitation and one acceptance anyway. New replica
  links start behind and stay out of the catalogue until they converge (RT1-11).
- **Offer or withdraw a service** from the host's Services page. Withdrawing retires replicas
  (inactive, calendar choices kept, reactivated on re-offer), and the host's master stays active but
  is parked while the collective is live (D2, §6.6); guests can still move their existing
  bookings on retired replicas online (RT2-27). Deleting an offered master is refused.
- **Host-initiated adoption, "Add from another venue".** The host picks a member's service on its
  own Services page. The engine copies it into a new host master (the registry's host-controlled
  columns), offers it, and records a pending adoption for that member. The member is asked
  (`svc.member.adopt.*`, N26) to choose "Use mine", in which case its service becomes the replica
  with its options mapped, or "Keep mine separate", in which case a new replica is created and the
  member's own service stays its own and is parked while the member is live (D2). No answer after
  14 days defaults
  to "Keep mine separate", with a reminder at day 7. The route is
  `POST /api/venue/collectives/[id]/offerings { source_venue_id, source_service_id }` and the
  answer `POST .../adoptions/[itemId] { choice, option_map }` (Appendix E); test OFF-06.
- **Host adds or removes a member calendar** from the service page, the Collective area's grid or
  the shimmed catalogue action. All three call one `service_role` function,
  `collective_set_calendar_offering(p_collective_id, p_item_id, p_venue_id, p_calendar_id,
  p_action, p_actor_venue_id, p_actor_user_id, p_acknowledge_affected boolean DEFAULT false,
  p_now timestamptz DEFAULT now())`, which is the only writer of another venue's assignment rows;
  `p_acknowledge_affected` is how the route says the host has seen the affected-bookings result
  before a removal. Under the shared collective lock it checks that the actor venue hosts an active
  replicas-mode collective, that the target venue is an active member, that the calendar belongs to
  that venue, that the offering is active and that a replica row exists at that venue; it then
  upserts or deletes the (calendar, replica) assignment, writes `updated_at`, `updated_by_venue_id`
  and `updated_by_user_id`, writes the audit row with the before-image, bumps the catalogue
  revision, and raises `COLLECTIVE_NOT_HOST`, `COLLECTIVE_VENUE_NOT_MEMBER`,
  `COLLECTIVE_CALENDAR_NOT_AT_VENUE` or `COLLECTIVE_REPLICA_NOT_READY`, which the routes check for
  first and answer as coded 409s (the function's own raises are defence in depth, §6.4). Before a
  removal the route runs the affected-bookings check with the member's venue id and the replica's
  id and shows the result without client names. The member is told (N11). A calendar whose venue
  has left cannot be reached: the membership row is no longer active, and the release lock is
  exclusive against this one. Today's only cross-venue writer, `addCalendarToOffering` through
  `linkCalendarToService` (an upsert with host, active-member and calendar-at-venue checks), is the
  seed for this function, not something to write from nothing.
- **Member ticks or unticks** its own calendars on Calendar Availability, and a member admin may do
  the same from `MemberServiceView`; the page follows at once; the host is told (N12). Both writers
  are diffs: the calendar-side PUT carries `expected_service_ids` and the service-side PATCH carries
  `expected_calendar_ids`, each compared with the current rows in the same transaction as the write,
  and a mismatch answers 412 `STALE_RESOURCE` without writing. Kept rows keep their id and every
  custom and attribution column; only added rows are inserted and only removed rows are deleted. A
  client that sends no expected set (an older app build) is refused only when its set would remove a
  row another venue wrote in the last 24 hours; after that window the loss is accepted, and written
  down as accepted, until every build sends expected ids. Assignment rows are not covered by the
  replica lock beyond their `service_item_id` (§6.5): a member writes its own rows through its own
  routes, the host writes them only through `collective_set_calendar_offering`, and I13 becomes a
  constraint so no row can ever pair a calendar with another venue's service. The member's PUT
  takes no collective lock; the ordering guarantee comes from the expected-ids check being atomic
  with the write, not from the collective's advisory lock, and it should stay that way so a member
  save never waits on the host's engine.
- **Leave, removal, link-cascade removal.** The status trigger calls `collective_release_member`,
  which releases the venue's replica links in the same transaction: `released_at` is set and the
  rows are kept, the locks lift, and managed library objects become the member's own. **Every
  released service stays** (D52): it was a real service the member was offering, so it keeps its
  settings, calendar choices and bookings. Active ones stay active and are listed on the member's
  own page once that page shows; ones the host had retired stay inactive, listed with the member's
  other inactive services (DL2); services that were parked while the venue was live are bookable
  again at once, because parking is derived and ends with the membership, and the review panel
  names them (`review.unparked`, DL3). Nothing is deleted at release. Where the member kept a same-named original
  separate at join (the D1 default), both stay active, the released one carries
  `svc.member.card.cameFrom` ("Came from {host}") for 30 days, and the review panel lists the pairs
  (`review.sameName`) with no merge action, because a merge is Tier 3 (LIFE-11). The library
  follows the same rule: a managed heading, add-on group or form becomes the member's own beside
  any same-named one the member already had, the review panel names each pair (`review.library`),
  and a merge is Tier 3. Inside the same transaction, for a member without charges-capable Stripe,
  released services that take payment have their payment rule set to none, with the old values
  audited as `payment_rule_downgraded` and a "Review your services" checklist queued (RT2-9), so a
  released paid service is never bookable at checkout-failing terms for even a moment; and adoption
  of the member's address is cleared. After commit: photos are copied as objects into the member's
  storage (RT1-15); the released service keeps the host's photo URL until the copy lands, and after
  the last retry the photo is cleared and `review.photos.failed` names it; notices go to live
  members only. Replica link rows are kept, so a re-join can offer "Reconnect your previous
  services" (RT2-27): the reconnect is offered by the same host only, and is reviewed like an
  adoption when the member changed the released service in between (DL5).
- **Account links are untouched** (D41, owner, 2026-09-14). A collective is extra functionality on
  top of account links with full access, so leaving, removal and dissolve change only the
  collective. `collective_release_member` never writes `account_links`, and neither does any other
  engine function or collective route. After the membership ends, the venue's account links, and
  everything they grant, carry on exactly as they did before and during the collective: seeing a
  partner's bookings in the diary, creating, editing and cancelling bookings at the partner venue,
  per-guest access through a shared booking, and linked revenue where the link grants it. What stops
  is the collective's own functionality: the collective page, the collective staff form, the "in
  this collective" contact search scope (§6.5) and the collective view of the reports (§6.15). The
  leave and removal dialogs say so (`leave.body.access`), and offer no link choice (DL12), because
  managing an account link stays on Linked accounts, where it always was. Today's code already
  behaves this way: leave, removal and dissolve only flip the membership row
  (`collectives/[id]/members/route.ts:189,280` and `collectives/[id]/route.ts:259-263`). The
  reverse direction is unchanged too: ending or narrowing an account link below the full-access
  mesh still removes the member, as the link-cascade removal above describes.
- **Dissolve.** Runs `collective_dissolve`, the one path shared by the host's DELETE and both crons
  (host lapse at day 30, D22; paused at day 30, D35). It releases every member in one transaction
  through the same status trigger as a leave, leaves every account link as it is, sets open
  invitations `removed`, archives offerings, and old `/book/c/{slug}` links show a
  neutral page listing each former venue's own booking page for 90 days (members can opt out)
  instead of a 404 or a redirect to the host (RT2-22, D25). The same host may reclaim the old
  address early for a re-formed collective, and the neutral page then redirects there (DL4). After
  the end, the collective view of the reports goes; each venue keeps the "via {collective}" filter
  for its own bookings, and what it sees of other venues follows its account links, as for any
  linked venues (DL11, §6.15; REP-06).
- **Host transfer.** A request that the candidate's admin accepts with consent; members get notice
  and a free-leave window (RT2-23). The window has rules: the host may cancel until the day; the
  candidate may decline; a candidate that leaves cancels it; a second request while one is pending
  is refused (409 `COLLECTIVE_TRANSFER_PENDING`); on the day, if any replica link is behind, the
  move waits and retries daily for 7 days, then cancels; either way N22, the notice that says
  whether hosting moved, carries the outcome. `collective_transfer_host`
  re-keys every `replica_of_*` mapping at every member, sets mappings on the old host's former
  masters, clears them on the new master, and asserts every fingerprint matches before commit
  (RT1-2, RT2-4); it is the one writer the `host_venue_id` trigger lets through. When a link change
  removes the host, or the host's subscription lapses, the page pauses (`paused_at` on status
  `active`, no new status value, DL9); while paused a member may Leave or Take over, and the
  take-over runs `collective_transfer_host` with no 14-day wait; after 30 days paused the
  collective ends through `collective_dissolve`. LIFE-13 covers the paused state and the transfer
  window. Transfer ships in the first release (D12, decided 2026-09-14).
- **Member lapse.** The subscription cron that already handles link expiry
  (`src/app/api/cron/account-link-maintenance/route.ts`) sets `venue_collective_members.suspended_at`
  when the member's subscription lapses and clears it when it resumes (N36, N37; NOT-01). While
  suspended the member is hidden from the collective page at read time and its own page shows; its
  replicas stay locked and in step. After 30 days suspended the member is removed through the release.
- **Host lapse.** The page pauses and members' own pages show again; after 30 days the collective
  dissolves through `collective_dissolve` (D22).
- **Venue deletion.** `admin_hard_delete_venue` calls `collective_release_member` (a member) or
  `collective_dissolve` (a host) explicitly, before `terminate_account_links_for_venue_deletion`
  and before `DELETE FROM venues`, because a cascade fires no status trigger (CB-16, DB-09). The
  replica link table's FKs on `collective_id` and `member_id` are `ON DELETE CASCADE` for whatever
  the explicit call leaves behind.
- **RLS access ends with the row.** Former and declined members lose RLS read of the collective the
  moment their row leaves `active`: `current_staff_collective_ids()`
  (`supabase/migrations/20270202140000_collective_policies_no_recursion.sql:41-49`) counts
  membership of any status today and must filter on `status = 'active'` (CB-40, fixed now).
- **Reconcile** never mutates on page renders; mutating reconciles run from routes and crons
  (CB-15). Every membership, status and host writer goes through lifecycle functions, pinned by a
  registry test (RT1-4).
- **Guest self-reschedule on a released service that is inactive** is allowed: the guest
  reschedule path checks the variant's active state but never the service's `is_active`
  (`src/lib/booking/guest-actions/reschedule.ts`, verified 2026-09-14: the file has no `is_active`
  read; the variant check is at `:698-702`), and nothing in this design adds one, so a guest with a
  booking on a retired-then-released service can still move it online, as RT2-27 wants.
- **Legacy provider rows during Pass B to C1.** While `collective_service_providers` still exists,
  a leave, removal or dissolve sets the venue's provider rows to the same status the release gives
  its replica links (`removed`), as today's leave already does through reconcile
  (`src/lib/linked-accounts/collectives.ts:616-644`); I4 and I37 watch them until C1.

**The lifecycle as a state machine.** Three things carry state: the collective, each membership,
and each replica link. Every transition below is made by one lifecycle function, pinned by the
registry test (LIFE-07); nothing else writes `venue_collectives.status`, `host_venue_id`,
`venue_collective_members.status` or a replica link row. "In the transaction" means the same
database transaction as the status change, so no observer can see one without the other. "After
commit" means a `collective_operations` job with an idempotency key, retried until done, and
visible as a pending item until it is.

**The collective** is `active`, `paused` or `dissolved`. `paused` is `active` with `paused_at` and
`paused_reason` set, kept off `status` so that every existing "active" read keeps working and the
30-day clock has somewhere to live (DL9). A pending host transfer is likewise `active` with
`pending_host_venue_id` and `host_transfer_at` set.

| From | To | Who or what | In the transaction | After commit | Told |
|---|---|---|---|---|---|
| (none) | active | Host admin, create | Collective row, host row `active`, one `invited` row per venue, `service_model` from the platform setting (D37) | Invitations | Invitees (N1) |
| active | active, transfer pending | Host admin asks a member to host and the candidate's admin accepts with consent (`offer_host`, `accept_host`) | `pending_host_venue_id`, `host_transfer_at` (14 days on); a second request while one is pending is refused (409 `COLLECTIVE_TRANSFER_PENDING`) | Nothing | Members, with the free-leave window (RT2-23) |
| active, transfer pending | active | The host cancels (`cancel_host_transfer`); the candidate declines or leaves; the move is still behind after 7 daily retries | Clear the two pending columns | Nothing | Members (N22) |
| active, transfer pending | active, new host | The day arrives and no replica link is behind (`collective_transfer_host`) | Re-key every mapping; `host_venue_id`; clear the two pending columns | Applies drain | Everyone (N22) |
| active | paused | A link change removes the host; the host's subscription lapses | `paused_at`, `paused_reason`; on a link break the host's row goes `removed` and `collective_release_member` pauses the collective instead of releasing anything; on a lapse the host's row stays `active` with `suspended_at` and the lapse cron sets the pause; replicas untouched and still locked | Nothing | Members (N23) |
| paused | active | A member accepts hosting (`collective_transfer_host`, no 14-day wait); the host's subscription resumes | Re-key every mapping; clear `paused_at` | Applies drain | Everyone (N22) |
| paused | dissolved | 30 days paused, by the `collective-verify` cron | As "active to dissolved", through `collective_dissolve` | Same | Same |
| active | dissolved | Host admin ends it; the `collective-verify` cron when active membership cannot reach two or the host has lapsed 30 days; both through `collective_dissolve` | One statement sets every `invited` row `removed` and every `active` row, the host's included, `left`; each row's trigger releases that venue (below); offerings `archived`; `dissolved_at`; the address is kept for the neutral page, not tombstoned | Photo follow-ups per member; the neutral page serves for 90 days | Live members (N19); the host's history row |
| dissolved | (none) | Nothing. A dissolved collective is history; a new one is a new row | | | |

**A membership** is `invited`, `active`, `left` or `removed`; `suspended_at` is a flag on
`active`, not a state.

| From | To | Who or what | In the transaction | After commit | Told |
|---|---|---|---|---|---|
| (none) | invited | Host admin, at create or later | Exclusivity, currency, timezone, plan, booking-model and multi-venue-person checks | Invitation | Invitee (N1) |
| invited | removed | Invitee declines; the host withdraws the invitation; the invitation is 30 days old (cron) | Status only | | Host (N2) on decline; the invitee's admins on withdrawal (N34; the invitation link shows `invite.closed`); invitee and host on expiry (N35), after the N1 reminder at day 7 |
| invited | active | Invitee admin accepts with `consent_version` | Status, `joined_at`, consent; one replica link per active offering, `provenance` `created`, `adopted` or `reconnected`; adoptions and reconnects snapshot their bookings; forms adopted; no account link created or changed (the full mesh is a precondition, D41) | Applies drain; N4 when converged | Host and members (N3) |
| active | left | Member admin leaves; the host ends the collective | The release (below) | Release follow-ups | Host and members (N16), or N19 |
| active | removed | Host admin removes; a link change breaks the mesh (cron or link route, never a render) | The release | Release follow-ups | The venue (N17 or N18) and the host |
| active | active, suspended | The member's subscription lapses (cron) | `suspended_at`; nothing else; replicas stay locked and in step; the member is hidden from the page and its own page shows | | The member (N36) |
| active, suspended | active | The subscription resumes (cron) | Clear `suspended_at` | | The member (N37) |
| active, suspended | removed | 30 days suspended (cron) | The release | Release follow-ups | The venue, the host |
| any | (row deleted) | The venue is hard-deleted | `admin_hard_delete_venue` calls the release (member) or the dissolve (host) explicitly before `DELETE FROM venues`, because a cascade fires no status trigger | | Link partners |

**The release**, run by `collective_release_member` from the status trigger for every row that
stops being `active`, whichever transition caused it. This is the one list of what is inside the
transaction and what is not. **Inside the transaction:** set `released_at` on the venue's replica
link rows (never deleted: the row is the reconnect identity, which is what "replica identities
are kept" means, and I5 counts only rows with `released_at` null); lift the locks by absence;
clear `managed_by_collective_id` on the venue's managed headings, groups and forms and set their
`replica_of_*` to null; keep `accepts_records_from_type_id`, whose FK is `ON DELETE SET NULL`;
**every released service stays as it is** (D52), active ones active and retired ones inactive
(DL2), with `svc.member.card.cameFrom` for 30 days on any that shares a name with a service the
member kept separate at join; nothing to un-park, because parking is derived and ends with the
membership (DL3); lift the
compliance "locked on" flag; reset `adopted_venue_id` and `slug_strategy` if this venue's address
was adopted, because the adopt claim never checks membership and a follow-up job would leave the
departed member serving the page in the meantime; set the payment rule to none on released paid
services at a venue without charges-capable Stripe, audited as `payment_rule_downgraded` (RT2-9);
one `member_released` audit row per side. **Never inside the release:** any write to
`account_links` (D41). **After commit**, as `collective_operations` jobs: copy
photos as objects (the released service keeps the host's photo URL until the copy lands; after the
last retry the photo is cleared and `review.photos.failed` names it); queue the review checklist
(prices, same-name pairs, Stripe, library pairs, photos, services no longer parked); send the notices.
Nothing a guest can book against waits for a follow-up job, which is why a member's own page can
show from the first request after the release commits (§6.9).

**A replica link** is `behind`, `current`, `failing`, `retired` or released; a live replica link
never outlives its membership (I5). It is created `behind` at join, offer and reconnect; `current`
after an apply that read the latest revision; `failing` after an apply error, with backoff;
`retired` (replica inactive, calendars kept) when the host withdraws the service or turns the
master off, and `behind` again on re-offer; re-keyed in place by a host transfer; and released
(`released_at` set, row kept) by the release. "Behind" is I3b, `applied_revision <
desired_revision`; "drift" is I3, marked current with a fingerprint that differs, and is never lag.
The catalogue lists a calendar for an offering only when its replica link is `current` and its
membership is `active` and not suspended.

**What today's code does with the host's own row at dissolve is inconsistent**, and the design
picks: the route path sets it `left` (`collectives/[id]/route.ts:259-263`) while the reconcile
path leaves it `active` (`collectives.ts:536-554`). The host's row goes `left` like everyone's, so
one release trigger handles every venue the same way (DL10).

**Former partners keep what their account link grants, by design.** `linked_venue_can_delete_bookings`
(`20260919120000_linked_accounts.sql:593-599`) and the guest-document delete scope
(`src/lib/guests/linked-guest-access.ts:85-87`) give a linked venue rights over the other venue's
bookings and client documents for as long as the account link lasts, and a collective ending does
not end the link. That is the owner's rule (D41): a venue that leaves a collective can still make,
edit and cancel bookings for the venues it is linked with. An earlier draft treated this as a
defect (SB-42) and planned an interim workstream, W7a, to end the links; both are withdrawn. LIFE-14
now guards the opposite: that leave, removal and dissolve leave every account link untouched.

### 6.8 Pages at a glance

Full detail, states and copy: `Docs/collective-one-venue-ux-spec.md`.

| Page | Host | Member |
|---|---|---|
| Services | Banner "You host {collective}"; a "Collective" pill on offered services; the "Show on the {collective} page" switch (`svc.card.onPageSwitch`); the service page (`/dashboard/appointment-services/[serviceId]`, a page rather than a dialog) lists every venue's calendars in groups with per-calendar values and per-venue update status, and one collective strip at the top owns the only Retry; a price or form change asks first and lists what changes; the save summary and the 60-second "Put it back" (D50) render under the page header in a status region, never in the error slot; "Add from another venue" (§6.7); Delete blocked while offered; services not on the page carry a "Parked" pill (D2); Add service's "Show on the {collective} page" checkbox is ticked by default; "Staff bookings only" (`svc.form.staffOnly.label`) on the service page | Three sections, "From {host}" (locked; `MemberServiceView` shows values, never disabled inputs; calendar choices and venue-controlled fields editable, and per-calendar values through the values dialog with `values.help.member`), "Parked while you are part of {collective}" (the member's own services, editable, not bookable while live, D2) and "Retired" last, with a "What needs you" strip; status lines ("Setting up", "Updating", "Hidden because card payments are not set up") |
| Calendar Availability | Services grouped "On the {collective} page" and "Parked"; unticking a collective service asks first | Groups "From {host}" and "Parked"; ticking a replica puts that calendar on the page at once; unticking asks first and tells the host |
| Booking Page tab | Page design for the collective in one column with seven sections and no nested tabs, per the specification's item 10: identity, page address, look, guests, share and embed, "Who is on it" (a read-only summary linking to the Collective area's Venues tab) and "Leaving" (read-only: "To end {collective}, go to Collective, Venues."). The page shows the host's address, phone and opening hours (specification §1 C; a collective-owned set is Tier 3, §8.0). The Services section is the single card `bp.services.card`, `bp.services.count`, `bp.services.open`, linking to the Collective area; own page read-only with a status line | Read-only summary of the collective page and its own calendars there; "Leaving" says "To leave {collective}, go to Settings, Linked accounts."; a status line, `bp.status.redirecting` ("Guests who visit your own booking page are sent to the {collective} page.") or `bp.status.showing` ("Your own page is showing because {reason}.") |
| Linked accounts | Account links, and the host's own `CollectiveRow` (specification item 11) showing update health and the hosting state (`la.row.hostHealth`, `la.row.hostRequest`, `la.row.hostMoveScheduled`, `la.row.paused`); every membership action (invite, cancel an invitation, remove a member, hosting request and transfer, End the collective) lives on the Collective area's Venues tab, not here | Its `CollectiveRow` with the Join dialog (disclosure, choices, consent), a hosting request to review, the Leave dialog (`LeaveCollectiveDialog`, the only home of Leave), the review panel after leaving, "List on the old page" after a dissolve, and history |
| Add-ons, Categories, Compliance | "Collective" pills and reach lines on items used by offered services | Managed items "From {host}", view only, hidden from pickers on its own services |
| Diary | Member columns styled like own columns with a venue label; every column, own and member, plus New and Walk-in, opens the collective form | Every column, own and partner, plus New and Walk-in, opens the collective form (graft 5 revised 2026-09-14, D2; own columns no longer open the own form) |
| Combined-page manager | Removed as a separate surface. Page design stays in Settings, Booking Page (§1.5 of the specification); putting a service on the page is the Services page switch `svc.card.onPageSwitch` or the Collective area grid's `ov.bulk.offer`, calendars are the grid or the service page, and members and health are the Venues and Overview tabs. The Booking Page tab's Services section is the single card (`bp.services.card`, `bp.services.count`, `bp.services.open`) that links there; there is no read-only overview and no `bp.overview.*` | Read-only summary of the page and its own calendars on the Booking Page tab, rewritten copy |
| Collective area (new, `nav.collective`) | An area with tabs, shown to hosts and members, with its own sidebar entry after Services, per the specification's §1.5. Host tabs: Overview (per-venue health, what needs you, the undo), Services (the grid and bulk lane, through `POST /api/venue/collectives/[id]/bulk`), Venues (invite, cancel an invitation, remove, hosting request and transfer, End the collective), History | Overview, Services and History, because under D3 the collective page is the member's shop front too; Leave stays on Linked accounts |
| Reports | Booked revenue with every venue's figures named and subtotalled, the collective's own bookings separated from own-page bookings (§6.15, D49); guest contact details never appear in a figures view | Every venue's figures, named and subtotalled, with its own collective bookings identified (D49); the same rule on contact details |

**One thing the fold must not do: make setting up slower.** The specification moves service and
calendar work out of the combined-page manager and into the Services page, which is right: one
service, one screen, one place the reach is explained. But the manager it replaces has real bulk
actions (per-venue and global select-all when adding, link-all and unlink-all, "Match categories
from your venues") and the specification as first written replaces them with a single "Choose
services for the page" dialog. Counted properly, the regression depends entirely on the starting state,
which the first version of this paragraph left out:

| Starting state | Today's manager | The fold, with no bulk lane |
|---|---|---|
| Services exist only at the host | 47 interactions, 2 saves | 77 to 81, 11 to 20 saves |
| Members already have some of them | 67 to 70, 2 saves | 77 to 81, 11 to 20 saves |
| Every venue already shares the menu | **6 interactions, 1 save** | 77 to 81, 11 to 20 saves |

So "roughly 72 versus 101" is fair for the middle case only, and the earlier save count was too
kind: the offer switch is its own PATCH, so it is up to 20 saves, not ten. Two things matter more
than the arithmetic. Twenty of those 72 interactions are the link question firing once per
**calendar** rather than once per venue, which is a defect in today's manager rather than a cost of
keeping it. And the real regression is the bottom row: today's best case is six interactions,
because the manager can see that a member already offers a service, while the fold has no best case
at all, because nothing in it knows. The fold is correct and the bulk lane has to land with it, not
after it: see the specification's services grid.

### 6.9 Public pages and links

- **Members.** A member's `/book/{slug}`, `/book/{slug}/{calendar}` and `/embed/{slug}` hand over
  to the collective page only when the page is live, the member's replicas have converged and at
  least one of its calendars is listed for guests (RT2-3). Otherwise its own page shows. A member's
  own page shows from the first request after its release commits; nothing about the own page
  waits for a follow-up job (§6.7).
- **The host.** Under D3 the host's own page hands over too. The host's `/book/{slug}`,
  `/book/{slug}/{calendar}` and `/embed/{slug}` go to the collective page while the page is live
  and at least one host calendar is listed; the host has no replicas, so there is no convergence
  condition. A lapsed host's page shows its own services again while the page is paused (PUB-01
  covers the host cases).
- **The rule is derived, never stored.** The redirect follows from state (live, listed, and for
  members converged). No screen writes `solo_page_behavior`, which C2 drops (§6.3, UI-C-06).
- **Other booking models.** The handover applies to the appointments journey. A venue with another
  active model (classes, events, resources) keeps its own page serving those. The page's outer tabs
  come from `resolveBookingPageTabs` (`src/lib/booking/booking-page-tabs.ts:61-71`, called at
  `src/components/booking/BookPublicPageContent.tsx:258`) and the model tabs inside the Book tab
  from `resolveActiveBookingModels` and `publicBookTabsForVenue`
  (`src/components/booking/BookPublicBookingFlow.tsx:62-75`), so the appointments model tab is
  replaced by a card that links to the collective page while the other model tabs keep serving,
  and appointment deep links (`/book/{slug}/{calendar}`, `?service=`) redirect. `{link}` in
  `bm.redirect.otherModels` is the venue's own page address, `/book/{slug}` (D44, §6.14; PUB-05).
- Redirects keep the guest's place: `service_id` is translated to the offering, the calendar
  segment to `?calendar=`, and dates and times are kept. A link for a parked service redirects to
  the collective page's service list, so it never dead-ends (RT2-22, RT2-10; D2 as revised on
  2026-09-14, which withdrew the phone-number interstitial).
- **Adopting a member's page address** (decided 2026-09-14). The host may ask to use a member's page
  address for the collective page, but a member venue admin must confirm first. The request is
  recorded (`address_adoption_requested`) and the member's admins get N38;
  `venue_collectives.adopted_venue_id` and `slug_strategy` are written only when one of them
  confirms (`address_adopted`, History `history.addressAdopted`). Until then the collective keeps
  its own address. The release still resets an adoption when that venue leaves (§6.7), and an
  adoption already in place when an existing collective migrates stays as it is and is listed in
  the dry-run report.
- A new `/embed/c/{slug}` fixes the refused combined-page embed (CB-06); the QR code encodes the
  collective page and is named after the collective.
- Guests see who they are booking with: "You are booking with {member business name},
  {member address}" on the calendar, payment and confirmation steps; the marketing consent is
  unticked and names the business (RT2-14, PB-15).
- Book again, portal and waitlist links use one live-collective resolver (SB-19, SB-27).

### 6.10 Venue-level settings that still differ per venue

Service rows are not the only thing guests experience. Guest self-reschedule, the waitlist,
messaging and reminder timing, deposit settings, booking rules, the account sign-in
requirement, in-person payments, opening hours and closures, timezone and the Stripe account are
all per venue (RT2-25; staging already differs on the waitlist). **D32, decided 2026-09-14**, gives
each setting one of two treatments:

- **Host controls.** The host's setting applies to every venue in the collective, and to the
  collective page, while it is live. A member sees its own setting read-only with
  `reach.settings.setByHost` ("{host} sets this for {collective}..."); nothing is written to the
  member's row, and its own value applies again from the moment it leaves.
- **Each venue.** The venue keeps its own setting, and the host sees `reach.settings.differentAt`
  ("Different at {venueList}") wherever it looks at that setting.

| Setting | Stored in | Treatment |
|---|---|---|
| Guest sign-in requirement | `venues.require_account_login_for_bookings` | Host controls. The collective page uses the host's value only, replacing today's OR across members (SB-18) |
| Guest self-reschedule | `guest_self_reschedule` feature flag | Host controls (not "must match at join") |
| Waitlist on the page | `waitlist_v2` feature flag | Host controls whether the collective page offers it; waitlist entries and offers still belong to the venue whose calendar it is (D43) |
| "Any available" and the staff-first flow | `any_available_practitioner`, `staff_first_booking_flow` feature flags | Host controls, as the specification has said since its first draft |
| Communication policies: confirmations, reminders, cancellation and payment messages | `venues.communication_policies` | Each venue; messages follow the booked calendar's venue |
| SMS availability | The plan tier and a billing card, not a setting | Each venue, by nature |
| In-person payments | `venues.in_person_payments_enabled` | Each venue |
| Compliance records, class commerce | `compliance_records_enabled`, `class_commerce_enabled` feature flags | Each venue (D10; D44) |
| Booking window, cancellation notice, deposits | Per-service columns for appointments (`20260508130000_per_entity_booking_rules.sql`; `service_items.deposit_pence`) | Nothing to decide: the host already controls them through the master. The venue-level `booking_rules` and `deposit_config` columns govern table reservations, not appointments |

No setting is "must match at accept": the third treatment D32 first offered is not needed. Timezone
must match, and currency must too, though nothing enforces currency today (§5.4 "Grafted from
Option B" item 4); opening hours, closures and Stripe stay per venue by nature.

Three corrections to that inventory from the second pass, because a list that names the wrong
thing cannot be worked through:

- **"Message templates" do not exist.** `PATCH /api/venue/communication-templates` is a tombstone
  returning 410 with "Legacy template endpoint has been replaced by communication policies". The
  real store is `venues.communication_policies`, a jsonb column with a NOT NULL default, read by
  `src/lib/communications/send-templated.ts`. D32 leaves communication policies with each venue,
  per lane and channel.
- **SMS is missing from the list, and it is not a setting.** Whether a venue can send SMS at all
  turns on its plan tier and a billing card, not on anything an owner can toggle, so a collective
  can contain one venue that texts its guests and one that does not, with no treatment available
  beyond telling the host.
- **The list also owes booking models.** Which models a venue runs is the largest per-venue
  difference of all and is what §6.14 is about; D32's treatments do not apply to it, because
  the collective page can only carry one.

### 6.11 Mobile app contract

The app is a full client of these endpoints. Changes are additive, and errors keep their prose in
`error` with a new `code`.

- `GET /api/venue/appointment-services` gains `collective` per service (role, host name,
  locked fields, delegated fields, update status) and, for host admins, a separate
  `collective_calendars` list (both shapes in Appendix E, API contracts). Member calendars are never merged into `practitioner_services`,
  because the app sends that list back as `practitioner_ids`, which replaces the whole set.
- Old builds: calendar-only saves of replicas pass (the guard compares normalised projections); real
  edits get a readable 409; the one-tap accept gets `COLLECTIVE_CONSENT_REQUIRED`; a stale full-set
  calendar toggle that would remove an assignment another venue made in the last 24 hours gets
  412 `STALE_RESOURCE`; `staff-collective` `calendar_ids` includes the venue's own calendars, so an
  old build opens the collective form from every column, own ones included (D2 as revised on
  2026-09-14; the earlier omission, which sent own columns to the own form, is withdrawn).
- The catalogue builder's sync and link actions become coded answers
  (`COLLECTIVE_REPLICAS_ALWAYS_FOLLOW` for unlink, no-op success for sync).
- One error-code list, added to `src/lib/api/error-codes.ts` in W2 (today it holds no collective
  code at all): the specification's §0.5 codes plus `COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE`,
  `COLLECTIVE_REPLICAS_ALWAYS_FOLLOW`, `COLLECTIVE_HEADINGS_FOLLOW_SERVICES`,
  `COLLECTIVE_CONSENT_REQUIRED`, `COLLECTIVE_LINKS_BEHIND`, `COLLECTIVE_TRANSFER_PENDING`,
  `COLLECTIVE_UNDO_EXPIRED`, `COLLECTIVE_LEGACY_MODEL`, `COLLECTIVE_BOOKING_MODEL_LOCKED`,
  `COLLECTIVE_CURRENCY_MISMATCH`, §6.7's `COLLECTIVE_NOT_HOST`, `COLLECTIVE_VENUE_NOT_MEMBER`,
  `COLLECTIVE_CALENDAR_NOT_AT_VENUE` and `COLLECTIVE_REPLICA_NOT_READY` (409s the routes
  pre-check and the function raises as defence in depth), `COLLECTIVE_SERVICE_RETIRED` (409, a
  calendar save that ticks a retired replica, CSA-01), and the engine's six (§6.4). The full
  route contracts, including
  the new bulk, undo, history and calendar-values routes, are Appendix E (API contracts).
- Handover to the app team: consent sheet, read-only replica cards, host collective calendars list,
  all seven per-calendar values, removal of sync badges, new codes, the client version header
  (host master edits from a client without it trigger a notice), and the leave copy fix.
  `Docs/MOBILE_API.md` gains the service-management contract it has never documented: today it
  has nothing on service management: `appointment-services`, `practitioner-services`, the
  overrides route, add-on groups and the venue error codes are absent, and categories and the
  staff override flag appear only in booking context. All of its collective content is about
  booking.
- **Two contract conflicts to settle before the app team is briefed**, both found in the second
  pass:
  - **`STALE_RESOURCE` already exists, and it is a 412. Decided: reuse it at 412.** `src/lib/booking/guest-actions/types.ts:182`
    maps 412 to `STALE_RESOURCE` and the guest reschedule paths return it that way
    (`reschedule.ts:334,535,1050,1212`). This design wants the same name at 409. Do not ship one
    code with two statuses. The collective's stale-set case reuses it at 412, because the meaning
    is identical: the caller's copy of the resource is out of date. Every mention of
    `STALE_RESOURCE` in the three documents says 412; a builder who finds a 409 has found a stale
    sentence.
  - **The header is `X-ResNeo-Client`, with a capital N**, and it is already specified, in
    `Docs/Resneo_Customer_Portal_World_Class_Plan.md:905,1500,1538,1570`, as
    `X-ResNeo-Client: <platform>/<version>` with `426 CLIENT_TOO_OLD` reserved. That plan's
    standing rule is that **a missing header must be permitted permanently**, because builds
    already in the stores send none. Earlier drafts of the two companion documents spelt it
    `X-Resneo-Client`, which would simply never match; all three now use the existing spelling.
    Use the existing spelling and the existing rule; notifying a host
    when a master is edited from a client that sends no header (N27) is compatible with it,
    because a notice is not enforcement, but nothing in this project may refuse a request for a
    missing header.
- Beyond the two additions above, the redesign changes the app's reads in ways that are **not**
  purely additive and need calling out in the handover: the five `custom_*` fields that are
  hard-coded null today start carrying values (`appointment-services/route.ts:680-684`); contract
  pass C2 removes `sync_state`, `synced_at` and `synced_from_service_id`; and the affected-bookings
  409 payload must not carry client names when the bookings are at another venue.

### 6.12 Help centre and documents

- Rewrite: `getting-started/linked-venues`, both services articles, `appointments/calendar-setup`,
  booking widget, public booking page, deposits, importing data, and the app's availability and
  venue settings articles; add a new article on running services as one collective, which explains
  parked services and "Staff bookings only". No em-dashes.
- Amend the linked accounts spec §1, §2, §7.1 to §7.8, §8.7, §10.2, §13 and §15.6, PRD §3.10 and
  its glossary; mark `Docs/collective-service-sync-plan.md` superseded; update the Docs index; add
  service and assignment rows to `Docs/api-venue-permissions-matrix.md`; record the host-write
  exception in `Docs/Multi_model_RLS_and_API_audit.md`.
- Update the assistant golden that cites `getting-started/linked-venues`, and re-record the linked
  venues video.

**What the second pass found in the help centre**, which makes this larger than a rewrite list:

- **One article currently teaches the opposite of R4.** `getting-started/linked-venues.ts:154`
  tells owners "Prices, durations, deposits and cancellation notice always come from each member
  venue's own service", and `:168` says a member's "services appear using their own price,
  duration and availability". Under this design the host owns all of that. The same article
  documents the whole Link, Unlink, Re-sync, "in step" and "customised" vocabulary that §6.8
  deletes. It is the single most misleading page on the site the day the engine ships, and it is
  also the only collective article with no `:::help-figure` schematic at all.
- **Between fifteen and nineteen articles mention collectives, linked venues, linked accounts or
  the combined page (the count depends on the search terms), and more again describe flows this
  changes without mentioning them.** `getting-started/staff-first-booking.ts:67` contradicts §6.2
  outright by describing "a service that differs by venue". `what-your-clients-see`, `compliance`,
  `troubleshooting/availability-issues` and the second import article are not covered by the list
  above and need adding. Eleven existing figures need redrawing.
- **A help defect that is not ours but is cited as evidence.** Both services articles
  (`getting-started/services.ts:138`, `appointments/services.ts:173`) promise seven per-calendar
  override fields. The route accepts two and refuses admins outright. That is PB-01, and the help
  centre is the thing PB-01 says is wrong, so fixing PB-01 means fixing these two articles as
  well as the route.
- **The assistant needs a collective field, not just a new golden.** `AssistantVenueContext`
  (`src/lib/assistant/venue-context.ts:21-40`) carries nothing about collectives, so
  `buildContextBlock` cannot tell a host from a member and would answer a member with host
  instructions. Goldens 3, 5, 6, 29, 31, 32 and 39 all become role-dependent, not just golden 21,
  and the eval does not run in CI.
- **Two documents missing from the amend list.** `Docs/Embed_Public_Booking_URL_Contract.md` says
  there is "deliberately no `?practitioner=` equivalent", which forecloses the `?calendar=`
  redirect target §6.9 depends on, so that contract has to change or §6.9 does. The welcome email
  also carries a collective video blurb (`src/lib/emails/welcome-email.ts:36-40`).
  `Docs/Resneo_Unified_Booking_Functionality.md` was checked and makes no collective claims, so it
  needs nothing.
- **Two articles the 2026-09-14 decisions now require.** D42 is help-centre only, so the split
  client record has to be explained somewhere a guest-facing question can be answered from: what
  happens when the same person books at two venues in the collective, why each venue keeps its own
  record, and what a member sees. And D41's shape needs saying in the member's own words: a
  collective is built on your account links, the client and booking access those links give you is
  theirs rather than the collective's, the records stay with the venue that owns them, and leaving
  or ending the collective changes the booking page, not the links.
- **Nothing stops an em-dash reaching a help article.** The existing copy tests cover booking copy
  and the assistant's answers only. Since this project rewrites twenty-odd articles under a rule
  that forbids them, add the sweep (HLP-01) before the rewriting starts, not after.

### 6.13 Red-team findings and how the design resolves them

RT1 is the engine, data and deploy review; RT2 the product, lifecycle and booking-engine review.
Both reviews, with evidence and inventories, are summarised in Appendix A.

| id | Sev | Finding | Resolution |
|---|---|---|---|
| RT1-1 | Critical | The per-master queue lost changes for sibling members and on commit-order races | Revisions per replica link, locked apply, leases (§6.4) |
| RT1-2 | Critical | Host transfer orphaned every replica mapping | Re-key in `collective_transfer_host`; host change refused outside the engine (§6.7) |
| RT1-3 | High | Managed forms collide on the per-venue slug (live on staging) | Adoption order, suffixed slugs, requirement merge (§6.4) |
| RT1-4 | High | Locks outlived membership; eleven status writers bypass release | Status triggers release in the same transaction; lock order; registry test (§6.3, §6.4) |
| RT1-5 | High | Deleting an offered master blocked in one route only | Database refusal plus import undo fix (§6.5) |
| RT1-6 | High | The Services PATCH wrote replicas implicitly; the guard misfired on app payloads | Replica PATCH never writes the row; normalised projection guard before any write (§6.5) |
| RT1-7 | Medium | Invalid multi-event transition triggers; leaking flag; invoker triggers; read-only STABLE functions | One trigger per event; SECURITY DEFINER; function-level SET; VOLATILE (§6.4) |
| RT1-8 | Medium | Snapshot backfill too narrow; writers missing | All bookings backfilled; BEFORE INSERT fallback; writer registry (§6.3, §6.6) |
| RT1-9 | Medium | Production migration state unverified; Pass A would drag owed migrations along | Pass 0 ships owed migrations alone first (§8) |
| RT1-10 | Medium | A run-time denylist would copy future venue-scoped columns | Explicit column classification with an enumerating test (§6.3) |
| RT1-11 | Medium | Unapplied or inactive replicas could be published | Replica links start behind and stay out of the catalogue until converged (§6.7) |
| RT1-12 | Medium | Assignment writes race the host's cross-venue writes | Single-statement diffs, ownership check, expected ids in the same transaction (§6.7) |
| RT1-13 | Medium | Members could attach managed add-ons and forms to their own services | Refused with a coded 409; hidden from pickers (§6.5) |
| RT1-14 | Low | Revision on `venue_collectives` is a hot row with side effects | Separate revisions table with more bump sources (§6.3) |
| RT1-15 | Low | Release copies photo URLs, not photos | Copy objects after commit (§6.7) |
| RT1-16 | Low | Option id churn and heading-by-name duplicates | Update in place; headings mapped by id (§6.4) |
| RT1-17 | Low | Missing REVOKEs, audit actor, cross-venue dialog details | Engine tables and sequences revoked; routes write actor; no guest names across venues (§6.5) |
| RT2-1 | Critical | The price snapshot never reached the paths that settle money | Snapshot first in every settling reader (§6.6) |
| RT2-2 | Critical | Form capture on member calendars would be refused | Serve the owning venue's managed type and version; defer Any available forms (§6.6) |
| RT2-3 | Critical | Redirects keyed on membership would take members offline | Redirect only when live, converged and listed; the host's page needs only live and listed (§6.9) |
| RT2-4 | High | Transfer does not re-key replica identities | As RT1-2, plus NO ACTION mappings and member notice (§6.7) |
| RT2-5 | High | Flag gating could not live in the merge | Gating inside the one resolver, all local precedence deleted (§6.6) |
| RT2-6 | High | Host forms unenforced where members have compliance off (live on staging) | Forms must be on at a member for form-bearing offerings to be bookable there; the join dialog says so and the product never flips the flag (§6.7; D10) |
| RT2-7 | High | Managed form slug collision | As RT1-3 |
| RT2-8 | High | Old app builds could join without consent | Consent version required (§6.7) |
| RT2-9 | High | A no-Stripe leaver republishes paid services that fail at checkout | Payment rule downgraded with audit and a review checklist (§6.7) |
| RT2-10 | High | No coherent policy for member-only services | Revised 2026-09-14: services not on the page are parked while the venue is live, derived and lifted at leave; "Park it until I leave" or "Ask the host to add it" at accept; a link to a parked service lands on the collective page's service list (§6.6, §6.7, §6.9; D2) |
| RT2-11 | High | Group bookings across member venues refused | Same-venue limit shown up front, or split groups (D28) |
| RT2-12 | High | Staff authority without account links loses audit, notices and edit rights | Collective booking audit and defined rights (§6.5; D17 as amended by D41) |
| RT2-13 | High | The staff form copies one venue's client into another | The picker searches every live member venue, names the owning venue and books against the existing record; a picked contact is cleared only outside a live collective (§6.5; D41) |
| RT2-14 | High | Legal exposure in the model itself | Counsel complete (D9, 2026-09-14); trader line; unticked consent (§6.9) |
| RT2-15 | Medium | Stripe exclusion checks only an account id and hides staff calendars | Store charges readiness; public audience only (§6.6) |
| RT2-16 | Medium | Some columns must not copy (meeting links, arrival text, add-on costs) | Column classification (§6.3; D11) |
| RT2-17 | Medium | Per-calendar values: no host write path; display and charge differ | `collective_set_calendar_values`; catalogue carries all seven values; name and description delegation off for offered services (D29) |
| RT2-18 | Medium | Freshness gaps; anonymous traffic triggered writes | Fingerprint omission on public paths; inline apply only for staff and hosts (§6.4) |
| RT2-19 | Medium | Old app: stale PUTs, false 409s, diary routing | Stale check, normalised guard, server-side calendar ids (§6.11) |
| RT2-20 | High | Adoption overwrote a booked service without mapping or snapshots | Reviewed adoption with mapping, preview and snapshots (§6.7) |
| RT2-21 | Medium | Locks block future data migrations; import undo fails silently | Documented engine bypass for migrations plus CI lint; undo fix (§8) |
| RT2-22 | Medium | Redirects lose context; dissolve sends everyone to the host | Translated redirects; neutral dissolved page (§6.9, §6.7) |
| RT2-23 | Medium | Notice and consent for commercial changes too weak | Immediate notices for commercial and form changes; re-consent or free leave on transfer (§6.7; D23) |
| RT2-24 | Medium | Suppressing member venue-wide forms moves safety liability | Member venue-wide forms apply on top of host services by default (D10) |
| RT2-25 | Medium | Venue-level settings still split behaviour | Inventory with a treatment each (§6.10; D32) |
| RT2-26 | Low | Engine details that fail or bottleneck | As RT1-7 and RT1-14 |
| RT2-27 | Low | Withdrawal strands online reschedules; re-joins duplicate | Reschedule allowed on retired replicas; reconnect at re-join (§6.7) |
| RT2-28 | Low | New production collectives would switch before the soak | Platform flag for new collectives (§6.7, §8, and D37 for where that flag lives) |

### 6.14 Which booking models a collective covers

The collective page is appointments only, and this release does not change that. It is worth
stating plainly because nothing in the product says it today and a member can lose its other
trade without warning.

- The synthetic venue is built with `booking_model: 'unified_scheduling'` and a single active
  model (`collective-venue.ts:163-165`), so the public flow can only mount the appointment
  journey. The catalogue confirms it from the other end: it reads services and assignments
  through `fetchAppointmentCatalog` and filters out every calendar whose type is not
  `practitioner` (`catalogue.ts:69-84`, `appointment-catalog.ts:214-216`). Provider rows carry
  one untyped `source_service_id` with no entity discriminator
  (`20261210120000_combined_booking_page.sql:105-132`), so classes, events and resources cannot be
  added without a schema change.
- Eligibility does not know this. `isLinkFeatureVenue` (`eligibility.ts:36-41`) refuses only the
  restaurant and table-product tiers, which is legacy protection rather than a live constraint:
  restaurants are no longer a booking model and no venue is on one. What it does **not** refuse is
  a class-only or resource-only venue, which is therefore "eligible", counts towards the
  two-eligible-members gate that makes the page live (`collectives.ts:946,978-981`), and
  contributes nothing to it.
- A member admin can remove `unified_scheduling` from its own venue at any time through
  `PATCH /api/venue` (`src/app/api/venue/route.ts:403-446`, whose guards are future bookings and a non-empty model list) and silently empty
  its contribution, with no notice to the host.

**What ships in this release.** Appointments only, said out loud:

1. Invite and accept refuse a venue with no active `unified_scheduling` model, with a plain
   reason, instead of admitting it and producing an empty group on the page.
2. A member whose other models would leave the web is told before it accepts, and again before
   its own page starts redirecting. The redirect keeps a way through for them: see D44.
3. Removing `unified_scheduling` while in a collective is refused with a coded 409, the same shape
   as the other guards, because it takes the member off a page it does not own.
4. The host's members list shows "Also runs: classes, events" against a member, so the host knows
   what the collective is not carrying.

**What does not ship, and is not pretended.** Classes, courses, passes, credits, memberships,
events and shared rooms stay per venue. Class commerce in particular is venue-scoped at
every layer, including payment identity on that venue's connected account, so a pass bought at
the host cannot be spent at a member. Shared physical resources are worse than unsupported: two
venues can each put the same real room on a calendar and the platform will double-book it
(SB-36), because resources are pinned to a venue by the API but not by the database. Until D45 is
taken, the honest answer to "can we share a room" is no, and the product should say so rather
than let two venues discover it through a clash.

Multi-service visits are limited harder than groups and have no decision of their own: a visit
needs one calendar that offers every segment (`create-multi-service/route.ts:265-270`,
`collective-booking-bridge.ts:419-436`), so a two-service visit across two venues is impossible.
That limit should be explained before the details step exactly as D28 does for groups.

### 6.15 Reporting, attribution and money across the collective

A host running several venues cannot see how the collective is doing, and every member can see
every other member's takings. Both follow from the same cause: reporting is keyed off pairwise
links, not off the collective.

- **Make collective trade visible.** `bookings.collective_id` already exists
  (`20260919120000_linked_accounts.sql:149-150`) and is written by the create paths; nothing reads
  it. Add it to the report filters and to every export, and read it to tell "booked on the
  collective page" apart from a booking the member took on its own page. Without this, no
  acceptance question about the collective's performance can be answered. `source` gets no
  collective value (D55): `collective_id` is the attribution.
- **Fix the accidental symmetry first.** Booked revenue reaches other venues through
  `loadAccessibleLinkedVenueIds` and `grantAllowsRevenueReporting`
  (`reports/booked-revenue.ts:83-85,316-317`), and membership forces a full mutual mesh
  (`collectives.ts:507-512`), so today every member sees every other member's revenue in one
  blended total with no venue subtotal and only the words "shared with you through a linked
  account" to explain it (`BookedRevenueSection.tsx:331-340,361-366`). That is almost certainly
  not what any of them agreed to. D41 keeps the mesh (it belongs to the account links, not the
  collective) and D49 keeps the mutual visibility, so what changes is presentation and consent: the report breaks the figure
  down by venue, names each venue, subtotals it, and the visibility is agreed at join rather than
  discovered.
- **What the host gets.** A collective view of Booked revenue: one row per venue, one total, the
  collective's own bookings separated from each venue's own-page bookings, and the same date
  controls as today. What the host must not get in a figures view is a member's client contact
  details: guest contact details never cross a venue boundary in a figures view, whatever D41
  allows in the contact search.
- **What a member gets.** Every venue's figures, named and subtotalled (D49), with its own
  collective bookings identified within its own, so it can see what the collective brings. After
  the membership ends the collective view goes and the "via {collective}" filter is kept for the
  venue's own bookings; any other venue's figures it still sees come from its account links'
  own revenue grant, exactly as for any linked venues (D41, DL11, §6.7; REP-06).
- **Read the snapshot, everywhere money is shown.** §6.6 lists the settling readers. One more
  belongs on that list and is easy to miss because it is staff-facing rather than guest-facing:
  `buildPriceSummary` (`src/lib/booking/payment-display.ts:160-230`), rendered by
  `BookingPriceSummary.tsx:28`, `BookingPaymentDetails.tsx:7` and
  `ExpandedBookingContent.tsx:1309`. Its precedence today is stored total, else the live variant
  price plus add-ons, with no service fallback, so it already disagrees with
  `loadRowTotalResolver`. `recomputeBookingPaymentSummary` has a second entry point at
  `confirm-balance-payment.ts:178,252` and is tested by PRICE-04 but named nowhere in the prose.
- **The day sheet.** Every `practitioner_appointment` and `unified_scheduling` venue is redirected
  away from it (`day-sheet/page.tsx:56-58`), so it is unreachable for exactly the venues a
  collective contains. Where it is reachable, its partner block sits inside `print:hidden`
  (`DaySheetView.tsx:1798`), so a printed sheet leaves partner bookings out. Neither is worth
  fixing for this project, but the acceptance checklist should not imply the day sheet works.

### 6.16 Running it: observability and support

The engine writes into other people's businesses on a schedule, so it needs watching like a
payment job, not like a page. None of this existed in the first draft of the design.

**Two new crons**, registered in `vercel.json` alongside today's 25, each wrapped in
`withCronRunLogging` (`src/lib/platform/cron-log.ts:13-40`) so every authorised run lands in
`cron_runs`, each guarded by `requireCronAuthorisation` (`src/lib/cron-auth.ts:8-24`), and each
finishing through `finalizeCronRun` (`src/lib/cron/finalize-cron-run.ts:38-70`) so a non-zero
error count reaches Sentry tagged `cron_job` and the ops address in `CRON_ALERT_EMAIL`:

| Job | Schedule | Counters returned |
|---|---|---|
| `collective-replicate` | `*/5 * * * *` | `claimed`, `applied`, `still_behind`, `failed`, `leases_expired`, `errors` |
| `collective-verify` | `0 6 * * *` | one count per invariant, `repaired_applied` (I3b), `repaired_released` (I5), `drift_repaired` (I3), `unrepairable`, `errors` |

Both return HTTP 200 even when they cannot read what they need, with `ok: false` and a reason, so
the cron platform does not retry a check that is reporting correctly. That is the rule
`schedule-health` already follows (`api/cron/schedule-health/route.ts:36-40`).

**Why the verifier repairs, where `schedule-health` deliberately does not.** The scheduling
health check is read-only on purpose, and says why: drift there means something upstream is
broken, and a nightly silent repair would hide the cause while the symptom kept returning
(`route.ts:13-19`). Convergence is a different thing. A replica that is behind is the engine's
normal resting state between a host save and its apply, and bumping a revision is the same action
the engine would have taken anyway. So the verifier repairs lag (I3b) by running the apply and
orphaned replica links (I5) by releasing them, both as ordinary audited repairs; it repairs
unexplained drift (I3, a replica link marked current whose fingerprint differs) only with an
`unexplained_drift_repaired` audit row carrying the before-image and an alert, because that state
is never lag; and it alerts on everything else without touching it. Every repair is written to
the audit trail, so a repair that keeps recurring is visible rather than absorbed.

**Two thresholds for a replica link that is behind.** At 15 minutes the host and the member are
told (N5) and the member's calendars are hidden for that offering (§6.4, D16). At 60 minutes ops
is paged.

**Alert when**: any replica link is behind for more than 60 minutes; more than 5 per cent of
replica links fail an apply in one run; any I3 drift was repaired; any invariant other than I3b
or I5 is non-zero; the replication cron has not completed for 30 minutes; a lifecycle job is
stuck (I22).

**Support console.** A support person cannot open a host's Services page, so today they would have
nothing to answer with. The platform area (`src/app/api/platform/*`, superuser auth through
`requirePlatformSuperuserAuth`, audited with `recordPlatformAuditEvent`) gains a collective panel:
per collective, its model and member list with update health; the last 50 audit events; every
replica link with its revisions, `behind_since`, attempts and last error; and exactly one action, "Retry now"
on a replica link, which calls the same engine function as the cron and is itself audited. Everything else
is read-only. Support never edits a master, and never sees a guest's contact details.

**Worth measuring over time**: applies per day; median and 95th percentile time from host save to
converged at every member; failures by error code; replica links behind more than 15 minutes; time to
converge for a newly joined member.

### 6.17 The diary, and the people who work in more than one venue

Availability itself is sound: the bridge clocks and gates every calendar against its own venue,
including that venue's blocks (`collective-booking-bridge.ts:202-262`,
`appointment-engine.ts:1990-2001`). Everything wrong here is in what staff are shown, which
calendar gets picked, and the fact that the platform has no idea two calendars can be the same
person.

- **Partner columns must show real hours** (SB-39). `linked-calendar/route.ts:182-207` returns
  `working_hours` alone, so a member appears open on a day their business is closed. The fix is
  cheap and is worth doing on today's model: `GET /api/venue/practitioners?owner_venue_id=`
  already returns most of it (`practitioners/route.ts:34-61`): schedule periods, the rota, days
  off and amended hours. Leave and the partner venue's opening hours and closures are not on that
  route and need a second source, which is still cheaper than drawing a template.
  CB-35 logs a narrower version of this as Low; it is not Low, because a host books into it.
- **"Any available" must be fair and configurable** (SB-40). Move the collective branch after the
  flags block so `any_available_practitioner_config` applies, publish that config on the synthetic
  venue, and replace the host-first hard-coding with the host's own calendar order. Publishing the
  resolved flags properly also fixes the waitlist (SB-33), which is missing for the same reason:
  the synthetic venue hand-builds two flags and omits the rest
  (`collective-venue.ts:174-179` against `venue-public-feature-flags.ts:34-42`).
- **Moving a booking between venues** (SB-41). Within the replicas model the two calendars offer
  the same service under the same terms, so "you cannot move it" is hard to defend to a
  receptionist. The design does not require the ownership rule to bend: a move across venues is a
  transfer of ownership, and §6.1 says ownership never moves. D46 is answered (§11.4): it stays
  refused, and the dialog says why without offering the lossy rebook-then-cancel path. The dialog
  is `move.otherVenue.title`, "This booking cannot be moved to {venue}", with
  `move.otherVenue.body`: "Bookings stay with the venue they were made at, because that venue
  holds the client's record and any payment. You can move it to any calendar at {ownVenue}."
  (DIARY-03). A true cross-venue move, with the deposit, card hold, compliance records and guest
  messages all accounted for, is its own piece of work if it is ever wanted, and is not improvised
  inside this project.
- **People are not modelled across venues** (SB-28, SB-38). Two separate failures share one cause.
  A person with staff rows at two venues cannot sign in at all (`venue-auth.ts:55-65` refuses to
  choose a venue and `dashboard/layout.tsx:89-93` redirects them into signup), and a person with a
  calendar at two venues can be booked twice at the same moment because nothing compares across
  venues. The first is a live bug on every venue and belongs in W16 regardless of collectives. The
  second is D47, answered (§11.4): warn, do not model. When two calendars in a live collective
  share a normalised name and email, the staff booking form and the collective page's staff-side
  warning show `clash.samePerson` ("{calendar} at {venue} looks like the same person as
  {otherCalendar} at {otherVenue}, who already has a booking at this time.") to whoever books
  second; nothing is modelled (DIARY-02). A person identity above the venue is a platform change,
  not a collective one.
- **A second, collective-unaware cross-venue diary exists** at `/dashboard/linked-calendar`. It
  must either learn about collectives or be folded into the main diary. Leaving two cross-venue
  diaries that disagree is exactly the split-brain this project is meant to end.

---

## 7. Migrating existing collectives

**Decided 2026-09-14 (D54).** One live collective exists today, between two accounts, and the
owner will tell both venues in person what is happening. So the migration is deliberately simple:
**the host's values apply to every service on the collective at the point of migration, and every
existing booking is protected.** There is no member review window, no notice before or after the
switch, no "Your previous settings" panel, and no member value carried over as a per-calendar
value. Before-images are still recorded, because rollback (D30) needs them, and the dry run still
lists every value that will change, because the owner signs it (D21). The algorithm the script
runs is Appendix G (migration script); the tables it writes are Appendix C (engine DDL); the
functions it calls are Appendix D (engine functions); the column classes it reads are Appendix F
(column registry).

Every collective that exists today is `legacy_copies` until it is migrated, one at a time, by a
script that runs only after the new code is live in that environment (backfill and dual-write must
never meet, see the migration deploy notes). Two rules govern the script, and both come from the
owner: **existing bookings are untouched, and the switch is smooth enough that any small
difference on the collective page can be tidied afterwards by editing the master.** In practice
that means: every booking keeps its calendar, its service, its price snapshot, its terms and its
manage links, because a booking's price was fixed when it was made (§6.6, D7) and nothing about a
booking row changes except a missing snapshot being filled in; nothing is deleted; each member's
copies become replicas of the host's masters carrying the host's values; what belongs to the venue
rather than to the service (the compliance flag, the member's own add-on groups and headings,
member-only services, stored per-calendar values on the member's calendars) is not changed, except
that a member-only service the owner chooses to add to the page becomes the replica of a master
copied from it, so its values stay the same; and
everything the host's values replace is written to `collective_audit_events` as a before-image for
rollback, not shown to the member as a panel.

**Production is unsurveyed.** Everything below that names a venue or a number was read on staging
(§2.10). The list of what a migration changes is per environment and is produced by the dry run in
that environment (step 3); the production list exists only once steps 1 and 3 have run there.

0. **Account links are not touched.** The migration reads `account_links` only to confirm the full
   mesh still holds (a pair that has fallen below it is reported, because today's reconcile would
   already have removed that member). It classifies, writes and ends nothing there (D41). An
   earlier version of this step classified links as "created for the collective" so the release
   could end them; that is withdrawn.
1. **Survey production read-only first**: owed migrations, offerings with no host source (P5),
   ambiguous masters (P1), member services backing two offerings (P2), form slug collisions (P3),
   copy options with future bookings and no matching master option (P4), Stripe readiness, forms
   flags (and the `FEATURE_FLAG_*` environment overrides), exclusivity (I7); plus offerings whose
   name, description, photo, heading or order differ from their master's; collective headings with
   no same-named host heading; non-null provider overrides and non-approved provider rows;
   member-inactive copies; copies whose add-on links resolve to member-owned groups; stored
   per-calendar values under a flag the host has off; member assignments on copies that are not
   providers; `synced_from_service_id = id` rows; and
   `service_items` rows with `is_bookable_online = false` at any venue, because W4 starts honouring
   that column everywhere (§6.6).
2. **Rehearse on staging fixtures** (`e2e-coll-*` venues built with plus-1's shape: drift, an
   archived same-slug form, options, bookings, and every state step 1 lists), then dry run, apply,
   invariants, rollback, re-apply.
3. **Dry run** `scripts/collective-replicas-migrate.mjs --collective <id> --dry-run`. The report has
   two audiences. For the operator: planned masters and replica links, adoptions, collisions,
   bookings to snapshot, invariants, and the account-link mesh check of step 0. For the owner, who
   signs it: per offering, any page copy (name, description, photo, heading, order) that differs
   from the master, because the master stands and the page shows the master's wording from the
   switch, so the host edits the master beforehand if it prefers the page's; per collective
   heading, the host heading it maps to or the managed heading that will be created; per member
   and copy, every column that takes the host's value, before and after; calendars that will be
   added to or removed from the page; services that will be hidden from guests and why (no Stripe,
   forms off); each member's member-only services, each with the owner's choice (D2 as revised on
   2026-09-14): "add to the page", in which case the member's service is copied into a new host
   master through "Add from another venue" and the member's own service is adopted as its replica,
   so its settings, calendars and bookings do not change, or "park", in which case it stays exactly
   as it is and is parked from the switch; any page address already adopted, left as it is; and whether
   compliance records would be needed at a member, with the statement that the migration switches
   nothing on.
4. **Owner signature.** The owner approves the report by its hash (`--approved-report`) and tells
   the venues in person. Nothing is sent from the product and there is no review window; a venue
   that does not want the new arrangement leaves before the switch through today's Leave, which is
   a legacy leave and loses nothing.
5. **Apply**, per collective, in this order: snapshot every booking on masters and copies (a safety
   re-run of the Pass A backfill, D7, which must report 0 rows on a clean Pass A); set masters
   (creating the host service active where only members provide the offering, D36, and a master
   copied from each member-only service the owner chose to add to the page); set
   `service_model = 'migrating'`, in which the legacy catalogue keeps serving, member locks are on,
   engine applies run, and the "behind" hide is suspended; create replica links
   (`provenance = 'migrated'`, or `adopted` for a member-only service added to the page, whose
   bookings are snapshotted first) and record, in one `migration_applied` audit row per member, the
   before-image of every copy (its row, option rows, add-on links, requirement rows and the three
   sync columns) and of every provider row; map copy options to master options by name and sort
   order (an option with future bookings and no match is kept inactive and mapped to nothing, P4);
   adopt managed forms in the §6.4 order without changing any venue's compliance flag; adopt a
   same-shape member add-on group as the managed group rather than creating a second; create
   managed headings rather than renaming a member's own; create missing assignments; then drain
   replica link by replica link outside the migration function (so no statement timeout holds
   locks), which is what writes the host's values onto every copy; and, only when every replica
   link has converged, set `service_model = 'replicas'`, at which point the derived rule in §6.9
   hands each member's own page over. Never write or clear a per-calendar value, never change a
   member-only service's `is_active`, never flip a venue flag.
6. **Verify by invariant, never by row counts**: I1 to I3, I5, I8, I10 to I16, I23, I32 and I45 all
   0; every booking total unchanged and no booking row changed except a filled snapshot; every
   replica's fingerprint equals its master's; the catalogue diff equals the signed report; every
   member has at least one calendar still on the page, or the report said which disappear and why.
7. **Rollback** until code removal restores what step 5 recorded, not what the database happens to
   hold now: the provider snapshot (ids, overrides, approval, status, `created_at`), the copies'
   rows, option rows and states, add-on links, requirement rows, the compliance types' prior
   archived state and mappings, the three sync columns and `legacy_copies`. Before-images are
   applied only where the member has not edited the value since (the freshness rule: `updated_at`
   unchanged); a value edited since is left alone and listed. Per-calendar values are never touched
   in either direction. Bookings and their snapshots are never touched (D30). One
   `migration_rolled_back` audit row per collective.
8. **The member's account afterwards.** The services from the host appear on the member's Services
   page as locked replicas with the host's values, exactly as they would after a join; History
   carries one line (`history.migrationApplied`); nothing else is shown or sent. Anything the
   owner then wants different on the collective page is an ordinary edit to the master.
9. **Residue.** Before C2, the dissolved collective's provider rows, its offerings' dead columns and
   every collective's provider overrides and approval history are exported to
   `collective_audit_events` (as `migration_applied` rows targeted at each venue, carrying the
   archived rows in `changes.before`), so history survives the drop. Copies at former members that
   still follow a dissolved collective's host are detached (`independent`) with an audit row.
   Bookings keep their `source`; their `collective_id` already carries the collective's history
   for the reporting in §6.15 (D55), so no source backfill runs.

**Pass A go conditions the migration depends on.** A migration is not runnable on an environment
until: `venues.stripe_charges_enabled` has been backfilled for every venue with a Stripe account,
before the hide rule in §6.6 ships; every MGR-01 shim, the combined-page manager fold, the 24-hour
`STALE_RESOURCE` rule and the accept consent gate are proven to condition on
`service_model = 'replicas'`; the rehearsal has shown every booking untouched through apply and
rollback, a legacy leave before the switch losing nothing, a rollback restoring the provider
snapshot and the sync columns, and the catalogue diff equal to the signed report; and no member
loses every calendar from the page (MIG-05, MIG-06, and I48, which counts legacy collectives
reachable by a shimmed catalogue action, a handover decision or a consent refusal, expected 0
until C1).

**What the staging collective (plus-1) will show in its dry run** (the corrected D21 list, under
D54):

- Light 3's Haircut at 10.00 takes the host's 25.00 for bookings made after the switch. Every
  booking already made at 10.00 keeps 10.00, because its price was snapshotted when it was made.
  Length and buffer are already in step; the deposit follows the host's once D5 lands.
- Senior (65+ Yrs) takes the host's card hold. Light 3 cannot take a card hold, so its calendars
  are hidden for that service until Stripe is connected (below); the previous payment rule is in
  the before-image for rollback.
- The 3 locations, the staff flags and the 16 headings change to the host's. The 16 copies are
  re-filed under managed headings created at Light 3, not by renaming Light 3's own.
- Light 3 has forms switched off, and the migration does not switch them on. The host's PPD patch
  test on Root Tint is not asked for there until Light 3 chooses to switch compliance records on,
  and until it does its calendars are hidden from guests for Root Tint (D10, §6.6). The archived
  PPD Patch Test (`d1a15afc`, left by a 2026-09-06 live check and undeletable because compliance
  audit events are append-only) is adopted as the managed form when it does.
- Light 3 has no Stripe account, so its calendars are hidden from guests for the 3 paid offerings
  until it connects Stripe. This happens in Pass A, not Pass B, and Light 3 is told then.
- Light 3's 10 member-only services each carry the owner's choice in the signed report (D2 as
  revised on 2026-09-14): "add to the page", which copies Light 3's service into a new host master
  and adopts Light 3's own service as its replica, so its settings, calendars and bookings do not
  change; or "park", which leaves it exactly as it is and parks it from the switch until Light 3
  leaves or the host adds it later. Existing bookings on a parked service stay fully manageable, and
  the report says plainly which services stop taking new bookings. (This replaces the earlier
  bullets, which kept them for Light 3's team and offered a member review; both withdrawn.)
- The report lists each offering whose page copy differs from its service. The master stands (D54):
  from the switch the page shows the master's wording, so the host edits the master beforehand if it
  prefers the page's.
- The one account link between Plus 1 Staging and Light 3 is checked for full access and left
  exactly as it is, before, during and after the switch (D41).
- The dissolved collective's residue (33 active providers, 2 pending rows, 11 legacy null-calendar
  rows) is exported to the audit table before C2; nothing is deleted until then.

---

## 8. Delivery plan

### 8.0 What the second pass found, tiered

The second pass added fifteen split-brain cases (SB-28 to SB-42), four platform bugs (PB-16 to
PB-19) and sixteen decisions (D37 to D52), the UI review that followed added thirteen collective
bugs (CB-41 to CB-53), and the consistency edit of 2026-09-14 added D53 and D54 and the lifecycle
answers DL2 to DL12 (§11.4). They are not equally important, and a list that does not say so is not much use. Each is tiered here
once, and the tier is the thing to act on; the entries in §3, §4 and §11 carry the detail.
Re-tiered on 2026-09-14 against the owner's answers in §11.4.

**Tier 1, fix first.** Live today, independent of the engine, and cheap. These can start alongside
W1 and W2.

| Finding | Why first | Where |
|---|---|---|
| SB-28, PB-16 | One person with a login at two venues is locked out of both dashboards, and the invite route creates that state silently. D38 makes the fix a refusal with a clear message rather than a venue chooser, so this is now small | W16 |
| SB-31 | Booked revenue blends every member's takings into one unlabelled total. D49 keeps the mutual visibility, so what is left is presentation and consent: name the venues, break the figure down, agree it at join | W17 |
| SB-39 | Partner diary columns are drawn from the weekly template, so a host sees a member as open on a day that business is shut, and books into it. The data needed is already returned by another endpoint | W21 |
| SB-15 | One member's ordinary service save writes into a second member's venue, with no host involved. Narrow conditions, but wrong enough to fix before anything else writes cross-venue | W1 |
| PB-19 | The bookings export is not admin-gated while returning every guest's email and phone. One line | W15 |

**Tier 2, fix while building.** Part of the work, sequenced by their workstream.

| Finding | Tier-2 because | Where |
|---|---|---|
| The lock-order inversion (§6.4) | Cheap to prevent while the engine is designed, unpleasant to diagnose after | W3 |
| The FK-cascade exemption (§6.5) | Not a hole so much as an under-specified clause. Decide what it means before writing the trigger | W3 |
| The anon-readable assignments table (§2.2) | Only becomes a problem when the new columns land, so fix it in the same pass that adds them | W15, before W8 |
| Calendar deletion silently withdrawing a member (§6.5, I33) | Falls out of making assignments the only truth | W3 |
| SB-30 | Collective trade is invisible in every report because `collective_id` is read by nothing | W17 |
| SB-33, SB-40 | The waitlist is missing and "any available" favours the host, both because the synthetic venue publishes only two of its flags | W19 |
| SB-35 | Appointments-only stated in the product | W20 |
| Currency gate, booking-model lock | Currency gated the way timezone already is, and `unified_scheduling` cannot be dropped while in a collective; both edit `PATCH /api/venue` and belong to one workstream (BM-04, TERMS-15) | W7 |
| SB-37, PB-17 | Canonicals and page metadata. Real, but nobody is harmed while it waits | W19 |
| SB-29 | Offered masters become admin-only to edit whoever created them. One guard | W5 |
| Cross-venue contact search (D41) | Makes the client access the account links already give easy to use inside a live collective; it is a collective feature, so it ends with the membership while the links carry on. `/api/venue/guests` is venue-scoped on every query, so shared access today is per guest through a shared diary rather than anything searchable | W7 |
| Booking-model forward compatibility (D44) | An entity discriminator on `collective_service_items` (`entity_type`, §6.3; never on provider rows, which C2 drops), and a real booking-model list on the synthetic venue. Changes no behaviour now, and is the difference between adding classes later and rewriting for them | W20 |
| SEC-03 | A pre-booking form should file at the venue that will hold the booking. Falls out of RT2-2 | W4 |

**Tier 3, recorded so nobody builds it.** Deliberate non-action. Each is written down because the
next reader would otherwise rediscover it and propose work.

| Finding | The decision |
|---|---|
| SB-32, duplicate contacts across member venues | Accepted, and covered in the help centre only. No product UI, no banner, no warning at join: help articles and customer service handle it (D42) |
| SB-36, two venues sharing a physical room | Not supported. Say so in the product. A cross-venue resource is a platform change, not a collective one (D45) |
| SB-38, one practitioner with a calendar at two venues | Warn, do not model. Flag two calendars in a collective sharing a name and email; a person identity above the venue is out of scope (D47) |
| SB-41, moving a booking between venues | Stays refused. Ownership never moves, per §6.1. Rewrite the dialog so it stops offering a lossy rebook-and-cancel workaround (D46) |
| The engine flag's actor binding | Dropped as a security measure. Anyone holding the connection string has already won, so a nonce defends nothing. The audit half is kept and is the point: see §6.4 |
| The public requirements route | Not a finding. §6.6 records why, so it is not raised a third time |
| PB-18, marketing email has no unsubscribe link | Real and platform-wide, and nothing to do with collectives. Raised here only because this review found it; it belongs in its own piece of work |
| A venue chooser for multi-venue people | Not building it (D38). The invite refuses instead, so a person running two venues in a collective keeps two logins. Recorded because it is the obvious thing to propose next |
| Scheduling a future price change | Not planned (D51). Changes apply straight away |
| A collective-owned address, phone and opening hours | Not built. The page shows the host's (specification §1 C, item 12, and §6.2); recorded here because an earlier draft of item 10 proposed giving the collective its own |
| SB-42, account links outliving a collective | Correct, and must stay (D41, owner, 2026-09-14). A collective sits on top of account links with full access; leaving, removal and dissolve change only the collective, and a venue that leaves keeps full create, edit and cancel access with the venues it is linked with. Recorded because an earlier draft called it the most important defect in this document and planned W7a to end the links |

### 8.1 Fix now, on today's model

These bugs hurt today, do not depend on the redesign, and several are prerequisites for it:
CB-01 to CB-09, CB-11 to CB-13, CB-15, CB-16, CB-23 to CB-26, CB-28 to CB-31, CB-33 to CB-36,
CB-38, CB-39, CB-40 and PB-01 to PB-14 (PB-15 waits for the consent review in D9). Workstreams W1
and W2 below cover most of them.

### 8.2 Passes

| Pass | What | Classification |
|---|---|---|
| 0 | Ship production's owed migrations on their own (service categories, collective policy recursion fix, schedule periods, canonical processing shape, sync columns), with their invariants | Expand plus data backfills |
| A1 | Booking correctness, live: price snapshot and backfill, the resolver over today's two custom columns, base-price override removed, actor stamps, Stripe readiness and its backfill, `service_items.updated_at`, the assignment diff writes (W1's first part, W1a, and W2) and the column registry (W3's first part, W3a) | Expand |
| A2 | Engine dark: engine schema and functions (W3), the five per-calendar columns after the grants hardening (W15, then W8), unique indexes once I7 = 0 | Expand |
| B | Migrate existing collectives, per environment, after code A is live there and the Pass A go conditions in §7 hold | Data |
| Flag | Switch new collectives to replicas after a 7-day clean soak | Configuration |
| C1 | Remove legacy code paths (sync, name-matched copies, providers, category inheritance, base-price override) | Code |
| C2 | Drop retired tables and columns, with `IF EXISTS` and a precondition block | Contract |

**Four ordering hazards inside these passes**, all found in the second pass:

1. **Pass 0 has an internal dependency.** All five owed migrations exist in the repository, but
   `20270204120000_calendar_schedule_periods.sql` backfills from `20270203120000`, so they ship in
   that order or the backfill has nothing to read.
2. **The `host_venue_id` refusal trigger must not land before reconcile stops running on renders.**
   §6.3 adds the trigger in Pass A; "reconcile off renders" sits in W7, which depends on W3 and
   W6. But `reconcileCollective` transfers hosting with a direct `UPDATE venue_collectives SET
   host_venue_id` (`src/lib/linked-accounts/collectives.ts:566-570`) and is reached from an
   anonymous `/book/c/{slug}` render (`collectives.ts:933`, `collective-page-view.tsx:49`). Ship the
   trigger before W7 and the public combined page raises and 500s for every guest. Gate the trigger on
   `service_model = 'replicas'`, as the lock triggers already are, or move reconcile off renders
   into Pass A's prerequisites. Gating is cheaper and is the recommendation. The trigger must also
   let `collective_transfer_host` itself through, by the engine flag, or the one legitimate writer
   is refused with everyone else.
3. **The column classification registry belongs in Pass 0 or Pass A, not with the engine.** RT1-10
   is written as a future risk, but the failure mode is live today:
   `copyColumns(service, SERVICE_COLUMNS_NOT_COPIED)` (`service-duplication.ts:48-60,365`) copies
   every `service_items` column except eleven named ones, from one independent business into
   another, on every host tick. Any venue-scoped column added since then is already being copied
   silently, and that path keeps running from Pass A through Pass B until C1 replaces it. Ship the
   registry and its enumerating pgTAP test early, and make `service-duplication.ts` read it. That
   is W3a, the first part of W3 and its own deliverable, which W1b and W9 depend on (§8.3).
4. **The legacy sync columns stay client-writable through Pass B.** `synced_from_service_id`,
   `sync_state` and `synced_at` sit on `service_items`, which `staff_manage_service_items` covers
   `FOR ALL`, and nothing constrains the referenced service to another venue, to the host, or to
   this collective. A member can point its copy at any service and receive shape pushes from it.
   Add `CHECK (synced_from_service_id IS NULL OR synced_from_service_id <> id)` and a trigger
   refusing client writes to the three columns while a replicas-mode collective is live, in Pass 0
   or Pass A, then retire them in C2 as planned.

### 8.3 Workstreams

Effort is relative (S small, M medium, L large) and assumes one engineer familiar with the code.

| # | Workstream | Effort | Depends on |
|---|---|---|---|
| W0 | Production survey and the D31 owed-migrations pass (every owner decision is taken); the survey counts `service_items` rows with `is_bookable_online = false` at every venue before W4 starts honouring the column (§6.6) | S | none |
| W1 | Booking correctness on today's model, in two parts under one id. W1a, starting now: one resolver over today's two custom columns, per-calendar price and length in the catalogue, base-price override removed, variant-aware availability, chain windows, price snapshot with settling readers, staff actor stamps, Stripe readiness (`stripe_charges_enabled` and its backfill). W1b, after W15 and W8: the resolver over all seven per-calendar fields, with the deposit path and the card-hold floor | L | W0 (D4, D6); W1b also W15, W8 |
| W2 | Calendar assignment hardening: both assignment writers (`PUT practitioner-services` and the `practitioner_ids` half of `PATCH appointment-services`) become diff writes inside one transaction, with `expected_service_ids` and `expected_calendar_ids`, stable row ids, every custom and attribution column preserved across an unrelated save, own-venue checks on service and calendar ids, the 24-hour rule for clients without expected ids, and `service_items.updated_at` with `expected_updated_at` on the Services page. W8, CSA-01 to CSA-03, D15 and SEC-05 depend on this landing first. It is the first of the four edits to `PATCH appointment-services`, which land in the order W2, W8, W6, W5 | M | none |
| W3 | Engine schema and functions dark, in two parts under one id. W3a, first and its own deliverable: the column registry `collective_column_classes`, seeded and classified for all eight tables (D53, D40), with its enumerating pgTAP test (DB-07, DB-10), and `service-duplication.ts` reading it. Then the engine: tables, revisions, dirty and lock triggers, apply, claims, verifier, grants, pgTAP and concurrency harness, reading the registry | L | Pass 0 |
| W4 | Derived catalogue and booking switch: exclusions, fingerprint freshness, compliance serving, collective booking audit; the parked-service exclusion from every listing, availability read and create route for new bookings, never from a path that serves an existing booking (D2, §6.6); every diary column, New and Walk-in opening the collective form, with `staff-collective` `calendar_ids` including the venue's own calendars (graft 5 revised); and `is_bookable_online` wired on every venue (staff forms list it, public pages, public availability and public creates do not) | M | W1, W3 |
| W5 | Host Services page (the service page, not a dialog), offerings routes, collective calendars section, per-calendar values for hosts, the "Parked" pill and filter, "Staff bookings only" and the Add service checkbox ticked by default, the D50 undo, notices (with the new notification group NOT-01: N32, N33, N36, N37); the fourth edit to `PATCH appointment-services` (`collective_calendars`, `collective_sync`, inline apply), after W6's guard | M | W3, W4, W6 |
| W6 | Member locks and member UI: guards (the projection guard is the third edit to `PATCH appointment-services` and runs before the assignment diff write), error codes, Services sections (including "Parked while you are part of {collective}"), `MemberServiceView`, Calendar Availability groups, add-ons, categories, compliance | M | W3, W8 |
| W7 | Lifecycle: the create wizard (UI-C-01), join with consent and choices (park or ask for each member-only service), adoption review, host-initiated adoption, release follow-ups, dissolve page, host transfer with re-keying and the transfer window, venue deletion, reconcile off renders, exclusivity, the currency gate and the booking-model lock on `PATCH /api/venue` (BM-04, TERMS-15), a guard that no lifecycle path writes `account_links` (D41, LIFE-09, LIFE-14), **cross-venue contact search while live** (D41), and (decided 2026-09-16) the routes and Venues-tab controls for Ask to host and End the collective, which must call the engine's host transfer and dissolve rather than the older routes, plus the member suspension cron that sets and clears `suspended_at` with its notices N36 and N37. As built (2026-09-16), the join dialog's consent carries the mutual-visibility wording W17 needs (REP-03), and `join.block.*` gains three sentences the deck lacked: a generic other-collective one (the engine's blocker does not name it), booking model, and account links. Leave, removal and a broken link release through the engine on this model (`release-actions.ts`; the reconcile releases with `link_ended` and never writes during a render); a collective left with one venue ends as the system with `below_two`, but waits while an invitation could bring it back to two, as the older reconcile does, and the verify cron sweeps for it; the release follow-up copies each page photo into `venue-service-photos/{venue}/` and adds it to the venue's own `booking_page_config.service_photos`, never replacing one the venue chose; the review panel's dismissal is a `review` row in `collective_notice_marks` (20270218140000). Host-initiated adoption (20270218150000): `collective_add_from_venue` copies the member's service (host and venue registry columns, active options) into a new host service, offers it, and holds the member's own link back (released before it was ever applied) so nothing is copied until it answers; pending is derived from the audit (`collective_adoption_pending`: an `adoption_requested` row with no later `adoption_answered`); the answer is its own function, `collective_answer_adoption`, because `collective_join_member` on an active member acts on every offering and would settle other open questions as new copies; the verify cron sends the day-7 reminder and applies the day-14 default as the system; invite and accept refuse a venue in another live collective with `COLLECTIVE_VENUE_IN_OTHER_COLLECTIVE` | L | W3, W6 |
| W8 | Five per-calendar fields end to end; the second edit to `PATCH appointment-services`, keeping the five columns in the assignment rows across a save | M | W2, W15, D5 |
| W9 | Migrate existing collectives: survey, rehearsal, dry run, owner signature, apply, rollback, residue (§7, D54) | M | W3 (W3a), W4 to W7 live |
| W10 | Booking pages and links: redirect conditions for members and the host (§6.9), translation (which reads `collective_service_items.master_service_id`, W3), a link to a parked service landing on the collective page's service list (the interstitial is withdrawn, D2), address adoption only after the member's admin confirms (§6.9, N38), `/embed/c/{slug}`, trader line, one live-collective resolver, dissolved page. Before the engine lands, rewrite the dissolve comment at `src/lib/linked-accounts/collectives.ts:550-552`, which says every venue's own services are "already pristine" on dissolve (copies exist, so it never was true), and the Leave dialog copy at `src/components/linked-accounts/VenueCollectivesPanel.tsx:365`, "Your own booking page is unaffected.", which D3 makes false | M | W3, W4, D3 |
| W11 | Combined-page manager fold and catalogue compatibility shims; the bulk lane calls the engine's offer and calendar functions through `POST /api/venue/collectives/[id]/bulk` and `.../bulk/preview`, so CB-44 and CB-45 are fixes to today's manager, not prerequisites of the grid | S | W5 |
| W12 | Mobile contract, `MOBILE_API.md`, handover, including every diary column opening the collective form in old builds (APP-03); the app's leave copy, which mirrors `VenueCollectivesPanel.tsx:365` in telling a member its own page is unaffected, is rewritten with W10's, before the engine lands | M | W5 to W7 |
| W13 | Help centre, spec, PRD, docs index, including parked services, "Staff bookings only" and D32's host-controlled settings | M | W5 to W11 |
| W14 | C1 code removal, then C2 contract | S | W9 on both environments |
| W15 | Grants hardening (anon writes on service tables, anon read of assignments) | S | live grant check |
| W16 | Multi-venue people: the invite route refuses an email that already works at another venue, with a plain message, and the silent redirect into signup is replaced by one that says what happened and who to contact. No venue chooser (D38), so this is small | S | none |
| W17 | Reporting and attribution: read `bookings.collective_id` (no collective value for `source`, D55), per-venue breakdown and venue names in Booked revenue, the mutual-visibility consent at join, collective filters and export columns, and `buildPriceSummary` on the snapshot (SB-30, SB-31, D49) | M | W1a, W7 (the join dialog's consent, REP-03) |
| W18 | Operations: the two crons, the verifier and its repairs, alert thresholds, and the platform support console's collective panel (§6.16) | M | W3 |
| W19 | Public identity and reach: metadata and canonicals on `/book/c/{slug}` and every member page, the waitlist on the synthetic venue, the full resolved flag set, "any available" fairness and order (SB-33, SB-37, SB-40, PB-17, D43, D48) | M | W10 |
| W20 | Booking models and eligibility: appointments-only gates at invite and accept, the member warnings, the "also runs" line, `entity_type` and the real model list (§6.14, D44, D45). The currency gate and the booking-model lock are W7's; BM-02's lock test is kept here only as a reference | S | W7 |
| W21 | Diary truth: partner columns drawn from the resolved schedule rather than the weekly template, the cross-venue move dialog, the shared-person warning, and folding or fixing `/dashboard/linked-calendar` (SB-39, SB-41, D46, D47; DIARY-02, DIARY-03) | M | W4 |

W16 and W17 carry live bugs and should start with W1a and W2 rather than waiting on the engine.
W16 in particular is a prerequisite for the product being usable by the most likely collective of
all, two venues under one owner, and every journey in the specification is written as though it
were already solved.

Critical path: W0, Pass 0, W3 (W3a first), W4, W6, W7, W9, W14. W1a, W2, W3a, W16 and W17
start immediately: they fix live bugs and must be in place before any price can propagate. W1b
waits for W15 and W8. (W7a, an interim workstream to end account links at leave, was withdrawn on
2026-09-14 by D41.)
W10 and W11 run alongside W5 to W7.

---

## 9. Testing plan

The full plan is `Docs/collective-one-venue-test-plan.md`. Its shape:

- **Fix the test blind spots first.** Extend the projection guard
  (`src/lib/testing/migration-columns.ts`, committed in `973bd3e`) so doubles can no longer hide a bad
  column; stop CI's baseline grants re-granting the engine tables; make route tests run `after()`
  callbacks; stop the e2e suite passing by skipping. Three more blind spots the second pass found:
  nothing tests the cron wrapper this design's two new crons depend on, nothing tests the platform
  console, and nothing stops an em-dash reaching a help article, on a project that rewrites about
  twenty of them.
- **170 tests across layers**: 36 unit and sweep, 58 route, 10 component, 30 pgTAP, 4 engine
  invariant, 8 migration, 3 app-contract, 5 end-to-end, 6 live-staging, 4 performance,
  4 security, 2 manual. Key groups: the terms resolver and price snapshot (TERMS, PRICE),
  assignment writes (CSA), engine objects, locks and convergence (DB, ENG, REV), real two-connection
  races (CON), the derived catalogue and forms (CAT, CMP), guards (GRD), lifecycle (LIFE), migration
  (MIG), public pages (PUB), the app's real payloads from build 1.1.0 (APP), security, performance
  budgets, and end-to-end journeys such as "a guest books a member calendar with a deposit and a
  patch test form including a file upload". The 34 added by the second pass are the OPS, MV, REP,
  BM, PLAN, SEO, WAIT, FAIR, DIARY and HLP groups plus TERMS-16, CSA-04, DB-10, SEC-03 to SEC-05,
  LIFE-09 and LIFE-10, covering operations and alerting, people who work at more than one venue,
  reporting and attribution, booking models other than appointments, plan tiers and caps, the
  public page's metadata and waitlist, diary truth, help copy, and D41 (account links untouched by
  every lifecycle path; the collective contact search). The
  UI review added UI-C-01 to UI-C-06, the verification pass CSA-05 to CSA-08, and the consistency
  pass of 2026-09-14 thirteen more: OFF-05 (the undo), OFF-06 (host-initiated adoption), LIFE-11
  (same-name pairs after leave), LIFE-12 (invitation withdrawal and expiry), LIFE-13 (the paused
  state and the transfer window), LIFE-14 (today's leave, removal and dissolve routes leave account
  links untouched; repurposed 2026-09-14 when D41 withdrew W7a), REP-06 (reports
  after the end), DIARY-02 and DIARY-03 (D47 and D46, in W21), PUB-05 (other booking models keep
  the own page), MIG-05 and MIG-06 (bookings protected, and the host's values at the switch) and NOT-01 (the
  new notification group: N32, N36, N37). By pass: 113 from the first, 34 from the second, 6 from
  the UI review, 4 from the verification pass and 13 from the consistency pass, 170 in all.
- **Engine testing inside Postgres**: every apply returns write counts, so a second apply must
  write nothing; columns and unique indexes are enumerated rather than listed; every lock is tested
  both refusing and allowing; deterministic race points; randomised convergence (50 rounds in CI,
  1,000 nightly).
- **Invariants** in one service-role function, run identically by pgTAP, the daily verifier, the
  migration script and every deploy step (I1 to I48, 37 numbered invariants plus I3b, 38 in all:
  the test plan defines I1 to I8, I10 to I16, I21 to I24, I30, I32 and I3b in SQL and I33 to I48
  in its table, and I9, I17 to I20, I25 to I29 and I31 do not exist; plus the dry-run checks P1 to
  P5). I33 to I47 were added by the second pass, and I48 by the migration review, and cover, among
  others, a member silently withdrawing a calendar
  by deleting it, an applied replica with no audit row, and client privileges on the legacy tables
  that I24 never looked at. The invariant SQL lives in the test plan; the DDL and functions it runs
  against are Appendix C (engine DDL) and Appendix D (engine functions), and the migration script
  it gates is Appendix G (migration script).
- **Rollout gates** for each pass with go and no-go conditions and rollback drills, including a
  staging point-in-time restore before the contract migration.
- **Live checks on shared staging** write only to marked `e2e-coll-*` fixture venues with a cleanup
  ledger; plus-1 gets read-only snapshots and only the owner-approved migration.
- **Owner acceptance checklist** in plain language, one block per requirement R1 to R14, plus money
  and safety checks.

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| An engine defect writes wrong prices, deposits or forms into many member accounts | Medium | High | Per-collective switch; dry runs with column diffs; pgTAP convergence and idempotency; fingerprint verifier; audit with before and after values; staging soak |
| Host-set prices charged by independent businesses create legal exposure (competition, employment status, consumer information, data roles) | Medium | High | Counsel complete (D9); recorded consent; trader line; members may leave at any time and keep everything |
| A forgotten write path hits a lock and returns 500 | Medium | Medium | Writer registry test; route guards with coded 409s; dedicated SQLSTATE |
| Replication lag lets a guest see stale terms | Medium | Medium | Fingerprint omission on public paths; staff refusal while behind; snapshot freezes what was charged |
| Members lose their online channel through redirects | Medium | High | Redirect only when live, converged and listed; status line on the Booking Page tab |
| Price edits rewrite members' history | Low after W1 | High | Snapshot backfill of all bookings; settling readers read it first; invariant I6 |
| Old app builds confuse users with refusals | High | Low | Readable prose; normalised guards; consent refusal; handover |
| Future data migrations fail on replica rows | Medium | Medium | Documented engine bypass plus a CI migration lint |
| Production differs from staging (owed migrations, duplicates, collisions) | Medium | Medium | Pass 0; read-only production survey; invariants before each push |
| Members resist losing control of member-only services | Medium | Medium | Any service one venue offers can be added to the page; "Ask the host to add it" at accept; parking is derived and lifts the moment a member leaves; existing bookings stay manageable; clear labelling; leave at any time (D2) |
| Trigger overhead on hot service tables | Low | Low | Early exit for venues outside replicas collectives; performance budgets |
| A host save deadlocks against a concurrent apply, because the dirty triggers sit outside the stated lock order | Medium | Medium | Triggers bump revisions only, in id order, and never touch the master afterwards; the apply reads the master without a row lock; CON-03 covers the pair (§6.4) |
| A manual fix made in the SQL editor leaves no audit row, and the daily verifier then repairs over it, so a legitimate change disappears without trace | Medium | Medium | The verifier files unexplained drift as its own audit type with the before-image and alerts, rather than absorbing it; I41, SEC-04 (§6.4, §6.16) |
| The new per-calendar and attribution columns land on a table `anon` can read in full, including an `auth.users` identifier | Medium | High | Drop `public_read_calendar_service_assignments` and serve the public catalogue through the admin client before those columns ship; SEC-05, I42 (§2.2) |
| A guest's pre-booking form files at one venue and they are booked at another, so the venue that needs the record does not hold it | Medium | Medium | Collect inline forms once the calendar is fixed, as RT2-2 already requires; name the receiving venue where a form must come first; SEC-03 (§6.6) |
| A member loses its classes, events or bookable resources from the web when redirects begin | Medium | High | Appointments-only stated in the product, warnings before accept and before redirects, and a route through for the other models; D44 (§6.14) |
| The fold makes setting up a collective slower than the manager it replaces | High | Medium | The bulk lane ships with the fold, not after it; specification §2 item 15 (§6.8) |
| A person who works at two venues cannot use the product at all | High today | High | W16 ships before the collective work; D38 (§6.17) |

---

## 11. Decisions for the owner

Numbering follows the design documents, so the companion specification and test plan refer to the
same ids. The recommended default is in bold.

### 11.1 Before any build

| id | Decision | Recommended |
|---|---|---|
| D9 | Brief a solicitor on the model itself: one business setting prices and terms that independent businesses charge through their own Stripe accounts (competition, employment status, the information guests must see about who they are booking with, data controller roles), and approve the consent text | **COMPLETE 2026-09-14.** The owner recorded counsel as complete; the consent text, trader line and unticked marketing consent stand as designed |
| D27 | Are host prices enforced, or recommended prices that calendars may vary within the host's permissions? | **DECIDED 2026-09-14, with D9 and D29: host prices apply everywhere unless the host turns on the per-calendar price permission for that service (D4).** The design supports both through the same permission, so nothing changes shape |
| D18 | One live collective per venue, as host or member, enforced in the database | **Yes** |
| D31 | Ship production's owed migrations as their own deploy pass before this work | **Yes** |

### 11.2 Shape of the product

| id | Decision | Recommended |
|---|---|---|
| D1 | A joining member's same-named service | **A new host-managed replica; "Use mine" only through the reviewed adoption.** The member's own service kept separate is parked while the member is live (D2) and both stay active after it leaves (D52) |
| D2 | Member-only services while in a collective | **REVISED 2026-09-14 (later the same day). Venues in a live collective offer only the collective's services. Every other appointment service at the host or a member is parked: not bookable in any staff form, diary, walk-in flow or public page, derived from state rather than stored, and lifted the moment the venue leaves or the collective ends. Existing bookings on a parked service stay fully manageable.** The owner's words: offering both collective services and their own is overly complicated, and a service that only one venue or calendar offers can still be added to the collective, so nothing is lost. At accept a member parks (default) or asks the host to add each; every diary column opens the collective form (graft 5 revised); `is_bookable_online` gives the host staff-only offerings (§6.6). The earlier answer, "kept for bookings the member's team makes, not bookable online", is withdrawn |
| D3 | Own booking pages while the collective is live | **DECIDED 2026-09-14. The collective page is the venue's booking page for as long as it is in the collective, and it supersedes every member's own page, the host's included.** The conditions in §6.9 (live, converged, at least one calendar listed) are a safety net so a redirect can never send a guest to a page that cannot take their booking, not a softening of the rule. Whenever those conditions hold, which is the normal state, the own page hands over |
| D4 | Who may set per-calendar values | **Calendar staff within the flags, that venue's admins, and host admins** |
| D5 | Build the five missing per-calendar fields | **Yes** |
| D6 | Turning a staff permission off | **Clear stored price, deposit, length and buffer values with an ask and a notice; ignore colour** |
| D7 | Price snapshot backfill scope | **All past and future appointment bookings at every venue** |
| D8 | Payments | **Members collect on their own Stripe accounts; calendars without charges-capable Stripe are hidden from guests for paid services** |
| D10 | Compliance | **Forms must be on at members with form-bearing offerings; a member's existing records of the same library form count; member venue-wide forms apply on top; host venue-wide forms apply to every collective service** |
| D11 | Location, meeting link and joining information | **Location follows the host; meeting link and joining information are per venue** |
| D12 | Host transfer | **DECIDED 2026-09-14. A request with consent, notice and free leave, and it ships in the first release**, because the paused state's take-over (D35) runs through the same function |
| D13 | Taking a service off the collective page | **Member replicas retire (inactive, calendar choices kept, restored if re-offered)** |
| D14 | Deleting a host service that is on the collective page | **Blocked until it is taken off the page** |
| D15 | May a member re-add a calendar the host removed | **Yes, with "Last changed by" on both sides and a notice** |
| D16 | A member replica that is behind | **Hidden from guests at once for that service; staff bookings refused with a retry message; host and member told after 15 minutes; ops paged after 60** |
| D17 | Staff authority and client details | **Collective role authorises staff booking.** The two other clauses of the original recommendation, that client details are typed for another venue's calendar and that mesh links are offered for downgrade, are overridden by D41 (§11.4): inside a live collective the picker searches every member venue and books against the existing record, and account links are never downgraded, released or ended by anything the collective does |
| D19 | Collective page headings and order | **Follow the host's Services page; the separate collective headings are retired** |
| D20 | Photos | **The host's service photos; a member receives its own copies of the photo objects when it leaves** |
| D22 | Host subscription lapse | **Page paused; dissolve after 30 days** |
| D23 | Notices of host changes | **Immediate for price, payment and form changes; daily digest for the rest** |
| D24 | "Any available" across venues for services with options or add-ons | **Phase 2** |
| D25 | Old collective links after dissolving | **A neutral page listing former venues for 90 days** |
| D26 | Cross-venue removal dialogs | **Dates, times and calendars at other venues, never client names** |
| D28 | Group bookings across member venues | **Limit a group to the first person's venue, explained before the details step; split groups later if wanted** |
| D29 | Name and description delegation on offered services | **Off, so page, emails and booking records show one name.** DECIDED 2026-09-14, kept as written: calendars may vary price, length, buffer, deposit and colour within the host's permissions; name and description are one everywhere. CSA-03 and TERMS-13 test both the offered and the not-offered case |
| D32 | Venue-level settings (self-reschedule, waitlist, reminders, deposit settings, booking rules, sign-in) | **DECIDED 2026-09-14, per setting (table in §6.10).** Host controls (the host's setting applies to every venue while live; a member sees its own read-only, and it applies again after leaving): guest sign-in (the host's value only, replacing today's OR), guest self-reschedule, the waitlist on the page, "Any available" and the staff-first flow. Each venue, with "Different at {venue}" shown to the host: communication policies, SMS availability and in-person payments. Booking window, cancellation notice and deposits need no decision: for appointments they are per-service columns the host already controls. Nothing is "must match at accept" |
| D33 | Staff bookings while a member's replica is updating | **Refuse with "This service is being updated. Please try again in a moment."** |
| D34 | Alert the host to collective-page bookings on member calendars | **Yes, without client contact details** |
| D35 | A link change removes the host | **Pause the page and let a member take over hosting** |

### 11.3 Migration

| id | Decision | Recommended |
|---|---|---|
| D21 | Approve the staging overwrite list in §7 (corrected) and the production list after its dry run | **Review the dry-run report and sign it** |
| D30 | Should rollback restore members' before-images | **Yes; store before-images during the migration** |
| D36 | Offerings that only members provide (no host service) | **Create the host service active so member calendars stay bookable, with a report** |
| D54 | How an existing collective moves to the new model (§7) | **DECIDED 2026-09-14. The host's values apply to every service on the collective at the point of migration, and every existing booking is protected: calendar, service, price snapshot, terms and manage links untouched.** No review window, no notice before or after, no "Your previous settings" panel and no member value carried over: the owner tells the venues in person. Before-images are still recorded for rollback (D30) and the dry-run report is still signed (D21) |

### 11.4 Added by the second forensic pass (2026-09-14)

These come from the areas the first pass did not reach: reporting, operations, people who work in
more than one venue, booking models other than appointments, guest identity across venues, and the
public page's life outside the booking flow. Ids continue from D36 so nothing is renumbered.

They are split by who actually has to decide. Eight of the seventeen recorded here (D37 to D53)
have an obvious answer and are here to be recorded, not deliberated: the team should take them,
write down what it took, and move on. Nine genuinely need you, because they are commercial, legal
or about what the product promises (D52 was decided in conversation on 2026-09-14 and is recorded
below; D54, the migration of existing collectives, was decided the same way and is in §11.3). Do
not let the first group
consume attention that belongs to the second.

#### Decided by the owner, 2026-09-14

All nine are settled. The answers are recorded here as taken, with what each one changes.

| id | Decision | Answer |
|---|---|---|
| D38 | A person who works at more than one venue in a collective | **No venue chooser. Refuse the invite instead.** A person who already works at another venue cannot be invited, and is told plainly to use a different email address. The silent lockout (SB-28, PB-16) is still fixed, because it is a live bug: what changes is that the fix is a refusal with a clear message, not a switcher. The owner accepts that someone running two venues in a collective needs two logins |
| D39 | How a collective is priced, given each venue keeps its own subscription and calendar cap | **Accept the pooling. It is the point of the feature.** No per-collective charge, no member cap, no minimum tier to host. Nothing to build |
| D41 | Whether joining still means sharing client details | **REVISED 2026-09-14. A collective is extra functionality on top of account links with full access, and never changes them.** Client details are shared because the account links share them, before, during and after the collective. Leaving, removal and dissolve affect only the collective (its page, staff form, contact search scope and report view); a venue that leaves can still make, edit and cancel bookings for the venues it is linked with. See the wording below. The earlier answer, "shared while live and ended with the membership", is withdrawn |
| D42 | The same guest booking two member venues becomes two client records, permanently | **Accept, and explain it in the help centre only.** No product UI, no banner, no warning at join. A minor issue that help articles and customer service can cover |
| D44 | A member that also runs classes, events or bookable rooms | **Appointments only for now, stated in the product, and built so other models can be added later.** The guards, warnings and refusals in §6.14 all stand. The forward-compatibility requirement is new: see below |
| D49 | What a host sees about the collective's trade, and what a member sees about others | **Full mutual visibility, made explicit and consented at join.** Every member sees every other member's figures, as today, but named and broken down by venue rather than blended into one unlabelled total, and agreed to rather than discovered |
| D50 | Whether a host can undo a change that has already reached members | **Yes, 60 seconds.** "Put it back" in the save summary, restoring the master's before-image from the audit trail and re-applying |
| D56 | Whether a calendar's stored price and length stop applying when the service's staff permission flag is off (TERMS-02, SB-12). Decided 2026-09-15 | **Yes, straight away.** All seven per-calendar values apply only while their `staff_may_customize_*` flag is on, price and length included, in the application resolver (`applicableCalendarValues`) and in the booking price snapshot (20270214150000). A calendar holding a price or length with its flag off goes back to the service's own the moment the release ships; the owner accepted that (one such calendar on staging, a test venue; production counted by the W0 survey). Existing bookings keep their snapshot. D6's ask-and-clear flow is still to be built, now as a tidy-up of stored values rather than a precondition |
| D57 | What happens to a member's own requirements on a form the collective takes over (the apply adopting the member's form by template or name, or "use existing" at join). Decided 2026-09-16 | **They stay and stay editable.** The member's own services keep their protection; only a new requirement on the managed form, or moving one onto it, is refused (RT1-13, RN004). `compliance_types.managed_since` records the takeover and the lock and I15 compare each requirement's `created_at` with it (20270216190000) |
| D55 | Whether `bookings.source` gets a collective value (§6.15). Decided 2026-09-14 | **No.** `bookings.collective_id` is the attribution: Booked revenue, the bookings list, its "Booked through" filter and the bookings export all read it (W17). About 29 checks in the web code treat `booking_page` as a public source to decide deposits, whether an email is required and form checks; a new value would have to be added to every one, a missed one would change what a guest is charged, and the mobile app would receive a value it does not know. No source backfill runs in Pass A |
| D51 | Whether host changes may carry a future effective date | **Not planned.** Changes apply straight away. Remove it from the open questions rather than carrying it as phase two |
| D52 | What "reverting to their own services" means for the host's services in a member's account when the member leaves or the collective dissolves. Decided 2026-09-14 | **They stay, as ordinary services the member owns.** The owner's words: they were real services the member was offering, and it is highly likely they would want to continue offering them. So release lifts the lock and changes nothing else: the released service keeps its settings, its calendar choices and its bookings, and appears on the member's own page once that page is showing again. Nothing is parked, retired or deleted at release. Where the member kept a same-named original separate at join (the D1 default, parked while live under D2), both stay active and the released one carries `svc.member.card.cameFrom` ("Came from {host}") for 30 days so the two are telling apart; the member decides what to do with the pair, and nothing decides for them |

**D41 in full, as revised by the owner on 2026-09-14.** The owner's words: a venue collective is
additional functionality on top of an account link with full access. Ending or leaving a collective
should only affect the functioning of the collective booking page and the rest of the collective. A
venue that leaves can still be linked with other venues and have full access to making, editing and
cancelling bookings for another venue, and that must remain.

Checked against the code, the account-link half already behaves this way and must be kept:
create, invite and accept require every pair of venues to hold a full-access account link first
(`checkCombinedEligibility`, `collectives/route.ts:138`, `members/route.ts:123,228`), and leaving,
removal and dissolve only flip the membership row's status (`collectives/[id]/members/route.ts:189,280`
and `collectives/[id]/route.ts:259-263`), touching no `account_links` row.

So D41 as decided means three things:

1. **The account links are the foundation, and the collective never writes them.** No lifecycle
   function, engine function, migration step or route in this project creates, narrows, releases or
   ends an account link. Ending or narrowing a link below full access still removes that member
   from the collective, as today; the reverse never happens.
2. **Say plainly at join what the links already share.** The disclosure names what a linked venue
   can see (name, contact details, visit history, tags, notes, documents and compliance records),
   says that this comes from the account links, and says that leaving the collective does not
   change it: the links are managed on Linked accounts.
3. **Build the seamless part as a collective feature**: while the collective is live, a member's
   staff can search and open another member's contacts, with the owning venue named on every
   record. That search scope, the collective staff form and the collective report view end with
   the membership; what the account links grant on their own carries on.

The first version of this answer ("shared while live, and it ends when the membership does") was
based on a misreading of what the owner wanted. It produced SB-42, the release step that ended
links, the `created_for_collective_id` column, the link classification in §7 and workstream W7a.
All are withdrawn.

This replaces the earlier recommendation to drop the link mesh. It also overrides **D17**, which
said a member's staff must type a client's details when booking on another venue's calendar: inside
a live collective the sharing is the arrangement, so the contact picker works across member venues
and the typed-details rule applies only where no live collective exists.

**One thing D41 does not repeal.** D26 ("never client names" in cross-venue removal dialogs),
D34 (the host alert "without client contact details", N32), RT1-17 ("no guest names across
venues"), §6.7's affected-bookings check "without client names", §6.11's rule that the
affected-bookings payload must not carry client names for another venue's bookings, and the OFF,
CAT and UI-H tests all deliberately minimise client names in dialogs, notices and payloads, even
though the account links let venues see each other's client records. That is on
purpose: a venue that wants a client's details opens the record through the contact search, where
the owning venue is named; a notice or a refusal dialog is not the place for them.

**D44's forward-compatibility requirement.** Appointments only is a scope decision for this
release, not a permanent shape. Two things make the later work an addition rather than a rewrite,
and both are cheap now and expensive later: give the offering record an entity discriminator on
`collective_service_items` (`entity_type text NOT NULL DEFAULT 'service' CHECK (entity_type IN
('service'))`, §6.3), so a row can say what kind of bookable thing it points at rather than being
an untyped service id; it never lives on provider rows, which C2 drops
(`20261210120000_combined_booking_page.sql:105-132` has no such column today); and keep the
synthetic venue's booking model list a genuine list rather than the hard-coded single
value it is now (`collective-venue.ts:163-165`). Neither changes behaviour in this release.

#### The team can take these

Recorded for the record. Each has one sensible answer and no commercial or legal content.

| id | Decision | Take this |
|---|---|---|
| D37 | Where the switch that puts new collectives into replicas mode lives. Flags today are per venue (`venues.feature_flags`, a closed six-key registry read per venue) and a collective spans venues, so there is no answer to "which venue's flag decides" | **A platform-level setting on the platform console, audited, deciding only what value new collectives are created with. `venue_collectives.service_model` stays the per-collective truth. Do not add a seventh key to `APPOINTMENTS_FEATURE_FLAG_KEYS`** |
| D40 | `capacity_per_session` on a collective service, where a member's room is smaller than the host's | **Venue-controlled, with the host's value as the starting point at join. A host cannot know another business's room size, and overbooking a member's room is a failure the guest experiences** |
| D43 | The waitlist on the collective page, which cannot appear today because the synthetic venue publishes only two resolved flags | **Publish the full resolved flag set on the synthetic venue and give the waitlist route a collective branch, so a guest can wait for the collective the way they can wait for a venue. Without it the page is worse than the member's own page it replaces** |
| D45 | Two venues sharing one physical room or piece of equipment | **Not supported, and said so plainly, until a cross-venue resource exists. Today each venue can put the same real room on a calendar and the platform will double-book it (SB-36).** Confirmed 2026-09-14 that resources are a live booking model, so this is a real scenario rather than a theoretical one, and it is most likely in exactly the collective shape D38 and D39 identify as commonest: venues under common ownership, sharing premises |
| D46 | Moving a booking to a calendar at another venue in the collective | **Keep it refused, and rewrite the dialog to say why without offering the lossy rebook-then-cancel path. A true cross-venue move transfers ownership, which §6.1 forbids, so specify it as its own project if it is wanted** |
| D47 | One practitioner with a calendar at two venues, who can be booked twice at the same moment (SB-38) | **Warn, do not model, this release: flag two calendars in a collective that share a name and email, and show the clash to whoever books second. A person identity above the venue is a platform change, not a collective one** |
| D48 | Search engines and link previews for the collective page and members' pages, which have no canonical, no Open Graph image and, on `/book/{venue}`, no metadata at all (PB-17) | **Give `/book/c/{slug}` full metadata and make it canonical for any address it has adopted; give member pages their own metadata and a canonical pointing at whichever page actually serves them. Do this in the same workstream as the redirects, because they answer the same question** |
| D53 | The two column-registry classes still marked undecided: `pre_appointment_instructions` and `online_unmet_message` (§6.3) | **`pre_appointment_instructions` is venue-controlled, seeded from the master at creation, because it describes the venue the guest visits; `online_unmet_message` is host-controlled, because it belongs to the form definition.** Recorded in `collective_column_classes` (Appendix F) |
| DL2 | Retired replicas at release (§6.7) | **Stay inactive**, listed with the member's other inactive services |
| DL3 | Services parked while live, at release | **REVISED 2026-09-14 (D2). Nothing to un-park:** parking is derived and ends with the membership, so they are bookable again at once, and the review panel names them. The join job's `paused_service_ids` and the release's un-pause step are withdrawn |
| DL4 | The old page address after a dissolve | **The same host may reclaim it early for a re-formed collective**, and the neutral page then redirects there; the name hold follows the same rule |
| DL5 | Reconnect at re-join | **Same host only**, and reviewed like an adoption when the member changed the released service in between |
| DL6 | The account-link mesh at re-join | **REVISED 2026-09-14 (D41). Accept requires the full mesh, as today, and creates no links.** Leaving and dissolving leave the links in place, so a re-form is still one invitation and one acceptance |
| DL7 | The interim fix for SB-42 on today's model | **WITHDRAWN 2026-09-14 (D41).** SB-42 is not a defect, so there is nothing to fix and no W7a |
| DL8 | Invitation expiry | **30 days**, status `removed`, the N1 reminder at day 7, N35 on expiry |
| DL9 | The paused state | **A flag on `active` (`paused_at`)**, not a fourth status value, so every "status = active" reader keeps working |
| DL10 | The host's own row at dissolve | **Goes `left` like everyone's**, so one release trigger handles every venue the same way; no account link is touched (D41) |
| DL11 | Reports after the end (settled here, not as r3-05 recommended; revised 2026-09-14 by D41) | **The collective view goes**, with the "via {collective}" filter kept for the venue's own bookings and no frozen collective view; what a venue still sees of other venues' figures follows its account links' own revenue grant, as for any linked venues |
| DL12 | A link choice in the Leave dialog | **No choice**, because leaving never touches account links; `leave.body.access` says so and points to Linked accounts for managing them |

---

## Appendix A. How this was produced

- **Round one.** Eight forensic maps (data model and grants; lifecycle; combined-page manager,
  copies and sync; Services page; Calendar Availability; Booking Page tab and public pages; booking
  engine; other consumers and principles), about 566,000 characters with `path:line` evidence and
  read-only staging probes. A cross-examination that resolved 12 contradictions, verified 25
  load-bearing claims (21 confirmed, 4 corrected) and added 8 facts every map missed. Two complete
  competing architectures.
- **Round two.** Two red-team reviews (17 and 28 findings, 45 assumption checks, inventories of
  every writer of the service tables, every live price reader and every venue-level setting), the
  page-by-page specification and the test plan.
- **Scale.** 15 agents, about 7.9 million tokens and 2,200 tool calls, about 3.5 hours.
- The working files (maps, cross-examination, both architectures, both reviews) were kept in the
  session scratchpad and are not committed. Everything a builder needs is in this document and its
  two companions.
- **Round three, 2026-09-14 at `c0b5eb0`.** Ten forensic readers over the areas round one did not
  reach, plus a citation audit of the three documents themselves. Their scopes: the service
  delegation model (the `staff_may_customize_*` flags and per-calendar values); reporting,
  analytics and exports; contacts, communications, marketing and the portal; booking models other
  than appointments, and shared resources; the diary and availability infrastructure; the whole
  public guest journey including SEO; the host's management experience judged as a product; the
  help centre, the assistant and the mobile contract; authorisation, RLS, grants and cross-venue
  data integrity; and an audit of every `path:line` in all three documents.
- **What round three changed.** 195 citations checked, of which 186 resolved cleanly, one was
  mis-anchored (PB-09) and one only half-evidenced (SB-07); both are corrected, and the documents'
  baseline commit is now stated honestly, because three cited files did not exist at `c6020eb6`
  and only existed as the uncommitted work that became `973bd3e`. Fifteen split-brain cases
  (SB-28 to SB-42), thirteen collective bugs (CB-41 to CB-53, from the UI review), four platform
  bugs (PB-16 to PB-19), sixteen decisions (D37 to D52), six workstreams (W16 to W21), four
  design sections (§6.14 to §6.17), fifteen invariants (I33 to I47) and forty-four tests were
  added. Several existing claims were corrected against the code:
  the per-calendar 400, the flags' second job gating venue-wide edits, the deposit having no
  resolver path at all, four missing resolver callers, currency being gated nowhere while timezone
  is gated twice, the lock order excluding the very triggers that invert it, and the FK-cascade
  exemption being unimplementable as written.
- **What it confirmed.** The load-bearing claims held up. `calendar_service_assignments` really
  does hold only two of the seven custom columns; the seven flags exist and there are exactly
  seven; `anon` really can read every assignment row; the 27 original split-brain cases, the 55
  original bugs and the 113 original tests all counted correctly; and there is not one em-dash in
  any of the three documents.
- **Scale of round three.** 10 agents, about 2.7 million tokens and roughly 1,300 tool calls.
- **Round four, the consistency edit of 2026-09-14.** Six reviews over the three documents
  (requirements, buildability, migration, lifecycle, consistency and the calendar doors),
  reconciled through one register of settled decisions. It added D53 and D54, the lifecycle answers
  DL2 to DL12, workstream W7a and the parts W1a, W1b and W3a, invariant I48 and thirteen tests
  (170 in all), rewrote §7 to the non-destructive migration package, and made the three documents
  use one vocabulary (Appendix B).
- **Round five, the readiness review of 2026-09-14.** One reader over all three documents, checked
  against the code before building. It found that the D41 release could not work, because create,
  invite and accept require the full account-link mesh before the invitation (so no link was ever
  "created for the collective"). The owner then revised D41: a collective sits on top of account
  links and never changes them. SB-42, DL7, W7a, the `created_for_collective_id` column and the §7
  link classification were withdrawn; LIFE-09, LIFE-14 and I47 were repurposed to guard the
  opposite (170 tests and 38 invariants unchanged). It also settled three naming contradictions in
  Appendix C (`collective_service_item_id`, `replica_service_id` `ON DELETE SET NULL`,
  `support_session_id`), added `COLLECTIVE_SERVICE_RETIRED` to the one code list, and rewrote the
  specification's §7 as answers, leaving three points open (§0). The owner and the team answered
  all three later the same day: D2 revised (venues offer only the collective's services, the rest
  parked), D32 decided per setting, and a member's admin must confirm before its page address is
  adopted.

## Appendix B. Glossary

| Term | Meaning |
|---|---|
| Host | The venue whose services the collective offers and whose admins control them |
| Member | A non-host venue in the collective |
| Master | The host's own service row for a service on the collective page |
| Replica | The locked row for that service in a member's account, written only by the engine; "the service from {host}" in copy. Not a "copy" (below) |
| Copy | Reserved for the legacy shape: a `linked` or `customised` service copy made by today's manager (§2, §4, §7). Never the new replica |
| Replica link | A `collective_service_replicas` row: the engine's record that this member holds a replica of this offering, with its revisions, fingerprint and `released_at`. The bare word "link" is not used for it in new text |
| Account link | An `account_links` row: the pairwise grant between two venues. A collective requires a full-access account link between every pair of its venues and never changes one (D41). The bare word "link" is not used for it in new text |
| Provenance | The replica link's `provenance` column: `created`, `adopted`, `migrated` or `reconnected`. "Origin" keeps its legacy meaning, the `synced_from_service_id` a copy follows |
| Derived provider | A catalogue entry computed from assignments, one per calendar that offers the service (§6.6). The `collective_service_providers` table is dropped in C2 |
| Offering | The collective page's record that a master is on the page |
| Assignment | A `calendar_service_assignments` row: this calendar offers this service |
| Per-calendar values | Custom name, description, length, buffer, price, deposit and colour on an assignment, allowed by the service's staff permission flags |
| Engine | The database functions that write replicas and cross-venue assignments |
| Revision | The counter that says a replica has changes to apply |
| Converged | A replica whose applied revision equals its desired revision and whose fingerprint matches the master |
| Release | The bundle `collective_release_member` runs when a membership stops being active: replica links released (`released_at`), locks lifted, managed objects unmanaged, adoption cleared, the payment rule downgraded where needed, and no account link touched (D41), all in one transaction; photos and notices after commit (§6.7) |
| Behind | A replica link whose `applied_revision` is below its `desired_revision` (I3b): the engine's normal state between a host save and the apply |
| Drift | A replica link marked current whose fingerprint differs from the expected fingerprint (I3): never lag, always audited as `unexplained_drift_repaired` and alerted |
| Retired | Only a replica after the host withdraws its offering: inactive, calendar choices kept. Schema that goes in C2 is "dropped"; surfaces, tests and strings that go are "removed" |
| Suspended | A member whose subscription has lapsed (`suspended_at`): hidden from the page, its own page showing, its replicas still locked |
| Paused | The page after the host leaves or lapses (`paused_at` on an active collective): members may leave or take over; 30 days to a dissolve |
| Booking paused | The host's `booking_paused` flag, which pauses bookings on the collective page without pausing the collective |
| Parked | An appointment service at a venue that is live in a collective but is not one of the collective's offerings there (at the host, not the master of an active offering; at a member, not a live replica). Not listed or bookable for a new booking anywhere, while existing bookings on it stay fully manageable. Derived from state, never stored, and lifted the moment the membership ends, the member is suspended, the page pauses or the collective dissolves (D2, §6.6). "Park it until I leave" is the join dialog's name for it. Revised 2026-09-14: it no longer means kept for the team's own bookings |
| Managed | An engine-written member-side library object (heading, add-on group, form) carrying `managed_by_collective_id` |
| Locked | Refused by a BEFORE trigger while the collective is live. A route-level refusal with no database lock is "cannot be changed while live" |
| Page address | The booking URL, `/book/c/{slug}` or `/book/{slug}`. "Address" alone is the physical one |
| Acting venue | The venue whose staff row the session resolves to; under D38 there is exactly one |
| Live collective | Active, at least two eligible members, and a bookable service |
| Column registry | `collective_column_classes`: the explicit, reviewed list classifying every replicated column as host-controlled, identity-mapped, venue-controlled or not copied (§6.3, Appendix F). `service_items` has 45 columns |
| Collective area | The Collective area (Overview, Services, Venues, History), shown to hosts and members (§6.8; specification §1.5 and item 15) |
| Verifier | The daily cron `collective-verify` that runs the invariants, repairs lag (I3b) by applying and orphaned replica links (I5) by releasing, repairs unexplained drift (I3) only with an audit row and an alert, and reports everything else without touching it (§6.16) |

---

## Appendix C. Engine schema (DDL)

This appendix is Pass A's engine schema, written the way the repository writes a table
(`supabase/migrations/20261210120000_combined_booking_page.sql:73-97`: every column typed with
nullability and default, every CHECK named, RLS enabled, a service-role-only table with no
policies). Everything is expand-only. **Decided** (register and §6.3): every table, column,
`event_type`, `provenance` value, SQLSTATE and function name, the partial unique index on live
links, the FK actions on venue deletion, the per-calendar CHECK ranges, and the grants.
**Proposal** (a builder may vary the name, never the shape or the constraint): constraint, index
and trigger names, the `last_error_code` vocabulary, the `collective_operations.kind` values, and
the four columns marked "plan-named", which the register does not list but the plan's prose needs
(`venue_collectives.paused_reason` and `dissolved_at`, `venue_collective_members.consented_by_user_id`
and `list_on_old_page`).

### C.1 The five new tables

The register names exactly five. The cross-venue booking audit (RT2-12) is not a sixth: §6.3 leaves
it as "`collective_booking_audit` (or `account_link_audit_log.link_id` made nullable with a
`collective_id` and a CHECK)", and with the table count fixed at five this appendix takes the
second reading, with the widening ALTER in C.2 and the two cautions that come with it.

```sql
-- One row per (offering, member); never deleted at release (T19): a re-join revives the released row.
CREATE TABLE IF NOT EXISTS public.collective_service_replicas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_id        uuid NOT NULL REFERENCES public.venue_collectives (id) ON DELETE CASCADE,
  collective_service_item_id uuid NOT NULL REFERENCES public.collective_service_items (id) ON DELETE CASCADE,
  member_id            uuid NOT NULL REFERENCES public.venue_collective_members (id) ON DELETE CASCADE,
  venue_id             uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  -- NULL until the first apply creates the member's row (I2 allows 15 minutes).
  replica_service_id   uuid REFERENCES public.service_items (id) ON DELETE SET NULL,  -- released rows lose the pointer if the member deletes the service (D52)
  provenance           text NOT NULL,
  desired_revision     bigint NOT NULL DEFAULT 1,
  applied_revision     bigint NOT NULL DEFAULT 0,
  applied_fingerprint  text,
  behind_since         timestamptz,
  attempts             integer NOT NULL DEFAULT 0,
  next_attempt_at      timestamptz,
  lease_until          timestamptz,
  last_error_code      text,
  last_error           text,
  last_applied_at      timestamptz,
  released_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collective_service_replicas_provenance_valid
    CHECK (provenance IN ('created', 'adopted', 'migrated', 'reconnected')),
  CONSTRAINT collective_service_replicas_revisions_ordered
    CHECK (applied_revision >= 0 AND desired_revision >= applied_revision),
  CONSTRAINT collective_service_replicas_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT collective_service_replicas_error_code_valid   -- proposal: the list may grow
    CHECK (last_error_code IS NULL OR last_error_code IN ('slug_collision', 'unique_violation',
      'fk_violation', 'timeout', 'lock_timeout', 'membership_inactive', 'master_missing', 'unknown'))
);
-- T19: one live link per (offering, venue); released rows stay for the audit and the reconnect.
CREATE UNIQUE INDEX IF NOT EXISTS collective_service_replicas_live_pair
  ON public.collective_service_replicas (collective_service_item_id, venue_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collective_service_replicas_service_unique
  ON public.collective_service_replicas (replica_service_id)
  WHERE replica_service_id IS NOT NULL AND released_at IS NULL;
-- The cron's claim query (Appendix D): due, not leased, in id order (the lock order in §6.4 item 4).
CREATE INDEX IF NOT EXISTS collective_service_replicas_due
  ON public.collective_service_replicas (next_attempt_at, id)
  WHERE applied_revision < desired_revision AND released_at IS NULL;
CREATE INDEX IF NOT EXISTS collective_service_replicas_collective
  ON public.collective_service_replicas (collective_id, venue_id);
DROP TRIGGER IF EXISTS collective_service_replicas_updated_at ON public.collective_service_replicas;
CREATE TRIGGER collective_service_replicas_updated_at
  BEFORE UPDATE ON public.collective_service_replicas
  FOR EACH ROW EXECUTE PROCEDURE public.account_links_set_updated_at();
ALTER TABLE public.collective_service_replicas ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only
REVOKE ALL ON TABLE public.collective_service_replicas FROM PUBLIC, anon, authenticated;

-- One row per collective, read by the catalogue memo (src/lib/linked-accounts/collective-venue.ts:259-268).
CREATE TABLE IF NOT EXISTS public.collective_catalogue_revisions (
  collective_id  uuid PRIMARY KEY REFERENCES public.venue_collectives (id) ON DELETE CASCADE,
  revision       bigint NOT NULL DEFAULT 1,
  bumped_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.collective_catalogue_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.collective_catalogue_revisions FROM PUBLIC, anon, authenticated;
-- The bump, inlined wherever this appendix says "bump the catalogue revision":
--   INSERT INTO public.collective_catalogue_revisions (collective_id) VALUES (v_collective_id)
--   ON CONFLICT (collective_id) DO UPDATE SET revision = collective_catalogue_revisions.revision + 1, bumped_at = p_now;

-- Append-only. No FK anywhere, venue columns included, so history outlives every row it names.
CREATE TABLE IF NOT EXISTS public.collective_audit_events (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_id                uuid NOT NULL,
  collective_name              text NOT NULL,
  event_type                   text NOT NULL,
  actor_type                   text NOT NULL,          -- 'venue_user' | 'system' | 'support'
  actor_venue_id               uuid,
  actor_venue_name             text,
  actor_user_id                uuid,
  actor_is_platform_superuser  boolean NOT NULL DEFAULT false,
  support_session_id           uuid,                   -- cross-reference support_audit_events
  system_job                   text,                   -- p_job when actor_type = 'system'
  client_header                text,                   -- X-ResNeo-Client as received (N27)
  target_venue_id              uuid,
  target_venue_name            text,
  item_id                      uuid,
  service_id                   uuid,
  replica_id                   uuid,
  calendar_id                  uuid,
  revision                     bigint,
  changes                      jsonb,                  -- {"before": ..., "after": ...}
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collective_audit_events_actor_type_valid CHECK (actor_type IN ('venue_user', 'system', 'support')),
  CONSTRAINT collective_audit_events_system_job_when_system CHECK (actor_type <> 'system' OR system_job IS NOT NULL),
  CONSTRAINT collective_audit_events_event_type_valid CHECK (event_type IN (
    'offering_added', 'offering_withdrawn', 'offering_reoffered',
    'master_changed', 'master_change_undone', 'replica_applied', 'replica_failed',
    'unexplained_drift_repaired', 'calendar_assigned', 'calendar_unassigned', 'values_changed',
    'member_invited', 'invitation_withdrawn', 'invitation_expired', 'member_joined', 'member_left',
    'member_removed', 'member_suspended', 'member_resumed', 'member_released',
    'host_transfer_requested', 'host_transfer_cancelled', 'host_transferred',
    'collective_paused', 'collective_resumed', 'collective_dissolved',
    'adoption_requested', 'adoption_answered', 'suggestion_made',
    'address_adoption_requested', 'address_adopted',
    'migration_applied', 'migration_rolled_back',
    'photo_copied', 'photo_copy_failed', 'payment_rule_downgraded'))
);
CREATE INDEX IF NOT EXISTS collective_audit_events_collective
  ON public.collective_audit_events (collective_id, created_at DESC);
CREATE INDEX IF NOT EXISTS collective_audit_events_target_venue
  ON public.collective_audit_events (target_venue_id, created_at DESC);
-- Append-only trigger as compliance_audit_deny_update_delete (20261203120000_compliance_records.sql:200-217).
ALTER TABLE public.collective_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.collective_audit_events FROM PUBLIC, anon, authenticated;

-- Idempotent, resumable lifecycle jobs. I22 reads status, lease_until and updated_at.
CREATE TABLE IF NOT EXISTS public.collective_operations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_id    uuid NOT NULL,
  venue_id         uuid,
  kind             text NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'pending',
  progress         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts         integer NOT NULL DEFAULT 0,
  lease_until      timestamptz,
  next_attempt_at  timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collective_operations_kind_valid   -- proposal
    CHECK (kind IN ('join', 'release_followup', 'host_transfer', 'migrate', 'notice')),
  CONSTRAINT collective_operations_status_valid CHECK (status IN ('pending', 'running', 'done', 'failed'))
);
CREATE INDEX IF NOT EXISTS collective_operations_due
  ON public.collective_operations (next_attempt_at, id) WHERE status IN ('pending', 'running');
ALTER TABLE public.collective_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.collective_operations FROM PUBLIC, anon, authenticated;

-- The column registry (Appendix F): seeded here; read by the engine, service-duplication.ts (W3a) and DB-07.
CREATE TABLE IF NOT EXISTS public.collective_column_classes (
  table_name   text NOT NULL,
  column_name  text NOT NULL,
  class        text NOT NULL,
  note         text,
  PRIMARY KEY (table_name, column_name),
  CONSTRAINT collective_column_classes_class_valid
    CHECK (class IN ('host', 'identity', 'venue', 'not_copied', 'derived'))
);
REVOKE ALL ON TABLE public.collective_column_classes FROM PUBLIC, anon, authenticated;
```

`collective_operations` has one runner: the route that creates a job runs it once inline after
commit, and `collective-replicate` retries anything still `pending` or `running` past its lease.
The join job carries the member's choices in `progress` (`form_choices`); it holds no service
list, because parking is derived (D2, DL3; `paused_service_ids` was withdrawn on 2026-09-14);
`release_followup` carries the photo
copies and their retry count; `notice` holds one-off reminders keyed by subject and day
(`notice:invite:<member_id>:7`), so no reminder column is needed on any table.

### C.2 Changed tables

The per-calendar CHECKs mirror the overrides route's schema
(`src/app/api/venue/practitioner-service-overrides/route.ts:9-20`: name 1 to 200 characters,
description up to 2000, length 5 to 480, buffer 0 to 120, price and deposit at least 0, colour up
to 20). The 100p card-hold floor depends on the service's payment rule, so it lives in the resolver
and the route, never in a CHECK (§6.6). The anon policy must go first (SEC-05): `updated_by_user_id`
is an `auth.users` id.

```sql
DROP POLICY IF EXISTS "public_read_calendar_service_assignments" ON public.calendar_service_assignments;
  -- 20260430120000_unified_scheduling_engine.sql:399-401, USING (true)
ALTER TABLE public.calendar_service_assignments
  ADD COLUMN IF NOT EXISTS custom_name text,
  ADD COLUMN IF NOT EXISTS custom_description text,
  ADD COLUMN IF NOT EXISTS custom_buffer_minutes integer,
  ADD COLUMN IF NOT EXISTS custom_deposit_pence integer,
  ADD COLUMN IF NOT EXISTS custom_colour text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by_venue_id uuid REFERENCES public.venues (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE public.calendar_service_assignments
  ADD CONSTRAINT calendar_service_assignments_custom_name_len
    CHECK (custom_name IS NULL OR char_length(btrim(custom_name)) BETWEEN 1 AND 200),
  ADD CONSTRAINT calendar_service_assignments_custom_description_len
    CHECK (custom_description IS NULL OR char_length(custom_description) <= 2000),
  ADD CONSTRAINT calendar_service_assignments_custom_duration_range
    CHECK (custom_duration_minutes IS NULL OR custom_duration_minutes BETWEEN 5 AND 480),
  ADD CONSTRAINT calendar_service_assignments_custom_buffer_range
    CHECK (custom_buffer_minutes IS NULL OR custom_buffer_minutes BETWEEN 0 AND 120),
  ADD CONSTRAINT calendar_service_assignments_custom_price_nonneg
    CHECK (custom_price_pence IS NULL OR custom_price_pence >= 0),
  ADD CONSTRAINT calendar_service_assignments_custom_deposit_nonneg
    CHECK (custom_deposit_pence IS NULL OR custom_deposit_pence >= 0),
  ADD CONSTRAINT calendar_service_assignments_custom_colour_len
    CHECK (custom_colour IS NULL OR char_length(custom_colour) <= 20);

-- D41: account_links is not altered. (An earlier draft added created_for_collective_id; withdrawn 2026-09-14.)

ALTER TABLE public.venue_collectives
  ADD COLUMN IF NOT EXISTS service_model text NOT NULL DEFAULT 'legacy_copies',
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason text,                                   -- plan-named (§6.7)
  ADD COLUMN IF NOT EXISTS pending_host_venue_id uuid REFERENCES public.venues (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS host_transfer_at timestamptz,
  ADD COLUMN IF NOT EXISTS dissolved_at timestamptz;                             -- plan-named (§6.7)
ALTER TABLE public.venue_collectives
  ADD CONSTRAINT venue_collectives_service_model_valid
    CHECK (service_model IN ('legacy_copies', 'migrating', 'replicas')),
  ADD CONSTRAINT venue_collectives_paused_reason_valid
    CHECK (paused_reason IS NULL OR paused_reason IN ('host_left', 'host_lapsed')),
  DROP CONSTRAINT IF EXISTS venue_collectives_adopt_requires_venue;   -- 20261210120000:44-47
CREATE UNIQUE INDEX IF NOT EXISTS venue_collectives_one_live_host
  ON public.venue_collectives (host_venue_id) WHERE status = 'active';           -- once I7 = 0

ALTER TABLE public.venue_collective_members
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS consented_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL, -- plan-named
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS list_on_old_page boolean NOT NULL DEFAULT true;        -- contract 9 (D25)
CREATE UNIQUE INDEX IF NOT EXISTS venue_collective_members_one_live_venue
  ON public.venue_collective_members (venue_id) WHERE status = 'active';         -- once I7 = 0
-- The existing venue_collective_members_live index (20260919120000_linked_accounts.sql:197-199) is
-- per (collective_id, venue_id) over invited and active rows, so I43 stays an invariant.

ALTER TABLE public.collective_service_items
  ADD COLUMN IF NOT EXISTS master_service_id uuid REFERENCES public.service_items (id) ON DELETE NO ACTION,  -- SET NULL since 20270216140000: NO ACTION blocked deleting any once-offered service; RN002 still guards active offerings
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'service';         -- T14 (D44)
ALTER TABLE public.collective_service_items
  ADD CONSTRAINT collective_service_items_entity_type_valid CHECK (entity_type IN ('service'));
CREATE UNIQUE INDEX IF NOT EXISTS collective_service_items_master_active
  ON public.collective_service_items (collective_id, master_service_id)
  WHERE status = 'active' AND master_service_id IS NOT NULL;

-- service_name_snapshot already exists with its fallback (20270103125000_bookings_service_name_snapshot.sql:36,47-95).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_price_snapshot_pence integer
    CHECK (service_price_snapshot_pence IS NULL OR service_price_snapshot_pence >= 0);
-- Not added to the nine-column authenticated SELECT grant (20270112120000_bookings_column_grants.sql:64-74).

-- Child mappings: ON DELETE NO ACTION with engine cleanup (RT2-4); the release clears them (T22).
ALTER TABLE public.service_variants ADD COLUMN IF NOT EXISTS replica_of_variant_id uuid
  REFERENCES public.service_variants (id) ON DELETE NO ACTION;
ALTER TABLE public.addon_groups
  ADD COLUMN IF NOT EXISTS managed_by_collective_id uuid,
  ADD COLUMN IF NOT EXISTS replica_of_addon_group_id uuid REFERENCES public.addon_groups (id) ON DELETE NO ACTION;
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS replica_of_addon_id uuid
  REFERENCES public.addons (id) ON DELETE NO ACTION;
ALTER TABLE public.service_categories
  ADD COLUMN IF NOT EXISTS managed_by_collective_id uuid,
  ADD COLUMN IF NOT EXISTS replica_of_category_id uuid REFERENCES public.service_categories (id) ON DELETE NO ACTION;
ALTER TABLE public.compliance_types
  ADD COLUMN IF NOT EXISTS managed_by_collective_id uuid,
  ADD COLUMN IF NOT EXISTS replica_of_compliance_type_id uuid REFERENCES public.compliance_types (id) ON DELETE NO ACTION,
  ADD COLUMN IF NOT EXISTS accepts_records_from_type_id uuid REFERENCES public.compliance_types (id) ON DELETE SET NULL;
ALTER TABLE public.compliance_type_versions ADD COLUMN IF NOT EXISTS replica_of_version_id uuid
  REFERENCES public.compliance_type_versions (id) ON DELETE NO ACTION;
ALTER TABLE public.service_compliance_requirements ADD COLUMN IF NOT EXISTS replica_of_requirement_id uuid
  REFERENCES public.service_compliance_requirements (id) ON DELETE NO ACTION;
-- Plus one partial index per replica_of_* column (WHERE ... IS NOT NULL) and per managed_by_collective_id.

-- service_items: no managed_by_collective_id (the lock finds the collective through replica_service_id);
-- an updated_at trigger (PB-14; none exists today); ordering hazard 4's CHECK (its trigger is in C.4).
DROP TRIGGER IF EXISTS service_items_updated_at ON public.service_items;
CREATE TRIGGER service_items_updated_at BEFORE UPDATE ON public.service_items
  FOR EACH ROW EXECUTE PROCEDURE public.account_links_set_updated_at();   -- 20260919120000:97-105
ALTER TABLE public.service_items ADD CONSTRAINT service_items_sync_not_self
  CHECK (synced_from_service_id IS NULL OR synced_from_service_id <> id);

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean;  -- NULL = unknown (RT2-15)

-- RT2-12, the reading this appendix takes: widen account_link_audit_log rather than add a table.
ALTER TABLE public.account_link_audit_log
  ALTER COLUMN link_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS collective_id uuid,
  ADD CONSTRAINT account_link_audit_log_one_authority CHECK (num_nonnulls(link_id, collective_id) >= 1);

-- §6.15: a collective value for bookings.source, in its own file: ALTER TYPE ... ADD VALUE cannot share a
-- transaction with DML on the value (precedent 20260306000001_schema_gaps.sql:51-52; backfill in Appendix G).
ALTER TYPE public.booking_source ADD VALUE IF NOT EXISTS 'collective_page';   -- name is a proposal
```

Two cautions on the widened table: its venue columns cascade (`20260919120000_linked_accounts.sql:117-129`),
the shape §6.3 warns against, so a departed member's venue deletion erases the host's copy of its
rows; and it is updated in place by the redaction migration
(`20270103120000_linked_audit_redact_booking_pii.sql:104-111`). If the lead reverses the reading,
the CREATE follows `collective_audit_events` above. Either way `log_cross_venue_booking_action()`
needs a collective branch: it returns early for a caller with no staff row
(`20270111120000_linked_write_paths_and_guest_calendar_scope.sql:121-122`). A staff booking made
through the collective form writes a row here and N31 goes to the owning venue; a guest booking a
member calendar on the collective page sends N32 to the host's admins from the public create route.

### C.3 Grants

Tables: `REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated` after each CREATE (above). The
five tables have uuid keys and no sequences, so the sequence clause in the CI check is a no-op today
and stays in place for the day a `bigserial` appears. Functions, in the repository's form
(`supabase/migrations/20270118120000_bookings_account_safe.sql:129-130`):

```sql
REVOKE ALL ON FUNCTION public.collective_apply_replica(uuid, uuid, uuid, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.collective_apply_replica(uuid, uuid, uuid, text, timestamptz, uuid) TO service_role;
```

CI re-grants everything it does not exclude: `supabase/scripts/local_baseline_grants.sql:50-59`
loops over `pg_tables` granting `authenticated` and `anon` on every table not in its `NOT IN` list,
so the five engine tables join that list in the same PR (INF-08), and
`scripts/check-table-grants.mjs` (npm `check:table-grants`, `package.json:12`) gains them.

### C.4 Trigger inventory

Statement-level rule: a trigger that uses transition tables (`REFERENCING OLD TABLE AS old_rows NEW
TABLE AS new_rows`) may name only one event, so every dirty trigger and every statement-level
revision trigger is three triggers, `_ins`, `_upd`, `_del`, sharing one function that reads
`TG_OP`. Trigger functions are `SECURITY DEFINER` with `SET search_path = ''` and **do not** carry
the engine flag clause: they read `current_setting('resneo.collective_engine', true)`, and a
trigger that set it would let itself through.

| Table | Trigger (proposal) | Event and level | Body in one line |
|---|---|---|---|
| `service_items`, `service_variants`, `service_addon_groups`, `addon_groups`, `addons`, `service_compliance_requirements`, `compliance_types`, `compliance_type_versions`, `service_categories` | `trg_collective_dirty_<table>_<ins,upd,del>` | AFTER each event, FOR EACH STATEMENT, transition tables | Exit when the flag is on or the writer's venue hosts no active replicas-mode collective; map the rows to offered masters (own row; `service_item_id`; groups through `service_addon_groups`; types through requirements, venue-wide ones to every offered master at that venue; headings through `category_id`); skip an UPDATE whose OLD to NEW diff is `sort_order` only; then one `UPDATE collective_service_replicas SET desired_revision = desired_revision + 1 WHERE released_at IS NULL AND id IN (SELECT ... ORDER BY id)`; never touch the master again (§6.4 item 4) |
| the same nine tables plus `calendar_service_assignments` | `trg_collective_lock_<table>` | BEFORE INSERT OR UPDATE OR DELETE, FOR EACH ROW | Refuse when the flag is off and the row is a replica, a replica's child or a managed object of a live link (`released_at IS NULL`, membership `active`, collective `active` and `service_model = 'replicas'`): `RN001` on `service_items`, `service_variants`, `service_categories`; `RN003` on `addon_groups`, `addons`, `service_addon_groups`; `RN004` on `compliance_types`, `compliance_type_versions`, `service_compliance_requirements`. Allowed without the flag: a diff confined to venue-class columns (Appendix F) or to `sort_order`; a diff confined to `category_id` becoming NULL (the one FK cascade, §6.5); on `calendar_service_assignments` only `service_item_id` is guarded, insert and delete of a venue's own rows stay open. DELETE of a master with an active offering: `RN002` |
| `service_addon_groups`, `service_compliance_requirements` | inside the lock trigger | BEFORE INSERT OR UPDATE | A member's own service may not link a managed group (`RN003`) or require a managed type (`RN004`) (RT1-13); the venue-consistency composite check I13 and I15 report on becomes real here |
| `calendar_service_assignments` | `trg_csa_venue_consistency` | BEFORE INSERT OR UPDATE OF calendar_id, service_item_id, ROW | The calendar's venue must equal the service's venue (I13 as a constraint, §6.7); raises `23514` |
| `calendar_service_assignments` | `trg_csa_delete_audit` | AFTER DELETE, ROW | When the row's service is a live replica or an offered master: one `calendar_unassigned` row with the before-image, `actor_type = 'venue_user'` and the calendar's venue as actor, then the revision bump (CSA-04, I33) |
| `calendar_service_assignments` | `trg_collective_revision_csa_<ins,upd,del>` | AFTER each event, STATEMENT | Bump the collective of every affected live replica or offered master (DB-08) |
| `unified_calendars` | `trg_collective_revision_calendar` | AFTER UPDATE OF is_active, name, STATEMENT | Bump for the venue's live collective |
| `venues` | `trg_collective_revision_venue` | AFTER UPDATE OF stripe_connected_account_id, stripe_charges_enabled, currency, timezone, STATEMENT | Bump for the venue's live collective |
| `venue_collective_members` | `trg_collective_revision_members` | AFTER INSERT OR UPDATE, STATEMENT | Bump the collective (no transition tables needed, so one trigger) |
| `venue_collective_members` | `trg_venue_collective_members_status_release` | AFTER UPDATE OF status, ROW, `WHEN (OLD.status = 'active' AND NEW.status <> 'active')` | When the flag is off (a writer other than the lifecycle functions), call `collective_release_member(NEW.id, NEW.status, NULL, NULL, now())`; under the flag the function that made the write already ran the release, and the function is idempotent either way (RT1-4) |
| `venue_collectives` | `trg_venue_collectives_host_guard` | BEFORE UPDATE OF host_venue_id, ROW | `RN005` unless the flag is on; gated on `OLD.service_model = 'replicas'` so today's `reconcileCollective` write (`src/lib/linked-accounts/collectives.ts:566-570`) keeps working until W7 (ordering hazard 2) |
| `service_items` | `trg_service_items_sync_columns` | BEFORE UPDATE OF synced_from_service_id, sync_state, synced_at, ROW | `RN006` when the flag is off and the venue is in a live replicas-mode collective (ordering hazard 4) |
| `service_items` | `service_items_updated_at` | BEFORE UPDATE, ROW | `public.account_links_set_updated_at()` |
| `bookings` | `trg_booking_price_snapshot` | BEFORE INSERT, ROW | Appointment rows with a NULL `service_price_snapshot_pence`: option price, else the assignment's `custom_price_pence` while the service's `staff_may_customize_price` is on, else `service_items.price_pence` (PRICE-01); modelled on `set_booking_service_name_snapshot()` (`20270103125000:47-95`) |
| `collective_audit_events` | `collective_audit_append_only` | BEFORE UPDATE OR DELETE, ROW | RAISE, as `20261203120000:200-217` |
| `collective_service_replicas`, `collective_operations` | `<table>_updated_at` | BEFORE UPDATE, ROW | `public.account_links_set_updated_at()` |

**FK actions on venue deletion (T22).** The link table cascades from `collective_id` and
`member_id` (and, as written above, from `venue_id` and `item_id`; a builder may make the last two
`NO ACTION`, since the explicit release makes both safe). `admin_hard_delete_venue`
(`20260518120000_venue_delete_terminate_account_links.sql:67-85`) calls `collective_release_member`
for a member or `collective_dissolve` for a host before
`terminate_account_links_for_venue_deletion`, because a cascade fires no status trigger, and
because the children's `replica_of_*` are `NO ACTION`: a host's `service_items` cannot be deleted
while a member's variants still point at them, and the dissolve is what clears the pointers.
`accepts_records_from_type_id` is `SET NULL` and survives release. `replica_service_id` is
`ON DELETE SET NULL` (§6.3 and C.1): a member deleting a released service it now owns (D52) nulls
the pointer on that service's released link rows automatically, and the reconnect offer then has
nothing to reconnect, which is right. A live replica cannot reach that path, because the lock
trigger refuses its delete (`RN001`).

## Appendix D. Engine functions

**Conventions (T20).** Every function ends its parameter list with `p_actor_venue_id uuid,
p_actor_user_id uuid, p_now timestamptz DEFAULT now()`; both actor ids are NULL for the system;
functions a cron calls also take `p_job text DEFAULT NULL` (`'collective-replicate'`,
`'collective-verify'`, `'inline'`, `'retry'`); functions the platform console calls take
`p_support_session_id uuid DEFAULT NULL`. All are `LANGUAGE plpgsql SECURITY DEFINER SET
search_path = '' SET resneo.collective_engine = 'on'`, with every relation written
`public.<table>`; writers are `VOLATILE` and add `SET lock_timeout = '2s'`; the four readers
(`collective_replica_projection`, the two fingerprints, `collective_invariant_report`) are
`STABLE`. Each is revoked from `PUBLIC, anon, authenticated` and granted to `service_role` (C.3).
DB-01 asserts the value of `proconfig`, not its presence, and fails on any unqualified relation in
`prosrc`. No function calls `set_config` for the flag: the function-level `SET` is what Postgres
restores on exit (RT1-7).

**Amended 2026-09-15 (build):** hosted Supabase refuses a function-level `SET resneo.collective_engine`
to the migration role ("permission denied to set parameter", 42501; attaching a custom setting to a
function needs a superuser). Each engine entry point is therefore a thin wrapper that calls
`collective_engine_enter()` (remembers the flag, `set_config(..., 'on', true)`), runs the `*_core`
body, and calls `collective_engine_leave(prev)`. A raise rolls the transaction or the caller's
savepoint back, which restores the setting too, so the flag still cannot outlive the call.
`src/lib/testing/migration-function-settings.test.ts` refuses any dotted setting in a function
definition.

**The engine flag rule.** `resneo.collective_engine = 'on'` is read by the lock triggers, the host
guard, the sync-columns guard and the dirty triggers; the first three let the write through, the
dirty triggers skip (the engine bumps explicitly where it means to, so a replica-side write never
bumps anything and an undo bumps once). It is not a security boundary (§6.4 item 3): anyone with
the connection string can set it, and the verifier's `unexplained_drift_repaired` row is the
evidence that catches a hand edit, not the flag.

**Lock order (§6.4 item 4), the same in every writer.** First the collective advisory lock:
`PERFORM pg_advisory_xact_lock_shared(hashtextextended('collective:' || v_collective_id::text, 0))`
for apply, offer, withdraw, join, calendar changes, values and undo, or `pg_advisory_xact_lock(...)`
(exclusive) for release, dissolve and transfer; the form is the one
`20270129120000_appointment_slot_guard.sql:69` already uses. Then link rows `FOR UPDATE` in id
order. Then service rows: the master is read with a plain SELECT (no row lock), replica rows are
written. Membership, collective status and `service_model` are re-checked after the locks are
held. The member's assignment PUT takes no collective lock at all (§6.7).

**Coded errors.** Six SQLSTATEs, mapped to 409 by `src/lib/linked-accounts/replicas/db-errors.ts`
(a new file; the `replicas/` directory does not exist today):

| SQLSTATE | Code | Raised by |
|---|---|---|
| `RN001` | `COLLECTIVE_MANAGED_SERVICE` | lock on `service_items`, `service_variants`, `service_categories`, and on `calendar_service_assignments.service_item_id` |
| `RN002` | `COLLECTIVE_OFFERED_SERVICE` | DELETE of a master with an active offering |
| `RN003` | `COLLECTIVE_MANAGED_ADDON_GROUP` | lock on `addon_groups`, `addons`, `service_addon_groups` |
| `RN004` | `COLLECTIVE_MANAGED_COMPLIANCE_TYPE` | lock on `compliance_types`, `compliance_type_versions`, `service_compliance_requirements` |
| `RN005` | `COLLECTIVE_HOST_CHANGE_REFUSED` | `venue_collectives.host_venue_id` guard |
| `RN006` | `COLLECTIVE_SYNC_COLUMNS_LOCKED` | the three legacy sync columns |

Everything else the engine raises is `P0001` and answers 500 (GRD-04). Where a route must turn a
refusal into a coded answer (`COLLECTIVE_LINKS_BEHIND`, `COLLECTIVE_TRANSFER_PENDING`,
`COLLECTIVE_UNDO_EXPIRED`, `COLLECTIVE_LEGACY_MODEL`, and §6.7's `COLLECTIVE_NOT_HOST`,
`COLLECTIVE_VENUE_NOT_MEMBER`, `COLLECTIVE_CALENDAR_NOT_AT_VENUE`, `COLLECTIVE_REPLICA_NOT_READY`),
the function raises `P0001` with the code as the message's first token
(`RAISE EXCEPTION 'COLLECTIVE_LINKS_BEHIND: ...'`), the route has checked its inputs first, and
`db-errors.ts` maps the prefix only when the code is in the list. **The one error-code list**
(contract 21), added to `API_ERROR_CODES` (`src/lib/api/error-codes.ts:27`) by W2: the spec §0.5
nine (`COLLECTIVE_MANAGED_SERVICE`, `COLLECTIVE_OFFERED_SERVICE`, `COLLECTIVE_MANAGED_ADDON_GROUP`,
`COLLECTIVE_MANAGED_COMPLIANCE_TYPE`, `COLLECTIVE_CONSENT_REQUIRED`, `COLLECTIVE_SERVICE_UPDATING`,
`COLLECTIVE_TIMEZONE_LOCKED`, `COLLECTIVE_COMPLIANCE_REQUIRED`, and the existing `STALE_RESOURCE`
at 412, `src/lib/booking/guest-actions/types.ts:182`); `COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE`,
`COLLECTIVE_REPLICAS_ALWAYS_FOLLOW`, `COLLECTIVE_HEADINGS_FOLLOW_SERVICES`,
`COLLECTIVE_LINKS_BEHIND`, `COLLECTIVE_TRANSFER_PENDING`, `COLLECTIVE_UNDO_EXPIRED` (410),
`COLLECTIVE_LEGACY_MODEL`, `COLLECTIVE_BOOKING_MODEL_LOCKED`, `COLLECTIVE_CURRENCY_MISMATCH`,
`COLLECTIVE_SERVICE_RETIRED`; §6.7's four, `COLLECTIVE_NOT_HOST`, `COLLECTIVE_VENUE_NOT_MEMBER`,
`COLLECTIVE_CALENDAR_NOT_AT_VENUE` and `COLLECTIVE_REPLICA_NOT_READY`; and
`COLLECTIVE_HOST_CHANGE_REFUSED` and `COLLECTIVE_SYNC_COLUMNS_LOCKED` from the six. This is the
same list as §6.11.

**Backoff.** `v_backoff := (ARRAY[1, 5, 30, 120, 360])[LEAST(attempts, 5)]` minutes, so the sixth
and every later attempt waits six hours. N5 goes to the host and member after three failures or
15 minutes behind, once per incident and daily while unresolved; 60 minutes behind pages ops (T1).

**The lease claim.** The cron takes leases in one RPC (its own transaction) and then applies each
link in a separate RPC, so a statement timeout in one apply holds no lease on the rest:

```sql
CREATE OR REPLACE FUNCTION public.collective_claim_due_links(
  p_limit integer DEFAULT 50, p_lease interval DEFAULT interval '2 minutes', p_now timestamptz DEFAULT now()
) RETURNS SETOF uuid ...
  UPDATE public.collective_service_replicas SET lease_until = p_now + p_lease
  WHERE id IN (SELECT id FROM public.collective_service_replicas
               WHERE applied_revision < desired_revision AND released_at IS NULL
                 AND (next_attempt_at IS NULL OR next_attempt_at <= p_now)
                 AND (lease_until IS NULL OR lease_until < p_now)
               ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING id;
```

A link whose `lease_until` has passed and is still due counts as `leases_expired` in the cron's
report and is simply claimed again; two crons overlapping claim disjoint sets (CON-02).

**Projection and fingerprint.** `collective_replica_projection(p_link_id uuid, p_side text)`
(`'master'` or `'replica'`) returns one jsonb document:

```
{ service:      { <every service_items column of class host or derived, in registry order> },
  heading:      { name } | null,
  variants:     [ { key, name, description, duration_minutes, buffer_minutes, price_pence, deposit_pence,
                    processing_time_blocks, sort_order, is_active } ],
  addon_groups: [ { key, link_sort_order, group: { name, prompt_to_client, description, selection_type,
                    min_select, max_select, hidden_from_online, is_active },
                    options: [ { position, name, description, additional_price_pence,
                                 additional_duration_minutes, is_active } ] } ],
  requirements: [ { key, enforcement, lock_period_hours, online_collection, form_schema_hash } ] }
```

Keys are master-side ids on both sides: the master side reads the master and its children by id;
the replica side reads the replica and maps each child back through `replica_of_variant_id`,
`replica_of_addon_group_id` and `replica_of_compliance_type_id` (add-on options are matched by
position, since the apply updates them in place). Arrays are ordered by `key` as text, options by
`position`; jsonb sorts object keys itself. `service.is_active` on the master side is computed as
master active AND offering active (the derived rule), so a retired replica converges to inactive.
`requirements` on the master side is the merged result of the service's and the host's venue-wide
requirement for the same type (strictest enforcement, longest lock period, online if either);
`form_schema_hash` is `md5(form_schema::text)` of the current version. Identity, venue and
not_copied columns never appear, which is what makes a member's own edits to its venue-class columns
invisible to drift. `collective_replica_fingerprint(p_link_id)` is
`md5(collective_replica_projection(p_link_id, 'replica')::text)` and
`collective_expected_fingerprint(p_link_id)` the same over `'master'`; I3 compares the two, and the
apply stores the replica-side value in `applied_fingerprint`. ENG-07 changes each replicated column
and expects a different hash, and reorders rows expecting the same hash.

**Test points.** `collective_engine_test_point(p_name text) RETURNS void` is a revoked no-op in the
migration set; `scripts/db-concurrency/run.sh` replaces it locally with an advisory-lock wait keyed
by name. Named points: `after_master_read` (apply, after step 5 below; CON-01 pauses session A
there, and CON-04's "booking create during an apply" uses the same point) and
`after_membership_check` (offer, join and `collective_set_calendar_offering`, after the re-check
under the lock; CON-03's "offer paused after membership check while release commits"). CON-02 and
the rest of CON-03 and CON-04 are timing staggers and need no point. Adding a point is one call
with a new name and no migration.

**Audit `changes` shapes.** `master_changed` carries the master-side projection above as
`before` and `after` (the host's PATCH route captures `before` through
`collective_replica_projection(<any live link of the offering>, 'master')` before its writes and
`after` after them, and inserts the row itself; its id is `collective_sync.audit_event_id`, T10).
`replica_applied` carries `{ writes: { <table>: n } }` and the revision;
`replica_failed` `{ error_code, error, attempts }`; `unexplained_drift_repaired` the replica-side
projection as `before`; `values_changed`, `calendar_assigned` and `calendar_unassigned` the
assignment row; `migration_applied` the member's copies and provider rows as `before`, one row per
member (D54, D30); `member_joined` `{ after: { consent_version, choices } }`; `payment_rule_downgraded`
the service's previous `payment_requirement` and `deposit_pence`.

### D.1 The functions

**`collective_apply_replica(p_link_id uuid, p_actor_venue_id uuid, p_actor_user_id uuid, p_job text DEFAULT NULL, p_now timestamptz DEFAULT now(), p_support_session_id uuid DEFAULT NULL) RETURNS jsonb`**
returns `{ ok, link_id, applied_revision, writes: { service_items, service_categories,
service_variants, addon_groups, addons, service_addon_groups, compliance_types,
compliance_type_versions, service_compliance_requirements }, error_code, error }`. Shared collective
lock; the link row `FOR UPDATE`. Steps: (1) lock; (2) read the link; (3) re-check membership
`active` and not suspended, collective `active`, `service_model IN ('migrating', 'replicas')`, link
not released: otherwise return `{ ok: false, error_code: 'membership_inactive' }` writing nothing;
(4) `v_target := desired_revision`; (5) read the master, the offering status and the master's
children with plain SELECTs; `collective_engine_test_point('after_master_read')`; (6) in a `BEGIN
... EXCEPTION` block: create the replica row when `replica_service_id IS NULL` (host columns, venue
columns seeded once, `created_by_staff_id NULL`, D29 flags forced false) or converge it (host and
derived columns only, per the registry); heading mapped by id, created once, renamed in place;
options upserted by `replica_of_variant_id`, a vanished master option deactivated, never deleted;
one managed group per (member, collective, master group), options in place by position, the replica
linked to exactly the managed set; forms in the §6.4 adoption order (same library template, active
or archived, unarchived and managed with `accepts_records_from_type_id` pointing at itself; else the
same name; else a new type with a suffixed slug), requirements merged, a new version only when the
schema changed; `is_active` = master active AND offering active; every write counted; (7) on
exception the block's writes roll back and the function writes `attempts + 1`, `last_error_code`
(mapped from the SQLSTATE: `23505` unique, `23503` FK, `55P03` or `57014` lock timeout and timeout,
slug collisions detected before the insert), `last_error`, `next_attempt_at = p_now + backoff`,
`behind_since = coalesce(behind_since, p_now)`, `lease_until = NULL`, inserts `replica_failed`
(`actor_type = 'system'` and `system_job = p_job` when both actors are NULL; `'support'` with
`support_session_id` when the console passes `p_support_session_id`, the trailing parameter T20
gives console-called functions), and returns `ok: false`;
(8) on success: `applied_fingerprint := collective_replica_fingerprint(p_link_id)`,
`applied_revision := v_target`, `behind_since := CASE WHEN v_target = desired_revision THEN NULL
ELSE behind_since END`, `attempts := 0`, `lease_until := NULL`, `last_applied_at := p_now`; insert
`replica_applied` only when a count is non-zero (ENG-01's idempotency oracle: a second apply is all
zeros and no row); bump the catalogue revision; return the counts. A host write that commits during
step 6 has already bumped `desired_revision` past `v_target`, so the link stays due (REV-01).

**`collective_claim_due_links`**: above. Called only by `collective-replicate`.

**`collective_offer_service(p_collective_id, p_master_service_id, p_actor_venue_id, p_actor_user_id, p_now) RETURNS jsonb`**
`{ item_id, reoffered, links: [{ link_id, venue_id, venue_name }] }`. Shared lock; assert the actor
venue is `host_venue_id`, the service belongs to the host, the collective is `active` and
`service_model = 'replicas'` (else `COLLECTIVE_LEGACY_MODEL`, and the route answers
`COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE` for a non-host service before calling);
`after_membership_check`. Insert the offering with `master_service_id`, or reactivate an archived
one that names the same master (`offering_reoffered`). Force `staff_may_customize_name` and
`staff_may_customize_description` false on the master (D29; audited as `master_changed`). For every
active non-host member: revive a released link for the same (item, venue) as `reconnected`
(`released_at NULL`, `desired_revision + 1`, `applied_revision 0`), else insert one `created` with
`replica_service_id NULL`, `desired 1`, `applied 0`. Audit `offering_added`; bump. The route runs
inline applies within its budget and sends N8. For T28 ("Add from another venue") the route first
copies the member's service into a new host master using the registry's host columns, then calls
this function, then writes `adoption_requested` targeted at the member and a `notice` job for the
day-7 reminder (N26); no answer after 14 days is "Keep mine separate", applied by
`collective-verify`.

**`collective_withdraw_service(p_item_id, p_actor_venue_id, p_actor_user_id, p_now) RETURNS jsonb`**
`{ item_id, retired: [{ venue_id, replica_service_id, kept_bookings }] }`. Shared lock; host check;
set the offering `archived`; `desired_revision + 1` on every live link so the next apply sets the
replica inactive (D13), calendar assignments kept; audit `offering_withdrawn`; bump; the route sends
N9. Re-offer goes through `collective_offer_service`.

**`collective_set_calendar_offering(p_collective_id, p_item_id, p_venue_id, p_calendar_id, p_action text, p_actor_venue_id, p_actor_user_id, p_acknowledge_affected boolean DEFAULT false, p_now) RETURNS jsonb`**
`p_action` is `'assign'` or `'unassign'`; returns `{ assignment_id, affected_bookings: [{
booking_date, booking_time, calendar_id }] , written }`. Shared lock; checks in §6.7's order
(actor hosts an active replicas-mode collective: `COLLECTIVE_NOT_HOST`; target venue an active
member: `COLLECTIVE_VENUE_NOT_MEMBER`; calendar at that venue: `COLLECTIVE_CALENDAR_NOT_AT_VENUE`;
offering active and a replica row with `replica_service_id` at that venue:
`COLLECTIVE_REPLICA_NOT_READY`); `after_membership_check`. The host's own calendar resolves to the
master, a member's to the replica. Assign: `INSERT ... ON CONFLICT (calendar_id, service_item_id)
DO NOTHING` stamping `updated_at`, `updated_by_venue_id`, `updated_by_user_id`. Unassign: count
future non-cancelled bookings on (calendar, service); if any and not acknowledged, return them with
no guest fields and write nothing; else DELETE. Audit `calendar_assigned` or `calendar_unassigned`
with the before-image; bump. The route sends N11 grouped per save. This is the only writer of
another venue's assignment rows; `addCalendarToOffering` through `linkCalendarToService` is its seed.

**`collective_set_calendar_values(p_calendar_id, p_service_item_id, p_values jsonb, p_actor_venue_id, p_actor_user_id, p_now) RETURNS jsonb`**
`{ assignment_id, before, after }`. `p_values` keys are the seven `custom_*` columns; an absent key
is unchanged, `null` clears. Shared lock. Resolve the service's master (itself, or through the
live link); a non-null value is allowed only while the master's `staff_may_customize_*` flag for
that field is on (name and description are therefore never allowed on an offered service, D29); a
null is allowed whatever the flag, which is how the host's route clears stored values before it
turns a flag off (D6, N15). The card-hold floor and the flag gate are validated by the route first;
the function re-checks and raises `P0001`. Actor must be an admin of the calendar's venue or the
host of the live collective. Write with the attribution stamps; audit `values_changed` targeted at
the calendar's venue; bump. The route sends N14 when the host edited a member calendar.

**`collective_join_member(p_member_id, p_consent_version text, p_choices jsonb, p_actor_venue_id, p_actor_user_id, p_now) RETURNS jsonb`**
`{ links: [{ link_id, item_id, provenance }], operation_id }`. `p_choices` is
`{ same_name_choices, own_service_choices, form_choices }` in the shape of Appendix E's accept
payload. Shared lock; assert the row is `invited` (or `active`: on an active membership the
function applies only the choices given and changes no status, which is how the adoption answer
route, contract 10, reuses it); re-run the invite checks (exclusivity, currency, timezone, plan,
booking model); `p_consent_version` NULL raises `P0001` (the route has already answered
`COLLECTIVE_CONSENT_REQUIRED`); `after_membership_check`. Write `status = 'active'`, `joined_at`,
`consent_version`, `consented_at`, `consented_by_user_id`. For each active offering: a released link
for (item, venue) whose released service is unchanged since `released_at` (`updated_at <=
released_at`) is revived as `reconnected`; one whose service changed is treated as a same-name
adoption and needs the member's choice (DL5); `same_name_choices` `use_mine` sets
`replica_service_id` to the member's service, `provenance = 'adopted'`, writes
`replica_of_variant_id` from `option_map`, and snapshots that service's bookings in the same
transaction (PRICE-10); otherwise a `created` link with `replica_service_id NULL`.
`own_service_choices`: `park` (the default) writes nothing, because parking is derived (§6.6);
`ask` writes `suggestion_made` and the route sends N28. (`keep`, `pause` and
`progress.paused_service_ids` were withdrawn on 2026-09-14.) `form_choices` `use_existing` marks the member's type as the
adoption target (managed, `accepts_records_from_type_id` = itself, unarchived) so the first apply
adopts it; `use_theirs` leaves the apply to create one. The venue's compliance flag is not touched
(D54; the flag is the venue's). No `account_links` row is created or changed: the invite checks
already required the full mesh, and the function re-checks it under the lock (D41, DL6). Audit `member_joined` and one `adoption_answered`
per adoption; bump; insert the `join` operation (`idempotency_key = 'join:' || p_member_id`). The
route runs applies inline within its budget and answers 202 with `operation_id` when the budget is
hit; N3 goes to the host and members after commit; N4 to the member when its last link converges,
sent by whichever apply completes it (route or cron).

**`collective_release_member(p_member_id, p_reason text, p_actor_venue_id, p_actor_user_id, p_now) RETURNS jsonb`**
`p_reason` is `'left'`, `'removed'`, `'link_ended'`, `'suspended_expired'`, `'dissolved'` or
`'venue_deleted'`; returns `{ links_released,
unparked: [service_id], downgraded: [service_id], operation_id }`. Exclusive lock; idempotent: a
membership already released returns zeros. When the row is the host's and the collective is not
being dissolved (a link change removed the host), the collective is paused instead: `paused_at`,
`paused_reason = 'host_left'`, `collective_paused`, N23 with a reminder at day 23 through a
`notice` job; the members' links stay locked and in step because their own memberships are still
active, and nothing else runs for the host. Otherwise, in the transaction, in
this order (T22's one list):
set `status` (`left` for the member's own leave and for dissolve, `removed` otherwise) and
`left_at` unless the trigger path already did; `released_at = p_now` on the member's live links
(locks lift by absence); clear `replica_of_*` and `managed_by_collective_id` on the venue's
variants, groups, options, headings, types, versions and requirements, keeping
`accepts_records_from_type_id`; every released service stays exactly as it is (D52), active ones
active and retired ones inactive (DL2), with `svc.member.card.cameFrom` derived from the audit row
for 30 days; nothing to un-park, because parking ends with the membership, and `unparked` names
the member's services that were not on the page at release (DL3); the compliance "locked on" guard lifts by absence of the membership; reset
`adopted_venue_id` and `slug_strategy` when this venue's address was adopted; leave every
`account_links` row exactly as it is (D41); set `payment_requirement = 'none'` on released services that take payment when
`venues.stripe_charges_enabled IS NOT TRUE`, one `payment_rule_downgraded` row each; while
`collective_service_providers` exists (Pass B to C1), set the member's provider rows to
`'removed'`; two `member_released` rows, one targeted at the member and one at the host; bump;
insert the `release_followup` job (`'release:' || p_member_id`). After commit, the job copies each
host photo as an object into the member's storage (`photo_copied`, or `photo_copy_failed` with
retries; after the last retry the URL is cleared and `review.photos.failed` names it), and the route
or cron sends N16, N17, N18 or N19 by reason, with T24's sentence. The review panel (contract 7) is
computed from these audit rows.

**`collective_dissolve(p_collective_id, p_reason text, p_actor_venue_id, p_actor_user_id, p_now) RETURNS jsonb`**
`p_reason` is `'host_ended'`, `'paused_expired'`, `'below_two'` or `'host_venue_deleted'`; returns
`{ members_released, invitations_removed }`. Exclusive lock. Every `invited` row becomes `removed`
with `invitation_withdrawn` (N34, bell only); every `active` row, the host's included, is released through
`collective_release_member(..., 'dissolved', ...)`; offerings `archived`; `status = 'dissolved'`,
`dissolved_at = p_now`; the address is kept for the neutral page (D25, 90 days, each member's
`list_on_old_page`); `collective_dissolved`; bump. Called by the host's DELETE and by both crons
(paused 30 days; active membership below two), one path. N19 to live members after commit.

**`collective_transfer_host(p_collective_id, p_new_host_venue_id, p_actor_venue_id, p_actor_user_id, p_now) RETURNS jsonb`**
`{ items, links_rekeyed }`. Exclusive lock; refuse with `COLLECTIVE_LINKS_BEHIND` unless every live
link has `applied_revision = desired_revision` and equal fingerprints; snapshot bookings on every
master and the new host's replicas first (PRICE-10). Per active offering, with M the master at the
old host H and R the new host N's replica: set `master_service_id = R`; clear `replica_of_*` and
`managed_by_collective_id` on R's children; set M's children's `replica_of_*` to R's child ids
(found through their own pointers at M); rewrite every other member's `replica_of_*` from M's ids
to R's; convert the link (item, N) to (item, H) with `replica_service_id = M`, `provenance =
'adopted'`, `desired_revision + 1`; N's managed library objects become its own, H's same objects
become managed. `UPDATE venue_collectives SET host_venue_id = N, pending_host_venue_id = NULL,
host_transfer_at = NULL, paused_at = NULL, paused_reason = NULL` (the guard lets the flag through);
assert every fingerprint still matches or RAISE; `host_transferred` (and `collective_resumed` when
it was paused); bump. N22 after commit. The request, cancel and decline are route writes of
`pending_host_venue_id` and `host_transfer_at` with `host_transfer_requested` (N20, reminder after
3 days) and `host_transfer_cancelled` rows; the candidate's acceptance sends N21 (reminder 2 days
before); a second request is refused with `COLLECTIVE_TRANSFER_PENDING` while one is pending;
on the day `collective-verify` calls this function, retrying daily for 7 days while links are
behind, then cancelling with N22 (T22). A take-over while paused calls it directly.

**`collective_undo_master_change(p_audit_event_id uuid, p_actor_venue_id uuid, p_actor_user_id uuid, p_now timestamptz DEFAULT now()) RETURNS jsonb`**
`{ restored: { service, variants, addon_links, requirements }, links_bumped }`. Shared lock; the
row must be `master_changed` for a master the actor venue hosts and `created_at >= p_now -
interval '60 seconds'` (else `COLLECTIVE_UNDO_EXPIRED`, 410). Restore `changes.before` onto the
master's host columns, its variants by id, its add-on links and its requirement rows; `desired_revision
+ 1` on every live link (explicit, because the flag silences the dirty triggers); audit
`master_change_undone`; bump. The route runs inline applies and sends N6 again with the "put back"
wording.

**`collective_invariant_report(p_since timestamptz DEFAULT NULL, p_collective_id uuid DEFAULT NULL) RETURNS TABLE (invariant text, violations bigint, sample_ids uuid[])`**
Runs the test plan §4 SQL for I1 to I32 and P1 to P5 (binding `:since` and `:collective` to the two
parameters; a NULL collective means every collective) and the I33 to I48 checks that have SQL,
returning one row per invariant with up to 20 sample ids for repair. Read-only.

**The verifier (`collective-verify`)** reads the report, then: I3b, apply with `p_job =
'collective-verify'`; I5, `collective_release_member` for the membership that is no longer active
(idempotent); I3, write `unexplained_drift_repaired` with the replica-side projection as `before`,
then apply, and alert (T1); every other non-zero row alerts without repairing. The same run
expires invitations at 30 days (`removed`, `invitation_expired`, N35) and reminds at day 7 (N1
again, through a `notice` job), dissolves collectives paused 30 days, releases members suspended 30
days (`suspended_expired`, N17), applies the day-14 default on unanswered adoptions, and runs the
due host transfer. Member lapse itself is written by the subscription cron that already handles
link expiry: `suspended_at` set (`member_suspended`, N36) and cleared (`member_resumed`, N37); for
the host's row it also sets `paused_at` and `paused_reason = 'host_lapsed'` (`collective_paused`,
N23) and clears them on resume (`collective_resumed`, N22).

**Trigger functions** are listed in C.4; each is `RETURNS trigger`, `SECURITY DEFINER`, `SET
search_path = ''`, no flag clause, and none is granted to any client role.

## Appendix E. API contracts

Every route follows the repository's shape: a Next handler under `src/app/api/`, a zod schema in
`src/lib/linked-accounts/validation.ts`, `{ error, code }` bodies built with `apiError()` from
`src/lib/api/error-codes.ts`, and every collective code registered in `API_ERROR_CODES`
(`error-codes.ts:27`). "Host admin" means an admin of the venue that hosts the live collective the
`[id]` names; "member admin" an admin of an active member venue.

| # | Surface | Method and path | Request | Response | Errors | Who |
|---|---|---|---|---|---|---|
| 1 | Offer, withdraw, add from another venue | `POST /api/venue/collectives/[id]/offerings`; `DELETE .../offerings/[itemId]` | `{ service_id }` or `{ source_venue_id, source_service_id }` (T28) | 201 `{ item_id, links: [{ venue_id, venue_name, status: 'behind' }], collective_sync }`; DELETE 200 `{ retired: [{ venue_id, kept_bookings }] }` | 403; 409 `COLLECTIVE_LEGACY_MODEL`, `COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE` | Host admin |
| 2 | Retry | `POST /api/venue/collectives/[id]/replicas/retry` | `{ venue_id?, link_ids? }` | 200 `collective_sync` (T10) | 403 | Host admin |
| 3 | History | `GET /api/venue/collectives/[id]/history?filter=all,services,calendars,members&venue_id=&from=&to=&cursor=&limit=50`; `?format=csv` | query | `{ events: [{ id, at, type, sentence, actor: { venue_name, person }, changes }], next_cursor }`; CSV | 403 | Host admin: all rows; member admin: rows targeted at its venue or collective-wide |
| 4 | Host service save | `PATCH /api/venue/appointment-services` | gains `expected_updated_at` (the row's `updated_at` as loaded, compared as an exact timestamptz) and `collective_calendars { add: [{ calendar_id, venue_id }], remove: [...] }` | gains `collective_sync` | 412 `STALE_RESOURCE`; 409 `COLLECTIVE_MANAGED_SERVICE` on a replica | Host admin; member admin for venue-class columns only |
| 5 | Services GET | `GET /api/venue/appointment-services` | | per service `collective`; host admins `collective_calendars` (below) | | Any staff |
| 6 | Accept | `PATCH /api/venue/collectives/[id]/members` `action: 'accept'` | gains `consent_version`, `same_name_choices`, `own_service_choices`, `form_choices` (below) | 200, or 202 `{ operation_id }` | 409 `COLLECTIVE_CONSENT_REQUIRED` | Invitee admin |
| 7 | Leave | same route, `action: 'leave'` | no link option (DL12) | `{ review: { prices, sameName, stripe, library, photos, unparked } }` | | Member admin |
| 8 | Host transfer | same route, actions `offer_host { venueId }`, `accept_host { consent_version }`, `decline_host`, `cancel_host_transfer`, `take_over_hosting { consent_version }` | | 200 | 409 `COLLECTIVE_LINKS_BEHIND`, `COLLECTIVE_TRANSFER_PENDING`, `COLLECTIVE_CONSENT_REQUIRED` | Host admin; candidate admin |
| 9 | Dissolved listing | same route, `configure { list_on_old_page }` after dissolve | | 200 | | Former member admin |
| 10 | Suggest; answer an adoption | `POST /api/venue/collectives/[id]/suggestions { service_id }`; `POST .../adoptions/[itemId] { choice: 'use_mine' or 'keep_separate', option_map }` | | 201; 200 | 409 `COLLECTIVE_LEGACY_MODEL` | Member admin |
| 11 | Calendar Availability save | `PUT /api/venue/practitioner-services` | gains `expected_service_ids: uuid[]` (the full set as loaded) | `{ success, added: [], removed: [] }` | 412 `STALE_RESOURCE` | Venue admin, own calendars |
| 12 | Per-calendar values | `PATCH /api/venue/practitioner-service-overrides` (admins and all seven fields); host on a member calendar: `PUT /api/venue/collectives/[id]/calendar-values { calendar_id, service_id, values }` | | `{ assignment_id, before, after }` | 400 floor and flag; 403 | Calendar staff within flags; venue admins; host admin |
| 13 | Bulk lane | `POST /api/venue/collectives/[id]/bulk { ops: [{ op: 'offer','withdraw','assign','unassign','retry', service_id, venue_id?, calendar_id? }] }` (max 200; the client chunks); `POST .../bulk/preview` same body | | `{ results: [{ index, ok, code?, message? }] }`; preview: per venue what guests would see (`ov.preview.*`) | per-op codes | Host admin |

**Contract 8 as built (2026-09-16).** The request and the acceptance are not route writes as §6.7 first
said, because only the engine may write `collective_audit_events`: they are two service-role functions,
`collective_request_host_transfer` and `collective_accept_host_transfer` (20270218120000), each of which
sets the pending columns, audits the step and queues its notice. The acceptance is audited as the new
event type `host_transfer_accepted`. The candidate's refusal is its own action, `decline_host`, which
calls `collective_cancel_host_transfer` with the candidate as actor. The notices the engine queues
(N19 to N23) are sent by a drain in the replicate cron. The N20 and N21 reminders are not built yet.

**Built 2026-09-16, with two additions.** The body takes `acknowledge_affected`, because a
removal that would leave bookings behind writes nothing and comes back as the per-op code
`COLLECTIVE_AFFECTED_BOOKINGS` (new in `API_ERROR_CODES`), which the host answers the same way
it answers the single-service removal. The response also carries `collective_sync`, because the
members' copies are applied once at the end of the whole call rather than once per operation,
and the host needs the same "who is still updating" line a single save gives it. The preview
half was built the same day: it applies the staged operations to a copy of the collective as it is
now and answers `{ venues: [{ venue_id, venue_name, is_host, shows, hides: [{ reason }] }] }`,
where a reason is one of the catalogue's exclusions or `no_calendars`. It previews the whole staged
set in one call (up to 1,600 operations) rather than the first 200, because a preview of part of
the save would describe a different page from the one the host is about to make.
| 14 | Undo | `POST /api/venue/collectives/[id]/undo { audit_event_id }` | | `collective_sync` | 410 `COLLECTIVE_UNDO_EXPIRED` | Host admin |
| 15 | Notification preferences | `PATCH /api/venue/notifications/preferences` | gains `collective_digest`, `collective_calendars` | | | Venue admin |
| 16 | Contact search | `GET /api/venue/guests?scope=collective&q=` | | rows gain `owner_venue_id`, `owner_venue_name` | 403 outside a live collective | Staff of a live member |
| 17 | Platform console | `GET /api/platform/collectives`; `POST /api/platform/collectives/[id]/links/[linkId]/retry` | | below | | Platform superuser |
| 18 | Crons | `GET /api/cron/collective-replicate`; `GET /api/cron/collective-verify` | | `{ ok, job, errors, ...counters }` (§6.16) | 401 | `CRON_SECRET` |
| 19 | Venue settings | `PATCH /api/venue` | | | 409 `COLLECTIVE_TIMEZONE_LOCKED`, `COLLECTIVE_BOOKING_MODEL_LOCKED`, `COLLECTIVE_CURRENCY_MISMATCH` | Venue admin |
| 20 | Pages | `/embed/c/[slug]`; the dissolved page | pages, not APIs | | | Public |
| 21 | Codes | `src/lib/api/error-codes.ts` | the one list in Appendix D | | | W2 |

**Services GET shapes (contract 5).** The route returns `{ services, practitioner_services,
categories? }` (`appointment-services/route.ts:713-720,771-777`). Each service gains:

```
collective: null | { role: 'master' | 'replica' | 'retired' | 'parked', collective_id, collective_name, host_venue_name,
  item_id, locked_fields: string[], delegated_fields: string[],
  status: 'up_to_date' | 'updating' | 'setting_up' | 'failed' | 'hidden' | 'paused', status_reason,
  last_applied_at, hidden_reasons: [{ venue_id, reason: 'no_stripe' | 'forms_off' | 'suspended' | 'behind' }] }
```

and host admins get, top level and never merged into `practitioner_services` (§6.11):

```
collective_calendars: [{ venue_id, venue_name, is_host, sync: collective_sync,
  calendars: [{ id, name, is_active, assigned: [{ item_id, service_id,
    values: { custom_name, custom_description, custom_duration_minutes, custom_buffer_minutes,
      custom_price_pence, custom_deposit_pence, custom_colour },
    last_changed: { venue_name, at } | null }] }] }]
```

**Amended 2026-09-16, as built.** `assigned` was one boolean per calendar, with the values and
`last_changed` beside it. That can only answer for a single service, and the grid (item 15) puts
every service against every venue in one read, so a calendar instead carries the list of services
it offers. A page showing one service looks for that service's `item_id` in the list, which means
the same thing, and finds the values and `last_changed` that went with it. The list is only as long
as the assignments that exist, so nothing is sent for a calendar that offers nothing.

`values` are the stored values, gated by the master's flags (a stored value under a flag that is
off comes back null, TERMS-14); the seven fields today are two real columns and five hard-coded
nulls (`route.ts:680-684`). `status` is one enum, defined once in
`src/lib/linked-accounts/replicas/status.ts` and reused by `VenueSyncPill`.

**The accept payload (contract 6), as `collectiveMemberActionSchema` grows.** The schema at
`validation.ts:232-251` lists seven actions (`233-241`) and `soloPageBehavior` (`250`, retired by
T18). For `accept`: `consent_version`, a non-empty string; `same_name_choices`, an optional array
of `{ item_id: uuid, choice: 'add_new' | 'use_mine', my_service_id?: uuid, option_map?: [{
my_variant_id: uuid, host_variant_id: uuid | null }] }` where `use_mine` requires `my_service_id`;
`own_service_choices`, an optional array of `{ service_id: uuid, choice: 'ask' | 'park' }`, where a
member-only service left out is `park` (D2 as revised 2026-09-14 removed `keep` and renamed `pause`); `form_choices`, an optional array of `{ host_type_id: uuid, choice: 'use_existing' |
'use_theirs', my_type_id?: uuid }` where `use_existing` requires `my_type_id`. A missing
`consent_version` answers 409 `COLLECTIVE_CONSENT_REQUIRED` before any read. Today's accept writes
`status: 'active'` at `members/route.ts:242` and returns `finish()` at `250`; it becomes one call to
`collective_join_member`. The `same_name` list the dialog shows is server-computed by the route
(GET on the invitation) with one strict normaliser (`lower(btrim(name))`), not the legacy loose one.

**Platform console routes (contract 17).** `GET /api/platform/collectives` returns `[{ id, name,
service_model, status, paused_at, members: [{ venue_id, name, role, health }], links: [{ id,
venue_name, service_name, desired_revision, applied_revision, behind_since, attempts,
last_error_code }], recent_events: [ ...50 ] }]`; the retry calls `collective_apply_replica(...,
p_job => 'retry', p_support_session_id => <session>)` and writes a platform audit row. Auth as
`src/app/api/platform/summary/route.ts:11-12` (`requirePlatformSuperuserAuth` from
`@/lib/platform-api-auth`), audit through `recordPlatformAuditEvent`
(`src/lib/platform/audit.ts:18`). No guest contact detail is ever in the payload.

**Crons (contract 18)** wrap `withCronRunLogging` (`src/lib/platform/cron-log.ts:13`), guard with
`requireCronAuthorisation` (`src/lib/cron-auth.ts:8-24`) and finish through `finalizeCronRun`
(`src/lib/cron/finalize-cron-run.ts:39`); `vercel.json` holds 25 cron paths today and gains two.

**Existing routes that change, with today's lines.**

- `PATCH /api/venue/appointment-services` (`route.ts:1151`): deletes every assignment for the
  service and re-inserts (`route.ts:1394-1401`); it becomes a diff inside one transaction with
  `expected_updated_at`, and the guard and the `STALE_RESOURCE` check run before any write (§6.5).
  The GET (`route.ts:618`) builds `practitioner_services` at `666` with five nulls at `680-684`.
  Edit order W2, W8, W6, W5 (T29).
- `PATCH /api/venue/practitioner-service-overrides`: refuses admins at `route.ts:89-94`, validates
  seven fields at `9-20`, but stores only `custom_duration_minutes` and `custom_price_pence`
  (`172`). It accepts admins and writes all seven; the host-on-member case uses contract 12's PUT
  because this route is scoped to `staff.venue_id`.
- `PUT /api/venue/practitioner-services`: `service_ids` at `route.ts:20`, delete-then-insert at
  `110`; becomes a diff with `expected_service_ids`.
- `PATCH /api/venue/collectives/[id]/members`: status writes at `members/route.ts:189`, `256`,
  `280` become calls to `collective_release_member` (cancelling an invitation is `remove` on an
  `invited` row: `invitation_withdrawn`, N34); the accept handler (`242`, `250`) becomes
  `collective_join_member`. `PATCH /api/venue/collectives/[id]/catalogue`: the twelve actions at
  `catalogue/route.ts:450-737`; `set_providers` skips failures (`if (!res.ok) continue;`) and
  answers 400 only when nothing applied; its `ops` cap is `.max(200)` (`validation.ts:337-354`).
  Under the fold, `create_item` maps to offer, `archive_item` to withdraw, heading actions to
  `COLLECTIVE_HEADINGS_FOLLOW_SERVICES`, and every provider action to contract 13 with a
  per-operation envelope (CB-44, CB-45).
- `PATCH /api/venue/notifications/preferences`: `prefsSchema` is `.strict()` with four keys
  (`route.ts:10-17`); it gains the two keys; `collective_required` is display-only.
- `GET /api/venue/guests` (`route.ts:71`): `.eq('venue_id', staff.venue_id)` at `150`, `237`, `285`,
  and helpers take `staff.venue_id` at `212`, `269`, `317`, `337`, `349`, `380`; `scope=collective`
  widens to every active member venue, names the owner on each row, and is 403 outside a live
  collective.
- `PATCH /api/venue` (`route.ts:226`): the timezone rule at `61-65` and `active_booking_models` at
  `74` gain the three refusals.
- `DELETE /api/venue/collectives/[id]`: today flips rows at `route.ts:259-263`; it becomes
  `collective_dissolve`. The dissolve slug rewrite there ends: the address is kept for the neutral
  page.
- `PATCH /api/venue/collectives/[id]`: an `adopted_venue_id` change no longer writes. It records
  `address_adoption_requested` and sends N38 to that venue's admins; one of them confirms with the
  members `PATCH` `action: 'confirm_address_adoption'`, which writes `adopted_venue_id` and
  `slug_strategy` and `address_adopted` (§6.9).
- `src/app/embed/` holds `[venue-slug]` and `layout.tsx` only; `/embed/c/[slug]` is new.

## Appendix F. Column registry

`service_items` has **45** columns in the migration set, counted with the repository's own guard
(`tableColumnsFromMigrations` in `src/lib/testing/migration-columns.ts:32-70`) over the CREATE
TABLE at `20260430120000_unified_scheduling_engine.sql:87-107` (19 columns) and the ALTERs in
`20260402190000_service_items_staff_may.sql`, `20260419120000_service_custom_availability.sql`,
`20260430120100_service_items_pre_unified_column_alignment.sql` (which re-adds the nine columns
the first two add, `IF NOT EXISTS`), `20260506120000_appointment_service_payment_requirement.sql`,
`20260508130000_per_entity_booking_rules.sql`, `20260511120100_service_created_by_staff.sql`,
`20260830120000_processing_time_blocks.sql`, `20261216120000_service_location.sql`,
`20261221120000_appointment_booking_interval.sql`, `20270101123000_appointment_fixed_start_times.sql`,
`20270202120000_service_categories.sql` and `20270209120000_service_sync_from_origin.sql`. If a
hosted environment shows 46, the extra column lives outside the migration history and DB-07 names
it; neither document hard-codes the number into a test. The five classes: **host** is written on
every apply; **identity** is recomputed or mapped; **venue** is written once at replica creation
(seeded from the master) and never overwritten; **not_copied** is never written by the engine;
**derived** is computed by the engine from more than one source. The plan's §6.3 names the first
four; `derived` covers the seven columns below that no copy produces.

| # | Column | Class | Note |
|---|---|---|---|
| 1 | `id` | identity | mapped through `collective_service_replicas.replica_service_id` |
| 2 | `venue_id` | identity | the member venue |
| 3 | `name` | host | D29: one name everywhere |
| 4 | `description` | host | |
| 5 | `item_type` | host | only `'service'` is written today |
| 6 | `duration_minutes` | host | |
| 7 | `buffer_minutes` | host | |
| 8 | `processing_time_minutes` | host | |
| 9 | `price_pence` | host | the commercial term N6 announces |
| 10 | `deposit_pence` | host | |
| 11 | `price_type` | host | |
| 12 | `capacity_per_session` | venue | D40, T12: seeded from the master once, never overwritten; the member PATCH allowlist names it |
| 13 | `pre_appointment_instructions` | venue | T13 (D53): seeded from the master; it describes the venue the guest visits |
| 14 | `colour` | host | |
| 15 | `sort_order` | venue | the member's own list order; the page follows the master's; dirty triggers skip it |
| 16 | `is_active` | derived | master active AND offering active |
| 17 | `is_bookable_online` | host | "Staff bookings only" (`svc.form.staffOnly.label`); read nowhere in the booking path today, wired in W4 on every venue (§6.6) |
| 18 | `created_at` | not_copied | |
| 19 | `updated_at` | not_copied | maintained by the new trigger |
| 20 to 26 | `staff_may_customize_name`, `_description`, `_duration`, `_buffer`, `_price`, `_deposit`, `_colour` | host | D29 is a rule of the apply, not a class: name and description are forced `false` on the master when it is offered and copied as such, so a replica never delegates them |
| 27 | `custom_availability_enabled` | host | the service schedule |
| 28 | `custom_working_hours` | host | |
| 29 | `payment_requirement` | host | downgraded at the member only after release |
| 30 | `max_advance_booking_days` | host | |
| 31 | `min_booking_notice_hours` | host | |
| 32 | `cancellation_notice_hours` | host | |
| 33 | `allow_same_day_booking` | host | |
| 34 | `created_by_staff_id` | not_copied | NULL at the replica; drives the creator exception (§6.5) |
| 35 | `processing_time_blocks` | host | canonical shape (`20270208120000`) |
| 36 | `location_type` | host | D11 |
| 37 | `online_meeting_url` | not_copied | D11: never written from another venue. As `venue` it would be seeded from the master, which puts the host's meeting room link on a member's service (built as W3a, 2026-09-14) |
| 38 | `online_meeting_info` | not_copied | D11, as row 37 |
| 39 | `booking_interval_minutes` | host | |
| 40 | `booking_minute_marks` | host | |
| 41 | `booking_start_times` | host | |
| 42 | `category_id` | identity | mapped through `service_categories.replica_of_category_id` |
| 43 | `synced_from_service_id` | not_copied | legacy, NULL on replicas (I23), retired in C2 |
| 44 | `sync_state` | not_copied | legacy, `'independent'` on replicas |
| 45 | `synced_at` | not_copied | legacy |

**Child tables** (existing column counts from the same guard, plus the new columns of Appendix C):

- `service_variants` (15 + 1): `id`, `venue_id`, `service_item_id` identity; `appointment_service_id`
  not_copied (NULL); `replica_of_variant_id` identity; `name`, `description`, `duration_minutes`,
  `buffer_minutes`, `price_pence`, `deposit_pence`, `processing_time_blocks`, `sort_order` host;
  `is_active` derived (master active; deactivated when the master option disappears, never
  deleted); `created_at`, `updated_at` not_copied.
- `addon_groups` (13 + 2): `id`, `venue_id`, `managed_by_collective_id`, `replica_of_addon_group_id`
  identity; `name`, `prompt_to_client`, `description`, `selection_type`, `min_select`, `max_select`,
  `hidden_from_online`, `is_active` host; `sort_order` venue; `created_at`, `updated_at` not_copied.
- `addons` (13 + 1): `id`, `venue_id`, `addon_group_id`, `replica_of_addon_id` identity; `name`,
  `description`, `additional_price_pence`, `additional_duration_minutes`, `is_active`, `sort_order`
  host; `cost_to_business_pence` not_copied (§6.2); `archived_at` derived; `created_at`,
  `updated_at` not_copied.
- `service_addon_groups` (7): `id`, `venue_id`, `service_item_id`, `addon_group_id` (the managed
  group) identity; `appointment_service_id` not_copied; `sort_order` host; `created_at` not_copied.
- `service_categories` (6 + 2): `id`, `venue_id`, `managed_by_collective_id`, `replica_of_category_id`
  identity; `name` host (renamed in place); `sort_order` venue; `created_at`, `updated_at` not_copied.
- `compliance_types` (17 + 3): `id`, `venue_id`, `managed_by_collective_id`,
  `replica_of_compliance_type_id`, `accepts_records_from_type_id`, `current_version_id` identity;
  `slug` derived (adopted, else the same, else suffixed; unique per `(venue_id, slug)`); `name`,
  `category`, `description`, `result_type`, `validity_period_days`, `capture_methods`,
  `form_link_expiry_days`, `library_template_slug`, `online_unmet_message` (T13) host; `is_active`,
  `archived_at` derived (unarchived on adoption); `created_at`, `updated_at` not_copied.
- `compliance_type_versions` (8 + 1): `id`, `venue_id`, `compliance_type_id`, `replica_of_version_id`
  identity; `version_number` derived (next at the member); `form_schema`, `changelog` host;
  `created_by_staff_id`, `created_at` not_copied.
- `service_compliance_requirements` (11 + 1): `id`, `venue_id`, `service_item_id`,
  `compliance_type_id` (mapped), `replica_of_requirement_id` identity; `appointment_service_id`
  not_copied; `enforcement`, `lock_period_hours`, `online_collection` derived (merged with the
  host's venue-wide requirement: strictest, longest, online if either); `scope` derived
  (`'service'` on replica rows; `20270201120000:26-27`); `created_at`, `updated_at` not_copied.

**Two cautions for the registry test.** First, the TypeScript guard parses two CHECK-constraint
words as columns: running it today lists `or` for `addon_groups` and `and` for
`compliance_types`, so DB-07 enumerates from `pg_attribute` as the test plan says and never from
the guard. Second, `SERVICE_COLUMNS_NOT_COPIED` (`src/lib/linked-accounts/service-duplication.ts:48-60`)
named eleven columns, so the copy path carried `online_meeting_url`, `online_meeting_info` and
`addons.cost_to_business_pence` from one business to another. W3a (migration `20270211120000`,
built 2026-09-14) makes it read the registry and copy only `host`, `venue` and `derived` columns:
the meeting link, joining information and add-on cost stop travelling, `capacity_per_session` and
`pre_appointment_instructions` are still seeded (D40, D53), and a column the registry does not
know is left behind. The dry run must show the columns that stop being copied.

## Appendix G. Migration script

`scripts/collective-replicas-migrate.mjs` follows the conventions of
`scripts/seed-e2e-smoke-venue.mjs:15,24-31` (`dotenv` from `.env.local`, `createClient` with
`SUPABASE_SECRET_KEY`) and gets an npm entry beside `check:table-grants` (`package.json:12`). The
algorithm below is §7 under D54, one collective at a time, with the two rules at its head: existing
bookings are untouched, and the host's values apply to every service at the switch.

**CLI and fence.** `--collective <uuid>` (required) with exactly one of `--survey`, `--dry-run`,
`--apply --approved-report <sha256>`, `--rollback [--restore-stale <service_id>]...`, and `--env
staging|production`. The fence refuses `--apply` and `--rollback` when the host of
`NEXT_PUBLIC_SUPABASE_URL` is not the project ref expected for `--env`; refuses `--apply` unless a
fresh dry run hashes to `--approved-report`; refuses `--apply` when `service_model = 'replicas'`
already (a restart resumes from `collective_operations` instead); pages every read at 1,000 rows
(`max_rows = 1000`, `supabase/config.toml:18`).

**Survey (`--survey`, `--dry-run`).** P1, P2 and P3 are the test plan §4 queries verbatim
(`Docs/collective-one-venue-test-plan.md:1440-1451`). P4 and P5:

```sql
-- P4 copy variants with future bookings that the mapping precedence leaves unmapped (no master variant with the
-- same normalised name, and none at the same position). The script computes the exact mapping; this is the probe.
SELECT count(*) FROM public.service_variants cv
JOIN public.collective_service_providers p ON p.source_service_id = cv.service_item_id AND p.status = 'active'
JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = :collective
JOIN public.venue_collectives c ON c.id = i.collective_id AND p.venue_id <> c.host_venue_id
JOIN public.collective_service_providers hp ON hp.item_id = i.id AND hp.status = 'active' AND hp.venue_id = c.host_venue_id
WHERE EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_variant_id = cv.id
              AND b.booking_date >= current_date AND b.status <> 'Cancelled')
  AND NOT EXISTS (SELECT 1 FROM public.service_variants mv WHERE mv.service_item_id = hp.source_service_id
              AND (lower(btrim(mv.name)) = lower(btrim(cv.name)) OR mv.sort_order = cv.sort_order));
-- P5 active offerings with no active host source (needs_master)
SELECT count(*) FROM public.collective_service_items i
JOIN public.venue_collectives c ON c.id = i.collective_id AND c.id = :collective
WHERE i.status = 'active' AND NOT EXISTS (SELECT 1 FROM public.collective_service_providers p
  WHERE p.item_id = i.id AND p.status = 'active' AND p.venue_id = c.host_venue_id);
```

The extra checks, each a count with sample ids: offerings whose name, description, photo, heading
or order differ from the master's; collective headings with no same-named host heading; non-null
provider overrides and non-approved provider rows; member-inactive copies; copies whose add-on
links resolve to member-owned groups; stored per-calendar values under a flag the host has off;
member assignments on copies that are not providers; `synced_from_service_id = id` rows; copies
following an origin outside this collective (I45); providers with `practitioner_id IS NULL` (the
"all calendars" mode, `20261210120000_combined_booking_page.sql:113`); dissolved residue counts;
Stripe readiness per venue; forms flags and the `FEATURE_FLAG_*` environment overrides; I7; and
any member pair whose account link has fallen below the full-access mesh (read only, D41); an
adopted page address (listed, left as it is); and `service_items` rows with
`is_bookable_online = false` (W0, §6.6).

**Master selection.** Per active offering, the distinct `source_service_id` among active providers
at `host_venue_id`: exactly one is the master; more is P1 and stops the run; none is P5, and under
D36 the apply creates the host service active from the earliest active provider's service (by
provider `created_at`), copying the registry's host columns with `created_by_staff_id NULL` and
`sort_order` appended, before any link is made. Where the offering's curated page copy differs from
the master the report lists it (`page_copy`); the master stands, and the host edits the master
before the switch if it prefers the page's wording (D54).

**Link creation.** Per (offering, active non-host member): the member's copy is the
`source_service_id` of its active providers for the item (two items sharing one copy is P2); no
provider means `replica_service_id NULL` and the engine creates the row. Every link is
`provenance = 'migrated'`, `desired_revision 1`, `applied_revision 0`. The copy's three sync
columns are recorded in the before-image and then cleared (I23).

**The D54 steps, in order.** (1) The owner signs the operator's report and tells the venues in
person; nothing is sent from the product and there is no review window (a venue that wants out
leaves beforehand through today's Leave, a legacy leave that loses nothing). (2) No per-calendar
value is written or cleared: the host's values apply to every replicated column at the switch, and
stored per-calendar values on member calendars stay where they are, applying only while the host's
permission for that field is on. (3) Every copy's previous row, option rows, add-on links,
requirement rows and sync columns, and every provider row, are recorded in one `migration_applied`
row per member (`changes.before`) for rollback; no per-value rows are written and nothing is shown
to the member. (4) Each member-only service carries the owner's `choice` in the signed report (D2
as revised 2026-09-14): `add_to_page` copies the member's service into a new host master (the
registry's host columns, as "Add from another venue" does), offers it, and adopts the member's own
service as its replica (`provenance = 'adopted'`, options mapped one to one, its bookings
snapshotted first), so its settings, calendars and bookings do not change; `park` leaves it exactly
as it is, and it is parked from the switch because parking is derived (§6.6). The report says
plainly which services stop taking new bookings.
(5) The member's compliance flag is left as it is; the migration switches nothing on; form-bearing
offerings are bookable at the member only once forms are on. (6) Account links are read to
confirm the full mesh and never written (D41).

**Option mapping precedence.** Exact normalised name first; then unmatched copy variants to
unmatched master variants by `sort_order` position; the rest with future bookings are kept,
inactive, with `replica_of_variant_id NULL` (P4 lists them), and the rest without are deactivated.
`replica_of_variant_id` is written before the first apply, in the same transaction as the
snapshots (PRICE-10).

**Snapshots.** `UPDATE public.bookings SET service_price_snapshot_pence = <resolved> WHERE
service_item_id IN (masters and copies) AND service_price_snapshot_pence IS NULL`, resolving in the
fallback trigger's order. Pass A's D7 backfill already covers every appointment booking, so this is
a safety re-run and must report 0 rows on a clean Pass A.

**Forms.** The migration adopts nothing itself. It marks each member's same-template type, where
one exists, as the adoption target, exactly as `collective_join_member` does, and the first apply
performs the §6.4 order; no venue's compliance flag changes.

**Assignments (I4).** Each active provider with `practitioner_id` set and no assignment gets one
(`calendar_id = practitioner_id`, `service_item_id = source_service_id`); a provider with
`practitioner_id IS NULL` expands to every active calendar at that venue that already has an
assignment for `source_service_id` (the legacy meaning), and a provider that expands to nothing is
reported.

**Apply, switch and drain.** One `collective_operations` row, `kind = 'migrate'`,
`idempotency_key = 'migrate:' || collective_id`, `progress = { phase, report_hash, done_links,
before_images_written }`. In one transaction under the engine flag: snapshots; masters set;
`service_model = 'migrating'` (the legacy catalogue keeps serving, member locks are on, engine
applies run, the "behind" hide is suspended); links created, including the `adopted` links for
member-only services chosen `add_to_page`, with their masters copied first; options mapped; adoption targets
marked; a same-shape member add-on group adopted as the managed group rather than duplicated;
managed headings created rather than a member's own renamed; missing assignments created; one
`migration_applied` row per member carrying the full before-image (the copy row, its option rows,
add-on links, requirement rows, the three sync columns, and the provider rows with ids, overrides,
approval, status and `created_at`) and, after the drain, the `updated_at` of every row it wrote.
Then, outside any transaction, one `collective_apply_replica(link, NULL, NULL, 'inline')` per link
in id order, which is what writes the host's values onto each copy, `done_links` appended after
each, resumable after a kill (MIG-02). When every link has converged, `service_model = 'replicas'`
in its own statement; the own-page handover then follows from the derived rule (T18). No notice
is sent (D54). Never write or clear a per-calendar value, never change a member-only service's
`is_active`, never flip a venue flag.

**Verify.** `collective_invariant_report(p_since, p_collective_id)`: I1 to I3, I5, I8, I10 to I16,
I23, I32, I33 and I45 all 0; every booking total unchanged, checked as
`sum(coalesce(booking_total_price_pence, 0))` and a per-booking hash of the resolver's output taken
before and after; `scripts/collective-catalogue-snapshot.mjs` shows only intended changes; each
member's catalogue diff equals what its review showed; no offering field differs from its master
except as the host chose; every member keeps at least one calendar on the page or was told which
disappear and why.

**Rollback (`--rollback`, valid until C1).** Restores what the migration recorded, never what the
database happens to hold: the provider snapshot, the copies' rows, option rows and states, add-on
links, requirement rows, the compliance types' prior archived state and mappings, the three sync
columns, `legacy_copies`, and the masters' before-images where written. The freshness rule: a
before-image is applied only where the row's `updated_at` still equals the value recorded after the
drain; a row changed since is skipped, listed, and restored only with `--restore-stale <service_id>`,
which the owner confirms per service. Per-calendar values are never touched in either direction. Links are released directly (`released_at`,
under the flag, `migration_rolled_back` per member) without ending any account link, because those
existed under the legacy model. Bookings and their snapshots are never touched. `--apply` again
converges (MIG-03).

**Residue, before C2.** Every dissolved collective's provider rows, its offerings' dead columns, and
every collective's provider overrides and approval history are exported to
`collective_audit_events` before anything is dropped, as `migration_applied` rows whose `changes`
carry `{ before: <residue>, after: null }` (the register's event list has no residue type; see the
report). Copies at former members still following a dissolved collective's host are set
`independent` with an audit row. `UPDATE public.bookings SET source = 'collective_page' WHERE
collective_id IS NOT NULL AND source = 'booking_page'`, in a migration after the enum value lands.

**Report schema and hash.** Canonical JSON (sorted keys, no whitespace), `sha256` in hex over the
UTF-8 bytes, printed by `--dry-run` and required verbatim by `--approved-report`:

```
{ collective, generated_at, code_version, service_model, p1, p2, p3, p4, p5, checks: { <name>: { count, sample_ids } },
  masters: [{ item_id, master_service_id, created_from_service_id | null }],
  page_copy: [{ item_id, differs: [column] }],
  links: [{ item_id, venue_id, copy_service_id | null,
            replaced: [{ column, before, after }],
            options: [{ copy_variant_id, master_variant_id | null, rule, has_bookings }] }],
  member_only: [{ venue_id, service_id, choice: 'add_to_page' | 'park' }], forms: [{ venue_id, host_type_id, adopts_type_id | null }],
  mesh_gaps: [{ venue_id, other_venue_id }], assignments_to_create, bookings_to_snapshot,
  collisions: [...], invariants_before: { <invariant>: count } }
```

The operator and the owner read the whole document; nothing is rendered to members (D54).

**Pass A go conditions (before any production migration).** `venues.stripe_charges_enabled`
backfilled from Stripe for every venue with a connected account before the hide rule ships; every
MGR-01 shim, the manager fold, the 24-hour `STALE_RESOURCE` rule and the accept consent gate proven
to condition on `service_model = 'replicas'` (I48 = 0); the staging rehearsal has shown every booking
untouched through apply and rollback, a legacy leave before the switch losing nothing, a rollback
restoring the provider snapshot, the sync columns, add-on links, option states and compliance type
states exactly, and the catalogue diff equal to the signed report; and no member loses every
calendar from the page.

## Appendix H. Component contracts

None of the components below exists in `src/` today, and `src/components/linked-accounts/collective/`
does not exist; `VenueCollectivesPanel.tsx` and `CombinedPageManager.tsx` live in
`src/components/linked-accounts/`. Three primitive facts every builder needs: the `Dialog` primitive
(`src/components/ui/primitives/Dialog.tsx:25-41`) exposes `open`, `onOpenChange`, `title`,
`description`, `footer`, `size`, `showClose`, `hideHeader`, `className`, `contentClassName`,
`bodyClassName` and `onOverlayClick`, and has no `busy` prop, so "busy suppresses dismissal" is the
caller's guard, as `MergeContactsModal.tsx:318-320` does it (`onOpenChange={(next) => { if (!busy
&& !next) onClose(); }}`, with `description={`Step ${step} of 4 ...`}` at `322`); `ConfirmDialog`
(`src/components/ui/primitives/ConfirmDialog.tsx:7-29`) takes `message`, optional `body`,
`confirmLabel` and `destructive`, and defaults `destructive = true` (`:41`), so every
non-destructive ask (offer, re-offer, activate, stop offering a calendar, ticks) passes `false` and
only withdraw, deactivate, delete, leave, remove and dissolve keep the default; `Pill`
(`src/components/ui/dashboard/Pill.tsx:3`) offers `success`, `neutral`, `warning`, `danger`,
`brand`, `info` and `dot`.

| Component | Props | Data source | Resolved |
|---|---|---|---|
| `CreateCollectiveDialog` (J1) | `{ open, onOpenChange, candidates: [{ venue_id, name, eligibility: 'ok' | 'no_payments' | 'other_collective' | 'timezone' | 'currency' | 'plan' | 'partial_link' }], onCreated(body) }` | candidates from a GET on the create route (the route today returns prose refusals only, `src/app/api/venue/collectives/route.ts`, 207 lines); `onCreated` consumes the POST's 201 body | the eligibility enum is server-computed, one reason per venue; the dialog never re-derives it; busy is the `onOpenChange` guard; step 5 renders from the 201 body with no refetch |
| `CollectiveCalendarsSection` | `{ groups: collective_calendars, value: { add, remove }, onChange, onEditValues(venue_id, calendar_id), onRetry(venue_id), scope?: venue_id }` | contract 5 (`collective_calendars`); contract 4 writes | "saved as ticked" is the GET's `assigned`; the diff carries intent, never a picture; `scope` renders one venue group for the grid's cell popover |
| `MemberServiceView` (T5) | `{ service, collective, calendars, onSave(diff) }` | contract 5 per service; the "what the guest is asked for" strip needs `requirements` on the same GET (new field, `[{ type_name, enforcement }]`) | values, never disabled inputs; PATCH sends only `online_meeting_url`, `online_meeting_info`, `capacity_per_session` and `calendars { add, remove }` with `expected_calendar_ids`; 412 reloads calendars only |
| `CalendarServiceValuesDialog` (item 9) | `{ calendarId, venueId, service, flags, values, onSaved }`; generalises `StaffServiceOverrideModal` (`src/app/dashboard/appointment-services/StaffServiceOverrideModal.tsx:52-61` props, exported at `64`) | contract 12: the overrides PATCH for own calendars, the collective PUT when `venueId` is not the caller's | the "standard" value is the master's, hidden for name and description on offered services (D29); the floor and flag errors render inline from the 400 body |
| Services grid (item 15) | `{ rows: services in host order by heading, columns: venues, cells: { state: 'all' | 'some' | 'none', calendars } , selection, staged, onCommit }` | contract 5 for rows and cells; contract 13 for commit and preview; the health strip from contract 3 and `collective_calendars.sync` | chunk at 200; failed cells stay staged and selected; the cell popover is `CollectiveCalendarsSection` with `scope` |
| `CollectivePills` | `CollectivePill`, `FromHostPill`, `ParkedPill`, `VenueSyncPill { status }` | `collective.status` (contract 5) | the status enum lives in `src/lib/linked-accounts/replicas/status.ts` and nowhere else |
| `EditReachNote` | `{ id: keyof CollectiveCopy, params }` | `CollectiveContextProvider` (`venues`) through `formatVenueList` | strings only from `src/lib/linked-accounts/collective-copy.ts` |
| `CollectiveSaveSummary` | `{ sync: collective_sync, onRetry, onUndo }` | the PATCH response (contract 4, `audit_event_id`); polling by re-reading contract 5 every 5 s up to 60 s | renders under the page header in a `role="status"` region (T4); the undo posts `audit_event_id` to contract 14 and hides at 60 s |
| `AskConfirmProvider` | context `useAskConfirm(): (message, confirmLabel, opts?: { body, destructive }) => Promise<boolean>` | extracted from `CombinedPageManager.tsx:72-117`, rendering the primitive `ConfirmDialog` | `destructive` defaults to `false` in the hook (the primitive's default is the other way) |
| `JoinCollectiveDialog` (J3) | `{ invitation, disclosure, sameName: [...], ownServices: [...], forms: [...], onAccept(payload) }` | a GET on the invitation returns the server-computed lists; contract 6 accepts the payload | the strict normaliser is server-side; the dialog never matches names itself; 202 shows `join.progress` and polls the operation |
| `CollectiveContextProvider` | value `{ collectiveId, name, slug, role, hostVenueName, venues: [{ id, name, isHost, status, sync }], pageLive, ownPageRedirecting, ownPageReason }` | the one live-collective resolver, `src/lib/linked-accounts/replicas/live-collective.ts` (new; W10), read in `src/app/dashboard/layout.tsx` beside the existing load at `:188` | the same resolver drives redirects, the sidebar and email links; `ownPageRedirecting` is the derived T18 rule |
| `CollectiveServicesBanner` | `{ variant: 'host' | 'member', behind: [venue], onRetry }` | contract 5 aggregate | one Retry, calling contract 2 |
| `ManagedServiceBanner` | `{ lastUpdatedAt, status }` | contract 5 | no controls |
| `LeaveCollectiveDialog` (J7) | `{ open, onOpenChange, consequences: { noStripe, lastMember, venues }, onLeft(review) }` | contract 7 | destructive default kept; no link checkbox (DL12) |
| `CollectiveHistoryDialog` | `{ collectiveId, filter, venueId?, range? }` | contract 3 with cursor paging and CSV | sentences from `history.*` by `type` |
| `ReviewYourServicesPanel` | `{ review, onDismiss }` | contract 7's `review` | dismissal stored per viewer in `localStorage` |
| `AdoptServiceReview` | `{ item, myService, optionMap, onAnswer }` | contract 10 (adoptions) | the map defaults to name matches; unmapped options shown as "kept, not offered" |
| `DissolvedCollectivePage` | `{ collective, venues: [{ name, slug, listed }] }` | server render from `venue_collectives` (`dissolved_at`, 90 days) and `list_on_old_page` | no redirect, no 404 |
| `OwnPageStatusLine` | `{ redirecting, reason }` | `CollectiveContextProvider` | text from `bp.status.*` and `bp.reason.*` exactly as the deck defines them (T25) |
