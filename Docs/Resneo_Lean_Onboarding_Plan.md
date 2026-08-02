# Lean onboarding: move catalogue setup and Stripe into "What's next"

Status: Phases 0, 1, and 2 implemented. **Both migrations must be applied before the code ships** (see 3.5 and 5.6). Phase 3 not started.
Owner: TBC.
Scope: Appointments-plan onboarding (`src/app/onboarding/page.tsx`) and the dashboard setup checklist (`src/app/dashboard/SetupChecklist.tsx`).

## 1. Goal

Get a new venue from signup to a working dashboard with the fewest heavy decisions. Onboarding keeps only what the product cannot function without: business details, opening hours, calendars, and calendar availability. Everything else (services, classes, events, resources, Stripe) moves to the post-onboarding **What's next** checklist, which already links to all of it.

### Why this is worth doing

The win is weight, not step count.

| Venue shape | Steps today | Steps after |
|---|---|---|
| Appointments, one model | 10 | 8 |
| Appointments, all four models | 13 | 8 |
| Appointments Light, one model (no `users` step) | 9 | 7 |

Two screens saved for a single-model venue is not the argument on its own. The argument is that **Appointments Setup is the heaviest screen in the flow** (`page.tsx:1799`, `page.tsx:2826`): per-service duration, buffer, price, payment requirement, deposit, booking-notice rules, calendar assignment, and variant validation, all demanded before the user has seen the dashboard. Classes, Events, and Resources each add a comparably heavy form. That is where people stall.

### What makes this cheap

1. **All five steps are already optional.** Services accepts zero rows and advances (`page.tsx:1802`). Classes, Events, Resources, and Stripe each carry explicit "leave it empty and click Continue" copy (`page.tsx:2403`, `3016`, `3922`). We are promoting the existing skip path to the default, not building a new one.
2. **The checklist already covers the gap correctly.** Verified, not assumed:
   - `guest_booking_ready` calls `fetchAppointmentCatalog` **without** `includeCalendarsWithoutServices`, so calendars with no services are excluded and the count drops to zero (`src/lib/setup-guest-booking-ready.ts:20`). The "Create services" row genuinely reappears.
   - Classes, Events, and Resources are keyed to real catalogue counts via `getSecondaryCatalogSteps`, and `activeModelsToLegacyEnabledModels` strips the primary model, so there is no duplicate row.
   - `availability_set` is satisfied by the Calendars step, which is correct: that row is about calendars, not services.
3. **Precedent exists for both the rollout and the step remap**: the `appointments_onboarding_unified_flow` venue column plus `migrateOnboardingStepToCurrentLayout` (`page.tsx:564`).

## 2. Blockers to clear first

Two defects would be made materially worse by this change. Both must land before the steps are removed.

### 2.1 The checklist can never complete without Stripe

`isSetupComplete` requires `stripe_connected` (`SetupChecklist.tsx:133`). For the majority of venues that never intend to take payments, the What's next card can never reach 100% and never auto-hides. Their only exit is the X, which dismisses the **entire** checklist behind a "Dismiss setup steps?" dialog.

Move Stripe out of onboarding without fixing this and we trade one screen of friction for a permanent dashboard nag that trains people to kill the whole helper. `first_booking_made` has the same shape.

### 2.2 The "You're all set!" screen would be inaccurate

`page.tsx:4457` asserts "You have already set services, opening hours, and working hours" and then hands over the public booking link (`page.tsx:4510`). With services deferred, that venue's booking page has nothing bookable. The copy has to change and the link needs a caveat.

## 3. Phase 0: make checklist steps individually optional (implemented)

**Files:** `SetupChecklist.tsx`, `compute-setup-status.ts`, new API route, new migration, `SetupChecklist.test.ts`.

### 3.1 Storage decision

Snooze state **must not** use `localStorage`. `/auth/signed-out` responds with `Clear-Site-Data: "cache", "storage"` (`src/app/auth/signed-out/route.ts:66`), which wipes it on every sign-out. A "stop asking me about Stripe" preference that resets each time the user logs out is worse than no feature.

Note the existing `completeOnClick` clicked-steps store (`SetupChecklist.tsx:233`) already has this flaw. It is a soft nudge so it has been tolerated, but do not extend the pattern. Out of scope here; worth a separate ticket.

