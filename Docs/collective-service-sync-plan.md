# Keeping members' service copies in step with the origin: plan and status

Status: IMPLEMENTED on the `staging` working tree (written and built 2026-09-09, baseline
`7807cf08` plus the amended-hours and canonical-shape work). Migration `20270209120000`
owed to both databases; the code tolerates its absence.

## What the owner asked for

When a venue collective is live with full permissions, should the host's edits to a service
that the combined page offers be copied to the member venues that provide it? Today they are
not, and the 9 September Balayage case is the result: Test Plus's Balayage had been re-edited
(90 minutes, two processing periods) while Light 3's copy stayed at the 180 minutes and no
periods it was created with, so the same offering booked and drew differently on the two
calendars. The owner also decided: **sync must not apply to the collective's current members
retroactively**. Copies that exist today stay as they are.

## Decision (2026-09-09)

Sync the **scheduling shape**, not the commercial terms; a member's own edit **detaches**
its copy, visibly; drift is **shown** in the combined-page manager rather than discovered in
the diary. In detail:

1. **What follows the origin.** Duration, buffer, processing periods, and the variants'
   names, durations, buffers and processing periods. These decide what a calendar books and
   how the diary draws it, which is the guarantee the combined page makes.
2. **What never follows.** Price, deposit, description, photo, colour, heading, booking
   window, add-on groups, compliance requirements. These are the member's own business
   (their Stripe account is behind the price; add-on groups and compliance types are shared
   library objects at the member venue, reused by name, so rewriting them would reach other
   services).
3. **Detach on a member's edit.** When staff at the member venue save the copy with a change
   to any synced field, the copy becomes `customised` and stops following. A change to a
   non-synced field (price, description) leaves it linked. The manager shows "customised at
   Light 3"; the host can re-sync it, which asks first and then sets it back to linked.
4. **Detach by the host.** The host can stop a copy following ("stop syncing") from the
   manager; the copy becomes `independent` and is never touched again.
5. **Not retroactive, except by hand.** Every copy that exists before this ships is
   `independent` and shows as such; only copies created by the tick from now on are
   `linked`. Nothing links an existing copy automatically. The one deliberate exception
   (owner, later on 2026-09-09): an independent copy at a venue other than the offering's
   origin offers **"Link to {origin} and update"** in the manager, confirmed, one copy at a
   time. It sets the copy `linked`, writes the origin's shape, and adds any add-on groups
   the copy lacks (reused by name at the member venue, created otherwise; groups it already
   links to are untouched). Removing an offering and re-adding it does NOT do this: the
   tick reuses an existing same-named service as it is.
6. **Only while the collective is live.** A sync runs only if the origin's venue and the
   copy's venue are both active members of a live collective. Membership ending does not
   rewrite the copy; the link simply goes dormant, and a later re-join resumes it.

Why this shape and not the two extremes:

- *Host overwrites everything, always* breaks "each venue keeps its own" (PRD, spec §7.7): the
  copy is also the member's own service on their own booking page.
- *Fully independent* (today) drifts silently, which is exactly what bit the owner.

## Facts the design rests on (verified 2026-09-09)

- The only path that creates a service in another venue is `ensureServiceForCalendar` in
  `src/lib/linked-accounts/service-duplication.ts`, called from the catalogue route's
  `add_provider` / `set_providers` actions (`src/app/api/venue/collectives/[id]/catalogue/route.ts`).
  The template it copies from is `loadOfferingTemplate`, which picks the origin
  (`pickOriginProvider`: the host's own service when the host provides the offering, else
  the earliest provider's) and copies the row through a denylist, plus variants, add-on
  groups and compliance requirements (spec §7.7.2).
- Nothing records which origin a copy came from. `collective_service_providers` points at the
  member's own `source_service_id` only.
- A member's services are saved through `PATCH /api/venue/appointment-services` (unified
  branch on `service_items`), with variants reconciled in the same request by
  `replaceServiceVariants` (`src/lib/venue/service-variants.ts`). The route is venue-scoped:
  a host cannot edit a member's copy through it, and a member cannot edit the origin.
