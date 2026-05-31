# Resneo: Class Products — Production Readiness Plan

**Status:** Draft for development
**Author:** Andrew (with Claude)
**Scope:** Bring the Class products area (`/dashboard/class-timetable/products`) and the end-to-end class booking journey to fully polished, production-ready status.
**Estimated effort:** 4–6 weeks for a single competent full-stack developer working through this plan in sequence.
**Document version:** 1.0 (initial plan, derived from a live-codebase audit)

---

## 0. Status snapshot

The Class products area is **functionally about 60% complete**. The setup UI, basic CRUD, and the credit-purchase fulfilment path are solid. However, several capabilities advertised in the products UI are not enforced anywhere in code, and there are real customer-money correctness bugs in the cancellation, abandonment, and concurrency paths.

This plan is the punch list to fix that. It is grouped by severity:

| Phase | Theme | Items | Calendar |
|---|---|---|---|
| **Phase 1 — Ship-blockers** | Correctness, money safety, mis-leading features | 5 | ~10 working days |
| **Phase 2 — Significant** | Missing primary flows (cancellation, attendance, comms, gating) | 6 | ~12 working days |
| **Phase 3 — Polish** | UI quality, discoverability, defensible UX | 6 | ~5 working days |

Each item below specifies what to change, where, and how to verify, using the conventions already established in the Resneo codebase. The reviewer should reject any diff that introduces patterns inconsistent with this plan.

---

## 1. Terminology and codebase conventions

Read this before reading any specific item. Every later section assumes these.

| Concept | Where it lives |
|---|---|
| **Class type** | `public.class_types` — "Beginners Pilates" definition. Belongs to a venue, hung off a calendar column (`instructor_id` → `unified_calendars` or legacy `practitioners`). |
| **Class instance** | `public.class_instances` — a single bookable session of a class type at a date/time. Generated from `class_timetable` recurrence rules or one-off via `/api/venue/class-instances/bulk`. |
| **Credit pack** | `public.class_credit_products` — sells N credits for £X with optional validity + eligible class types. |
| **Credit balance batch** | `public.user_class_credit_balances` — one row per purchase grant. Consumed FIFO. |
| **Credit ledger** | `public.class_credit_ledger` — append-only `purchase / redeem / refund / expire / admin_adjust` rows with idempotency keys. |
| **Course** | `public.class_course_products` — bundle of `class_instances` with a price + enrollment window. Enrollment via `public.class_course_enrollments`; session link via `public.class_course_session_enrollments`. |
| **Membership** | `public.class_membership_products` — Stripe-billed subscription with a `rules` JSONB. Mirror of Stripe sub in `public.class_memberships`. |
| **Recurring reservation** | `public.class_recurring_reservations` — standing guest rule materialised nightly by `/api/cron/class-recurring-materialize`. |
| **Booking group** | `public.class_booking_groups` — links many `bookings.group_booking_id` rows from a single cart checkout, course enrollment, or recurring materialisation. |
| **Checkout transaction** | `public.class_checkout_transactions` — PaymentIntent audit for class commerce. |
| **Membership allowance ledger** | `public.class_membership_allowance_ledger` — defined in schema, **never written or read in code today** (Phase 1 fix). |
| **Stripe customer scope** | Per-venue Customer on the venue connected account, stored in `public.venue_customer_stripe`. |
| **PI metadata purpose** | `meta.reserve_ni_purpose` ∈ `RESERVE_NI_PI_PURPOSE` (`CLASS_CREDIT_PURCHASE`, `CLASS_COURSE_ENROLLMENT`, `CLASS_CART_CHECKOUT`) — branch key in the Stripe webhook. |
| **Subscription metadata purpose** | `meta.reserve_ni_purpose` ∈ `RESERVE_NI_SUBSCRIPTION_PURPOSE.CLASS_MEMBERSHIP`. |
| **Cron secret** | `requireCronAuthorisation()` from `src/lib/cron-auth.ts`. Cron jobs registered in `vercel.json`. |
| **Communications** | Policy-keyed framework in `src/lib/communications/policies.ts` (`CommunicationMessageKey`) + `sendCommunication` from `src/lib/communications`. **New message keys plug into this — no new templating system.** |
| **Tier gating** | `isAppointmentPlanTier(venue.pricing_tier)` from `src/lib/tier-enforcement.ts`. Plan available on `light`, `plus`, `appointments`. Restaurant SKUs do not see class commerce in v1. |
| **Secondary model gating** | `requireVenueExposesSecondaryModel(admin, venueId, 'class_session')` from `src/lib/booking/require-venue-secondary-model.ts`. |
| **Feature flag** | `venues.feature_flags` JSONB ([20260520120000_venue_feature_flags.sql](../supabase/migrations/20260520120000_venue_feature_flags.sql)) resolved via `src/lib/feature-flags/resolve.ts` with env override. |
| **Append-only audit on a domain** | Mirror `events_append_only` BEFORE UPDATE/DELETE trigger from [20260301000006_create_events.sql](../supabase/migrations/20260301000006_create_events.sql). |

**RLS posture:** every class-commerce table has RLS enabled with no policies — meaning all access must go through `service_role` (admin Supabase client). This is correct for a commerce subsystem and must not change.

**Migration style:** `IF NOT EXISTS` guarded everywhere; idempotent on Supabase preview branches; `text` + `CHECK` constraints for new finite-value columns (not Postgres `ENUM`). Newer ledgers already follow this.

---

## 2. Open product decisions

These choices change the implementation. **Resolve them before starting Phase 1.**

| # | Question | Default recommended |
|---|---|---|
| Q1 | When a credit-paid class booking is cancelled by the guest within `cancellation_notice_hours`, should the credit be restored? Always? Only if cancellation_notice met? | Restore only if cancellation policy met (matches Stripe refund semantics). On staff cancel: always restore unless staff opts out. |
| Q2 | Does an unlimited membership cover **any** class type by default, or must `eligible_class_type_ids` be set? | Empty list = all class types (already the credits-pack semantics). |
| Q3 | If a venue archives a membership product with no active subscribers, do we also archive the live Stripe Product? | Yes, automatically. Archiving a product the venue no longer offers should remove it from Stripe Checkout. |
| Q4 | For the recurring reservation `rule` JSONB shape — do we support multi-weekday rules (e.g. Tue + Thu)? | v1 = single weekday + start_time. Multi-weekday in v2. |
| Q5 | Should expired credits be silently expired by cron, or should the guest be emailed? | Cron + a 7-day "credits expiring" email reminder (new policy key). |
| Q6 | Should membership session-allowance enforcement reset on the Stripe subscription period boundary? | Yes — derived from `class_memberships.current_period_end`, mirrored from Stripe webhook. |
| Q7 | What is the cancellation policy for course enrollments — flat 7-day refund window, or per-course configurable? | Per-course `cancellation_window_days` column (default 7). |
| Q8 | Should the public booking page show the **price after applying member discount** to a logged-in member, or only the headline price? | Show the member price when applicable, with a "Member price" pill. |
| Q9 | Does class commerce roll out behind a venue feature flag, or is it on by default for any venue with `class_session` model enabled? | Behind flag `class_commerce_enabled` so we can pilot per-venue. |

Throughout this plan, the **recommended default** is assumed. Where an alternative was chosen during decision-making, that branch is noted inline.

---

## 3. Architecture refresher (read this once)

```
Public class booking flow
─────────────────────────
GET  /api/booking/class-offerings        → list class instances + commerce catalog (credits/courses/memberships)
POST /api/booking/class-cart/quote       → capacity + price quote, no side effects
POST /api/booking/class-cart/checkout    → atomic group booking:
   for each line:
     if pay_with_class_credits AND credits cover the class type → free booking + ledger redeem
     elif active course covers the instance                     → free booking
     elif unlimited membership covers the class type            → free booking (Phase 1.5: allowance/discount)
     else                                                       → pending paid booking
   if any paid lines → create Stripe PaymentIntent on connected account
   on rollback path → DELETE bookings + class_booking_groups row

Standalone purchases
────────────────────
POST /api/account/credits/purchase  → PaymentIntent + Stripe Elements client_secret
POST /api/account/credits/fulfill   → confirm + fulfillCreditPurchaseFromPaymentIntent (idempotent)
POST /api/account/memberships/checkout  → Stripe Checkout session (mode='subscription')
POST /api/account/courses/checkout      → PaymentIntent for course
POST /api/account/courses/enroll        → for free courses

Webhooks (src/app/api/webhooks/stripe/route.ts)
───────────────────────────────────────────────
payment_intent.succeeded:
  if meta.reserve_ni_purpose = CLASS_CREDIT_PURCHASE     → fulfillClassCreditPurchaseFromPaymentIntent
  if meta.reserve_ni_purpose = CLASS_COURSE_ENROLLMENT   → fulfillCourseEnrollmentFromPaymentIntent
  else booking_id-driven → confirmBookingsForSucceededPaymentIntent (handles CLASS_CART_CHECKOUT)
payment_intent.payment_failed → updates deposit_status='Failed' on bookings (TODAY: by meta.booking_id only)
customer.subscription.{created,updated,deleted} → syncClassMembershipFromStripeSubscription

Cron (vercel.json)
──────────────────
0  3 * * *   /api/cron/materialize-event-sessions   (existing)
15 4 * * *   /api/cron/class-recurring-materialize  (existing)
*/30 * * *   /api/cron/auto-cancel-bookings          (existing — TODO: extend to abandoned cart-paid class bookings)
0  2 * * *   /api/cron/class-credit-expiry          (NEW — Phase 1.3)
0  2 * * *   /api/cron/class-membership-period-reset (NEW — Phase 1.5)
```

