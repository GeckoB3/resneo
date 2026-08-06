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

**G11. First entry to the portal takes two emails and three clicks.**
This is the first impression for essentially every customer, and it is the weakest part of the product. Traced end to end:

| # | Step | Where |
| --- | --- | --- |
| 1 | Open confirmation, scroll to the final card | Email 1 |
| 2 | Click "View or sign in to your account" | Email 1 |
| 3 | Land on a sign-in form, email pre-filled | `/auth/magic` |
| 4 | Click "Email me a sign-in link" | Browser |
| 5 | See "Check your inbox" | Browser |
| 6 | Switch to email app, wait for delivery | Email app |
| 7 | Open a second, unbranded email | Email 2 |
| 8 | Click "Sign in to ResNeo" | Email 2 |
| 9 | `verifyOtp`, `claim_user_account`, resolve destination | `/auth/confirm` |
| 10 | Arrive at a generic bookings list | `/account/bookings` |

Specific defects inside that flow:

- **G11a.** `accountBookingsMagicLinkUrl` (`src/lib/emails/account-portal-links.ts:20`) hardcodes `redirect=/account/bookings`, so the customer lands on a list rather than the booking they just made.
- **G11b.** The sign-in email is raw inline HTML with no logo and no template (`src/app/api/auth/send-magic-link/route.ts:86`), while the booking confirmation is fully branded. The quality drop mid-flow reads as a phishing attempt.
- **G11c.** ~~`POST /api/auth/send-magic-link` is public, unauthenticated and **not rate limited**~~ **Fixed, see P3-4f.** It would send mail to any address on demand, an abuse vector against arbitrary third parties rather than only a ResNeo problem.
- **G11d.** Link lifetime is 1 hour, short for anyone who reads email away from a browser.
- **G11e.** The "Check your inbox" state does not name the address it sent to, and offers no resend. The only recovery is "Use a different email address".
- **G11f.** The email sets `context=customer`, which `/auth/magic/page.tsx` never reads. Dead parameter. The same dead parameter also appears in the account-deletion email (`src/app/api/account/delete-request/route.ts`).

**G12. Booking reads have no defence in depth. Highest-severity item in this document.**
RLS is enabled on `bookings` (`supabase/migrations/20260301000007_rls_policies.sql:8`), but every policy on it is staff-scoped or linked-venue-scoped. There is **no customer SELECT policy**. That is precisely why `src/lib/account/account-bookings.ts` reads through the admin client, which bypasses RLS entirely.

The only control preventing one customer from reading every customer's bookings is a single application-level filter, `.in('guest_id', guestIds)`, repeated by hand in `loadAccountBookings`, `loadAccountUpcomingBookingsByModel` and `loadAccountBookingById`. There is no database backstop. A dropped or weakened filter in any one of them, or in any route added later, leaks the entire bookings table to an authenticated customer.

Phase 2 of this plan adds five more routes built on exactly this pattern. The control must be fixed **before** the pattern is multiplied, not after.

**G13. Destructive actions are inconsistently confirmed, and the most costly one is not confirmed at all.**

| Action | Current confirmation | Assessment |
| --- | --- | --- |
| Cancel membership (`AccountMembershipsSection.tsx:218`) | **None.** `onClick` calls the API directly | Cancels recurring revenue in one click, with no statement of consequence and no undo |
| Cancel course enrollment (`AccountCoursesSection.tsx:215`) | `window.confirm` | Works, but unstyleable and against the design system |
| Delete recurring rule (`AccountRecurringSection.tsx:201`) | `window.confirm` | Same |

`Docs/DESIGN_SYSTEM.md` carries a required migration rule away from hand-rolled and native overlays, and `npm run lint:modals` enforces its spirit. Native `window.confirm` also renders the domain name on mobile, which reads to customers as a security warning.

**G14. Saved cards cannot be removed.**
`/api/account/payment-methods` exports only `GET`; `setup-intent` exports only `POST`. No detach route exists anywhere in the codebase. A customer can add a payment instrument and never delete it, which is a poor experience and awkward to answer under a data-rights request.

**G15. The portal uses none of the design system.**
Zero files under `src/app/account` or `src/components/account` import from `@/components/ui/primitives`. There are 22 hand-rolled `<button>` elements carrying inline Tailwind. Consequences: the portal drifts visually from the dashboard, and it inherits none of the accessibility or behaviour fixes made to `Button`, `Dialog`, `ConfirmDialog` or `FormField`. Rebuilding portal screens is therefore a **migration**, not a restyle, and phase estimates must reflect that.