- The manager (`src/components/linked-accounts/CombinedPageManager.tsx`) renders one
  `CalendarRow` per member calendar with the provider's effective price and duration; the
  view comes from `loadCatalogueForManagement` in `src/lib/linked-accounts/catalogue.ts`
  (`CatalogueProviderView`).
- The canonical processing shape (`canonicalServiceShape`, same day) is applied on save,
  copy and read, so origin and copy compare on the same footing.
- The host's booking form, the public combined page and the availability routes all book
  the member's copy (`resolveCombinedBookingTarget`), so the copy's shape is what matters.

## Design

### Storage (one expand-only migration, `20270209120000_service_sync_from_origin.sql`)

On `service_items`:

- `synced_from_service_id uuid NULL REFERENCES service_items (id) ON DELETE SET NULL`: the
  origin this copy follows. Null for anything that is not a copy.
- `sync_state text NOT NULL DEFAULT 'independent' CHECK (sync_state IN ('independent', 'linked', 'customised'))`.
  The default is what makes rule 5 hold: every existing row is `independent`.
- `synced_at timestamptz NULL`: when the copy last matched the origin.
- Index on `synced_from_service_id` where `sync_state = 'linked'`.

The code tolerates a database without the migration (the categories pattern): the copy
insert retries without the three columns, sync reads that fail on the column are treated as
"no linked copies", and the manager shows no sync chips.

### The sync (`src/lib/linked-accounts/service-sync.ts`)

- `serviceShapeOf(row, variants)`: the synced fields as a comparable value (canonical shape
  applied). `shapesMatch(a, b)`.
- `planVariantSync(originVariants, copyVariants)`: match by normalised name. Matched: update
  duration, buffer, processing periods, sort order (name kept, price kept). Unmatched at the
  copy: insert as the initial copy would (all columns through the child denylist, origin
  price for a NEW variant, as §7.7.2 does). Present at the copy, absent at the origin:
  `is_active = false`, never deleted (bookings may reference the row).
- `syncCopiesOfService(admin, originServiceId, source)`: loads the origin row and variants,
  the copies `WHERE synced_from_service_id = origin AND sync_state = 'linked'`, checks each
  copy's venue shares a live collective with the origin's venue, applies the shape to the row
  and the variant plan, stamps `synced_at`, invalidates the collective catalogue memo. Fail-
  soft per copy: a failure is logged and the next copy still runs; the origin save has
  already succeeded and must not be undone by a partner's problem.
- `syncOneCopy(admin, copyServiceId, { force })`: the manual re-sync from the manager. With
  `force` it also takes a `customised` copy back to `linked`.

### Where it runs

- **On the tick.** `createServiceInVenue` stamps `synced_from_service_id = template.origin.serviceId`,
  `sync_state = 'linked'`, `synced_at = now()`. Steps 1 and 2 of `ensureServiceForCalendar`
  (an existing same-named service at the member) are unchanged and stay `independent`: that
  service was theirs before the tick.
- **On the origin's save.** `PATCH /api/venue/appointment-services` (unified branch), after
  the row and the variants are written: if any synced field changed, `after(() =>
  syncCopiesOfService(...))`. The response does not wait for partner writes.
- **On the copy's save.** Same route: if the row being saved has `sync_state = 'linked'` and
  the request changes a synced field, the update also sets `sync_state = 'customised'`.
- **From the manager.** Two catalogue actions, host only: `sync_provider` (re-sync one copy,
  asks first when it is customised) and `detach_provider` (set `independent`).

### The manager

`CatalogueProviderView` gains `sync: { state: 'independent' | 'linked' | 'customised' | 'none'; inStep: boolean | null }`
(`none` for the origin itself and for services that are not copies). Each ticked calendar
row shows a chip:

- linked and in step: "In step with {origin venue}"
- linked and not in step (a sync failed, or the collective was suspended while the origin
  changed): "Update available", with **Update now**
- customised: "Customised at {venue}", with **Re-sync** (confirm)
- independent, created by a tick before this shipped: "Independent copy", no action
- linked: also **Stop syncing**