Persist server-side instead, mirroring `dashboard_setup_checklist_dismissed_at` (added in `supabase/migrations/20260514120100_staff_dashboard_setup_checklist_dismissed.sql`).

### 3.2 Work

1. **Migration** `supabase/migrations/<ts>_staff_setup_checklist_snoozed_steps.sql`:
   ```sql
   alter table staff
     add column if not exists dashboard_setup_checklist_snoozed_keys text[] not null default '{}';
   ```
2. **`Step` gains `optional?: boolean`.** Mark `stripe_connected` and `first_booking_made` optional. The post-onboarding prompts are already soft.
3. **`SetupStatus` gains `setup_checklist_snoozed_keys: string[]`**, read in `computeSetupStatus` from the same `staff` row query that already fetches the dismiss timestamp (`compute-setup-status.ts:148`). No extra round trip.
4. **`isSetupComplete` ignores snoozed and optional-unsnoozed steps** when deciding whether to auto-hide the card. Concretely: the card completes when every non-optional step is complete and every optional step is either complete or snoozed.
5. **New route** `POST /api/venue/setup-checklist-snooze` taking `{ step_key: string }`, admin-only, array-append with dedupe. Copy the auth shape from `src/app/api/venue/setup-checklist-dismiss/route.ts` exactly.
6. **UI**: a "Not now" text button beside the action link on optional rows. Snoozed rows drop out of `incompleteSteps`.
7. **Tests** in `SetupChecklist.test.ts`: `getSteps` marks the right rows optional; `isStepComplete` treats a snoozed optional row as done; `isSetupComplete` returns true with Stripe snoozed and false with Stripe merely incomplete.

### 3.3 Copy

Button: `Not now`. Confirmation is unnecessary; this is reversible in principle and low stakes.

### 3.4 Row layout, found during implementation

The checklist row was a single flex line with the action button `flex-shrink-0`. Adding a second control broke it at 375px: the description was squeezed to a 20px column and the row grew to 383px tall. The row now wraps (`flex-wrap` with the control cluster at `w-full sm:w-auto`), so on mobile the buttons sit on their own right-aligned line and the description keeps full width. Desktop rendering is byte-for-byte unchanged (verified: identical row heights, 16px text-to-controls gap).

This also improves the pre-existing single-control rows, which were already cramped on mobile at 102px of description width.

### 3.5 Deployment note: migration must land first

Confirmed against the dev database, which has not had the migration applied. `computeSetupStatus` selects the new column; PostgREST rejects the whole select with `column staff.dashboard_setup_checklist_snoozed_keys does not exist`, the row comes back null, and **every staff member's `setup_checklist_dismissed` silently reads as false**, un-hiding the checklist for people who had dismissed it. The endpoint still returns 200, so this fails quietly.

`computeSetupStatus` now logs that read failure explicitly, so if it ever happens in production it reads as a deploy-order problem rather than a mystery. Apply the migration before shipping the code.

## 4. Phase 1: fix the final onboarding screen (implemented)

**Files:** `page.tsx` preview step, new `src/lib/venue/onboarding-preview-catalog.ts` (+ tests).

1. `guest_booking_ready` is read from the existing `/api/venue/setup-status` endpoint, no new query. `booking_model` is taken from the same response so it matches the model the flag was computed for, rather than trusting `venue.booking_model`, which can differ for multi-model venues.
2. The claim that services are set is now gated on the server confirming it. Three states, resolved by `resolvePreviewCatalogState`:
   - **missing**: heading becomes "Your calendars are ready", the amber block becomes "One more thing before guests can book", and a link to the right dashboard page is added at the top of the list.
   - **ready**: unchanged from today.
   - **unknown** (loading or the call failed): claims nothing either way, falling back to the hours-only wording that was already correct.
3. The booking link stays visible but is relabelled "Your booking page address" with "Guests will see an empty page until you add your first service."
4. No change needed: `handleGoLive` already routes to `/dashboard`.

The copy is model-aware (service / class / event / resource), so a classes-only venue is not told to add a service. Restaurants are excluded by design and their screen is untouched.

**Timing.** The fetch starts on the `dashboard` step, two steps before `preview`, so the final screen does not visibly flip from "You're all set!" to the corrected heading. Older plus-tier flows have no `dashboard` step and resolve on arrival; they show the neutral wording until it lands, which is accurate either way.

