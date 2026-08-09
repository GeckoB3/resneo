# Staff-first booking flow: implementation plan

Status: FINAL (revision 4, 2026-08-09). Four rounds of adversarial review by three independent
reviewers (code accuracy, guest UX parity, QA/rollout); 60 round-1 findings, 21 round-2, 17
round-3, and 2 round-4 cosmetic nits, all incorporated. Final verdicts: all three reviewers
CONFIDENT. Ready for implementation.
Baseline commit `38a7f64f` (staging = main = origin, verified clean).
Owner decisions already made: combined pages inherit the host venue's toggle; default stays
service-first; both orderings must be equally fully functional.

Revision 2 changes in brief: two missed group-flow forward handlers added (they were a blocker);
combined "Any available" redesigned to keep full catalogue parity; a fully-booked-person recovery
path added; add-ons render scoping task added; editor-preview claim corrected (it mounts the real
flow); baseline component characterisation suite made mandatory and written before any rewiring;
e2e fixture strengthened to two calendars with variants and add-ons; rollout restructured into a
dark PR plus a later self-serve PR; rollback and cache propagation get rehearsal steps; QA matrix
made executable with explicit flag states and a dev/staging split; effort re-estimated.

Revision 3 changes in brief: the combined ANY non-uniform route is now fully specified as a
call-site sub-path that consults the helper's combined service-first cells (no throwing cells on
a guest path, Back defined, ANY selection restored); the combined ANY card regains its
uniform-offering gate; the fully-booked recovery is redesigned to land on the new person's
service list (honest pricing, no conditional deep-routing, explicit carried-service state);
permitted flag-off deltas are now an explicit list wired into the acceptance criteria; the 1b
suite gains a divergent-add-on-groups combined fixture, an explicit walk boundary, and an honest
budget; the e2e seed keeps the existing venue's current services untouched but adds one
variants+add-ons service for the new flag-off spec; Phase 8 (PR 2) gets its own checklist; QA
rows M14-M16 pinned to the correct flag state; assorted copy and reference fixes.

Revision 4 changes in brief: `anyRouteActive` now clears on EVERY transition to `staff_pick`,
including the 4.12 recovery (the one blocker all three round-3 reviews converged on), with the
walk and QA assertions to match; the 4.3 invariant rescoped so sub-path walks cannot trip it; a
one-line notice when a recovered guest's new person does not offer the carried service; the
group flow's exclusion from 4.12 recorded as accepted; decision 10(b) now names the Meet-the-team
tab reorder; AC1 no longer cites the flag-on rows M14-M16; Phase 3 re-budgeted to 1.5 days; a
flag-off reset walk added to 1b.3; Phase 8 gains the deny-removal item; stale pointers repointed
and the settings card copy tightened.

---

## 1. Product definition

### 1.1 What we are building

A per-venue setting, "Staff-first booking", off by default. When a venue turns it on, the public
booking flow asks the guest to choose a team member first, then shows that person's services.
When it is off, nothing changes anywhere.

| Toggle state | Public single flow | Public group flow | Combined (collective) page |
|---|---|---|---|
| Off (default) | service → variant → add-ons → practitioner → slot | per person: service → variant/add-ons → practitioner → slot | service → calendar → variant → add-ons → slot |
| On | **staff → service → variant → add-ons → slot** | per person: **staff → service → variant/add-ons → slot** | **calendar → service → variant → add-ons → slot** |

Note the unification: with the toggle on, the single-venue flow and the combined flow share the
same ordering (person first, then their catalogue). The combined page already resolves variants
and add-ons after the calendar is chosen, so staff-first aligns the two surfaces rather than
adding a third shape.

### 1.2 Surfaces that never change, in either toggle state

| Surface | Why it keeps the current order |
|---|---|
| Per-practitioner pages `/book/{venue}/{practitioner-slug}` (`isLockedPractitionerFlow`) | Already staff-first by construction; the person is fixed before the flow starts. |
| Staff dashboard booking modal (`bookingAudience === 'staff'`) | Staff usually book from a calendar column where the practitioner is implied; changing staff muscle memory is out of scope. |
| Edit flows (guest self-reschedule via `/manage`, staff edit modal; `editBooking` set) | Edits start from the existing booking and preserve its practitioner. Ordering is irrelevant. Note: the manage surface passes `preselectedPractitionerId` publicly (`ManageBookingView.tsx:511`) but always alongside `editBooking`, so it is service-first by 4.1 regardless. |
| Class, event, and resource flows | Different flow components entirely (`ClassBookingFlow`, `EventBookingFlow`, `ResourceBookingFlow`); no practitioner-choice step of this kind. |
| Booking flows entered with a preselected service (`preselectedServiceId` prop present) | Today this means waitlist-offer links (which always carry `service_id`, plus date and time) and any hand-built `?service_id=` marketing link. These sessions run service-first even when the toggle is on. See 4.1 and 4.8 for the accepted caveats. |
| The appointment waitlist join sheet | It is a compact form, not the step flow; its internal field order (service before person) stays as is. Accepted. |

### 1.3 Setting semantics

- Feature flag key: `staff_first_booking_flow`. Stored in `venues.feature_flags` JSONB, `true` when on, key absent when off (standard pattern).
- Resolution: env override `FEATURE_FLAG_STAFF_FIRST_BOOKING_FLOW` wins, then venue value, then default `false`. Identical to every other flag in `src/lib/feature-flags/resolve.ts`.
- Combined pages: the synthetic collective venue inherits the **host venue's** resolved value, exactly like `any_available_practitioner` does today (`loadCollectiveVenuePublic`, `src/lib/linked-accounts/collective-venue.ts:74-79` and `:132`).
- Settings UI: **owner decision, 2026-08-09, superseding the two-stage plan below.** The toggle ships with the feature, in Settings → Booking settings → "Optional Booking features" (`FeatureFlagsSection`, rendered from `SettingsView` on the `booking-settings` tab; the plan previously said Profile, which was wrong). Every venue can turn it on and off for themselves whenever they like, and it stays off until they do. The dark-launch staging in 7.3 no longer applies; see the note there.

---

## 2. Verified architecture map (current behaviour, with anchors)

All line numbers are at baseline commit `38a7f64f`. Every anchor in this section was verified by
an independent reviewer against the code.

### 2.1 The flow component

`src/components/booking/AppointmentBookingFlow.tsx` (5,068 lines) is a hand-rolled step machine.