The offering's helper text changes from "Price, duration, description, variants and add-ons
all come from each venue's own service settings" to say that duration, buffer, processing
periods and variants follow the origin for calendars marked in step, and price, description
and add-ons stay each venue's own.

### Tests

- `service-sync.test.ts`: shape comparison, the variant plan (update, insert, deactivate,
  price untouched), and detach detection (`patchTouchesSyncedShape`).
- `catalogue/route.sync.test.ts`: the two actions and the host-only gate, following
  `route.categories.test.ts`.

### Help and spec

- Spec §7.7.3 records the rule.
- `appointments/resources` is untouched; the combined-page help article gains a paragraph on
  "in step" and "customised".

## Out of scope

- Linking or updating copies that exist today (owner's decision, rule 5).
- Syncing add-on groups, compliance requirements, prices, descriptions or booking windows.
- A per-offering "keep in step" toggle: detach per copy covers the need with less UI.
- The mobile app: it reads the same `service_items` rows and needs nothing.

## Progress

- 2026-09-09: plan written and built the same day. As built:
  - `supabase/migrations/20270209120000_service_sync_from_origin.sql` (three columns, one
    index, default `independent`).
  - `src/lib/linked-accounts/service-sync.ts`: shape comparison, variant plan, detach
    detection, `syncCopiesOfService`, `syncOneCopy`, `detachCopy`, `loadServiceSyncViews`;
    tests in `service-sync.test.ts`. Written blocks keep the origin's uuid ids (the block
    parser drops a block whose id is not a uuid, which the first draft got wrong).
  - `service-duplication.ts`: a created copy is stamped linked to its origin; on a database
    without the columns the insert retries without them and the copy stays independent.
  - `PATCH /api/venue/appointment-services` (unified branch): a member's change to a synced
    field on a linked copy sets `customised`; any shape change queues
    `syncCopiesOfService` in `after()`.
  - Catalogue route: `sync_provider` (with `forceSync` for a customised copy) and
    `detach_provider`, host-only like every action; `CatalogueProviderView.sync`.
  - Manager: `SyncChip` per ticked calendar (in step / update available / customised /
    independent copy, with Update now, Re-sync, Stop syncing); helper text rewritten.
  - Help: `getting-started/linked-venues`; spec §7.7.3.
  - `catalogue/route.sync.test.ts`: the two actions, the force flag, the 409 pass-through,
    host-only and the missing provider id.
  - Later the same day: `link_provider` action (`linkCopyToOrigin` in `service-sync.ts`,
  `ensureAddonGroupLinksForService` in `service-duplication.ts`, chip button in the manager,
  route tests), and `CatalogueItemView.originVenueId/originVenueName` so the chip names the
  venue the tick would copy from (same choice as `pickOriginProvider`).
- Verified live on the dev database once both migrations were pushed (2026-09-09 12:36).
  First attempt failed for a reason worth keeping: the catalogue mapped any service with
  no recorded origin to sync state `none`, so an independent copy never showed the link
  button. Now a service with no origin reports `independent` only when it stands in for the
  offering at a venue other than the origin's; at the origin it stays `none`. Then, in the
  manager: Balayage, John Light 3's row read "180 min · independent copy · Link to Plus 1
  Staging and update"; the confirmation named both venues; after it the row read "90 min ·
  in step with Plus 1 Staging · Stop syncing", and Light 3's row held the origin's two
  processing periods, `linked`, `synced_from_service_id` set. Saving the origin with buffer 5
  reached the copy in the background (`synced_at` moved), and saving it back to 0 did too.
  Not exercised live: a member's own edit detaching the copy (needs a Light 3 login);
  covered by `patchTouchesSyncedShape` tests.

### Pre-push review (2026-09-09, evening)

The services form sends `variants` with every admin save, so "variants provided" no longer counts
as a shape change on its own: `patchTouchesSyncedShape` compares the requested variants' shape
(names, lengths, buffers, processing) with the stored ones, and a price-only save of a linked copy
leaves it linked as §3 promised. The origin-side `syncCopiesOfService` also runs only on a real
shape change now.
