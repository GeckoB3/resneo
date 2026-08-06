# ResNeo Customer Portal: Plan to World-Class Standard

**Status:** Proposed
**Owner:** TBC
**Created:** 2026-08-06
**Scope:** The customer-facing web portal at `/account`, its API surface under `/api/account/*`, and the shared guest-action logic it depends on. Mobile app work is scoped in Phase 5 but is explicitly out of scope for delivery here.

---

## 1. Purpose

The portal today is a competent read-only index. It lists bookings, and every action hands off to a separate tokenised page. This document sets out what must change for it to stand as the primary self-service surface for customers of ResNeo venues, and sequences the work so it can be picked up and executed without further discovery.

Two things are true and shape everything below:

1. The portal already has users. Accounts are provisioned silently on every online booking, so the customer base exists and grows automatically.
2. The portal has almost no test coverage and no e2e. Any plan that makes it a primary surface has to fix that first, not last.

---

## 2. Current state (verified)

### 2.1 What exists and works

| Area | Implementation | Assessment |
| --- | --- | --- |
| Auth foundation | `supabase/migrations/20260629120000_user_accounts_foundation.sql` (568 lines): `user_profiles`, `user_devices`, email-change trigger syncing `guests` and `staff`, `claim_user_account()`, `touch_user_last_active()`, RLS throughout | Solid, no changes needed |
| Account provisioning | `findOrCreateGuest` with `silentAuthSignup` (`src/lib/guests.ts`), enabled on `/api/booking/create`, `create-group`, `create-multi-service`, `/api/venue/bookings`, `/api/venue/waitlist`, class cart checkout, recurring materialisation | Working, no changes needed |
| Account discovery | Booking confirmation email renders a magic-link callout, "All your bookings: View or sign in to your account" (`src/lib/emails/templates/booking-confirmation.ts:80`) | Working, wording could improve |
| Multi-venue identity | `guests_account_safe` view aggregates every venue's guest row where `user_id = auth.uid()` | Strong differentiator, under-exploited |
| Routing | `resolvePostLoginDestination` plus `/auth/choose-destination` handle customer, staff, sales and dual-role users | Working, no changes needed |
| Class commerce | Credits, courses, memberships, recurring reservations. Keyed directly on `auth.users.id`, with checkout, enroll, fulfil and cancel routes | Functional |
| Profile | Name, phone, locale, timezone, default login destination, notification preferences, per-venue marketing consent, device list | Good |
| Security | Password set and change, sign out everywhere, GDPR delete request with cancel and hard-delete cron | Good |
| API auth | All 26 routes under `/api/account/*` use `createRouteHandlerClient`, which reads `Authorization: Bearer` and falls back to cookies | Already mobile-ready |

### 2.2 Confirmed gaps

**G1. The hub carries no data.**
`src/app/account/page.tsx` renders twelve static link cards. A signed-in customer sees a menu, not their next appointment.

**G2. Actions leave the portal.**
`src/app/account/bookings/page.tsx` and the detail page both render `<a href={manage_booking_link}>` pointing at `/manage/[bookingId]/[token]`. Cancel and reschedule are implemented there, against `POST /api/confirm` with `action: confirm | cancel | modify`, which authenticates by token or HMAC only. The portal cannot perform any write against a booking.

**G3. No rebook.**
Nothing in `/account` can start a new booking. The portal knows the customer's full cross-venue history and cannot act on it.

**G4. N+1 on every bookings render.**
`loadAccountBookings` (`src/lib/account/account-bookings.ts:418`) calls `hydrateAccountBookingRow` per row. Each hydration calls `createOrGetBookingShortLink`, which is 2 to 3 queries including writes (`src/lib/booking-short-links.ts`), plus `buildAccountCdeContext` queries. At the default limit of 100 that is several hundred queries per page load, minting short links for bookings the customer may never open.

