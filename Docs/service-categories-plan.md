# Service categories: plan and status

Status: IN PROGRESS (started 2026-09-02, baseline `5cc6c097` on `staging`).

## What the owner asked for

Group appointment services into categories. Owners create categories on the Services page, assign
services to them, and drag categories into the order they appear. The public booking page and the
staff booking flow list services under those categories. The owner chooses whether the booking page
shows every category as a headed section with its services listed below (with a category menu to
jump between them), or as collapsible categories the customer opens one at a time. Either way a
customer must be able to find and pick a service quickly on a long menu, at least as well as on
Fresha, GetTimely or Booksy.

## Facts the design rests on (verified 2026-09-02)

- Services live in `service_items` only. `venueUsesUnifiedAppointmentServiceData` is true for every
  appointment venue and no legacy venue remains (memory: no-legacy-venues-unified-scheduling-only),
  so the legacy `appointment_services` mirror is not extended.
- There was no category concept anywhere for venue services. `collective_service_items.category`
  (free text) and `venue_collectives.service_grouping` existed but nothing rendered them; the
  combined-page section below replaces the free-text column with a real table.
- Ordering is `service_items.sort_order` written by `PUT /api/venue/appointment-services/reorder`
  and read through `compareByVenueServiceOrder` (`src/lib/booking/service-display-order.ts`).
  Every service list on every surface sorts through that one comparator.
- The public flow, the staff booking modal and the embed all render the same component,
  `AppointmentBookingFlow`, so one change to its service step covers all three. The step has no
  search and no grouping today. The staff modal is always service-first, so its service list is the
  first thing staff see.
- Four list sites need grouping: the `service` step, the `group_service` step, the multi-service
  "Add another service" chips, and the marketing Services tab (`BookingPageServicesPanel`).
- The Services page already has dnd-kit drag reorder with optimistic save and rollback
  (`AppointmentServicesView.tsx`), which the category list copies.
- Sticky positioning is inert inside the embed iframe (it is sized to full content), so the
  category menu degrades to a plain chip row there.

## Design

### Schema (one additive migration, expand-only, safe to push before the code)

- `service_categories (id, venue_id, name, sort_order, created_at, updated_at)`, unique on
  `(venue_id, lower(name))`, RLS mirroring `service_items` (staff of the venue, service role).
- `service_items.category_id uuid NULL REFERENCES service_categories ON DELETE SET NULL`.
  Deleting a category never deletes a service; the services just become uncategorised.
- pgTAP test: cross-venue isolation for staff, no anon read, and the SET NULL on delete.

### Reads are tolerant of the missing table

`fetchAppointmentCatalog` and `GET /api/venue/appointment-services` treat a failed
`service_categories` query as "no categories" and log it. CI's E2E smoke and any environment where
the migration has not been applied yet keep working; the feature simply stays off until it is.

### Data shape

- Catalog (`/api/booking/appointment-catalog`, public, consumed by the mobile app too): each
  service gains `category: { id, name, sort_order } | null`; the response gains a top-level
  `categories` array. Both additive.
- `GET /api/venue/appointment-services` gains `categories` and each service carries `category_id`.
- `BookingPagePublicService` gains the same `category` object so the Services tab can group.
- `booking_page_config.services_layout: 'sections' | 'accordion'` (default sections).

### Ordering

`compareByCategoryThenServiceOrder` in `src/lib/booking/service-categories.ts`: category
`sort_order` first (uncategorised last), then the existing `compareByVenueServiceOrder`.
`groupServicesByCategory` returns ordered groups; a venue with no categories returns a single
unlabelled group so every surface renders exactly as before.

### API

- `GET/POST /api/venue/service-categories`, `PATCH/DELETE /api/venue/service-categories/[id]`,
  `PUT /api/venue/service-categories/reorder`. Writes are admin-only, matching the services
  reorder route.
- `POST/PATCH /api/venue/appointment-services` accept `category_id` (must belong to the venue).
  Non-admin PATCHes cannot change it (the staff field filter drops it), matching how other
  venue-level fields behave.

### Services page

- New Categories tab: add, rename inline, delete (with confirm), drag or arrow reorder.
- The services list groups under category headings in category order; drag reorder works within a
  group. The service form gets a Category select.

### Booking page settings

Under the Services group: "How services are listed" with two choices, sections with a category
menu, or collapsible categories.

### Booking flow (public, staff modal, embed)

New `ServiceCategoryList` component used by every list site:

- No categories: renders the flat list unchanged (keeps every existing test green).
- Search box when the menu has six or more services; matches name and description; results show
  flat with a small category label.
- Sections: sticky horizontal category chips (venue-accent pills) that scroll to the section and
  track the visible section; headed sections with counts.
