# Resneo: Collective Combined Booking Page — Scope

**Status:** Scoped, not started
**Parent spec:** `Docs/reserveni-linked-accounts-spec.md` §7.1, §7.6, §7.7, §8.5, §8.6
**Depends on:** Linked Accounts Phase 1 (shipped) and the collective data model / API /
settings panel (shipped). The §7.5 link-change cascade is now wired (`reconcileCollectivesAfterLinkChange`).
**Last updated:** 2026-05-18

---

## 1. Why this is a separate piece of work

The collective backend is done: `venue_collectives` / `venue_collective_members` tables and
RLS, the create / invite / member / host-transfer API, the settings panel, eligibility checks
(`hasFullMutualLinks`), and the membership cascade all exist. What is **not** done is the
customer-facing payoff: the combined public booking page.

Today `/book/c/[slug]` ([book/c/[slug]/page.tsx](src/app/book/c/[slug]/page.tsx)) is a static
directory — it lists member venues and their practitioners/services, and every "Book" button
deep-links the customer **out** to that venue's own `/book/[venue-slug]` page. Spec §7.1
requires a genuine combined flow with live cross-venue availability and **in-page** booking.

Building that is a real feature on the public booking surface, so it is scoped on its own.
The static directory is a correct, shippable interim — it does not block Phase 1 or the
collective management feature.

---

## 2. Goal and non-goals

**Goal.** `/book/c/[slug]` becomes a real combined booking experience:

- Combined browse across all `active` member venues, grouped `by_practitioner` or
  `by_service_type` per `venue_collectives.service_grouping`.
- Selecting a service/practitioner books **in-page** — no redirect to a per-venue page —
  reusing the existing appointments booking flow.
- "Any available practitioner" (§7.6): when the collective and the member opt in, offer a
  combined earliest-slot search across eligible practitioners in all member venues; the
  resulting booking is created in the chosen practitioner's **owning** venue.
- Every booking is a normal `bookings` row under one `venue_id` / `practitioner_id`, with
  `bookings.collective_id` set for attribution (§7.7 — column already exists).
- Collective branding (logo, colour, description) applies to the page and its confirmation
  comms (§7.8); each venue's own page is unchanged.
- §8.6 cross-suggestion: when a member venue's own `/book/[venue-slug]` page finds no
  availability and that venue is in a collective, surface "Other practitioners at
  {Collective} have availability — [Try the {Collective} page]".

**Non-goals.**

- No change to the collective data model, RLS, management API, or settings panel.
- No change to per-venue `/book/[venue-slug]` flows beyond adding the §8.6 suggestion.
- Restaurant / class / event booking models — collectives are Appointments-family only.
- Cross-venue cart (booking at two venues in one checkout) — out of scope.

---

## 3. Current state — what can be reused

- **`loadPublicCollective(admin, slug)`** ([collectives.ts](src/lib/linked-accounts/collectives.ts:233))
  already returns the live, reconciled dataset: members with their visible practitioners
  (id/name/slug) and services (id/name/duration/price). This is the page's data source —
  it just needs richer per-practitioner data for in-page booking.
- **`BookPublicBookingFlow`** ([BookPublicBookingFlow.tsx](src/components/booking/BookPublicBookingFlow.tsx))
  is **single-venue** — `Props.venue: VenuePublic`. It is not literally "fed a multi-venue
  dataset"; the realistic reuse is a *router* layer (below).
- **`lockedPractitioner` prop** — `BookPublicBookingFlow` / `BookingFlowRouter` already
  accept a `LockedPractitionerBooking { id, name, bookingSlug }`, used today by
  `/book/[venue-slug]/[practitioner-slug]`. This is the hook for "customer picked a
  practitioner in the collective → drop into that venue's flow with the practitioner locked".
- **`getPublicVenueForBookBySlug(slug)`** builds the `VenuePublic` object the flow needs.
- **`/api/booking/availability`** and the appointment catalog/calendar endpoints are
  per-venue; "any practitioner" needs a fan-out or a new endpoint (below).

---

## 4. Proposed approach

A new client component `CollectiveBookingFlow` is the routing layer. It never becomes a data
layer — every booking still goes through the normal per-venue flow.

### 4.1 Browse → select → book (in-page)

1. The server page loads `loadPublicCollective` and the `VenuePublic` for each active member
   (`getPublicVenueForBookBySlug`), passing them to the client `CollectiveBookingFlow`.
2. `CollectiveBookingFlow` renders the combined browse (the existing `by_practitioner` /
   `by_service_type` groupings, but as interactive selectors, not links).
3. On selecting a practitioner (or a service at a venue), it mounts `BookPublicBookingFlow`
   for that member's `VenuePublic` with `lockedPractitioner` set and `accentColour` from the
   collective branding — in a panel/step, not a navigation. Back returns to browse.
