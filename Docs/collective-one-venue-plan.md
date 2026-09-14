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
- A bare `route.ts:NNN` or `create/route.ts:NNN` means the appointment-services route and the
  public booking create route respectively (`src/app/api/venue/appointment-services/route.ts`,
  `src/app/api/booking/create/route.ts`), which are the only ones this document cites that way.
- Three citations point at the ResNeo mobile app repository (`C:/Resneo-app` at `d90dece`), not
  at this one.

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
  share a collective again, and joining forces every pair of members to share client details.

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
  so a member that also runs classes, events, tables or rooms loses those from the web the moment
  its own page starts redirecting. Nothing in the product says so.
- **Guests are split in two and cannot be put back.** The same person booking two member venues
  becomes two client records, and the merge tool refuses cross-venue pairs. Marketing consent is per
  venue, so unsubscribing at one member does not stop the others, and marketing emails carry no
  unsubscribe link at all.
- **Nobody is watching the engine, and nobody can support it.** There is no monitoring, alerting or
  runbook in the design, and the platform support console has no collective view, so the first
  report of a stuck replica would come from the host.

In total: 42 split-brain cases (§3), 43 collective bugs, 7 of them high severity, and 19 platform
bugs found on the way (§4).

**What we recommend.** Host-managed replicas with one truth per fact (§5, §6). The host's own
service is the master and the host edits it on its own Services page. Each member holds a locked
copy of every service on the collective page, rewritten by one transactional, audited engine
whenever anything about the master changes. Assignments become the only record of which calendar
offers what, so a member ticking a service on Calendar Availability updates the page at once, and
the host adds or removes member calendars from the same service form it already uses. One resolver
prices and sizes every calendar identically on every path, and bookings keep the price they were
made at. Members' own pages hand over to the collective page only while it is live and they are
listed. Leaving is one transaction: every service, calendar choice and booking stays, and the locks
lift. Two red teams found 5 critical and 16 high problems in the first version of this design; all
are resolved in §6 (table in §6.13).

**What it takes.** A first pass of fixes that are worth doing on today's model anyway (§8.1), then
six deploy passes (owed migrations, expand, migrate existing collectives, switch new collectives,
remove old code, contract) across 21 workstreams, the largest being the booking correctness work,
the engine and the lifecycle (§8). Two of the six added by the second pass, multi-venue people
(W16) and reporting (W17), carry live bugs and start immediately rather than waiting on the engine.
Testing is designed as the safety net: 147 tests including
database-level convergence and real two-connection race tests, SQL invariants run by CI, a daily
verifier and every deploy step, rollback drills, and an acceptance checklist written for you (§9 and
`Docs/collective-one-venue-test-plan.md`).

**What we need from you** (§11). Most urgent:

1. **Legal counsel before build (D9, D27).** A host setting prices and terms that independent
   businesses charge through their own Stripe accounts carries competition, employment-status,
   consumer-information and data-protection questions. The design can treat host prices as
   enforced or as recommended.
2. **Member-only services (D2)** and **when own pages redirect (D3)**.
3. **Per-calendar values**: who sets them (D4), building the five missing fields (D5), and what
   turning a permission off does (D6).
4. **Compliance at members (D10)** and **payments at members without Stripe (D8)**.
5. **Group bookings across venues (D28)** and **whether host transfer ships first time (D12)**.
6. **The staging migration list (D21)**, corrected in §7: Light 3 has forms switched off and no
   Stripe account, so some of what the earlier draft promised would not happen there.

The eight the second pass raised (D38, D39, D41, D42, D44, D49, D50, D51) were answered on
2026-09-14 and are recorded in §11.4. Three of those answers change work described elsewhere in
this document, so read §11.4 before §6.5, §6.7 or §9.

## 0.1 What actually matters

This document lists 42 split-brain cases, 59 bugs, 51 decisions and 147 tests. That is the right
level of detail for someone building it and the wrong level for someone deciding whether to. Six
things change the shape of the work. Everything else is execution.

1. **Make shared client access end when the membership does (D41).** Sharing while the collective
   is live is intended and stays. What does not exist is the ending: leaving, removal and dissolve
   only flip the membership row, so a departed member keeps reading its former partners' client
   records indefinitely. Releasing the links in the same transaction that ends the membership is
   the single most important correction in this document, because everything else about client
   data is working as the owner wants.
2. **Fix the silent lockout, then stop (D38, W16).** A person who works at two venues cannot sign
   in at all today, and the invite route creates that state without warning. The decision is to
   refuse the invite with a clear message rather than build a venue chooser, so W16 is now small.
   It is still a live bug and still starts immediately.