**G5. Timezone-incorrect filtering.**
`src/lib/account/account-booking-filters.ts` compares `booking_date` against a UTC date string and ignores `booking_time` entirely. A booking earlier today still counts as upcoming; a booking in a venue on the other side of the date line lands in the wrong tab. The UI admits this: "Filters use the UTC calendar day."

**G6. Near-zero test coverage.**
Only `account-booking-filters.test.ts` and `account-hard-delete-eligibility.test.ts`. No component tests, no route tests, no e2e. Both e2e specs (`e2e/appointment-book-pay-confirm.spec.ts`, `e2e/guest-self-reschedule.spec.ts`) exercise the public booking and manage-link flows, not the portal.

**G7. Consumer polish.**
Twelve flat nav items in a horizontal scroller (`AccountNav.tsx`). Only two of eleven routes have `loading.tsx` (`events`, `resources`). No `error.tsx` anywhere. The hub shows a "Set up your business" B2B upsell to consumers.

**G8. Held data never surfaced.**
`guests_account_safe` exposes `visit_count`, `total_bookings_count`, `total_spent_minor`, `waiver_signed_at`, `waiver_version`. None of it is shown. Outstanding compliance forms exist (`loadOutstandingBookingFormLinks`, `src/lib/compliance/form-links-service.ts`) and are not surfaced. `booking_payments` is a full in-person payment ledger with no customer-facing receipt view.

**G9. Notification preferences are email-only.**
`notification_preferences` handles `operational_email` and `marketing_email`. No SMS channel, no push channel, despite `user_devices.push_token` existing and SMS being a live cost centre.

**G10. Customer push does not exist.**
The only sender is `src/lib/communications/staff-push-notification.ts`.

### 2.3 Architectural facts that constrain the plan

- **`/api/confirm/route.ts` is 1,770 lines** with cancel, confirm and modify logic inline, including Stripe refunds, card-hold settlement, class credit restoration, waitlist offer cascades and compliance enforcement. This is the logic the portal must reuse. It cannot be called as-is because it authenticates by token.
- **The mobile app is a separate React Native repository** (`reserveni-app`), not a webview shell over this app. It authenticates via Supabase Bearer tokens against `/api/venue/*` and is currently staff-only. See `Docs/MOBILE_API.md`. Web portal work does **not** automatically appear in the app.
- **UI primitives to reuse:** `src/components/ui/primitives` (Button, Dialog, Sheet, ConfirmDialog, Input, FormField, Label, IconButton, BrandSpinner) and `src/components/ui/dashboard` (PageHeader, SectionCard, EmptyState, BookingStatusPill, DashboardSkeletons, Pill, ScheduleRow). Conventions in `Docs/DESIGN_SYSTEM.md`, including the required migration rule away from hand-rolled modal overlays.

---

## 3. Architecture decisions

These should be settled before any code is written. Each is a decision, not an option list.

### AD1. Extract guest booking actions into a shared service layer

Create `src/lib/booking/guest-actions/` exporting pure service functions:

```
cancelBookingForGuest(admin, { bookingId, actor }): Promise<CancelResult>
rescheduleBookingForGuest(admin, { bookingId, newSlot, actor }): Promise<RescheduleResult>
confirmAttendanceForGuest(admin, { bookingId, actor }): Promise<ConfirmResult>
loadGuestBookingDetail(admin, { bookingId, actor }): Promise<GuestBookingDetail>
```

`actor` is a discriminated union:

```ts
type GuestActionActor =
  | { kind: 'token'; bookingId: string; token: string }
  | { kind: 'hmac'; bookingId: string; hmac: string }
  | { kind: 'session'; userId: string; guestIds: string[] };
```

Authorisation is resolved by a single `assertActorMayActOnBooking(admin, actor, booking)` helper. Token and HMAC paths keep their current semantics exactly. The session path requires `booking.guest_id ∈ guestIds`, where `guestIds` comes from `loadAccountSafeGuests`.