---

## 4. Phase 1 — Ship-blockers (must fix before live)

### 4.1 Restore class credits on booking cancellation

**Problem.** `restoreClassCreditsForBooking` in [`src/lib/class-commerce/restore-class-credits.ts`](../src/lib/class-commerce/restore-class-credits.ts) is fully implemented but **called from zero places**. Cancelling a credit-paid class booking burns the customer's credit.

**Fix scope.**

1. **Detection helper** — `src/lib/class-commerce/booking-was-credit-paid.ts` (new):
   ```typescript
   export async function bookingWasCreditPaid(
     admin: SupabaseClient,
     bookingId: string,
   ): Promise<boolean> {
     const { data } = await admin
       .from('class_credit_ledger')
       .select('id')
       .eq('booking_id', bookingId)
       .eq('reason', 'redeem')
       .limit(1)
       .maybeSingle();
     return Boolean(data);
   }
   ```

2. **Wire into staff cancel** — `src/lib/booking/staff-cancel-booking.ts`:
   - After the Stripe refund branch succeeds and the booking transitions to `Cancelled`, but inside the same `for (const id of idsToCancel)` loop, call `restoreClassCreditsForBooking` for each cancelled booking ID with `idempotencyPrefix = 'staff_cancel:${bookingId}'`.
   - If the booking is not credit-paid the function returns `{ ok: true, restoredCredits: 0 }` (no-op).
   - Per Q1 default policy: **always restore on staff cancel.** Add a `restoreCredits?: boolean` flag to `StaffCancelBookingNotifyOptions` defaulting to `true` so a future "void & forfeit" path can opt out.

3. **Add membership allowance restore** — same wiring, after Phase 1.5 lands the allowance ledger:
   ```typescript
   await restoreMembershipAllowanceForBooking(admin, {
     bookingId: id,
     idempotencyPrefix: `staff_cancel:${id}`,
   });
   ```

4. **Wire into guest self-cancel** — when the guest-self-reschedule / guest-self-cancel surface lands for classes (currently scoped to appointments). For Phase 1 the manual public path is `/manage` (`/api/v1/manage-booking/[token]/route.ts`); audit its `Cancel` branch and add the same restore call when the underlying booking is a `class_session` model.

5. **Audit trail** — write a `bookings.events` row of type `class_credit_restored` with payload `{ restored_credits, source: 'staff_cancel' | 'guest_self_cancel' }` for traceability.

**Acceptance.**
- Manual test: book a class with 1 credit. Staff cancels. Guest's `user_class_credit_balances` row goes from 0 → 1, `class_credit_ledger` gets a `refund` row with the same `booking_id`, the `idempotency_key` `staff_cancel:<id>:restore:<ledger_id>` is set.
- Idempotency test: cancel the same booking twice — second cancel does not double-restore.
- Unit test in `src/lib/class-commerce/__tests__/restore-credits-on-cancel.test.ts`.

**Effort:** 1 day.

---

### 4.2 Honor the `rule` JSONB in recurring reservations

**Problem.** `materializeRecurringReservation` ([`src/lib/class-commerce/materialize-recurring-reservation.ts`](../src/lib/class-commerce/materialize-recurring-reservation.ts)) reads only `class_type_id` and `next_materialize_on`, then books the next 6 instances of that class type. The `rule` JSONB on `class_recurring_reservations.rule` is never read; the POST endpoint accepts any shape.

**Fix scope.**

1. **Define a strict rule schema** — `src/lib/class-commerce/recurring-rule-schema.ts` (new):
   ```typescript
   import { z } from 'zod';

   export const classRecurringRuleSchema = z.object({
     /** 0=Sun … 6=Sat. v1: single weekday. Multi-weekday is v2. */
     weekday: z.number().int().min(0).max(6),
     /** Local time HH:mm. Must match a real class_timetable slot for that class_type + weekday. */
     start_time: z.string().regex(/^\d{2}:\d{2}$/),
     /** ISO date string. Materialisation stops on or after this date. Optional. */
     end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
     /** Absolute cap on materialised bookings. Optional. */
     max_occurrences: z.number().int().min(1).max(104).optional(),
     /** Number of weeks to skip between bookings (1 = weekly, 2 = fortnightly). */
     interval_weeks: z.number().int().min(1).max(8).default(1),
   });
   export type ClassRecurringRule = z.infer<typeof classRecurringRuleSchema>;
   ```

2. **POST `/api/account/class-recurring`** — replace `rule: z.record(z.string(), z.unknown()).default({})` with `rule: classRecurringRuleSchema`. Reject rules whose `(weekday, start_time)` does not match a real active `class_timetable` row for that `class_type_id`, with a 400 error: `"There is no class at that time on that weekday for this class type."`

3. **Materialisation algorithm** — rewrite `materializeRecurringReservation` to:
   ```
   1. Parse rule (drop materialisation if invalid)
   2. fromDate = max(today, last_materialized_on + interval_weeks * 7d) - or next occurrence of (weekday, start_time) from today if last_materialized_on is null
   3. windowEnd = min(today + 28d, rule.end_date if set)
   4. Enumerate target (date, time) tuples matching rule between fromDate..windowEnd
   5. For each target:
      a. Look up the class_instance with (class_type_id, instance_date=date, start_time=time, is_cancelled=false)
      b. If absent → skip (instance not materialised yet by the upstream timetable cron)
      c. If guest already has a booking for that instance → skip
      d. Check max_occurrences cap (count existing recurring bookings linked to this rule)
      e. Skip if class requires online payment (current safeguard kept)
      f. Insert free class_session booking; tag with metadata.class_recurring_reservation_id = reservation.id
   6. Count of bookings created → status
   7. next_materialize_on = the next target after windowEnd (or null if end_date reached)
   ```

4. **Track materialisation lineage** — add `class_recurring_reservation_id uuid REFERENCES class_recurring_reservations(id) ON DELETE SET NULL` to `bookings` (new migration) so:
   - The `max_occurrences` cap can count existing bookings.
   - Cancellation knows the booking originated from a recurring rule (useful for "cancel and pause this series" UX in Phase 2).

5. **Surface `last_error` on the guest UI** — `src/components/account/AccountRecurringSection.tsx` should render `reservation.last_error` prominently with a "Pause / Edit / Delete" action when set. Default copy: _"This recurring booking couldn't run on its last try: {last_error}. Pause or edit to fix it."_

**Migration** — `supabase/migrations/2026XXXX_class_recurring_lineage.sql`:
```sql
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS class_recurring_reservation_id uuid
  REFERENCES public.class_recurring_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_class_recurring
  ON public.bookings (class_recurring_reservation_id)
  WHERE class_recurring_reservation_id IS NOT NULL;
```

**Acceptance.**
- Manual: create a rule "Tuesday 7pm Pilates, end_date 2026-08-01, interval 1". Run the cron. Only Tuesday 7pm Pilates bookings appear, only until end_date.
- Edge case: 2nd materialisation run is idempotent (no double-bookings).
- `max_occurrences=4` rule produces exactly 4 bookings and then sets `next_materialize_on = null` and status remains active (so it can be paused/cancelled cleanly).

**Effort:** 2 days.

---

### 4.3 Filter expired credits and add a nightly expiry cron

**Problem.** `consumeClassCreditsForBooking` filters by `credits_remaining > 0` only — expired credits are spendable. No cron expires balances.

**Fix scope.**

1. **Update the WHERE in `consumeClassCreditsForBooking`** — `src/lib/class-commerce/consume-class-credits.ts`:
   ```typescript
   .gt('credits_remaining', 0)
   .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
   ```