**G16. Two known WCAG 2.2 AA failures.**
- **No `aria-current` anywhere.** The active navigation item and the active bookings filter tab are conveyed by background colour and font weight only.
- **No `aria-live`, `role="status"` or `role="alert"` anywhere.** Every asynchronous outcome is silent to screen readers: profile saved, cancellation scheduled, checkout failed, credits purchased. This is WCAG 4.1.3 Status Messages, and the portal is almost entirely asynchronous client components.

Accessibility here is remediation of known defects, not a review step at the end.

**G17. Booking history truncates silently at 100.**
`src/app/account/bookings/page.tsx:50` calls `loadAccountBookings(supabase, admin, 100)`. There is no pagination, no "load more", and no message telling the customer their history is cut off. A salon client is unaffected; a class member attending three times a week passes 100 within a year and quietly loses their past.

**G18. Three overlapping navigation systems.**
`/account` is a twelve-card static grid, `/account/classes` is a **second** static hub listing six of the same destinations, and `AccountNav` lists twelve items. A customer meets three different menus before reaching any content.

**G19. Consumer copy exposes Stripe implementation detail.**
`src/app/account/classes/page.tsx` ships "Cards on file per venue (Connect customer)", "Subscriptions billed on each venue's Stripe account", and "Standing reservations processed by the venue schedule" to non-technical customers. `CLAUDE.md` requires plain language aimed at non-technical business owners; the same bar applies to their customers.

**G20. The two most anxiety-inducing emails are the two that look least like ResNeo.**
Both the sign-in email (G11b) and the account-deletion email (`src/app/api/account/delete-request/route.ts`) are raw inline HTML with no logo and no template, while booking confirmations are fully designed.

### 2.3 Gap to task traceability

Every gap has at least one task that closes it. Nothing in §2.2 is left unaddressed, and no task exists without a gap or journey stage behind it.

| Gap | Closed by | Phase |
| --- | --- | --- |
| G1 Hub carries no data | P1-1, P1-2 | 1 |
| G2 Actions leave the portal | P2-1 to P2-5 | 2 |
| G3 No rebook | P3-1 | 3 |
| G4 N+1 on list render | P0-3 | 0 |
| G5 Timezone-incorrect filtering | P0-2 | 0 |
| G6 Near-zero test coverage | P0-1 | 0 |
| G7 Consumer polish, loading and error states | P0-5, P1-2, P1-3 | 0, 1 |
| G8 Held data never surfaced | P3-2, P4-1, P4-2 | 3, 4 |
| G9 Notification preferences email-only | P4-3 | 4 |
| G10 No customer push | P5-2 | 5 |
| G11 Two emails and three clicks to enter | P3-4a to P3-4h | 3 |
| G11c Unrated-limited send endpoint | **P3-4f, shipped** | Done |
| G12 No defence in depth on booking reads | **P0-6 (blocks Phase 2)** | 0 |
| G13 Inconsistent or absent confirmation | P2-6 | 2 |
| G14 Saved cards cannot be removed | P4-6 | 4 |
| G15 No design-system adoption | P0-7 | 0 |
| G16 WCAG 2.2 AA failures | P0-8 | 0 |
| G17 History truncates silently at 100 | P4-7 | 4 |
| G18 Three navigation systems | P1-3 | 1 |
| G19 Stripe jargon in consumer copy | P1-4 | 1 |
| G20 Unbranded transactional emails | P3-4e, P4-8 | 3, 4 |

### 2.4 Architectural facts that constrain the plan

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

### AD7. First entry to the portal is one click from the confirmation email, on a scoped session

The account link in transactional emails carries a signed, user-scoped token that establishes a **limited portal session** directly. No second email, no interstitial.

The justification is consistency, not convenience. The same email already carries `manage_booking_link`, which lets whoever holds it cancel a booking and trigger a refund with no second factor. Requiring a full email round trip to *read* the same booking applies a higher bar to a strictly lower-risk action.

**Scope of a token-established session.** Permitted: view bookings, cancel, reschedule, confirm attendance, complete forms, add to calendar. Denied: change email, change password, manage passkeys, view or add saved payment methods, request account deletion, view another venue's data beyond what `guests_account_safe` already returns. Denied actions redirect to a step-up sign-in at `/auth/magic`.

**Token properties.**

- User-scoped, not booking-scoped, so `booking_short_links` cannot be reused (its `purpose` CHECK and `booking_id` FK are both wrong for this).
- **Reusable within its window, never single-use.** Corporate link scanners (Outlook Safe Links, Proofpoint, Mimecast) fetch every URL in inbound mail. A single-use token is consumed before the human clicks. This property is mandatory, not an optimisation.
- No state mutation on GET, for the same reason.
- 30-day validity, revoked when the related booking is more than 30 days past.
- Stored hashed, never in plaintext.

**`/auth/magic` is retained** as the fallback for a missing, expired or revoked token, and for anyone arriving without one. Its current button-gated send is correct behaviour for that path and must not regress to auto-send on mount (see the note in `AuthMagicForm.tsx`).