`POST /api/confirm` is refactored to a thin adapter over these functions. Behaviour must not change; the existing e2e specs are the guard.

**Rationale:** duplicating 1,770 lines of refund, card-hold and waitlist logic is not acceptable, and the token flow must keep working for guests without accounts.

### AD2. The portal performs actions in place; the token flow remains the no-login fallback

After Phase 2, `/account` never links out to `/manage/...`. The tokenised page stays fully supported for email recipients who are not signed in.

### AD3. Short links are minted on demand, never in list hydration

`hydrateAccountBookingRow` drops `manage_booking_link`. Any remaining need is served by `POST /api/account/bookings/[id]/manage-link`, called on user intent.

### AD4. All time comparisons use venue-local time against a real instant

Introduce `src/lib/account/booking-instant.ts` with `bookingStartInstant(row): Date` built from `booking_date`, `booking_time` and the venue timezone (falling back to profile timezone, then `Europe/London`). Filters compare instants, never date strings.

### AD5. The hub is server-rendered from one aggregate query

`GET /api/account/home` and a matching server loader return everything the hub needs in a bounded number of queries. No per-row fan-out.

### AD6. New API routes continue to use `createRouteHandlerClient`

This preserves Bearer support so Phase 5 needs no route rewrites.

---

## 4. Target customer journey

The plan is organised around the full journey. Every stage must have a portal answer.

| Stage | Customer need | Portal provision | Phase |
| --- | --- | --- | --- |
| Discover account | "I did not know I had one" | Magic-link CTA in confirmation and reminder emails; clear first-run state | 3 |
| Sign in | Fast, passwordless-first | Magic link, password optional, remembered device | Exists |
| Orient | "What is next?" | Hub with next appointment and inline actions | 1 |
| Prepare | Directions, what to bring, forms | Detail page with location, notes, outstanding forms, add to calendar | 2 |
| Change plans | Reschedule or cancel | In-portal, policy-aware, with fee and deadline shown before confirming | 2 |
| Cannot find a slot | Join waitlist | Waitlist join and status from the portal | 4 |
| Attend | Confirm attendance | Confirm action in portal, matching the email flow | 2 |
| Pay | Understand what was charged | Receipts from `booking_payments`, deposits, refunds, card holds | 4 |
| Return | Book again | Rebook from history, prefilled service and practitioner | 3 |
| Belong | Credits, courses, memberships | Existing sections, restructured under one "Passes and plans" area | 3 |
| Be reached appropriately | Channel control | Notification preferences covering email, SMS and push per category | 4 |
| Leave | Export and delete | Existing delete request, plus data export | 4 |
| Get help | Contact the venue | Venue contact card on every booking, help centre link | 2 |

---

## 5. Workstreams

Each task carries an ID, the files involved, and acceptance criteria. Tasks within a phase may be parallelised unless a dependency is stated.

### Phase 0: Foundations (must precede all UI work)

**P0-1. Test harness for the portal**
- Add `src/app/account/**` component tests using the existing vitest setup.
- Add route tests for all 26 `/api/account/*` routes covering: unauthenticated 401, cross-user access denial, happy path.
- Add `e2e/account-portal.spec.ts` covering sign in via magic link, view bookings, open detail.
- **Acceptance:** portal route coverage at 100 percent of routes having at least an auth test; e2e green in CI.

**P0-2. Timezone-correct booking instants** (AD4)
- New `src/lib/account/booking-instant.ts`.
- Rewrite `src/lib/account/account-booking-filters.ts` to take instants.
- Update `src/app/account/bookings/page.tsx` to drop the "Filters use the UTC calendar day" caveat.
- **Acceptance:** unit tests covering a booking earlier today (past), later today (upcoming), and a venue in `Australia/Sydney` and `America/Los_Angeles` around UTC midnight.