2. **Update `sumAvailableClassCreditsForClassType`** ([`src/lib/class-commerce/available-class-credits.ts`](../src/lib/class-commerce/available-class-credits.ts)) — same filter so the UI doesn't claim credits the engine refuses to spend.

3. **New cron** — `src/app/api/cron/class-credit-expiry/route.ts`:
   - Authenticate with `requireCronAuthorisation`.
   - For each `user_class_credit_balances` row with `expires_at < now()` AND `credits_remaining > 0`:
     - Insert an `expire`-reason `class_credit_ledger` row with `delta_credits = -credits_remaining`, idempotency key `expire:<balance_id>:<expires_at_iso>`.
     - Update `credits_remaining = 0`.
   - 7 days **before** expiry, if `reminder_sent_at IS NULL` (new column — see migration), send a `class_credits_expiring` communication and stamp `reminder_sent_at = now()`.
   - Insert a `runs` row on success/failure (the existing job-run audit table).

4. **Register cron** — `vercel.json`:
   ```json
   { "path": "/api/cron/class-credit-expiry", "schedule": "30 2 * * *" }
   ```

5. **Migration** — `supabase/migrations/2026XXXX_class_credit_expiry_reminder.sql`:
   ```sql
   ALTER TABLE public.user_class_credit_balances
     ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
   ```

6. **Comms key** — see §11.

**Acceptance.**
- Backfill test: create a balance with `expires_at = now() - 1 day`, `credits_remaining = 5`. Run cron. Balance → 0, ledger has an `expire` row with `delta_credits = -5`.
- Re-run cron → no duplicate ledger row (idempotency_key collision).
- Pre-expiry reminder: balance with `expires_at = now() + 6 days, reminder_sent_at = null` → email sent, column stamped, no re-send next day.
- Spend test: balance expired before consume runs → `consumeClassCreditsForBooking` returns `insufficient_credits`.

**Effort:** 1 day.

---

### 4.4 PaymentIntent failure and cart abandonment

**Problem.**
- The webhook's `payment_intent.payment_failed` branch updates `deposit_status='Failed'` keyed on `meta.booking_id`. Cart PI metadata sets `booking_id` = primary, but `booking_ids` (comma-separated) contains all paid bookings. Secondary paid bookings stay `Pending` forever.
- The `auto-cancel-bookings` cron only handles `source='phone'` bookings. An abandoned-mid-checkout cart leaves `Pending` paid class bookings holding capacity indefinitely.

**Fix scope.**

1. **Webhook — look up by PI, not by metadata** — `src/app/api/webhooks/stripe/route.ts`:
   - In the `payment_intent.payment_failed` branch, replace the single-booking update with a query by `stripe_payment_intent_id`:
     ```typescript
     const { data: failedRows } = await supabase
       .from('bookings')
       .select('id, venue_id')
       .eq('stripe_payment_intent_id', pi.id)
       .eq('deposit_status', 'Pending');

     for (const row of failedRows ?? []) {
       // update deposit_status='Failed' + comms
     }
     ```
   - Same pattern is already used in the refund branch (lines 274-296 of the webhook).

