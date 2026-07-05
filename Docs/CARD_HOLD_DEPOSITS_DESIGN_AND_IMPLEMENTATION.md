# Card Hold Deposits: Design and Implementation Document

**Status: Proposed, not yet implemented (4 July 2026). No code written.**
When implementation ships, update this header (and move the doc to `Docs/archive/` per `Docs/archive/README.md` once it is purely historical). Do not leave a stale "not built" header on a shipped feature.

**Covers booking models:** appointments (`practitioner_appointment`, `unified_scheduling`), **classes** (`class_session`, including the class cart), **events** (`event_ticket`), and **resources** (`resource_booking`). Table reservations are out of scope (Section 4).

**Relationship to other docs:**
- `Docs/TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md` is a separate, also-unshipped payments design (in-person balance collection). Card hold does **not** depend on it. Shared conventions (pence integers, direct charges, PI purpose constants, webhook-as-source-of-truth) are followed so the two can coexist. If the `booking_payments` ledger from that doc ships first, a card-hold charge should additionally write a ledger row; v1 of card hold does not require the ledger.
- `Docs/CLASS_COMMERCE_PRODUCT_RULES.md` is the normative rules doc for class entitlements (courses, memberships, credits). Section 7.4 of this document defines how card holds compose with those rules without changing them.
- `Docs/PRD.md` §3.4 (phone booking deposit requests) and the existing deposit architecture are the UX baseline this feature extends.

---

## 1. Overview

### 1.1 Problem

Venues want no-show protection without charging guests money up front. Today the per-service/per-type payment options are `none`, `deposit` (charged at booking), or `full_payment`. A deposit deters no-shows but adds friction and refund admin. Venues want the Fresha-style middle ground: **take no money now, keep a card on file, and charge a defined no-show fee only if the client fails to attend, at the venue's explicit discretion.** For class-based businesses (gyms, studios) this is the dominant model: members book "free" classes under a membership or credits, but a no-show fee applies.

### 1.2 Solution

A new payment requirement, **Card hold**, available on appointment services, unified-scheduling service items, class types, events, and resources:

- The venue enables deposits as today and chooses **Card hold** as the type, with a defined no-show fee.
- The guest must enter card details to book. **£0 is taken.** The card is saved securely with Stripe against the venue's connected account.
- If the guest does not attend, staff mark the booking **No-Show** exactly as today. That unlocks an explicit **"Charge no-show fee"** action on the booking. Nothing is ever charged automatically.
- The charge is a merchant-initiated, off-session Stripe payment of up to the defined fee, on the venue's connected account (direct charge, no platform fee, matching the existing deposit flow).
- If the guest cancels (any time, any actor), the hold is released and can never be charged. Holds also auto-release 14 days after the appointment/session.
- For class carts, card holds compose with entitlements: a membership- or credit-covered class can still require a card hold, and a single card entry covers the whole cart.

### 1.3 Design principles (hard requirements)

1. **Seamless with deposits.** Same settings surfaces, same booking-flow payment step, same staff booking-detail deposit block, same `deposit_status` state machine, same comms patterns. A venue that understands deposits should understand card holds with zero new concepts beyond "no money now, fee only if you charge it".
2. **Explicit charge only.** No automation ever moves money. The only path to a charge is a staff/admin clicking the charge action on a booking that is already marked No-Show.
3. **Card required to book.** A booking whose configuration demands a card hold must never reach `Booked` without a successfully saved card.
4. **Webhook is source of truth** for money state (matches the existing deposit confirm/webhook split).
5. **No em-dashes in any user-facing copy** (CLAUDE.md rule). All copy strings in this doc comply and must be used as written or adapted without introducing em-dashes.

---

## 2. Current state (verified against code, July 2026)

Facts the design builds on. File references are current as of writing; re-verify line numbers before editing.

### 2.1 Payment configuration by model

| Model | Requirement column | Fee/deposit column | Semantics |
|---|---|---|---|
| Appointment services | `appointment_services.payment_requirement` (enum `class_payment_requirement`: `'none' | 'deposit' | 'full_payment'`) | `appointment_services.deposit_pence` (+ per-variant override `service_variants.deposit_pence`) | Fixed per booking (base + variant; add-ons excluded from deposits) |
| Unified service items | `service_items.payment_requirement` (same enum) | `service_items.deposit_pence` | Same as appointment services |
| Class types | `class_types.payment_requirement` (same enum; migration `20260429100000`) | `class_types.deposit_amount_pence` (per person; `price_pence` for full payment) | Charge = per-person amount x `party_size` (seats) |
| Events | `experience_events.payment_requirement` (**plain `text`**, not the enum; migration `20260515120000`) | `experience_events.deposit_amount_pence` (per person) | Event-level, NOT per ticket type; `event_ticket_types` carry `price_pence` only. Deposit = per-person x `party_size` (total tickets); full payment = ticket total |
| Resources | `unified_calendars.payment_requirement` (same enum, `calendar_type='resource'`; migration `20260503120000`) | `unified_calendars.deposit_amount_pence` (**flat per booking**) | Full payment = `price_per_slot_pence` x slots; deposit = flat. Snapshot column `bookings.resource_payment_requirement` records the mode at booking time |
| Table reservations | separate per-person GBP system in `booking_restrictions` | | Out of scope |

Resolution code: appointments in `src/lib/appointments/appointment-service-payment.ts` (`resolveAppointmentPaymentRequirement`, `resolveAppointmentServiceOnlineCharge[WithAddons]`, returns `chargeLabel: 'deposit' | 'full_payment'`); classes/events/resources resolve inline in the create route from the availability slot, which surfaces `payment_requirement` + amounts (`class-session-engine.ts`, `event-ticket-engine.ts`, resource branch). Events validate through `src/lib/experience-events/validate-event-ticket-booking.ts` (server-side price enforcement, returns `ticketTotalPence`, `requiresDeposit`, `depositAmountPence`).

### 2.2 Collection paths

- **Direct bookings (all models):** `POST /api/booking/create` (`src/app/api/booking/create/route.ts`). Model branches: event `~1109-1139`, class `~1140-1272`, resource `~1273-1357`, appointments elsewhere. Paid path inserts `status:'Pending'`, `deposit_status:'Pending'`; free path inserts `status:'Booked'`, `deposit_status:'Not Required'`. One customer-less PaymentIntent per booking unit on the connected account (`~1688-1710` for CDE, `~530-538` for tables/appointments): `{ amount, currency:'gbp', metadata:{ booking_id, venue_id }, automatic_payment_methods:{enabled:true} }`, `{ stripeAccount }`. PI id stored on `bookings.stripe_payment_intent_id`; on PI create failure the booking rows are deleted.
- **Class cart:** `POST /api/booking/class-cart/checkout` -> `orchestrateClassCartCheckout` (`src/lib/class-commerce/orchestrate-class-cart-checkout.ts`). Quotes lines (`quote-class-cart.ts`), creates a `class_booking_groups` row (`group_booking_id` on every child), resolves entitlement per line in precedence **course -> membership -> credits (opt-in) -> card** via `decideClassLineEntitlement` (`src/lib/class-commerce/entitlement-engine.ts:32-101`). Covered/free lines insert as `Booked` immediately (`insertFreeClassSessionBooking`); card lines insert as `Pending/Pending` (`insertPendingPaidClassSessionBooking`) and one PI covers them all (`metadata.booking_ids`, purpose `RESERVE_NI_PI_PURPOSE.CLASS_CART_CHECKOUT`). **Total covered by entitlements = no PI at all**, response `{ status:'completed' }`. Rollback (`rollbackGroup`) restores credits/allowance and deletes the group's rows on capacity error or PI failure.
- **Client:** `src/components/booking/PaymentStep.tsx` (Stripe Elements, `loadStripe(pk, { stripeAccount })`, `confirmPayment`) is shared by `AppointmentBookingFlow`, `ClassBookingFlow` (line ~1032), `EventBookingFlow` (~757), `ResourceBookingFlow` (~1145).
- **Confirm:** `POST /api/booking/confirm-payment` -> `confirmBookingsForSucceededPaymentIntent()` (`src/lib/booking/confirm-deposit-payment.ts`) flips all `Pending` rows on the PI to `Booked` / `'Paid'` and assigns the manage token. Webhook `payment_intent.succeeded` is the backup path.

### 2.3 Booking and deposit state