**P0-3. Remove the list-render N+1** (AD3)
- Drop `manage_booking_link` from `hydrateAccountBookingRow`.
- Batch `buildAccountCdeContext` into set-based queries keyed by `class_instance_id`, `experience_event_id`, `resource_id`.
- Add `POST /api/account/bookings/[id]/manage-link`.
- **Acceptance:** loading 100 bookings issues a bounded number of queries (target: under 10), verified by a query-count assertion in a route test. No short-link rows are written on a read.

**P0-4. Extract guest actions** (AD1)
- Create `src/lib/booking/guest-actions/` with the four service functions and the actor model.
- Refactor `POST /api/confirm` to delegate.
- **Acceptance:** `e2e/guest-self-reschedule.spec.ts` and `e2e/appointment-book-pay-confirm.spec.ts` pass unchanged. No behaviour change in emails sent, refunds issued, or card holds settled.

**P0-5. Loading and error states**
- Add `loading.tsx` and `error.tsx` to every route under `/account`.
- Use `DashboardSkeletons` where shape is known.
- **Acceptance:** every route has both; no route falls back to a blank screen on error.

### Phase 1: The hub

**P1-1. Hub aggregate loader** (AD5)
- `src/lib/account/account-home.ts` returning: next upcoming booking (hydrated), count of upcoming, outstanding form links, active credits and membership summary, venues used.
- `GET /api/account/home` wrapping it.

**P1-2. Hub redesign**
- Replace the static grid in `src/app/account/page.tsx`.
- Above the fold: next appointment card showing venue, service, practitioner, date and time in venue-local time with timezone label, status pill, and inline Reschedule, Cancel, Add to calendar, Directions.
- Below: outstanding actions (forms to complete, unpaid balances), then a compact "Upcoming" list, then quick links.
- Empty state for a customer with no bookings: prompt to find a venue, not a menu.
- Remove the "Set up your business" card. Move that to the profile page footer as a single quiet link.
- **Acceptance:** a customer with one upcoming booking sees it without scrolling on a 375px viewport; hub issues one round of queries.

**P1-3. Navigation restructure**
- Collapse `AccountNav` to four primary items: Bookings, Passes and plans, Profile, Help.
- "Passes and plans" hosts credits, courses, memberships and recurring as tabs.
- Keep the venue dashboard switch link for dual-role users.
- **Acceptance:** no horizontal scroll on the nav at 375px.

### Phase 2: In-portal booking management

**P2-1. Session-authenticated booking action routes**
- `GET /api/account/bookings/[id]` (detail, replacing the current server-only load)
- `POST /api/account/bookings/[id]/cancel`
- `POST /api/account/bookings/[id]/reschedule`
- `GET /api/account/bookings/[id]/reschedule-options`
- `POST /api/account/bookings/[id]/confirm`
- All delegate to Phase 0 service functions with `actor.kind === 'session'`.
- **Acceptance:** each route returns 404 (not 403) for a booking belonging to another user, to avoid existence disclosure. Route tests cover this explicitly.

**P2-2. Cancel in portal**
- `ConfirmDialog` from primitives. Must show, before confirming: cancellation deadline, whether a deposit is refundable, any card-hold late-cancellation fee (`formatCardHoldFeePence`), and for class sessions whether credits are restored.
- **Acceptance:** the fee and refund copy match exactly what `/manage` shows for the same booking. Verified by a shared-snapshot test.

**P2-3. Reschedule in portal**
- Reuse the availability call pattern from `ManageBookingView` (`/api/booking/availability`).
- Respect the `guest_self_reschedule` feature flag (default true, `src/lib/feature-flags/resolve.ts`). When off, hide the action and explain that the venue does not allow self-reschedule.
- Handle the multi-session course case: reschedule affects one session only, with the existing warning copy.
- **Acceptance:** e2e reschedule through the portal, mirroring `e2e/guest-self-reschedule.spec.ts`.