### AD8. Customer booking access is enforced in the database, not only in application code

Addresses G12. Today the application-level `guest_id` filter is the sole control. It becomes the second of two.

Add a customer SELECT policy on `bookings`:

```sql
CREATE POLICY "customer_can_view_own_bookings" ON public.bookings
  FOR SELECT TO authenticated
  USING (
    guest_id IN (SELECT id FROM public.guests WHERE user_id = auth.uid())
  );
```

Portal reads then move from the admin client to the **session client**, so RLS applies. The existing `.in('guest_id', guestIds)` filters stay exactly as they are. Two independent controls, either of which is sufficient on its own.

**Where the admin client is still legitimate.** Some hydration reads join tables a customer has no policy on (`class_instances`, `class_types`, `experience_events`, `venues`). Those may keep using admin, but only after the parent booking has been authorised through the session client. The rule is: **the row that establishes ownership is read under RLS; derived context may be read as admin.**

**Non-negotiable acceptance:** a test signs in as customer A, queries `bookings` directly through a session client with no application filter at all, and receives only A's rows. If that test cannot be written, the policy is wrong.

---

## 4. Target customer journey

The plan is organised around the full journey. Every stage must have a portal answer.

| Stage | Customer need | Portal provision | Phase |
| --- | --- | --- | --- |
| Discover account | "I did not know I had one" | Account CTA in confirmation and reminder emails; clear first-run state | 3 |
| First entry | One click, no second email | Scoped token link straight into the booking just made (AD7) | 3 |
| Sign in later | Fast, passwordless-first | Long session, passkey offered after first arrival, `/auth/magic` as fallback | 3 |
| Step up | Protect sensitive actions | Fresh magic link before email, password, passkey, payment methods or deletion | 3 |
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

**Hard dependencies.** Everything else can be reordered.

```
P0-6 (RLS backstop)          ──> P2-1 (session action routes)   [BLOCKING]
P0-7 (design system)         ──> P1-2, P1-3, P2-2, P2-3, P2-4, P2-6
P0-4 (extract guest actions) ──> P2-1 (session action routes) ──> P2-2, P2-3, P2-4
P0-2 (booking instants)      ──> P1-1 (hub loader), P1-2 (hub)
P0-3 (remove N+1)            ──> P1-1 (hub loader)
P1-1 (hub loader)            ──> P1-2 (hub UI)
P2-6 (confirm dialogs)       ──> P4-6 (card removal)
P3-4a (token infra)          ──> P3-4b, P3-4c, P3-4d
P4-3 (preference matrix)     ──> P5-2 (customer push)
```

**P0-6 blocks Phase 2 absolutely.** Every route added in Phase 2 inherits whichever access-control model exists when it is written. Adding five routes on the current model and retrofitting afterwards means auditing five routes instead of fixing one pattern.

**P0-7 should precede Phases 1 and 2** for cost, not correctness. Those phases rebuild the same components; migrating to primitives afterwards means touching them twice.

`P3-4f` had no dependencies and has already shipped. `P3-4d` (land on the specific booking) depends on `P3-4a` only for the token; the redirect-target change alone can ship earlier. `P0-8` (accessibility) has no dependencies and can run in parallel with anything.

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

**P0-6. Database-enforced customer booking access** (implements AD8, closes G12)

**This is the highest-priority task in the plan and blocks Phase 2.** Every route Phase 2 adds inherits whichever access model exists when it is written.

- Migration adding `customer_can_view_own_bookings` to `public.bookings` as specified in AD8.
- Audit every read in `src/lib/account/` and move those that establish ownership from the admin client to the session client. Keep every existing `guest_id` filter.
- Document the rule in `Docs/Multi_model_RLS_and_API_audit.md`: ownership is established under RLS; derived context may be read as admin.
- **Acceptance:**
  1. A session client for customer A, querying `bookings` with **no application-level filter**, returns only A's rows.
  2. Existing portal behaviour is unchanged; the full suite passes.
  3. A test asserts a customer session cannot read a booking belonging to another user by id.
- **Risk note:** the policy uses a subquery on `guests`. Verify the query plan on a realistic dataset before merge, and add an index on `guests (user_id)` if the planner needs it (`idx_guests_user_venue` exists but leads with `user_id`, so confirm rather than assume).

**P0-7. Adopt the design system in the portal** (closes G15)