## 5. Phase 2: remove the steps (implemented)

**Files:** new `src/lib/venue/onboarding-steps.ts` (+ tests), `page.tsx`, the three venue-provisioning call sites, `PATCH /api/venue/onboarding`, new migration.

### 5.1 Target layout

```
welcome → profile → opening_hours → team (Calendars) → hours (Calendar Availability) → users → dashboard → preview
```

Removed: the four per-model catalogue steps and `stripe_onboarding`. `users` still respects `omitOtherUsersStep` for the Light tier. `hours` still respects `appointmentsPlanNeedsCalendarAvailabilityStep`. Confirmed by test: 13 steps down to 8 for a venue running all four models, 8 for a single-model venue, 7 for Light.

The step builders and the remap moved out of `page.tsx` into `src/lib/venue/onboarding-steps.ts` so they can be unit tested at all. `page.tsx` lost about 160 lines.

### 5.2 Rollout column

1. Migration `20270102121000_appointments_onboarding_lean_flow.sql`, mirroring the `appointments_onboarding_unified_flow` precedent. It also backfills `true` for venues that already completed onboarding, since their stored index is never read again.
2. Set `true` for new venues at all three provisioning sites.
3. Accepted in `PATCH /api/venue/onboarding` and added to the venue select list.

### 5.3 In-flight venue remap

Two one-shot remaps, each gated by its own marker column: `!unifiedFlow` covers venues still on the pre-unified layout, `!leanFlow` covers venues that were mid-flow when the catalogue and Stripe steps were dropped. A venue needing the first gets the second free, since the target layout is already lean.

**The fallback rule changed during implementation.** The plan proposed a fixed priority order for vanished keys. A test proved that cannot work: `stripe_onboarding` sat *fifth* in the pre-unified layout (before the invite step) and *second from last* in the layout after it, so no single running order is correct for both. A venue parked on the early Stripe step was flung to `preview`, skipping calendar availability, invites, and the dashboard tour.

`migrateOnboardingStepToCurrentLayout` now walks forward through the **legacy layout being migrated from** and resumes at the first step that still exists. That needs no constant, is correct for any pair of layouts, and is what the tests assert.

Note the corollary: the remapped index may be **lower** than the stored one, and that is correct. Dropping steps shortens the flow, so "the next surviving step" can sit at a smaller number. The invariant asserted in tests is on step order, not on the index.

### 5.4 Stripe return handling

No work needed: `POST /api/venue/stripe-connect` already defaults `returnPath` to `/dashboard/settings?stripe=success` (`route.ts:39`) and only overrides it from a caller-supplied value. The onboarding-side return effect exits safely when the step is absent (`stripeIndex < 0`), so it can be deleted in Phase 3.

### 5.5 Restaurant flow: deferred, blocked on a live bug

The plan recommended removing Stripe from the restaurant flow too. **Not done**, and it should stay blocked until a separate defect is fixed.

`migrateRestaurantOnboardingStepToCurrentLayout` runs on **every** onboarding load with no marker guard, unlike the appointments remap. It therefore re-interprets an already-current index against the legacy layout and moves restaurants **backwards**. Verified by simulating both builders:

```
table management ON:  stored 5 (r_table_setup) -> 4 (r_services); 6 (r_dashboard) -> 4; 7 (stripe) -> 5; 8 (preview) -> 5
table management OFF: stored 5 (r_dashboard)   -> 4 (r_services); 6 (stripe)      -> 4; 7 (preview) -> 5
```

Any restaurant that reaches Table Setup or later, closes the tab, and returns is bounced back to Services. Adding another layout change to that path would compound a bug that already exists. Fix the guard first, then revisit.

### 5.6 Deployment: the migration is a hard prerequisite

Stronger than Phase 0's. `GET /api/venue/onboarding` selects the new column, so on an unmigrated database the select fails and the route returns **404 "Venue not found"**, taking down the entire onboarding wizard for every venue. Verified against the dev database.

The route now logs the underlying cause, since a missing column and a genuinely absent venue were previously indistinguishable in the response:

```
[GET /api/venue/onboarding] venue select failed: column venues.appointments_onboarding_lean_flow does not exist
```

Apply `20270102121000_appointments_onboarding_lean_flow.sql` before shipping the code.