- Accordion: category headers with counts and chevrons, smooth height animation, first category
  open by default, several may be open; a carried or preselected service opens its category.
- Fully keyboard operable, `aria-expanded`/`aria-controls`, reduced-motion respected.

## Combined (collective) pages (added 2026-09-02)

The same feature, per combined page, curated by the host:

- `collective_service_categories (id, collective_id, name, sort_order)` and
  `collective_service_items.category_id` (ON DELETE SET NULL), migration
  `20270202130000_collective_service_categories.sql`, RLS mirroring the items table, pgTAP
  `collective_service_categories_test.sql`. The free-text `collective_service_items.category`
  column stays as the dead column it was.
- Seamless by default: an offering created from member services inherits the heading its
  source service carries at its own venue (host venue's category wins), found or created by
  name on the combined page (`collective-category-inheritance.ts`). Existing pages get one pass
  on the host's next visit, recorded in `venue_collectives.categories_seeded_at`; after that
  only the host's own edits and the explicit "Match categories from your venues" action change
  anything, and only offerings without a heading are ever touched.
- Manager (Services & calendars tab): the shared `ServiceCategoriesManager` writing through
  catalogue actions (`create_category`, `rename_category`, `delete_category`,
  `reorder_categories`, `sync_categories`; `reorder_items` exists for future drag order), a
  Category select on each offering, offerings listed under their headings.
- Page tab: `services_layout` accepted by the collective config schema, so the shared editor's
  "How services are listed" control works and the preview groups.
- Public: `loadPublicCombinedCatalogue` sorts heading first, then host order, then member
  order, then name; `loadCollectiveAppointmentCatalog` returns `categories` and a `category`
  per service, so the booking flow renders identically to a venue page; the Services tab gets
  `category` and `sort_order`.

### A pre-existing RLS fault this work surfaced

`staff_select_collectives` (on `venue_collectives`) subqueries `venue_collective_members`, and
`staff_select_collective_members` subqueries `venue_collectives` back. Both policies apply to every
role, so any policy evaluation that reads either table as `anon` or `authenticated` raises
"infinite recursion detected in policy". `collective_service_items` and
`collective_service_providers` carry policies with exactly those subqueries and are therefore
unreadable through PostgREST for those roles; nothing noticed because every collective read in
the app goes through the service role. The new categories table avoids the chain with two
SECURITY DEFINER helpers (`current_staff_collective_ids`, `collective_is_public_catalog`).
Migration `20270202140000_collective_policies_no_recursion.sql` then rewrites all six older
collective policies through the helpers plus a third, `current_staff_hosted_collective_ids`,
with no change to who can read what (each rewrite documents the predicate it replaces). It is
self-contained: it defines all three helpers itself and restates the two categories policies,
because staging had already applied `20270202130000` in its first form (recursive subqueries,
no helpers) before the helpers were added to that file, and an applied migration must never be
edited in place; the CLI tracks versions, so the edit never ran there. All three
are allowlisted in `scripts/check-client-executable-functions.mjs`, and
`supabase/tests/collective_policies_test.sql` asserts every role's reads, which is also the
regression test for the recursion: any policy that subqueries the two collective tables again
aborts that file before its first assertion.

## Out of scope, by decision

- Category photos or descriptions.
- Per-category booking rules.

## Deploy

Expand-only migration: follows the standard ritual (code on staging, push migration to staging,
test, push to production, merge). Production can run the migration before the code arrives.

## Progress (2026-09-02)

- [x] Migration `20270202120000_service_categories.sql` + pgTAP `service_categories_test.sql`
- [x] Types, catalog (`categories` + per-service `category`), comparator and grouping helper
      (`src/lib/booking/service-categories.ts`, tolerant loader in `service-categories-db.ts`)
- [x] `/api/venue/service-categories` (GET, POST, PATCH, DELETE) and `/reorder` (PUT);
      services GET returns `categories`, POST/PATCH accept `category_id`
- [x] Services page: Categories tab (`ServiceCategoriesManager`), grouped list, form select
- [x] `booking_page_config.services_layout` + "How services are listed" in the editor
- [x] `ServiceCategoryList` wired into the service step, the group service step, the
      multi-service "Add another service" chips and the Services tab
- [x] Tests (helper, component, editor suites green), help centre copy, README row,
      MOBILE_API note, schema inventory

- [x] Combined pages: migration `20270202130000`, inheritance, manager UI, public catalog
      (`collective-categories.ts`, `collective-category-inheritance.ts`)

Owed: apply both migrations to staging, test the dashboard, the combined page manager and the
public pages live, apply to production, merge. Until the migration lands the code lists services flat and logs
`[service-categories] service_categories read failed`.