3. **Say out loud that the collective page is appointments only (D44).** It is, structurally, and
   the product never mentions it. A member that also runs classes or tables loses that trade from
   the web the day its page starts redirecting.
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
    with no venue predicate (`20260730120000:65-68`, `20261201120000:225-253`,
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
  `20260919120000_linked_accounts.sql:69-79`). Joining a collective therefore forces every member
  to share its client list with every other member, which contradicts R1.
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
  while the member's own page still sells them.
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
| SB-25 | Staff book from the diary | The calendar's services | Every column, including own columns, opens the offerings-only form; member-only services cannot be booked there | Medium | `collective-staff-scope.ts:133-156`; `PractitionerCalendarView.tsx:9188-9195` |
| SB-26 | Receptionist picks a known client in the collective staff form | That venue's client | Search covers the acting venue, but the client is written into the calendar's venue | Medium | `DetailsStep.tsx:253,457-459`; `venue/bookings/route.ts:345-358` |
| SB-27 | Five definitions of "live collective" | One answer | Settings, staff form, sidebar, emails, widget and cross-suggestion disagree when a member lapses | Medium | `collective-staff-scope.ts:77-114`; `collectives.ts:824-841,873-886` |
| SB-28 | One person works at two venues in the collective and is given a login at each | One account that reaches both | `resolveUniqueStaffRow` refuses implicit venue selection, so they are redirected to `/signup/business-type` and locked out of both dashboards, with no message and no chooser. There is no venue switcher in the product | High | `src/lib/venue-auth.ts:55-65,330-332`; `src/app/dashboard/layout.tsx:89-93`; `supabase/migrations/20260301000003_create_staff.sql:14` |
| SB-29 | A host staff member created a service before the collective existed, and the host puts it on the page | Only host admins control what the collective sells | The same seven `staff_may_customize_*` flags gate a non-admin's edits to the service row itself, and a staff-created service stores all seven as true, so the creator keeps the right to rewrite the master | High | `appointment-services/route.ts:91-99,420-446,918,939-945,1256-1262` |
| SB-30 | Anyone opens a report or an export and looks for collective bookings | Bookings taken through the collective are identifiable | `bookings.collective_id` is written by three create paths and read by no report, export or metric; `source` has no collective value either, so the collective flow records `booking_page`. Collective trade is invisible everywhere money is counted | High | `20260919120000_linked_accounts.sql:149-150`; `20270118120000_bookings_account_safe.sql:42`; `create/route.ts:135` |
| SB-31 | A host, or a member, opens Booked revenue | The collective's money, with each venue named | Because the collective forces a full mutual link mesh, the report blends every member's calendars into one total, symmetrically, with no per-venue subtotal, labelled only "shared with you through a linked account". D49 keeps the mutual visibility but requires it to be named, broken down by venue and consented to at join, so what is left to fix is the presentation and the consent, not the access. Narrowing a link still silently drops the whole column while membership continues | Medium | `reports/booked-revenue.ts:83-85,300,316-317`; `collectives.ts:507-512`; `BookedRevenueSection.tsx:331-340,361-366` |
| SB-32 | A guest books at two member venues on the same collective page | One client record for one business | Two guest rows in two venues, and `merge_guests` refuses a cross-venue pair, so the split is permanent. Visit counts, tags, notes and loyalty are halved from the guest's point of view. D42 accepts this and covers it in the help centre only, with no product UI | Low | `guests` scoping per venue; `merge_guests` cross-venue refusal |
| SB-33 | A guest wants to join the waitlist from the collective page | The same waitlist the member's own page offers | The synthetic venue hand-builds two resolved flags and omits `waitlist_v2`, and the waitlist route has no collective branch, so the form never renders. Waitlist offer links also lose their query string on redirect | Medium | `collective-venue.ts:174-179` vs `venue-public-feature-flags.ts:34-42`; `api/booking/appointment-waitlist/route.ts:42-54`; `book/[venue-slug]/page.tsx:16-19` |
| SB-34 | A guest unsubscribes from marketing after booking through the collective | They stop hearing from the business they booked | Consent and unsubscribe are per venue guest row, so opting out at one member leaves every other member free to send. Marketing emails carry no unsubscribe link at all, and `createMarketingUnsubscribeUrl` is dead code | High | `send-marketing-contact-message.ts:97-104`; `marketing-unsubscribe.ts` |
| SB-35 | A member that also runs classes, events, tables or resources joins, and its own page starts redirecting | Its whole business keeps its online channel | The combined page is appointments only: the synthetic venue is built with `booking_model: 'unified_scheduling'` and a single active model, and the catalogue reads only services and practitioner calendars. The redirect fires before the member's own page is built, so its other models leave the web entirely (only `/embed/{slug}` survives) | High | `collective-venue.ts:163-165`; `catalogue.ts:69-84`; `appointment-catalog.ts:214-216`; `book/[venue-slug]/page.tsx:16-19`; `embed/[venue-slug]/page.tsx:16-17` |
| SB-36 | Two venues in a collective share a physical room and each puts it on a calendar | The room cannot be booked twice at once | `unified_calendars.venue_id` is NOT NULL and resources are pinned to one venue by the API but not by the database, and nothing compares across venues, so the shared room is silently double-booked | Medium | `venue/resources/route.ts:191-196`; `20260504120000:9-12` |
| SB-37 | The collective adopts a member's booking address | One address for one storefront | `/book/c/{slug}` and `/book/{adopted}` then serve byte-identical pages with no canonical between them, and `/book/{venue}/{calendar}` and `/embed/{venue}` never check the claim at all, so sibling URLs serve different identities | Medium | `resolveCombinedSlugClaim` callers; `book/[venue-slug]/[practitioner-slug]/page.tsx`; `embed/[venue-slug]/page.tsx:16-17` |
| SB-38 | One practitioner works at two venues in the collective and has a calendar at each | They cannot be booked twice at the same time | There is no cross-venue person: `unified_calendars` is venue-scoped, `staff` is one row per venue, every availability read is venue-scoped, and the only conflict checker is venue-scoped and resource-only. The same human is silently double-booked | High | `unified_calendars` venue scoping; `staff` per venue; `collective-booking-bridge.ts:202-262` |
| SB-39 | A host looks at a member's column in the diary to see when they are free | The member's real hours | Partner columns are drawn from `working_hours` alone, so the header line, the grey stripes and the working-hours filter ignore schedule periods, rotas, days off, amended hours, leave, the partner venue's opening hours and its closures. The host is shown a member as open all day on a day that business is shut | High | `linked-calendar/route.ts:182-207`; `practitioners/route.ts:34-61` already returns what is needed |
| SB-40 | A guest picks "Any available" on the collective page | A fair spread across the venues offering it | The collective branch returns before the flags block, so `any_available_practitioner_config` (priority or random, and the host's calendar order) never runs, and the bridge takes a first-wins dedupe over a list hard-coded host first. The host is handed every contested slot, permanently | High | `booking/availability/route.ts:577-611` vs `:613`; `collective-booking-bridge.ts:287-292`; `collective-venue.ts:586-596` |
| SB-41 | Staff try to move a booking to a calendar at another venue in the collective | It moves, as it would within one venue | The drag is refused and the dialog explains that the calendars "are on different ResNeo accounts". The offered path is rebook then cancel: a new booking id, the service picked again by hand, a cancellation and a confirmation both sent to the guest, and the deposit and card hold abandoned | High | `PractitionerCalendarView.tsx:6180-6212,9325,5016-5053` |
| SB-42 | A member leaves the collective, or the collective is dissolved | Each venue keeps its own clients and stops seeing everyone else's | Leave, removal and dissolve only flip the membership row; no collective route or library function touches `account_links`, so the accepted link and its client-detail grant survive indefinitely. A departed member keeps reading its former partners' client records, including contact details, notes, documents and compliance records. This is the half of D41 that does not exist | High | `collectives/[id]/members/route.ts:189,256,280`; no `account_links` writer in `src/lib/linked-accounts/collectives.ts` or any collective route |

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
| CB-41 | Creating a collective fails silently. The dialog's catch hands the message to the parent panel, which renders it inside `SectionCard.Body` behind the still-open dialog, so all ten server refusals (address taken, name taken, name on hold, not eligible, already in a collective, plan) are invisible: the button simply stops spinning | High | Yes | `VenueCollectivesPanel.tsx:532-534` rendering at `:149-151`; refusals in `collectives/route.ts:30-163` |
| CB-42 | The collective row shows a green "Active" pill from the moment of creation, while the public page serves its unavailable state until two members are active. "Active" describes the membership row's status column, not the page, and it is the first thing a new host reads | Medium | Yes | `VenueCollectivesPanel.tsx:307-309`; `collectives.ts:872,946,978-981` |
| CB-43 | The collective row's member line counts only active members but names invited ones too, so a new collective reads "1 active member, Riverside Clinic, Northside Studio" | Low | Yes | `VenueCollectivesPanel.tsx:312-316`; `collectives.ts:327-333,438` |

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
deletes the member's link rows in one transaction and every replica becomes an ordinary service
the member controls.

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
   trigger and `expected_updated_at` on save (409 `STALE_RESOURCE`).
3. **Diff-based assignment writes**: `expected_service_ids` on `PUT practitioner-services`, and
   the services PATCH replaces links only for the caller venue's own calendars.
4. **Timezone and currency gates**: same timezone and currency at invite and accept; timezone
   changes refused while a venue is in a live collective. Note the asymmetry this corrects:
   timezone is already gated, both at create, invite and accept and again whenever the page is
   built (`catalogue.ts:172-200`), but **currency is gated nowhere**. The combined page simply
   takes the host's currency (`collective-venue.ts:170`), so a member trading in another currency
   would have its prices relabelled rather than converted. That is a money bug, not a tidiness
   one, and it is the half of this gate that does not exist yet.
5. **Diary routing**: a member's own columns open its own staff form (replicas are its own rows,
   so they are already there), and partner columns open the collective form.

---

## 6. The design, as amended

Section 5 chose host-managed replicas. Two red teams then attacked that design against the code,
Postgres and PostgREST behaviour and staging data. They found 5 critical and 16 high problems in
the design as first written (listed with their resolutions in §6.13). Everything below is the
amended design. Detail that belongs to one audience lives in the two companion documents:

- `Docs/collective-one-venue-ux-spec.md`: the page-by-page specification, the "where is this
  edited" matrix, every string of copy, the lifecycle journeys and the notifications.
- `Docs/collective-one-venue-test-plan.md`: the full test inventory (147 tests), the invariant
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
| Add-on cost to the business | Never copied (the host's internal cost stays at the host) | Each venue for its own groups |
| Which calendar offers a service | `calendar_service_assignments` at the calendar's venue. The only store; `collective_service_providers` is retired | Host admins for any calendar in the collective; each venue for its own calendars |
| Per-calendar values: length, buffer, price, deposit, colour (and name and description on services not on the collective page) | Assignment custom columns, applied only while the master's permission flag is on | Calendar staff within the flags, that venue's admins, and host admins (D4) |
| Offering on the collective page | `collective_service_items.master_service_id`; everything shown is derived from the master | Host admins: "Show on the {collective} page" on the Services page |
| Page identity: name, address, branding, tabs, About, gallery, team | `venue_collectives` and its `booking_page_config`; host profile fields labelled as such | Host admins, Booking Page tab, collective scope |
| Calendar hours, breaks, closures, leave | The calendar's own venue | That venue |
| Bookings, guests, payments, compliance records, waitlist | The owning venue | The owning venue |

### 6.3 Data model

All migrations follow the standing ritual (staging push, staging code, test, production push,
merge). Expand changes ship first; contracting changes only after the code that stops needing
the old shape is live on both environments.

**New tables** (RLS enabled, service-role policies only, explicit `REVOKE ALL ... FROM PUBLIC,
anon, authenticated` on each table and its sequences):

- `collective_service_replicas`: one row per (offering, member). `collective_id`, `item_id`,
  `venue_id`, `member_id`, `replica_service_id` (unique, `ON DELETE NO ACTION`), `origin`
  (`created` | `adopted` | `migrated` | `reconnected`), `desired_revision` and
  `applied_revision` (bigint), `behind_since`, `lease_until`, `attempts`, `next_attempt_at`,
  `last_error` with an error code, `applied_fingerprint`, `last_applied_at`. Unique
  `(item_id, venue_id)`.
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
    in as the host's admin" is the entire question. Add `actor_support_session_id` and
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
  transfer, migration) with `idempotency_key`, status, progress, lease.
- `collective_booking_audit` (or `account_link_audit_log.link_id` made nullable with a
  `collective_id` and a CHECK): cross-venue booking writes authorised by collective role rather
  than a pairwise link (RT2-12).

**Changed tables:**

- `collective_service_items`: add `master_service_id` (FK, partial unique per collective for
  active offerings). The combined page stops reading the offering's own name, description, price,
  duration, heading and order.
- `venue_collectives`: add `service_model` (`legacy_copies` | `replicas`); a BEFORE UPDATE OF
  `host_venue_id` trigger refuses changes outside the engine; drop the
  `venue_collectives_adopt_requires_venue` CHECK, which conflicts with its own `ON DELETE SET NULL`.
- `venue_collective_members`: add `catalogue_suspended_at`, `consent_version`, `consented_at`,
  `consented_by_user_id`; AFTER UPDATE OF status triggers release links and unmanage library
  objects in the same transaction when a membership stops being active (RT1-4).
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

**Column classification** (RT1-10, RT2-16). An explicit registry classifies every column of
`service_items`, `service_variants`, `addon_groups`, `addons`, `compliance_types` and
`service_categories` as *host-controlled* (copied), *identity-mapped*, *venue-controlled* (never
overwritten) or *not copied*. A pgTAP test enumerates columns from `pg_attribute` and fails on any
unclassified column, so a future venue-scoped column can never be copied silently.

**Retired** (contract pass C2, with `IF EXISTS`): `collective_service_providers`,
`collective_service_categories`, `collective_service_items` dead columns, the members'
`visible_*` and `solo_page_behavior` columns, the `service_items` sync columns, and finally
`service_model`.

### 6.4 The replication engine

**Revision bookkeeping (replaces the per-master queue, RT1-1).**