**P2-4. Booking detail rebuild**
- Sections: status and countdown, when and where (with map link and `booking_location` handling for client-address and online bookings), service and practitioner, price breakdown, deposit and card-hold state, outstanding forms, special requests and notes, venue contact, action bar, timeline.
- Add to calendar via `buildGoogleCalendarAddUrlForBooking` plus an `.ics` download.
- **Acceptance:** parity with `/manage` on every field a guest can see, plus the fields only the portal knows (cross-venue history).

**P2-5. Retire the outbound manage links**
- Remove `<a href={manage_booking_link}>` from list and detail.
- **Acceptance:** no `/manage/` link is rendered anywhere under `/account`.

### Phase 3: Growth and retention

**P3-1. Rebook**
- "Book again" on any past booking, deep-linking to `/book/[venue-slug]` with service, practitioner and duration preselected via query params.
- Requires a documented prefill contract; extend `Docs/Embed_Public_Booking_URL_Contract.md`.
- **Acceptance:** one tap from a past booking lands on the booking page with the same service and practitioner chosen.

**P3-2. Venue history and visit summary**
- Per-venue card: visits, first and last booked, total spent (`total_spent_minor`), next booking, "Book again".
- **Acceptance:** a customer using three venues sees three cards ordered by last booked.

**P3-3. Passes and plans consolidation**
- Merge credits, courses, memberships and recurring into one route with tabs.
- **Acceptance:** four old routes redirect; no functionality lost.

**P3-4. Account discovery improvements**
- Add the magic-link account callout to reminder emails, not only confirmations.
- First-run interstitial on first portal visit explaining what the account does and offering to set a password.
- **Acceptance:** callout renders in reminder templates; template gallery updated.

### Phase 4: Completeness

**P4-1. Outstanding forms surfaced**
- Hub and booking detail show incomplete compliance forms with a direct link via `complianceFormPublicUrl`.
- **Acceptance:** a booking with an outstanding waiver shows an action on the hub.

**P4-2. Receipts and payment history**
- `GET /api/account/payments` reading `booking_payments` plus deposit and refund state.
- Per-booking receipt view and an account-level payment list.
- **Acceptance:** an in-person card payment recorded by staff appears to the customer within one refresh.

**P4-3. Notification preferences across channels** (addresses G9)
- Extend `notification_preferences` to a per-category, per-channel matrix: reminders, changes, marketing across email, SMS, push.
- Migration must default existing users to current behaviour exactly.
- **Acceptance:** turning off SMS reminders stops SMS and leaves email untouched; verified by a comms renderer test.

**P4-4. Waitlist from the portal**
- Join, view and cancel waitlist entries against `/api/booking/appointment-waitlist`.
- **Acceptance:** a customer can join a waitlist for a venue they have used and see status.

**P4-5. Data export**
- Machine-readable export of bookings, profile and payments, alongside the existing delete request.
- **Acceptance:** export completes for an account with 500 bookings without timing out.

### Phase 5: Mobile app enablement (scoped, not delivered here)

The React Native app is a separate repository. This phase is the ResNeo-side work that unblocks it.

**P5-1. Confirm API completeness for customer surfaces**
- All routes needed by the customer app already exist and are Bearer-aware. Audit and document them in `Docs/MOBILE_API.md` under a new "Customer routes" section.

**P5-2. Customer push infrastructure**
- Build `src/lib/communications/customer-push-notification.ts` mirroring the staff sender.
- Wire to reminders, changes and waitlist offers, gated by P4-3 preferences.
- Deep-link payloads targeting `/account/bookings/[id]`.

**P5-3. Deep link contract**
- Document the `reserveniapp://` route map for customer surfaces.

**Explicit note:** the app repo needs its own customer UI. Nothing in Phases 0 to 4 appears in the app automatically. Web-first is still correct because it validates flows, copy and policy handling against real users at lower cost, and leaves the API contract settled before native work starts.

---

## 6. Cross-cutting requirements

**Accessibility.** Every interactive element keyboard reachable. Dialogs follow the manual a11y checklist in `Docs/DESIGN_SYSTEM.md`. Status is never conveyed by colour alone. Target WCAG 2.2 AA.

