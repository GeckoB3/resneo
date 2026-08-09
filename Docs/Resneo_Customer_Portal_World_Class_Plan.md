# ResNeo Customer Portal: Plan to World-Class Standard

**Status:** Reviewed against the code on 2026-08-09 and ready to implement. Nothing in it has been built yet.
**Owner:** TBC
**Created:** 2026-08-06
**Scope:** The customer-facing web portal at `/account`, its API surface under `/api/account/*`, and the shared guest-action logic it depends on. Mobile app work is scoped in Phase 5 but is explicitly out of scope for delivery here.
**Rollout:** No feature flags. Each phase is built, verified on staging, then released to every venue at once. See §5A.
**Three project-level decisions to take before P3-4 starts.** None is application code and none is a task inside a phase, so each needs a named owner and a date:

1. Enable secure password change and secure email change on the Supabase project (AD7, P3-4b). **P3-4b cannot ship without this**; if it is refused, AD7 takes its descoped fallback.
2. Whether to raise `otp_expiry` from 3600 (P3-4g). Applies to staff invites and password recovery too.
3. The target session window for returning customers (P3-4h). `jwt_expiry` and refresh-token lifetime, which also govern staff sessions.

**Confirm before P3-4b starts:** that Supabase access tokens on this project carry a `session_id` claim. The whole enforcement model in AD7 is keyed on it.

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
Only `account-booking-filters.test.ts` and `account-hard-delete-eligibility.test.ts`. No component tests, no route tests, no e2e. All four e2e specs (`appointment-book-pay-confirm`, `appointment-options-book-pay-confirm`, `appointment-staff-first-book-pay-confirm`, `guest-self-reschedule`) exercise the public booking and manage-link flows, not the portal. All four are also appointment-shaped: none of them covers class credit restoration, waitlist offer cascades, card-hold settlement or event tickets. That matters for P0-4, which cannot lean on them as a safety net.

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

The obvious fix, a customer SELECT policy on `bookings`, does not work here. Two reasons, both verified:

1. `guests` has RLS enabled with staff and linked-venue policies only, and the customer policy was deliberately dropped (`20260629120000_user_accounts_foundation.sql:541`, "Account owners must use `guests_account_safe`/server APIs, not raw venue-private guest rows"). Postgres evaluates an RLS policy's subqueries as the calling user, so a policy on `bookings` reading `public.guests` is itself filtered by `guests` RLS and returns zero rows for a customer. The policy would grant nothing, and moving portal reads to the session client would return an empty list for every customer.
2. A `FOR SELECT` policy is table-wide, and `authenticated` reaches `bookings` directly through PostgREST. `bookings` carries `internal_notes`, `cancelled_by_staff_id`, `created_by_staff_id`, `confirm_token_hash` and `stripe_payment_intent_id`. Column-level grants cannot separate staff from customers, because both are the same `authenticated` role. A blanket policy would therefore widen the customer-visible surface at the same moment it added defence in depth, contradicting §6.

AD8 specifies what to build instead.

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
Zero files under `src/app/account` or `src/components/account` import from `@/components/ui/primitives`. Sixteen files import exactly one shared component, `PageHeader` from `@/components/ui/dashboard`, and nothing else. There are 22 hand-rolled `<button>` elements carrying inline Tailwind. Consequences: the portal drifts visually from the dashboard, and it inherits none of the accessibility or behaviour fixes made to `Button`, `Dialog`, `ConfirmDialog` or `FormField`. Rebuilding portal screens is therefore a **migration**, not a restyle, and phase estimates must reflect that.

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
| G6 Near-zero test coverage | P0-1, P0-9 | 0 |
| G7 Consumer polish, loading and error states | P0-5, P1-2, P1-3 | 0, 1 |
| G8 Held data never surfaced | P3-2, P4-1, P4-2 | 3, 4 |
| G9 Notification preferences email-only | P4-3 | 4 |
| G10 No customer push | P5-2 | 5 |
| G11 Two emails and three clicks to enter | P3-4a to P3-4h | 3 |
| G11c Unrated-limited send endpoint | **P3-4f, shipped** | Done |
| G12 No defence in depth on booking reads | **P0-6 (blocks Phase 2)** | 0 |
| Baseline metrics have nowhere to be written | P0-10 | 0 |
| G13 Inconsistent or absent confirmation | P2-6 | 2 |
| G14 Saved cards cannot be removed | P4-6 | 4 |
| G15 No design-system adoption | P0-7 | 0 |
| G16 WCAG 2.2 AA failures | P0-8 | 0 |
| G17 History truncates silently at 100 | P4-7 | 4 |
| G18 Three navigation systems | P1-3, P1-5 | 1 |
| G19 Stripe jargon in consumer copy | P1-4 | 1 |
| G20 Unbranded transactional emails | P3-4e, P4-8 | 3, 4 |

### 2.4 Architectural facts that constrain the plan

- **`/api/confirm/route.ts` is 1,770 lines** with cancel, confirm and modify logic inline, including Stripe refunds, card-hold settlement, class credit restoration, waitlist offer cascades and compliance enforcement. This is the logic the portal must reuse. It cannot be called as-is because it authenticates by token.
- **The mobile app is a separate React Native repository** (`reserveni-app`), not a webview shell over this app. It authenticates via Supabase Bearer tokens against `/api/venue/*` and is currently staff-only. See `Docs/MOBILE_API.md`. Web portal work does **not** automatically appear in the app.
- **UI primitives to reuse:** `src/components/ui/primitives` (Button, Dialog, Sheet, ConfirmDialog, Input, FormField, Label, IconButton, BrandSpinner) and `src/components/ui/dashboard` (PageHeader, SectionCard, EmptyState, BookingStatusPill, DashboardSkeletons, Pill, ScheduleRow). Conventions in `Docs/DESIGN_SYSTEM.md`, including the required migration rule away from hand-rolled modal overlays.
- **`guests` is closed to customers at the database level.** RLS is on, the policies are staff and linked-venue only, and the customer policy was dropped on purpose. Customers reach their guest rows solely through `guests_account_safe`, a view created without `security_invoker`, so it runs as its owner and is not filtered by `guests` RLS while still applying its own `WHERE g.user_id = auth.uid()`. This is the established, already-audited pattern for customer-safe database reads in this codebase, and AD8 extends it rather than inventing a second one.
- **The Supabase access token reaches the browser.** `src/lib/supabase/browser.ts` uses `createBrowserClient`, and app code already calls `supabase.auth.updateUser()` client-side (`src/app/dashboard/settings/sections/ProfileSection.tsx:29`). Anything holding a session can call the Supabase Auth API directly, so Next.js middleware and route handlers cannot restrict what a session may do to its own auth user. AD7 is built around this constraint.
- **No custom access token hook exists.** None of the 251 migrations defines one, so a Supabase JWT cannot carry an application-defined claim today. `app_metadata` is not a substitute: it is per user, not per session, so writing a scope there would also downgrade that customer's other, fully authenticated sessions on other devices.
- **`claim_user_account()` requires a confirmed email.** `20270103123000_claim_requires_confirmed_email.sql` gates guest-row linking on `auth.users.email_confirmed_at`. Any new sign-in path must establish its session through Supabase's own OTP verification, which sets that flag; a bespoke minted session would silently stop linking guest rows.
- **Feature flags are venue-scoped and cannot gate this work.** `venues.feature_flags` plus an env override, over the closed key list in `src/lib/feature-flags/types.ts`. The portal is cross-venue and per-customer, so no venue's flag can gate it. See §5A, which replaces flagged rollout with a staging-then-live model.

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