- Step union: line 441-445. Single steps: `mode_choice`, `service`, `variant`, `addons`, `append_variant`, `practitioner`, `slot`, `multi_service`, `details`, `payment`, `confirmation`. Group steps: `group_person_label`, `group_service`, `group_variant`, `group_addons`, `group_practitioner`, `group_slot`, `group_review`, `group_details`, `group_payment`, `group_confirmation`.
- `SINGLE_STEPS` / `SINGLE_STEPS_LOCKED`: lines 447-448. Used only to decide when the locked-practitioner banner shows (line 2731).
- Mode booleans: `isStaff` (567), `isPublicGuest` (577), `isEdit` (579), `isLockedPractitionerFlow` (626-628), `isCombined = Boolean(venue.is_collective)` (1545).
- Initial step (652-660): `editBooking || isLockedPractitionerFlow || isStaff || venue.is_collective || initialStep === 'service'` → `'service'`, else `'mode_choice'`.
- Reset event handler (856-862): same fork; also re-pins `selectedPractitionerId` for the locked flow.
- Catalog fetch (880-897): `GET /api/booking/appointment-catalog?venue_id=…[&practitioner_slug=…]` returns `{ practitioners: CatalogPractitioner[] }`, each with `services[]` carrying per-practitioner `price_pence`, `duration_minutes`, `variants[]`, `addon_groups[]`, `location_type`, `payment_requirement` (shape: lines 319-357). **The full data needed for staff-first is already on the client in both toggle states.**
- Preselection effects: `preselectedServiceId` (909-915), `preselectedPractitionerId` (917-922; returns early for edits and locked flows).
- Prefetch effect (1230-1292): three branches keyed on step: `practitioner` + selected service (1234-1254, includes an any-available pooled prefetch), locked-flow `service` step (1255-1265, prefetches the fixed practitioner's calendars per service), `group_practitioner` (1266-1272).
- **Single-service warm-cache effect (1460-1483)**: fires on any non-locked `service` step when exactly one service is listed and prefetches month grids for ALL practitioners. Interacts with staff-first; see 4.9 for the gating decision.
- Slot availability + month calendar effects (1192-1224, 1299-1368): keyed on `(service, practitioner)` pairs; order-agnostic.
- Derived service list `servicesWithFromPrice` (1404 onward): folds over all `catalogStaff`, min price across practitioners.
- Scoped catalogue helpers: `catalogVariantsForServiceId` (136), `catalogVariantsForServiceFromStaff(catalogStaff, serviceId, practitionerId)` (149, falls back to the generic lookup when the practitioner id is the any-available sentinel or unknown), `catalogAddonGroupsForServiceId` (164, generic first-match), the practitioner-scoped memo `addonGroupsForSelectedService` (1558-1566, currently unused by the add-ons render; see 4.2 and Phase 2), `addonSelectionDetails(catalogStaff, serviceId, addonIds, practitionerId?)` (~199-219, practitioner-scoped when given).
- Progress indicator: `appointmentProgressPhase(step)` (`src/components/booking/appointment-public-ui.tsx:73-97`), sets of step names in three phases.

### 2.2 Ordering-sensitive handlers (the exact edit sites)

Single flow:

| # | Site | Lines | Current behaviour |
|---|---|---|---|
| S1 | `mode_choice` render | 2750-2779 | "Book an appointment" → `service`; "Group appointment" → `group_review`. |
| S2 | `service` back link | 2787-2796 | → `mode_choice` (hidden for locked/edit/staff/combined/`initialStep === 'service'`). |
| S3 | `navigateFromServiceRow` | 2832-2871 | combined → `practitioner`; variants → `variant`; add-ons → `addons`; **edit's practitioner-or-slot branch (2854-2866) sits AFTER the variant/add-on checks**; locked → prime + `slot`; else → `practitioner`. |
| S4 | `variant` back | 3014-3029 | combined → `practitioner`; locked clears service; → `service`. |
| S5 | variant select (public copy) | 3054-3095 | combined: add-ons or prime+`slot`; add-ons → `addons`; staff-calendar-prefill path; locked prime+`slot`; else `practitioner`. |
| S5b | variant select (staff-only copy `navigateFromVariantRow`) | 3119-3149 | staff duration-editor variant path; staff is always service-first, but the rewiring must not disturb it. |
| S6 | `advanceFromAddons` | 3291-3339 | append/edit segment → `multi_service`; staff prefill; locked or combined prime + `slot`; **else `practitioner`, including edit sessions (there is no edit short-circuit in this handler)**. |
| S7 | `addons` back | 3344-3358 | segment-edit → `multi_service`; combined → `variant` or `practitioner`; else `variant` or `service`. |
| S8 | `practitioner` back | 3479-3520 | combined → clear + `service`; add-ons → `addons`; variants → `variant`; edit → `service`; else clear + `service`. |
| S9 | `practitioner` any-available card | 3542-3573 | gated on flag + >1 offering practitioners + `!isEdit` + (`!isCombined || selectedOfferingAnyAvailable`); primes ANY and → `slot`. |
| S10 | practitioner card select | 3574-3622 | primes calendar; combined resolves that calendar's variants/add-ons next; else `slot`. |
| S11 | `slot` back (public + staff copies) | 3630-3663, 3666-3703 | combined: add-ons → variant → `practitioner`; locked: variants or `service` (**skips add-ons today, see 4.11**); else → `practitioner`. |
| S12 | `multi_service` back / add-another | 3838-3947 | back → `slot`; extra services listed from `visitPractitioner.services` (already practitioner-scoped). |

Group flow:

| # | Site | Lines | Current behaviour |
|---|---|---|---|
| G1 | group person label Continue | 4537-4543 | → `group_service`. |
| G2 | `group_service` back | 4550-4552 | → `group_person_label`. |
| G3 | **`group_service` select** | 4571-4581 | sets `groupServiceId`, clears variant/add-ons, routes `hasVariants ? 'group_variant' : hasAddons ? 'group_addons' : 'group_practitioner'`, calls `queuePrefetchForServicePractitioners`. |
| G4 | **`group_variant` select** | 4628-4632 | `setStep(groupHasAddons ? 'group_addons' : 'group_practitioner')`. |
| G5 | **`group_addons` Continue** | 4791-4794 | → `group_practitioner`. |
| G6 | `group_practitioner` back | 4809-4818 | add-ons → variants → `group_service`. |
| G7 | `group_practitioner` select | 4839-4866 | primes + → `group_slot`. No pooled any-available card exists in the group flow. |
| G8 | `group_slot` back | 4875-4877 | clears practitioner → `group_practitioner`. |

(G3, G4, G5 were missing from revision 1 and are the reason staff-first group bookings with
variants or add-ons would have routed back into `group_practitioner`. They are now first-class
edit sites in Phase 4.)

### 2.3 Flag plumbing (all mechanical, all with an existing sibling to copy)

| File | What is there today |
|---|---|
| `src/lib/feature-flags/types.ts` | `APPOINTMENTS_FEATURE_FLAG_KEYS` (10-17), zod schema (22-34). |
| `src/lib/feature-flags/resolve.ts` | `ENV_BY_FLAG` (9-16), `FLAG_DEFAULT_ON` (19-21), generic merge/storage loops (80-141): adding a key to the const array + schema is sufficient for persistence. |
| `src/app/api/venue/feature-flags/route.ts` | GET/PATCH are generic over the schema; no change needed. |
| `src/app/dashboard/settings/sections/FeatureFlagsSection.tsx` | `FLAG_META` card list (17-52); section heading is "Optional Booking features" (218-221; `FEATURE_FLAGS.md` calls it Beta features, align wording when the card ships). |
| `src/lib/booking/get-public-venue-for-book.ts` | **The actual public loader**: `/book/[venue-slug]`, `/book/[venue-slug]/[practitioner-slug]`, and `/embed/[venue-slug]` all load the venue through it (line 38 maps flags via `mapVenueFeatureFlagsForPublic`). |
| `src/app/api/booking/venue/route.ts` | Builds an explicit `resolved` subset (70-74). No in-repo consumer (external-facing only); still updated for consistency. |
| `src/lib/booking/venue-public-feature-flags.ts` | `mapVenueFeatureFlagsForPublic` explicit subset (35-48); feeds the public loader above, GET `/api/venue`, linked venue-profile, `buildVenuePublicForBookingById`, and `venueSettingsToPreviewPublic` (editor preview). |
| `src/components/booking/types.ts` | `VenuePublic.feature_flags.resolved` optional keys (49-60). |
| `src/lib/linked-accounts/collective-venue.ts` | Host-flag inheritance precedent (68-79, 132). |
| `src/lib/linked-accounts/collectives.ts` | `CollectiveView.hostAnyAvailablePractitioner` declared (122) and computed (287-289, 316); the sibling field for the new flag is added here. |
| `src/lib/linked-accounts/collective-settings-to-preview-public.ts` + caller `src/components/linked-accounts/CombinedPageManager.tsx:457,465` | Collective editor preview passes the host value through today. |
| `src/app/super/flags/FlagsPageClient.tsx` | Enumerates keys dynamically with a manual label map; add a label. This page is the pilot enablement lever (7.3). |
| `Docs/FEATURE_FLAGS.md`, `Docs/Embed_Public_Booking_URL_Contract.md`, `Docs/E2E_SMOKE.md`, `e2e.env.example`, `.github/workflows/ci.yml` | Docs and harness surfaces that reference flags, the `?start=service` contract, and the e2e fixture contract. All in the checklists below. |

**Correction from revision 1**: the in-dashboard editor preview mounts the REAL interactive flow,
not just the landing page (`InlineBookingPreview.tsx:38` → `BookPublicLayout.tsx:296` →
`BookPublicPageContent.tsx:291-299` mounts `BookPublicBookingFlowSuspense`). With the flag on, the
venue editor preview and the collective editor preview will correctly show the staff-first
ordering. That is desired behaviour; QA row M19 asserts it.

### 2.4 Collective specifics

- Catalog for a collective id is served by `loadCollectiveAppointmentCatalog` (`collective-venue.ts:189-380`) in the same `{ practitioners }` shape; calendars with zero services are dropped (358); duplicate staff names get venue-qualified (361-377). Practitioner order is currently Map-insertion order, offering-major (296-356): effectively arbitrary. Phase 3 adds a deterministic sort (4.7).
- Per-offering `any_available` (287-293): true only when no provider has variants/add-ons.
- On combined pages, each calendar's offer of the same offering id carries its OWN `variants` and `addon_groups` (`collective-venue.ts:348-349`); resolving them through generic first-match helpers is unsafe there (see 4.2's add-ons task).
- The synthetic venue merges member `team_profiles` into `booking_page_config` (90-109), so staff photos are available to the flow on combined pages too.
- Group bookings are unreachable on combined pages (initial step for `is_collective` skips `mode_choice`).
- `CollectiveCrossSuggestion` renders in the `slot` step's no-availability empty state on MEMBER venue pages, gated on `!collectiveId` (3819-3823). It links guests to the combined page, whose ordering follows the HOST's flag; a member with the flag on whose host has it off produces an order flip after a dead end. Accepted; QA row M23 covers it.
- Context note: the collective's own `allow_any_practitioner` column was dropped as dead; do not resurrect per-collective storage.

### 2.5 Test infrastructure (verified)

- Vitest (`npm test`), colocated `*.test.ts(x)`; `vitest.config.ts` sets `environment: 'node'` globally, so component tests need the `/** @vitest-environment happy-dom */` pragma (precedent: `BookingDetailSurface.test.tsx:1`); `@testing-library/react` is installed.
- Playwright (`npm run test:e2e`): suite is deliberately serial (`playwright.config.ts:17,20`: `fullyParallel: false`, `workers: 1`). Specs: `e2e/appointment-book-pay-confirm.spec.ts`, `e2e/guest-self-reschedule.spec.ts`; helper `e2e/helpers/book-appointment.ts` (tolerates the practitioner step being present or absent, lines 44-54; details/payment section is inline at 64-84 and needs extraction for reuse). Specs skip when `E2E_VENUE_SLUG` is unset (`e2e/helpers/env.ts:10,24`; `global-setup.ts:12-18`).
- CI: the e2e job is opt-in (`.github/workflows/ci.yml:80`: `if: vars.RUN_E2E_SMOKE == 'true'`) with an explicit env allowlist (109-133). CI concurrency is per-ref (9-11), so staging and main runs can hit the same Supabase fixtures concurrently.
- Seed (`npm run seed:e2e-smoke`, `scripts/seed-e2e-smoke-venue.mjs`): single-venue by structure (module-level slug consts 27-34; `ensureService` closes over venue/calendar 128-184); creates ONE calendar (101-125) and two plain services, no variants, no add-ons (187-198). Venue update overwrites `feature_flags` wholesale (76-91).
- Dev fixtures for manual checks: live collective at `/book/c/plus-1`.