- `booking_status` enum: `Pending, Booked, Confirmed, Seated, Completed, No-Show, Cancelled` (`BOOKING_STATUSES`, `src/lib/table-management/booking-status.ts:20-28`; `'Booked'` added by standalone migration `20260626120000` because `ALTER TYPE ... ADD VALUE` cannot run in a transaction that also uses the value).
- `deposit_status` enum: `'Not Required' | 'Pending' | 'Paid' | 'Refunded' | 'Forfeited' | 'Waived' | 'Failed'`.
- **No-show, staff PATCH path:** `PATCH /api/venue/bookings/[id]` (`route.ts:868-970`), all models including CDE. Grace gate (`validateNoShowGracePeriod`, `venues.no_show_grace_minutes` default 15), forfeits a `'Paid'` deposit to `'Forfeited'`, group-aware, sends `no_show_notification` + staff push, `applyBookingLifecycleStatusEffects` maintains `guests.no_show_count`. Undo restores `'Paid'`.
- **No-show, class roster path:** `POST /api/venue/class-instances/[id]/attendees/[bookingId]/no-show` -> `applyAttendanceMutation({ kind:'no_show' })` (`src/lib/class-commerce/class-attendance.ts:124-163`). **Pre-existing bug:** it writes `status = 'No Show'` (space) but the `booking_status` enum only contains `'No-Show'` (hyphen) and no migration adds the space variant, so this update should fail at the database. It also does not forfeit deposits, restore credits, or free the seat; it mirrors course enrollments and inserts a `class_no_show` events row. Roster UI: `src/components/practitioner-calendar/ClassInstanceDetailSheet.tsx` (~214-217).
- **Cancels:** staff PATCH cancel branch (`~662-867`) and guest `POST /api/confirm` cancel (`~479-755`): refund iff `now <= cancellation_deadline && deposit_status === 'Paid' && stripe_payment_intent_id`. Guest class cancel within window restores credits/allowance (`restore-class-credits.ts`, `restore-membership-allowance.ts`). `restoreAndReleaseClassBookings` (webhook, `route.ts:48-119`) restores entitlements and frees seats on payment failure/refund.
- All CDE creates set `cancellation_deadline` + `cancellation_policy_snapshot` via `resolveCancellationNoticeHoursForCreate` (per-entity hours; class -> `class_types`, event -> `experience_events`, resource -> `unified_calendars`).
- Staff deposit actions: `POST /api/venue/bookings/[id]/deposit` with `action: 'send_payment_link' | 'waive' | 'record_cash' | 'refund'`. Surfaced in `src/components/booking/BookingDetailContent.tsx` (~591-640).

### 2.4 Saved-card machinery that already exists (but is not used by bookings)

- Per-venue Stripe Customers: `venue_customer_stripe` (`user_id`, `venue_id`, `stripe_connected_account_id`, `stripe_customer_id`), created by `ensureVenueStripeCustomerForUser()` (`src/lib/class-commerce/venue-stripe-customer.ts`).
- `POST /api/account/payment-methods/setup-intent` creates a `SetupIntent` (`usage: 'off_session'`, `payment_method_types: ['card']`) on the connected account. `GET /api/account/payment-methods` lists; a delete route detaches.
- **No booking flow currently attaches a customer, uses `setup_future_usage`, or performs off-session confirmation.**

### 2.5 Webhook

`POST /api/webhooks/stripe`, signature-verified, idempotent via `claimStripeWebhookEvent` (`webhook_events`). Connected account from `event.account`. Handles `payment_intent.succeeded` (purpose branches for class-commerce, else generic booking confirm), `payment_intent.payment_failed` (sets `'Failed'` on `Pending` rows + `restoreAndReleaseClassBookings`), `charge.refunded`/`charge.refund.updated` (marks `'Refunded'` + restore), `account.updated`, subscription events.

### 2.6 Crons

- `auto-cancel-bookings`: phone `Pending/Pending` after 24h; abandoned online **class-cart** rows (`class_instance_id` + PI, 30 min, PI status in `requires_payment_method | canceled | requires_confirmation`) -> `Cancelled` + `'Failed'`.
- `deposit-reminder-2h`: phone `Pending/Pending`, messaging only.
- `reconciliation`: 48h lookback over `deposit_status IN ('Paid','Refunded')` with a PI; writes `reconciliation_alerts` on divergence.
- `class-recurring-materialize` -> `materializeRecurringReservation` (`src/lib/class-commerce/materialize-recurring-reservation.ts:184-196`): **auto-books only classes with no online card charge** (skips `full_payment`/`deposit` with a "no online card charge" message); books via `insertFreeClassSessionBooking`.

### 2.7 Reporting, events, flags

- `report_deposit_summary` RPC: collected = `Paid + Forfeited`, refunded, forfeited buckets. `report_by_booking_model` counts `deposit_status='Paid'`.
- `events` table: trigger logs `booking_created` / `booking_status_changed`; app code inserts custom rows (`auto_cancelled`, `class_no_show`, `class_credit_restored`, ...).
- Feature flags: key in `APPOINTMENTS_FEATURE_FLAG_KEYS` (`src/lib/feature-flags/types.ts`), zod key, env in `ENV_BY_FLAG` (`resolve.ts`); default off unless in `FLAG_DEFAULT_ON`. Route gating via `assertAppointmentsFeatureEnabled`, 403 helper `featureFlagDisabledResponse` (`http.ts`).

---

## 3. Key design decisions (with rationale)

### D1. Stripe mechanism: save the card now, charge off-session later. NOT a manual-capture authorization.

Card-network authorizations expire after about 7 days; bookings are made weeks or months out. **Decision: the card is saved (SetupIntent, or PaymentIntent with `setup_future_usage`, both `off_session`) at booking; the no-show fee is a later merchant-initiated off-session PaymentIntent.** No funds are reserved on the guest's card in the meantime, matching the promise "no payment taken up front".

### D2. A dedicated, booking-scoped Stripe Customer. NOT the guest's account wallet customer.

The saved PaymentMethod must be attached to a Stripe Customer to be charged off-session. The `venue_customer_stripe` customer is the guest's **self-serve wallet**: listed by `GET /api/account/payment-methods`, and the guest can **detach** cards there, which would let them defeat the hold before no-showing, and would surprise guests with a card silently appearing in their wallet.

**Decision: every card-hold capture unit creates a dedicated Stripe Customer on the connected account (metadata: `booking_id` of the lead row, `venue_id`, `reserve_ni_purpose: 'card_hold'`).** Never visible in the wallet, not self-detachable, deleted wholesale at release time (which detaches the card: data minimisation).

### D3. Charge is gated strictly on booking status = `No-Show`, staff-explicit, admin-only.

- The charge action is enabled only when `status = 'No-Show'`, `deposit_status = 'Card Held'`, hold not released, within the charge window.
- **Any cancellation (guest or staff, early or late) releases the hold.** A cancelled booking can never be charged in v1. (Late-cancellation fees: Section 19.)
- Admin-only (money movement). Staff see the state but not the button.

### D4. State lives in the existing `deposit_status` enum plus one new 1:1 table.

- Two new `deposit_status` values: **`'Card Held'`** and **`'Charged'`**. Every existing surface stays on one state machine; existing predicates (`= 'Paid'`, `= 'Pending'`) are naturally false for card holds, which is correct everywhere (refund button, forfeit-on-no-show, auto-cancel, entitlement restore).
- Hold internals (Stripe ids, fee snapshot, consent snapshot, charge/release bookkeeping) live in a new **`booking_card_holds`** table, one row per booking row, service-role only. `deposit_amount_pence` stays NULL for card-hold rows (no money up front).

### D5. Configuration reuses each model's existing payment requirement and amount columns.

`'card_hold'` becomes a fourth requirement value everywhere the current three exist. When selected, **the existing deposit amount column holds the no-show fee** and the UI label switches to "No-show fee". Fee semantics deliberately mirror each model's deposit semantics, so venues' existing mental model transfers:

| Model | Fee configured as | Booking fee snapshot |
|---|---|---|
| Appointment service / service item | fixed, per booking (`deposit_pence`, variant override applies, add-ons excluded) | the fixed amount |
| Class type | per person (`deposit_amount_pence`) | per-person fee x `party_size` (seats) |
| Event | per person (`deposit_amount_pence`, event-level) | per-person fee x `party_size` (tickets) |
| Resource | flat per booking (`deposit_amount_pence`) | the flat amount |

The requirement is **exclusive** per entity: a class type is `card_hold` OR `deposit` OR `full_payment`, never a combination. (Compound "charge AND hold on the same entity" is future work; carts mixing entities with different requirements are handled by D7.)

### D6. v1 is online-booking-flow only.

Phone/staff-created bookings keep today's deposit-request behaviour; the `/pay` link page is untouched. Staff-side card-save links are a fast-follow (Section 19).

### D7. Three capture modes; mixed carts and bundles save the card on the payment.

A booking unit (single booking, appointment multi-service bundle, group appointment, or class cart) resolves to one **capture mode**:

