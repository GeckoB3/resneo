> **ARCHIVED (2026-07-04).** This work has shipped. Kept for historical and architecture reference only; it does not describe pending work. Any "not yet built" / "proposed" / "no code written" status noted below is obsolete. See `Docs/archive/README.md`.

# Combined Booking Pages & Unified Service Catalog — Implementation Plan

**Status:** Plan / design — not yet built. No code written.
**Owner doc:** extends `Docs/reserveni-linked-accounts-spec.md` §7 (Venue Collectives). Treat this as a
proposed **§21** of that spec; fold the decisions back into the spec on build.
**Supersedes/absorbs:** `Docs/reserveni-collective-booking-page-scope.md` (the earlier directory-page scope).
**Last updated:** 2026-06-06

---

## 0. One-paragraph summary

Two or more **mutually write-linked** venues can opt into a single **Combined Booking Page** that
presents a **host-curated, de-duplicated service catalogue** drawn from every member venue. The
person setting it up chooses which services to offer, merges near-identical services across venues
into one offering, sets the price and duration shown for each offering, and assigns which calendars
(across all member venues) provide it. The page can live at a **brand-new address** or **adopt one
member's existing booking slug**; each member independently chooses whether its **own solo page**
redirects into the combined page or stays live. Customers either pick a specific practitioner/venue
or choose **"any available"** for the earliest slot across every calendar offering that service.
Every booking still lands as a normal `bookings` row under exactly one owning venue. When a link is
broken or a member leaves, the catalogue **splits cleanly and non-destructively** — every override
lives only in collective-scoped tables, so each venue instantly reverts to exactly what it had
before, with no source service, price, or calendar ever mutated.

---

## 1. What exists today vs. what this plan adds

### 1.1 Already built (the "directory collective", spec §7)