---

## 3. Locked design decisions

1. One flag on the venue; combined pages inherit the host venue's value. No per-collective setting.
2. Default off; no behaviour change for venues that do nothing, EXCEPT the three permitted flag-off deltas in decision 10. The proof is the Phase 1b characterisation suite (written at baseline, kept green except where a permitted delta updates its assertion in the same commit) plus the unmodified existing e2e specs plus a new flag-off variants+add-ons e2e.
3. Staff-first applies to: public single flow, public group flow, combined page. Never to: staff audience, edit flows, locked pages, class/event/resource flows.
4. Sessions that begin with `preselectedServiceId` run service-first even when the flag is on. The decision is made at mount from prop presence (not validity); a stale `service_id` link therefore also runs service-first. Accepted and documented (4.8).
5. No new API endpoints, no schema migrations, no availability-engine changes. Two additive server-side payload changes only: the flag in existing venue payloads, and `owning_venue_name` + deterministic ordering in the collective catalogue (4.7).
6. Do not fork `AppointmentBookingFlow`; extend it following the `isCombined` / `isLockedPractitionerFlow` precedent.
7. New dedicated step ids (`staff_pick`, `group_staff_pick`) with their own render blocks; the existing `practitioner` / `group_practitioner` steps are not reused for the picker (they assume a selected service in their filtering, banner, pricing, and prefetch). The `practitioner` step IS reused for the combined any-available non-uniform-offering path (4.5), where a service is selected.
8. Ordering decisions move to a pure helper module with exhaustive unit tests over its expressible domain, and a mandatory component-level characterisation suite (written BEFORE rewiring) binds the component to the helper. The helper's scope and its explicit non-goals are specified in Phase 1.
9. Naming: the pooled option is called "Any available" in both orderings (same title and subtitle as today's card). Revision 1's "No preference" label is dropped to avoid two names for one concept.
10. **Permitted flag-off deltas (exhaustive list).** This feature deliberately ships exactly three flag-off behaviour changes, each an improvement, each updating its Phase 1b characterisation assertion IN THE SAME COMMIT as the behaviour change with the delta named in the commit message. Anything else that forces a baseline test to change is a regression by definition. The list: (a) the 4.2/Phase 2.7 add-ons render scoping fix, which on combined pages with divergent per-calendar groups makes the DISPLAYED extras match the charged ones in both toggle states; (b) the 4.7 deterministic combined practitioner ordering, which also orders today's service-first combined practitioner step AND the combined page's "Meet the team" tab (`loadCollectiveTeam` maps the same catalogue, `collective-venue.ts:412-418`); (c) the 4.11 locked-flow slot-Back unwind, if taken at PR time. AC1 and AC6 reference this list.

---

## 4. Target behaviour specification

### 4.1 New state and derivations

```
orderingForSession: 'service_first' | 'staff_first'
```

Computed once per mount (not reactive mid-flow; document why in code):

```
staffFirstConfigured = venue.feature_flags?.resolved?.staff_first_booking_flow === true
orderingForSession = staffFirstConfigured
  && isPublicGuest
  && !isEdit
  && !isLockedPractitionerFlow
  && !preselectedServiceId          // waitlist offers and service_id deep links
  ? 'staff_first' : 'service_first'
```

`isStaff` implies `isPublicGuest === false`, so the staff surface is excluded by construction.
The flag applies to both `isCombined` and plain venues (same value, host-inherited for
collectives).

### 4.2 Single flow, staff-first (venue and combined), forward transitions

| From | Guest action | To | Side effects |
|---|---|---|---|
| `mode_choice` (venue only; combined skips it) | Book an appointment | `staff_pick` | none |
| `mode_choice` | Group appointment | `group_review` | unchanged |
| `staff_pick` | picks person P | `service` | `setSelectedPractitionerId(P)` |
| `staff_pick` | picks "Any available" (gating: 4.5) | `service` | `setSelectedPractitionerId(ANY_AVAILABLE_PRACTITIONER_ID)` |
| `service` | picks service S | `variant` if P's offer of S has variants; else `addons` if it has add-on groups; else prime(P,S) + `slot`. Combined ANY path: see 4.5. | `setSelectedServiceId(S)`; clear variant/add-on state |
| `variant` | picks variant V | `addons` if scoped add-on groups exist; else prime(P,S,V) + `slot` | `setSelectedVariantId(V)` |
| `addons` (primary context) | Continue | prime(P,S,V,add-ons) + `slot` | existing `advanceFromAddons` |
| `slot` → onward | unchanged | `multi_service` / `details` / `payment` / `confirmation` | unchanged |

Scoping rules on `service`, `variant`, `addons` in staff-first:

- Service list = the chosen practitioner's own `services` array (their names, their exact `price_pence`, their durations), sorted by `sort_order`. Not `servicesWithFromPrice`. For ANY, use `servicesWithFromPrice` (min across staff, "from" formatting), which is what service-first shows today.
- Variants = `catalogVariantsForServiceFromStaff(catalogStaff, S, selectedPractitionerId)` (existing helper; already falls back to the generic lookup for ANY).
- Add-on groups: **corrected from revision 1.** The combined flow today only ROUTES on the chosen calendar's groups (3596-3604); the `addons` render itself resolves displayed groups, totals, and validation via the generic first-match `catalogAddonGroupsForServiceId` (3233-3235), ignoring the scoped memo `addonGroupsForSelectedService` (1558-1566). On combined pages two calendars can carry different groups for the same offering id, so the render can show another calendar's extras, which `buildSegmentFromSlotPick` then silently drops (1696-1698). **Phase 2.7 is an explicit task: the primary-context `addons` render resolves groups from the practitioner-scoped memo (with the existing generic fallback for ANY and for single venues, where groups are keyed by service id and identical across staff), AND the append/edit segment contexts resolve groups from the segment's practitioner** (their charged math is already scoped: `handlePickAdditionalService` passes `visitPractitioner.id` at 1962 and `applyAddonsToSegment` passes `seg.practitionerId` at 2009, while the render at 3221-3235 stays generic today). This fixes the latent combined display/math divergence for the primary AND multi-service contexts, and gives staff-first correct scoping. It is permitted flag-off delta (a) in decision 10.
- Price shown per service row: that practitioner's price; "from" prefix only when the service has variants (min variant price), mirroring current semantics.

### 4.3 Single flow, staff-first, back transitions

| From | To | State cleared on the way |
|---|---|---|
| `staff_pick` (venue, normal entry) | `mode_choice` | selection state |
| `staff_pick` (venue, `initialStep === 'service'` entry) | back link hidden (mirrors 2787) | n/a |
| `staff_pick` (combined) | back link hidden: it is the first step | n/a |
| `service` | `staff_pick` | `selectedPractitionerId`, `selectedServiceId`, variant, add-ons |
| `variant` | `service` | `selectedVariantId` (keep practitioner) |
| `addons` | `variant` if variants else `service` | add-on selection; when landing on `service` also clear `selectedServiceId` + `selectedVariantId`; keep practitioner |
| `slot` | `addons` if add-on groups else `variant` if variants else `service` | `selectedTime`, `multiServiceSegments`; keep practitioner; clear service/variant only when landing on `service` |
| `multi_service` | `slot` | unchanged |

Invariant (asserted by a component test): **outside the combined ANY sub-path, the chosen
practitioner survives every staff-first Back except `service` → `staff_pick`. Inside the
sub-path (4.5), navigation follows the combined service-first cells, which may transiently null
the practitioner exactly as they do today (for example the slot step's no-options unwind,
3645-3646), and exiting the sub-path via Back restores the "Any available" selection (the ANY
sentinel, never null) on the full ANY service list.**

### 4.4 Group flow, staff-first (venue pages only)

Forward:

| From | Action | To | Notes |
|---|---|---|---|
| `group_person_label` | Continue | `group_staff_pick` (new) | |
| `group_staff_pick` | pick person | `group_service` | their services, their prices |
| `group_service` | pick service (edit site G3) | `group_variant` if the chosen person's offer has variants; else `group_addons` if it has add-on groups; else prime + `group_slot` | scoped to the chosen person |
| `group_variant` | pick variant (edit site G4) | `group_addons` if scoped add-on groups; else prime + `group_slot` | **was missing in revision 1** |
| `group_addons` | Continue (edit site G5) | prime + `group_slot` | **was missing in revision 1** |
| `group_slot` | pick time | `group_review` (existing add-person path, unchanged) | |

Back:

| From | To | State |
|---|---|---|
| `group_staff_pick` | `group_person_label` | |
| `group_service` | `group_staff_pick` | clear `groupPractitionerId`, `groupServiceId` |
| `group_variant` | `group_service` | clear variant |
| `group_addons` | `group_variant` if variants else `group_service` | clear add-ons; clear service when landing on `group_service` |
| `group_slot` | `group_addons` / `group_variant` / `group_service` | keep practitioner |

Copy and context banners (terminology-aware, no em-dashes):

- `group_staff_pick` header: "Choose {terms.staff.toLowerCase()}" with description "Who should see {label}?" (matches the existing group practitioner step at 4829). It also renders the purple person-context strip showing "{label}", like every other group step (4554-4556 pattern), so the picker is not the odd one out.
- Banner on `group_service`: "{label} · {staff name}".
- Banner on `group_variant`, `group_addons`, `group_slot`: "{label} · {staff name} · {service name}".

No pooled "Any available" card in the group picker: the service-first group flow has no pooled
option either (verified 4838-4867), so parity holds.

The existing `group_service` → `group_variant`/`group_addons` → `group_practitioner` service-first
chain is untouched when the flag is off.

### 4.5 "Any available" on `staff_pick`

Card: identical title and subtitle to today's card ("Any available" / "First available time
across the team", 3566-3567), shown at the top of the picker when ALL of:

1. `anyAvailablePractitionerEnabled` (venue flag; host's flag on combined), and
2. more than one practitioner is listed on the picker, and
3. on combined pages only: at least one offering has `any_available === true` (restored in
   revision 3; without it a collective with zero uniform offerings shows a card whose promise is
   never kept even once, and service-first parity breaks because those guests never see an ANY
   card today, 3542).

The gate is the pure helper function `anyAvailableCardVisible(shape, { flagOn, listedCount,
hasUniformOffering })`; `hasUniformOffering` is always true for `surface: 'venue'`.

Known, accepted divergence from service-first (documented here deliberately): service-first gates
its card per selected service (`practitionersForSelectedService.length > 1`, 3542); the picker
gate is page-level, so a guest can run a pooled search for a service only one person offers. The
pool has one member and resolves trivially. QA row M9 covers it.

After choosing "Any available":

- **Venue pages**: `service` step lists `servicesWithFromPrice` (all services, "from" prices), then variant/add-ons via the generic lookups, then pooled slot search. Same data path service-first uses for ANY today; only the visit order changes.
- **Combined pages**: the `service` step lists ALL offerings (no filtering). Picking an offering with `any_available === true` keeps the pooled practitioner and proceeds to slot (uniform offerings have no variants/add-ons by construction, 287-293). Picking a non-uniform offering enters the **ANY sub-path** below. Revision 1's filtered-list rule stays dropped: it hid offerings with no recovery path.

**The combined ANY sub-path (fully specified in revision 3).** Picking a non-uniform offering
after "Any available" routes to the EXISTING `practitioner` step scoped to that offering (a
service is selected at that point, which is that step's contract), with one shortened hint line
above the list: "This service is a little different for each {terms.staff.toLowerCase()}." (The
step's own header below it already asks "Who would you like to see?", so the hint carries only
the new information and does not echo it.) Mechanics:

- A dedicated state flag, `anyRouteActive`, is set on entry (and this routing decision is a
  named call-site guard in 1.1, keyed on the ANY sentinel plus the offering's `any_available`;
  `afterService` never returns `'practitioner'` for a staff-first shape).
- While `anyRouteActive`, every ordering-sensitive call site from the practitioner step onward
  (S8-S11 and the variant/add-ons handlers) consults the helper with
  `{ ordering: 'service_first', surface: 'combined' }`: the sub-path IS today's combined
  service-first flow, forward and Back (calendar → its variants/add-ons → slot; slot Back
  unwinds add-ons → variant → practitioner). No staff-first helper cells are consulted, so the
  1.1 throw rules stand with no exceptions.
- Back from the reused practitioner step exits the sub-path: clear `anyRouteActive`, restore
  `selectedPractitionerId = ANY_AVAILABLE_PRACTITIONER_ID` (never null; a staff-first `service`
  step with a null practitioner has no defined rendering), clear the service selection, and
  reland on the full ANY offering list. This is the one defined exception to the 4.3 invariant.
- Clearing rule, stated entry-based so no exit can be forgotten: `anyRouteActive` is cleared on
  EVERY transition to `staff_pick` (which includes the 4.12 recovery action), by the reset
  event, and by booking completion, in addition to the Back-exit above. It is never set on venue
  pages or in service-first sessions. A guest who recovers out of the sub-path and picks a
  person therefore navigates on pure staff-first cells (the 4.3 chain), with no stale combined
  service-first routing and no silent resurrection of the abandoned ANY selection.
- QA row M7 asserts the Back leg as well as the forward legs; the 1b.4 walk covers both.

Banner copy on the ANY path (4.6's banner otherwise shows the person): "Booking with whoever is
available first" (terminology-free; the existing ANY display name "Any available
{terms.staff.toLowerCase()}" at 1523 reads awkwardly as a banner subject). The slot summary and
details rows already render the ANY display name (1523) and stay as they are.

### 4.6 `staff_pick` render specification

- Header: existing `AppointmentStepHeader`. Title: "Who would you like to see?". Description: "Pick a person to see their services and prices." (second person, survives terminology renames, no em-dashes, and does not echo the title above it).
- Root element carries `data-testid="staff-pick-step"` (the heading text alone is ambiguous: the practitioner step at 3527 and the waitlist join sheet both use "Who would you like to see?").
- Cards: one per `catalogStaff` entry with `services.length > 0` (both catalog builders already exclude empty calendars; the filter is defensive). Extracted as a shared `StaffChoiceCard` component, reused by `group_staff_pick`.
- Card anatomy: **owner decision, 2026-08-09, superseding the richer card first specced here.** A 48px avatar (`h-12 w-12`; photo when shown, else the initial) and the name. Nothing else: no bio, no specialties, no venue subtitle, no prices. Bios and specialties stay on the Meet the team tab, where a guest has gone looking for them; on the picker they turn a quick choice into a page of reading. This applies to combined pages too, so the 4.7 venue subtitle is not rendered.
- Profile visibility rule (one coherent rule): if the member's team profile has `hidden` set, render the initials avatar with NO chips and NO bio; otherwise render photo (with `photo_crop` framing via `bookingPageImageFramingStyle`), chips, and bio when present. `hidden` never removes the card itself: the person is bookable and listed by name in both orderings today.
- Ordering: venue pages list in calendar sort order (what the catalog already returns, server-ordered by `sort_order`); combined pages use the deterministic order from 4.7.
- Card interaction: whole card is a button whose accessible name is the person's name only (`aria-label={name}`), same `choiceCardClass` system and chevron affordance as the practitioner step.
- Empty state (zero listed staff): "No {terms.staff.toLowerCase()} are available to book right now." plus "Try again later or contact the venue." (pattern and copy source: the service step's empty state, 2818-2822; revision 1 cited the wrong anchor).
- Exactly one staff member: still show the picker (one card). Predictability beats cleverness; auto-skip creates a Back-target hole and surprises venues testing their own page. The self-serve settings copy (8.1, final sentence) and the help follow-up both mention the one-card behaviour so solo venues are not surprised.
- Loading state: skeleton rows sized to the FINAL card height (photo cards are taller than the practitioner step's h-16 rows; no layout jump on the page's new first screen).
- After a person is chosen, `service`, `variant`, and `addons` steps show a compact context banner (locked-banner pattern, 2731-2741, minus the "only this person" sentence): avatar + "Booking with {name}" (ANY variant per 4.5). The `slot` step already shows a summary.
- Tab-switch caveat (accepted, documented): switching to the "Meet the team" tab unmounts the flow (`BookPublicPageContent.tsx:291-305`), so a guest who leaves mid-flow to read a bio restarts. Pre-existing behaviour, likelier under staff-first; mitigated by the in-card bio line. Keeping the flow mounted across tab switches is rejected for this feature (separate change, wider blast radius). QA row M22.

### 4.7 Combined page specifics under staff-first

- Initial step is `staff_pick` (no `mode_choice` on collectives), both in the initialiser (652-660) and the reset-event handler (856-862).
- **Venue attribution**: `loadCollectiveAppointmentCatalog` populates `owning_venue_name` on each practitioner (the venue-name lookup already existed for duplicate-name qualification, 361-377, and now always runs). Per the owner decision in 4.6 it is **not shown on the picker**; it survives because it orders the merged list and because the duplicate-name suffix on `name` is built from it, which is what still distinguishes two people who share a first name across venues.
- **Deterministic ordering (new in revision 2)**: the collective catalogue sorts practitioners host-venue-first, then member venues alphabetically by venue name, then calendar name. Today's order is Map-insertion order and effectively arbitrary (2.4). Note: this also changes the (currently arbitrary) order of the service-first combined practitioner step; accepted as a strict improvement, QA row M6 checks both orderings.
- Calendar cards may carry venue-qualified names for duplicates; unchanged.
- After the calendar is chosen, everything downstream (variants, add-ons, price, deposit, card-hold degradation, owning-venue routing on create) already keys off the chosen calendar's offer, plus the 4.2 add-ons render fix.
- Cross-suggestion handoff (2.4): a guest following the dead-end suggestion from a member page to the combined page may see a different ordering (host's flag governs). Accepted; QA row M23.

### 4.8 Deep links and bootstraps (both toggle states)

| Entry | Behaviour with flag on |
|---|---|
| `?start=service` (`BookPublicBookingFlow.tsx:78-79`) | Semantics become "skip the mode chooser": land on `staff_pick`, with the back link hidden exactly as the service step hides it today for this entry (2787). Prop name stays; existing wild URLs keep working. `Docs/Embed_Public_Booking_URL_Contract.md` is updated to describe the new semantics. |
| Waitlist offer link (`waitlist_offer` + `service_id` + `date` + `time`) | `preselectedServiceId` present → session runs service-first (4.1). Unchanged experience. |
| Bare `?service_id=` marketing link | Also runs service-first (prop presence decides at mount). The guest still lands on the normal first step and taps the service themselves (the effect at 909-915 only preselects state; it never skips steps today). Accepted inconsistency, documented in decision 4. |
| `preselectedPractitionerId` without a service | Passed publicly today only by the manage surface together with `editBooking` (so service-first by 4.1). Defensive rule for any future public caller: in a staff-first session, treat as staff already chosen; land on `service` with the banner (the effect at 917-922 already sets the id). |
| Reset event (`APPOINTMENT_BOOKING_RESET_EVENT`) | Venue: → `mode_choice` (unchanged). Collective: → `staff_pick` instead of `service`. Clear `selectedPractitionerId` in both. |
| Widget/iframe embeds of `/book/{slug}` and `/embed/{slug}` | Same component, same payload (both load via `get-public-venue-for-book.ts`); staff-first applies automatically. QA row M18. |
| Browser Back / refresh mid-flow | No history integration exists in the flow (no pushState anywhere in the component); browser Back leaves the page and refresh restarts the flow, identically in both orderings. Accepted parity; QA row M21 asserts no crash and a clean restart. |

### 4.9 Prefetching and priming in staff-first

- `staff_pick`: no calendar prefetch (no service chosen). Catalog is already loaded.
- `service` step with a concrete practitioner chosen: extend the locked-flow prefetch branch (1255-1265) to also fire when `orderingForSession === 'staff_first' && selectedPractitionerId` is concrete: prefetch that person's calendars across their services (same throttled `prefetchCalendarTasks`, concurrency 4).
- `service` step after "Any available": skip prefetch (pooled month computations are the most expensive server path; the slot step fetches on demand exactly as service-first does after the any-available card).
- **Single-service warm-cache effect (1460-1483)**: gains an `orderingForSession === 'service_first'` guard. In staff-first it would either duplicate the scoped prefetch above (concrete person) or fire pooled all-practitioner prefetches after ANY (contradicting the previous bullet).
- Priming on the service/variant/add-ons forward transitions reuses `primeSelectedAppointmentCalendar` exactly as the locked and combined branches do today (2867-2869, 3086-3093, 3328-3337).
- The `practitioner`-step prefetch branch (1234-1254) is untouched; it fires in staff-first only on the combined ANY non-uniform path (4.5), where its assumptions (selected service present) hold.

### 4.10 Progress indicator

Add `staff_pick` and `group_staff_pick` to the `choose` set in `appointmentProgressPhase`
(`appointment-public-ui.tsx:76-88`). Phases remain Choose → Schedule → Confirm. Covered by a unit
test (the function is pure).

### 4.11 Included fix: locked-flow slot Back skips add-ons

Today `slot` Back in the locked flow goes to `variant` or `service`, never `addons` (3649-3658),
while the combined branch unwinds through add-ons correctly. The helper returns the full unwind
(`slot` → `addons` → `variant` → `service`) for the locked mode too. One-line behaviour
improvement with its own unit test; flagged so the diff is not mistaken for an accident. If
review prefers strict no-change to locked pages, the helper encodes current behaviour instead;
decide at PR time, default is to fix it.

### 4.12 Fully-booked person recovery (redesigned in revision 3)

Staff-first makes "chosen person has no availability" the likeliest dead end, and the plain Back
chain makes recovery cost 2 to 4 taps versus 1 in service-first. Therefore, in staff-first
sessions only, the `slot` step's no-availability empty state (3800-3824) gains one action button.
Revision 3 replaces revision 2's conditional deep-routing (which conflicted with the helper
contract and skipped price disclosure) with a design that always lands on the service list:

- Label: "See someone else" (terminology-free; "See another {terms.staff}" reads as "See another staff" under default terminology).
- Behaviour: set `carriedServiceId = selectedServiceId`, KEEP the chosen `date`, clear the chosen time, clear the practitioner/service/variant/add-on selections, and return to `staff_pick`. `afterStaffPick` stays `'service'` unconditionally (no helper conflict, no new routing cells). On the next person's `service` step, if they offer the carried service id (same ids across staff on a single venue; same offering ids on combined), that service is pinned first with a small tag: "You were booking this". Their own price and duration are shown on the row like every other row, so the guest sees the new person's price BEFORE picking a time. One tap continues via normal 4.2 routing (variants and add-ons are per-person and start fresh). If they do not offer it, one line renders under the service-step header, "{name} does not offer the service you were booking, but here is what they do.", and the list renders normally with no tag, so the guest is never left wondering where the service went. Picking "Any available" from the recovery picker behaves per 4.5 with the same pinned-tag treatment on the ANY list; on combined pages a non-uniform carried offering simply follows the 4.5 sub-path when tapped. Nothing special-cases the routing anywhere: the carry is presentation only. The recovery action also clears `anyRouteActive` (4.5's entry-based rule): recovery exits the combined ANY sub-path entirely, so the next person pick navigates on the staff-first cells.
- `carriedServiceId` clearing rules: cleared when any service is selected, when the guest leaves `staff_pick` backwards (its normal back link is unchanged), and on the reset event.
- Gating: the button is hidden when the current selection is ANY (the pool covered everyone; waitlist join and cross-suggestion remain the escape hatches) and when fewer than two people are listed on the picker (a solo venue would loop to a one-card picker of the person who just had no times).
- The existing empty-state content (waitlist join, cross-suggestion, "try a different date") is unchanged and stays below the new action.
- Single flow only: `group_slot` dead-ends keep the standard Back chain. A group member who is fully booked under staff-first is rare enough that carried-state machinery is not warranted in v1; recorded as an accepted exclusion in section 9.
- QA row M10 includes a construction recipe; the 1b.4 walk covers carry, tag, the not-offered notice, price visibility, the clearing rules, and recovery FROM the combined ANY sub-path (asserting the `anyRouteActive` clear).

---

## 5. Implementation plan (granular)

Phases ship as one feature branch off `staging` (`feature/staff-first-booking-flow`), PR into
`staging` per repo convention, with commits grouped per phase for reviewability. The self-serve
settings card is a SECOND, later PR (7.3).

### Phase 0: flag plumbing (0.5 day)

0.1 `src/lib/feature-flags/types.ts`: add `'staff_first_booking_flow'` to `APPOINTMENTS_FEATURE_FLAG_KEYS`; add `staff_first_booking_flow: z.boolean().optional()` to the schema.
0.2 `src/lib/feature-flags/resolve.ts`: add `staff_first_booking_flow: 'FEATURE_FLAG_STAFF_FIRST_BOOKING_FLOW'` to `ENV_BY_FLAG`. No `FLAG_DEFAULT_ON` entry. Merge/storage loops pick it up automatically; confirm with tests.
0.3 `src/components/booking/types.ts`: add optional `staff_first_booking_flow?: boolean` to `VenuePublic.feature_flags.resolved`.
0.4 `src/lib/booking/venue-public-feature-flags.ts` (~35-48): include the key. This is the change that matters for the public pages (they load via `get-public-venue-for-book.ts:38`), the staff payloads, and the venue editor preview.
0.5 `src/app/api/booking/venue/route.ts` (~70-74): include the key (external-facing consistency).
0.6 `src/lib/linked-accounts/collective-venue.ts`: resolve the host's value next to `hostAnyAvailablePractitioner` (77-79) and emit it in `feature_flags.resolved` (132).
0.7 `src/lib/linked-accounts/collectives.ts` (122, 287-289, 316): add the sibling `hostStaffFirstBookingFlow` field to `CollectiveView`; thread it through `collective-settings-to-preview-public.ts` and the `CombinedPageManager.tsx:457,465` caller.
0.8 `src/app/super/flags/FlagsPageClient.tsx`: add the label to the manual map (this page is the pilot lever).
0.9 `Docs/FEATURE_FLAGS.md`: flags table row + env var row + a note that the self-serve card ships separately.
0.10 Tests: extend `src/lib/feature-flags/resolve.test.ts` (default off, venue true, env override both directions, storage round-trip drops `false`); extend `src/lib/booking/venue-public-feature-flags.test.ts` (key mapped through).

(The `FLAG_META` settings card is deliberately NOT here; it moves to Phase 8 / the second PR.)

### Phase 1: pure ordering helper (0.5 day)

1.1 New `src/lib/booking/appointment-flow-order.ts`:

```
export type AppointmentFlowOrdering = 'service_first' | 'staff_first';
export type AppointmentFlowSurface = 'venue' | 'combined' | 'locked';
export interface AppointmentFlowShape { ordering: AppointmentFlowOrdering; surface: AppointmentFlowSurface; }
export interface AppointmentSelectionCtx { hasVariants: boolean; hasAddons: boolean; }

afterStaffPick(shape) → 'service'
afterService(shape, ctx) → 'variant' | 'addons' | 'practitioner' | 'slot'
afterVariant(shape, ctx) → 'addons' | 'practitioner' | 'slot'
afterAddons(shape) → 'practitioner' | 'slot'
afterPractitioner(shape, ctx) → 'variant' | 'addons' | 'slot'
backFromStaffPick(shape) → 'mode_choice' | null
backFromService(shape) → 'mode_choice' | 'staff_pick' | null
backFromVariant(shape) → 'service' | 'practitioner'
backFromAddons(shape, ctx) → 'variant' | 'service' | 'practitioner'
backFromPractitioner(shape, ctx) → 'addons' | 'variant' | 'service'
backFromSlot(shape, ctx) → 'addons' | 'variant' | 'service' | 'practitioner'
anyAvailableCardVisible(shape, { flagOn, listedCount, hasUniformOffering }) → boolean   // 4.5 gate, pure
```

**Scope contract (explicit, from review round 1).** The helper covers primary-context transitions
parameterised by `(ordering, surface, ctx)`. The following stay as call-site guards, applied
BEFORE the helper is consulted, and are covered by the Phase 1b component suite rather than the
helper matrix:

- append/edit add-on segment contexts → `multi_service` (3292-3314, 3345-3350);
- `staffCalendarSlotPrefillActive` short-circuits (3316-3327 and the variant-step copy);
- `navigateFromServiceRow`'s edit-mode catalog-dependent practitioner-or-slot branch (2854-2866). Note it sits AFTER the variant/add-on checks; edit sessions with variant services go to `variant` first, and `advanceFromAddons` has NO edit short-circuit (edit lands on `'practitioner'` via the service-first cell). The helper's service-first cells reproduce this; nothing special-cases edit inside the helper;
- back-link VISIBILITY (hidden for staff/edit/`initialStep === 'service'`/first-step cases): the helper returns the target when a link renders; whether it renders stays at the call site;
- **the combined ANY sub-path entry (4.5)**: the "uniform → pooled slot, non-uniform → practitioner step + set `anyRouteActive`" decision after an ANY service pick is a call-site guard keyed on the ANY sentinel plus the offering's `any_available`; while `anyRouteActive`, the S8-S11/variant/add-on call sites pass `{ ordering: 'service_first', surface: 'combined' }` to the helper. `afterService` never returns `'practitioner'` for a staff-first shape;
- **the 4.12 recovery carry**: `carriedServiceId` is presentation-only state (a pinned row + tag on the service list); it introduces NO routing cells and no helper input;
- the group flow maps helper outputs onto `group_*` ids via one explicit table in the component, covering `service`/`variant`/`addons`/`practitioner`/`slot` cells only; group ENTRY and EXIT (G1 `group_person_label` → `group_service`, G2 back to `group_person_label`, and the `group_review` loop) are call-site guards outside the helper, since `mode_choice`-adjacent cells have no group image.

Cells unreachable by construction (e.g. `afterPractitioner` under `staff_first`, anything under
`surface: 'locked'` with `ordering: 'staff_first'`, `afterStaffPick` under `service_first`) THROW.
Tests assert the throw so impossible states fail loudly instead of baking in accidents.

1.2 New `src/lib/booking/appointment-flow-order.test.ts`: table-driven tests over every
expressible (ordering × surface × ctx × function) cell. Service-first cells assert byte-equality
with the current behaviour recorded in the 2.2 tables (S1-S12, G1-G8), scoped to
helper-expressible cells per the contract above. Include: the 4.11 locked unwind decision, the
`anyAvailableCardVisible` gate (flag off / one listed / venue / combined with and without a
uniform offering), and `appointmentProgressPhase` additions (4.10).

### Phase 1b: baseline component characterisation suite (1.5-2 days) — NEW, mandatory

Written against BASELINE behaviour BEFORE any flow rewiring, then kept green through Phases 2-4
(a permitted delta from decision 10 updates its assertion in the same commit as the behaviour
change, and only those). This is what binds the component to the helper and makes "flag-off
unchanged" a tested claim rather than an asserted one.

1b.1 New `src/components/booking/AppointmentBookingFlow.flow-order.test.tsx` with
`/** @vitest-environment happy-dom */` (precedent: `BookingDetailSurface.test.tsx:1`),
`@testing-library/react`, and a mocked `fetch` serving canned payloads. Mocked endpoints,
enumerated: appointment catalog, availability, appointment-calendar month, and the prime/validate
calls; the fetch spy's call counts double as the 4.9 prefetch-gating assertions (the 1460-1483
guard, the scoped staff-first prefetch, and the no-prefetch-after-ANY rule). The account-gate
context is provided via its default public provider (or a minimal mock) so `details` can mount.
Fixtures: plain service, variants service, add-ons service, variants+add-ons service, two
practitioners with overlapping-but-different services and different prices; a combined-shaped
catalog variant of the same; **and a combined catalog where two calendars carry DIFFERENT add-on
groups (and variants) for the same offering id**, which is what the Phase 2.7 fix needs to prove
displayed groups, totals, and validation come from the chosen calendar (walked in both
orderings).
1b.2 Walk boundary: walks assert through slot selection and the `details` render; they NEVER
mount `payment` (`PaymentStep` initialises Stripe at render, 4298; e2e owns that leg).
1b.3 Flag-off walks (characterisation): venue single flow for all four service shapes, forward
and Back at every step; combined single flow ditto plus the divergent-groups walk; group flow
with two people; locked flow; edit-mode walk (service with variants: service → variant → addons
→ practitioner, per S3/S6); any-available walk; reset-event walk (venue and collective: landing
step and cleared state per today's 856-862, since Phase 2.2 edits that handler). Assert step
headings, listed options, prices shown, and preserved/cleared state after Back.
1b.4 Flag-on walks (written inside Phases 2-4 as the behaviour lands; budgeted THERE, roughly
0.25 day each in Phases 2, 3, and 4): venue staff-first all four shapes; ANY walk; combined
staff-first including the 4.5 sub-path forward AND Back (ANY restore); the divergent-groups walk
staff-first; group staff-first; the 4.12 recovery (carry, tag, the not-offered notice, price
visibility, clearing rules, and recovery FROM the combined ANY sub-path asserting the
`anyRouteActive` clear); the 4.3 invariant with its defined exception; `?start=service` entry;
reset event.
1b.5 The suite asserts state-clearing per the 4.3/4.4 tables by navigating back then forward and
inspecting what is preselected/listed (acceptance criterion AC3's executable form).

### Phase 2: single flow staff-first (1.5 days, including its 1b.4 walks)

2.1 `AppointmentBookingFlow.tsx`: add `'staff_pick'` to the `Step` union; compute
`orderingForSession` per 4.1.
2.2 Initial step (652-660) and reset handler (856-862): staff-first branches per 4.8.
2.3 `mode_choice` single-booking card (2758): target `staff_pick` in staff-first sessions.
2.4 New `staff_pick` render block per 4.6 with `data-testid="staff-pick-step"`; new shared
`StaffChoiceCard` component (photos/initials per the 4.6 visibility rule, venue subtitle slot,
chips clamp, bio clamp, aria-label).
2.5 `service` step: staff-first scoped list per 4.2; back link per 4.3; context banner per 4.6.
2.6 Rewire the single-flow edit sites S1-S12 to consult the helper for their primary-context
targets, preserving the call-site guards named in 1.1's scope contract (append/edit contexts,
staff prefill, edit branch in S3, back-link visibility, S5b untouched except its helper call).
2.7 `addons` render scoping task from 4.2: primary context resolves groups from
`addonGroupsForSelectedService` (1558-1566) with generic fallback for ANY; append/edit segment
contexts resolve from the segment's practitioner (matching their already-scoped math at 1962 and
2009); totals/validation follow. Permitted flag-off delta (a); its 1b assertions update in this
commit.
2.8 `advanceFromAddons` (S6): route via `afterAddons(shape)`. Locked and combined service-first
cells return `slot` (matching 3338); venue service-first (including edit) returns `practitioner`;
staff-first returns `slot`. The revision-1 "practitioner already resolved" phrasing is dead:
it would have broken edit sessions.
2.9 Prefetch changes per 4.9 (extend 1255-1265's condition; guard 1460-1483).
2.10 Progress phases per 4.10.
2.11 The 4.12 recovery action on the staff-first slot empty state (`carriedServiceId` state,
pinned-row tag on the service list, gating and clearing rules per 4.12).
2.12 This phase's 1b.4 walks (venue staff-first shapes, ANY, recovery).

### Phase 3: combined page staff-first (1.5 days, including its 1b.4 walks; it carries the whole ANY sub-path state machine plus the server catalogue changes)

3.1 Initialiser/reset: collective → `staff_pick`.
3.2 `staff_pick` on combined: no back link; ANY card per 4.5 (uniform-offering gate); venue
subtitles per 4.7.
3.3 Server: `loadCollectiveAppointmentCatalog` additions per 4.7 (`owning_venue_name` always
populated; deterministic sort). Note: the host-first sort needs `host_venue_id`, which this
function never loads today (only `loadCollectiveVenuePublic` reads it via `loadCollectiveRow`,
44-51, 62); add the lookup. Client type for the catalog practitioner gains the optional field.
Permitted flag-off delta (b); its 1b assertions update in this commit.
3.4 The 4.5 ANY routing on combined: uniform → pooled slot; non-uniform → the sub-path
(`anyRouteActive`, service-first cells, Back-with-ANY-restore, hint line).
3.5 Verify the combined-only branches in S3-S11 against helper outputs; combined service-first
cells stay byte-identical (1b suite) except the decision-10 deltas.
3.6 This phase's 1b.4 walks (combined staff-first, sub-path forward and Back, divergent groups).
3.7 Manual pass on `/book/c/plus-1` with the host flag on and off.

### Phase 4: group flow staff-first (1.25 days, including its 1b.4 walks)

4.1 Add `'group_staff_pick'` to the Step union; render block after `group_person_label`, reusing
`StaffChoiceCard`; copy and banners per 4.4.
4.2 Rewire the group edit sites G1-G8: G3-G8 route via the helper with the group id mapping
table (which covers `service`/`variant`/`addons`/`practitioner`/`slot` cells only), explicitly
including the forward handlers G3 (`group_service` select, 4571-4581, keeping its
`queuePrefetchForServicePractitioners` call in service-first and swapping to person-scoped
prefetch in staff-first), G4 (`group_variant` select, 4628-4632), and G5 (`group_addons`
Continue, 4791-4794). G1 and G2 (the person-label entry and its back) are call-site guards per
the 1.1 contract, since entry cells have no group image.
4.3 Group create payload unchanged (per-person service + practitioner + slot); `advanceToGroupDetails`
and `create-group` call sites compile untouched.
4.4 Group staff-first prefetch: on `group_service`, prefetch the chosen person's calendars
(mirror of 4.9); the `group_practitioner` prefetch branch (1266-1272) remains for flag-off.
4.5 This phase's 1b.4 walks (group staff-first, banners, back chain).

### Phase 5: cross-cutting sweep (0.5 day)

5.1 Copy audit of every new string (4.4, 4.5, 4.6, 4.12): second person, warm, no em-dashes,
terminology-aware. No string hardcodes "staff"/"team member" where `terms.staff` exists.
5.2 Accessibility, stated truthfully: the flow manages no focus today (no step moves focus to a
heading; `AppointmentStepHeader` has no focus logic), and this feature keeps that parity. New
cards get `aria-label` = person's name so chips/bio do not bloat announcements. A flow-wide
focus-on-step-change improvement is noted as a separate follow-up, out of scope.
5.3 Empty/edge states: zero staff, one staff, hidden-profile members, staff with no
add-ons/variants, ANY with a single uniform offering on combined, stale `service_id` link.
5.4 Docs sweep: `Docs/Embed_Public_Booking_URL_Contract.md` (`?start=service` semantics),
`Docs/FEATURE_FLAGS.md` (0.9), and a help-centre follow-up item (new article or settings article
note covering the toggle, photos coming from Meet-the-team profiles, and the one-card behaviour
for solo venues) delivered as Phase 8.3 inside PR 2.
5.5 `rg 'staff_first_booking_flow'` sweep (scoped; a bare `staff_first` search drowns in importer
field aliases) plus a checklist pass over every consumer of `any_available_practitioner` as the
distribution template.

### Phase 6a: e2e harness plumbing (1 day)

6a.1 Seed refactor: parameterise `scripts/seed-e2e-smoke-venue.mjs` into a per-venue function.
The existing venue keeps its slug, flags, and CURRENT services unchanged, but gains ONE
additional variants+add-ons service (additive is safe: existing specs target services by name
and `ensureService` is name-scoped per venue, 128-184); this is what the new flag-off spec
(6b.2) books. Add a SECOND venue with HARDCODED slug `e2e-smoke-staff-first` (assert it differs
from `E2E_VENUE_SLUG`; log both venues' final `feature_flags` at the end). The new venue gets:
`staff_first_booking_flow: true`, TWO calendars with overlapping-but-different service sets and
different prices for the shared service, one variants+add-ons service, deposit config matching
the existing venue.
6a.2 Env plumbing: `E2E_STAFF_FIRST_VENUE_SLUG` (+ names/services consts) with the same skip
guard pattern (`e2e/helpers/env.ts`), `global-setup.ts` validation message, `.github/workflows/ci.yml`
env allowlist additions (seed + run), repo secrets/vars note, `Docs/E2E_SMOKE.md` and
`e2e.env.example` updates.
6a.3 Helper extraction: split `bookAppointmentWithDeposit`'s details/payment internals into a
shared function; the existing spec now runs through the extracted-but-equivalent helper. This is
a reviewed refactor of the flag-off proof path; called out in the PR description.

### Phase 6b: e2e coverage (1 day)

6b.1 New spec `e2e/appointment-staff-first-book-pay-confirm.spec.ts` on the staff-first venue:
full book → pay → confirmed via `data-testid="staff-pick-step"`, asserting (a) the picker renders
before any service list, (b) staff B's exclusive service is absent after picking staff A, (c)
staff A's price is shown (not the cross-staff "from" price), (d) variant and add-ons steps appear
in the staff-first order, (e) `service`-step Back returns to the picker.
6b.2 New flag-OFF spec on the existing venue booking the NEW variants+add-ons service (6a.1)
service-first, closing the "one plain path" coverage gap without modifying the existing spec.
6b.3 Slot-picking tolerance: the new specs pick an nth-available slot rather than first-available
to reduce cross-ref contention (CI concurrency is per-ref; fixtures are shared across refs).
Risk register reworded accordingly (the suite is serial per config, not "parallel-safe").
6b.4 `npm run lint`, `npm test`, `npm run test:e2e` all green locally; the local e2e run record
(all specs) attaches to the PR if `RUN_E2E_SMOKE` is not enabled on the repo (7.3 step 3).

### Phase 7: QA and rollout

#### 7.1 Executable QA matrix

Environment key: DEV = local against dev DB fixtures; STG = staging. Every row names its flag
state explicitly; "off" cells assert behaviour is identical to today.

| # | Flag | Env | Scenario and expected result |
|---|---|---|---|
| M1 | on | DEV+STG | Single booking, concrete staff, plain service: picker → services (that person's prices) → slot → details → confirmed. Observe slot times match the venue timezone. |
| M2 | on | DEV+STG | Variants + add-ons service: order staff → service → variant → add-ons → slot; selections scoped to the person. |
| M3 | on | DEV+STG | "Any available": card top of picker; pooled slot; assignment recorded per config (priority/random), verified on the dashboard calendar column and the booking detail's assigned person. |
| M4 | on | DEV | Multi-service visit: add another service (list = chosen person's), edit add-ons, remove segment. |
| M5 | on | DEV | Group booking, 2 people, different staff, one with variants; banners per 4.4; review list correct. |
| M6 | both | DEV | Combined page: deterministic staff order, venue subtitles, cross-venue price/deposit; booking lands in owning venue. Flag-off practitioner step order and the Meet the team tab order follow the same deterministic sort. |
| M7 | on | DEV | Combined ANY: uniform offering → pooled slot; NON-uniform offering → practitioner step with hint; full catalogue visible in both cases. Back from the practitioner step restores "Any available" and the full list (never a null person); Back from a sub-path slot unwinds add-ons → variant → practitioner. Card absent when the collective has zero uniform offerings. |
| M8 | on | DEV+STG | Deposit, card-hold, and free services each reach the correct payment/confirmation under staff-first. |
| M9 | on | DEV | ANY then a service only one person offers: pooled search works (single-member pool). |
| M10 | on | DEV | Fully-booked person recovery. Recipe: give person A working hours only on day X, book day X out via the dashboard, then attempt A on day X publicly. Expect: "See someone else" appears; returns to the picker (date kept, time cleared); next person's service list pins the carried service with "You were booking this" and THEIR price visible before any time is picked; the not-offered notice shows when the person lacks it; button hidden on ANY and on a one-person picker. Repeat once from a combined ANY sub-path slot: after recovering and picking a person, every Back follows the staff-first chain (no calendar list, no ANY resurrection). |
| M11 | on | STG | Compliance venue: pre-check + inline forms unchanged at details. |
| M12 | on | STG | Account-gate venue: sign-in gate at details unchanged. |
| M13 | on | DEV | Waitlist: fully-booked day offers join from staff-first slot step (prefill correct incl. ANY); waitlist OFFER link runs service-first. |
| M14 | on | DEV+STG | Locked practitioner page: identical to today except the 4.11 unwind if taken (venue flag ON proves the exclusion, not a no-op). |
| M15 | on | DEV+STG | Staff dashboard modal + walk-in + edit + rebook: still service-first with the venue flag ON. |
| M16 | on | STG | Guest self-reschedule: still service-first with the venue flag ON. |
| M17 | both | DEV | `?start=service`: lands on picker (on) / service list (off); back link hidden both ways. |
| M18 | on | DEV | Widget/iframe embed and `/embed/{slug}` follow the toggle. |
| M19 | both | DEV | Venue editor preview and collective editor preview MIRROR the live ordering (the preview mounts the real flow). No console errors. |
| M20 | on | DEV | Mobile 375px: picker cards (photos, chips clamp, bio clamp), banners, and recovery action; plus dark scheme if applicable; plus `.appointment-public` skin check on all new markup (see repo memory: unlayered skin overrides brand utilities; use `border-[color:var(--brand-N)]` forms). |
| M21 | on | DEV | Browser Back exits page; refresh restarts flow cleanly; return via Forward does not crash. |
| M22 | on | DEV | Switch to "Meet the team" tab mid-flow and back: flow restarts (accepted); no crash. |
| M23 | on | DEV | Member venue flag on, host flag off: cross-suggestion hands over to a service-first combined page without breakage. |
| M24 | on | DEV | Terminology venue (Staff renamed): every new string renders the venue's term. |
| M25 | on | DEV | Solo-staff venue: one-card picker works; no ANY card. |
| M26 | on | DEV | Zero bookable staff / zero services: empty states per 4.6. |
| M27 | both | STG | Super admin flags page lists, sets, and clears the flag; non-admin venue staff cannot see or change it (card absent until Phase 8; PATCH is admin-only). |
| M28 | on | STG | Env override rehearsal: venue flag on + env `false` → service-first after redeploy; remove env → staff-first returns. Doubles as the kill-switch rehearsal. |
| M29 | on | STG | Cache propagation: flip the venue flag, reload the public page, ordering changes without redeploy; note response caching headers observed. |
| M30 | on | DEV | Keyboard-only and screen-reader pass over picker → service → slot: all cards reachable, accessible names are person names. |
| M31 | on | STG | Confirmation email for a staff-first booking, received at a real mailbox the owner controls (name the address in the release issue): service, person, price, date/time, venue correct. |
| M32 | on | DEV | Hidden team profile: initials-only card, no chips/bio; still bookable. |

STG rows require staging fixtures that mirror dev: a collective, a compliance venue, an
account-gate venue. Enumerate/create them BEFORE QA day (checklist item in the release issue).

#### 7.2 QA execution estimate

The matrix is 1.5 to 2 days of hands-on execution (32 rows, several with two flag states, three
payment modes among them). This is separate from rollout elapsed time.

#### 7.3 Rollout

> **Superseded in part, owner decision 2026-08-09.** The two-PR, dark-first staging below was
> written to keep the toggle out of venues' hands until a pilot proved out. The owner's call is
> that every venue should be able to turn this on and off for themselves from the day it ships,
> so the settings card lands with the feature and there is no PR 2 gate. What survives: the
> staging soak (step 2), the release preconditions (step 3), and the pilot watch (step 4), which
> now watches whoever enables it first rather than a venue chosen by us. Consequence to hold in
> mind: any venue can reach the new order without asking, so the QA matrix should be green before
> this reaches production rather than during the soak.

1. **One PR**: the feature and its settings card together. Off for every venue until they toggle
   it. Existing e2e specs unmodified and green; new specs green; 1b suite green.
2. Enable on an internal test venue in staging via the super flags page. Run the STG matrix rows.
   Rehearse rollback here (M28 + M29): venue-toggle off, env-override off, each verified on the
   public page. Note: the env kill-switch requires a redeploy/restart to take effect (it is read
   at resolution time), and removing an env override later resurrects any venue-stored `true`
   keys, so the cleanup order is: clear venue keys first, then drop the env var.
3. Ship staging → main via the usual batch release PR. Hold the release if unrelated staging
   changes are unbaked (the batch convention means this PR carries them too). Merge precondition:
   either `RUN_E2E_SMOKE=true` ran the suite on this PR, or the local full-suite run record is
   attached.
4. Enable for the requesting venue (super flags page; production lever for out-of-hours rollback
   is the same page). Pilot watch, concretely: the venue's dashboard bookings list filtered to
   the enablement date, Stripe payments on the connected account for the same window, and the
   app's server/error logs for `/book/{slug}` routes. "Staff-first booking" proxy, since no new
   telemetry ships: guest-created bookings (public flow origin, not staff-created, not edits) at
   the venue with created_at after the enablement timestamp, read from the dashboard bookings
   list and booking detail origin. Healthy = at least 5 such completed bookings spanning plain +
   variant/add-on + deposit, zero new booking-flow errors, no venue-reported issues, across 7
   days.
5. There is no PR 2. The temporary PATCH deny once considered here is moot: the toggle is the
   supported way in, so there is nothing to withhold.

### Phase 8: self-serve release

8.1 **Done** (shipped with the feature per the owner decision above). `FLAG_META` card in
`FeatureFlagsSection`, which `SettingsView` renders on the `booking-settings` tab. Title:
"Staff-first booking". Description (static English like its siblings, no em-dashes): "Guests pick
who they want to see first, then choose from that person's services, on your public booking page
and your combined page if you host one. Team photos and specialties from your Meet the team
profiles appear when guests choose a person; with one team member, guests see a single card
first." Covered by `FeatureFlagsSection.test.tsx`: the card renders off by default, toggles on and
back off, and leaves the venue's other settings untouched.
8.2 **Done.** `Docs/FEATURE_FLAGS.md` records the toggle and its real location (Settings →
Booking settings → Optional Booking features); the stale "Profile" and "Beta features" wording is
corrected.
8.3 **Still open.** The help-centre follow-up from 5.4 (toggle behaviour, photos from Meet the
team profiles, solo one-card note; copy rules apply). Now more valuable than when it was a
follow-up, since venues can find the toggle before anyone tells them about it.
8.4 QA rows, to run with the rest of the matrix: (a) dashboard card round-trip: toggle on, save,
public page flips (re-run M29 via the card path); toggle off, restores; (b) non-admin staff cannot
see or change the card's effect (the card is admin-gated in `SettingsView`, and PATCH is
admin-only); (c) card copy audit against the copy rules; (d) a venue enabled earlier from the
super flags page shows the card ON the first time it renders.

#### 7.4 Rollback

- Per venue: the venue's own settings toggle, or the super flags page; verified
  to propagate on a hard reload without redeploy (M29 rehearses this; the collective page is
  force-dynamic, the venue page's caching behaviour is confirmed by the rehearsal).
- Global: `FEATURE_FLAG_STAFF_FIRST_BOOKING_FLOW=false` + redeploy (process-wide, requires
  restart; rehearsed in M28).
- No data residue: bookings created under either ordering are ordinary bookings. Flag residue:
  venue-stored `true` keys survive an env-override rollback; cleanup order documented in 7.3.2.

---

## 6. Effort summary

| Phase | Estimate |
|---|---|
| 0 flag plumbing | 0.5 day |
| 1 ordering helper + pure tests | 0.5 day |
| 1b baseline characterisation suite (flag-on walks are budgeted inside Phases 2-4) | 1.5-2 days |
| 2 single flow incl. its walks | 1.5 days |
| 3 combined incl. its walks | 1.5 days |
| 4 group incl. its walks | 1.25 days |
| 5 sweep | 0.5 day |
| 6a e2e harness plumbing | 1 day |
| 6b e2e coverage | 1 day |
| 7.1-7.2 QA execution | 1.5-2 days |
| 7.3-7.4 rollout hands-on (soak is elapsed calendar time) | 0.5 day |
| 8 / PR 2 self-serve + help follow-up | 0.5 day |
| Total hands-on | ~12-13 days |

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Back-navigation regressions in existing modes (the classic failure for this file) | Phase 1b characterisation suite written at baseline BEFORE rewiring and kept green; helper matrix asserts service-first cells equal the 2.2 tables; existing e2e specs unmodified; per-phase commits. |
| Rewiring diverges from the helper (helper tests pass, component wrong) | 1b walks the component itself, both flag states, forward and Back, including state-clearing assertions. |
| Scoping mistakes (variant/add-on/price from the wrong person) | Scoped helpers + the 4.2 add-ons render fix + e2e assertions 6b.1(b)(c) + M2/M5/M6. |
| Combined ANY routing confuses guests or strands state | Full catalogue always visible; uniform-offering card gate; the sub-path is today's combined service-first cells behind one flag (`anyRouteActive`), with Back defined to restore the ANY selection and clear the flag (cleared on every transition to `staff_pick` including the 4.12 recovery, plus reset and completion); hint line; M7 asserts both legs. |
| Fully-booked person dead end | 4.12 "See someone else" recovery (presentation-only carry, honest per-person pricing); M10 with recipe. |
| Hidden consumer of the resolved-flags subset misses the key | 0.4 covers the real public loader (`get-public-venue-for-book.ts`); 5.5 sweep uses the `any_available_practitioner` distribution as the checklist. |
| Waitlist offer links breaking under reordering | 4.1 forces service-first for preselected-service sessions; M13. |
| e2e flakiness from shared fixtures across refs | Serial suite; nth-available slot picking; hardcoded distinct slug with seed-time assertion; documented residual cross-ref flake mode. |
| Early self-serve enablement before the pilot proves out | Two-PR rollout: no settings card until the pilot is healthy. |
| Cache staleness makes the toggle look broken | M29 rehearsal; collective page is force-dynamic; venue page verified in rehearsal; repo has prior cache-staleness history, hence the explicit step. |
| The 5k-line component grows harder to reason about | Ordering decisions live in the pure helper; new render blocks are flat and single-purpose; `StaffChoiceCard` shared. |

---

## 8. Acceptance criteria (each verifiable)

1. Flag off: the Phase 1b characterisation suite passes at baseline and at HEAD, with assertion
   changes permitted ONLY for the decision-10 deltas and only in the same commits as those
   deltas; the two pre-existing e2e specs pass unmodified; the new flag-off variants+add-ons
   spec passes. (M14-M16 are flag-ON exclusion rows and belong to AC6.)
2. Flag on: e2e 6b.1 passes; QA rows M1-M13, M17-M26, M30-M32 pass as written.
3. State handling: the 1b suite's back/forward state assertions (4.3/4.4 tables, practitioner-
   survival invariant) pass.
4. "Any available" behaves per 4.5 on venue and combined pages (M3, M7, M9).
5. Deep links, reset, embeds, browser back/refresh behave per 4.8 (M17, M18, M21).
6. Non-reordered surfaces: staff, edit, locked, class/event/resource behave identically per the
   1b flag-off walks and M14-M16; the only permitted deltas are the three in decision 10.
7. Flag plumbing: settings PATCH round-trips; super flags page sets/clears; host inheritance
   reaches the combined page; env override rehearsed; cache propagation verified (M27, M28,
   M29).
8. Every new user-facing string satisfies the copy rules (plain, warm, second person, no
   em-dashes, terminology-aware).
9. `npm run lint`, `npm test`, and the full Playwright suite green (CI or attached local record).
10. Confirmation email verified for a staff-first booking (M31).

---

## 9. Out of scope (explicit)

- Per-collective (non-inherited) toggle.
- Staff-first ordering for the staff dashboard, edit/reschedule, or locked pages.
- Making the "Meet the team" landing tab cards clickable into the flow (worthwhile, separate change).
- Keeping the Book panel mounted across landing-tab switches (separate change; accepted restart risk documented in 4.6).
- Auto-skipping the picker for single-staff venues.
- Flow-wide focus-management improvements (noted in 5.2 as follow-up).
- "Next available" availability hints and an "offers the service you were booking" badge on picker cards (candidate follow-ups to 4.12).
- Extending the 4.12 recovery to the group flow (group dead-ends keep the standard Back chain in v1; accepted in 4.12).
- Reordering class/event/resource flows.
- New telemetry/analytics events for the flow (pilot monitoring uses existing dashboards, Stripe, and logs; a `flow_ordering` field on create was considered and rejected to keep the API untouched).