| Mode | When | Stripe object | Client confirm call |
|---|---|---|---|
| `payment` | money due, no card-hold lines | PaymentIntent (exactly today's) | `confirmPayment` |
| `setup` | no money due, at least one card-hold line | SetupIntent (`usage:'off_session'`) | `confirmSetup` |
| `payment_with_setup` | money due AND at least one card-hold line | PaymentIntent + `customer` + `setup_future_usage:'off_session'` | `confirmPayment` |

`payment_with_setup` is the key to seamlessness: one card entry, one confirmation, Stripe charges the money AND vaults the card (auto-attached to the customer). This covers the class cart containing both a paid class and a card-hold class, and the appointment bundle mixing a deposit service with a card-hold service. No hold is ever silently dropped.

### D8. Class entitlements compose with card holds; the covered-but-held case is first-class.

Per `Docs/CLASS_COMMERCE_PRODUCT_RULES.md`, entitlements (course -> membership -> credits -> card) decide **how money is paid**. A card-hold class charges no money, so entitlements are not consumed for it: members and non-members book a card-hold class identically (free, card held). The gym pattern "membership covers the class, no-show fee applies" is exactly this: set the class type to `card_hold`.

In a cart, entitlement resolution runs per line exactly as today for `deposit`/`full_payment` lines; `card_hold` lines bypass the entitlement engine (they cost nothing) and instead join the capture unit as hold lines. A cart of one credit-covered paid class + one card-hold class therefore consumes the credit, charges nothing, and saves the card (`setup` mode, because the covered line contributes £0 to `totalStripePence`).

### D9. One canonical no-show status, and the roster bug gets fixed first.

The charge gate keys on `status = 'No-Show'` (the enum value). The class attendance route currently writes `'No Show'` (space), which is not an enum value and should be failing at the database today (Section 2.3). **Phase 0 fixes `class-attendance.ts` to write `'No-Show'`** (and its idempotency check likewise), verifies the route against a real database, and adds a regression test. The roster no-show then flows into the same charge gate as the staff PATCH path. (The roster route still deliberately does not forfeit paid deposits; that pre-existing inconsistency is out of scope, flagged in Section 19.)

---

## 4. Scope

### In scope (v1)

- **Models:** appointments (single, multi-service, group), classes (single booking and cart), events, resources; online public flows only (`/api/booking/create`, `/api/booking/create-multi-service`, `/api/booking/create-group`, `/api/booking/class-cart/checkout`).
- Per-entity configuration in each model's editor (appointment service form, class type form in the class timetable manager, event form in the event manager, resource form in the resource timeline).
- Guest payment step in all three capture modes; confirm paths; webhook backup paths.
- Staff: hold visibility, charge action (booking detail and class roster), refund of a charged fee.
- Guest manage page visibility; cancellation releases the hold; class credit/allowance interplay.
- Comms: confirmation email hold terms, charged-fee receipt email.
- Crons: abandoned-capture cleanup (incl. class carts with entitlement restore), hold auto-release, reconciliation awareness, recurring-materialization skip.
- Reporting: card-hold buckets in the deposit summary.
- Feature flag `card_hold_deposits`, default off.

### Out of scope (v1), with reasons

- **Table reservations** (separate per-person GBP deposit system; product focus is appointments-type businesses).
- **Phone/staff-created bookings and the `/pay` link page** (D6).
- **Automatic charging of any kind**, including late-cancel fees (D3).
- **Charging more than the disclosed fee** (clamped to the snapshot).
- **Compound per-entity config** ("charge a deposit AND hold for a further fee" on one entity; D5). Mixed *units* are covered by D7.
- **Recurring class reservations**: materialized bookings are auto-created with no guest present, so no card can be captured. Materialization skips card-hold classes (Section 12.4).
- **Waitlists**: the waitlist subsystem is appointment-only today and its conversion paths are staff-driven; card hold does not integrate with waitlist conversion in v1.
- **Courses** (prepaid enrollments; no-show economics do not apply per session in v1).
- **Partial ticket no-show for events**: no-show and the fee apply to the whole booking (ticket-line edits are rejected today: "Ticket line edits are not supported (v1)").
- **Tap to Pay / `booking_payments` ledger**; **multi-currency** (`'gbp'` hardcoded, matching every existing PI).

---

## 5. Data model

Three migrations. House conventions: `IF NOT EXISTS` guards, `gen_random_uuid()`, pence integer checks, RLS enabled with no policies (service-role only), named unique indexes.

### 5.1 Migration A: enum values (standalone, no transaction with usage)

Copy the structure of `supabase/migrations/20260626120000_booking_status_add_booked.sql`.

```sql
-- <timestamp>_card_hold_enums.sql
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'Card Held';
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'Charged';
ALTER TYPE class_payment_requirement ADD VALUE IF NOT EXISTS 'card_hold';
```

Notes:
- `class_payment_requirement` is shared by `appointment_services`, `service_items`, `class_types`, `unified_calendars`, and `bookings.resource_payment_requirement`; one `ADD VALUE` covers them all.
- **Events need no DDL**: `experience_events.payment_requirement` is plain `text`; `'card_hold'` is accepted as data. Application validation unions are the gate (Section 6).

### 5.2 Migration B: `booking_card_holds`

```sql
-- <timestamp>_booking_card_holds.sql
CREATE TABLE IF NOT EXISTS public.booking_card_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  venue_id   uuid NOT NULL REFERENCES public.venues (id)   ON DELETE CASCADE,
  -- Connected account the customer/PM/charge live on; snapshotted so later
  -- account changes cannot orphan the hold.
  stripe_connected_account_id text NOT NULL,
  stripe_customer_id text,             -- dedicated, booking-scoped customer (D2), shared across the capture unit
  stripe_setup_intent_id text,         -- set in 'setup' mode; NULL in 'payment_with_setup' mode
  stripe_payment_method_id text,       -- set at confirm time from the succeeded intent
  fee_pence int NOT NULL CHECK (fee_pence > 0),   -- max chargeable for THIS booking row, snapshotted at create
  currency text NOT NULL DEFAULT 'gbp',
  -- Consent snapshot shown to the guest at save time (dispute evidence):
  -- { "text": "...", "version": 1, "fee_pence": <unit total>, "accepted_at": "<iso>" }
  terms_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  charge_payment_intent_id text,       -- off-session PI, set when a charge is attempted
  charged_pence int CHECK (charged_pence IS NULL OR charged_pence > 0),
  charged_at timestamptz,
  charged_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  charge_failure_code text,            -- last failure: 'card_declined', 'authentication_required', ...
  charge_failure_at timestamptz,
  released_at timestamptz,
  release_reason text,                 -- 'cancelled' | 'expired' | 'refunded' | 'abandoned' | 'admin'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_card_holds_booking_uq
  ON public.booking_card_holds (booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS booking_card_holds_charge_pi_uq
  ON public.booking_card_holds (charge_payment_intent_id)
  WHERE charge_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_setup_intent
  ON public.booking_card_holds (stripe_setup_intent_id)
  WHERE stripe_setup_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_venue
  ON public.booking_card_holds (venue_id, created_at DESC);
-- Release cron scans open holds:
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_open
  ON public.booking_card_holds (venue_id) WHERE released_at IS NULL;

ALTER TABLE public.booking_card_holds ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only
```

**Row granularity and unit linkage.** One hold row per booking row, each with its own `fee_pence` (per D5 semantics for that row's model and party size). All rows in a capture unit share `stripe_customer_id` (and `stripe_setup_intent_id` in setup mode). Linkage for confirmation:
- `setup` mode: hold rows found by `stripe_setup_intent_id`.
- `payment_with_setup` mode: `stripe_setup_intent_id` is NULL; **every booking row of the unit, including card-hold-only rows, stores the unit's PI id in `bookings.stripe_payment_intent_id`** (card-hold-only rows keep `deposit_amount_pence` NULL), so the existing PI-based confirm lookup finds them.

This lets staff charge exactly the no-showed attendee: in a class cart, each line (booking) has its own hold row and fee; in a group appointment, each member row likewise.

### 5.3 Migration C: reporting RPC update

Extend `report_deposit_summary` (defined in `20260304000001_reconciliation_and_reporting.sql:219-238`) via a new migration that `CREATE OR REPLACE`s it, adding:

```sql
no_show_fees_charged_pence bigint,  -- SUM(bch.charged_pence) over bookings with deposit_status = 'Charged'
no_show_fees_charged_count bigint,
card_holds_active_count    bigint   -- deposit_status = 'Card Held' AND bch.released_at IS NULL
```

Join `booking_card_holds` on `booking_id`. Do **not** fold charged fees into `total_collected_pence` (that bucket means "deposits taken up front"). Keep the function signature backwards-compatible with how `src/app/api/venue/reports/route.ts` destructures it (verify at implementation time).

Also update `Docs/schema.sql` (curated inventory): add `booking_card_holds` and note the enum value additions.

---

## 6. Configuration and settings

### 6.1 Feature flag

- Key: `card_hold_deposits`. Add to `APPOINTMENTS_FEATURE_FLAG_KEYS` (`src/lib/feature-flags/types.ts`), `venueFeatureFlagsSchema` (`card_hold_deposits: z.boolean().optional()`), `ENV_BY_FLAG` (`card_hold_deposits: 'FEATURE_FLAG_CARD_HOLD_DEPOSITS'`). **Not** in `FLAG_DEFAULT_ON`.
- Surface in `FeatureFlagsSection.tsx` (dashboard) and `FlagsPageClient.tsx` (super), following the `compliance_records_enabled` precedent. Update `Docs/FEATURE_FLAGS.md`.
- **Normative flag rule:** the flag gates the **creation of new holds** (config acceptance and booking-flow branches). It never gates charging, refunding, or releasing holds that already exist: a guest who consented keeps exactly the deal they were shown, and the venue keeps the protection they were promised, regardless of later flag changes.

### 6.2 Editor surfaces (venue-facing)

All four editors gain the same fourth option in their existing payment-requirement selector, rendered only when the flag resolves on for the venue. Shared copy:

- Option label: **"Card hold"**
- Helper text: `"No payment is taken when the client books. Their card is stored securely and you can charge a no-show fee if they do not attend."`
- The existing amount field relabels to **"No-show fee (£)"** (and, for classes and events, **"No-show fee per person (£)"**) and continues to write the same column. Validation mirrors the current deposit bounds of each form (verify per form; appointment services currently allow up to £150-class bounds, classes constrain deposit <= price: for `card_hold` **drop the "<= price" constraint**, since there is no price relationship, but keep a sane cap, suggest £150).

Per-model touchpoints:

| Model | Form location | Payload/zod to extend |
|---|---|---|
| Appointment services | `src/components/dashboard/appointment-services/AppointmentServiceFormFields.tsx` (+ `appointment-service-form-values.ts`, `appointment-service-form-to-payload.ts`; also rendered in onboarding via `OnboardingAppointmentServiceList.tsx`) | appointment-services API route unions; variant rows relabel their override field too |
| Unified service items | the service-items editor (same field set; grep `payment_requirement` under the unified services dashboard) | service_items write path unions |
| Class types | class type form inside `src/app/dashboard/class-timetable/ClassTimetableView.tsx` | class-types API route unions |
| Events | event form inside `src/app/dashboard/event-manager/EventManagerView.tsx` | experience-events API route unions (text column; the zod union is the only gate, so extending it is mandatory, not optional) |
| Resources | resource form inside `src/app/dashboard/resource-timeline/ResourceTimelineView.tsx` | unified-calendars resource write path unions |

Every write path rejects `'card_hold'` with 403 `{ code: 'feature_disabled', feature: 'card_hold_deposits' }` (`featureFlagDisabledResponse`) when the venue flag is off.

### 6.3 Resolution logic

- Appointments: `src/lib/appointments/appointment-service-payment.ts`: `'card_hold'` must be **explicit** (the legacy `deposit_pence > 0` inference stays `'deposit'`). Extend `chargeLabel: 'deposit' | 'full_payment' | 'card_hold'`; for `card_hold`, `amountPence` = the fee (variant override respected, **add-ons never included**, same rule as deposit).
- Classes/events/resources resolve inline in the create route from the slot (Section 7); the availability engines (`class-session-engine.ts`, `event-ticket-engine.ts`, resource branch) already surface `payment_requirement` and the amount columns, so `'card_hold'` flows through to slots with **no engine changes**; only the slot TS types need the widened union.
- **Flag-off safety:** if an entity carries `payment_requirement = 'card_hold'` but the venue flag resolves off (flag later disabled), resolve as `'none'` and `console.warn` (`[card-hold] <entity> <id> configured but flag off; treating as none`). Silently charging a deposit instead would take money the guest was never shown; taking nothing is the safe degradation. Editors show a warning banner on such entities: `Card hold is disabled for this venue; this service currently takes no deposit.`

### 6.4 Model guard rails

Table-reservation paths never consult `class_payment_requirement`, so no guard is needed there. Course enrollment and any other flow that reads these columns must treat `'card_hold'` as `'none'`-with-warning (6.3) rather than crashing on an unknown value: grep every `switch`/comparison on `payment_requirement` values and make the handling exhaustive (`none | deposit | full_payment | card_hold`).

---

## 7. Public booking flows

### 7.0 Capture-mode resolution (shared helper)

New module `src/lib/booking/card-hold-capture.ts`:

```ts
export type CaptureMode = 'payment' | 'setup' | 'payment_with_setup';

export type CaptureUnitLine = {
  bookingId: string;
  chargePence: number;        // money due for this row (0 for card-hold and covered rows)
  cardHoldFeePence: number | null;  // non-null when this row requires a hold
};

export function resolveCaptureMode(lines: CaptureUnitLine[]): CaptureMode | 'none' {
  const money = lines.reduce((s, l) => s + l.chargePence, 0);
  const holds = lines.some((l) => l.cardHoldFeePence != null);
  if (money > 0 && holds) return 'payment_with_setup';
  if (money > 0) return 'payment';
  if (holds) return 'setup';
  return 'none';
}
```

Also here: `createCardHoldCustomer(stripe, { leadBookingId, venueId, email, name, stripeAccount })` (D2 metadata), `createCardHoldSetupIntent(...)`, and `insertCardHoldRows(admin, lines, { customerId, setupIntentId | null, connectedAccountId, termsSnapshot })`.

Stripe calls:

```ts
// setup mode
const si = await stripe.setupIntents.create(
  {
    customer: customer.id,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata: { reserve_ni_purpose: 'card_hold_setup', booking_id: leadBookingId, venue_id: venueId },
  },
  { stripeAccount },
);

// payment_with_setup mode: today's PI create gains two fields
const pi = await stripe.paymentIntents.create(
  {
    amount: totalMoneyPence,
    currency: 'gbp',
    customer: customer.id,                 // NEW
    setup_future_usage: 'off_session',     // NEW: vaults the card on success, auto-attached
    metadata: { ...existingMetadata },     // unchanged (booking_id / booking_ids / purpose)
    automatic_payment_methods: { enabled: true },
  },
  { stripeAccount },
);
```

On any Stripe failure during create, delete the unit's booking rows and the customer (mirror the existing PI-failure cleanup), and for class carts run the existing `rollbackGroup` (which also restores entitlements).

### 7.1 Direct bookings: `POST /api/booking/create`

Applies to the appointment, class (`~1140-1272`), event (`~1109-1139`), and resource (`~1273-1357`) branches. Each branch today computes `depositAmountPence` + `requiresDeposit`; extend each to also compute `cardHoldFeePence` when the entity's requirement is `'card_hold'` (and the flag is on):

| Branch | `cardHoldFeePence` |
|---|---|
| Appointment / service item | resolved fee (fixed; variant override; no add-ons) |
| Class | `class_types.deposit_amount_pence x party_size` |
| Event | `experience_events.deposit_amount_pence x party_size` (validated party = ticket total; extend `validate-event-ticket-booking.ts` to return `cardHoldFeePence` alongside the deposit fields so pricing stays server-derived) |
| Resource | `unified_calendars.deposit_amount_pence` (flat). `bookings.resource_payment_requirement` snapshot gets `'card_hold'` automatically |

Then:
1. `resolveCaptureMode` over the unit's rows. For single bookings the unit is one row; `create-multi-service` and `create-group` pass all their rows.
2. `'none'` and `'payment'` behave exactly as today.
3. `'setup'`: insert rows `status:'Pending'`, `deposit_status:'Pending'`, `deposit_amount_pence: NULL`; require `venue.stripe_connected_account_id` (same 400 as deposits); create customer + SetupIntent; insert hold rows.
4. `'payment_with_setup'`: as today's paid path, plus customer + `setup_future_usage` on the PI; card-hold-only rows also insert `Pending/Pending` with `deposit_amount_pence: NULL` and **store the unit PI id** on `bookings.stripe_payment_intent_id`; insert hold rows (`stripe_setup_intent_id: NULL`).
5. **Class entitlements (single-booking path):** the existing entitlement short-circuit (`~1179-1272`) applies only to priced classes and is unchanged. A `card_hold` class never enters it (charge is 0; no credits or allowance consumed), per D8. `pay_with_class_credits` for a card-hold class is a 400 (`nothing to pay with credits`).

Response contract (all create endpoints):

```ts
{
  ...existing fields,
  requires_deposit: boolean,           // true whenever a payment step must render (any mode)
  payment_mode: 'payment' | 'setup' | 'payment_with_setup',   // NEW; 'payment' for legacy paths
  client_secret: string,               // pi_..._secret_... or seti_..._secret_...
  stripe_account_id: string,
  card_hold_fee_pence: number | null,  // NEW: unit total of hold fees, for consent copy
}
```

### 7.2 Class cart: `orchestrateClassCartCheckout`

Changes in `src/lib/class-commerce/orchestrate-class-cart-checkout.ts` (and `quote-class-cart.ts`):

1. **Quote:** each line gains `card_hold_fee_pence: number | null` (per-person fee x line party size when the class type is `card_hold` and the flag is on). `online_charge_pence` for such lines is 0. The quote response (used by the cart UI) surfaces it so the cart review can show "No-show fee up to £X applies" per line and in the total summary.
2. **Line handling:** `card_hold` lines bypass `decideClassLineEntitlement` (D8) and insert via `insertPendingPaidClassSessionBooking` **with `deposit_amount_pence: NULL`** (extend that helper to accept the null-money case, or add a sibling `insertPendingCardHoldClassSessionBooking`; either way `status:'Pending'`, `deposit_status:'Pending'`, `group_booking_id`, `cancellation_deadline` handling as the helper already does). Track `cardHoldLines[]`.
3. **Capture mode** over `totalStripePence` and `cardHoldLines`:
   - `none` (no money, no holds): unchanged `{ status:'completed' }`.
   - `payment` (money, no holds): unchanged single PI.
   - `setup` (no money, holds present, for example every paid line is entitlement-covered and one line is card-hold): customer + SetupIntent; hold rows for the card-hold lines; response `{ status:'payment_required', payment_mode:'setup', client_secret: si.client_secret, ... }`. Entitlement-covered lines are **already `Booked`** at this point (existing behaviour for covered lines, unchanged): only the card-hold lines await the card. This preserves principle 1.3 ("card required to book") for the card-hold lines specifically, without changing the covered lines' semantics.
   - `payment_with_setup` (money and holds): the single PI gains `customer` + `setup_future_usage`; card-hold lines' booking rows store the PI id; hold rows inserted.
4. **Rollback:** `rollbackGroup` already deletes all group rows and restores entitlements; extend it to delete the card-hold customer (best effort) when one was created.
5. **Response type** (`ClassCartCheckoutResponse`): add `payment_mode` and `card_hold_fee_pence` (cart total of hold fees).

`POST /api/booking/class-cart/quote` passes the new quote fields through untouched.

### 7.3 Payment step (client)

`src/components/booking/PaymentStep.tsx` gains:

```ts
type PaymentStepProps = {
  // existing props...
  mode?: 'payment' | 'setup' | 'payment_with_setup';   // default 'payment'
  cardHoldFeePence?: number | null;    // required when mode !== 'payment'
  venueName?: string;                  // for consent copy
};
```

- Confirm call: `mode === 'setup' ? stripe.confirmSetup({...}) : stripe.confirmPayment({...})` (`payment_with_setup` is a normal PaymentIntent confirmation; `setup_future_usage` is server-side).
- On success, call the confirm route with `setup_intent_id` (setup mode) or `payment_intent_id` (both payment modes).
- Copy (exact strings; no em-dashes):
  - `setup` mode heading: `Secure your booking`; sub-heading: `No payment is taken today.`
  - `setup` body: `Your card details are stored securely by our payment provider, Stripe. {venueName} may charge a no-show fee of up to {fee} if you miss your booking.`
  - `payment_with_setup` keeps the normal amount display, plus the body line: `Your card will also be stored securely. {venueName} may charge a no-show fee of up to {fee} if you miss your booking.`
  - Consent line, rendered directly above the submit button in both hold modes (snapshotted; Section 7.5): `By saving your card you authorise {venueName} to charge up to {fee} if you do not attend. If you cancel the booking before it starts, nothing extra will be charged.`
  - Submit button: `setup` mode `Save card and book`; `payment_with_setup` keeps the pay wording.
- All four flows (`AppointmentBookingFlow`, `ClassBookingFlow`, `EventBookingFlow`, `ResourceBookingFlow`) thread `payment_mode` / `card_hold_fee_pence` / venue name from the create/checkout response into `PaymentStep`. They already gate the step on `requires_deposit`/`payment_required` + `client_secret`; no flow-structure change.
- Confirmation screens: in `setup` mode add `Card saved. No payment has been taken.`; in `payment_with_setup` add `Your card has been stored securely for this booking.`
- Service/class/event/resource cards in the public catalogs show, for card-hold entities: `No-show fee of {fee} applies. No payment is taken when you book.` (fee shown per person for classes/events). The engines already surface the fields (6.3); the flows and `appointment-catalog` response need the widened union + display line.

### 7.4 Confirm paths

`POST /api/booking/confirm-payment` accepts exactly one of `payment_intent_id` | `setup_intent_id`.

**Setup branch** (new sibling `confirmBookingsForSucceededSetupIntent()` in `src/lib/booking/confirm-deposit-payment.ts`):
1. Retrieve the SetupIntent on the connected account; require `status === 'succeeded'`; extract `payment_method`.
2. Find hold rows by `stripe_setup_intent_id`, their bookings `Pending` in this venue (idempotent: already-confirmed rows count as `alreadyConfirmed`).
3. Update holds: `stripe_payment_method_id`; stamp `terms_snapshot.accepted_at`. Update bookings: `status:'Booked'`, `deposit_status:'Card Held'`, assign `confirm_token_hash` manage token exactly as the deposit path.
4. Insert `events` rows `card_hold_saved` (`{ fee_pence }`); send booking confirmation comms (Section 10).

**Payment branch** (extend `confirmBookingsForSucceededPaymentIntent()`): today it flips every `Pending` row on the PI to `'Paid'`. Change to per-row:
- Row has a hold row and `deposit_amount_pence IS NULL` -> `deposit_status: 'Card Held'`.
- Otherwise -> `'Paid'` (existing behaviour).
- When the retrieved PI carries a `payment_method` and any unit hold rows exist (`payment_with_setup`), populate their `stripe_payment_method_id` from it and stamp `accepted_at`, and insert `card_hold_saved` events.
The webhook `payment_intent.succeeded` path calls the same function, so both routes stay in lockstep.

### 7.5 Consent snapshot

`terms_snapshot` is written at create time with the exact consent string that will be displayed. The template constant lives in `src/lib/booking/card-hold-terms.ts` and is imported by both the client copy and the server snapshot so they cannot drift:

```json
{ "version": 1, "text": "By saving your card you authorise {venue} to charge up to £25.00 if you do not attend. If you cancel the booking before it starts, nothing extra will be charged.", "fee_pence": 2500, "accepted_at": null }
```

`fee_pence` in the snapshot is the **capture-unit total** the guest saw; each row's chargeable maximum is its own `booking_card_holds.fee_pence`. `accepted_at` is stamped at confirm (card successfully saved = consent acted on). This is the dispute evidence package together with the booking record and events trail.

---

## 8. Stripe integration detail

### 8.1 Objects and account

Everything on the venue's connected account via `{ stripeAccount }` (direct charges; no `application_fee_amount`, matching deposits). Statement descriptor is the venue's own, which helps dispute recognition.

### 8.2 Purpose constants

Add to `RESERVE_NI_PI_PURPOSE` (`src/types/class-commerce.ts`, alongside `CLASS_CART_CHECKOUT`):

```ts
CARD_HOLD_SETUP: 'card_hold_setup',              // SetupIntent metadata
CARD_HOLD_NO_SHOW_FEE: 'card_hold_no_show_fee',  // charge PI metadata
```

(`payment_with_setup` PIs keep their existing purpose: they ARE the deposit/cart payment; the hold is a side effect discovered via the hold rows.)

### 8.3 The charge call (off-session, merchant-initiated)

```ts
const pi = await stripe.paymentIntents.create(
  {
    amount: amountPence,                       // clamped to [1, hold.fee_pence]
    currency: 'gbp',
    customer: hold.stripe_customer_id,
    payment_method: hold.stripe_payment_method_id,
    off_session: true,
    confirm: true,
    description: `No-show fee for booking ${bookingRef}`,
    metadata: {
      reserve_ni_purpose: 'card_hold_no_show_fee',
      booking_id: booking.id,
      venue_id: venue.id,
    },
  },
  {
    stripeAccount: hold.stripe_connected_account_id,
    idempotencyKey: `card-hold-charge-${hold.id}-${attempt}`,  // attempt = 0 or a persisted retry counter
  },
);
```

One successful charge per hold, enforced by the `'Card Held'` state check plus the unique index on `charge_payment_intent_id`. Partial-then-full charging is intentionally impossible in v1.

### 8.4 SCA / MIT compliance

- The SetupIntent (or the `setup_future_usage` payment) performs SCA at save time when the issuer requires it; `PaymentElement` handles the challenge inline.
- The later charge is a merchant-initiated transaction: `off_session: true` applies the MIT framework using the save-time authentication as the mandate basis.
- The consent text (7.5) plus the explicit save action is the mandate evidence. This mirrors Stripe's documented "charge for no-shows" integration pattern.

### 8.5 Charge failure handling

`stripe.paymentIntents.create` with `confirm: true` throws `StripeCardError` on decline:

| Error `code` | Meaning | v1 behaviour |
|---|---|---|
| `card_declined`, `expired_card`, `insufficient_funds`, ... | Issuer refused | Record `charge_failure_code` + `charge_failure_at` on the hold; keep `deposit_status = 'Card Held'`; insert `events` row `card_hold_charge_failed`; return 402: `The card was declined ({reason}). You can try again, or contact the client to arrange payment.` Retries allowed within the window (attempt counter feeds the idempotency key). |
| `authentication_required` | Issuer demands 3DS; impossible off-session | Same recording; message: `The card issuer requires the client to authorise this payment in person. Off-session charging is not possible for this card.` Cancel the stray `requires_action` PI (`stripe.paymentIntents.cancel`). v1 offers no on-session fallback (Section 19). |

Never mutate `deposit_status` on failure; the hold remains chargeable until released/expired.

### 8.6 Webhook changes (`src/app/api/webhooks/stripe/route.ts`)

Purpose branches must run **before** the generic `metadata.booking_id` deposit-confirm path, otherwise a fee PI would be misread as a deposit payment.

1. **`payment_intent.succeeded`**, purpose `card_hold_no_show_fee`: source-of-truth completion. Find the hold by `charge_payment_intent_id` (or `metadata.booking_id` if unset, then set it). Set `charged_pence` (`pi.amount_received`), `charged_at`; booking `deposit_status: 'Charged'`; `events` row `card_hold_charged`; receipt email in `after()`. Idempotent on already-`'Charged'`.
2. **`payment_intent.succeeded`**, generic and `CLASS_CART_CHECKOUT` paths: both funnel into the extended `confirmBookingsForSucceededPaymentIntent` (7.4), which now handles `payment_with_setup` units per-row. No new branch needed beyond that extension.
3. **`payment_intent.payment_failed`**, purpose `card_hold_no_show_fee`: record failure fields (as 8.5) if not already recorded; do not touch booking status. (The generic failure path only touches `deposit_status='Pending'` rows plus `restoreAndReleaseClassBookings`; card-hold rows in `'Card Held'` are naturally excluded. Card-hold rows still `Pending` at payment failure of a `payment_with_setup` unit ARE included, which is correct: the capture failed, restore/cleanup applies.)
4. **`setup_intent.succeeded`** (new event type): backup confirm; call `confirmBookingsForSucceededSetupIntent()`. Enable the event type on the Stripe webhook endpoint (deployment checklist).
5. **`setup_intent.setup_failed`** (new event type): informational log only (client handles inline failure; abandoned rows cleaned by cron 12.1).
6. **`charge.refunded` / `charge.refund.updated`**: the existing handler looks up bookings by `bookings.stripe_payment_intent_id` and misses fee PIs (stored on the hold). Add a purpose-aware branch: fee-PI refund -> booking `deposit_status: 'Refunded'`, hold `released_at` (reason `'refunded'`), `events` row `card_hold_charge_refunded`. Idempotent on already-`'Refunded'`.

---

## 9. Staff surfaces

### 9.1 Booking detail display

`src/components/booking/BookingDetailContent.tsx` deposit block:

| State | Pill | Detail line |
|---|---|---|
| `'Card Held'`, not released | `Card held` (teal/info) | `No-show fee up to {fee}. No payment taken.` |
| `'Card Held'`, released | `Card hold ended` (neutral) | `The card hold was released on {date}.` |
| `'Charged'` | `No-show fee charged` (amber) | `{amount} charged on {date}.` |
| `'Refunded'` (was `'Charged'`) | `No-show fee refunded` (existing refunded styling) | `{amount} refunded.` |
| last charge attempt failed | keep `Card held` pill | append `Last charge attempt failed: {plain reason}.` |

`GET /api/venue/bookings/[id]` gains `card_hold: { fee_pence, charged_pence, charged_at, released_at, charge_failure_code, charge_window_ends_at } | null`. Existing deposit action buttons are gated on `deposit_status` values card holds never occupy; verify each gate rather than assuming.

### 9.2 Charge action

**API:** extend `POST /api/venue/bookings/[id]/deposit`:

```ts
{ action: 'charge_no_show_fee', amount_pence?: number }
```

Guards, in order, distinct 4xx `{ code }` each. Deliberately **no feature-flag guard** (6.1 normative rule):
1. Admin session (`requireAdmin`): 403 `admin_only`.
2. Hold row exists: 404 `no_card_hold`.
3. `booking.status === 'No-Show'`: 409 `not_no_show` (`Mark the booking as a no-show before charging the fee.`).
4. `deposit_status === 'Card Held'`: 409 `invalid_state`.
5. `released_at IS NULL` and within window: 409 `hold_released` / `hold_expired`.
6. `stripe_payment_method_id` present: 409 `no_saved_card`.
7. `amount_pence` (default `fee_pence`) within `[1, fee_pence]`: 400 `invalid_amount`.

Then create the PI (8.3); on synchronous success apply the same state as webhook branch 8.6.1 (idempotent, either may land first); `logBookingOp` (`operation: 'card_hold_charge'`); `events` row; cross-venue writes also call `recordBookingWriteAudit` (`action_type: 'edited_booking'`, before/after deposit states). Response `200 { ok, charged_pence, payment_intent_id }` or `402 { code, message }`.

**UI (booking detail):** destructive-styled `Charge no-show fee` button when the client-side mirror of guards 2-6 passes and viewer is admin. Confirm dialog:
- Title: `Charge no-show fee`
- Body: `Charge {guestName}'s saved card for missing this booking. The maximum you can charge is {fee}.`
- Amount input pre-filled with the full fee, max = fee.
- Confirm button: `Charge {amount}` (live).
- 402 messages shown inline.

The button appears automatically in every surface that reuses `BookingDetailContent` (panel, expanded row, appointment sheet).

**UI (class roster):** `ClassInstanceDetailSheet.tsx` attendee rows: after a successful roster no-show, an attendee whose booking is chargeable (same client-side mirror) shows a compact `Charge no-show fee` affordance for admins, invoking the same endpoint with the same dialog. Non-admin staff see the `Card held` state only.

### 9.3 Refunding a charged fee

Extend the existing `refund` action: when `deposit_status === 'Charged'`, refund against `hold.charge_payment_intent_id`. On success (or via webhook 8.6.6): booking `'Refunded'`, hold `released_at = now()`, `release_reason: 'refunded'`. Button relabels to `Refund no-show fee`. Admin-only.

### 9.4 No-show and cancel interplay

- **Staff PATCH No-Show:** the paid-deposit forfeit branch is untouched (holds are never `'Paid'`). **Do not auto-charge.** The `no_show_notification` email gains no charge language (nothing has been charged yet).
- **Class roster no-show:** Phase 0 fixes the status string to `'No-Show'` (D9). The roster route then feeds the same charge gate. It still does not forfeit paid deposits (pre-existing, out of scope, Section 19). Note the roster route does not enforce the venue grace window (`validateNoShowGracePeriod` lives in the PATCH path only); acceptable for v1 since the roster is a deliberate attendance surface, but the charge gate itself is status-based either way.
- **Undo No-Show:** `'Card Held'` -> nothing to restore (hold intact). `'Charged'` -> stays `'Charged'`; refund is explicit (9.3). Never silently refund.
- **Cancels release the hold.** After a successful cancel in ANY path: staff PATCH cancel branch, `staff-cancel-booking.ts`, guest `POST /api/confirm` cancel, cart `rollbackGroup`, webhook `restoreAndReleaseClassBookings` when it cancels rows: if the booking has an open hold, set `released_at`, `release_reason: 'cancelled'`, insert `events` row `card_hold_released`, and best-effort delete the booking-scoped Stripe customer **only when no other live booking row shares it** (a class-cart cancel of one line must not detach the card that other lines' holds still rely on; check for sibling holds with `released_at IS NULL` sharing `stripe_customer_id` before deleting). Class credit/allowance restore logic is unrelated to holds and unchanged.

---

## 10. Guest surfaces

### 10.1 Manage page (`/manage/[bookingId]/[token]`, `ManageBookingView.tsx`)

- `GET /api/confirm` gains the guest-safe hold summary (fee, charged state).
- `'Card Held'`, not released: `Your card is securely on file. {venueName} may charge a no-show fee of up to {fee} if you miss this booking. Cancel before it starts to avoid any charge.`
- `'Charged'`: `A no-show fee of {amount} was charged for this booking on {date}.`
- Cancel: unchanged UI; the cancel path releases the hold (9.4). Success message for a card-hold booking: `Your booking is cancelled. Your card will not be charged and the card hold has been released.` Verify the late-cancel "non-refundable" copy branch (keyed on paid deposits) does not fire for holds.
- Reschedule/modify (incl. class/resource self-reschedule under `guest_self_reschedule`): the hold carries over untouched, same card, same fee snapshot; the modify path re-computes `cancellation_deadline` as today. If the modify changes the service/class to one with a different card-hold fee, **keep the original snapshot** (the guest consented to that amount); code comment required.

### 10.2 Emails and SMS

Templates in `src/lib/emails/templates/`, senders in `src/lib/communications/send-templated.ts`, comm-log message types constrained per the `20260402000000` migration mechanism. The renderer already varies nouns by model via `bookingLabel(booking)`; reuse it so copy says "class"/"booking"/"tickets" appropriately.

1. **Booking confirmation** (existing template, all models): when the booking has an open hold, append: `No payment has been taken. Your card is securely on file and {venueName} may charge a no-show fee of up to {fee} if you do not attend. Cancel before your booking starts to avoid any charge.`
2. **No-show fee receipt** (new): `card-hold-charged.ts`, comm-log type `card_hold_charged_email`, sent from the charge/webhook success path.
   - Subject: `No-show fee charged: {venueName}`
   - Body: `You missed your {bookingLabel} at {venueName} on {date} at {time}. As set out when you booked, a no-show fee of {amount} has been charged to your saved card. If you think this is a mistake, please contact {venueName} directly.` Standard footer partial.
3. **No SMS receipt in v1** (email is the receipt of record; SMS allowance is billed). CDE reminder crons (`cde_reminder_1/2`) are unchanged.

---

## 11. Events, audit, observability

- `events` rows (manual inserts): `card_hold_saved`, `card_hold_charged`, `card_hold_charge_failed`, `card_hold_charge_refunded`, `card_hold_released`, payloads `{ booking_id, fee_pence | charged_pence | failure_code | release_reason }`. They surface in the booking timeline automatically. (The class roster's existing `class_no_show` event is unchanged and complements these.)
- `logBookingOp` (`src/lib/observability/booking-ops-log.ts`): operations `card_hold_charge`, `card_hold_charge_failed`.
- Cross-venue writes: `recordBookingWriteAudit` (9.2).

---

## 12. Crons

### 12.1 Abandoned capture cleanup (extend `auto-cancel-bookings`)

Generalise the existing 30-minute online class-cart sweep into an abandoned-capture sweep covering all card-hold units:

- **Selection:** `status='Pending' AND deposit_status='Pending' AND source='online'` created > 30 min ago, joined to `booking_card_holds` (any model) **or** matching the existing class-cart predicate (unchanged).
- **Setup-mode units** (hold has `stripe_setup_intent_id`): retrieve the SI; if `requires_payment_method` or `canceled` -> cancel the rows (`status:'Cancelled'`, `deposit_status:'Failed'`, `cancellation_actor_type:'system'`), `events` `auto_cancelled` (`reason:'card_hold_setup_abandoned'`), release holds (`release_reason:'abandoned'`), delete the customer, and for class rows call `restoreAndReleaseClassBookings`-equivalent entitlement restore (card-hold class lines consumed no entitlements, so this is usually a no-op; paid siblings are covered by the existing sweep). SIs in `requires_action`/`processing` wait for the next sweep.
- **`payment_with_setup` units:** already covered by the existing PI-status sweep for class carts; extend the same PI check to non-class card-hold units (appointments bundles), cancelling + releasing as above.

The phone 24h sweep and `deposit-reminder-2h` key on `source='phone'` and are unaffected (v1 online-only).

### 12.2 Hold release (new cron `/api/cron/release-card-holds`)

- Route: `src/app/api/cron/release-card-holds/route.ts`, `GET`/`POST`, `requireCronAuthorisation()`, registered in `vercel.json` daily at `30 5 * * *`. Document in `Docs/DEVELOPMENT.md`.
- Window constant: `CARD_HOLD_CHARGE_WINDOW_DAYS = 14` in `src/lib/booking/card-hold-terms.ts`; `charge_window_ends_at` = booking end datetime + 14 days (derived, not stored).
- Sweep: holds `released_at IS NULL` whose booking ended > 14 days ago (any status, including No-Show never charged, and Completed). Set `released_at`, `release_reason:'expired'`, `events` `card_hold_released`, best-effort `stripe.customers.del` **with the shared-customer check from 9.4** (skip deletion while a sibling hold is still open; the last released hold deletes the customer). Stripe deletion failure logs and continues; the row is still released (the charge guard keys on `released_at`, so an undeleted customer is a cleanup miss, not a security hole).
- Inline releases on cancel (9.4) and refund (9.3) do the same; the cron is the backstop and the expiry path.

### 12.3 Reconciliation (extend `/api/cron/reconciliation`)

Add to the 48h sweep:
- `'Card Held'` (not released): retrieve the saving intent (SI, or the unit PI for `payment_with_setup`); alert if it is not `succeeded` or the PM is detached (`expected_status:'Card Held'`, `actual_stripe_status`).
- `'Charged'`: retrieve `charge_payment_intent_id`; alert if not `succeeded`.
Reuses the `reconciliation_alerts` row shape unchanged.

### 12.4 Recurring class materialization (extend the skip)

`materializeRecurringReservation` (`~184-196`) currently skips `full_payment`/`deposit` classes. Add `card_hold` to the skip: auto-booking runs with no guest present, so no card can be captured, and booking without the hold would violate principle 1.3. Skip message: `Auto-booking is only supported for classes with no online card requirement.` (Also update the account recurring UI copy if it enumerates eligible classes.)

---

## 13. Reporting

- RPC change in 5.3; pass-through in `src/app/api/venue/reports/route.ts` (`report4_deposit`).
- Reports UI (`ReportsView.tsx`, deposit section): two stat lines: `No-show fees charged: {amount} ({count})` and `Active card holds: {count}`, visually separate from deposits collected.
- `report_by_booking_model` (`deposit_pence_collected` counts `'Paid'` only) intentionally unchanged in v1; card-hold revenue is venue-level in the deposit summary. Code comment required.

---

## 14. State machine and edge cases

`deposit_status` transitions introduced (all others unchanged):

```
Pending ──(save succeeded: confirm route or webhook; setup OR payment_with_setup)──▶ Card Held
Pending ──(capture abandoned: cron 12.1)────────────────────────────────────────────▶ Failed
Card Held ──(admin charge succeeds; status must be No-Show)────────────────────────▶ Charged
Card Held ──(cancel / expiry / abandonment / admin release)──▶ Card Held + released_at   (terminal)
Charged ──(admin refund or Stripe refund webhook)────────────▶ Refunded (+ released_at)  (terminal)
```

Booking `status` machine unchanged. Charge eligibility = `status='No-Show' AND deposit_status='Card Held' AND released_at IS NULL AND now() <= charge_window_ends_at`.

| Scenario | Behaviour |
|---|---|
| Guest abandons at card step (any model) | Rows stay `Pending/Pending`; 30-min sweep cancels, releases, restores entitlements where consumed (12.1) |
| Guest cancels early or late | Cancel proceeds; hold released; no charge ever possible (D3) |
| Staff cancels | Same |
| Guest reschedules / self-reschedules class or resource | Hold carries over, fee snapshot unchanged (10.1) |
| No-show, venue charges full or partial fee | `Charged` (clamp `[1, fee]`); one charge per hold; receipt email |
| No-show, venue does nothing | Hold expires 14 days after the booking; card detached |
| Charge declined / requires 3DS | Hold stays chargeable; retry within window; plain-language surfacing (8.5) |
| Undo No-Show after charge | Status reverts; money untouched; refund explicit (9.4) |
| Charged then disputed | Direct charge on the venue's account; evidence = terms snapshot + booking + events trail (15) |
| Flag disabled after holds exist | Existing holds chargeable/refundable/releasable; only new-hold creation stops (6.1) |
| Venue disconnects Stripe | Charges fail at Stripe; account id snapshotted on the hold keeps refunds/cleanup routed |
| Group appointment, one member no-shows | That row alone is marked and charged (per-row holds, 5.2) |
| Class cart: paid line + card-hold line, payment succeeds | Paid line `'Paid'`, hold line `'Card Held'`, one card entry (`payment_with_setup`, 7.2) |
| Class cart: credit-covered line + card-hold line | Credit consumed for the covered line (already `Booked`); hold line `Pending` until card saved (`setup` mode); abandonment cancels only the hold line |
| Card-hold class line cancelled from a multi-line cart | Its hold releases; shared customer survives while sibling holds remain open (9.4) |
| Member books a card-hold class | Identical to non-member: free, card held; no allowance consumed (D8) |
| `pay_with_class_credits` on a card-hold class | 400: nothing to pay (7.1) |
| Recurring reservation hits a card-hold class | Materialization skips with message (12.4) |
| Event booking with N tickets no-shows | One booking, one hold, fee = per-person x N; all-or-nothing (Section 4) |
| Roster no-show then charge | Works: roster writes canonical `'No-Show'` after the Phase 0 fix (D9) |

---

## 15. Security, compliance, privacy

- **PCI:** card data never touches ResNeo servers (Stripe Elements; same posture as deposits).
- **SCA/MIT:** Section 8.4; consent text + snapshot is the mandate record for both save paths (SetupIntent and `setup_future_usage`).
- **Authorization:** charging/refunding admin-only server-side (`requireAdmin`); all Stripe mutations service-role; `booking_card_holds` has no RLS policies.
- **Disputes:** no-show fees carry elevated dispute risk. Evidence per charge: `terms_snapshot` (exact consent text, unit fee, accepted_at), booking record (entity, date/time, party/tickets), `events` trail (`booking_created`, `card_hold_saved`, `booking_status_changed` to No-Show or `class_no_show`, `card_hold_charged`). No automated evidence submission in v1.
- **GDPR/data minimisation:** the saved card lives only while a hold can still be charged; release deletes the booking-scoped Stripe customer (detaching the PM), subject to the shared-customer check. Stripe ids remain on hold rows for audit. `account-hard-delete` anonymisation is unaffected (holds reference bookings, cascade, no direct PII beyond Stripe ids).
- **Abuse guards:** server-side clamp to the consented fee; single-charge enforcement; grace-window gate on marking no-show (PATCH path) limits premature no-shows.

---

## 16. Implementation plan (phased, with file-by-file checklist)

Each phase leaves the app shippable with the flag off.

### Phase 0: foundations and pre-existing fixes
1. **Fix the class roster no-show status string** (D9): `src/lib/class-commerce/class-attendance.ts` lines ~126 and ~131, `'No Show'` -> `'No-Show'`; verify against a real database; regression test. Audit for any other `'No Show'` (space) literals.
2. Migration A (enums), Migration B (`booking_card_holds`).
3. `src/lib/booking/card-hold-terms.ts` (consent template, `CARD_HOLD_CHARGE_WINDOW_DAYS`, fee formatting) and `src/lib/booking/card-hold-capture.ts` (7.0).
4. Feature flag plumbing: `types.ts`, `resolve.ts`, `FeatureFlagsSection.tsx`, `FlagsPageClient.tsx`, `Docs/FEATURE_FLAGS.md`.
5. Purpose constants (8.2). Type updates: `deposit_status` unions and display-label maps (grep `'Forfeited'` for every union/map); `ClassPaymentRequirement` union + every exhaustive switch on it (6.4).

### Phase 1: configuration
6. `appointment-service-payment.ts`: `'card_hold'` resolution, flag-off degradation (6.3).
7. Editor forms + payload/zod + flag gating for: appointment services (incl. onboarding list), service items, class types (`ClassTimetableView.tsx`), events (`EventManagerView.tsx`; zod union is the only gate for the text column), resources (`ResourceTimelineView.tsx`) (6.2).
8. Availability slot TS types widened; `validate-event-ticket-booking.ts` returns `cardHoldFeePence` (7.1).

### Phase 2: booking flows
9. `POST /api/booking/create`: capture-mode integration across the appointment, class, event, resource branches; `pay_with_class_credits` rejection for card-hold classes (7.1). Then `create-multi-service`, `create-group`.
10. Class cart: `quote-class-cart.ts` line fields; `orchestrate-class-cart-checkout.ts` card-hold lines, capture modes, rollback customer cleanup; response types; `/class-cart/quote` pass-through (7.2). `insertPendingPaidClassSessionBooking` null-money support (or sibling helper).
11. `PaymentStep.tsx` modes + copy; prop threading in all four flows; confirmation screens; catalog fee lines (7.3).
12. Confirm paths: `confirmBookingsForSucceededSetupIntent()` (new) and per-row extension of `confirmBookingsForSucceededPaymentIntent()`; `confirm-payment` route schema (7.4).
13. Webhook: `setup_intent.succeeded` / `setup_intent.setup_failed`; enable event types on the Stripe endpoint (deployment note) (8.6).

### Phase 3: staff charge + guest visibility
14. `GET /api/venue/bookings/[id]`: `card_hold` object (9.1).
15. `POST /api/venue/bookings/[id]/deposit`: `charge_no_show_fee` + guards; `refund` extension for `'Charged'` (9.2, 9.3).
16. Webhook purpose branches for the fee PI (succeeded / failed / refunded), ordered before generic paths (8.6).
17. `BookingDetailContent.tsx` pills + charge dialog + refund relabel; `ClassInstanceDetailSheet.tsx` roster affordance (9.1, 9.2).
18. Hold release on every cancel path: PATCH cancel, `staff-cancel-booking.ts`, `/api/confirm` cancel, `rollbackGroup`, `restoreAndReleaseClassBookings`; shared-customer deletion check (9.4).
19. `GET /api/confirm` + `ManageBookingView.tsx` guest copy incl. cancel success message (10.1).
20. Emails: confirmation hold section (model-aware noun), `card-hold-charged.ts` + comm-log type migration entry + sender (10.2).
21. Events + `logBookingOp` + cross-venue audit (11).

### Phase 4: lifecycle hygiene
22. `auto-cancel-bookings`: generalised abandoned-capture sweep (12.1).
23. New cron `release-card-holds` + `vercel.json` + `Docs/DEVELOPMENT.md` (12.2).
24. `reconciliation` extension (12.3).
25. `materializeRecurringReservation` skip + message (12.4).
26. Reports: Migration C, route pass-through, `ReportsView.tsx` tiles; `Docs/schema.sql` (13).

### Phase 5: docs and rollout
27. Help centre: venue-side deposits article gains a card-hold section; class/appointments guest copy review. CLAUDE.md copy rules apply.
28. Update this document's status header; add a row to `Docs/Resneo-Appointments-Review-And-Roadmap.md`.
29. Rollout: deploy flag-off; staging env flag; pilot one venue (per-venue flag); watch `reconciliation_alerts`, webhook logs, first live charges; then default-availability decision.

---

## 17. Test plan

### Unit (vitest, colocated)
- `resolveCaptureMode`: all four outcomes; multi-line units.
- `appointment-service-payment`: `'card_hold'` explicitness (legacy inference untouched), variant override, add-on exclusion, flag-off degradation, per-model fee math (class/event x party, resource flat).
- `card-hold-terms`: consent rendering, snapshot shape, window computation.
- Charge guard matrix (9.2, guards 1-7) as a pure function: every 4xx.
- Webhook ordering: fee-PI success must not reach the generic confirm; `payment_with_setup` PI success confirms per-row (`'Paid'` vs `'Card Held'`).
- `class-attendance` writes `'No-Show'` (Phase 0 regression).
- Entitlement engine untouched by card-hold lines: card-hold line never consumes credits/allowance; `pay_with_class_credits` rejection.
- Display-label maps cover the two new `deposit_status` values.

### Integration (mocked Stripe)
- Each model: create -> save -> `'Card Held'` (route and webhook paths, idempotent overlap).
- Class cart matrices: paid+hold (`payment_with_setup`), covered+hold (`setup`), hold-only (`setup`), covered-only (`completed`, unchanged); PM propagation to every hold row; rollback deletes customer.
- Abandonment: setup-mode and payment_with_setup-mode units cancelled + released; covered lines survive; credits restored where applicable.
- No-Show (PATCH and roster) -> charge success -> `'Charged'` + events + receipt; double-click -> one PI.
- Declines: `card_declined`, `authentication_required` (stray PI cancelled); retry path.
- Cancels from every path release the hold; shared-customer survival check for multi-line carts.
- Refund of a charged fee -> `'Refunded'` + released.
- Reconciliation alerts for both new states; release cron expiry incl. customer deletion skip logic.
- Recurring materialization skips card-hold classes.

### Manual E2E (Stripe test mode, connected test account)
| Card | Expectation |
|---|---|
| `4242 4242 4242 4242` | Saves; off-session charge succeeds |
| `4000 0025 0000 3155` | 3DS challenge at save; off-session charge later raises `authentication_required` |
| `4000 0000 0000 0341` | Attaches; off-session charge declines (`card_declined`) |

Walk the journeys on staging: configure one card-hold entity per model; book each online (check copy and £0, or amount + save line for `payment_with_setup`); verify confirmation email terms; class cart with membership coverage + card-hold class; mark No-Show inside grace (PATCH must refuse) and after; roster no-show + roster charge; partial charge; receipt email; reports tiles; refund; hold expiry via cron with customer deletion; recurring skip message.

---

## 18. API contract summary (quick reference)

| Surface | Change |
|---|---|
| `POST /api/booking/create` (+ `create-multi-service`, `create-group`) | Response adds `payment_mode: 'payment' | 'setup' | 'payment_with_setup'`, `card_hold_fee_pence`; setup mode returns a SetupIntent `client_secret` |
| `POST /api/booking/class-cart/checkout` (+ `/quote`) | Same additions; quote lines add `card_hold_fee_pence` |
| `POST /api/booking/confirm-payment` | Accepts `setup_intent_id` (XOR `payment_intent_id`) |
| `GET /api/venue/bookings/[id]` | Adds `card_hold: {...} | null` (9.1) |
| `POST /api/venue/bookings/[id]/deposit` | New `action: 'charge_no_show_fee'` (+ `amount_pence`); `refund` handles `'Charged'` |
| `GET /api/confirm` | Guest-safe hold summary |
| `POST /api/webhooks/stripe` | New event types `setup_intent.succeeded`, `setup_intent.setup_failed`; purpose branches for `card_hold_no_show_fee`; per-row confirm for `payment_with_setup` |
| `GET/POST /api/cron/release-card-holds` | New cron |
| Entity editors' write APIs | `payment_requirement` unions accept `'card_hold'` (flag-gated) |

---

## 19. Future work (explicitly not v1)

1. **Fee payment link fallback** for `authentication_required` declines: on-session pay page charging the fee with 3DS.
2. **Phone/staff-created bookings**: "secure your booking" card-save link (deposit-request flow in setup mode) with template copy changes.
3. **Late-cancellation fees**: charge window opening on late cancel, not just No-Show; new consent text, policy config, manage-page copy.
4. **Compound per-entity config**: "charge a deposit AND hold for a further no-show fee" on one entity (the `payment_with_setup` machinery already supports the capture; this is a config/UX extension).
5. **Roster no-show parity**: make the class roster no-show honour the grace window and forfeit paid deposits like the PATCH path (pre-existing inconsistency).
6. **Waitlist integration** if/when CDE waitlists ship.
7. **Course session no-show fees.**
8. **`booking_payments` ledger rows** for card-hold charges once the Tap to Pay ledger ships.
9. **Automated dispute evidence** assembly from the terms snapshot + events trail.