Authorisation is resolved by a single `assertActorMayActOnBooking(admin, actor, booking)` helper. Token and HMAC paths keep their current semantics exactly. The session path requires `booking.guest_id ∈ guestIds`, where `guestIds` comes from `loadAccountSafeGuests`, **and** the booking must have been read through `bookings_account_safe` on the session client before the action service is called (AD8). Two controls on the write path, matching the two on the read path.

**Every function returns a result, never a `Response`.** The service layer cannot import `next/server`. Each returns a discriminated union:

```ts
type GuestActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: GuestActionErrorCode; message: string; status: number };
```

`message` is the customer-facing string and is the **only** place that copy lives, so `/api/confirm`, the portal routes and `/manage` cannot drift (see the §8 copy-drift risk). `status` preserves today's exact HTTP codes, including the `410` on an already-used token. Side effects that currently run through `after()` are returned as a list of deferred tasks the route adapter schedules, so the service stays testable without a request context.

`POST /api/confirm` is refactored to a thin adapter over these functions. Behaviour must not change. **The guard is P0-9's characterisation suite, not the existing e2e specs**, which are all appointment-shaped and cover none of the class, event or card-hold paths (G6).

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

### AD7. First entry to the portal is one click from the confirmation email, on a session marked limited server-side

The account link in transactional emails carries a signed, user-scoped token that establishes a real Supabase session directly. No second email, no interstitial. The session is then recorded as **limited** in a ResNeo-owned table, and sensitive routes refuse it.

The justification is consistency, not convenience. The same email already carries `manage_booking_link`, which lets whoever holds it cancel a booking and trigger a refund with no second factor. Requiring a full email round trip to *read* the same booking applies a higher bar to a strictly lower-risk action.

**How the session is established.** `admin.auth.admin.generateLink({ type: 'magiclink' })` followed by a server-side `supabase.auth.verifyOtp(...)`, exactly the mechanism already in `POST /api/auth/send-magic-link` and `GET /auth/confirm`. Two consequences follow, and both are wanted: the session is an ordinary Supabase session that every existing route and RLS predicate already understands, and `verifyOtp` sets `auth.users.email_confirmed_at`, which is what `claim_user_account()` now requires before it will link guest rows. The migration that added that requirement records that only 56 of 354 auth users currently carry the flag, so one-click entry actively repairs that population rather than working around it.

**How "limited" is recorded and enforced.** Not as a JWT claim. There is no custom access token hook on this project, and `app_metadata` is per user rather than per session, so writing a scope there would downgrade the same customer's other sessions on other devices. Instead:

- New table `portal_limited_sessions`: `session_id` (primary key), `user_id`, `issued_for_booking_id`, `expires_at`, `created_at`. Service role only.
- Supabase access tokens carry a `session_id` claim. Middleware and every sensitive route read it and reject a session present in that table. Confirm the claim is present on this project before building; if it is absent on the deployed GoTrue version, this decision has to be revisited before P3-4 starts, not during it.
- Enforcement is server-side and per route. **The default for a new route is to reject a limited session**, so an omission fails closed.

**What this cannot enforce, stated plainly.** A limited session is still a genuine Supabase session, and its access token reaches the browser (§2.4). Anyone holding it can call the Supabase Auth API directly to change the password or email address, and no ResNeo middleware or route sits in that path. This is not fixable in application code. It is closed at the project level instead, by enabling Supabase's **secure password change** (reauthentication nonce) and **secure email change** (confirmation on both the old and new addresses). Those apply to every session regardless of how it was obtained.

That is a global auth setting affecting staff and sales users too, so it is a deliberate decision to take before P3-4 ships, not a task inside it. **If it is not taken, AD7 must be descoped** to the fallback below rather than shipped with an unenforceable scope boundary.

**Scope of a limited session.**

| | Actions |
| --- | --- |
| **Permitted** | View bookings, cancel, reschedule, confirm attendance, complete compliance forms, add to calendar, view profile, edit non-identity profile fields (name, phone, locale, timezone, marketing consent) |
| **Denied by ResNeo routes** | View or add saved payment methods; **spend money of any kind**: buy credits, check out or enroll on a course, check out a membership, create a recurring reservation; request or cancel account deletion; manage devices; sign out everywhere |
| **Denied by Supabase project settings** | Change password, change email |

**Spending money is the category most easily missed**, and it is the one with a live financial consequence: a forwarded confirmation email must not be able to put a membership on the recipient's saved card. Every route under `/api/account/credits`, `/api/account/courses`, `/api/account/memberships` and `/api/account/class-recurring` that creates a charge or an obligation is denied, including the `fulfill` callbacks. The cancel routes in those areas are denied too, since cancelling someone's membership from a forwarded email is a hostile act even though it costs nothing.

Denied actions redirect to a step-up sign-in at `/auth/magic`. Step-up needs no unwind logic: a completed magic-link sign-in issues a **new** session with a new `session_id`, which is not in `portal_limited_sessions` and is therefore full by construction. The old limited session simply expires.

**Token properties.**

- User-scoped, not booking-scoped, so `booking_short_links` cannot be reused (its `purpose` CHECK and `booking_id` FK are both wrong for this).
- **Reusable within its window, never single-use.** Corporate link scanners (Outlook Safe Links, Proofpoint, Mimecast) fetch every URL in inbound mail. A single-use token is consumed before the human clicks. This property is mandatory, not an optimisation.
- No state mutation on GET, for the same reason.
- 30-day validity, revoked when the related booking is more than 30 days past.
- Stored hashed, never in plaintext.

**Descoped fallback, if the project-level auth settings are not taken.** Point the one-click link at `/manage/[bookingId]/[token]`, which already exists and already carries strictly more capability than a read, and add a "See all your bookings" link from there into the normal sign-in. That delivers most of G11 (land on the booking you just made, one click, no second email) with no new auth surface at all, and it collapses P3-4a to P3-4c to almost nothing. What it gives up is item 1 of §10: arriving already signed in.

**`/auth/magic` is retained** as the fallback for a missing, expired or revoked token, and for anyone arriving without one. Its current button-gated send is correct behaviour for that path and must not regress to auto-send on mount (see the note in `AuthMagicForm.tsx`).

### AD8. Customer booking access is enforced in the database, not only in application code

Addresses G12. Today the application-level `guest_id` filter is the sole control. It becomes the second of two.

The mechanism is a customer-safe view, not an RLS policy on `bookings`. G12 sets out why a policy fails: its subquery on `guests` is itself filtered by `guests` RLS and returns nothing, and a table-wide SELECT policy would expose `internal_notes` and other staff columns to any authenticated customer over PostgREST. A view has neither problem, and it mirrors `guests_account_safe`, which already does exactly this job in production.

```sql
CREATE OR REPLACE VIEW public.bookings_account_safe
WITH (security_barrier = true) AS
SELECT
  b.id, b.venue_id, b.guest_id,
  b.booking_date, b.booking_time, b.booking_end_time,
  b.party_size, b.status, b.booking_model,
  b.deposit_status, b.deposit_amount_pence, b.cancellation_deadline,
  b.special_requests, b.dietary_notes, b.occasion,
  b.group_booking_id, b.class_instance_id, b.experience_event_id, b.resource_id,
  b.service_name_snapshot, b.service_variant_name_snapshot,
  b.booking_total_price_pence, b.amount_paid_pence,
  b.location_type, b.client_address_line1,
  b.guest_attendance_confirmed_at, b.created_at, b.updated_at
FROM public.bookings b
WHERE b.guest_id IN (SELECT id FROM public.guests WHERE user_id = auth.uid());

GRANT SELECT ON public.bookings_account_safe TO authenticated;
```

Created without `security_invoker`, so it runs as its owner and the `guests` subquery is not blocked, while its own `WHERE` clause is the ownership predicate. The column list is an allowlist: `internal_notes`, `confirm_token_hash`, `stripe_payment_intent_id`, `created_by_staff_id`, `cancelled_by_staff_id` and every other staff-only column are absent by construction, and adding a column to `bookings` does not silently add it here.