**Copy.** Plain, warm, second person, aimed at non-technical customers. No em-dashes (`CLAUDE.md`). Every destructive action states its consequence before confirming.

**Performance budget.** Hub and bookings list under 10 database queries each. No writes during a read. Time to first contentful paint under 1.5s on a mid-tier mobile device.

**Security.** Cross-user access returns 404. All booking access scoped through `loadAccountSafeGuests`, never by raw `booking_id`. No venue-private fields (`notes`, `tags`, `custom_fields`, `no_show_count`) may cross into a customer response; `guests_account_safe` is the only permitted guest projection.

**Timezone.** Every rendered time carries a venue-local value and an explicit timezone label where it differs from the customer's profile timezone.

**Testing gate.** No task is complete without unit tests for logic, a route test for any new endpoint, and an e2e for any new customer-visible flow.

**Analytics.** Instrument portal sign-in, hub view, cancel, reschedule, rebook, and form completion so retention impact is measurable against the SMS and support-cost case for the work.

---

## 7. Data model changes

Only two migrations are anticipated.

1. **Notification preferences matrix** (P4-3). Extend the `notification_preferences` JSON shape on `user_profiles`. Backfill must preserve current effective behaviour for every existing row.
2. **Optional: `user_profiles.portal_first_seen_at`** (P3-4) to drive the first-run interstitial once.

No new tables are required. Receipts, forms, waitlist and history all read from existing tables.

---

## 8. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Refactoring `/api/confirm` regresses refunds or card-hold settlement | High. Financial. | P0-4 is guarded by both existing e2e specs. Refactor is mechanical delegation with no logic change. Ship it alone, before any UI work. |
| Portal and manage page drift apart on policy copy | Medium. Customer confusion, disputes. | Shared copy helpers and a snapshot test asserting both surfaces render identical fee and deadline text. |
| Cross-venue data leak through a new endpoint | High. Privacy. | Every new route scoped via `loadAccountSafeGuests`; 404-on-foreign-booking asserted in route tests. |
| Scope creep into commerce | Medium. Delay. | Receipts read the existing ledger only. No product, cart or inventory concepts enter this plan. |
| Notification preference migration changes who gets messaged | High. Trust, possible compliance issue. | Backfill defaults to current behaviour; a dry-run diff of intended recipients before and after must be produced and reviewed. |

---

## 9. Sequencing and estimate

| Phase | Content | Estimate |
| --- | --- | --- |
| 0 | Foundations: tests, timezone, N+1, action extraction, loading states | 1.5 to 2 weeks |
| 1 | Hub and navigation | 1 week |
| 2 | In-portal cancel, reschedule, confirm, detail rebuild | 2 to 2.5 weeks |
| 3 | Rebook, venue history, consolidation, discovery | 1.5 weeks |
| 4 | Forms, receipts, notification matrix, waitlist, export | 2 weeks |
| **Total (web, world-class)** | | **8 to 9 weeks** |
| 5 | Mobile enablement (ResNeo side only) | 1.5 weeks |

Phase 0 is non-negotiable and must ship before Phase 1. Phases 3 and 4 can be reordered against commercial priority. A credible reduced scope is Phases 0 to 2, which delivers a portal that is genuinely useful, at roughly 4.5 to 5.5 weeks.

---

## 10. Definition of done

The portal is world-class when a customer can, without contacting the venue and without leaving `/account`:

1. See their next appointment immediately on sign-in.
2. Reschedule or cancel it, understanding the fee and deadline before confirming.
3. Complete any form the venue requires.
4. See what they paid and what was refunded.
5. Book the same thing again in one action.
6. See their history across every ResNeo venue they use.
7. Control which messages they get, on which channel.
8. Export or delete their data.

And the team can change the portal safely, because every route has a test and every customer-visible flow has an e2e.
