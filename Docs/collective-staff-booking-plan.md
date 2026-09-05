# Staff booking for a venue collective: investigation and plan

Status: IMPLEMENTED on staging 2026-09-04 (see the linked-accounts spec §8.7 for what shipped). Reviewed 2026-09-05: the staff catalogue briefly gained every member's own services and lost them again the same day at the owner's request (the staff form lists the combined page's offerings only, as the customer page does; a member books its other services from its own page; §2.5 gap 4 stands), the linked column's own "New booking" button went for collective calendars, and the bridge's day loader applies the source service's booking window; details in spec §8.7. Decisions taken by the owner: no confirmation-step note about where the client is recorded; a column click preselects that column; New, Walk-in and the sidebar link open the whole collective; no bookings-list follow-up (Linked, My venue and All already answer).

## 1. What the owner asked for

When two or more linked venues have formed a venue collective (a combined booking page),
they act as one business, with the pairwise links kept so either party can leave cleanly.
The staff-facing booking form should then show the collective's staff, services and
availability, exactly as the combined public page does, while keeping the current staff
booking UI and flow. Linked venues with no collective keep a per-venue staff form.

## 2. What exists today (verified)

### 2.1 The staff form is the shared flow in a staff mode

`/dashboard/bookings/new` (`src/app/dashboard/bookings/new/page.tsx`) builds the venue's
`VenuePublic` with `buildVenuePublicForBookingById` and renders `NewBookingPageClient` →
`StaffSurfaceBookingStack` → `AppointmentBookingFlow` with `bookingAudience="staff"`. The
diary's "New booking" and walk-in use the same stack through `CalendarStaffBookingModal`
(`src/app/dashboard/practitioner-calendar/CalendarStaffBookingModal.tsx`, a thin wrapper
over `StaffSurfaceBookingModal`).

### 2.2 The stack can already target one other venue

`StaffSurfaceBookingStack` accepts `linkedOwnerVenueId`. When set it:

- loads the partner's profile from `GET /api/venue/linked-calendar/venue-profile?venueId=`
  (requires `create_edit_cancel` on the link) and renders the flow over that `VenuePublic`;
- reads the partner's catalogue from `GET /api/booking/appointment-catalog?venue_id=<owner>`;
- reads month and day availability from `GET /api/venue/appointment-calendar` and
  `GET /api/venue/appointment-availability` with `owner_venue_id=` (both resolve the target
  through `resolveLinkedStaffCatalogScope`, `src/lib/booking/staff-booking-access.ts:208`);
- creates through `POST /api/venue/bookings` with `owner_venue_id` →
  `resolveLinkedStaffCreateScope` (`staff-booking-access.ts:170`), writes the booking in the
  owner venue, records `recordBookingWriteAudit` and `notifyCrossVenueBookingWrite`
  (`src/app/api/venue/bookings/route.ts:1437-1450`).

This is what the diary opens for a slot on a linked column (`PractitionerCalendarView.tsx:9294`).
So "book into another venue with the full staff form" is solved for a single partner.

### 2.3 The public combined page treats the collective as a virtual venue

`src/app/book/c/[slug]/collective-page-view.tsx` builds a synthetic `VenuePublic` whose `id`
is the collective id (`loadCollectiveVenuePublic`, `is_collective: true`) and renders the
standard layout. The public booking routes all detect the id with `isCollectiveId` and route
through `src/lib/linked-accounts/collective-booking-bridge.ts`:

| Route | Collective handling |
| --- | --- |
| `GET /api/booking/appointment-catalog` | `loadCollectiveAppointmentCatalog`: offerings as services, every provider expanded to CONCRETE calendars across member venues, each carrying `owning_venue_id`, `owning_venue_name` and the real `source_service_id` |
| `GET /api/booking/availability`, `appointment-calendar` | `loadCollectiveDayAvailability`, `loadCollectiveMonthAvailableDates`, `loadCollectiveChainDayAvailability` (per-calendar owner hours, leave, closures, variants, add-ons) |
| `POST /api/booking/create`, `create-multi-service`, `create-group` | `resolveCombinedBookingTarget` → owner venue + source service + override; attribution in `bookings.collective_id` / `collective_service_item_id`; comms use collective branding (spec §7.8) |

Compliance requirements (`/api/public/compliance/booking-requirements`) resolve a collective
through the merged catalogue and answer with the owning venue (spec §7.7.1).

### 2.4 Permissions already cover it

A collective can only be upgraded to `unified_catalog` when every pair of members holds
full mutual write links: `full_details` and `create_edit_cancel` in both directions with no
§18 calendar scoping (`hasFullMutualWriteLinks`, `src/lib/linked-accounts/collectives.ts:208`),
and the reconcile ladder suspends a provider whose link drops below that. Any member's
staff therefore already hold the right the single-partner path checks.

### 2.5 The gaps

1. The four STAFF routes the stack uses (`linked-calendar/venue-profile`,
   `venue/appointment-calendar`, `venue/appointment-availability`, `POST venue/bookings`)
   resolve `owner_venue_id` to ONE real venue. None understands a collective id. Only the
   public routes do.
2. `POST /api/booking/create-multi-service` and `create-group` handle a collective but,
   being public routes, never record the linked audit or cross-venue notification when the
   actor is another member's staff. (Pre-existing for any staff use of those routes.)
3. `appointment-catalog` honours `include_hidden=true` (hidden add-on groups for staff) only
   when `staff.venue_id === venueId`, so a collective id never qualifies.
4. The staff contact autocomplete searches the actor's own contacts. A booking written to a
   partner venue matches or creates the guest THERE by email and phone (as the combined
   public page does), so the client ends up in the owner's Contacts, not the actor's.
5. The actor's Bookings list shows its own venue's rows only; a booking made for a partner's
   calendar appears on the diary's linked column (link visibility) and in the partner's
   list.

## 3. Design

**Reuse the single-partner mechanism with the collective as the target.** The flow, the
stack and the UI stay as they are; `linkedOwnerVenueId` carries the collective id; the four
staff routes learn to resolve a collective the way the public routes already do, and the
create route routes to the owning venue through the bridge before continuing down its
existing linked-create path (scope check, audit, notification).

Alternatives considered and rejected:

- **Point the staff form at the public routes** with `venue_id = collective id`. Works for
  reads, but the staff single create would lose everything `POST /api/venue/bookings` does
  that the public create does not: manual overlap allowance, outside-hours booking,
  walk-in source, deposit and card-hold toggles, hidden add-ons, custom duration, and the
  linked audit and notification.
- **Merge member catalogues in the browser.** Duplicates the bridge's eligibility, approval,
  override and any-available logic client-side; drifts immediately.

## 4. Target behaviour

> Superseded in part by the decisions in the status line: there is no "Book for" selector.
> A member venue books for the collective automatically, from every staff entry point.

- **Who gets it.** A venue that is an active member (host or not) of an active collective
  in `unified_catalog` mode with at least two currently eligible members: the same gate the
  public page applies (`loadPublicCollective` / reconcile). A venue with pairwise links
  only sees no change.
- **Choosing the target.** On `/dashboard/bookings/new` and in the diary/walk-in modal a
  "Book for" control appears when eligible: the venue itself (default) or the collective
  by name. The choice is remembered per venue in a cookie, the way the diary's filters are
  (`src/lib/calendar/calendar-filter-preferences.ts`), so a receptionist who always books
  for the collective is not asked every time. A slot clicked on a linked column whose venue
  is in the actor's collective opens the modal already in collective mode with that
  calendar preselected (today it opens single-partner mode; that remains the fallback for a
  link outside any collective).
- **In collective mode** the flow shows the collective's staff (calendar names qualified
  by owning venue when they clash, as on the public page), its offerings at collective
  prices and durations, merged availability, and "Any available" per offering
  (`collective_service_items.allow_any_available`). Only the appointment surface is
  offered (a collective is appointments-only); table, class and event tabs are hidden.