| Capability | State | Where |
|---|---|---|
| `venue_collectives` + `venue_collective_members` tables, RLS, lifecycle | ✅ | `20260919120000_linked_accounts.sql` |
| Create / invite / accept / decline / leave / remove / transfer-host / dissolve | ✅ | `api/venue/collectives/*`, `VenueCollectivesPanel.tsx` |
| Member **self-curation** of *visibility* (`visible_practitioner_ids`, `visible_service_ids`, `display_order`) | ✅ | `members/route.ts`, `ConfigureVisibilityModal` |
| Branding (logo/colour/description), contrast-guarded | ✅ | `BrandingFields`, `book/c/[slug]` |
| Public page at **separate** `/book/c/{slug}` namespace | ✅ | `book/c/[slug]/page.tsx` |
| `by_service_type` **shallow** group-by-name (each venue's own price shown verbatim) | ✅ | `CollectiveBookingFlow.tsx` |
| Reconcile / auto-dissolve / host succession on link change | ✅ | `collectives.ts` `reconcileCollective` |
| `bookings.collective_id` attribution column | ✅ | migration + create routes |

The current public page is effectively a **directory that hands off** to each venue's own
`BookPublicBookingFlow`. Eligibility is full-mutual **visibility** only.

### 1.2 NOT built — everything this plan is about

- ❌ An explicit **separate-vs-combined choice** (collectives are purely additive today).
- ❌ Gating the combined page on **mutual create/edit/delete** (today: visibility only).
- ❌ A **host-curated combined catalogue** (today: each member curates only its own listing).
- ❌ True **service de-duplication/merge** into a single offering (today: shallow group-by-exact-name).
- ❌ **Price / duration overrides** at the combined-page level (no `collective_services` table exists — confirmed).
- ❌ **Cross-venue calendar assignment** per offering (today: a venue only exposes its own practitioners).
- ❌ **Adopting an existing venue slug** for the combined page (today: isolated `/book/c/{slug}` only).
- ❌ **In-page combined booking** with **"any available" earliest-slot routing** across venues (§7.6 is stubbed "coming soon").
- ❌ A **non-destructive split** that has to *un-apply* a merged catalogue (today's split is trivial because nothing is ever merged — we must preserve that property by construction in the richer model).

### 1.3 Approach: extend, don't fork

Implement the combined page as an upgraded **mode** of the existing `venue_collectives`, not a new
parallel construct. We reuse the membership lifecycle, reconcile/dissolve cascade, branding, host
succession, and notifications — and add a catalogue layer + write-gating + slug/routing + in-page
booking on top. New field on `venue_collectives`:

```
page_mode  text NOT NULL DEFAULT 'directory'   -- 'directory' | 'unified_catalog'
```

`directory` = today's behaviour, unchanged. `unified_catalog` = this plan. A collective can be
upgraded/downgraded between modes (with guardrails, §9). This keeps a single source of truth for
"who is grouped with whom" and means the split logic already in place is the foundation we harden.

---

## 2. Confirmed product decisions (from the brief + 2026-06-06 Q&A)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | **URL of the combined page** | **Host chooses either** | Support both a brand-new dedicated slug *and* adopting one member's existing `/book/{slug}`. |
| D2 | **Fate of each member's solo page** | **Per-venue choice** | Each member sets `solo_page_behavior` = `redirect` \| `keep_live`. The slug-donor is a special case (§5.3). |
| D3 | **Booking routing for a merged service** | **Support both** | Customer can pick a specific provider *or* "any available" earliest-slot across venues. |
| D4 | **Eligibility gate** | Mutual **create/edit/delete** | Combined mode requires `create_edit_cancel` in **both** directions between **every** pair of members (stricter than directory mode's `full_details`-visibility gate). Rationale in §3. |
| D5 | **Data sovereignty** | Absolute | No source `appointment_services`, `practitioners`, price, or calendar is ever mutated. All combined-page config lives in collective-scoped tables. Split = stop applying them. |
| D6 | **Pricing consent** | **Consented model** (confirmed 2026-06-06) | Host curates structure and *proposes* commercial terms; each member *one-tap approves* the price/duration override for its **own** calendars, with an opt-in per-member "auto-accept host pricing". Source values are the default → no-touch path is zero-friction. A provider isn't bookable until approved. See §7.4. |
| D7 | **Deposits on override** | **Off effective price** (confirmed 2026-06-06) | Deposits follow the owning venue's existing deposit rules, computed against the **effective (overridden)** price. Confirm against the live deposit logic in `create-multi-service`. |
| D8 | **Cross-timezone members** | **Single TZ for v1** (confirmed 2026-06-06) | All members must share a timezone to run a combined page (mirrors the current linked-calendar TZ limitation); a clear setup error otherwise. Lift later. |

### 2.1 Notes on the confirmed commercial/operational decisions

- **D6 (pricing consent).** The brief's "the setup person adjusts pricing/duration" is honoured —
  the host *can* set any price/duration — but because that price is another venue's revenue, the
  owning member must approve its own terms (one click; or pre-authorise via per-member auto-accept).
  The rejected alternative ("host sets everything unilaterally") would let one venue set another's
  prices without consent, breaking the sovereignty principle. Implemented as the
  `collective_service_providers.approval_status` state machine (§4.4, §7.4).
- **D7 (deposits).** The customer is charged/deposited against exactly what they were shown on the
  combined page (the effective price), so the override flows into deposit computation, not just the
  display.
- **D8 (timezone).** Enforced at upgrade-to-combined and snapshotted in `venue_collectives.timezone`;
  mixed-TZ combined pages are deferred until linked-calendar cross-TZ support lands generally.

---

## 3. Why the combined page is gated on mutual write (D4)

Customer bookings made through the combined page are created **server-side as the owning venue**
(public route, service-role) — so customer creation does **not** technically need cross-venue write
rights. The mutual `create_edit_cancel` gate is about **operations**:

- Once venues present one combined front door, a customer who booked a service *provided by venue B*
  may call **venue A** to move or cancel it. Staff at any member must be able to manage **any**
  booking on the combined calendar.
- "Any available" routing means a booking can land in *any* member; the other members must be able
  to see and act on it to run the day.

So: **combined mode requires `create_edit_cancel` both ways between every member pair**, enforced at
upgrade time and re-verified on every reconcile and every public render. If any pair drops below it,
the collective falls back toward directory mode or sheds the affected member (§8). This is a strict
superset of directory mode's `full_details` gate and reuses the same `hasFullMutualLinks` machinery,
extended to check the action level.

---

## 4. Data model

All additive, nullable/defaulted, RLS-enabled, dated migrations under `supabase/migrations/`.
Names follow the existing `linked_accounts` family conventions.

### 4.1 `venue_collectives` — new columns

```
page_mode            text    NOT NULL DEFAULT 'directory'    -- 'directory' | 'unified_catalog'
slug_strategy        text    NOT NULL DEFAULT 'dedicated'    -- 'dedicated' | 'adopt_member'
adopted_venue_id     uuid    NULL  REFERENCES venues(id) ON DELETE SET NULL
                                   -- set when slug_strategy='adopt_member'; must be an active member
timezone             text    NULL                            -- snapshot at upgrade; D8 guard
CHECK (page_mode IN ('directory','unified_catalog'))
CHECK (slug_strategy IN ('dedicated','adopt_member'))
CHECK (slug_strategy = 'dedicated' OR adopted_venue_id IS NOT NULL)
```

- When `slug_strategy='dedicated'`, the page is served at `/book/c/{slug}` exactly as today.
- When `slug_strategy='adopt_member'`, the page is *additionally* served at `/book/{adopted venue's slug}`
  (resolver in §5). `slug` (the `c/` one) remains the stable canonical identifier and is always
  reserved, so we never lose the page if the adoption is undone.

### 4.2 `venue_collective_members` — new column

```
solo_page_behavior   text NOT NULL DEFAULT 'keep_live'   -- 'keep_live' | 'redirect'
CHECK (solo_page_behavior IN ('keep_live','redirect'))
```

Each member chooses whether `/book/{its slug}` redirects to the combined page or stays live (D2).
Existing `visible_*`/`display_order` columns remain for directory mode and as the *default seed* for
the catalogue builder.

### 4.3 `collective_service_items` — the merged offering (NEW)

One row per offering shown on the combined page. The host-curated catalogue.

```
collective_service_items
├── id                  uuid PK default gen_random_uuid()
├── collective_id       uuid NOT NULL FK → venue_collectives(id) ON DELETE CASCADE
├── name                text NOT NULL                 -- canonical display name ("60-min Deep Tissue Massage")
├── description         text NULL
├── category            text NULL                     -- optional grouping bucket for by_service_type
├── display_order       integer NOT NULL DEFAULT 0
├── default_duration_minutes integer NULL             -- catalogue-level default; per-provider may override
├── default_price_pence integer NULL                  -- catalogue-level "from" price; per-provider may override
├── pricing_display     text NOT NULL DEFAULT 'from'  -- 'from' | 'fixed' | 'per_provider'
├── allow_any_available boolean NOT NULL DEFAULT true -- D3: offer "any available" for this item
├── status              text NOT NULL DEFAULT 'active'-- 'active' | 'archived'
├── created_at, updated_at timestamptz NOT NULL default now()
└── CHECK (status IN ('active','archived'))
    CHECK (pricing_display IN ('from','fixed','per_provider'))
```

### 4.4 `collective_service_providers` — which calendars provide an item (NEW)

The cross-venue calendar assignment + per-provider overrides. This is the table that makes "choose
which calendars offer the service, and adjust pricing/duration" real, while keeping overrides
collective-scoped (never touching the source service).

```
collective_service_providers
├── id                       uuid PK default gen_random_uuid()
├── item_id                  uuid NOT NULL FK → collective_service_items(id) ON DELETE CASCADE
├── member_id                uuid NOT NULL FK → venue_collective_members(id) ON DELETE CASCADE
├── venue_id                 uuid NOT NULL FK → venues(id)            -- denormalised owning venue (= member.venue_id)
├── source_service_id        uuid NOT NULL                            -- the venue's own appointment_services.id (the real bookable service)
├── practitioner_id          uuid NULL                                -- specific calendar; NULL = all of this venue's practitioners that offer source_service_id
├── price_pence_override     integer NULL                             -- effective price = COALESCE(override, item.default_price, source service price)
├── duration_minutes_override integer NULL                            -- effective duration likewise
├── approval_status          text NOT NULL DEFAULT 'pending'          -- 'pending' | 'approved' | 'rejected'  (D6)
├── approved_by_user_id      uuid NULL FK → auth.users(id) ON DELETE SET NULL
├── status                   text NOT NULL DEFAULT 'active'           -- 'active' | 'suspended' (link/eligibility) | 'removed'
├── created_at, updated_at   timestamptz NOT NULL default now()
└── UNIQUE (item_id, venue_id, source_service_id, practitioner_id)
    CHECK (approval_status IN ('pending','approved','rejected'))
    CHECK (status IN ('active','suspended','removed'))
```

**Effective values** resolved at render/booking:
`price = COALESCE(provider.price_pence_override, item.default_price_pence, source_service.price_pence)`
`duration = COALESCE(provider.duration_minutes_override, item.default_duration_minutes, source_service.duration_minutes)`

A provider is **bookable** only when `approval_status='approved'` AND `status='active'` AND the owning
member is currently eligible AND the underlying source service + practitioner are still active. This
guard is what makes the split automatic (§8).

### 4.5 `bookings` — new attribution columns

```
collective_service_item_id  uuid NULL    -- which combined offering produced this booking (attribution; no FK, mirrors collective_id)
quoted_price_pence          integer NULL -- the price the customer was actually shown (already partly covered by service_price_pence; confirm reuse)
```

`collective_id` already exists. We record the offering for reporting and to honour the *quoted*
price even though the source service's own price may differ. (Booking rows already carry
`service_price_pence`, `duration_minutes`, `estimated_end_time` per segment — confirmed in
`create-multi-service/route.ts` — so the overridden values flow onto the row with minimal new schema.)

### 4.6 RLS

- `collective_service_items` / `collective_service_providers`: **staff read** rows for collectives
  they host or are a member of (reuse the `staff_select_collectives` pattern keyed via
  `collective_id` → membership). **Public (anon) read** only when the parent collective is `active`,
  `page_mode='unified_catalog'`, the provider is `approved`+`active`, and the member is `active`
  (mirror `public_read_active_collective_members`). **Writes** via service-role only (admin API),
  with app-layer authorisation: host edits items + structure; a member edits/approves only its own
  `collective_service_providers` rows (D6).
- No change to `bookings` RLS beyond what linked accounts already grant — the mutual-write gate
  already gives every member staff `create_edit_cancel` over every other member's bookings, which is
  exactly what combined-calendar management needs.

---

## 5. URL & routing architecture (D1, D2)

### 5.1 Three serving paths

1. `/book/c/{collective.slug}` — always live for an active `unified_catalog` collective (canonical).
2. `/book/{adopted venue slug}` — when `slug_strategy='adopt_member'`, this path serves the combined
   page instead of the donor venue's solo page.
3. `/book/{member slug}` for each member with `solo_page_behavior='redirect'` — 308-redirects to the
   canonical combined page.

### 5.2 Resolver change (the only routing-sensitive edit)

`src/app/book/[venue-slug]/page.tsx` currently does `getPublicVenueForBookBySlug(slug)` then renders.
Insert a **combined-page claim check first**:

```
1. claim = loadCombinedClaimForSlug(slug)        // active unified_catalog collective that adopted this slug,
                                                  // OR a member with solo_page_behavior='redirect'
2. if claim is 'adopt'   → render CombinedBookingFlow(claim.collective)
   if claim is 'redirect'→ redirect(308, '/book/c/' + claim.collectiveSlug)   // or to the adopted slug if set
3. else                  → existing venue path (unchanged)
```

`loadCombinedClaimForSlug` is a single indexed lookup. Because `venues.slug` is globally unique and a
collective may only adopt a **member's own** slug, there is never a venue-vs-collective collision: the
adopted slug is owned by a member we control. The `/book/c/{slug}` namespace stays separate as today.

### 5.3 The slug-donor special case

If the host adopts member A's slug, A's solo page no longer has its own URL (the combined page sits
there). So for the donor, `solo_page_behavior` is effectively forced to "subsumed". The setup flow
must state this plainly: *"`/book/bliss-spa` will now show the combined page. Bliss Spa's individual
page will be reachable only through the combined page (or give Bliss Spa a new address)."* If A later
wants a standalone page back, it mints a new solo slug (a venue-settings action, out of this feature's
core but worth a helper). Undoing adoption restores A's solo page at its slug (§8).

### 5.4 SEO / correctness

- Canonical `<link rel="canonical">` on all three paths points at the chosen public URL (adopted slug
  if set, else `/book/c/{slug}`).
- Redirects are **308** (permanent-but-method-safe) while active; on dissolution they **stop** (the
  member's solo page returns 200 again) — never a hard 410, so bookmarks heal.
- `generateMetadata` stays **read-only** (the existing #11 fix) — it must not reconcile/dissolve.

---

## 6. Customer-facing combined booking flow

A new `CombinedBookingFlow` (the `unified_catalog` counterpart to today's directory `CollectiveBookingFlow`).

### 6.1 Browse

- Render `collective_service_items` (active), grouped by `service_grouping`:
  - `by_service_type` → group by `category`/item; each item a card with effective "from" price + duration.
  - `by_practitioner` → group providers by venue/practitioner, items nested.
- Each item shows the **effective** price/duration (per §4.4 resolution) and a provider count
  ("offered by 3 practitioners across 2 venues").

### 6.2 Select provider (D3 — both modes)

For a chosen item:
- **Pick specific** — list eligible providers (practitioner + venue, with that provider's effective
  price/duration), customer picks one.
- **Any available** (when `item.allow_any_available`) — show a single combined availability computed
  across all bookable providers (§6.4); on slot pick, bind to the specific provider that owns that slot.

### 6.3 Book

Reuse the existing public create path (`create-multi-service`) with three additions:
- Carry `collective_id` + `collective_service_item_id` (attribution).
- Pass the **effective duration** so the slot length, `estimated_end_time`, and conflict checks use the
  overridden duration — *not* the source service's. This is critical: a 45-min source service offered
  as a 60-min combined item must block 60 min in the owning venue's calendar.
- Pass the **effective price** as the quoted price (`service_price_pence`/`quoted_price_pence`), so the
  customer is charged what they were shown; deposits computed off it (D7).

The resulting row is a **normal booking** under the provider's `venue_id` + `practitioner_id` +
`source_service_id`. No "collective booking" entity exists (§7.7 of the parent spec holds).

### 6.4 "Any available" cross-venue availability (the deferred §7.6, now in scope)

- For each bookable provider of the item, compute that venue's availability for the effective duration
  using the **existing per-venue availability engine** (working hours, breaks, blocks, existing
  bookings, buffers). Run them concurrently (bounded fan-out), then merge into one slot list keyed by
  time, each slot annotated with the provider(s) that can serve it. Earliest-first.
- Tie-break when multiple providers free at the same time: configurable (round-robin / least-loaded /
  display_order). Default **display_order then least-loaded** for fairness.
- Cache the per-provider availability briefly (the §7.1 N-query caching note) to keep the page snappy.
- On submit, **re-validate** the chosen provider's slot at write time (optimistic-concurrency guard) so
  two simultaneous customers can't double-book the same calendar; fall back to next provider/slot with
  a clear message if it was just taken.

### 6.5 Unavailable / partial states

- `< 2` eligible members, dissolved, or no bookable items → branded "this page is unavailable" state
  (§19.3), never a bare 404.
- A member excluded at render (lapsed plan) simply drops its providers; items with remaining providers
  still render; items with none are hidden.

---

## 7. Setup & management UX (host-curated catalogue builder)

All in `VenueCollectivesPanel` (or a dedicated `CombinedPageBuilder` sub-view), to the Apple bar of
§19 (modal/focus/toast/skeleton/a11y standards already established for this feature).

### 7.1 Turn it on

- On a collective (or at create), the host picks **Combined page (shared catalogue)** vs **Directory
  (list of venues)** — this is the explicit separate-vs-combined choice.
- Upgrading to `unified_catalog` runs the **D4 write-eligibility check** across all members; if any pair
  lacks mutual `create_edit_cancel`, show exactly which links to upgrade, with a deep link to the
  permission editor. Block until satisfied. Also runs the **D8 timezone** check.

### 7.2 Choose the address (D1)

- Radio: **New address** (live slug-availability check, existing `slug-available` endpoint) or **Use a
  member's existing booking link** (pick from member slugs). The adopt option shows the §5.3 warning
  and a preview of the resulting URL.

### 7.3 Build the catalogue

1. **Pull** every member's active `appointment_services` (+ the practitioners offering each) via the
   existing per-venue endpoints — the same data `ConfigureVisibilityModal` already fetches.
2. **Merge suggestions** — surface likely duplicates across venues (normalise name + compare duration
   within a tolerance; the existing exact-lowercase grouping is the floor, add fuzzy). Host accepts a
   suggestion → creates one `collective_service_item` mapping the matched source services as providers,
   or builds an item manually and adds providers.
3. **Per item:** set canonical name/description/category/order, `default_duration`, `default_price` +
   `pricing_display` (from/fixed/per-provider), and `allow_any_available`.
4. **Per provider (calendar):** choose which member calendars provide the item (all practitioners of a
   venue, or specific ones), and optionally override price/duration for that provider. Assigning a
   provider that belongs to **another** member raises that member's **approval** task (D6) unless the
   member has auto-accept on.
5. Unmerged services can be offered as single-provider items, or left off entirely.

### 7.4 Member consent surface (D6)

- Each member sees, in its Linked Accounts → Collectives view, the offerings that use **its** calendars
  with the proposed effective price/duration, and **Approve / Adjust / Reject** per provider row.
  "Adjust" lets the member set its own override (it always controls its own commercial terms).
- A member can enable **"auto-accept host-set pricing for this collective"** to skip the step. Default
  off (explicit consent). A provider is not bookable until approved.
- This keeps the brief's "host adjusts pricing/duration" while never letting one venue set another's
  price without a click — the sovereignty guarantee, surfaced as UX rather than a hard block.

### 7.5 Per-venue solo-page toggle (D2)

- Each member toggles `solo_page_behavior` (keep live / redirect). The slug donor sees the §5.3 framing.
- Live preview of what each member's `/book/{slug}` will do.

---

## 8. The split — elegant, non-destructive teardown (D5)

The headline requirement: *"whenever a link is broken, services must elegantly split again so each
venue goes back to what they were doing before."* This is guaranteed **by construction**, not by a
cleanup job, because **nothing is ever merged into a venue's own data** — all combined config lives in
`venue_collectives` / `venue_collective_members` / `collective_service_items` /
`collective_service_providers`, and bookings already belong to their owning venue.

### 8.1 Triggers (reuse the existing reconcile cascade)

`reconcileCollectivesAfterLinkChange` already fires on unlink / reduce / accepted-change / cron. We
extend `reconcileCollective` for `unified_catalog` mode to also check the **write** level (D4), not
just visibility.

### 8.2 Graceful degradation ladder

For a `unified_catalog` collective when a pair drops below mutual `create_edit_cancel`:

1. **Suspend affected providers.** Set `collective_service_providers.status='suspended'` for the
   venue(s) now unreachable. Items keep rendering with remaining providers; items with none go hidden.
   (Recoverable — restored if the link is restored, mirroring the suspend/resume model.)
2. **Remove a member** (link actually terminated, or member leaves/removed): set membership `removed`,
   cascade its providers to `removed`. Notify.
3. **Drop below 2 eligible members → dissolve.** `status='dissolved'`. Combined page shows the branded
   unavailable state; all redirects stop; the adopted slug reverts to the donor's solo page.
4. **Downgrade to directory** is offered to the host as an alternative to dissolution when write rights
   lapse but visibility remains (keeps a list-of-venues page alive).

### 8.3 What reverts automatically (the guarantee)

- **Each venue's own services, prices, durations, practitioners** — never changed, so nothing to undo.
- **Overrides** — collective-scoped rows; once the provider/collective is suspended/removed/dissolved
  they are simply **not applied**. Each venue's `/book/{slug}` shows its own catalogue at its own
  prices instantly.
- **Solo pages** — any member set to `redirect` returns to a live 200 page; the slug donor's slug
  serves its own solo page again.
- **Existing bookings** — stay in their owning venue with the price/duration the customer was quoted
  (recorded on the row). Ownership never moves (core principle #4 of the parent spec).
- **Attribution** — `collective_id` / `collective_service_item_id` remain on historical rows for
  reporting even after dissolution (no FK, matching today's pattern).

### 8.4 Idempotence & self-heal

All of the above is idempotent and re-checked on every public render and every reconcile, so a
half-applied teardown (e.g., cron lag) never leaves a wrong-priced or orphaned page live.

---

## 9. Mode transitions & guardrails

- **Directory → unified_catalog:** requires D4 write gate + D8 TZ; seeds the catalogue from existing
  `visible_*` config; non-destructive (can downgrade back).
- **unified_catalog → directory / dissolve:** allowed; catalogue rows are retained but unused
  (archived) so a re-upgrade restores them; or hard-removed on dissolve.
- **Changing the address** (dedicated ↔ adopt, or different donor): updates redirects atomically;
  always keeps `/book/c/{slug}` working as the fallback so the page is never unreachable mid-change.
- **A member toggling redirect↔live** never affects others.

---

## 10. Notifications (extend parent spec §9, reuse `notifyVenue` + the bell)

| Event | Channel | Recipient |
|---|---|---|
| Invited to a combined catalogue / provider-approval requested | in-app + email | member venue admins |
| Provider approved / rejected / price-adjusted by a member | in-app | host |
| Combined page went live / address changed / adopted your slug | in-app + email | all members (donor specially flagged) |
| Mode downgraded / member shed / collective dissolved (write lapse) | in-app + email | affected + remaining members |
| A combined booking landed in your venue ("any available" routed to you) | existing cross-venue write notice (§17) | owning venue |

All ride the existing `account_link_notifications` store + bell + per-venue email prefs — no new
channel. Add new `type` values; copy via the existing formatter.

---

## 11. Security, integrity & abuse

- **Authorisation:** host-only for structure (items, ordering, address, mode); member-only for its own
  provider commercial terms + approval + solo-page toggle. Reuse `resolveLinkAdmin` + host checks.
- **No price tampering:** a member's effective price is only ever its own override or a host *proposal*
  it approved — never silently host-set. Enforced in the API and asserted in tests.
- **Double-book safety:** write-time slot re-validation for "any available" (§6.4).
- **Slug safety:** can only adopt a *member's* slug; global `venues.slug` uniqueness prevents
  hijacking; reserved `c/` namespace untouched.
- **Render-time eligibility:** every public render re-checks member eligibility + provider bookability +
  write gate (no trust in stored `active`).
- **Rate-limit** catalogue mutation + the cross-venue availability fan-out (reuse `enforceLinkRateLimit`).
- **Audit:** catalogue changes and approvals append to `account_link_audit_log` (new action types);
  bookings already audit via the existing trigger.

## 12. Accessibility & polish (parent spec §19, non-negotiable)

The catalogue builder, provider/override editor, approval surface, and the customer combined flow all
meet §19: focus-trapped modals, toasts + inline errors, per-row busy, skeletons, keyboard-operable
provider/slot pickers, contrast-guarded branding, reduced-motion, mobile card fallbacks. A combined
offering shows its multi-venue origin without colour-only cues (chips/labels).

---

## 13. Edge cases the demanding-owner test must pass

1. Two venues with **identical** "Swedish Massage" at different prices/durations → host merges into one
   item, sets a single shown price, each venue's calendars provide it; bookings land correctly priced.
2. Host sets a 60-min duration on a venue whose source service is 45 min → calendar blocks 60 min;
   no overlap/availability bug.
3. "Any available" picks venue B; customer later asks venue A to cancel → A can (mutual write gate).
4. Member B lapses its subscription → B's providers vanish from the page within minutes; items with
   only B's providers hide; B reappears on restore — **B's own prices never changed**.
5. Link A↔B reduced below `create_edit_cancel` → combined page degrades (suspend or downgrade), never
   shows a stale or wrong-priced offering.
6. Collective dissolves → adopted slug reverts to the donor's solo page; redirected members go live;
   all overrides gone; existing bookings intact and correctly priced.
7. Two customers race for the same "any available" slot → one wins, the other is re-routed/reslotted,
   no double-book.
8. A member rejects a host-proposed price → that provider isn't bookable; the item still renders with
   other providers.
9. Host tries to adopt a non-member's slug, or a slug already adopted by another collective → blocked,
   non-disclosing error.

## 14. Testing strategy

- **pgTAP / RLS:** anon can read only bookable providers of active unified collectives; members read/
  write only their own provider rows; host-only structure writes; effective-value resolution.
- **Unit:** effective price/duration resolution; merge-suggestion matcher; write-eligibility gate;
  split/reconcile ladder (suspend → remove → dissolve → downgrade); slug-claim resolver; "any
  available" merge + tie-break + write-time revalidation; consent state machine (D6).
- **Integration/E2E:** upgrade to combined → build catalogue → member approves → adopt slug →
  customer books (specific + any-available) → row lands in owning venue at quoted price/duration →
  break link → page degrades → dissolve → donor slug + member solo pages restored, source data
  pristine.
- All gates green before ship (tsc, full unit suite, lint, `next build`); migrations applied to a real
  env + `npm run test:db` before GA (per the project's standing rule).

## 15. Phasing

- **Phase A — model + mode + gating + split.** Migrations (§4), `page_mode`/`slug_strategy`/
  `solo_page_behavior`, write-eligibility gate (D4), extend `reconcileCollective` ladder (§8). No UI
  yet; verify the split is non-destructive at the data layer.
- **Phase B — catalogue builder + consent.** Items/providers CRUD, merge suggestions, overrides,
  member approval (D6), host structure controls.
- **Phase C — routing + solo-page choice.** Slug resolver (§5), adopt/dedicated, 308 redirects,
  per-member toggle, SEO/canonical.
- **Phase D — customer combined flow.** `CombinedBookingFlow`, browse, pick-specific booking, effective
  price/duration on the row, branded unavailable state.
- **Phase E — "any available".** Cross-venue availability fan-out, tie-break, write-time revalidation,
  caching.
- **Phase F — polish.** §19 a11y pass, notifications, audit types, analytics/attribution reporting.

Each phase is independently shippable behind the existing `linkFeature` gate; directory collectives are
untouched throughout.

## 16. Pre-implementation verifications (cheap, do first)

- Confirm `create-multi-service` accepts an externally-supplied effective duration/price path (it
  already computes `durationMins` and `service_price_pence` per segment — confirm an override hook).
- Confirm deposit computation can run off the effective price (D7).
- Confirm the per-venue availability engine is callable in a fan-out without side effects (for §6.4).
- Confirm `getPublicVenueForBookBySlug` / `loadBookPublicLayoutData` can be reused per-provider.

---

## 17. Decision status

All design decisions D1–D8 are **settled** (brief + 2026-06-06 Q&A) — see §2. No open product
decisions block implementation; the only remaining pre-build work is the cheap code verifications in
§16 (override hooks in `create-multi-service`, deposit-on-effective-price, availability fan-out
reuse, slug-resolver reuse).


---

## 22. Revision (2026-06-06): the combined page must BE a single-venue experience

Live testing on the dev venues (Plus 1 + Light 3, both `unified_scheduling`) plus a fresh
code review changed the target. This section supersedes the customer-facing parts of §6/§7
and Phase D where they conflict.

### 22.1 What the review found

- The host-created collective **"Plus Light"** is in `page_mode='directory'` (the default) with
  **no catalogue built**, so the public page renders the directory flow.
- **"No services / no staff" root cause:** `loadPublicCollective` (the directory loader) queries
  `appointment_services` + `practitioners` directly — **empty for unified_scheduling venues**
  (their data lives in `service_items` / `unified_calendars`, exposed via `fetchAppointmentCatalog`).
  The combined-catalogue loaders were made model-agnostic in Phase F; **this directory loader was not.**
- **Architecture mismatch (the real issue).** Neither the directory flow (a *list of venues*) nor
  the Phase-D `CombinedBookingFlow` (browse offerings → pick a provider → mount that venue's own
  flow) looks like **one venue**. The requirement is: from the customer's side the combined page is
  indistinguishable from a normal single-venue booking page — one services list, one staff list, the
  standard pick-service → pick-staff → pick-time → details → pay journey.

### 22.2 Confirmed contract of the single-venue stack (what we reuse)

- `BookPublicLayout({ venue: VenuePublic, services, team })` renders the whole page (header, tabs
  Services/Team/About, the booking flow). Tabs are driven by `venue.booking_page_config`.
- `AppointmentBookingFlow` loads its catalogue from `/api/booking/appointment-catalog?venue_id=…`
  (shape: `{ practitioners: [{ id, name, services: [{ id, name, duration_minutes, price_pence,
  deposit_pence, payment_requirement, variants, addon_groups, … }] }] }`), availability from
  `/api/booking/availability?venue_id=…&date=…&service_id=…&practitioner_id=…|any_available=1`, and
  creates via `POST /api/booking/create`.
- **Single-venue hard-coding:** every URL + the create payload use `venue.id` from the prop; the
  create `venue_id` is always that one venue. A single flow instance cannot currently write to
  different owning venues per chosen practitioner. **This is the one core change required.**

### 22.3 Target architecture — the collective as a "virtual venue"

Render the **standard** `BookPublicLayout` + `AppointmentBookingFlow` for the collective, backed by
**collective-aware** catalogue / availability / create. The customer sees one venue.

- **Synthetic `VenuePublic`** built from the collective: `id = collectiveId`, `name`, `timezone`
  (the §D8 shared tz), `currency`, `booking_model = 'unified_scheduling'`, and a new collective-level
  `booking_page_config` (branding/tabs/etc., §22.4 G6).
- **Combined catalogue** (`/api/booking/appointment-catalog` collective-aware, or a sibling route):
  - `services` = the host-curated **offerings** (`collective_service_items`), `service.id = offering id`,
    `price/duration` = the **effective** values. So a service offered by calendars in both venues is
    **one** service in the list.
  - `practitioners` = the **union of provider calendars** across members, each carrying its **owning
    venue id**; each lists the offerings it provides.
- **Combined availability:** for `(offering, calendar)` resolve the provider → owning venue + real
  source service + effective duration → run the venue's existing engine. **"Any available" is the
  standard flow's existing `any_available` feature** across the offering's calendars (replaces the
  bespoke Phase-E endpoint for the in-flow case).
- **Combined create:** the chosen practitioner (calendar) carries its owning venue; `offering id +
  calendar → provider → real source service + owning venue + effective override`; the booking is
  written to the **owning** venue. **Core change:** `AppointmentBookingFlow` must resolve the create
  `venue_id` (and source `appointment_service_id`) from the chosen practitioner's owning venue, not
  the synthetic collective id. The Phase-D server override (`resolveCollectiveServiceOverride`) is
  reused here and the duplicate bespoke create path is retired.

This reuses variants, add-ons, deposits, Stripe, the account gate, waitlist, confirmation — all of it
— unchanged, which is what makes it world-class and consistent.

### 22.4 Work plan

- **G1 — Directory loader bug (quick).** Make `loadPublicCollective` model-agnostic via
  `loadVenueCatalogueData` so *any* collective renders services/staff for unified venues. (Interim;
  largely superseded by G5 for the combined experience.)
- **G2 — Virtual venue + collective-aware catalogue.** `loadCollectiveVenuePublic(collectiveId)` →
  synthetic `VenuePublic`. Collective-aware appointment-catalogue: offerings-as-services,
  provider-calendars-as-practitioners, owning-venue tags. Detect "id is a collective" (or accept an
  explicit `collective_id` param) before the `venues` lookup.
- **G3 — Collective-aware availability.** Resolve `(offering, calendar)` → provider → owning venue +
  source service + effective duration; reuse the engine; support `any_available` across the
  offering's calendars.
- **G4 — Collective-aware create + per-practitioner venue routing.** Thread the chosen practitioner's
  owning venue + real source service into the create payload; resolve the override server-side; write
  to the owning venue. Retire the bespoke combined create override duplication.
- **G5 — Render via `BookPublicLayout`.** Replace the bespoke `CombinedBookingFlow` (and directory
  `CollectiveBookingFlow` for the combined experience) with the standard layout fed by the synthetic
  venue + merged catalogue/team. `/book/c/{slug}` and the adopted-slug path both render it.
- **G6 — Single-venue-grade customisation.** Add `venue_collectives.booking_page_config jsonb`
  (mirrors `venues.booking_page_config`): brand colour/accent, font preset, logo + cover (crop,
  full-width), announcement, social links, gallery, about text, and the Services/Team/About tab
  toggles. Service photos on offerings (`collective_service_items.image_url`). Team profiles inherited
  from each member venue's own `team_profiles` (keyed by calendar id), with host hide/override.
  Builder UI gains a **booking-page editor** (reusing `BookingPageSection` patterns) + a **live
  preview** (like the single-venue dashboard).
- **G7 — Setup polish.** Let the host pick **Combined** at creation time (not just in the manager;
  default to Combined), surface the eligibility gate inline, and add guardrails/empty states.

### 22.5 Decisions — CONFIRMED (2026-06-06)

- **D-V1 — Combined-only.** Directory mode is **dropped**. Every collective is a single combined
  booking page that looks like one venue. Existing directory collectives are migrated to combined;
  the create flow always creates combined; the directory public path + `CollectiveBookingFlow` are
  retired.
- **D-V2 — Host-curated identity + inherited staff bios.** The host curates the page identity at the
  collective level (name, logo, cover, colours, fonts, about, tab toggles, service photos per
  offering). Staff **bios/photos are inherited** from each member venue's own `team_profiles` (keyed
  by calendar id), with host **hide/override**. Stored in a new
  `venue_collectives.booking_page_config jsonb` mirroring `venues.booking_page_config`.

### 22.6 Net effect on earlier phases

Phase D's `CombinedBookingFlow` and the standalone `/api/public/collective-availability` (Phase E)
become **internal/secondary**: the in-flow experience is the standard stack (G2–G5). The Phase-A/B
data model (offerings + providers + overrides + consent) and the Phase-C slug routing are unchanged
and underpin the virtual venue. The Phase-F notifications/consent loop are unchanged.

---

## 23. Venue-collective setup UX review & world-class redesign (2026-06-07)

Full review of the three host/member forms in `/dashboard/settings?tab=linked-accounts`
→ Venue collectives: **Manage combined page** (`CombinedPageManager`), **Edit settings**
(`EditCollectiveModal`), **Configure my listing** (`ConfigureVisibilityModal`).

### 23.1 Broken / unneeded / vestigial (remove)

- **"Configure my listing" is obsolete + doubly broken.** It edits `visible_practitioner_ids`
  / `visible_service_ids` / `display_order` — the **directory-era** per-member visibility model
  the combined page no longer uses (the page is driven by the host-curated offerings+providers).
  It also fetches `/api/venue/practitioners` + `/api/venue/appointment-services` which are **empty
  for unified venues**. Net effect: zero. **Remove it**; the member's real controls (approve/adjust
  provider terms + solo-page behaviour) already live in Manage combined page's member view.
- **"Edit settings" → Service grouping** (`by_practitioner`/`by_service_type`): vestigial — the
  standard `BookPublicLayout` doesn't use it. **Remove.**
- **"Edit settings" → "Any available practitioner (coming soon)"**: stale + misleading — any-available
  IS built (per-offering `allow_any_available`). **Remove.**
- **Redundant/conflicting branding.** `branding.primary_colour` + `branding.description` overlap
  `booking_page_config.brand_primary` + `about`. The live page reads `booking_page_config`; the
  unavailable state + row colour-dot read `branding.primary_colour` → two sources of truth.
  **Unify on `booking_page_config`** (+ `branding.logo_url` for the logo), and have the
  unavailable/row read it too.

### 23.2 Too narrow / scattered (consolidate)

Setup is spread across 5 surfaces (panel row + 4 modals). **Consolidate into ONE tabbed
"Manage combined page"**: **Page** (name, logo/cover upload, brand colour/accent, font, about,
announcement, tab toggles, address, live preview) · **Services & calendars** (picker + offerings +
cross-venue calendar assignment, reorder, rename/description, price/duration/photo) · **Members**
(invite/remove/make-host/transfer — moved out of the row) · **My listing & approvals** (member view:
approve/adjust/reject provider terms + solo-page). Retire **Edit settings** + **Configure my listing**.

### 23.3 Missing (add)

- **Cross-venue calendar assignment (the headline gap).** Today providers are added one at a time,
  service-first (`venue → service → practitioner`). Replace with a **calendar-centric** per-offering
  control: "Which calendars offer this?" → all member calendars grouped by venue, multi-select.
  A calendar whose venue lacks the offering still books via a **carrier service** in its own venue
  (same-named auto-mapped; else host picks). So "offer Haircut on calendars from venue A *and* B"
  even when B has no Haircut. The offering's name/price/duration apply.
- **Host edit of provider price/duration** after adding (API `update_provider` exists; no UI; re-consent on change).
- **Offering rename + description edit**, **reorder offerings** (display_order has no UI), explain `pricing_display`.
- **Image uploads** for logo/cover/offering photos (reuse the venue `BookingPageSection` upload components) instead of URL paste.
- **Inline live preview pane** (not just a "Preview ↗" link), mirroring the single-venue booking-page editor.
- **Sidebar link.** Show the collective's dedicated booking-page link in `DashboardSidebar` (below
  "Your Booking Page", lines 552–562), when the venue is an active member of an active collective with
  a dedicated address (or that adopted this venue's slug). Link → `/book/c/{slug}` (or `/book/{adopted}`).

### 23.4 Build order

1. **Cross-venue calendar assignment** + carrier-service resolution (data flow already supports it).
2. **Sidebar collective link** (server-passed collective links → DashboardSidebar).
3. **Consolidation**: fold Edit settings + Configure my listing into the tabbed Manage combined page;
   remove vestigial fields; unify branding on `booking_page_config`.
4. **Polish**: reorder, rename/description, host provider edit, uploads, inline preview.

### 23.5 Decisions to confirm
- IA: consolidate the three forms into one tabbed surface (recommended) vs fix-in-place.
- Carrier service for a cross-venue calendar with no matching service: host picks the carrier
  (same-name auto-default) — recommended — vs auto-any vs restrict to same-named only.
