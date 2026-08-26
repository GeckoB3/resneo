# Class commerce — product rules (implementation reference)

This document locks default rules for credits, course bundles, memberships, multi-session checkout, recurring reservations, cancellations, refunds, and entitlement precedence. Adjust in product review; code should encode these as defaults.

**Last verified against the code: 2026-08-26.** This file is cited from source (`src/lib/class-commerce/entitlement.ts:3`, `entitlement-engine.ts:18`), so an error here propagates. Three were corrected in that pass: the §1 ordering, the §5 allowance key name, and the §7 failure status. They are marked inline. This closes finding **CL-24** in `Resneo_Codebase_Audit_August_2026.md`.

*(There is no §15. Code comments citing "§1/§15" mean §1.)*

## 1. Entitlement precedence (first applied → last)

When multiple discounts or entitlements could apply to the same class session, the settlement order is:

1. **Free line** (no online charge) → `free`.
2. **Course bundle / series** — if the session is part of an active paid enrollment, price is governed by the course product (often zero marginal per session) → `course`.
3. **Membership coverage** — an active `unlimited` or allowance plan → `membership`.
4. **Class credits** — only when the guest explicitly opted to pay with credits (`payWithClassCredits`) **and** the balance covers the party size. FIFO by **earliest `expires_at` first** (NULL expiry = last resort). Partial packs are not split across concurrent checkouts without an explicit "split" UX → `credits`.
5. **Card (Stripe)** → `stripe`.

Course and membership coverage are settled **before** consuming a credit, so a member or enrollee never burns a credit for a session already covered.

> **Corrected 2026-08-26.** This section previously listed membership above course, ranked credits above both, and then contradicted itself in a closing line preferring course over credits. The runtime order above is taken from the single source of truth, `resolveClassLineEntitlement` in `src/lib/class-commerce/entitlement-engine.ts:14-30`, which cites this section back. Keep the two in step: the engine's docstring and this list must not drift apart.
>
> Note also that `CLASS_ENTITLEMENT_ORDER` in `src/lib/class-commerce/entitlement.ts:5-11` encodes the **old, wrong** order and is dead code: its only consumer anywhere in `src/` is its own test (`src/lib/class-commerce/__tests__/eligible-credits.test.ts`). Do not treat it as authoritative, and prefer deleting it over re-ordering it.

## 2. Authentication (Section 7.3)

- **Single drop-in class** booking: allowed without login unless `venues.require_account_login_for_bookings` is true.
- **Credit pack purchase, course enrollment, membership start/change/cancel, multi-session cart checkout, recurring reservation setup, payment method add/remove, profile updates, viewing bookings beyond tokenised manage link**: require an authenticated session.
- After login, the user must return to the **same path + safe query** they started from (`redirectTo` / `next` sanitised per `safe-auth-redirect`).

## 3. Credits

- **Purchase**: creates a **balance batch** row (`user_class_credit_balances`) with `credits_remaining = pack_size`, optional `expires_at = now() + validity_days` from product.
- **Redemption**: one ledger row `reason = redeem`, negative delta, `booking_id` set. Decrement `credits_remaining` on the batch(es) consumed (FIFO by `expires_at` NULLS LAST, then `created_at`).
- **Cancellation**: if a booking paid **only** with credits (no card PI), on allowed cancel **restore** credits with ledger `reason = refund` unless the venue policy marks the session as forfeited (no-show after start = no restore).
- **Expiry**: nightly or weekly job may insert `reason = expire` and zero remaining on expired batches (future cron).

## 4. Course bundles

- **Enrollment** is a paid product tied to a set of `class_instance_id` values and/or rules; capacity is the minimum of product `max_enrollments` (if set) and per-session remaining capacity at checkout time.
- **Roster**: staff see enrollments linked to `class_course_enrollments` and derived booking rows where applicable.

## 5. Memberships

- Stored as **Stripe Subscriptions** on the **venue connected account** with a Stripe Price per `class_membership_products` row.
- App mirrors status in `class_memberships` from webhooks (`customer.subscription.*`).
- **Allowance** stored as JSON on the product (`rules`); engine interprets `unlimited` | `allowance_per_period` | `discount_percent` for quote/checkout. The full key set is in `classMembershipRulesSchema` (`src/lib/class-commerce/product-schemas.ts:4`), which also carries `rollover`, `rollover_limit`, `eligible_class_type_ids`, `allow_recurring`, `members_only_priority_hours` and `booking_window_days`. *(Corrected 2026-08-26: there is no `monthly_credits` key.)*

## 6. Multi-session checkout

- Single **atomic** checkout: validate capacity for **all** lines, then create all `bookings` rows sharing one `group_booking_id` (uuid).
- If any insert fails, roll back **all** rows created in that request (same `group_booking_id` delete) and do not consume credits.
- Requires authenticated user; guest row must match authenticated email (same pattern as multi-service).

## 7. Recurring reservations

- **Rule** stored in `class_recurring_reservations` with JSON recurrence + `class_type_id` anchor.
- **Materialization** creates concrete `bookings` (or holds) on a schedule via cron. **Failures set `last_error` only.** The cron never writes `status` (`src/app/api/cron/class-recurring-materialize/route.ts:40-48`), so a failing rule stays `active` and is retried on every subsequent run until it succeeds or a human cancels it. *(Corrected 2026-08-26: this previously said failures set `status = failed`. Nothing does. If a terminal failure state is wanted, it has to be built.)*

## 8. Stripe Connect — customer payment methods

- **Per venue + per connected account**: `venue_customer_stripe` stores `stripe_customer_id` on the connected account for `(user_id, venue_id)`.
- Saved PaymentMethods are **only** used for charges on that same `stripe_connected_account_id`.

## 9. Idempotency

- Webhook and client **fulfill** paths must use `idempotency_key` / unique `stripe_payment_intent_id` on fulfillment tables or ledger to prevent double grants.