- Replace all 22 hand-rolled `<button>` elements with `Button` / `IconButton` from `@/components/ui/primitives`.
- Replace hand-rolled inputs and labels with `Input`, `Label` and `FormField`.
- Adopt `SectionCard`, `EmptyState` and `PageHeader` from `@/components/ui/dashboard` where the pattern matches.
- No visual redesign in this task. It is a like-for-like migration so that Phases 1 and 2 build on primitives rather than compounding the debt.
- **Acceptance:** zero raw `<button>` elements remain under `src/app/account` and `src/components/account`; `npm run lint:modals` passes; no visual regression beyond primitive defaults.
- **Sequencing note:** doing this first is cheaper than doing it during Phases 1 and 2, because those phases would otherwise rewrite the same components twice.

**P0-8. Accessibility remediation** (closes G16)

Known defects, not a review step.

- Add `aria-current="page"` to the active item in `AccountNav`, and `aria-current="true"` to the active bookings filter tab.
- Add a single polite live region per client component that reports async outcomes, and route every success and error message through it. Applies to `ProfileClient`, `AccountCreditsSection`, `AccountCoursesSection`, `AccountMembershipsSection`, `AccountRecurringSection`, `AccountPaymentMethodsSection` and `AuthMagicForm`.
- Errors that block progress use `role="alert"`; confirmations use `role="status"`.
- **Acceptance:** an automated axe pass over every `/account` route reports no violations at AA; a manual screen-reader pass confirms that saving the profile and failing a checkout are both announced.

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

**P1-3. Navigation restructure** (closes G18)
- Collapse `AccountNav` to four primary items: Bookings, Passes and plans, Profile, Help.
- "Passes and plans" hosts credits, courses, memberships and recurring as tabs.
- **Delete the second static hub at `/account/classes`** and redirect it into the new tabbed area. Its six links duplicate destinations already reachable from the nav and the hub.
- Keep the venue dashboard switch link for dual-role users.
- **Acceptance:** no horizontal scroll on the nav at 375px; exactly one navigation system reaches any destination; `/account/classes` redirects rather than 404s, since it may be linked from old emails.

**P1-4. Consumer copy pass** (closes G19)
- Remove Stripe and internal vocabulary from every customer-visible string. "Connect customer", "billed on each venue's Stripe account" and "Standing reservations processed by the venue schedule" all go.
- Test: a non-technical reader can say what each screen does without asking a follow-up question.
- **Acceptance:** no occurrence of `Stripe`, `Connect`, `CDE`, `venue schedule` or `pence` in rendered portal copy. Plain language per `CLAUDE.md`, and no em-dashes.

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
- **Acceptance:** no `/manage/` link is rendered anywhere under `/account`. The `/manage/[bookingId]/[token]` and `/b/{code}` routes themselves remain live indefinitely; this removes ResNeo's own outbound links, not the destinations (see §5A).

**P2-6. Consistent confirmation for every destructive action** (closes G13)

- Every action that cancels, deletes or costs money routes through `ConfirmDialog` from `@/components/ui/primitives`. No `window.confirm` remains anywhere in the portal.
- Each dialog states the consequence in plain language before the confirm button: what stops, when it stops, what is refunded, and whether it can be undone.
- **Membership cancellation specifically** must state the date access actually ends, since cancellation is scheduled at period end rather than immediate, and today the customer is told nothing before the click and only "Cancellation scheduled at period end" after it.
- Inventory of actions requiring this: cancel booking, reschedule booking, cancel membership, cancel course enrollment, delete recurring rule, remove saved card (P4-6), request account deletion.
- **Acceptance:** `grep -r "window.confirm" src/app/account src/components/account` returns nothing; every action in the inventory above shows a dialog naming its consequence; a test asserts the membership dialog names the end date.

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

**P3-4. One-click first entry** (implements AD7, addresses G11)

This is the highest-value item in Phase 3. It is the first impression for essentially every customer.

**P3-4a. Portal token infrastructure**
- New table `account_portal_tokens`: `token_hash` (primary key), `user_id`, `scope` (`limited`), `issued_for_booking_id` (nullable, for revocation), `expires_at`, `revoked_at`, `created_at`. Hash only, never plaintext.
- `src/lib/auth/portal-token.ts`: `issuePortalToken`, `verifyPortalToken`, `revokePortalTokensForBooking`.
- Reusable within the window, never single-use, and no state mutation on verify. This defeats corporate link scanners (Outlook Safe Links, Proofpoint, Mimecast), which fetch every URL in inbound mail and would otherwise consume a single-use token before the customer clicks.
- 30-day expiry; revoked once the related booking is more than 30 days past.
- **Acceptance:** a token verified 20 times in a row still works; verifying issues no writes; an expired or revoked token fails closed.