4. Booking completes through the venue's existing appointment flow unchanged.

### 4.2 `collective_id` attribution (§7.7)

The booking-create path must stamp `bookings.collective_id`. Add an optional
`collectiveId` to the appointment create input and thread it from `CollectiveBookingFlow`
through `BookPublicBookingFlow` → the create API. Booking source stays `'online'`.

### 4.3 "Any available practitioner" (§7.6)

Only when `venue_collectives.allow_any_practitioner` AND the member's
`allow_any_practitioner_substitution` are set, for a substitutable service:

- The customer picks a service + date; the page queries availability for every eligible
  practitioner across member venues and offers the earliest slots.
- Implement as a new endpoint `GET /api/booking/collective-availability?slug=&serviceKey=&date=`
  that fans out over members server-side (cleaner than N client calls and avoids leaking the
  member list shape). It returns slots tagged with their owning venue + practitioner.
- On selection, the booking is created in the chosen practitioner's owning venue.

### 4.4 Branding in confirmation comms (§7.8)

Bookings made through the collective should use collective branding in confirmation email/UI.
Decide during build: either pass a branding override through the create path, or accept that
v1 uses the owning venue's branding for comms and only the *page* is collective-branded
(simpler; recommended for v1, with §7.8 full comms branding as a fast-follow).

### 4.5 Cross-suggestion (§8.6)

In the per-venue `/book/[venue-slug]` appointments flow, when availability search returns
nothing for the visible range and the venue is an `active` member of a collective, render a
prompt linking to `/book/c/{slug}`. Needs a lightweight "is this venue in a live collective"
lookup on the venue book page. Collective-scoped only — never shown for pairwise-only links.

---

## 5. Work breakdown

1. **Data:** extend `loadPublicCollective` (or add a sibling) to also yield each member's
   `VenuePublic` so the client can mount per-venue flows. Group/dedupe services for
   `by_service_type`.
2. **`CollectiveBookingFlow` client component:** combined browse + select + in-page mount of
   `BookPublicBookingFlow` with `lockedPractitioner` + collective accent.
3. **Rewrite `/book/c/[slug]/page.tsx`** to render `CollectiveBookingFlow` instead of the
   static directory.
4. **`collective_id` attribution:** thread `collectiveId` through the appointment create
   input + API; stamp the column.
5. **"Any practitioner" (§7.6):** `collective-availability` fan-out endpoint + UI option +
   create-in-owning-venue.
6. **§8.6 cross-suggestion** on the per-venue book page.
7. **Widget (§8.5):** verify the existing "Venue collective" embed option now points at a
   functional page; the embed flow already supports `embed` + `onHeightChange`.
8. **QA pass** — see §6.

A reasonable phasing: steps 1–4 are the MVP (real in-page combined booking); steps 5–6 are
fast-follows; step 7 is verification.

---

## 6. Risks and test focus

- **Per-venue flow correctness.** Reusing `BookPublicBookingFlow` per member means the
  battle-tested flow is unchanged — the risk is in the wrapper, not the booking engine.
  Verify a booking made via the collective lands correctly in the owning venue with
  `collective_id` set.
- **Stale membership.** The page must call the existing reconcile path (`loadPublicCollective`
  already does) so a collective that dropped below 2 live members 404s rather than rendering
  a one-venue "collective".
- **Eligibility leakage.** Only `active` members with full mutual links appear — already
  enforced server-side; the client must not be able to widen this.
- **"Any practitioner" fairness/race:** two customers offered the same earliest slot — the
  normal per-venue booking create already handles slot contention; surface a clean "just
  taken, here are the next options" path.
- **Branding scope:** collective branding must not leak into a member venue's own page or
  its non-collective bookings (§7.8).

QA matrix: combined browse renders both groupings · in-page booking completes and lands in
the owning venue with `collective_id` · collective branding on page only · "any practitioner"
picks earliest across venues and books the right one · a collective below 2 members 404s ·
cross-suggestion appears only for collective members on a no-availability result · the
collective widget embed renders the functional flow.

---

## 7. Open questions

- **Confirmation-comms branding (§7.8):** full collective branding in emails now, or
  venue-branded comms for v1 with page-only collective branding? (Recommendation: page-only
  for v1, comms branding as a fast-follow.)
- **`by_service_type` matching:** services are currently grouped by lower-cased name. Is
  name-equality good enough, or do we need an explicit "service type" taxonomy? (Recommendation:
  name-equality for v1; revisit if venues report mismatches.)
- **Deep-link to a venue+practitioner within the collective** (`/book/c/{slug}?venue=&practitioner=`)
  for marketing — nice-to-have, not v1.