Portal reads then move from the admin client to the **session client** reading this view. The existing `.in('guest_id', guestIds)` filters stay exactly as they are. Two independent controls, either of which is sufficient on its own: the view cannot return another customer's row even with no application filter, and the application filter would still scope correctly even if the view were replaced.

**Where the admin client is still legitimate.** Some hydration reads join tables a customer has no access to (`class_instances`, `class_types`, `experience_events`, `venues`), and the write paths in Phase 2 need columns the view deliberately omits. Those may keep using admin, but only after the parent booking has been authorised through the view. The rule is: **the row that establishes ownership is read through the account-safe view; derived context and action payloads may be read as admin.**

**Non-negotiable acceptance:** a test signs in as customer A, queries `bookings_account_safe` directly through a session client with no application filter at all, and receives only A's rows. A second test asserts that the same session client querying `bookings` directly still receives zero rows, so the staff-only columns remain unreachable.

---

## 4. Target customer journey

The plan is organised around the full journey. Every stage must have a portal answer.

| Stage | Customer need | Portal provision | Phase |
| --- | --- | --- | --- |
| Discover account | "I did not know I had one" | Account CTA in confirmation and reminder emails; clear first-run state | 3 |
| First entry | One click, no second email | Limited-session token link straight into the booking just made (AD7) | 3 |
| Sign in later | Fast, passwordless-first | Long session, optional password offered after first arrival, `/auth/magic` as fallback | 3 |
| Step up | Protect sensitive actions | Fresh magic link before payment methods, spending money, deletion, or any password or email change | 3 |
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
P0-6 (account-safe view)      ──> P2-1 (session action routes)   [BLOCKING]
P0-7 (design system)          ──> P1-2, P1-3, P2-2, P2-3, P2-4, P2-6
P0-9 (characterisation tests) ──> P0-4 (extract guest actions)   [BLOCKING]
P0-4 (extract guest actions)  ──> P2-1 (session action routes) ──> P2-2, P2-3, P2-4
P0-2 (booking instants)       ──> P1-1 (hub loader), P1-2 (hub)
P0-3 (remove N+1)             ──> P1-1 (hub loader)
P0-10 (instrumentation sink)  ──> baseline capture, and it cannot be done later
P0-1 (e2e sign-in helper)     ──> every later e2e in this plan   [BLOCKING]
P1-1 (hub loader)             ──> P1-2 (hub UI)
P1-5 (passes and plans)       ──> P1-3 (nav restructure)         [BLOCKING]
P2-6 (confirm dialogs)        ──> P4-6 (card removal)
P3-4a (token infra)           ──> P3-4b, P3-4c, P3-4d
P3-4b (limited sessions)      ──> P4-5 (export must reject one), P4-6 (card removal)
P4-3 (preference matrix)      ──> P5-2 (customer push)
```

**P0-6 blocks Phase 2 absolutely.** Every route added in Phase 2 inherits whichever access-control model exists when it is written. Adding five routes on the current model and retrofitting afterwards means auditing five routes instead of fixing one pattern.

**P0-7 should precede Phases 1 and 2** for cost, not correctness. Those phases rebuild the same components; migrating to primitives afterwards means touching them twice.

`P3-4f` had no dependencies and has already shipped. `P3-4d` (land on the specific booking) depends on `P3-4a` only for the token; the redirect-target change alone can ship earlier. `P0-8` (accessibility) has no dependencies and can run in parallel with anything.

### Phase 0: Foundations (must precede all UI work)

**P0-1. Test harness for the portal**
- Add `src/app/account/**` component tests using the existing vitest setup.
- Add route tests for all 26 `/api/account/*` routes covering: unauthenticated 401, cross-user access denial, happy path.
- **Build an e2e sign-in helper first.** `e2e/helpers/` currently has `book-appointment`, `env`, `manage-link` and `stripe-payment` and nothing that produces an authenticated session, and there is no inbox for a test to read. The helper mints a session server-side with `admin.auth.admin.generateLink` and visits `/auth/confirm`, which is the same path a real customer takes and therefore also exercises `claim_user_account()`. Nothing else in the portal e2e work is possible until this exists.
- Seed fixture: `scripts/seed-e2e-smoke-venue.mjs` produces a venue and bookings but no customer account. Extend it, or add a sibling script, to produce a customer with bookings at **two** venues, since cross-venue identity is the portal's distinguishing behaviour and a single-venue fixture would not catch a regression in it.
- Add `e2e/account-portal.spec.ts` covering sign in, view bookings, open detail.
- **Acceptance:** portal route coverage at 100 percent of routes having at least an auth test; e2e green in CI; the two-venue fixture is documented in `Docs/E2E_SMOKE.md` alongside the existing ones.

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

**P0-4. Extract guest actions** (AD1). **Depends on P0-9.**
- Create `src/lib/booking/guest-actions/` with the four service functions and the actor model.
- Refactor `POST /api/confirm` to delegate.
- **This is not mechanical delegation.** `POST /api/confirm` is a single function of roughly 1,400 lines with `NextResponse.json(...)` returns interleaved throughout the logic, reading the admin client, `after()`, feature flags and two availability engines directly. Extraction means rewriting every return path into a result type the route adapter then serialises. Budget for that, and change no behaviour while doing it.
- The token path must keep its exact semantics, including single-use consumption of `confirm_token_used_at`. The session actor must **not** consume it, since a customer may act on the same booking twice from the portal.
- **Acceptance:** the P0-9 characterisation suite passes byte-identically before and after, and all four existing e2e specs pass unchanged. No behaviour change in emails sent, refunds issued, credits restored, waitlist offers cascaded, or card holds settled.

**P0-5. Loading and error states**
- Add `loading.tsx` and `error.tsx` to every route under `/account`.
- Use `DashboardSkeletons` where shape is known.
- **Acceptance:** every route has both; no route falls back to a blank screen on error.

**P0-6. Database-enforced customer booking access** (implements AD8, closes G12)

**This is the highest-priority task in the plan and blocks Phase 2.** Every route Phase 2 adds inherits whichever access model exists when it is written.

- Migration creating `public.bookings_account_safe` exactly as specified in AD8, with the column allowlist and `GRANT SELECT ... TO authenticated`. **No RLS policy is added to `bookings`**; G12 records why one cannot work here.
- Change the three loaders in `src/lib/account/account-bookings.ts` (`loadAccountBookings`, `loadAccountUpcomingBookingsByModel`, `loadAccountBookingById`) to read `bookings_account_safe` through the session client instead of `bookings` through the admin client. Keep every existing `.in('guest_id', guestIds)` filter.
- Keep admin hydration as-is (`loadVenueMap`, `buildAccountCdeContext`, `loadClassInstanceSpots`). Ownership is already established by the time they run.
- Document the rule in `Docs/Multi_model_RLS_and_API_audit.md`: ownership is established through the account-safe view; derived context may be read as admin.
- **Acceptance:**
  1. A session client for customer A, querying `bookings_account_safe` with **no application-level filter**, returns only A's rows.
  2. The same session client querying `bookings` directly returns zero rows, so staff columns stay unreachable.
  3. Existing portal behaviour is unchanged; the full suite passes.
  4. A test asserts a customer session cannot read a booking belonging to another user by id.
- **Performance note:** the view's `WHERE` clause subqueries `guests (user_id)`. `idx_guests_user_venue ON public.guests (user_id, venue_id)` exists and leads with `user_id`, which is confirmed usable for this predicate. Verify the plan on a realistic dataset before merge anyway, since the view is now on the hot path for every portal read.

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

**P0-9. Characterisation tests for the guest action paths** (blocks P0-4, part of G6)

P0-4 refactors the single most financially sensitive route in the product, and the only tests standing behind it today are four e2e specs that are all appointment-shaped. Nothing covers class credit restoration, waitlist offer cascades, card-hold settlement or event tickets. Those tests must exist **before** the refactor, describing current behaviour rather than intended behaviour.

- Integration tests against `POST /api/confirm` as it stands today, covering, for each of `confirm`, `cancel` and `modify`: appointment, class session, course multi-session, event ticket and resource booking; token and HMAC auth; deposit refund, card-hold settlement and late-cancellation fee; credit restoration; waitlist offer cascade; compliance enforcement blocking an action.
- Assert on outcomes that matter: booking status, emails and SMS queued, Stripe calls made with their arguments, credits and holds written.
- **Acceptance:** the suite passes on `HEAD` before any refactor commit, and is the gate P0-4 must clear unchanged.

**P0-10. Somewhere to write portal metrics** (enables §5B)

§5B's numbers cannot be reconstructed after the fact, and there is currently nowhere to put them. The only event sink is `events`, whose `venue_id` is `NOT NULL` and whose RLS is staff-scoped. Portal entry and sign-in completion are cross-venue and often have no venue context at all.

- Add a `portal_events` table (`id`, `user_id` nullable, `venue_id` nullable, `event_type`, `payload` jsonb, `created_at`, service role only, indexed on `event_type, created_at`). **Do not relax `events.venue_id`**: `events` is append-only, venue-scoped and read by venue reporting, so loosening it has blast radius well beyond this plan.
- Emit: portal entry split by route (one-click token, magic link, direct sign-in), sign-in completion from entry to arrival, and whether a cancel or reschedule happened in-portal or on `/manage`.
- Write the read queries too, not just the writes. §5A's revert thresholds are read off these, so they must work under pressure rather than being composed during an incident.
- Retention: prune rows older than 13 months in the existing cron, so a metrics table does not become an unbounded store of customer activity.
- **Acceptance:** entry and completion events are recorded in staging before Phase 1 UI work begins, and a saved query returns the completion rate and the in-portal share of cancels for an arbitrary date range.

### Phase 1: The hub

**P1-1. Hub aggregate loader** (AD5)
- `src/lib/account/account-home.ts` returning: next upcoming booking (hydrated), count of upcoming, outstanding form links, active credits and membership summary, venues used.
- `GET /api/account/home` wrapping it, on `createRouteHandlerClient` per AD6 so the mobile app can use it unchanged.
- Reads bookings through `bookings_account_safe` on the session client (P0-6) and derives "next upcoming" from `bookingStartInstant` (P0-2), never from a date string.
- **Acceptance:** the loader issues a bounded number of queries independent of how many bookings, venues or passes the customer has, asserted by a query-count test with a fixture carrying 100 bookings across 4 venues; the route returns 401 unauthenticated; a customer with no bookings gets a well-formed empty payload rather than a null.

**P1-2. Hub redesign**
- Replace the static grid in `src/app/account/page.tsx`.
- Above the fold: next appointment card showing venue, service, practitioner, date and time in venue-local time with timezone label, status pill, and inline Reschedule, Cancel, Add to calendar, Directions.
- Below: outstanding actions (forms to complete, unpaid balances), then a compact "Upcoming" list, then quick links.
- Empty state for a customer with no bookings: prompt to find a venue, not a menu.
- Remove the "Set up your business" card. Move that to the profile page footer as a single quiet link.
- **Acceptance:** a customer with one upcoming booking sees it without scrolling on a 375px viewport; hub issues one round of queries.

**P1-3. Navigation restructure** (closes G18). **Depends on P1-5.**

Collapsing twelve nav items to four only works if every one of the twelve has a stated destination. All twelve are placed below; none is dropped and none is left unreachable.

| Today | Where it goes |
| --- | --- |
| Overview | The hub at `/account`, reached from the ResNeo wordmark, not a nav item |
| Bookings | **Bookings** |
| Events | **Bookings**, as a filter. `/account/events` redirects to `/account/bookings?model=event` |
| Resources | **Bookings**, as a filter. `/account/resources` redirects to `/account/bookings?model=resource` |
| Classes | Split: class bookings are already in **Bookings**; the commerce links move to **Passes and plans**. The static hub at `/account/classes` is deleted and redirects there (P1-5) |
| Credits, Courses, Memberships, Recurring | **Passes and plans**, as tabs (P1-5) |
| Payments | **Profile**, as a section. `/account/payment-methods` redirects to `/account/profile#payment-methods` |
| Security | **Profile**, as a section. `/account/security` redirects to `/account/profile#security`, preserving the existing `#password` anchor |
| Venue dashboard (dual-role only) | Stays, rendered outside the four primary items as it is today |

- Final nav: **Bookings, Passes and plans, Profile, Help**. Help links to the existing `/help` centre.
- Every redirect above is permanent in behaviour but must be a 307/308 that preserves the fragment, since these paths appear in delivered emails and in customers' bookmarks (§5A).
- **Acceptance:** no horizontal scroll on the nav at 375px; exactly one navigation system reaches any destination; every path in the table above resolves rather than 404s; a test enumerates the twelve old paths and asserts each returns 200 or redirects to a 200.

**P1-5. Passes and plans consolidation** (moved here from Phase 3, where it was P3-3)

It sat in Phase 3 in earlier drafts, but P1-3 collapses the nav onto it in Phase 1, so Phase 1 would otherwise ship a nav item pointing at a page that does not exist until Phase 3. Moved rather than duplicated.

- New `/account/passes` hosting credits, courses, memberships and recurring as tabs, reusing `TabBar` from `@/components/ui/dashboard`.
- `/account/credits`, `/account/courses`, `/account/memberships`, `/account/recurring` and `/account/classes` all redirect into the matching tab.
- The existing section components move unchanged apart from the P0-7 primitives migration and the P1-4 copy pass. No behaviour change, no functionality lost.
- **Acceptance:** all five old routes redirect to the correct tab; every action available before the move is still available after it; deep-linking to a tab works and is shareable.

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
- Respect the `guest_self_reschedule` feature flag (default true, `src/lib/feature-flags/resolve.ts`). When off, hide the action and explain that the venue does not allow self-reschedule. This is a venue **product setting**, not a rollout gate: §5A ships this work unflagged, but a venue that has turned self-reschedule off must keep it off in the portal exactly as it is off on `/manage`.
- Handle the multi-session course case: reschedule affects one session only, with the existing warning copy.
- **Acceptance:** e2e reschedule through the portal, mirroring `e2e/guest-self-reschedule.spec.ts`.

**P2-4. Booking detail rebuild**
- Sections: status and countdown, when and where (with map link and `booking_location` handling for client-address and online bookings), service and practitioner, price breakdown, deposit and card-hold state, outstanding forms, special requests and notes, venue contact, action bar, timeline.
- Add to calendar via `buildGoogleCalendarAddUrlForBooking` plus an `.ics` download.
- **Acceptance:** parity with `/manage` on every field a guest can see, plus the fields only the portal knows (cross-venue history).

**P2-5. Retire the outbound manage links**
- Remove `<a href={manage_booking_link}>` from list and detail.
- **Delete `POST /api/account/bookings/[id]/manage-link` as well.** P0-3 added it so the portal could mint a short link on intent instead of on render; once Phase 2 performs the actions in place, nothing calls it, and leaving an authenticated route that mints a token granting cancel-without-login is a liability with no consumer. Transactional emails keep minting their own links through `createOrGetBookingShortLink` as they do today, untouched.
- **Acceptance:** no `/manage/` link is rendered anywhere under `/account`, and no route under `/api/account` mints one. The `/manage/[bookingId]/[token]` and `/b/{code}` routes themselves remain live indefinitely; this removes ResNeo's own outbound links, not the destinations (see §5A).

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

**P3-3. Passes and plans consolidation. Moved to Phase 1 as P1-5.**
P1-3 collapses the navigation onto this page in Phase 1, so it cannot wait until Phase 3. The id is retained here so that references to P3-3 in older notes resolve.

**P3-4. One-click first entry** (implements AD7, addresses G11)

This is the highest-value item in Phase 3. It is the first impression for essentially every customer.

**P3-4a. Portal token infrastructure**
- New table `account_portal_tokens`: `token_hash` (primary key), `user_id`, `scope` (`limited`), `issued_for_booking_id` (nullable, for revocation), `expires_at`, `revoked_at`, `created_at`. Hash only, never plaintext.
- `src/lib/auth/portal-token.ts`: `issuePortalToken`, `verifyPortalToken`, `revokePortalTokensForBooking`.
- Reusable within the window, never single-use, and no state mutation on verify. This defeats corporate link scanners (Outlook Safe Links, Proofpoint, Mimecast), which fetch every URL in inbound mail and would otherwise consume a single-use token before the customer clicks.
- 30-day expiry; revoked once the related booking is more than 30 days past.
- **Acceptance:** a token verified 20 times in a row still works; verifying issues no writes; an expired or revoked token fails closed.

**P3-4b. Limited sessions and step-up** (implements AD7's enforcement model)

**Prerequisite, to be confirmed before this task starts:** that Supabase access tokens on this project carry a `session_id` claim, and that the decision to enable secure password change and secure email change at project level has been taken. If either is not true, take AD7's descoped fallback instead of building this.

- New table `portal_limited_sessions`: `session_id` (primary key), `user_id`, `issued_for_booking_id`, `expires_at`, `created_at`. Service role only, no client access.
- On entry (P3-4c), record the new session's `session_id` in that table.
- Middleware and every sensitive route read `session_id` from the JWT and reject a match. **New routes reject a limited session by default**, so an omission fails closed rather than open.
- Permitted and denied exactly as AD7's scope table sets out.
- **The denied list is a per-route allowlist inversion, written once as a shared helper** (`rejectLimitedSession(request)`), applied to: `/api/account/payment-methods` and `setup-intent`, every money or obligation route under `/api/account/credits`, `/api/account/courses`, `/api/account/memberships` and `/api/account/class-recurring`, `/api/account/delete-request` and its `cancel`, `/api/account/devices`, `/api/account/sign-out-everywhere`, and `/api/account/password`. Denied routes redirect to `/auth/magic` for step-up.
- Step-up requires no unwind: a fresh magic-link sign-in issues a new `session_id` that is not in the table.
- Password and email change are **not** enforceable here, because the access token reaches the browser and the Supabase Auth API is directly reachable with it (AD7, §2.4). They are closed by the project-level settings named in the prerequisite. `/api/account/password` and the email branch of `/api/account/profile` still reject a limited session, but only as defence in depth, and the acceptance test below must not be read as proving the capability is blocked.
- **Acceptance:** a route test enumerates every route under `/api/account/*` and asserts each one either rejects a limited session or is on an explicit reviewed permit list, so a route added later fails the test until someone classifies it. Specific assertions: 403 on `/api/account/payment-methods`, `/api/account/memberships/checkout`, `/api/account/credits/purchase`, `/api/account/delete-request`, `/api/account/devices` and `/api/account/password`; 200 on `/api/account/bookings`. A separate manual check confirms that calling the Supabase Auth API directly with a limited session's token is refused by the project's reauthentication setting.

**P3-4c. Entry route**
- `GET /auth/portal?t=<token>` verifies the token, establishes a Supabase session via `admin.auth.admin.generateLink({ type: 'magiclink' })` plus server-side `verifyOtp` (the mechanism already used by `/api/auth/send-magic-link` and `/auth/confirm`), calls `claim_user_account()`, records the session in `portal_limited_sessions`, then redirects to the target.
- Do not mint a session by any other means. `verifyOtp` is what sets `auth.users.email_confirmed_at`, without which `claim_user_account()` will not link guest rows (`20270103123000`).
- Any failure falls through to `/auth/magic` with the email pre-filled, never to an error page.
- **Acceptance:** expired, revoked, malformed and absent tokens all land on a usable sign-in form. A user arriving with no prior `email_confirmed_at` has it set, and a guest row at a new venue links on that same visit.

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
- "Check your inbox" names the address and offers resend behind a cooldown.
- Keep the button-gated send. It must not regress to auto-send on mount; see the note in `AuthMagicForm.tsx` recording why that was removed.
- **Acceptance:** resend is available after the cooldown and the target address is shown.

**G11d is a configuration decision, not a task.** Link lifetime is `otp_expiry = 3600` in `supabase/config.toml` and the matching value on the hosted project, not anything in application code. Raising it applies to **every** email OTP on the project, including staff invites and password recovery, and Supabase caps it at 86,400 seconds. Decide it explicitly, with staff link exposure in view, rather than sliding it in with the portal work. If the answer is no, G11d stays open and P3-4a's 30-day portal token carries the "read email away from a browser" case instead, which is the case that actually motivated it.

**P3-4h. Reduce repeat friction**
- After first successful arrival, offer password setup once, as a prompt inside the portal, never as a gate before it. **Not passkeys**: there is no WebAuthn code anywhere in this repository and adding it is its own project, so passkeys are listed in §5C.
- Suppress the prompt afterwards using `user_profiles.portal_first_seen_at` (§7), so it is genuinely once and not once per device.
- **Session lifetime is a project setting, not code.** `jwt_expiry = 3600` with refresh-token rotation on (`supabase/config.toml`), so "a second visit needs no authentication" depends on the refresh token's lifetime and on the customer returning in the same browser. Decide the target window explicitly alongside the other two project decisions in the header, and note that it applies to staff sessions too.
- **Acceptance:** a returning customer within the agreed session window reaches the hub with zero authentication steps, verified on staging by leaving a session idle across the window boundary in both directions.

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
- **Ownership is established first, then payments are read as admin.** `booking_payments` has no customer-safe projection and gets none: the route resolves the customer's booking ids through `bookings_account_safe` on the session client, then reads the ledger as admin filtered to those ids. This is AD8's rule applied to a second table, and it is why no policy or view is needed on `booking_payments`.
- Project only what a customer should see: amount, currency, method, brand and last four, captured or refunded state, timestamp. Not `stripe_payment_intent_id`, not the staff member who took the payment, not the terminal or reader id.
- Per-booking receipt view and an account-level payment list.
- **Acceptance:** an in-person card payment recorded by staff appears to the customer within one refresh; a route test asserts another customer's booking id returns 404; a projection test asserts the Stripe and staff identifiers are absent from the response body.

**P4-3. Notification preferences across channels** (addresses G9)
- Extend `notification_preferences` to a per-category, per-channel matrix: reminders, changes, marketing across email, SMS, push.
- Migration must default existing users to current behaviour exactly.
- **Acceptance:** turning off SMS reminders stops SMS and leaves email untouched; verified by a comms renderer test.

**P4-4. Waitlist from the portal**
- Join, view and cancel waitlist entries against `/api/booking/appointment-waitlist`.
- **Acceptance:** a customer can join a waitlist for a venue they have used and see status.

**P4-5. Data export**
- Machine-readable export of bookings, profile and payments, alongside the existing delete request. **Format: a single JSON document**, since it must be complete and self-describing rather than convenient for a spreadsheet, and CSV cannot represent the nesting without inventing a schema.
- Same projections as the customer already sees on screen: `guests_account_safe`, `bookings_account_safe` and the P4-2 payment projection. An export is not a licence to widen access, and it must not become the one place `internal_notes` escapes.
- **Delivered as an authenticated download, not emailed.** Emailing a full personal-data archive creates a permanent copy in an inbox ResNeo does not control, and a forwarded or breached mailbox then holds everything. A limited session cannot request one (AD7).
- Rate limited per user, since it is expensive and a natural target.
- **Acceptance:** export completes for an account with 500 bookings across 4 venues without timing out; the payload contains no field absent from the two account-safe projections; a limited session receives 403.

**P4-6. Remove a saved card** (closes G14)
- `DELETE /api/account/payment-methods/[venueId]/[paymentMethodId]`, detaching on the venue's connected account via `stripe.paymentMethods.detach` with the correct `stripeAccount`. **The venue must be in the route**, because cards live on per-venue Connect customers via `venue_customer_stripe` and a payment method id alone cannot resolve the connected account. `GET /api/account/payment-methods` already requires `venue_id` for the same reason.
- Ownership check: the payment method must belong to the `venue_customer_stripe` customer for this `user_id` and venue. Never trust a payment method id from the client without that check.
- Warn, and require confirmation (P2-6), when the card is currently backing an open card hold or an active membership. Detaching underneath either would break a live obligation.
- **Acceptance:** a customer can remove their own card; attempting to detach another user's payment method id returns 404; removing a card backing an open hold is blocked with a clear explanation rather than a generic error.

**P4-7. Paginate booking history** (closes G17)
- Replace the hardcoded limit of 100 with cursor pagination on `(booking_date, booking_time, id)`, applied to `bookings_account_safe` (P0-6). The view exposes all three cursor columns, so no change to it is required.
- "Load more" on the list, and an explicit count so the customer knows how much history exists.
- Apply to `/api/account/bookings` and the server-rendered list alike.
- **Acceptance:** an account with 500 bookings can reach its oldest one; no page load exceeds the §6 query budget.

**P4-8. Brand the remaining transactional emails** (closes G20)
- Route the account-deletion email through `renderBaseTemplate`, as P3-4e does for the sign-in email.
- Remove the dead `context=customer` parameter from its links (G11f).
- **Acceptance:** both appear in the template gallery alongside booking emails; neither contains raw inline HTML.

### Phase 5: Mobile app enablement (scoped, not delivered here)

The React Native app is a separate repository. This phase is the ResNeo-side work that unblocks it.

Its tasks carry no acceptance criteria, deliberately: delivery is out of scope here, and criteria written now would be guesses about an app surface nobody has designed. Anything picked up from this phase gets criteria at that point, under §6's testing gate like everything else.

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

**This work ships unflagged.** Each phase is built, verified on staging, and then released to every venue at once. There is no `customer_portal_v2`, no `portal_one_click_entry`, and no cohort.

That is a deliberate decision, and it is also the only one the existing infrastructure supports. Flags are venue-scoped (`venues.feature_flags` plus an env override, over the closed key list in `src/lib/feature-flags/types.ts`), and the portal is cross-venue and per-customer: a customer of four venues has no single venue whose flag could decide which portal they see. Gating this properly would mean building user-scoped or percentage flags first, which is a project of its own and is not part of this plan. The venue flags this work *does* read, `guest_self_reschedule` and `card_hold_deposits`, are venue product settings that change what the portal offers, not gates on whether the portal work is live.

**What replaces the flag as a safety mechanism.**

- **Staging first, every phase.** Merge to `staging`, verify against the staging deployment and its Supabase project, then merge to `main`. No phase reaches `main` without the staging pass below.
- **Phase-sized releases.** Ship Phase 0, then 1, then 2, then 3, then 4, each as a complete unit. Do not part-release a phase, because there is no flag to hide a half-built surface.
- **Revert is the rollback.** Every phase must be revertible as a single merge, so keep migrations additive and separable from UI commits. A migration that drops or rewrites a column inside a phase makes that phase unrevertible and is not allowed. `bookings_account_safe` (P0-6), `account_portal_tokens` and `portal_limited_sessions` (P3-4) are all additive, so this holds.

**Staging must actually resemble production, or the pass proves nothing.** Before Phase 0 merges, confirm on the staging Supabase project: every migration applied, the two-venue customer fixture from P0-1 seeded, SendGrid configured so transactional email genuinely sends, Stripe Connect configured on the fixture venue, and, before Phase 3, the same auth settings as production (secure password change, secure email change, `otp_expiry`, session lifetime). A staging project whose auth settings differ from production cannot validate P3-4 at all.

**Staging pass, required before each phase merges to `main`.**

1. Full unit and route suite green, plus the e2e specs.
2. The phase's own acceptance criteria demonstrated on staging, not locally.
3. For Phase 0: P0-9's characterisation suite green both before and after P0-4, and P0-6's two access tests passing against the staging database with real data volume.
4. For Phase 2: a real cancel and a real reschedule performed through the portal on staging, with the resulting emails, refunds and card-hold settlements checked by hand against what `/manage` produces for an equivalent booking.
5. For Phase 3: a one-click entry link opened from a real inbox, including one corporate mailbox behind a link scanner, and confirmation that the token still works after the scanner has fetched it.

**Watch after each release, and what makes it a revert.** Read daily for the first week after each phase reaches `main`. The source column matters: a threshold with no source is not a control.

| Signal | Source | Revert threshold |
| --- | --- | --- |
| Cancel or reschedule error rate in-portal | `portal_events` (P0-10) | Above the equivalent rate on `/manage` |
| Portal token verification failures (Phase 3) | `portal_events`, emitted by `verifyPortalToken` on every failure path | Above 2 percent of entries, which indicates scanner consumption or clock skew |
| Support contacts mentioning sign-in | Manual, from the support inbox | Any rise at all |
| Portal 5xx rate | Vercel logs filtered to `/account` and `/api/account`, plus the existing `logBookingOp` error lane for action failures | Any sustained rise over the pre-release baseline |

**Take the pre-release baseline for all four before Phase 1 ships.** A threshold expressed as "above baseline" is meaningless without the baseline recorded, and after the release it is no longer obtainable.

**Phase 0 carries the least risk and should go first regardless.** It is behaviour-preserving by definition: the action extraction changes no logic, the timezone fix corrects a defect, the N+1 fix is invisible to the customer, and the account-safe view narrows access rather than widening it.

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

**None of these has anywhere to be written today.** The only event sink is `events`, whose `venue_id` is `NOT NULL` and whose RLS is staff-scoped, and portal entry frequently has no venue context. P0-10 builds the sink; it is a Phase 0 task precisely because everything above is unmeasurable after the fact.

**These numbers carry more weight than they would under a flagged rollout.** With no cohort to compare against, the before-and-after against the pre-release baseline is the only evidence available, and §5A's revert thresholds are read directly off them. Capture the baseline during Phase 0 and make sure the queries that read it are written and checked before Phase 1 ships, not improvised during an incident.

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
- **Passkeys and WebAuthn.** No WebAuthn code exists in the repository today. Earlier drafts of this plan referenced passkeys in the journey table and in P3-4h; both now say password, and passkeys are a separate project
- Any change to the venue-facing dashboard beyond what a shared component forces

---

## 6. Cross-cutting requirements

**Accessibility.** Target WCAG 2.2 AA. Two failures are already known and are remediated by P0-8, not discovered at review: no `aria-current` on active navigation and filters, and no live region on any asynchronous outcome (4.1.3 Status Messages). Beyond those: every interactive element keyboard reachable, dialogs follow the manual checklist in `Docs/DESIGN_SYSTEM.md`, status never conveyed by colour alone, and an axe pass runs over every `/account` route in CI.

**Components.** All new portal UI uses `@/components/ui/primitives` and `@/components/ui/dashboard`. No hand-rolled buttons, inputs, dialogs or overlays. `npm run lint:modals` must stay green.

**Copy.** Plain, warm, second person, aimed at non-technical customers. No em-dashes (`CLAUDE.md`). No implementation vocabulary: a customer should never read "Stripe", "Connect", "CDE" or "pence". Every destructive action states its consequence before confirming.

**Performance budget.** Hub and bookings list under 10 database queries each. No writes during a read. Time to first contentful paint under 1.5s on a mid-tier mobile device.

**Security.** Cross-user access returns 404. All booking access scoped through `loadAccountSafeGuests`, never by raw `booking_id`. No venue-private fields may cross into a customer response: `guests_account_safe` is the only permitted guest projection, and after P0-6 `bookings_account_safe` is the only permitted booking projection, which keeps `internal_notes`, `confirm_token_hash`, `stripe_payment_intent_id` and the staff actor ids out of reach by construction. Adding a column to either view is a security decision, not a convenience. Once limited sessions exist (AD7), every route must declare whether it accepts one; the default for a new route is to reject it, so an omission fails closed rather than open. Any public endpoint that sends email or SMS must be rate limited on both IP and target address.

**Timezone.** Every rendered time carries a venue-local value and an explicit timezone label where it differs from the customer's profile timezone.

**Testing gate.** No task is complete without unit tests for logic, a route test for any new endpoint, and an e2e for any new customer-visible flow.

**Analytics.** See §5B. The baseline must be captured during Phase 0, because none of it can be reconstructed afterwards.

**Rollout.** See §5A. No flags. Every phase ships as a complete, revertible unit: staging first, then every venue at once.

---

## 7. Data model changes

Six migrations are anticipated. All are additive, which is what makes §5A's "revert is the rollback" workable.

0. **`bookings_account_safe` view** (P0-6, AD8). No schema change, view plus `GRANT SELECT ... TO authenticated`. Created without `security_invoker`, matching `guests_account_safe`. **No RLS policy is added to `bookings`**; G12 records why one cannot work. Confirm the plan of the `guests (user_id)` subquery on a realistic dataset before merge. This is the first migration to ship and it gates Phase 2.
1. **Portal metrics sink** (P0-10). Prefer a new `portal_events` table (`id`, `user_id` nullable, `venue_id` nullable, `event_type`, `payload`, `created_at`, service role only) over relaxing `events.venue_id`, which is `NOT NULL`, append-only and read by venue reporting.
2. **`account_portal_tokens`** (P3-4a). New table: `token_hash` primary key, `user_id`, `scope`, `issued_for_booking_id` nullable, `expires_at`, `revoked_at`, `created_at`. Indexed on `user_id` and on `issued_for_booking_id` for revocation. RLS: no direct client access; service role only. `booking_short_links` cannot be reused because it is booking-scoped, its `purpose` column carries a CHECK of `manage | confirm | payment`, and its `booking_id` FK is required.
3. **`portal_limited_sessions`** (P3-4b). New table: `session_id` primary key (the `session_id` claim from the Supabase access token), `user_id`, `issued_for_booking_id`, `expires_at`, `created_at`. Indexed on `user_id`. Service role only. This is what carries session scope, in place of a JWT claim, because the project has no custom access token hook and `app_metadata` is per user rather than per session.
4. **Notification preferences matrix** (P4-3). Extend the `notification_preferences` JSON shape on `user_profiles`. Backfill must preserve current effective behaviour for every existing row.
5. **Optional: `user_profiles.portal_first_seen_at`** (P3-5) to drive the first-run explainer once.

Receipts, forms, waitlist and history all read from existing tables.

Two changes sit outside the migrations and outside application code entirely, and both need an owner before P3-4 starts: enabling secure password change and secure email change on the Supabase project (AD7, P3-4b), and the decision on `otp_expiry` (P3-4g).

---

## 8. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Refactoring `/api/confirm` regresses refunds or card-hold settlement | High. Financial. | The existing e2e specs are **not** sufficient: all four are appointment-shaped and none covers credits, waitlist cascades, card holds or event tickets. P0-9 writes characterisation tests against current behaviour first, and P0-4 must clear them unchanged. Ship it alone, before any UI work. |
| Portal and manage page drift apart on policy copy | Medium. Customer confusion, disputes. | Shared copy helpers and a snapshot test asserting both surfaces render identical fee and deadline text. |
| Cross-customer booking leak from a single dropped filter | **Critical. Every customer's bookings, to any authenticated user.** Currently one application-level filter is the sole control (G12). | P0-6 adds a database-side ownership predicate in `bookings_account_safe` so two independent controls exist. Blocks Phase 2. Asserted by a test that queries the view with no application filter at all. |
| Fixing G12 with an RLS policy on `bookings` instead | High, in two directions at once. The policy silently returns nothing (the `guests` subquery is filtered by `guests` RLS), so the portal empties; or it works and exposes `internal_notes` and staff actor ids to every customer over PostgREST. | Recorded in G12 and AD8 so the "obvious" fix is not attempted. The view is the mechanism. Acceptance includes asserting a customer session reading `bookings` directly still gets zero rows. |
| A column added to `bookings` later leaks into the customer surface | Medium. Privacy, and it would go unnoticed. | `bookings_account_safe` is an explicit column allowlist, so new columns are invisible until someone adds them deliberately. §6 records that adding one is a security decision. |
| Cross-venue data leak through a new endpoint | High. Privacy. | Every new route scoped via `loadAccountSafeGuests`; 404-on-foreign-booking asserted in route tests. |
| Accidental cancellation of a paid membership | Medium to high. Revenue and trust. One click does it today, with no confirmation. | P2-6 requires a dialog naming the exact date access ends. |
| Detaching a card that backs an open card hold or active membership | Medium. Breaks a live financial obligation and is hard to diagnose. | P4-6 blocks the removal with a specific explanation rather than allowing it and failing later. |
| The account-safe view's ownership subquery degrades query performance at scale | Medium. Slow portal for the customers with the most history, and the view is on the hot path for every portal read. | Query plan verified on a realistic dataset during P0-6. `idx_guests_user_venue` leads with `user_id` and is confirmed usable for the predicate; add a dedicated index only if the plan says so. |
| A limited session spends money from a forwarded email | **High. Financial, and irreversible from the customer's point of view.** Buying a membership or a credit pack is a charge on a saved card. | AD7 denies every money and obligation route, and P3-4b's acceptance enumerates all `/api/account/*` routes so a route added later fails the test until someone classifies it. |
| P1-3 collapses the nav onto destinations that do not exist yet | Medium. A shipped nav item leading nowhere, on the primary surface. | P1-3 carries a placement table covering all twelve current destinations, and P1-5 (moved out of Phase 3) builds the one new page it needs. P1-3 depends on P1-5, stated in the graph. |
| Scope creep into commerce | Medium. Delay. | Receipts read the existing ledger only. No product, cart or inventory concepts enter this plan. |
| Notification preference migration changes who gets messaged | High. Trust, possible compliance issue. | Backfill defaults to current behaviour; a dry-run diff of intended recipients before and after must be produced and reviewed. |
| Email link scanners consume portal tokens before the customer clicks | High. The one-click flow silently fails for corporate and some consumer mailboxes. | Tokens reusable within window, never single-use; no mutation on verify (P3-4a). Test with a scanner-style double fetch before release. |
| A forwarded confirmation email grants portal access | Medium. Privacy. | Session is limited: no payment methods, no deletion, no device management (AD7, P3-4b), and no password or email change once the project-level settings are on. This is the same exposure the existing `manage_booking_link` already carries, and it is narrowed, not widened. |
| A limited session changes the password or email by calling the Supabase Auth API directly | **High. Full account takeover from a forwarded email.** The access token reaches the browser and no ResNeo code sits in that path, so middleware and route checks cannot stop it. | Not fixable in application code. Closed at project level with secure password change and secure email change, which apply to every session however obtained. This is a prerequisite for P3-4b, not a follow-up: if it is not taken, AD7 descopes to landing on `/manage` instead. |
| `session_id` is absent from the access token on this project | Medium. P3-4b has no key to record a session against. | Confirmed before P3-4b starts, not during. `app_metadata` is not a fallback, since it is per user and would downgrade the customer's other sessions. If absent, take AD7's descoped fallback. |
| Shipping unflagged means a bad phase reaches every venue at once | Medium to high. No cohort to catch it first. | §5A: staging pass per phase, phase-sized releases only, every phase revertible as one merge with additive migrations only, and revert thresholds agreed in advance and read daily for the first week. |
| ~~Unrated-limited magic-link endpoint used to mail-bomb third parties~~ | High. Abuse, sender reputation, possible blocklisting of the sending domain. | **Closed.** P3-4f shipped ahead of the rest of the plan. |
| A link in an already-delivered email stops working | Medium to high. Emails are permanent; a broken link is unrecoverable for that customer and looks like a dead product. | §5A backwards-compatibility rules, with a test asserting today's URL shape still resolves after P3-4. |
| Rate limiter is per-instance, so serverless scale-out weakens it | Low to medium. A determined attacker across many cold starts gets a multiple of the intended limit. | Accepted for now; `checkRateLimit` is documented as best-effort per instance and this matches how `booking/create` and `contact` already work. Revisit with a shared store if abuse is observed. |
| One-click entry is read as less secure by a venue or an auditor | Low. Perception. | Document the comparison with `manage_booking_link` explicitly: the token grants strictly less capability than the cancel link already present in the same email. |

---

## 9. Sequencing and estimate

| Phase | Content | Estimate |
| --- | --- | --- |
| 0 | Foundations: tests, timezone, N+1, action extraction, loading states, **account-safe view, characterisation tests, metrics sink, design-system migration, accessibility remediation** | 4 to 4.5 weeks |
| 1 | Hub, navigation, IA dedup, **passes and plans consolidation (P1-5, moved from Phase 3)**, copy pass | 2 weeks |
| 2 | In-portal cancel, reschedule, confirm, detail rebuild, confirmation dialogs | 2.5 to 3 weeks |
| 3 | One-click entry (P3-4), rebook, venue history, discovery | 2 to 2.5 weeks |
| 4 | Forms, receipts, notification matrix, waitlist, export, card removal, pagination, email branding | 2.5 weeks |
| **Total (web, world-class)** | | **13 to 14.5 weeks** |
| 5 | Mobile enablement (ResNeo side only) | 1.5 weeks |

Phase 0 is non-negotiable and must ship before Phase 1, and **P0-6 must ship before Phase 2 under any scope reduction**. Phases 3 and 4 can be reordered against commercial priority. A credible reduced scope is Phases 0 to 2, which delivers a portal that is genuinely useful, at 8.5 to 9.5 weeks.

**On the estimate increase.** Phase 0 doubled after the second review and grew again after the third; the total went from 9 to 14.5 weeks. That is not scope creep. Each increase came from finding something the previous version had assumed was in acceptable shape: booking access has no database backstop, the portal shares no components with the rest of the product, two accessibility failures are already present, the guard the action extraction was meant to lean on does not cover the cases most likely to break, and the metrics that justify the work have nowhere to be written. All of them get worse and more expensive the more surface is built on top of them, which is why they sit in Phase 0 rather than being deferred.

**Shipping unflagged does not reduce the estimate.** It removes the dual code paths a flag would have required, but it adds the staging pass in §5A and the discipline of keeping each phase revertible as a single merge. Treat those as cancelling out. What it does change is that a phase is either finished or not shipped, so there is no partial-merge relief valve when a phase runs long.

**Moving P3-3 to Phase 1 as P1-5** shifts half a week from Phase 3 to Phase 1 and leaves the total unchanged. It is not new scope; the work was always in the plan, just after the navigation that depends on it.

If the timeline is the binding constraint, the honest reduction is to cut Phase 4 and defer Phase 3 past the one-click entry work, not to trim Phase 0.

**One item should jump the queue regardless of how the rest is sequenced.** `P3-4d` (land on the specific booking) is a small change to one URL builder and delivers a disproportionate share of the perceived improvement. It can ship with Phase 1 rather than waiting for the full token work. Old links that carry no token must still degrade to the sign-in form, per §5A.

`P3-4f` (rate limit the magic-link endpoint) was the other item on this list and **has already shipped**, ahead of the rest of the plan, which is why G11c is closed.

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

16. Customer data is protected by **two** independent controls, a database-side ownership predicate in `bookings_account_safe` and an application filter, either sufficient alone, over a column allowlist that cannot leak staff fields even if both fail.
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
| 2026-08-09 | **Feasibility review against the code. Two architecture decisions replaced.** AD8 no longer adds an RLS policy to `bookings`: the policy would have returned nothing (its `guests` subquery is filtered by `guests` RLS, whose customer policy was deliberately dropped) and, had it worked, would have exposed `internal_notes` and staff actor ids over PostgREST. It is now the `bookings_account_safe` view, mirroring `guests_account_safe`. AD7 no longer relies on a `portal_scope` JWT claim: there is no custom access token hook on this project and `app_metadata` is per user rather than per session. Scope is now recorded server-side in `portal_limited_sessions`, keyed on the token's `session_id`, and password and email change are closed at project level because the access token reaches the browser and no ResNeo code sits in that path. A descoped fallback is documented for the case where those project settings are not taken. |
| 2026-08-09 | **Rollout flags removed at the product owner's direction.** §5A no longer proposes `customer_portal_v2` or `portal_one_click_entry`. Each phase is built, verified on staging, then released to every venue at once. This also resolves a genuine incompatibility: flags are venue-scoped and the portal is cross-venue, so no venue's flag could have gated it. §5A now carries the staging pass, phase-sized releases, revert-as-rollback and the revert thresholds that replace the kill criteria. |
| 2026-08-09 | Added P0-9 (characterisation tests for `/api/confirm`, blocking P0-4, because all four e2e specs are appointment-shaped and cover none of the paths most likely to break) and P0-10 (a metrics sink, because `events.venue_id` is `NOT NULL` and portal entry has no venue context). Reclassified G11d as a project configuration decision, since link lifetime is `otp_expiry` and applies to staff invites and recovery too. Added venue scope to P4-6, since cards live on per-venue Connect customers. Phase 0 3 to 3.5 weeks becomes 4 to 4.5; total 12 to 13.5 becomes 13 to 14.5. |
| 2026-08-09 | **Completeness pass. Six gaps closed, no new scope.** (1) AD7's limited session denied nothing that spends money, so a forwarded confirmation email could have bought a membership on the recipient's saved card; every route under credits, courses, memberships and class-recurring is now denied, and P3-4b's acceptance enumerates all `/api/account/*` routes so a route added later fails until classified. (2) P1-3 collapsed the navigation onto a page P3-3 did not build until Phase 3, and left Events, Resources, Payments and Security unplaced; P1-3 now carries a placement table for all twelve destinations and P3-3 moved to Phase 1 as P1-5. (3) Passkeys were referenced in §4 and P3-4h with no WebAuthn code in the repository and no task; both now say password and passkeys moved to §5C. (4) P0-1 assumed an e2e sign-in that has no harness; it now builds the `generateLink` helper and a two-venue customer fixture first. (5) AD1 still claimed the existing e2e specs were the guard, contradicting G6, P0-4 and §8; it now points at P0-9 and specifies the result-type and deferred-effect model the extraction needs. (6) P1-1 had no acceptance criteria, P4-2 did not say how `booking_payments` is scoped, P4-5 did not specify format or delivery, and §5A's thresholds had no sources. Session lifetime added as a third project-level decision. Phase 1 2 weeks, Phase 3 2 to 2.5; total unchanged at 13 to 14.5 weeks. |