**P3-4b. Scoped session and step-up**
- Establish a session carrying a `portal_scope: 'limited'` claim.
- Permitted: view bookings, cancel, reschedule, confirm attendance, complete forms, add to calendar.
- Denied: change email, change password, manage passkeys, view or add saved payment methods, request account deletion. Denied routes redirect to `/auth/magic` for step-up.
- Enforced in middleware and asserted per route, not in the UI alone.
- **Acceptance:** a route test proves a limited session receives 403 on `/api/account/password`, `/api/account/payment-methods` and `/api/account/delete-request`, and 200 on `/api/account/bookings`.

**P3-4c. Entry route**
- `GET /auth/portal?t=<token>` verifies, calls `claim_user_account()`, establishes the scoped session, redirects to the target.
- Any failure falls through to `/auth/magic` with the email pre-filled, never to an error page.
- **Acceptance:** expired, revoked, malformed and absent tokens all land on a usable sign-in form.

**P3-4d. Email link changes** (fixes G11a)
- `accountBookingsMagicLinkUrl` becomes `accountPortalEntryUrl(email, { bookingId })`, embedding the token and targeting `/account/bookings/{id}`.
- Drop the dead `context=customer` parameter (G11f).
- **Acceptance:** clicking the confirmation email link lands on the specific booking, signed in, in one click.

**P3-4e. Brand the sign-in email** (fixes G11b)
- Route `/api/auth/send-magic-link` through `renderBaseTemplate` so the fallback email matches the confirmation email's design.
- **Acceptance:** rendered in the template gallery alongside the other templates.

**P3-4f. Rate-limit the send endpoint** (fixes G11c). **SHIPPED**
- Two independent limits on `POST /api/auth/send-magic-link`: 10 per 15 minutes per IP (one caller spraying many addresses), 3 per 15 minutes per email (many callers bombing one inbox). The per-email limit is the one that protects a third party who never asked to hear from ResNeo.
- Applied to every address whether registered or not, so a 429 cannot be used to probe whether an account exists.
- `AuthMagicForm` distinguishes 429 from a generic failure so a throttled customer is told to check their inbox rather than shown "Something went wrong".
- Covered by `src/app/api/auth/send-magic-link/route.test.ts` (5 tests).

**P3-4g. Fallback flow polish** (fixes G11d, G11e)
- Extend magic-link lifetime from 1 hour to 24 hours.
- "Check your inbox" names the address and offers resend behind a cooldown.
- Keep the button-gated send. It must not regress to auto-send on mount; see the note in `AuthMagicForm.tsx` recording why that was removed.
- **Acceptance:** resend is available after the cooldown and the target address is shown.

**P3-4h. Reduce repeat friction**
- Long-lived session so a second visit needs no authentication.
- After first successful arrival, offer passkey or password setup once, as a prompt inside the portal, never as a gate before it.
- **Acceptance:** a returning customer within the session window reaches the hub with zero authentication steps.

**P3-5. Account discovery improvements**
- Add the account callout to reminder emails, not only confirmations.
- First-run explainer on first portal visit covering what the account does.
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

**P4-6. Remove a saved card** (closes G14)
- `DELETE /api/account/payment-methods/[paymentMethodId]`, detaching on the venue's connected account via `stripe.paymentMethods.detach` with the correct `stripeAccount`.
- Ownership check: the payment method must belong to the `venue_customer_stripe` customer for this `user_id` and venue. Never trust a payment method id from the client without that check.
- Warn, and require confirmation (P2-6), when the card is currently backing an open card hold or an active membership. Detaching underneath either would break a live obligation.
- **Acceptance:** a customer can remove their own card; attempting to detach another user's payment method id returns 404; removing a card backing an open hold is blocked with a clear explanation rather than a generic error.

**P4-7. Paginate booking history** (closes G17)
- Replace the hardcoded limit of 100 with cursor pagination on `(booking_date, booking_time, id)`.
- "Load more" on the list, and an explicit count so the customer knows how much history exists.
- Apply to `/api/account/bookings` and the server-rendered list alike.
- **Acceptance:** an account with 500 bookings can reach its oldest one; no page load exceeds the §6 query budget.

**P4-8. Brand the remaining transactional emails** (closes G20)
- Route the account-deletion email through `renderBaseTemplate`, as P3-4e does for the sign-in email.
- Remove the dead `context=customer` parameter from its links (G11f).
- **Acceptance:** both appear in the template gallery alongside booking emails; neither contains raw inline HTML.

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

## 5A. Rollout

ResNeo already has a flag system (`Docs/FEATURE_FLAGS.md`, `resolveAppointmentsFeatureFlag`). This work must use it rather than shipping big-bang.

**Flag: `customer_portal_v2`.** Default **off**. Gates the redesigned hub, the restructured navigation and in-portal actions. When off, the current read-only portal renders unchanged, including its outbound `/manage` links. This lets Phases 1 and 2 merge continuously while staying dark.