### 5.7 Out of scope

Venues that are neither appointments-plan nor restaurant still use `buildLegacyGenericNonRestaurantOnboardingSteps`, which retains its own `services` and `stripe_onboarding` steps. Untouched here.

## 6. Phase 3: delete the dead code

Once every venue carries the lean flag, roughly 1,700 lines of render blocks and 350 lines of save handlers become unreachable in a 4,651-line file. Do this as a **separate commit** so Phase 2 stays reviewable and revertible.

| Step | Save handler | Render block |
|---|---|---|
| `services` | `1799` to `1877` | `2826` to `2895` |
| `first_event` | `1936` to `2019` | `2984` to `3446` |
| `classes` | `2019` to `2095` | `3447` to `3877` |
| `resources` | `2095` to approx. `2260` | `3878` to `4385` |
| `stripe_onboarding` | `1481` to `1498` | `2383` to `2421` |

Also then unused: `OnboardingAppointmentServiceList` (`src/components/onboarding/OnboardingAppointmentServiceList.tsx`, no other consumer), the `services` / `classes` / `resources` / `eventDraft` state and their defaulting effects (`page.tsx:1191` to `1259`), the business-config service prefill (`page.tsx:1011`), the roster prefetch key list (`page.tsx:1216`), and `servicesSyncReady` (`page.tsx:1261`).

Check `buildLegacyAppointmentsPlanModelSteps` and `buildLegacyGenericNonRestaurantOnboardingSteps` are still needed for the older remap chain before touching them. They are index-remap fixtures, not live layouts, and must keep describing history accurately.

## 7. Testing

Existing coverage is thin: `SetupChecklist.test.ts` is the only test touching any of this, and the onboarding page has none.

**Unit (add):**
- `buildAppointmentsPlanModelSteps` returns the lean layout for one model and for all four.
- `migrateOnboardingStepToCurrentLayout` maps each removed key forward to `dashboard`, and never returns an index below the stored one for those keys.
- Light tier still omits `users`.
- The Phase 0 checklist assertions in section 3.2.

**Manual, per booking model:**
1. Fresh signup on each of the four models, confirm the step list and that the dashboard checklist lists the missing catalogue.
2. Existing venue parked on each removed step, confirm it resumes on `dashboard` and does not lose `maxCompletedStep`.
3. Venue that completes onboarding with zero services: booking page shows the empty state, checklist shows "Create services", and completing that step flips the row.
4. Stripe connect from Settings returns to Settings.

## 8. Rollback

**Correction to the original plan.** Rollback is a code revert, not a per-venue boolean. `appointments_onboarding_lean_flow` is a one-shot *migration marker* (has this venue's stored index been remapped yet), matching the `appointments_onboarding_unified_flow` precedent. It does not gate which layout a venue sees, so flipping it back to false does not restore the old flow; it only causes the remap to run again.

Reverting the code does restore the old flow safely, because the remap maps by step key in both directions. Venues remapped to the lean layout resolve back onto the catalogue layout by key on the next load.

Phase 3 must trail Phase 2 by at least one release for this to hold: once the render blocks are deleted, a code revert is the only way back and it has to be a full revert.

Phase 0 and Phase 1 are safe to keep regardless: both are improvements to the current flow on their own terms.

## 9. Risk to watch after launch

The checklist is dismissible and the dismiss is persisted per staff member. If a meaningful share of venues dismiss it before adding services, we have moved the drop-off rather than removed it.

Instrument before committing permanently: count dismissals where `guest_booking_ready` is false at dismiss time. That single number tells us whether the checklist is genuinely carrying the work onboarding used to do. Log it from the existing dismiss route, which already has the venue and staff context in hand.

## 10. Open questions

1. Should `services` really go for a `unified_scheduling`-only venue, where a salon with no services has a dead booking page from day one? Recommendation: yes. The step's own copy already calls it optional and pitches it as a "pro tip" (`page.tsx:2861`), so it is not treated as load-bearing today. Phase 1 covers the honesty problem.
2. Do we keep `users` (Invite your team) in onboarding? Not part of this proposal, but it is the next-lightest candidate if the flow still feels long at eight steps.
3. Should the What's next card become non-dismissible until `guest_booking_ready` is true? Heavier-handed than the current design. Hold until the section 9 number says whether it is needed.