- **Create.** Single bookings go through `POST /api/venue/bookings` with the collective id
  as `owner_venue_id`, the offering as `appointment_service_id` and the concrete calendar as
  `practitioner_id`. The server resolves the owning venue and source service, applies the
  collective override, then runs the existing linked-create path against the owning venue
  (a no-op when it is the actor's own venue), stores `collective_id` and
  `collective_service_item_id`, and records the audit and notification when the owner
  differs from the actor. Visits (multi-service) and group bookings keep using the public
  routes the flow already calls, which route a collective correctly; those routes gain the
  audit and notification for a staff actor.
- **Guest identity.** Unchanged from the combined public page: the guest is matched or
  created in the owning venue. The form's contact search stays the actor's own contacts;
  picking one prefills name, email and phone, which is what the owner-side match uses.
- **After create.** Confirmation and payment links come from the owning venue (its Stripe
  account, deposit config, card-hold flag) as the bridge already ensures. The booking shows
  on the actor's diary in the partner's linked column and in the partner's Bookings list.

## 5. Implementation steps

| # | Step | Files | Notes |
| --- | --- | --- | --- |
| S1 | `resolveStaffCollectiveScope(admin, staffVenueId, id)`: is `id` a live collective the actor's venue is an active member of; returns the collective and member venue ids | new `src/lib/linked-accounts/collective-staff-scope.ts` (beside `collective-access.ts`) | The one gate every staff route below calls |
| S2 | Venue profile for a collective target | `src/app/api/venue/linked-calendar/venue-profile/route.ts` | When `venueId` is a collective (S1), answer with `loadCollectiveVenuePublic` and `booking_model: 'unified_scheduling'`, no secondary models |
| S3 | Staff month and day availability for a collective | `src/app/api/venue/appointment-calendar/route.ts`, `src/app/api/venue/appointment-availability/route.ts` | If `owner_venue_id` is a collective (S1), delegate to the bridge's month/day/chain loaders as the public routes do. Check parity of staff-only options (past-slot cutoff, phantoms, `exclude_booking_id`) against what the bridge accepts; add what is missing to the bridge rather than the route |
| S4 | Staff single create for a collective | `src/app/api/venue/bookings/route.ts` | Before `resolveLinkedStaffCreateScope`: if `owner_venue_id` is a collective, `resolveCombinedBookingTarget` → owner venue, source service, override (`resolveCollectiveServiceOverride`); rewrite the target and continue; set attribution columns; existing audit/notify path handles the cross-venue case |
| S5 | Audit and notification for staff on public multi-service and group creates | `create-multi-service/route.ts`, `create-group/route.ts` | Resolve the staff session on the request; when the actor's venue differs from the owning venue, record `recordBookingWriteAudit` and `notifyCrossVenueBookingWrite`. Closes a pre-existing gap as well |
| S6 | Hidden add-ons for members | `src/app/api/booking/appointment-catalog/route.ts` | Honour `include_hidden=true` when the staff venue is a member of the collective |
| S7 | Page and selector | `src/app/dashboard/bookings/new/page.tsx`, `NewBookingPageClient.tsx`, `StaffSurfaceBookingStack.tsx` | Server loads the venue's live collectives (`loadCollectiveViewsForVenue` + the live gate); client shows "Book for"; collective choice passes `linkedOwnerVenueId={collectiveId}` and the collective name; appointment surface only; heading "New Booking · {Collective}"; remembered choice |
| S8 | Diary entry points | `PractitionerCalendarView.tsx` (slot menu on linked columns, toolbar New/Walk-in) | Open the modal in collective mode with the clicked calendar preselected when that column's venue shares a live collective with the actor; keep single-partner mode otherwise. The bridge's calendar ids are the real `unified_calendars` ids, so preselection works unchanged |
| S9 | Tests | route tests beside S2 to S6; a stack test for S7 | Member vs non-member, dissolved collective, owner resolution and override, attribution columns, audit recorded only when owner differs, hidden add-ons |
| S10 | Docs | `Docs/reserveni-linked-accounts-spec.md` §8 (new subsection), `Docs/MOBILE_API.md` (additive params), `Docs/README.md` row | The app needs nothing: web-only UI, additive API params |

Order: S1 → S2, S3, S4 in parallel → S7 → S8 → S5, S6 → S9, S10. S1 to S4 and S7 are the
minimum for a working feature; S5, S6 and S8 complete it.

## 6. Effort

About five to six working days: S1 to S4 two days, S7 one day, S8 half a day, S5 and S6
under a day, tests and docs one day. No migration: `bookings.collective_id` and
`collective_service_item_id` already exist.

## 7. Risks and how they are handled

- **Guest rows per venue.** A client booked for a partner's calendar becomes a contact at
  the partner, not at the actor. This is how the combined public page already behaves and
  matches the "clean split" principle (data stays with the venue that served the client),
  but reception may expect to find the client in their own Contacts. Mitigation: say so on
  the confirmation step in collective mode ("{Client} is recorded at {Owner venue}").
- **Bookings list.** The actor's list will not show bookings its staff made for partner
  calendars. Optional follow-up: a "Booked by us for {Collective}" view over
  `collective_id` plus the audit log's acting venue.
- **Reconcile mid-flow.** A link change can suspend a provider between picking and
  creating; the create then fails with the bridge's "not a currently bookable offering"
  answer, which the flow already surfaces. Acceptable.
- **Time zones.** Members may sit in different zones; the bridge computes per owner venue
  with each venue's clock. The staff form displays in the collective's (host's) zone as
  the public page does. Verify in S3 tests with two zones.
- **Plan gating.** A Light member past due is bypassed for its own staff on the public
  routes; in collective mode the owning venue's gate applies. The single-partner path has
  the same rule today.

## 8. Decisions needed from the owner

1. Default target when eligible: the venue itself (recommended, no behaviour change for
   anyone who does not opt in) or the collective.
2. Who sees the selector: every active member (recommended, since all hold full write
   links) or the host only.
3. Whether the actor's Bookings list should include bookings its staff made for partner
   calendars (follow-up in §7), or whether the diary's linked column is enough.