**Flag: `portal_one_click_entry`.** Default **off**, separate from the above because it changes what goes into emails and has a distinct failure mode (link scanners). When off, `accountPortalEntryUrl` falls back to today's `/auth/magic` behaviour.

Phase 0 work is **not** flagged. It is behaviour-preserving by definition (the action extraction changes no logic, the timezone fix corrects a defect, the N+1 fix is invisible). Flagging it would only add a dead branch.

**Rollout order.** Internal venues, then a small cohort of appointment venues that generate the most customer email, then general availability. Hold at each step long enough to see a full booking-to-attendance cycle, which for most venues means at least two weeks.

**Kill criteria, agreed before launch.** Roll back `portal_one_click_entry` if token verification failures exceed 2 percent of entries (indicates scanner consumption or clock issues), or if support contacts mentioning sign-in rise at all. Roll back `customer_portal_v2` if cancellation or reschedule error rates exceed the equivalent rate on `/manage`.

### Backwards compatibility for links already in inboxes

This is easy to miss and expensive to get wrong. Transactional emails are permanent once delivered. A customer may open a confirmation from six months ago.

- `/auth/magic` and its current query shape (`email`, `redirect`, and the now-dead `context`) must keep working **indefinitely**, not just through the transition. Removing `context` from the *builder* is fine; the *page* must continue to tolerate it.
- `/manage/[bookingId]/[token]` and `/b/{code}` short links must keep working after P2-5 removes them from the portal UI. P2-5 removes ResNeo's own outbound links, not the routes.
- Any change to `accountBookingsMagicLinkUrl` must be additive. Old links carry no portal token and must degrade to the existing sign-in form, never to an error.
- **Acceptance:** a test asserts that a URL in the exact shape emitted today still resolves to a usable sign-in page after P3-4 ships.

---

## 5B. Success metrics

The case for this work is retention, SMS cost and support load. Those need to be measurable, or the next prioritisation call is guesswork again.

`Docs/BASELINE_METRICS.md` already defines and stores the relevant baselines per venue in `venue_baseline_metrics_snapshots`, and `GET /api/venue/reports` already returns them. Two existing metrics map directly onto this work:

| Existing metric | Relevance | Target |
| --- | --- | --- |
| **Guest self-reschedule** (share of moves with `modification_actor: guest`) | Phase 2 should raise this materially, since reschedule stops requiring an email round trip | Above the current 15 percent goal |
| **Cancel to rebook within 7 days** | Directly measures P3-1 rebook | Improvement against per-venue baseline |

New instrumentation needed:

- Portal entry, split by route (one-click token, magic link, direct sign-in), so the value of AD7 is separable.
- Portal sign-in completion rate, entry to arrival. This is the number that justifies P3-4 and it cannot be recovered retrospectively, so **instrument it before Phase 1**, not after.
- Share of cancels and reschedules performed in-portal rather than on `/manage`.
- SMS volume per venue, to test the claim that push and better email reduce spend.

**Capture the baseline during Phase 0.** Every one of these is unmeasurable after the fact.

---

## 5C. Explicitly out of scope

Named so they do not creep in mid-build. Each may be worth doing; none is part of this plan.

- Loyalty points, stamp cards, tiers or rewards
- Reviews and ratings collected in the portal (the existing `google_review_url` flow is unchanged)
- Messaging or chat between customer and venue
- Gift vouchers and account credit not already covered by class credits
- Product sales, cart or inventory of any kind, which belong to the separate commerce track
- Multi-language portal. `user_profiles.locale` exists and is stored, but the portal stays English-only here; the work is copy extraction across every surface and is its own project
- Social sign-in
- Any change to the venue-facing dashboard beyond what a shared component forces

---

## 6. Cross-cutting requirements

**Accessibility.** Target WCAG 2.2 AA. Two failures are already known and are remediated by P0-8, not discovered at review: no `aria-current` on active navigation and filters, and no live region on any asynchronous outcome (4.1.3 Status Messages). Beyond those: every interactive element keyboard reachable, dialogs follow the manual checklist in `Docs/DESIGN_SYSTEM.md`, status never conveyed by colour alone, and an axe pass runs over every `/account` route in CI.

**Components.** All new portal UI uses `@/components/ui/primitives` and `@/components/ui/dashboard`. No hand-rolled buttons, inputs, dialogs or overlays. `npm run lint:modals` must stay green.

**Copy.** Plain, warm, second person, aimed at non-technical customers. No em-dashes (`CLAUDE.md`). No implementation vocabulary: a customer should never read "Stripe", "Connect", "CDE" or "pence". Every destructive action states its consequence before confirming.

**Performance budget.** Hub and bookings list under 10 database queries each. No writes during a read. Time to first contentful paint under 1.5s on a mid-tier mobile device.