2. **New cron path — class cart abandonment** — extend `auto-cancel-bookings` to handle pending class_session bookings with `source = 'online'` AND `deposit_status = 'Pending'` AND `stripe_payment_intent_id IS NOT NULL` older than 30 minutes:
   ```typescript
   // After phone-booking branch, add:
   const classAbandonCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
   const { data: abandonedClassBookings } = await supabase
     .from('bookings')
     .select('id, venue_id, guest_id, group_booking_id, stripe_payment_intent_id, class_instance_id')
     .eq('status', 'Pending')
     .eq('deposit_status', 'Pending')
     .eq('source', 'online')
     .not('class_instance_id', 'is', null)
     .lt('created_at', classAbandonCutoff);
   ```
   - For each, call `stripe.paymentIntents.retrieve(stripe_payment_intent_id, { stripeAccount: ... })`. If status is `requires_payment_method` or `canceled` (i.e. user definitely didn't pay), cancel the booking.
   - Group by `group_booking_id` and cancel the whole group atomically.
   - **Note:** keep the threshold at 30 minutes for class bookings because they hold scarce capacity. Phone-booking threshold stays at 24h.

3. **Frequency:** auto-cancel cron currently runs every 30 min (`*/30 * * * *`). Bump to every 15 min OR keep 30 and accept the worst-case 30-min hold. Default = keep at 30 min, document the hold.

**Acceptance.**
- Manual: start a class cart checkout. Abandon the Stripe Elements form. After 30 min, the bookings are cancelled, capacity is freed.
- Manual: trigger a real Stripe payment failure. All paid bookings in the cart get `deposit_status = 'Failed'`, not just the primary.

**Effort:** 1 day.

---

### 4.5 Membership rules: implement or hide

**Problem.** The Products UI exposes `allowance_per_period`, `rollover`, `rollover_limit`, `discount_percent`, `members_only_priority_hours`, `booking_window_days`, `allow_recurring`. **None of these are enforced anywhere.** The only coverage check is `rules.unlimited === true`.

There are two ways out: (A) implement the rules end-to-end, or (B) shrink the UI to "unlimited only" for v1 and gate the rest behind a "v2" notice.

**Recommended: Phase 1 implements `allowance_per_period`, `rollover`, `discount_percent` (the three customers ask for). Phase 2 implements `members_only_priority_hours` + `booking_window_days`. `allow_recurring` is a simple boolean gate that lands in Phase 1.**

#### 4.5.1 Allowance tracking (Phase 1 must-have)

1. **`class_membership_allowance_ledger`** — the table already exists in [20260702120000_class_commerce_phase2_ledgers.sql](../supabase/migrations/20260702120000_class_commerce_phase2_ledgers.sql). Add nothing schema-wise. Add code paths.

2. **Coverage helper** — `src/lib/class-commerce/membership-allowance-coverage.ts` (new):
   ```typescript
   /**
    * Returns true if the user has an active membership that:
    *   - covers the class type (eligible_class_type_ids check), AND
    *   - either is unlimited OR has remaining allowance in the current period.
    * `current_period_end` mirrored from Stripe; periodStart = current_period_end - interval.
    */
   export async function membershipCoversClassType(
     admin: SupabaseClient,
     params: { userId, venueId, classTypeId, partySize },
   ): Promise<
     | { ok: true; membershipId: string; mode: 'unlimited' | 'allowance'; allowanceRemaining?: number }
     | { ok: false; reason: 'no_membership' | 'wrong_class_type' | 'allowance_exhausted' }
   >
   ```
   - Period boundaries: `periodStart = current_period_end - recurring_interval`, mirrored. The cleanest way is to add a `current_period_start timestamptz` column to `class_memberships` and stamp it from Stripe webhook (sub.items[0].current_period_start). Existing webhook code already uses `current_period_end`.

3. **Consume helper** — `src/lib/class-commerce/consume-membership-allowance.ts` (new):
   ```typescript
   export async function consumeMembershipAllowanceForBooking(
     admin: SupabaseClient,
     params: { membershipId, userId, venueId, sessions: number, bookingId, idempotencyKey },
   ): Promise<{ ok: true } | { ok: false; reason: 'insufficient' | 'db_error' | 'ledger_failed' }>
   ```
   - Compute remaining = `allowance_per_period - SUM(redeem deltas this period) + SUM(restore deltas this period)`.
   - If `rollover` is true, also add unused allowance from the previous period (capped at `rollover_limit` if set). Track this with a special `period_reset` ledger row at period boundary.
   - Append a `redeem` ledger row with `delta_sessions = -sessions`, `idempotency_key`.

4. **Restore helper** — `src/lib/class-commerce/restore-membership-allowance.ts` (new): mirror of credit restore, writes `restore` ledger rows. Wire into `cancelStaffBookingWithNotify` immediately after `restoreClassCreditsForBooking`.

5. **Period reset cron** — `src/app/api/cron/class-membership-period-reset/route.ts` (new):
   - Daily: for each `class_memberships` row whose `current_period_start` ≤ now AND there is no `period_reset` ledger row with `created_at >= current_period_start`, insert a `period_reset` row that records the carry-over allowance per rollover rules.
   - This is the canonical period anchor — `consumeMembershipAllowance` reads ledger rows since the most recent `period_reset` row.

6. **Update `orchestrateClassCartCheckout`** — `src/lib/class-commerce/orchestrate-class-cart-checkout.ts`:
   - Replace the current `membershipUnlimitedCoversClassType` call with `membershipCoversClassType` returning either `{ unlimited }` or `{ allowance, allowanceRemaining }`.
   - When matched on allowance, call `consumeMembershipAllowanceForBooking` after `insertFreeClassSessionBooking`, with the same rollback semantics as `consumeClassCreditsForBooking`.

7. **Surface in account UI** — `src/components/account/AccountMembershipsSection.tsx`:
   - For each membership, render: _"X / Y classes used this period. Resets {date}."_ when `allowance_per_period` is set.
   - When unlimited: render _"Unlimited classes."_

8. **Migration** — `supabase/migrations/2026XXXX_class_membership_period_start.sql`:
   ```sql
   ALTER TABLE public.class_memberships
     ADD COLUMN IF NOT EXISTS current_period_start timestamptz;
   COMMENT ON COLUMN public.class_memberships.current_period_start IS
     'Mirrored from Stripe subscription. Anchor for allowance period reset.';
   ```

#### 4.5.2 `discount_percent` (Phase 1 must-have)

Members get a percentage discount on paid classes that are not covered by allowance / unlimited / credits.

1. **Quote helper** — `src/lib/class-commerce/membership-discount.ts` (new):
   ```typescript
   export async function getMembershipDiscountForClassType(
     admin: SupabaseClient,
     params: { userId, venueId, classTypeId },
   ): Promise<number /* percent, 0..100 */>
   ```
   - Returns the **best** (highest) discount among the user's active memberships that cover this class type, OR 0.

2. **Wire into `quoteClassCart`** — for paid lines, before computing `onlineChargePenceForLine`, apply the discount: `discountedPrice = price * (1 - pct/100)`. Stash both `original_pence` and `member_discount_pence` on the quote line so the UI can render the member savings.

3. **UI surface**:
   - Public booking page: render the discount as _"£X (Member price)"_ with a strike-through on the original. Add a `<Pill variant="member-discount">` indicator.
   - Cart checkout summary: show member savings line.

#### 4.5.3 `allow_recurring` (Phase 1 must-have)

Only members of plans with `allow_recurring = true` can create recurring reservations.

1. **POST `/api/account/class-recurring`** — before insert, check whether the user has any active membership at this venue with `rules.allow_recurring = true`. Reject with 403 if not (or if `class_recurring_reservations` is being broadly opened to non-members, document the policy explicitly).

2. **Account UI** — `AccountRecurringSection` should hide the "Create new" CTA when the user has no membership granting recurring access. Show an upgrade-to-membership CTA instead.

#### 4.5.4 `members_only_priority_hours` and `booking_window_days` (Phase 2)

Out of Phase 1 scope but the schema fields stay. **Add a clear comment in `ClassCommerceProductsClient.tsx`:** label the two fields with a "(coming soon)" suffix until Phase 2 ships them. Do not remove them.

**Acceptance for 4.5 as a whole.**
- Create a "Unlimited Monthly" plan, subscribe. Book 5 classes. All free. `class_membership_allowance_ledger` empty (unlimited path).
- Create an "8 classes / month" plan. Subscribe. Book 8 → all free, ledger has 8 redeem rows. Book a 9th → falls through to paid.
- Cancel one of the 8 bookings → ledger gets a restore row, next booking is free again.
- 30 days later, period boundary → cron inserts a `period_reset` row, counter resets.
- Add 10% discount to the same plan. Book a class that isn't covered by allowance → price is 10% off original.
- Without a membership granting recurring, attempt POST `/api/account/class-recurring` → 403.

**Effort:** 4 days (this is the biggest Phase 1 item).

---

## 5. Phase 2 — Significant fixes

### 5.1 Tier and secondary-model gating on the products area

**Problem.** `/dashboard/class-timetable/products/page.tsx` checks only `staff.venue_id`. The four CRUD routes check only `getVenueStaff()`. No tier check, no `class_session` enabled-model check. A restaurant-tier venue (which has no public class booking flow) can configure products.

**Fix scope.**

1. **`requireClassCommercePlan(staff, admin)` helper** — `src/lib/class-commerce/auth.ts` (new):
   ```typescript
   export async function requireClassCommercePlan(
     admin: SupabaseClient,
     venueId: string,
   ): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
     // Tier check
     const { data: venue } = await admin.from('venues').select('pricing_tier').eq('id', venueId).maybeSingle();
     if (!isAppointmentPlanTier((venue as { pricing_tier?: string } | null)?.pricing_tier ?? '')) {
       return { ok: false, response: NextResponse.json({ error: 'Class commerce is available on Appointments plans only.' }, { status: 403 }) };
     }
     // Secondary-model check
     const modelGate = await requireVenueExposesSecondaryModel(admin, venueId, 'class_session');
     if (!modelGate.ok) return { ok: false, response: modelGate.response };
     // Feature flag (Phase 2 addition — see §10)
     const flags = await resolveClassCommerceFlags(admin, venueId);
     if (!flags.class_commerce_enabled) {
       return { ok: false, response: NextResponse.json({ error: 'Class commerce is not enabled for this venue.' }, { status: 403 }) };
     }
     return { ok: true };
   }
   ```

2. **Apply at every entry point**:
   - `/dashboard/class-timetable/products/page.tsx` — server component, redirect to `/dashboard/class-timetable` if the gate fails (don't 404).
   - `/api/venue/class-credit-products/route.ts` (GET, POST) and `[id]/route.ts` (PATCH, DELETE).
   - Same for `class-course-products` and `class-membership-products`.
   - `/api/venue/class-commerce-reports/route.ts`.

3. **Sidebar visibility** — `src/app/dashboard/DashboardSidebar.tsx`: the "Classes" nav entry is already model-aware via `mergeModelNavEntries`. No change needed there. A sub-link to "Class products" is in the timetable view's PageHeader actions — that already gates by `staff.venue_id` only. Add the same `class_commerce_enabled` flag check (server-side, pass as prop into `ClassTimetableView`).

**Effort:** 0.5 day.

---

### 5.2 Concurrency lock on credit consumption

**Problem.** Two concurrent bookings for the same guest can double-spend a credit balance. Comment on `consumeClassCreditsForBooking` acknowledges this is "future hardening."

**Fix scope.**

Two viable approaches; pick (A) for v1, document (B) as a future migration if scale demands.

#### Option A — Postgres advisory lock (recommended, no schema change)

In `consumeClassCreditsForBooking`, wrap the read-update-ledger sequence in:
```typescript
await admin.rpc('pg_advisory_xact_lock', { key: hashUserVenue(userId, venueId) });
```
…within a transaction. Implement as a stored function `consume_class_credits_atomically(p_user uuid, p_venue uuid, p_credits int, p_booking_id uuid, p_class_type_id uuid, p_idempotency_prefix text)` that:
1. Acquires `pg_advisory_xact_lock(hashtext(p_user || ':' || p_venue))`.
2. SELECTs balances FOR UPDATE.
3. Filters by eligible class type (port logic from JS).
4. Returns `insufficient` or performs updates + ledger inserts atomically.

Migration: `supabase/migrations/2026XXXX_consume_class_credits_rpc.sql` defining `public.consume_class_credits_atomically(...)`.

Update `consumeClassCreditsForBooking` to call `admin.rpc('consume_class_credits_atomically', { ... })` and translate the return value.

#### Option B — Optimistic locking column

Add `version int NOT NULL DEFAULT 0` to `user_class_credit_balances`. Each update bumps version and matches against the read version; conflict → retry. Acceptable for low-collision workloads.

**Acceptance.**
- Stress test: launch 10 concurrent checkouts for the same guest with `balance = 5, party_size = 1` each. Exactly 5 succeed, 5 return `insufficient_credits`.

**Effort:** 1.5 days.

---

### 5.3 Course cancellation and refund surfaces

**Problem.** `class_course_enrollments.status` includes `cancelled` but no UI / API exposes cancellation.

**Fix scope.**

1. **Per-course refund window** — `class_course_products`:
   ```sql
   ALTER TABLE public.class_course_products
     ADD COLUMN IF NOT EXISTS cancellation_window_days int CHECK (cancellation_window_days IS NULL OR cancellation_window_days >= 0);
   ```
   `NULL` = non-refundable, `0` = up to start, `N > 0` = up to N days before first session.

2. **Guest-side cancel API** — `src/app/api/account/courses/cancel/route.ts` (new):
   - Auth: `createRouteHandlerClient` + check enrollment belongs to user.
   - Compute eligibility: `first_session.instance_date - cancellation_window_days >= today`. If not eligible: 409 with `'Cancellation window has passed'`.
   - Stripe refund (full amount) via `stripe.refunds.create({ payment_intent: enrollment.stripe_payment_intent_id }, { stripeAccount })`.
   - Update `class_course_enrollments.status = 'cancelled'`.
   - Cancel all linked `class_course_session_enrollments` (status → 'cancelled').
   - Cancel related `bookings` rows (those linked via `class_course_session_enrollments.class_instance_id` for this guest).
   - Send `class_course_refunded` communication.

3. **Staff-side admin force-cancel** — `/api/venue/class-course-products/[id]/enrollments/[enrId]/cancel`:
   - Admin-only (`requireAdmin`).
   - Same flow plus a `cancel_reason` field (max 500 chars).
   - Optional `bypass_window: true` flag with confirmation prompt.

4. **UI surfaces**:
   - `AccountCoursesSection.tsx` — add a "Cancel enrollment" button per active enrollment with a confirmation modal. Show remaining window: _"You can cancel free until {date}."_ or _"Past the cancellation window. Contact the venue."_
   - `/dashboard/class-timetable/products` — add an "Enrollments" sub-tab inside the Courses tab listing active enrollments with admin-cancel action. Currently the products page has zero visibility into who's enrolled.

5. **API for staff enrollments list** — `GET /api/venue/class-course-products/[id]/enrollments`:
   - Returns enrolled guests + their session attendance status.

**Acceptance.**
- Guest enrolls, then cancels within window → full Stripe refund, all linked bookings cancelled, enrollment marked `cancelled`.
- Same with cancellation window passed → 409 error.
- Staff force-cancel a guest past window → no refund issued unless `bypass_window` + manual refund instruction.

**Effort:** 2 days.

---

### 5.4 Class session attendance check-in

**Problem.** `class_course_session_enrollments.status` supports `scheduled/attended/cancelled/no_show`, and the regular booking flow tracks `checked_in_at`. But there's no staff UI to mark course-session attendance, no "Mark all attended" action, no roster check-in.

**Fix scope.**

1. **Roster UI extension** — the existing `/api/venue/class-instances/[id]/attendees` returns attendees but no actions. The dashboard ClassTimetableView opens the roster modal. Extend that modal with per-row "Check in" / "No show" buttons.

2. **API endpoint** — `POST /api/venue/class-instances/[id]/attendees/[bookingId]/check-in`:
   - Auth: `getVenueStaff` + `staffMayManageClassTypeSessions` for the instance's class type.
   - Update `bookings.checked_in_at = now()`.
   - If the booking is linked to a course session enrollment, also update `class_course_session_enrollments.status = 'attended'`.
   - Idempotent (no-op if already checked in).

3. **API endpoint** — `POST /api/venue/class-instances/[id]/attendees/[bookingId]/no-show`:
   - Mark booking status = `No Show` (an existing booking_status enum value).
   - Update session enrollment to `no_show`.

4. **Bulk action** — `POST /api/venue/class-instances/[id]/attendees/check-in-all` — convenience for instructors at start of class.

5. **Audit trail** — write `bookings.events` of type `class_checked_in` and `class_no_show`.

**Acceptance.**
- Open a class instance roster, click "Check in" — `checked_in_at` is set, course session enrollment moves to `attended`.
- "No show" → status changes, instructor sees the count immediately.
- Re-clicking does not duplicate.

**Effort:** 1.5 days.

---

### 5.5 Outbound communications for class commerce

**Problem.** Credit purchases, course enrollments, and membership starts succeed silently — no receipt email, no welcome message.

**Fix scope.**

1. **New keys in `CommunicationMessageKey`** — `src/lib/communications/policies.ts`:
   - `class_credits_purchased` — receipt after credit pack purchase
   - `class_credits_expiring` — 7-day expiry reminder (used by 4.3 cron)
   - `class_course_enrolled` — receipt + session schedule after course enrollment
   - `class_course_refunded` — refund confirmation
   - `class_membership_started` — welcome to membership
   - `class_membership_renewed` — sent when Stripe subscription renews
   - `class_membership_cancelling` — sent when cancel_at_period_end set
   - `class_membership_ended` — final period ended

2. **Default policies in `buildDefaultLanePolicies()`**:
   - All seven keys live in the **`appointments_other`** lane (not `table`).
   - Default: email on, SMS off (matches existing booking_confirmation defaults).

3. **Bodies** — colocated with renderer. Examples:
   ```
   Email — class_credits_purchased
   Subject: Your {{credits_count}} class credits at {{venue_name}}
   Body:
     Thanks for buying the {{pack_name}} at {{venue_name}}.
     {{credits_count}} class credits are now on your account.
     {{#if expires_at}}They expire on {{expires_at_long}}.{{/if}}
     Manage your credits: {{credits_url}}
   ```
   ```
   Email — class_credits_expiring
   Subject: Your class credits expire in {{days_until_expiry}} days
   Body:
     You have {{credits_remaining}} class credits at {{venue_name}} expiring on {{expires_at_long}}.
     Book a class now: {{venue_booking_url}}
   ```
   _(Full bodies for all keys live in the implementation file.)_

4. **Dispatch wiring** — call `sendPolicyMessage` (or `sendCommunication`) from:
   - `fulfillClassCreditPurchaseFromPaymentIntent` (after ledger row commits)
   - `fulfillCourseEnrollmentFromPaymentIntent` (after enrollment activated)
   - `syncClassMembershipFromStripeSubscription` (on transition from `incomplete → active` and on `cancel_at_period_end` toggling)
   - Course cancel API (5.3)
   - Credit expiry cron (4.3)

5. **Templates UI** — these keys appear automatically in **Settings → Communications** (existing `CommunicationTemplatesSection`). No new UI work in compliance with the cross-cutting comms philosophy.

**Acceptance.**
- Buy 10 credits → email receipt arrives.
- Subscribe to a membership → welcome email arrives.
- Set credits to expire in 6 days → next cron run sends reminder.
- Subscription renews → renewal email arrives.

**Effort:** 1.5 days.

---

### 5.6 Archive the Stripe Product when a membership is archived

**Problem.** `PATCH /api/venue/class-membership-products/[id]` with `{ active: false }` does NOT archive the live Stripe Product or Price on the connected account. Archived plans stay purchasable via any direct Stripe Checkout link.

**Fix scope.**

In `PATCH` handler, after the row update succeeds, detect `active: true → false` transition and call:
```typescript
if (existingRow.active && parsed.data.active === false) {
  if (existingRow.stripe_price_id && stripeAccount) {
    await archiveStripePriceOnConnectedAccount(stripeAccount, existingRow.stripe_price_id);
  }
  if (existingRow.stripe_product_id && stripeAccount) {
    await archiveStripeProductOnConnectedAccount(stripeAccount, existingRow.stripe_product_id);
  }
}
```
`archiveStripeProductOnConnectedAccount` is a small new helper next to `archiveStripePriceOnConnectedAccount`.

**Equally important — `DELETE` happy path** also archives Stripe artefacts before DB delete (currently it just deletes the DB row, leaving Stripe orphans).

**Acceptance.**
- Archive a membership → Stripe Product and Price show `active: false` on the connected account.
- Delete a membership (no subscribers) → Stripe artefacts archived.

**Effort:** 0.5 day.

---

## 6. Phase 3 — Polish

### 6.1 ConfirmDialog instead of window.confirm

Replace the `window.confirm('Delete X?...')` calls in `ClassCommerceProductsClient.tsx` line 324 with `<ConfirmDialog>` from `src/components/ui/`. Pattern:
```tsx
const [confirmDelete, setConfirmDelete] = useState<{ path: string; label: string } | null>(null);
// ...
<ConfirmDialog
  open={confirmDelete != null}
  title="Delete product"
  message={`Delete ${confirmDelete?.label}? Archive it instead if guests have used it before.`}
  confirmLabel="Delete"
  destructive
  onConfirm={() => save(confirmDelete!.path, 'DELETE')}
  onCancel={() => setConfirmDelete(null)}
/>
```

**Effort:** 0.5 day.

---

### 6.2 Controlled inputs + quick templates work in edit mode

The current quick template buttons (`document.getElementById(...).elements.namedItem(...)`) only work on the create form and bypass React state. Convert the credit pack create form to controlled state with `useState<CreditFormState>` and have the quick template buttons set state directly.

**Effort:** 0.5 day.

---

### 6.3 Skeleton loading state per product card

Replace the `Refreshing...` button text with `<SkeletonProductCard>` rows in the product list while `busy === true && products === null`. Mirrors how `ContactDetailPanel` does it.

**Effort:** 0.5 day.

---

### 6.4 Scope `/api/account/credits` and `/api/account/class-recurring` catalogs

Both endpoints return the entire active catalog from every venue. Replace `catalogProducts` queries with a scope:
```typescript
const visibleVenueIds = await getVenuesUserHasInteractedWith(admin, user.id);
// filter catalog queries by .in('venue_id', visibleVenueIds) UNION explicit-search venue
```
`getVenuesUserHasInteractedWith` returns the union of venues where the user has: a booking, a credit balance, an active membership, a recurring rule.

For "browse new venues" UX, expose a separate `GET /api/account/discover-class-venues?q=...` endpoint with an explicit search query. Don't unconditionally enumerate.

**Effort:** 1 day.

---

### 6.5 Course session picker — filter and group

The course product create/edit form's session multi-select dumps up to 200 instances flat. Make it usable:
- Add a "Class type" filter dropdown at the top — when set, only that class type's instances show.
- Group by class type with subheadings.
- Add a date-range filter (default: next 90 days).
- Show booking count per instance.

**Effort:** 1 day.

---

### 6.6 Recurring rule `last_error` surfacing

`AccountRecurringSection.tsx` should render `reservation.last_error` prominently when set, with action buttons:
- **Pause** — sets `status='paused'`, clears `last_error`.
- **Edit** — opens the rule editor pre-filled.
- **Delete** — confirm + DELETE.

Common error templates → render-friendly:
- `'Class type not found'` → _"This class type has been removed by the venue. Delete this rule."_
- `'No upcoming sessions'` → _"The venue has no scheduled sessions for this class. We'll check again next week."_
- `'Auto-booking is only supported for classes with no online card charge'` → _"This class requires payment, so it can't be booked automatically. Book it manually each week."_

**Effort:** 0.5 day.

---

## 7. New data model additions (summary)

All changes live in idempotent migrations in `supabase/migrations/`.

| Migration | What |
|---|---|
| `2026XXXX_class_recurring_lineage.sql` | `bookings.class_recurring_reservation_id` FK + index (4.2) |
| `2026XXXX_class_credit_expiry_reminder.sql` | `user_class_credit_balances.reminder_sent_at timestamptz` (4.3) |
| `2026XXXX_class_membership_period_start.sql` | `class_memberships.current_period_start timestamptz` (4.5) |
| `2026XXXX_class_course_cancellation_window.sql` | `class_course_products.cancellation_window_days int` (5.3) |
| `2026XXXX_consume_class_credits_rpc.sql` | `public.consume_class_credits_atomically(...)` Postgres function (5.2) |
| `2026XXXX_class_commerce_feature_flag.sql` | _no schema change_ — flag lives in `venues.feature_flags`. See §10. |

Regenerate the schema inventory in [Docs/schema.sql](schema.sql) after each migration per the convention noted at the top of that file.

**No new tables are needed.** All Phase 1 + 2 fixes use existing tables, including `class_membership_allowance_ledger` which was previously unused.

---

## 8. New API endpoints (summary)

| Method | Path | Purpose | Phase |
|---|---|---|---|
| `POST` | `/api/account/courses/cancel` | Guest cancels course enrollment within window | 5.3 |
| `POST` | `/api/venue/class-course-products/[id]/enrollments/[enrId]/cancel` | Staff force-cancels enrollment | 5.3 |
| `GET` | `/api/venue/class-course-products/[id]/enrollments` | List enrolled guests + attendance | 5.3 |
| `POST` | `/api/venue/class-instances/[id]/attendees/[bookingId]/check-in` | Mark guest attended | 5.4 |
| `POST` | `/api/venue/class-instances/[id]/attendees/[bookingId]/no-show` | Mark guest no-show | 5.4 |
| `POST` | `/api/venue/class-instances/[id]/attendees/check-in-all` | Bulk check-in | 5.4 |
| `GET` | `/api/account/discover-class-venues?q=...` | Explicit search for cross-venue catalog | 6.4 |

**Existing routes that must be modified** (auth/gate/logic):
- `POST /api/account/class-recurring` (4.2 rule schema + 4.5.3 membership gate)
- `POST /api/booking/class-cart/checkout` (4.5 allowance / discount integration)
- All `/api/venue/class-{credit,course,membership}-products/*` (5.1 tier+model gate)
- `PATCH /api/venue/class-membership-products/[id]` (5.6 Stripe archive on transition)
- `DELETE /api/venue/class-membership-products/[id]` (5.6 Stripe archive before delete)
- `/api/webhooks/stripe/route.ts` (4.4 PI failure lookup by PI not metadata)
- `/api/cron/auto-cancel-bookings` (4.4 abandoned class cart)
- `/api/cron/class-recurring-materialize` (4.2 rule-honoring)

---

## 9. New cron jobs (summary)

| Path | Schedule | Purpose |
|---|---|---|
| `/api/cron/class-credit-expiry` | `30 2 * * *` | Expire balances + send 7-day reminders (4.3) |
| `/api/cron/class-membership-period-reset` | `0 3 * * *` | Period boundary `period_reset` ledger row + rollover carry-over (4.5) |

Register in `vercel.json`. Both use `requireCronAuthorisation()`. Both write `runs` rows on success/failure.

---

## 10. Venue feature flag for staged rollout

Per Q9, add a venue-level flag `class_commerce_enabled`.

1. **Add to flag types** — `src/lib/feature-flags/types.ts`:
   ```typescript
   export const APPOINTMENTS_FEATURE_FLAG_KEYS = [
     'waitlist_v2',
     'guest_self_reschedule',
     'any_available_practitioner',
     'class_commerce_enabled',  // NEW
   ] as const;
   ```

2. **Env override** — `FEATURE_FLAG_CLASS_COMMERCE_ENABLED` per the convention in `resolve.ts`.

3. **Default off** for v1. Default-on candidates after pilot: any venue with `booking_model = 'class_session'` as primary; or any Appointments venue with `class_session` in `enabled_models` AND has at least one `class_types` row.

4. **Document in [Docs/FEATURE_FLAGS.md](FEATURE_FLAGS.md)**.

The flag gates: `requireClassCommercePlan` (5.1), and visibility of the "Class products" CTA on `/dashboard/class-timetable`.

The flag does **not** disable existing class instances or guest bookings — those continue to work. It strictly gates the **prepaid commerce** surfaces (credit packs / courses / memberships / recurring reservations).

---

## 11. Communications matrix (full)

Plug into the existing `CommunicationMessageKey` policy framework. All keys live in lane `appointments_other`. Email on by default; SMS off (mirrors `booking_confirmation` default).

| Key | Trigger | Required vars |
|---|---|---|
| `class_credits_purchased` | `fulfillClassCreditPurchaseFromPaymentIntent` success | `guest_first_name`, `venue_name`, `pack_name`, `credits_count`, `expires_at_long?`, `credits_url` |
| `class_credits_expiring` | Cron 7 days before `expires_at` | `guest_first_name`, `venue_name`, `credits_remaining`, `expires_at_long`, `days_until_expiry`, `venue_booking_url` |
| `class_course_enrolled` | `fulfillCourseEnrollmentFromPaymentIntent` success | `guest_first_name`, `venue_name`, `course_name`, `session_count`, `sessions_summary`, `course_url` |
| `class_course_refunded` | Course cancel API success | `guest_first_name`, `venue_name`, `course_name`, `refund_amount` |
| `class_membership_started` | `syncClassMembershipFromStripeSubscription`: incomplete → active | `guest_first_name`, `venue_name`, `plan_name`, `period_end_long`, `plan_summary` |
| `class_membership_renewed` | `customer.subscription.updated` with new `current_period_end` | `guest_first_name`, `venue_name`, `plan_name`, `period_end_long` |
| `class_membership_cancelling` | `cancel_at_period_end` transitions to `true` | `guest_first_name`, `venue_name`, `plan_name`, `period_end_long` |
| `class_membership_ended` | `customer.subscription.deleted` for an active plan | `guest_first_name`, `venue_name`, `plan_name` |
| `class_booking_credit_restored` | After cancel restores credits | `guest_first_name`, `venue_name`, `credits_restored`, `credits_url` |

**No per-venue body customisation in v1.** Same policy framework, same lane logic.

---

## 12. RLS and security review

The current posture (all class-commerce tables have RLS enabled with **no policies**) is correct: deny by default, service_role bypasses. Keep this. The new migrations follow the same pattern:

```sql
ALTER TABLE public.<new_table> ENABLE ROW LEVEL SECURITY;
-- No policies. Access via service_role only.
```

**Additionally:**

- All new staff routes use `getVenueStaff()` + `requireClassCommercePlan()`.
- All new account routes use `createRouteHandlerClient()` for auth + `getSupabaseAdminClient()` for writes.
- Stripe webhook signature verification stays mandatory; idempotency via `claimStripeWebhookEvent` (already in place).
- Public routes (none new in this plan beyond `/api/account/discover-class-venues`) read public catalog only.

**Audit logging.** Today's class commerce has minimal audit beyond ledger tables. Phase 2 should add a `class_commerce_events` append-only table (sibling of `events`) capturing:
- product.created / product.updated / product.archived / product.restored
- enrollment.cancelled / enrollment.refunded
- subscription.cancelled / subscription.reactivated
- credit.adjusted (manual admin grant or revoke)

But this is **not a Phase 1/2 ship-blocker** — the existing ledgers already cover the money-mutating events. Adding `class_commerce_events` is a Phase 3+ hardening item, captured here as future work.

---

## 13. Testing strategy

### 13.1 Unit tests (Vitest)

| File | Cases |
|---|---|
| `src/lib/class-commerce/__tests__/restore-credits-on-cancel.test.ts` | Restore happy path, idempotent re-run, no redeem rows = no-op |
| `src/lib/class-commerce/__tests__/membership-allowance-coverage.test.ts` | Unlimited covers, allowance covers, allowance exhausted, eligibility mismatch, period boundary |
| `src/lib/class-commerce/__tests__/recurring-rule-materialize.test.ts` | Single weekday, end_date stops, max_occurrences stops, paid class skipped, missing instance skipped |
| `src/lib/class-commerce/__tests__/credit-expiry.test.ts` | Expired balance excluded from consume, cron expires + reminders, idempotency |
| `src/lib/class-commerce/__tests__/consume-credits-idempotency.test.ts` | Already exists — extend with concurrent-write simulation post-RPC migration |
| `src/lib/class-commerce/__tests__/membership-discount.test.ts` | Best discount selection, no membership = 0%, multiple memberships pick highest |

### 13.2 Integration tests

Hit the actual API endpoints with a real Supabase test DB.
- Full cart checkout: free + paid + credit + course + membership mix
- Webhook PI succeeded → all booking rows confirmed
- Webhook PI failed → all paid booking rows marked Failed
- Subscription created → membership row inserted, welcome email queued
- Subscription cancelled (period end) → cancelling email sent, status moves to `canceled` on actual end
- Stripe Connect product/price archive on membership archive

### 13.3 E2E (Playwright)

| Flow | Asserts |
|---|---|
| Venue creates a credit pack, archives it, deletes it | Stripe Product archived; archived doesn't appear publicly; delete blocked with active balances |
| Venue creates a membership with allowance 8, guest subscribes, books 8 classes, attempts 9th | First 8 free, 9th falls through to paid; allowance ledger has 8 redeem rows |
| Guest enrolls in a course, cancels within window | Stripe refund issued, all session bookings cancelled, refund email arrives |
| Guest creates a recurring rule for a weekly class | Cron run produces exactly one booking per matching weekday in the window |
| Concurrent checkouts for same guest, balance = 1 | Exactly one succeeds, the other gets `insufficient_credits` |
| Guest cancels a credit-paid booking | Credit restored, balance += 1, ledger has refund row, restored email arrives |

### 13.4 Manual QA checklist

Documented at the end of this plan (§15).

---

## 14. Rollout plan

### 14.1 Sequencing

1. **Phase 1** behind `class_commerce_enabled` flag, default off.
2. **Internal QA**: enable flag for the Resneo test/sandbox venue. Run all manual flows.
3. **Pilot 1 venue**: one yoga / Pilates studio. Two weeks of observation.
   - Watch: ledger consistency (credits added = credits redeemed + refunded + remaining), subscription sync correctness, recurring rule materialisation logs.
4. **Pilot 2-3 venues**: a dog-grooming class operator + a barre studio. Two weeks.
5. **Phase 2** ships behind same flag (UI gates as features land).
6. **Default-on** for new signups with `booking_model = 'class_session'` after Phase 2 stabilises.
7. **Phase 3** ships rolling without flag changes (polish only).

### 14.2 Migration application order

```
1. _class_recurring_lineage
2. _class_credit_expiry_reminder
3. _class_membership_period_start
4. _consume_class_credits_rpc
5. _class_course_cancellation_window
```

Each migration is idempotent on Supabase preview branches. Roll forward only; no rollback migrations.

### 14.3 Communication policy migration

For existing venues, the new `CommunicationMessageKey` defaults are appended to `buildDefaultLanePolicies()`. **Existing `venues.communication_policies` JSONB rows must be patched** to include the new keys with default-on email so they don't silently send nothing. Add a backfill in the Phase 1 deployment:

```sql
UPDATE public.venues
SET communication_policies = communication_policies || '{
  "class_credits_purchased": {"enabled": true, "channels": ["email"]},
  ...
}'::jsonb
WHERE pricing_tier IN ('appointments', 'plus', 'light')
  AND NOT (communication_policies ? 'class_credits_purchased');
```

### 14.4 Stripe webhook configuration

No changes to webhook URL or signing secret. The existing `/api/webhooks/stripe` endpoint handles all class commerce. Verify in the Stripe Dashboard that the connected-account webhook subscribes to:
- `payment_intent.succeeded`, `payment_intent.payment_failed`
- `charge.refunded`, `charge.refund.updated`
- `customer.subscription.created`, `.updated`, `.deleted`

(The platform-level subscription webhook stays separate at `/api/webhooks/stripe-subscription`.)

---

## 15. Build sequence

| Step | Phase | Scope | Days |
|---|---|---|---|
| 1 | 1 | Migrations 1–3 + venue feature flag entry in types | 0.5 |
| 2 | 1 | 4.3 Expired credit filter + nightly expiry cron + reminder column + comms key | 1 |
| 3 | 1 | 4.2 Recurring rule schema + lineage column + materialisation rewrite + last_error UI | 2 |
| 4 | 1 | 4.5.1 Membership allowance ledger writes + helpers + period reset cron | 2 |
| 5 | 1 | 4.5.2 Discount + 4.5.3 allow_recurring gate | 1 |
| 6 | 1 | 4.1 Restore credits + membership allowance on cancellation | 1 |
| 7 | 1 | 4.4 Webhook PI failure lookup-by-PI + abandoned cart cron | 1 |
| 8 | 1 | Phase 1 e2e + Playwright; comms backfill SQL | 1.5 |
| | | **Phase 1 subtotal** | **~10 days** |
| 9 | 2 | 5.1 Tier + model + flag gating at every entry point | 0.5 |
| 10 | 2 | 5.2 Concurrency lock RPC for credit consume | 1.5 |
| 11 | 2 | 5.3 Course cancellation + refund (guest + staff) + enrollments admin view | 2 |
| 12 | 2 | 5.4 Class session attendance check-in (staff + bulk) | 1.5 |
| 13 | 2 | 5.5 Communications keys: bodies + dispatch + policy defaults | 1.5 |
| 14 | 2 | 5.6 Stripe Product+Price archive on membership archive/delete | 0.5 |
| 15 | 2 | Phase 2 e2e + Playwright | 1.5 |
| | | **Phase 2 subtotal** | **~9 days** |
| 16 | 3 | 6.1 ConfirmDialog replacement | 0.5 |
| 17 | 3 | 6.2 Controlled inputs for quick templates | 0.5 |
| 18 | 3 | 6.3 Skeleton loading states | 0.5 |
| 19 | 3 | 6.4 Account catalog scoping + discover endpoint | 1 |
| 20 | 3 | 6.5 Course session picker with filter+group | 1 |
| 21 | 3 | 6.6 Recurring rule last_error surfacing | 0.5 |
| 22 | 3 | Manual QA polish, docs update, help-centre articles | 1 |
| | | **Phase 3 subtotal** | **~5 days** |
| | | **Grand total** | **~24 working days (≈ 5–6 weeks calendar)** |

A single developer can sustain ~4–5 productive days per week with reviews + meetings; double-counting calendar weeks accounts for that.

---

## 16. Acceptance / readiness checklist

Before declaring Class products **production ready**, every box below must be ticked.

### Correctness (Phase 1)
- [ ] Cancelling a credit-paid class booking restores the credit (idempotent).
- [ ] Cancelling a membership-allowance booking restores the allowance.
- [ ] Recurring reservations honor weekday + start_time + end_date + max_occurrences.
- [ ] Recurring reservations report `last_error` in the guest UI with remediation copy.
- [ ] Expired credits are not spendable and are expired by a nightly cron with a 7-day-before email reminder.
- [ ] Abandoned class cart bookings (Pending + Stripe PI failed/abandoned) are auto-cancelled within 30 min, releasing capacity.
- [ ] Stripe webhook `payment_intent.payment_failed` updates every paid booking in the cart, not just the primary.
- [ ] Membership with `unlimited: false` and `allowance_per_period: N` enforces the allowance with FIFO consumption and per-period reset.
- [ ] Membership with `discount_percent: D` applies the discount on the public booking page and in the cart quote.
- [ ] Recurring reservations are gated on a membership granting `allow_recurring`.

### Surfaces (Phase 2)
- [ ] Products page + APIs gated on `isAppointmentPlanTier`, `requireVenueExposesSecondaryModel('class_session')`, and `class_commerce_enabled` flag.
- [ ] Credit consume cannot double-spend under concurrent writes (verified by stress test).
- [ ] Guests can cancel course enrollments within the configured `cancellation_window_days`; staff can force-cancel.
- [ ] Staff can view course enrollments and per-session attendance in the products UI.
- [ ] Staff can check-in or mark no-show attendees from the class instance roster (per booking + bulk).
- [ ] Receipt emails fire for: credit purchase, course enrollment, course refund, membership start / renew / cancelling / end.
- [ ] Archived memberships are archived on the connected Stripe account (Product + Price).

### Polish (Phase 3)
- [ ] No `window.confirm` in the products UI.
- [ ] Credit pack quick-template buttons work in edit mode.
- [ ] Skeleton loading states for product cards.
- [ ] Account credits / recurring catalogs scoped to user-interacted venues + explicit search endpoint.
- [ ] Course session picker filters by class type and date range, groups sensibly.
- [ ] Help-centre articles updated for venues: "Selling class packs," "Building a class course," "Selling memberships."

### Operational
- [ ] All new migrations applied to staging and production; schema inventory regenerated.
- [ ] All new crons registered in `vercel.json`; `requireCronAuthorisation` configured; `runs` rows being written on success/failure.
- [ ] All new communication keys have email bodies, SMS bodies where applicable, default policies in `buildDefaultLanePolicies`, and backfilled into existing `venues.communication_policies`.
- [ ] Feature flag `class_commerce_enabled` documented in `Docs/FEATURE_FLAGS.md`.
- [ ] Pilot venue completed a full month with no escalations.

### Tests
- [ ] Unit tests in §13.1 all passing.
- [ ] Integration tests in §13.2 all passing.
- [ ] Playwright e2e flows in §13.3 all green.
- [ ] Manual QA matrix in §15 above run by someone other than the developer.

---

## 17. Open questions deferred to v2

Items intentionally **out of scope** for this plan, captured here so they don't get lost.

- **`members_only_priority_hours`** — members get an N-hour head start on booking new instances. Requires the public availability engine to consider membership status. v2.
- **`booking_window_days`** — non-members can only book M days ahead; members can book further. Same surface as the priority hours feature. v2.
- **Multi-weekday recurring rules** (Tue + Thu) — Phase 1 ships single weekday only. v2 generalises the rule schema.
- **`class_commerce_events` append-only audit table** for product lifecycle (created / updated / archived / restored), enrollment cancellation reasons, admin credit adjustments. Phase 3+ hardening.
- **Per-venue customisation of class commerce email bodies** — same cross-cutting concern raised in the compliance spec. Tackle as a platform-wide communications-editor feature, not a class-commerce feature.
- **Class session waitlists with auto-promotion from cancel** — separate feature, lives in the existing `waitlist_v2` flag's surface area, not in the class commerce path.
- **Multi-currency** — current code defaults to GBP everywhere. Stripe Connect supports multi-currency. A future migration adds proper currency awareness in pricing, refunds, and reporting.
- **Refund partial credits** for partial course attendance — today a course refund is all-or-nothing. v2 could pro-rate by attended sessions.
- **Manual admin credit grants and revokes** — the ledger reason `admin_adjust` exists but no UI exposes it. A small admin tool (in `/dashboard/contacts/[id]` perhaps) would let staff grant comp credits or revoke them.

---

## 18. Appendix: file-by-file change manifest

Listed in the order they should be touched during Phase 1.

### Migrations (new)
- `supabase/migrations/2026XXXX_class_recurring_lineage.sql`
- `supabase/migrations/2026XXXX_class_credit_expiry_reminder.sql`
- `supabase/migrations/2026XXXX_class_membership_period_start.sql`
- `supabase/migrations/2026XXXX_class_course_cancellation_window.sql`
- `supabase/migrations/2026XXXX_consume_class_credits_rpc.sql`

### Libraries (new)
- `src/lib/class-commerce/auth.ts` — `requireClassCommercePlan`
- `src/lib/class-commerce/booking-was-credit-paid.ts`
- `src/lib/class-commerce/recurring-rule-schema.ts` — zod schema + types
- `src/lib/class-commerce/membership-allowance-coverage.ts`
- `src/lib/class-commerce/consume-membership-allowance.ts`
- `src/lib/class-commerce/restore-membership-allowance.ts`
- `src/lib/class-commerce/membership-discount.ts`
- `src/lib/stripe/connected-membership-product.ts` — extend with `archiveStripeProductOnConnectedAccount`

### Libraries (edit)
- `src/lib/class-commerce/consume-class-credits.ts` — expiry filter + RPC call
- `src/lib/class-commerce/available-class-credits.ts` — expiry filter
- `src/lib/class-commerce/restore-class-credits.ts` — no logic change, but doc its callers
- `src/lib/class-commerce/orchestrate-class-cart-checkout.ts` — allowance + discount integration
- `src/lib/class-commerce/quote-class-cart.ts` — discount pricing fields on quote line
- `src/lib/class-commerce/materialize-recurring-reservation.ts` — full rewrite (4.2)
- `src/lib/booking/staff-cancel-booking.ts` — restore credit + allowance on cancel
- `src/lib/feature-flags/types.ts` — add `class_commerce_enabled` key
- `src/lib/feature-flags/resolve.ts` — env override mapping for new key
- `src/lib/communications/policies.ts` — add 9 new `CommunicationMessageKey` values + defaults

### API routes (new)
- `src/app/api/cron/class-credit-expiry/route.ts`
- `src/app/api/cron/class-membership-period-reset/route.ts`
- `src/app/api/account/courses/cancel/route.ts`
- `src/app/api/venue/class-course-products/[id]/enrollments/route.ts`
- `src/app/api/venue/class-course-products/[id]/enrollments/[enrId]/cancel/route.ts`
- `src/app/api/venue/class-instances/[id]/attendees/[bookingId]/check-in/route.ts`
- `src/app/api/venue/class-instances/[id]/attendees/[bookingId]/no-show/route.ts`
- `src/app/api/venue/class-instances/[id]/attendees/check-in-all/route.ts`
- `src/app/api/account/discover-class-venues/route.ts`

### API routes (edit)
- `src/app/api/account/class-recurring/route.ts` — rule schema + membership gate
- `src/app/api/booking/class-cart/checkout/route.ts` — implicit via orchestrator changes
- `src/app/api/venue/class-credit-products/route.ts` — `requireClassCommercePlan`
- `src/app/api/venue/class-credit-products/[id]/route.ts` — same
- `src/app/api/venue/class-course-products/route.ts` — same
- `src/app/api/venue/class-course-products/[id]/route.ts` — same
- `src/app/api/venue/class-membership-products/route.ts` — same
- `src/app/api/venue/class-membership-products/[id]/route.ts` — same + Stripe archive on transition
- `src/app/api/venue/class-commerce-reports/route.ts` — `requireClassCommercePlan`
- `src/app/api/account/credits/route.ts` — catalog scoping (6.4)
- `src/app/api/webhooks/stripe/route.ts` — PI failure lookup-by-PI (4.4); membership renewal/cancellation comms dispatch (5.5)
- `src/app/api/cron/auto-cancel-bookings/route.ts` — extend with abandoned class cart branch (4.4)

### Dashboard UI (edit)
- `src/app/dashboard/class-timetable/page.tsx` — pass `classCommerceEnabled` prop
- `src/app/dashboard/class-timetable/ClassTimetableView.tsx` — gate "Class products" CTA on flag; add per-instance check-in actions to roster modal
- `src/app/dashboard/class-timetable/products/page.tsx` — `requireClassCommercePlan` redirect
- `src/app/dashboard/class-timetable/products/ClassCommerceProductsClient.tsx` — ConfirmDialog, controlled inputs, skeletons; courses session picker; "(coming soon)" labels for Phase 2 fields; new "Enrollments" sub-tab under Courses
- `vercel.json` — register new crons

### Account UI (edit)
- `src/components/account/AccountCreditsSection.tsx` — show member discount, expiry warnings
- `src/components/account/AccountMembershipsSection.tsx` — show allowance, renewal date, cancel CTA
- `src/components/account/AccountCoursesSection.tsx` — cancel CTA + window
- `src/components/account/AccountRecurringSection.tsx` — `last_error` surface + pause/edit/delete actions

### Documentation
- `Docs/FEATURE_FLAGS.md` — document `class_commerce_enabled`
- `Docs/schema.sql` — regenerate after migrations
- `src/lib/help/articles/` — three new help-centre articles
- `Docs/MOBILE_API.md` — note new staff routes if mobile app picks them up

---

*End of plan.*