1. Dirty triggers (one statement-level trigger per event per table, because Postgres forbids
   transition tables on multi-event triggers; SECURITY DEFINER; `SET search_path = public`) run on
   `service_items`, `service_variants`, `service_addon_groups`, `addon_groups`, `addons`,
   `service_compliance_requirements`, `compliance_types`, `compliance_type_versions` and
   `service_categories`. They increment `desired_revision` on every link of every affected
   offering inside the writer's own transaction. UPDATE triggers compare OLD and NEW and skip
   presentation-only columns (`sort_order` alone). A host venue-wide form maps to every offered
   master. Triggers exit immediately when the venue has no replicas-mode collective.
2. `collective_apply_replica(link_id)` takes the link row `FOR UPDATE` (blocking, with a lock
   timeout), reads `desired_revision`, then the master, converges the replica, and sets
   `applied_revision` to the value it read. A host write that commits during an apply bumps the
   revision again, so no change is ever skipped, and siblings are never cleared by another link's
   apply.
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
   differs, I3 flags the link as drifted, and the daily verifier repairs it by overwriting with the
   master's values and files it as an ordinary apply. So a legitimate manual fix disappears without
   trace, and if a host and a member later disagree about who changed a price there is nothing to
   look at. The fix is one behaviour, not a lock: the verifier writes drift it cannot explain as
   its own audit type, `unexplained_drift_repaired`, carrying the before-image, and alerts on it
   rather than absorbing it. I41 reports the same condition.
   **`SET search_path = public` is not hardening.** It leaves `pg_temp` searched first for
   relation names, and this repository has the habit already: 81 of 85 `SET search_path` clauses
   use the unhardened form, and existing definer functions reference tables unqualified, for
   example `INSERT INTO account_link_audit_log` at `20270111120000:176,188,198`. Every new engine
   function uses `SET search_path = ''` with fully qualified names, or `pg_catalog, public`. DB-01
   must assert the **value** of `proconfig`, not merely that one is present, and fail on any
   unqualified relation reference in `prosrc`.
   **`collective_set_calendar_values` needs its authorisation stated.** It is `service_role` only,
   with `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; the route is the authorisation point;
   and it takes `p_actor_venue_id` and `p_actor_user_id` and re-checks host membership inside the
   function as defence in depth. Left unstated, a bug in one route becomes a cross-venue write.
4. Lock order everywhere: the collective advisory lock (shared for apply, offer, join and calendar
   changes; exclusive for release, dissolve and transfer), then link rows in id order, then the
   master. Membership is re-checked after the locks are held.
   **The dirty triggers were outside this order, and that is a deadlock.** A trigger runs inside
   the host's own save transaction, which already holds the row lock on the master (the
   `service_items` UPDATE that fired it), and then takes locks on `collective_service_replicas`.
   That is master, then links. The apply is links, then master. Two transactions in opposite
   order is a textbook ABBA inversion, and a host venue-wide form change fans out to every link of
   every offering at once, so it is not a rare shape. Two corrections make the order true rather
   than merely stated: a dirty trigger does nothing but bump `desired_revision`, in a single
   `UPDATE ... WHERE id IN (SELECT ... ORDER BY id)` so link rows are taken in id order, and it
   never touches the master again afterwards; and the apply reads the master **without** a row
   lock, because comparing fingerprints is enough and it already holds the link row. CON-03 must
   include this pair: its list today covers release, offer, join, transfer and apply, and omits
   the one pair that actually inverts, host save against apply.
5. Due work is `applied_revision < desired_revision`, respecting `next_attempt_at` and
   `lease_until`; the cron claim sets `lease_until` in its own transaction (a `FOR UPDATE SKIP
   LOCKED` claim gives no lease through PostgREST).

**When applies run.**

- Inline after every host save that can change a master, within a time budget, returning
  `collective_sync: { venues, applied, pending, failed }` so the host sees "Saved. Updated at
  Light 3." or "Light 3 will update in a moment."
- A cron every 5 minutes with backoff (1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours).
- In staff and host booking routes before pricing: apply within a short budget, and refuse a
  commercial term that is still behind with the retryable 409 `COLLECTIVE_SERVICE_UPDATING`
  ("This service is being updated. Please try again in a moment.").
- Never on anonymous traffic (RT2-18). Public availability and create compare the replica's
  fingerprint with the master's and omit a behind calendar for that offering at once; create
  refuses with the existing slot-taken answer.
- A daily verifier compares every link's fingerprint, bumps drifted links, releases links outside
  an active membership, and alerts on anything it cannot repair.

**What an apply writes, in one transaction per link.**

1. The service row: host-controlled columns only, per the classification registry.
   `is_active` = master active and offering active.
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
explains in plain words, and retries with backoff. A link behind for more than 15 minutes
(`behind_since`) hides that member's calendars for that offering and tells the host and member why.

### 6.5 Authority, locks and audit

**Who may write what while a collective is live:**

| Actor | Master | Replica | A calendar offers a service | Per-calendar values | Offering on the page | Page, members |
|---|---|---|---|---|---|---|
| Host admin | Every attribute | None directly | Any calendar in the collective | Any calendar (`collective_set_calendar_values`, audited) | Offer, withdraw | Yes |
| Host staff | As today, except that a service on the collective page is admin-only whoever created it (see below) | None | Own managed calendars | Own calendars within flags | No | No |
| Member admin | None | Read-only; venue-controlled columns only | Own calendars | Own calendars | No | Read-only summary; leave |
| Member staff | None | Read-only | Own managed calendars | Own calendars within flags | No | No |
| Engine | Reads | Writes host-controlled columns and children | Only when a host admin asks | Only when a host admin asks | Writes items and links | No |
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
invariant catches it: I2 checks that a link exists, I4 is legacy-only and runs only from Pass B to
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
  before any assignment write.
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
  under that venue's name, and is counted in that venue's reports. The collective grants access,
  not ownership, which is what makes the release on leave (§6.7) both possible and sufficient.

Pairwise links created only for the collective are still offered for downgrade at migration. On
leave they are not downgraded but released outright: see §6.7.

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

**Grants.** The four engine tables and their sequences hold no client privileges; CI's
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
  warns when the invitee cannot take card payments or has forms switched off.
- **Accept (join).** A disclosure and a recorded consent version are required; an accept without
  `consent_version` is refused with `COLLECTIVE_CONSENT_REQUIRED` ("Please open ResNeo on the web to
  read what joining means, then accept there."), which also covers old app builds (RT2-8). The
  member then chooses, per same-named service, "Add the host's as new" (default) or "Use mine",
  which opens a reviewed adoption: option mapping, before and after preview of price, length,
  deposit, payment rule and forms, and snapshots of that service's bookings in the same
  transaction (RT2-20). Member-only services: "Keep for bookings your team makes" (default), "Ask
  the host to add it", or "Pause it" (RT2-10). A member holding a form from the same library
  template chooses "Use your existing form" (default). Compliance is switched on at the member when
  any offering has forms (RT2-6). New links start behind and stay out of the catalogue until they
  converge (RT1-11).
- **Offer or withdraw a service** from the host's Services page. Withdrawing retires replicas
  (inactive, calendar choices kept, reactivated on re-offer); guests can still move their existing
  bookings on retired services online (RT2-27). Deleting an offered master is refused.
- **Host adds or removes a member calendar** from the service form (`collective_set_calendar_offering`),
  with the affected-bookings check run at the member and shown without client names.
- **Member ticks or unticks** its own calendars on Calendar Availability; the page follows at once;
  the host is told. Diff writes with `expected_service_ids` stop a stale dialog erasing the host's
  change.
- **Leave, removal, link-cascade removal.** The status trigger releases replica links in the same
  transaction (locks lift, managed library objects become the member's own). After commit: photos
  are copied as objects into the member's storage (RT1-15); for a member without charges-capable
  Stripe, released services that take payment have their payment rule set to none, with the old
  values audited and a "Review your services" checklist (RT2-9); adoption of the member's address
  is cleared; notices go to live members only. Replica identities are kept so a re-join can offer
  "Reconnect your previous services" (RT2-27).
- **Client access ends with the membership** (D41). This is new, and it is the half of D41 that
  does not exist today. The same transaction that sets a membership to `left` or `removed` also
  ends that venue's `account_links` with every other member, so the client-detail grant stops at
  the moment the membership does. Today nothing does this: leave, removal and dissolve only flip
  the membership row (`collectives/[id]/members/route.ts:189,256,280`), and no collective route or
  library function touches `account_links` at all, so a departed member keeps reading its former
  partners' client records indefinitely. Each venue keeps every record it owns, in full. What it
  loses is the ability to read anyone else's. The release is audited on both sides, and the leave
  and removal dialogs say plainly what stops: "You will no longer be able to see {venueList}'s
  clients or bookings, and they will no longer see yours. Everything in your own account stays
  exactly as it is."
  A link that existed before the collective and was not created for it is downgraded to whatever
  it was rather than ended, so joining a collective cannot silently destroy an arrangement two
  venues already had. The migration records which links it created for this purpose so that
  "created for the collective" is knowable later, rather than guessed.
- **Dissolve.** Releases every member in one transaction, ends the client-detail grants exactly as
  a leave does, archives offerings, and old `/book/c/{slug}` links show a neutral page listing each
  former venue's own booking page for 90 days (members can opt out) instead of a 404 or a redirect
  to the host (RT2-22, D25).
- **Host transfer.** A request that the candidate's admin accepts with consent; members get notice
  and a free-leave window (RT2-23); refused while any link is behind. `collective_transfer_host`
  re-keys every `replica_of_*` mapping at every member, sets mappings on the old host's former
  masters, clears them on the new master, and asserts every fingerprint matches before commit
  (RT1-2, RT2-4). When a link change removes the host, the page pauses and a member may take over
  hosting; after 30 days paused the collective ends. Owner decision whether transfer ships in the
  first release.
- **Suspended link or member lapse.** `catalogue_suspended_at` hides the member at read time;
  replicas stay locked and in step.
- **Host lapse.** The page shows unavailable and members' own pages show again; after 30 days the
  collective dissolves (D22).
- **Venue deletion.** `admin_hard_delete_venue` releases or dissolves first, in the same
  transaction (CB-16).
- **Reconcile** never mutates on page renders; mutating reconciles run from routes and crons
  (CB-15). Every membership, status and host writer goes through lifecycle functions, pinned by a
  registry test (RT1-4).

### 6.8 Pages at a glance

Full detail, states and copy: `Docs/collective-one-venue-ux-spec.md`.

| Page | Host | Member |
|---|---|---|
| Services | Banner "You host {collective}"; a "Collective" pill on offered services; an "On the {collective} page" switch; the service form lists every venue's calendars in groups, with per-calendar values, per-venue update status and a "Compare values" table; a price or form change asks first and lists what changes; Delete blocked while offered | Two sections: "From {host}" (locked, View only, calendar choices and venue-controlled fields editable) and "Only at {venue}"; a "Retired" section; status lines ("Setting up", "Updating", "Hidden because card payments are not set up") |
| Calendar Availability | Services grouped "On the {collective} page" and "Only at {venue}"; unticking a collective service asks first | Groups "From {host}" and "Only at {venue}"; ticking a copy puts that calendar on the page at once; unticking asks first and tells the host |
| Booking Page tab | Collective scope only while live (Page, Services overview, Members); own page read-only with a status line | Read-only summary of the collective page and its own calendars there; a status line: "Guests who visit your page are sent to {collective}." or "Your own page is showing because {reason}." |
| Linked accounts | Members with update health, history, hosting request, dissolve | Join dialog (disclosure, choices, consent), Leave dialog, review panel after leaving, history |
| Add-ons, Categories, Compliance | "Collective" pills and reach lines on items used by offered services | Managed items "From {host}", view only, hidden from pickers on its own services |
| Diary | Member columns styled like own columns with a venue label; they open the collective form | Own columns open its own staff form (replicas and member-only services); partner columns open the collective form |
| Combined-page manager | The Services and calendars tab is removed; its jobs move to the Services page and Calendar Availability; a read-only overview links to "Edit on the Services page" | Unchanged read-only summary, rewritten copy |
| Collective overview (new) | One page for the whole collective: per-venue health, what is behind and why, what the host still has to do, a bulk lane and the history | Not shown |
| Reports | Booked revenue broken down by venue, with the collective's own bookings separated (§6.15) | Its own venue, with its collective bookings identified |
| Venue chooser (new) | Shown to anyone who works at more than one venue, wherever they work (§6.17, D38) | Same |

**One thing the fold must not do: make setting up slower.** The specification moves service and
calendar work out of the combined-page manager and into the Services page, which is right: one
service, one screen, one place the reach is explained. But the manager it replaces has real bulk
actions (per-venue and global select-all when adding, link-all and unlink-all, "Match categories
from your venues") and the specification as first written replaces them with a single "Choose
services for the page" dialog. Counted out for a realistic setup, ten services across three venues
with two calendars each, that turns roughly 72 interactions and one save into roughly 101
interactions and ten saves, because every calendar assignment now goes through a per-service
dialog. The fold is correct and the bulk lane has to land with it, not after it: see the
specification's Collective overview page, which is where the bulk lane lives.

### 6.9 Public pages and links

- A member's `/book/{slug}`, `/book/{slug}/{calendar}` and `/embed/{slug}` go to the collective
  page only when the page is live, the member's copies have converged and at least one of its
  calendars is listed for guests (RT2-3). Otherwise its own page shows.
- Redirects keep the guest's place: `service_id` is translated to the offering, the calendar
  segment to `?calendar=`, and dates and times are kept. A link for a member-only service shows an
  interstitial with the venue's phone number instead of dead-ending (RT2-22, RT2-10).
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
all per venue (RT2-25; staging already differs on the waitlist). For each the owner decides one of
three treatments (D32): host-controlled for collective bookings, must match at accept, or differs
per venue with a "Different at {venue}" note wherever the host sees it. Timezone must match, and
currency must too, though nothing enforces currency today (§2.2 bullet 4 of the design summary);
opening hours, closures and Stripe stay per venue by nature.

Three corrections to that inventory from the second pass, because a list that names the wrong
thing cannot be worked through:

- **"Message templates" do not exist.** `PATCH /api/venue/communication-templates` is a tombstone
  returning 410 with "Legacy template endpoint has been replaced by communication policies". The
  real store is `venues.communication_policies`, a jsonb column with a NOT NULL default, read by
  `src/lib/communications/send-templated.ts`. D32 applies to communication policies, per lane and
  channel.
- **SMS is missing from the list, and it is not a setting.** Whether a venue can send SMS at all
  turns on its plan tier and a billing card, not on anything an owner can toggle, so a collective
  can contain one venue that texts its guests and one that does not, with no treatment available
  beyond telling the host.
- **The list also owes booking models.** Which models a venue runs is the largest per-venue
  difference of all and is what §6.14 is about; D32's three treatments do not apply to it, because
  the collective page can only carry one.

### 6.11 Mobile app contract

The app is a full client of these endpoints. Changes are additive, and errors keep their prose in
`error` with a new `code`.

- `GET /api/venue/appointment-services` gains `collective` per service (role, host name,
  locked fields, delegated fields, update status) and, for host admins, a separate
  `collective_calendars` list. Member calendars are never merged into `practitioner_services`,
  because the app sends that list back as `practitioner_ids`, which replaces the whole set.
- Old builds: calendar-only saves of copies pass (the guard compares normalised projections); real
  edits get a readable 409; the one-tap accept gets `COLLECTIVE_CONSENT_REQUIRED`; a stale full-set
  calendar toggle that would remove an assignment another venue made in the last 24 hours gets
  `STALE_RESOURCE`; the diary's own columns open the own form because `staff-collective`
  `calendar_ids` omits own calendars.
- The catalogue builder's sync and link actions become coded answers
  (`COLLECTIVE_REPLICAS_ALWAYS_FOLLOW` for unlink, no-op success for sync).
- Handover to the app team: consent sheet, read-only copy cards, host collective calendars list,
  all seven per-calendar values, removal of sync badges, new codes, the client version header
  (host master edits from a client without it trigger a notice), and the leave copy fix.
  `Docs/MOBILE_API.md` gains the service-management contract it has never documented: today it
  has nothing at all on `appointment-services`, `practitioner-services`, overrides, add-ons,
  categories or error codes, and all of its collective content is about booking.
- **Two contract conflicts to settle before the app team is briefed**, both found in the second
  pass:
  - **`STALE_RESOURCE` already exists, and it is a 412.** `src/lib/booking/guest-actions/types.ts:182`
    maps 412 to `STALE_RESOURCE` and the guest reschedule paths return it that way
    (`reschedule.ts:334,535,1050,1212`). This design wants the same name at 409. Do not ship one
    code with two statuses. Either reuse it at 412 for the collective's stale-set case (preferred,
    because the meaning is identical: the caller's copy of the resource is out of date) or choose
    a different name for the collective case. Every mention of `STALE_RESOURCE` in the three
    documents assumes 409 and must follow whichever is chosen.
  - **The header is `X-ResNeo-Client`, with a capital N**, and it is already specified, in
    `Docs/Resneo_Customer_Portal_World_Class_Plan.md:905,1500,1538,1570`, as
    `X-ResNeo-Client: <platform>/<version>` with `426 CLIENT_TOO_OLD` reserved. That plan's
    standing rule is that **a missing header must be permitted permanently**, because builds
    already in the stores send none. The three documents here spell it `X-Resneo-Client`, which
    would simply never match. Use the existing spelling and the existing rule; notifying a host
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
  venue settings articles; add a new article on running services as one collective. No em-dashes.
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
- **Twenty articles mention collectives or linked venues, and sixteen more describe flows this
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
  record, and what a member sees. And D41's shape needs saying in the member's own words: while the
  collective is live your partners can see your clients and you can see theirs, the records stay
  yours, and the access ends the day the membership does.
- **Nothing stops an em-dash reaching a help article.** The existing copy tests cover booking copy
  and the assistant's answers only. Since this project rewrites twenty-odd articles under a rule
  that forbids them, add the sweep (HLP-01) before the rewriting starts, not after.

### 6.13 Red-team findings and how the design resolves them

RT1 is the engine, data and deploy review; RT2 the product, lifecycle and booking-engine review.
Both reviews, with evidence and inventories, are summarised in Appendix A.

| id | Sev | Finding | Resolution |
|---|---|---|---|
| RT1-1 | Critical | The per-master queue lost changes for sibling members and on commit-order races | Revisions per link, locked apply, leases (§6.4) |
| RT1-2 | Critical | Host transfer orphaned every replica mapping | Re-key in `collective_transfer_host`; host change refused outside the engine (§6.7) |
| RT1-3 | High | Managed forms collide on the per-venue slug (live on staging) | Adoption order, suffixed slugs, requirement merge (§6.4) |
| RT1-4 | High | Locks outlived membership; eleven status writers bypass release | Status triggers release in the same transaction; lock order; registry test (§6.3, §6.4) |
| RT1-5 | High | Deleting an offered master blocked in one route only | Database refusal plus import undo fix (§6.5) |
| RT1-6 | High | The Services PATCH wrote replicas implicitly; the guard misfired on app payloads | Replica PATCH never writes the row; normalised projection guard before any write (§6.5) |
| RT1-7 | Medium | Invalid multi-event transition triggers; leaking flag; invoker triggers; read-only STABLE functions | One trigger per event; SECURITY DEFINER; function-level SET; VOLATILE (§6.4) |
| RT1-8 | Medium | Snapshot backfill too narrow; writers missing | All bookings backfilled; BEFORE INSERT fallback; writer registry (§6.3, §6.6) |
| RT1-9 | Medium | Production migration state unverified; Pass A would drag owed migrations along | Pass 0 ships owed migrations alone first (§8) |
| RT1-10 | Medium | A run-time denylist would copy future venue-scoped columns | Explicit column classification with an enumerating test (§6.3) |
| RT1-11 | Medium | Unapplied or inactive replicas could be published | Links start behind and stay out of the catalogue until converged (§6.7) |
| RT1-12 | Medium | Assignment writes race the host's cross-venue writes | Single-statement diffs, ownership check, expected ids in the same transaction (§6.7) |
| RT1-13 | Medium | Members could attach managed add-ons and forms to their own services | Refused with a coded 409; hidden from pickers (§6.5) |
| RT1-14 | Low | Revision on `venue_collectives` is a hot row with side effects | Separate revisions table with more bump sources (§6.3) |
| RT1-15 | Low | Release copies photo URLs, not photos | Copy objects after commit (§6.7) |
| RT1-16 | Low | Option id churn and heading-by-name duplicates | Update in place; headings mapped by id (§6.4) |
| RT1-17 | Low | Missing REVOKEs, audit actor, cross-venue dialog details | Four tables and sequences revoked; routes write actor; no guest names across venues (§6.5) |
| RT2-1 | Critical | The price snapshot never reached the paths that settle money | Snapshot first in every settling reader (§6.6) |
| RT2-2 | Critical | Form capture on member calendars would be refused | Serve the owning venue's managed type and version; defer Any available forms (§6.6) |
| RT2-3 | Critical | Redirects keyed on membership would take members offline | Redirect only when live, converged and listed (§6.9) |
| RT2-4 | High | Transfer does not re-key replica identities | As RT1-2, plus NO ACTION mappings and member notice (§6.7) |
| RT2-5 | High | Flag gating could not live in the merge | Gating inside the one resolver, all local precedence deleted (§6.6) |
| RT2-6 | High | Host forms unenforced where members have compliance off (live on staging) | Compliance required on at members with form-bearing offerings (§6.7) |
| RT2-7 | High | Managed form slug collision | As RT1-3 |
| RT2-8 | High | Old app builds could join without consent | Consent version required (§6.7) |
| RT2-9 | High | A no-Stripe leaver republishes paid services that fail at checkout | Payment rule downgraded with audit and a review checklist (§6.7) |
| RT2-10 | High | No coherent policy for member-only services | Choices at accept, labelled sections, interstitial links (§6.7, §6.9; D2) |
| RT2-11 | High | Group bookings across member venues refused | Same-venue limit shown up front, or split groups (D28) |
| RT2-12 | High | Staff authority without links loses audit, notices and edit rights | Collective booking audit and defined rights (§6.5; D17) |
| RT2-13 | High | The staff form copies one venue's client into another | Clear picked contact for other venues' calendars (§6.5) |
| RT2-14 | High | Legal exposure in the model itself | Counsel before build; trader line; unticked consent (§6.9; D9) |
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
| RT2-27 | Low | Withdrawal strands online reschedules; re-joins duplicate | Reschedule allowed on retired copies; reconnect at re-join (§6.7) |
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
  (`20261210120000_combined_booking_page.sql:105-132`), so classes, events, resources and tables
  cannot be added without a schema change.
- Eligibility does not know this. `isLinkFeatureVenue` refuses only restaurant and table-product
  tiers (`eligibility.ts:36-41`), so a class-only or resource-only venue is "eligible", counts
  towards the two-eligible-members gate that makes the page live (`collectives.ts:946,978-981`),
  and contributes nothing.
- A member admin can remove `unified_scheduling` from its own venue at any time through
  `PATCH /api/venue` (`route.ts:403-446`, whose only guard is future bookings) and silently empty
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
events, tables and shared rooms stay per venue. Class commerce in particular is venue-scoped at
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
  it. Add it to the report filters and to every export, and give `source` a collective value so
  "booked on the collective page" is distinguishable from a booking the member took on its own
  page. Without this, no acceptance question about the collective's performance can be answered.
- **Fix the accidental symmetry first.** Booked revenue reaches other venues through
  `loadAccessibleLinkedVenueIds` and `grantAllowsRevenueReporting`
  (`reports/booked-revenue.ts:83-85,316-317`), and membership forces a full mutual mesh
  (`collectives.ts:507-512`), so today every member sees every other member's revenue in one
  blended total with no venue subtotal and only the words "shared with you through a linked
  account" to explain it (`BookedRevenueSection.tsx:331-340,361-366`). That is almost certainly
  not what any of them agreed to. Until D41 settles whether the mesh survives at all, the report
  must at minimum break the figure down by venue and name them.
- **What the host gets.** A collective view of Booked revenue: one row per venue, one total, the
  collective's own bookings separated from each venue's own-page bookings, and the same date
  controls as today. What the host must not get is a member's client contact details, which is
  already the rule everywhere else in this design.
- **What a member gets.** Its own venue by default, and its collective bookings identified within
  it, so it can see what the collective brings. A member never sees another member's figures.
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
`cron_runs`, each guarded by `requireCronAuthorisation` (`src/lib/cron-auth.ts:7-27`), and each
finishing through `finalizeCronRun` (`src/lib/cron/finalize-cron-run.ts:38-70`) so a non-zero
error count reaches Sentry tagged `cron_job` and the ops address in `CRON_ALERT_EMAIL`:

| Job | Schedule | Counters returned |
|---|---|---|
| `collective-replicate` | `*/5 * * * *` | `claimed`, `applied`, `still_behind`, `failed`, `leases_expired`, `errors` |
| `collective-verify` | `0 6 * * *` | one count per invariant, `repaired_bumped`, `repaired_released`, `unrepairable`, `errors` |

Both return HTTP 200 even when they cannot read what they need, with `ok: false` and a reason, so
the cron platform does not retry a check that is reporting correctly. That is the rule
`schedule-health` already follows (`api/cron/schedule-health/route.ts:36-40`).

**Why the verifier repairs, where `schedule-health` deliberately does not.** The scheduling
health check is read-only on purpose, and says why: drift there means something upstream is
broken, and a nightly silent repair would hide the cause while the symptom kept returning
(`route.ts:13-19`). Convergence is a different thing. A replica that is behind is the engine's
normal resting state between a host save and its apply, and bumping a revision is the same action
the engine would have taken anyway. So the verifier repairs only the two states that are
indistinguishable from ordinary lag (I3 by bumping, I5 by releasing), alerts on everything else,
and writes every repair to the audit trail, so a repair that keeps recurring is visible rather
than absorbed.

**Alert when**: any link is behind for more than 60 minutes; more than 5 per cent of links fail an
apply in one run; any invariant other than I3 or I5 is non-zero; the replication cron has not
completed for 30 minutes; a lifecycle job is stuck (I22).

**Support console.** A support person cannot open a host's Services page, so today they would have
nothing to answer with. The platform area (`src/app/api/platform/*`, superuser auth through
`requirePlatformSuperuserAuth`, audited with `recordPlatformAuditEvent`) gains a collective panel:
per collective, its model and member list with update health; the last 50 audit events; every link
with its revisions, `behind_since`, attempts and last error; and exactly one action, "Retry this
link now", which calls the same engine function as the cron and is itself audited. Everything else
is read-only. Support never edits a master, and never sees a guest's contact details.

**Worth measuring over time**: applies per day; median and 95th percentile time from host save to
converged at every member; failures by error code; links behind more than 15 minutes; time to
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
  already returns everything needed (`practitioners/route.ts:34-61`), including the resolved
  schedule, days off, amended hours, leave, and the partner venue's opening hours and closures.
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
  transfer of ownership, and §6.1 says ownership never moves. So either it stays refused and the
  dialog says so in plain words without offering a lossy workaround, or a proper cross-venue move
  is specified as its own piece of work, with the deposit, card hold, compliance records and guest
  messages all accounted for. That is D46, and it should not be improvised inside this project.
- **People are not modelled across venues** (SB-28, SB-38). Two separate failures share one cause.
  A person with staff rows at two venues cannot sign in at all (`venue-auth.ts:55-65` refuses to
  choose a venue and `dashboard/layout.tsx:89-93` redirects them into signup), and a person with a
  calendar at two venues can be booked twice at the same moment because nothing compares across
  venues. The first is a live bug on every venue and belongs in W16 regardless of collectives. The
  second needs a decision (D47) about whether ResNeo grows a person identity above the venue, or
  whether the collective simply warns when two calendars share a name and email.
- **A second, collective-unaware cross-venue diary exists** at `/dashboard/linked-calendar`. It
  must either learn about collectives or be folded into the main diary. Leaving two cross-venue
  diaries that disagree is exactly the split-brain this project is meant to end.

---

## 7. Migrating existing collectives

Every collective that exists today is `legacy_copies` until it is migrated, one at a time, by a
script that runs only after the new code is live in that environment (backfill and dual-write must
never meet, see the migration deploy notes).

1. **Survey production read-only first**: owed migrations, offerings with no host source (P5),
   ambiguous masters (P1), member services backing two offerings (P2), form slug collisions (P3),
   copy options with future bookings and no matching master option (P4), Stripe readiness, forms
   flags (and the `FEATURE_FLAG_*` environment overrides), exclusivity (I7).
2. **Rehearse on staging fixtures** (`e2e-coll-*` venues built with plus-1's shape: drift, an
   archived same-slug form, options, bookings), then dry run, apply, invariants, rollback, re-apply.
3. **Dry run** `scripts/collective-replicas-migrate.mjs --collective <id> --dry-run`: planned masters
   and links, adoptions, per-copy column-level drift (before and after), requirements that start
   applying, bookings to snapshot, collisions.
4. **Owner review and signature**: the owner approves the report by its hash (`--approved-report`).
5. **Apply**, per collective: snapshot every booking on masters and copies, set masters, create
   links (`origin = 'migrated'`), map copy options to master options by name and sort order, adopt
   managed forms in the §6.4 order, create missing assignments, switch `service_model`, then drain
   link by link outside the migration function (so no statement timeout holds locks).
6. **Verify by invariant, never by row counts**: I1 to I3, I5, I8, I10 to I16, I23 and I32 all 0;
   every booking total unchanged; the catalogue diff shows only intended changes.
7. **Rollback** until code removal: release links, restore `legacy_copies`, rebuild providers from
   assignments, and restore members' before-images of overwritten values if the owner wants that
   (D30).

**What the staging collective (plus-1) will need decided** (the corrected D21 list):

- Light 3's copies will take the host's values: Haircut 10.00 becomes 25.00; Senior (65+ Yrs)
  gains a card hold; 1 deposit and payment rule, 3 locations, staff flags and 16 headings change.
- Light 3 has forms switched off, so the host's PPD patch test on Root Tint is not asked for there
  today and will not be until forms are switched on at Light 3 (the earlier claim that it "starts
  asking" was wrong).
- Light 3 holds an archived PPD Patch Test (`d1a15afc`, left by a 2026-09-06 live check and
  undeletable because compliance audit events are append-only); it will be unarchived and adopted
  as the managed form.
- Light 3 has no Stripe account, so its calendars will be hidden from guests for the 3 paid
  offerings until it connects Stripe.
- Light 3's 10 member-only services need one of the three choices.
- The dissolved collective's residue (active providers, pending rows, legacy null-calendar rows) is
  archived or marked removed; nothing is deleted.

---

## 8. Delivery plan

### 8.0 What the second pass found, tiered

The second pass added fifteen split-brain cases, four platform bugs and fifteen decisions. They
are not equally important, and a list that does not say so is not much use. Each is tiered here
once, and the tier is the thing to act on; the entries in §3, §4 and §11 carry the detail.
Re-tiered on 2026-09-14 against the owner's answers in §11.4.

**Tier 1, fix first.** Live today, independent of the engine, and cheap. These can start alongside
W1 and W2.

| Finding | Why first | Where |
|---|---|---|
| SB-42 | Leaving or dissolving never ends the client-detail grant, so a departed member keeps reading its former partners' client records indefinitely. The half of D41 that does not exist, and the most important single correction in this document | W7 |
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
| SB-35, currency gate | Appointments-only stated in the product, and currency gated the way timezone already is | W20 |
| SB-37, PB-17 | Canonicals and page metadata. Real, but nobody is harmed while it waits | W19 |
| SB-29 | Offered masters become admin-only to edit whoever created them. One guard | W5 |
| Cross-venue contact search (D41) | The second half of the owner's requirement. `/api/venue/guests` is venue-scoped on every query, so shared access today is per guest through a shared diary rather than anything searchable | W7 |
| Booking-model forward compatibility (D44) | An entity discriminator on offerings and providers, and a real booking-model list on the synthetic venue. Changes no behaviour now, and is the difference between adding classes later and rewriting for them | W20 |
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

### 8.1 Fix now, on today's model

These bugs hurt today, do not depend on the redesign, and several are prerequisites for it:
CB-01 to CB-09, CB-11 to CB-13, CB-15, CB-16, CB-23 to CB-26, CB-28 to CB-31, CB-33 to CB-36,
CB-38, CB-39, CB-40 and PB-01 to PB-14 (PB-15 waits for the consent review in D9). Workstreams W1
and W2 below cover most of them.

### 8.2 Passes

| Pass | What | Classification |
|---|---|---|
| 0 | Ship production's owed migrations on their own (service categories, collective policy recursion fix, schedule periods, canonical processing shape, sync columns), with their invariants | Expand plus data backfills |
| A | Booking correctness, price snapshot and backfill, per-calendar columns, engine schema and functions (dark), unique indexes once I7 = 0 | Expand |
| B | Migrate existing collectives, per environment, after code A is live there | Data |
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
   host_venue_id` (`collectives.ts:588-596`) and is reached from an anonymous `/book/c/{slug}`
   render (`collectives.ts:933`, `collective-page-view.tsx:49`). Ship the trigger before W7 and the
   public combined page raises and 500s for every guest. Gate the trigger on
   `service_model = 'replicas'`, as the lock triggers already are, or move reconcile off renders
   into Pass A's prerequisites. Gating is cheaper and is the recommendation.
3. **The column classification registry belongs in Pass 0 or Pass A, not with the engine.** RT1-10
   is written as a future risk, but the failure mode is live today:
   `copyColumns(service, SERVICE_COLUMNS_NOT_COPIED)` (`service-duplication.ts:48-60,365`) copies
   every `service_items` column except eleven named ones, from one independent business into
   another, on every host tick. Any venue-scoped column added since then is already being copied
   silently, and that path keeps running from Pass A through Pass B until C1 replaces it. Ship the
   registry and its enumerating pgTAP test early, and make `service-duplication.ts` read it.
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
| W0 | Owner decisions, legal counsel, production survey | S | none |
| W1 | Booking correctness on today's model: one resolver, per-calendar values in the catalogue, base-price override removed, variant-aware availability, chain windows, price snapshot with settling readers, staff actor stamps, Stripe readiness | L | W0 (D4, D6) |
| W2 | Calendar assignment hardening: diff writes, expected ids, ownership check, Services page optimistic concurrency | S | none |
| W3 | Engine schema and functions dark: tables, revisions, dirty and lock triggers, apply, claims, verifier, column registry, grants, pgTAP and concurrency harness | L | Pass 0 |
| W4 | Derived catalogue and booking switch: exclusions, fingerprint freshness, compliance serving, collective booking audit | M | W1, W3 |
| W5 | Host Services page, offerings routes, collective calendars section, per-calendar values for hosts, notices | M | W3, W4 |
| W6 | Member locks and member UI: guards, error codes, Services sections, Calendar Availability groups, add-ons, categories, compliance | M | W3 |
| W7 | Lifecycle: join with consent and choices, adoption review, release follow-ups, dissolve page, host transfer with re-keying, venue deletion, reconcile off renders, exclusivity, **ending client access with the membership** (SB-42, D41) and **cross-venue contact search while live** (D41) | L | W3, W6 |
| W8 | Five per-calendar fields end to end | M | W2, D5 |
| W9 | Migrate existing collectives: survey, rehearsal, dry run, apply, rollback, residue | M | W4 to W7 live |
| W10 | Booking pages and links: redirect conditions, translation, interstitial, `/embed/c/{slug}`, trader line, one live-collective resolver, dissolved page | M | W4, D3 |
| W11 | Combined-page manager fold and catalogue compatibility shims | S | W5 |
| W12 | Mobile contract, `MOBILE_API.md`, handover | M | W5 to W7 |
| W13 | Help centre, spec, PRD, docs index | M | W5 to W11 |
| W14 | C1 code removal, then C2 contract | S | W9 on both environments |
| W15 | Grants hardening (anon writes on service tables, anon read of assignments) | S | live grant check |
| W16 | Multi-venue people: the invite route refuses an email that already works at another venue, with a plain message, and the silent redirect into signup is replaced by one that says what happened and who to contact. No venue chooser (D38), so this is small | S | none |
| W17 | Reporting and attribution: read `bookings.collective_id`, a collective value for `source`, per-venue breakdown and venue names in Booked revenue, the mutual-visibility consent at join, collective filters and export columns, and `buildPriceSummary` on the snapshot (SB-30, SB-31, D49) | M | W1 |
| W18 | Operations: the two crons, the verifier and its repairs, alert thresholds, and the platform support console's collective panel (§6.16) | M | W3 |
| W19 | Public identity and reach: metadata and canonicals on `/book/c/{slug}` and every member page, the waitlist on the synthetic venue, the full resolved flag set, "any available" fairness and order (SB-33, SB-37, SB-40, PB-17, D43, D48) | M | W10 |
| W20 | Booking models and eligibility: appointments-only gates at invite and accept, the refusal to drop `unified_scheduling` while in a collective, the member warnings, the "also runs" line, and the currency gate that does not exist (§6.14, D44, D45) | S | W7 |
| W21 | Diary truth: partner columns drawn from the resolved schedule rather than the weekly template, the cross-venue move dialog, the shared-person warning, and folding or fixing `/dashboard/linked-calendar` (SB-39, SB-41, D46, D47) | M | W4 |

W16 and W17 carry live bugs and should start with W1 and W2 rather than waiting on the engine.
W16 in particular is a prerequisite for the product being usable by the most likely collective of
all, two venues under one owner, and every journey in the specification is written as though it
were already solved.

Critical path: W0, Pass 0, W3, W4, W6, W7, W9, W14. W1, W2 and W16 start immediately: they fix live
bugs and must be in place before any price can propagate. W10 and W11 run alongside W5 to W7.

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
- **147 tests across layers**: 35 unit and sweep, 45 route, 3 component, 30 pgTAP, 4 engine
  concurrency, 6 migration, 3 app-contract, 5 end-to-end, 6 live-staging, 4 performance,
  4 security, 2 manual. Key groups: the terms resolver and price snapshot (TERMS, PRICE),
  assignment writes (CSA), engine objects, locks and convergence (DB, ENG, REV), real two-connection
  races (CON), the derived catalogue and forms (CAT, CMP), guards (GRD), lifecycle (LIFE), migration
  (MIG), public pages (PUB), the app's real payloads from build 1.1.0 (APP), security, performance
  budgets, and end-to-end journeys such as "a guest books a member calendar with a deposit and a
  patch test form including a file upload". The 34 added by the second pass are the OPS, MV, REP,
  BM, PLAN, SEO, WAIT, FAIR, DIARY and HLP groups, covering operations and alerting, people who
  work at more than one venue, reporting and attribution, booking models other than appointments,
  plan tiers and caps, the public page's metadata and waitlist, diary truth, and help copy.
- **Engine testing inside Postgres**: every apply returns write counts, so a second apply must
  write nothing; columns and unique indexes are enumerated rather than listed; every lock is tested
  both refusing and allowing; deterministic race points; randomised convergence (50 rounds in CI,
  1,000 nightly).
- **Invariants** in one service-role function, run identically by pgTAP, the daily verifier, the
  migration script and every deploy step (I1 to I47 and the dry-run checks P1 to P5). I33 to I47
  were added by the second pass and cover, among others, a member silently withdrawing a calendar
  by deleting it, an applied replica with no audit row, and client privileges on the legacy tables
  that I24 never looked at.
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
| Host-set prices charged by independent businesses create legal exposure (competition, employment status, consumer information, data roles) | Medium | High | Counsel before build; recorded consent; trader line; members may leave at any time and keep everything |
| A forgotten write path hits a lock and returns 500 | Medium | Medium | Writer registry test; route guards with coded 409s; dedicated SQLSTATE |
| Replication lag lets a guest see stale terms | Medium | Medium | Fingerprint omission on public paths; staff refusal while behind; snapshot freezes what was charged |
| Members lose their online channel through redirects | Medium | High | Redirect only when live, converged and listed; status line on the Booking Page tab |
| Price edits rewrite members' history | Low after W1 | High | Snapshot backfill of all bookings; settling readers read it first; invariant I6 |
| Old app builds confuse users with refusals | High | Low | Readable prose; normalised guards; consent refusal; handover |
| Future data migrations fail on replica rows | Medium | Medium | Documented engine bypass plus a CI migration lint |
| Production differs from staging (owed migrations, duplicates, collisions) | Medium | Medium | Pass 0; read-only production survey; invariants before each push |
| Members resist losing control of member-only services | Medium | Medium | Choices at accept; team bookings stay; clear labelling; leave at any time |
| Trigger overhead on hot service tables | Low | Low | Early exit for venues outside replicas collectives; performance budgets |
| A host save deadlocks against a concurrent apply, because the dirty triggers sit outside the stated lock order | Medium | Medium | Triggers bump revisions only, in id order, and never touch the master afterwards; the apply reads the master without a row lock; CON-03 covers the pair (§6.4) |
| A manual fix made in the SQL editor leaves no audit row, and the daily verifier then repairs over it, so a legitimate change disappears without trace | Medium | Medium | The verifier files unexplained drift as its own audit type with the before-image and alerts, rather than absorbing it; I41, SEC-04 (§6.4, §6.16) |
| The new per-calendar and attribution columns land on a table `anon` can read in full, including an `auth.users` identifier | Medium | High | Drop `public_read_calendar_service_assignments` and serve the public catalogue through the admin client before those columns ship; SEC-05, I42 (§2.2) |
| A guest's pre-booking form files at one venue and they are booked at another, so the venue that needs the record does not hold it | Medium | Medium | Collect inline forms once the calendar is fixed, as RT2-2 already requires; name the receiving venue where a form must come first; SEC-03 (§6.6) |
| A member loses its classes, events or table bookings from the web when redirects begin | Medium | High | Appointments-only stated in the product, warnings before accept and before redirects, and a route through for the other models; D44 (§6.14) |
| The fold makes setting up a collective slower than the manager it replaces | High | Medium | The bulk lane ships with the fold, not after it; specification §2 item 15 (§6.8) |
| A person who works at two venues cannot use the product at all | High today | High | W16 ships before the collective work; D38 (§6.17) |

---

## 11. Decisions for the owner

Numbering follows the design documents, so the companion specification and test plan refer to the
same ids. The recommended default is in bold.

### 11.1 Before any build

| id | Decision | Recommended |
|---|---|---|
| D9 | Brief a solicitor on the model itself: one business setting prices and terms that independent businesses charge through their own Stripe accounts (competition, employment status, the information guests must see about who they are booking with, data controller roles), and approve the consent text | **Yes, before build** |
| D27 | Are host prices enforced, or recommended prices that calendars may vary within the host's permissions? | **Follow counsel; the design supports both through the per-calendar price permission** |
| D18 | One live collective per venue, as host or member, enforced in the database | **Yes** |
| D31 | Ship production's owed migrations as their own deploy pass before this work | **Yes** |

### 11.2 Shape of the product

| id | Decision | Recommended |
|---|---|---|
| D1 | A joining member's same-named service | **A new host-managed copy; "Use mine" only through the reviewed adoption** |
| D2 | Member-only services while in a collective | **Kept for bookings the member's team makes, not bookable online; the member chooses at accept** |
| D3 | Own booking pages while the collective is live | **DECIDED 2026-09-14. The collective page is the venue's booking page for as long as it is in the collective, and it supersedes every member's own page, the host's included.** The conditions in §6.9 (live, converged, at least one calendar listed) are a safety net so a redirect can never send a guest to a page that cannot take their booking, not a softening of the rule. Whenever those conditions hold, which is the normal state, the own page hands over |
| D4 | Who may set per-calendar values | **Calendar staff within the flags, that venue's admins, and host admins** |
| D5 | Build the five missing per-calendar fields | **Yes** |
| D6 | Turning a staff permission off | **Clear stored price, deposit, length and buffer values with an ask and a notice; ignore colour** |
| D7 | Price snapshot backfill scope | **All past and future appointment bookings at every venue** |
| D8 | Payments | **Members collect on their own Stripe accounts; calendars without charges-capable Stripe are hidden from guests for paid services** |
| D10 | Compliance | **Forms must be on at members with form-bearing offerings; a member's existing records of the same library form count; member venue-wide forms apply on top; host venue-wide forms apply to every collective service** |
| D11 | Location, meeting link and joining information | **Location follows the host; meeting link and joining information are per venue** |
| D12 | Host transfer | **A request with consent, notice and free leave; decide whether it ships in the first release** |
| D13 | Taking a service off the collective page | **Member copies retire (inactive, calendar choices kept, restored if re-offered)** |
| D14 | Deleting a host service that is on the collective page | **Blocked until it is taken off the page** |
| D15 | May a member re-add a calendar the host removed | **Yes, with "Last changed by" on both sides and a notice** |
| D16 | A member copy that is behind | **Hidden from guests at once for that service; staff bookings refused with a retry message; host and member told after 15 minutes** |
| D17 | Staff authority and client details | **Collective role authorises staff booking; client details are typed for another venue's calendar; mesh links offered for downgrade** |
| D19 | Collective page headings and order | **Follow the host's Services page; the separate collective headings are retired** |
| D20 | Photos | **The host's service photos; members receive copies when they leave** |
| D22 | Host subscription lapse | **Page paused; dissolve after 30 days** |
| D23 | Notices of host changes | **Immediate for price, payment and form changes; daily digest for the rest** |
| D24 | "Any available" across venues for services with options or add-ons | **Phase 2** |
| D25 | Old collective links after dissolving | **A neutral page listing former venues for 90 days** |
| D26 | Cross-venue removal dialogs | **Dates, times and calendars at other venues, never client names** |
| D28 | Group bookings across member venues | **Limit a group to the first person's venue, explained before the details step; split groups later if wanted** |
| D29 | Name and description delegation on offered services | **Off, so page, emails and booking records show one name** |
| D32 | Venue-level settings (self-reschedule, waitlist, reminders, deposit settings, booking rules, sign-in) | **Decide per setting: host-controlled, must match at accept, or "Different at {venue}"** |
| D33 | Staff bookings while a member's copy is updating | **Refuse with "This service is being updated. Please try again in a moment."** |
| D34 | Alert the host to collective-page bookings on member calendars | **Yes, without client contact details** |
| D35 | A link change removes the host | **Pause the page and let a member take over hosting** |

### 11.3 Migration

| id | Decision | Recommended |
|---|---|---|
| D21 | Approve the staging overwrite list in §7 (corrected) and the production list after its dry run | **Review the dry-run report and sign it** |
| D30 | Should rollback restore members' before-images | **Yes; store before-images during the migration** |
| D36 | Offerings that only members provide (no host service) | **Create the host service active so member calendars stay bookable, with a report** |

### 11.4 Added by the second forensic pass (2026-09-14)

These come from the areas the first pass did not reach: reporting, operations, people who work in
more than one venue, booking models other than appointments, guest identity across venues, and the
public page's life outside the booking flow. Ids continue from D36 so nothing is renumbered.

They are split by who actually has to decide. Seven of the fifteen have an obvious answer and are
here to be recorded, not deliberated: the team should take them, write down what it took, and move
on. Eight genuinely need you, because they are commercial, legal or about what the product
promises. Do not let the first group consume attention that belongs to the second.

#### Decided by the owner, 2026-09-14

All eight are settled. The answers are recorded here as taken, with what each one changes.

| id | Decision | Answer |
|---|---|---|
| D38 | A person who works at more than one venue in a collective | **No venue chooser. Refuse the invite instead.** A person who already works at another venue cannot be invited, and is told plainly to use a different email address. The silent lockout (SB-28, PB-16) is still fixed, because it is a live bug: what changes is that the fix is a refusal with a clear message, not a switcher. The owner accepts that someone running two venues in a collective needs two logins |
| D39 | How a collective is priced, given each venue keeps its own subscription and calendar cap | **Accept the pooling. It is the point of the feature.** No per-collective charge, no member cap, no minimum tier to host. Nothing to build |
| D41 | Whether joining still means sharing client details | **Shared while the collective is live, and it ends when the membership does.** See the amended wording below: this is not the status quo, and two parts of it do not exist yet |
| D42 | The same guest booking two member venues becomes two client records, permanently | **Accept, and explain it in the help centre only.** No product UI, no banner, no warning at join. A minor issue that help articles and customer service can cover |
| D44 | A member that also runs classes, events, tables or rooms | **Appointments only for now, stated in the product, and built so other models can be added later.** The guards, warnings and refusals in §6.14 all stand. The forward-compatibility requirement is new: see below |
| D49 | What a host sees about the collective's trade, and what a member sees about others | **Full mutual visibility, made explicit and consented at join.** Every member sees every other member's figures, as today, but named and broken down by venue rather than blended into one unlabelled total, and agreed to rather than discovered |
| D50 | Whether a host can undo a change that has already reached members | **Yes, 60 seconds.** "Put it back" in the save summary, restoring the master's before-image from the audit trail and re-applying |
| D51 | Whether host changes may carry a future effective date | **Not planned.** Changes apply straight away. Remove it from the open questions rather than carrying it as phase two |

**D41 in full, because the answer is not one of the options offered.** The owner's requirement is:
joining shares access to contact details, including every part of a client record; the record still
belongs to the venue that owns it; members can use and interact with each other's contacts and
bookings seamlessly; and when the collective ends, the owner keeps the record and everyone else
loses access.

That is neither the status quo nor the recommended option. Checked against the code, two of the
four parts are missing today:

- **Access does not end.** Leaving, being removed and dissolving only flip the membership row's
  status (`collectives/[id]/members/route.ts:189,256,280`). Nothing in
  `src/lib/linked-accounts/collectives.ts` or any collective route touches `account_links`, so the
  accepted link and its client-detail grant survive the collective indefinitely. A member that
  leaves today keeps reading its former partners' client records. This is the requirement's
  sharpest half and it is a bug to fix, not a default to keep.
- **It is not seamless.** There is no cross-venue contact search: `/api/venue/guests` is scoped to
  `staff.venue_id` on every query (`route.ts:150,237,285,317`). Access today is per guest, reached
  through a shared diary booking, not a list anyone can search. Making it seamless is new work.

So D41 as decided means three things:

1. **Keep the sharing while the collective is live**, and say so plainly at join, with recorded
   consent. The disclosure names what a partner venue can see: name, contact details, visit
   history, tags, notes, documents and compliance records.
2. **Build the seamless part**: a member's staff can search and open another member's contacts
   while the collective is live, with the owning venue named on every record.
3. **End it with the membership**: leave, removal and dissolve release the links in the same
   transaction that ends the membership, so access stops at once. The records stay with their
   owner, untouched.

This replaces the earlier recommendation to drop the link mesh. It also overrides **D17**, which
said a member's staff must type a client's details when booking on another venue's calendar: inside
a live collective the sharing is the arrangement, so the contact picker works across member venues
and the typed-details rule applies only where no live collective exists.

**D44's forward-compatibility requirement.** Appointments only is a scope decision for this
release, not a permanent shape. Two things make the later work an addition rather than a rewrite,
and both are cheap now and expensive later: give the offering and provider records an entity
discriminator, so a row can say what kind of bookable thing it points at rather than being an
untyped service id (`20261210120000_combined_booking_page.sql:105-132` has no such column today);
and keep the synthetic venue's booking model list a genuine list rather than the hard-coded single
value it is now (`collective-venue.ts:163-165`). Neither changes behaviour in this release.

#### The team can take these

Recorded for the record. Each has one sensible answer and no commercial or legal content.

| id | Decision | Take this |
|---|---|---|
| D37 | Where the switch that puts new collectives into replicas mode lives. Flags today are per venue (`venues.feature_flags`, a closed six-key registry read per venue) and a collective spans venues, so there is no answer to "which venue's flag decides" | **A platform-level setting on the platform console, audited, deciding only what value new collectives are created with. `venue_collectives.service_model` stays the per-collective truth. Do not add a seventh key to `APPOINTMENTS_FEATURE_FLAG_KEYS`** |
| D40 | `capacity_per_session` on a collective service, where a member's room is smaller than the host's | **Venue-controlled, with the host's value as the starting point at join. A host cannot know another business's room size, and overbooking a member's room is a failure the guest experiences** |
| D43 | The waitlist on the collective page, which cannot appear today because the synthetic venue publishes only two resolved flags | **Publish the full resolved flag set on the synthetic venue and give the waitlist route a collective branch, so a guest can wait for the collective the way they can wait for a venue. Without it the page is worse than the member's own page it replaces** |
| D45 | Two venues sharing one physical room or piece of equipment | **Not supported, and said so plainly, until a cross-venue resource exists. Today each venue can put the same real room on a calendar and the platform will double-book it (SB-36)** |
| D46 | Moving a booking to a calendar at another venue in the collective | **Keep it refused, and rewrite the dialog to say why without offering the lossy rebook-then-cancel path. A true cross-venue move transfers ownership, which §6.1 forbids, so specify it as its own project if it is wanted** |
| D47 | One practitioner with a calendar at two venues, who can be booked twice at the same moment (SB-38) | **Warn, do not model, this release: flag two calendars in a collective that share a name and email, and show the clash to whoever books second. A person identity above the venue is a platform change, not a collective one** |
| D48 | Search engines and link previews for the collective page and members' pages, which have no canonical, no Open Graph image and, on `/book/{venue}`, no metadata at all (PB-17) | **Give `/book/c/{slug}` full metadata and make it canonical for any address it has adopted; give member pages their own metadata and a canonical pointing at whichever page actually serves them. Do this in the same workstream as the redirects, because they answer the same question** |

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
  and only existed as the uncommitted work that became `973bd3e`. Fourteen split-brain cases
  (SB-28 to SB-41), four platform bugs (PB-16 to PB-19), fifteen decisions (D37 to D51), six
  workstreams (W16 to W21), four design sections (§6.14 to §6.17), fourteen invariants (I33 to
  I46) and thirty-four tests were added. Several existing claims were corrected against the code:
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

## Appendix B. Glossary

| Term | Meaning |
|---|---|
| Host | The venue whose services the collective offers and whose admins control them |
| Member | A non-host venue in the collective |
| Master | The host's own service row for a service on the collective page |
| Replica, copy | The locked row for that service in a member's account, written only by the engine |
| Offering | The collective page's record that a master is on the page |
| Assignment | A `calendar_service_assignments` row: this calendar offers this service |
| Per-calendar values | Custom name, description, length, buffer, price, deposit and colour on an assignment, allowed by the service's staff permission flags |
| Engine | The database functions that write replicas and cross-venue assignments |
| Revision | The counter that says a replica has changes to apply |
| Converged | A replica whose applied revision equals its desired revision and whose fingerprint matches the master |
| Release | Ending a member's links so its replicas become its own services |
| Live collective | Active, at least two eligible members, and a bookable service |
| Column registry | The explicit, reviewed list classifying every replicated column as host-controlled, identity-mapped, venue-controlled or not copied (§6.3). `service_items` has 46 columns |
| Acting venue | The venue a signed-in person is currently working in, chosen from the venue chooser. A preference, never an authority: every route re-checks it against the caller's own staff rows (§6.17) |
| Collective overview | The host's single page for running the collective: per-venue health, what needs attention, the bulk lane and the history (specification §2 item 15) |
| Verifier | The daily cron that runs the invariants, repairs only the two states indistinguishable from ordinary lag, and alerts on everything else (§6.16) |