**Security.** Cross-user access returns 404. All booking access scoped through `loadAccountSafeGuests`, never by raw `booking_id`. No venue-private fields (`notes`, `tags`, `custom_fields`, `no_show_count`) may cross into a customer response; `guests_account_safe` is the only permitted guest projection. Once scoped sessions exist (AD7), every route must declare whether it accepts a `limited` session; the default for a new route is to reject it, so an omission fails closed rather than open. Any public endpoint that sends email or SMS must be rate limited on both IP and target address.

**Timezone.** Every rendered time carries a venue-local value and an explicit timezone label where it differs from the customer's profile timezone.

**Testing gate.** No task is complete without unit tests for logic, a route test for any new endpoint, and an e2e for any new customer-visible flow.

**Analytics.** See §5B. The baseline must be captured during Phase 0, because none of it can be reconstructed afterwards.

**Rollout.** See §5A. No customer-visible phase ships unflagged.

---

## 7. Data model changes

Four migrations are anticipated.

0. **`customer_can_view_own_bookings` policy on `public.bookings`** (P0-6, AD8). No schema change, policy only. Confirm the query plan of the `guests` subquery on a realistic dataset before merge. This is the first migration to ship and it gates Phase 2.
1. **`account_portal_tokens`** (P3-4a). New table: `token_hash` primary key, `user_id`, `scope`, `issued_for_booking_id` nullable, `expires_at`, `revoked_at`, `created_at`. Indexed on `user_id` and on `issued_for_booking_id` for revocation. RLS: no direct client access; service role only. `booking_short_links` cannot be reused because it is booking-scoped, its `purpose` column carries a CHECK of `manage | confirm | payment`, and its `booking_id` FK is required.
2. **Notification preferences matrix** (P4-3). Extend the `notification_preferences` JSON shape on `user_profiles`. Backfill must preserve current effective behaviour for every existing row.
3. **Optional: `user_profiles.portal_first_seen_at`** (P3-5) to drive the first-run explainer once.

Receipts, forms, waitlist and history all read from existing tables.

---

## 8. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Refactoring `/api/confirm` regresses refunds or card-hold settlement | High. Financial. | P0-4 is guarded by both existing e2e specs. Refactor is mechanical delegation with no logic change. Ship it alone, before any UI work. |
| Portal and manage page drift apart on policy copy | Medium. Customer confusion, disputes. | Shared copy helpers and a snapshot test asserting both surfaces render identical fee and deadline text. |
| Cross-customer booking leak from a single dropped filter | **Critical. Every customer's bookings, to any authenticated user.** Currently one application-level filter is the sole control (G12). | P0-6 adds a database policy so two independent controls exist. Blocks Phase 2. Asserted by a test that queries with no application filter at all. |
| Cross-venue data leak through a new endpoint | High. Privacy. | Every new route scoped via `loadAccountSafeGuests`; 404-on-foreign-booking asserted in route tests. |
| Accidental cancellation of a paid membership | Medium to high. Revenue and trust. One click does it today, with no confirmation. | P2-6 requires a dialog naming the exact date access ends. |
| Detaching a card that backs an open card hold or active membership | Medium. Breaks a live financial obligation and is hard to diagnose. | P4-6 blocks the removal with a specific explanation rather than allowing it and failing later. |
| RLS policy degrades query performance at scale | Medium. Slow portal for the customers with the most history. | Query plan verified on a realistic dataset during P0-6; index added if the planner needs it. |
| Scope creep into commerce | Medium. Delay. | Receipts read the existing ledger only. No product, cart or inventory concepts enter this plan. |
| Notification preference migration changes who gets messaged | High. Trust, possible compliance issue. | Backfill defaults to current behaviour; a dry-run diff of intended recipients before and after must be produced and reviewed. |
| Email link scanners consume portal tokens before the customer clicks | High. The one-click flow silently fails for corporate and some consumer mailboxes. | Tokens reusable within window, never single-use; no mutation on verify (P3-4a). Test with a scanner-style double fetch before release. |
| A forwarded confirmation email grants portal access | Medium. Privacy. | Session is scoped: no email or password change, no payment methods, no deletion (AD7, P3-4b). This is the same exposure the existing `manage_booking_link` already carries, and it is narrowed, not widened. |
| ~~Unrated-limited magic-link endpoint used to mail-bomb third parties~~ | High. Abuse, sender reputation, possible blocklisting of the sending domain. | **Closed.** P3-4f shipped ahead of the rest of the plan. |
| A link in an already-delivered email stops working | Medium to high. Emails are permanent; a broken link is unrecoverable for that customer and looks like a dead product. | §5A backwards-compatibility rules, with a test asserting today's URL shape still resolves after P3-4. |
| Rate limiter is per-instance, so serverless scale-out weakens it | Low to medium. A determined attacker across many cold starts gets a multiple of the intended limit. | Accepted for now; `checkRateLimit` is documented as best-effort per instance and this matches how `booking/create` and `contact` already work. Revisit with a shared store if abuse is observed. |
| One-click entry is read as less secure by a venue or an auditor | Low. Perception. | Document the comparison with `manage_booking_link` explicitly: the token grants strictly less capability than the cancel link already present in the same email. |

---

## 9. Sequencing and estimate

| Phase | Content | Estimate |
| --- | --- | --- |
| 0 | Foundations: tests, timezone, N+1, action extraction, loading states, **RLS backstop, design-system migration, accessibility remediation** | 3 to 3.5 weeks |
| 1 | Hub, navigation, IA dedup, copy pass | 1.5 weeks |
| 2 | In-portal cancel, reschedule, confirm, detail rebuild, confirmation dialogs | 2.5 to 3 weeks |
| 3 | One-click entry (P3-4), rebook, venue history, consolidation, discovery | 2.5 to 3 weeks |
| 4 | Forms, receipts, notification matrix, waitlist, export, card removal, pagination, email branding | 2.5 weeks |
| **Total (web, world-class)** | | **12 to 13.5 weeks** |
| 5 | Mobile enablement (ResNeo side only) | 1.5 weeks |

Phase 0 is non-negotiable and must ship before Phase 1, and **P0-6 must ship before Phase 2 under any scope reduction**. Phases 3 and 4 can be reordered against commercial priority. A credible reduced scope is Phases 0 to 2, which delivers a portal that is genuinely useful, at roughly 7 to 8 weeks.

**On the estimate increase.** Phase 0 doubled after the second review, and total went from 9 to 13.5 weeks. That is not scope creep. Three items were found that the original plan assumed were already in acceptable shape: booking access has no database backstop, the portal shares no components with the rest of the product, and two accessibility failures are already present. All three get worse and more expensive the more surface is built on top of them, which is why they sit in Phase 0 rather than being deferred.

If the timeline is the binding constraint, the honest reduction is to cut Phase 4 and defer Phase 3 past the one-click entry work, not to trim Phase 0.

**Two items should jump the queue regardless of how the rest is sequenced:**

- **P3-4f (rate limit the magic-link endpoint)** is roughly an hour of work against a live abuse vector. It should ship on its own, immediately, ahead of Phase 0.
- **P3-4d (land on the specific booking)** is a small change to one URL builder and delivers a disproportionate share of the perceived improvement. It can ship with Phase 1 rather than waiting for the full token work.

---

## 10. Definition of done

The portal is world-class when a customer can, without contacting the venue and without leaving `/account`:

1. Reach the booking they just made in **one click** from the confirmation email, already signed in, with no second email.
2. See their next appointment immediately on every later visit, with no authentication step inside the session window.
3. Reschedule or cancel it, understanding the fee and deadline before confirming.
4. Complete any form the venue requires.
5. See what they paid and what was refunded.
6. Book the same thing again in one action.
7. See their history across every ResNeo venue they use.
8. Control which messages they get, on which channel.
9. Remove a saved card as easily as they added it.
10. Reach the oldest booking in their history, however long they have been a customer.
11. Step up to a stronger sign-in only when the action genuinely warrants it.
12. Export or delete their data.

And throughout, they can:

13. Understand every screen without meeting a word from ResNeo's implementation.
14. Use the whole portal with a keyboard and a screen reader, at WCAG 2.2 AA.
15. See exactly what a destructive action will do, before it happens, every time.

And the team can change the portal safely, because:

16. Customer data is protected by **two** independent controls, a database policy and an application filter, either sufficient alone.
17. Every route has a test and every customer-visible flow has an e2e.
18. Every screen is built from shared primitives, so a fix to one is a fix to all.

---

## 11. Change log

| Date | Change |
| --- | --- |
| 2026-08-06 | Initial plan. |
| 2026-08-06 | Added AD7 and expanded P3-4: one-click portal entry on a scoped session, with G11 documenting the ten-step flow it replaces. Added §5A rollout, §5B success metrics, §5C out of scope. |
| 2026-08-06 | **P3-4f shipped**: rate limiting on `POST /api/auth/send-magic-link`, 10 per IP and 3 per email per 15 minutes, plus 429 handling in `AuthMagicForm`. Closes G11c. |
| 2026-08-06 | Second code review added G12 to G20 and the tasks that close them: database-enforced booking access (P0-6, AD8), design-system migration (P0-7), accessibility remediation (P0-8), IA deduplication and copy pass (P1-3, P1-4), universal confirmation dialogs (P2-6), card removal (P4-6), pagination (P4-7), email branding (P4-8). Phase 0 grew from 1.5 to 3.5 weeks; total from 9 to 13.5 weeks. |
