# Card Hold Deposits: Design and Implementation Document

**Status: Proposed, not yet implemented (4 July 2026). No code written.**
When implementation ships, update this header (and move the doc to `Docs/archive/` per `Docs/archive/README.md` once it is purely historical). Do not leave a stale "not built" header on a shipped feature.

**Owner scope:** appointments (booking models `practitioner_appointment` and `unified_scheduling`). See Section 4 for explicit non-goals.

**Relationship to other docs:**
- `Docs/TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md` is a separate, also-unshipped payments design (in-person balance collection). Card hold does **not** depend on it. Shared conventions (pence integers, direct charges, PI purpose constants, webhook-as-source-of-truth) are followed so the two can coexist. If the `booking_payments` ledger from that doc ships first, a card-hold charge should additionally write a ledger row (Section 8.6 note); v1 of card hold does not require the ledger.
- `Docs/PRD.md` §3.4 (phone booking deposit requests) and the existing deposit architecture are the UX baseline this feature extends.

---

## 1. Overview

### 1.1 Problem

Venues want no-show protection without charging guests money up front. Today the only options per service are `none`, `deposit` (fixed pence charged at booking), or `full_payment`. A deposit deters no-shows but adds friction and refund admin; many venues want the Fresha-style middle ground: **take no money now, keep a card on file, and charge a defined no-show fee only if the client fails to attend, at the venue's explicit discretion**.

### 1.2 Solution

A new deposit variant, **Card hold**:

- The venue enables deposits for a service as today, and chooses **Card hold** as the type, with a defined no-show fee (for example £25).
- The guest must enter card details to book. **£0 is taken.** The card is saved securely with Stripe against the venue's connected account.
- If the guest does not attend, staff mark the booking **No-Show** exactly as today. That unlocks an explicit **"Charge no-show fee"** action on the booking. Nothing is ever charged automatically.
- The charge is a merchant-initiated, off-session Stripe payment of up to the defined fee, on the venue's connected account (direct charge, no platform fee, matching the existing deposit flow).
- If the guest cancels (any time, any actor), the hold is released and can never be charged. Holds also auto-release 14 days after the appointment.

### 1.3 Design principles (hard requirements)

1. **Seamless with deposits.** Same settings surface, same booking-flow payment step, same staff booking-detail deposit block, same `deposit_status` state machine, same comms patterns. A venue that understands deposits should understand card holds with zero new concepts beyond "no money now, fee only if you charge it".
2. **Explicit charge only.** No automation ever moves money. The only path to a charge is a staff/admin clicking the charge action on a booking that is already marked No-Show.
3. **Webhook is source of truth** for money state (matches the existing deposit confirm/webhook split and the Tap to Pay principle).
4. **No em-dashes in any user-facing copy** (CLAUDE.md rule). All copy strings in this doc comply and must be used as written or adapted without introducing em-dashes.

---

## 2. Current state (verified against code, July 2026)

Facts the design builds on. File references are current as of writing; re-verify line numbers before editing.

### 2.1 Deposit configuration

- Appointments: `appointment_services.payment_requirement` (enum `class_payment_requirement`: `'none' | 'deposit' | 'full_payment'`) + `appointment_services.deposit_pence int` (migration `20260506120000_appointment_service_payment_requirement.sql`). Unified scheduling mirrors this on `service_items` (same migration). Per-variant override: `service_variants.deposit_pence` (`20260730120000_service_variants.sql`).
- Resolution: `src/lib/appointments/appointment-service-payment.ts`, notably `resolveAppointmentPaymentRequirement()` (falls back to `'deposit'` when legacy `deposit_pence > 0`), `resolveAppointmentServiceOnlineCharge()` (returns `{ amountPence, chargeLabel: 'deposit' | 'full_payment' }`), and `resolveAppointmentServiceOnlineChargeWithAddons()` (add-ons roll into `full_payment` only; a deposit stays base + variant).
- Settings UI: `src/components/dashboard/appointment-services/AppointmentServiceFormFields.tsx` plus `appointment-service-form-to-payload.ts` / `appointment-service-form-values.ts`.
- (Restaurant/table deposits are a separate per-person-GBP system in `booking_restrictions`; out of scope, Section 4.)

### 2.2 Deposit collection

- `POST /api/booking/create` (`src/app/api/booking/create/route.ts`): inserts booking rows with `status: 'Pending'`, `deposit_status: 'Pending'` when a charge is required, then creates a **customer-less PaymentIntent** on the connected account: `stripe.paymentIntents.create({ amount, currency: 'gbp', metadata: { booking_id, venue_id }, automatic_payment_methods: { enabled: true } }, { stripeAccount: venue.stripe_connected_account_id })` (around lines 530-538). PI id stored on `bookings.stripe_payment_intent_id`. If PI creation fails the booking row is deleted. If a deposit is required but the venue has no `stripe_connected_account_id`, the route 400s.
- Client: `src/components/booking/PaymentStep.tsx` caches `loadStripe(publishableKey, { stripeAccount })`, renders `<Elements clientSecret=...><PaymentElement/>`, calls `stripe.confirmPayment(...)`, then hits the confirm route. Used by `AppointmentBookingFlow.tsx` and the other model flows.
- Confirm: `POST /api/booking/confirm-payment` retrieves the PI on the connected account, requires `status === 'succeeded'`, then `confirmBookingsForSucceededPaymentIntent()` (`src/lib/booking/confirm-deposit-payment.ts`) flips matching `Pending` rows to `status: 'Booked'`, `deposit_status: 'Paid'` and assigns the manage-link token.
- Backup confirm: webhook `payment_intent.succeeded` (Section 2.5).

### 2.3 Booking and deposit state

- `booking_status` enum: `Pending, Booked, Confirmed, Seated, Completed, No-Show, Cancelled` (TS source of truth `BOOKING_STATUSES`, `src/lib/table-management/booking-status.ts:20-28`; `'Booked'` was added by standalone migration `20260626120000_booking_status_add_booked.sql` because `ALTER TYPE ... ADD VALUE` cannot run in a transaction that also uses the value).
- `deposit_status` enum: `'Not Required' | 'Pending' | 'Paid' | 'Refunded' | 'Forfeited' | 'Waived' | 'Failed'` (`20260301000001_create_enums.sql` + `20260312000002` + `20260524140000`). **`'Forfeited'` is written by exactly one path:** marking No-Show forfeits a `'Paid'` deposit (`src/app/api/venue/bookings/[id]/route.ts`, No-Show block around lines 868-970); the undo path restores `'Paid'` (around lines 1029-1035).
- No-show: first-class status. Grace gate `canMarkNoShowForSlot` (`booking-status.ts:117-134`) + server `validateNoShowGracePeriod` (`lifecycle.ts:233-246`, `venues.no_show_grace_minutes` default 15). `applyBookingLifecycleStatusEffects` increments/decrements `guests.no_show_count` (`lifecycle.ts:290-311`).
- Staff deposit actions: `POST /api/venue/bookings/[id]/deposit` with `action: 'send_payment_link' | 'waive' | 'record_cash' | 'refund'` (+ optional `amount_pence`). Surfaced in `src/components/booking/BookingDetailContent.tsx` (deposit pills and buttons around lines 591-640).
- Guest cancel: `POST /api/confirm` with `action: 'cancel'`; refund iff `now <= cancellation_deadline && deposit_status === 'Paid' && stripe_payment_intent_id` (route around lines 502-561). Late cancel keeps the deposit `'Paid'` and explains non-refundability.
- Staff cancel: `src/lib/booking/staff-cancel-booking.ts` (same refund predicate; refund failure blocks the cancel with `REFUND_FAILED`).

### 2.4 Saved-card machinery that already exists (but is not used by deposits)

- Per-venue Stripe Customers: table `venue_customer_stripe` (`user_id`, `venue_id`, `stripe_connected_account_id`, `stripe_customer_id`; migration `20260701120000_class_commerce_foundation.sql`), created by `ensureVenueStripeCustomerForUser()` (`src/lib/class-commerce/venue-stripe-customer.ts`).
- `POST /api/account/payment-methods/setup-intent` creates a `SetupIntent` with `usage: 'off_session'`, `payment_method_types: ['card']` on the connected account for that customer. `GET /api/account/payment-methods` lists cards; there is a delete route that detaches PMs.
- **No booking flow currently attaches a customer, uses `setup_future_usage`, or performs off-session confirmation.**

### 2.5 Webhook

`POST /api/webhooks/stripe` (`src/app/api/webhooks/stripe/route.ts`), signature-verified, idempotent via `claimStripeWebhookEvent` against `webhook_events`. Connected account read from `event.account`. Handles `payment_intent.succeeded` (branches on `metadata.reserve_ni_purpose` for class-commerce purposes, else treats it as a booking deposit and confirms), `payment_intent.payment_failed` (sets `'Failed'` on `Pending` rows), `charge.refunded` / `charge.refund.updated` (marks bookings on that PI `'Refunded'`), `account.updated`, subscription events.

### 2.6 Crons

- `auto-cancel-bookings`: cancels `source='phone' AND status='Pending' AND deposit_status='Pending'` after 24h; cancels abandoned online **class-cart** bookings after 30 min when the PI is definitively non-payable.
- `deposit-reminder-2h`: messaging only, same phone `Pending/Pending` predicate.
- `reconciliation`: 48h lookback over `deposit_status IN ('Paid','Refunded')` with a PI; writes `reconciliation_alerts` on divergence.

### 2.7 Reporting, events, flags

- `report_deposit_summary` RPC (`20260304000001_reconciliation_and_reporting.sql:219-238`): collected = `Paid + Forfeited`, refunded, forfeited buckets. `report_by_booking_model` counts `deposit_status='Paid'` only.
- `events` table: DB trigger logs `booking_created` / `booking_status_changed`; app code inserts custom rows (`auto_cancelled` etc). This feeds reporting.
- Feature flags: add key to `APPOINTMENTS_FEATURE_FLAG_KEYS` (`src/lib/feature-flags/types.ts:10-16`), zod key in `venueFeatureFlagsSchema`, env in `ENV_BY_FLAG` (`resolve.ts:9-15`); default off unless in `FLAG_DEFAULT_ON`. Route gating example: `assertAppointmentsFeatureEnabled('guest_self_reschedule', flags)` in `src/app/api/confirm/route.ts:804`.

---

## 3. Key design decisions (with rationale)

### D1. Stripe mechanism: SetupIntent now, off-session PaymentIntent later. NOT a manual-capture authorization.

Two candidate Stripe patterns:

| | Manual-capture PaymentIntent (auth at booking, capture on no-show) | SetupIntent (save card at booking, charge on no-show) |
|---|---|---|
| Money held on guest's card | Yes, whole time | No, £0 |
| Validity window | **Authorizations expire after about 7 days** (card-network limit) | Card stays chargeable indefinitely |
| Works for bookings weeks ahead | **No** | Yes |
| SCA handled | At auth | At save (off-session charges are merchant-initiated and normally exempt; declines possible, Section 8.5) |

Appointments are routinely booked more than 7 days out, so manual capture is not viable. **Decision: `SetupIntent` with `usage: 'off_session'` at booking; explicit off-session `PaymentIntent` at charge time.** This is also exactly what the user-facing promise says: "no payment taken up front".

### D2. A dedicated, booking-scoped Stripe Customer. NOT the guest's account wallet customer.

The saved PaymentMethod must be attached to a Stripe Customer to be charged off-session. The existing `venue_customer_stripe` customer is the guest's **self-serve wallet**: it is listed by `GET /api/account/payment-methods` and the guest can **detach** cards there at will. Attaching the hold card to it would (a) surprise guests with a card silently appearing in their wallet and (b) let a guest defeat the hold by deleting the card before no-showing.

**Decision: every card-hold "payment unit" creates a dedicated Stripe Customer on the connected account (metadata: `booking_id`, `venue_id`, `reserve_ni_purpose: 'card_hold'`).** It never appears in the guest wallet, cannot be self-detached, and can be deleted wholesale at release time (which detaches the card, satisfying data minimisation).

### D3. Charge is gated strictly on booking status = `No-Show`, staff-explicit, admin-only.

The user requirement is "charge if they fail to show up, explicitly by the venue after no show". Therefore:
- The charge action is enabled only when `status = 'No-Show'`, `deposit_status = 'Card Held'`, hold not released, and within the charge window.
- **Any cancellation (guest or staff, early or late) releases the hold.** In v1 a cancelled booking can never be charged. (Late-cancellation fees are a plausible future extension; Section 19.)
- Admin-only (money movement; consistent with admin-only destructive actions like experience-event cancel). Staff see the state but not the button.

### D4. State lives in the existing `deposit_status` enum plus one new 1:1 table.

- Two new `deposit_status` values: **`'Card Held'`** (card saved, nothing charged) and **`'Charged'`** (no-show fee captured). This keeps every existing surface (pills, crons, reports, reconciliation) on one state machine, and all existing predicates (`= 'Paid'`, `= 'Pending'`) are naturally false for card holds, which is the correct default behaviour everywhere (for example: the refund button, deposit forfeit-on-no-show, auto-cancel).
- Hold internals (Stripe ids, fee snapshot, consent snapshot, charge/release bookkeeping) live in a new **`booking_card_holds`** table, 1:1 with bookings, service-role only (RLS enabled, no policies), following the class-commerce ledger conventions. Bookings stays lean; the deposit columns keep their existing meanings (`deposit_amount_pence` stays NULL for card holds: no money was taken up front).

### D5. Configuration reuses the existing per-service payment requirement.

New `class_payment_requirement` enum value **`'card_hold'`**. When selected, the existing `deposit_pence` column holds the **no-show fee** (UI label switches accordingly). No new service columns, no second amount field to keep in sync, and the existing resolution pipeline (`appointment-service-payment.ts`, variant override, payload mappers) extends naturally. v1 offers the option only on appointment services and unified `service_items`; class/event/resource forms must not render it and their create paths must reject it (the enum is shared, so this is a UI + validation restriction, Section 6.4).

### D6. v1 is online-booking-flow only.

Phone/staff-created bookings keep today's deposit-request behaviour. Extending the pay-link page (`/pay`) to a "save your card" mode is a well-shaped fast-follow (Section 19), but v1 keeps the surface area down and avoids reworking the deposit-request comms templates.

---

## 4. Scope

### In scope (v1)

- Booking models: `practitioner_appointment` and `unified_scheduling` appointments, via the public online flows that hit `POST /api/booking/create` and `POST /api/booking/create-multi-service`, plus group appointments via `POST /api/booking/create-group`.
- Per-service configuration in the appointment service form (dashboard and anywhere else `AppointmentServiceFormFields` renders, including onboarding).
- Guest payment step in setup mode, confirm path, webhook backup path.
- Staff booking detail: hold visibility, charge action, refund of a charged fee.
- Guest manage page visibility and cancellation behaviour (cancel releases hold).
- Comms: confirmation email hold terms, charged-fee receipt email.
- Crons: abandoned-setup cleanup, hold auto-release, reconciliation awareness.
- Reporting: card-hold buckets in the deposit summary.
- Feature flag `card_hold_deposits`, default off.

### Out of scope (v1), with reasons

- **Table reservations** (separate per-person GBP deposit system; product focus is appointments).
- **Classes, events, resources** (shared enum gains the value, but no UI or create-path support; prevents scope explosion).
- **Phone/staff-created bookings and the `/pay` link page** (D6).
- **Automatic charging of any kind**, including late-cancel fees (D3).
- **Charging more than the disclosed fee.** Charge amount is clamped to the snapshot fee.
- **Mixed-requirement bundles taking both a payment and a hold.** Resolution precedence in Section 7.2. (A PaymentIntent with `setup_future_usage` could do both later; Section 19.)
- **Tap to Pay integration / `booking_payments` ledger** (independent; see header note).
- **Multi-currency.** `'gbp'` hardcoded, matching every existing deposit PI.

---

## 5. Data model

Three migrations. Follow house conventions: `IF NOT EXISTS` guards, `gen_random_uuid()`, pence integer checks, RLS enabled with no policies (service-role only), named unique indexes.

### 5.1 Migration A: enum values (standalone, no transaction with usage)

`ALTER TYPE ... ADD VALUE` cannot run in the same transaction that uses the value. Copy the structure of `supabase/migrations/20260626120000_booking_status_add_booked.sql`.

```sql
-- <timestamp>_card_hold_enums.sql
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'Card Held';
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'Charged';
ALTER TYPE class_payment_requirement ADD VALUE IF NOT EXISTS 'card_hold';
```

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
  stripe_customer_id text,             -- dedicated, booking-scoped customer (D2)
  stripe_setup_intent_id text,
  stripe_payment_method_id text,       -- set at confirm time from the succeeded SetupIntent
  fee_pence int NOT NULL CHECK (fee_pence > 0),   -- max chargeable, snapshotted at booking
  currency text NOT NULL DEFAULT 'gbp',
  -- Consent snapshot shown to the guest at save time (dispute evidence):
  -- { "text": "...", "version": 1, "accepted_at": "<iso>" }
  terms_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  charge_payment_intent_id text,       -- off-session PI, set when a charge is attempted
  charged_pence int CHECK (charged_pence IS NULL OR charged_pence > 0),
  charged_at timestamptz,
  charged_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  charge_failure_code text,            -- last failure: 'card_declined', 'authentication_required', ...
  charge_failure_at timestamptz,
  released_at timestamptz,
  release_reason text,                 -- 'cancelled' | 'expired' | 'refunded' | 'admin'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_card_holds_booking_uq
  ON public.booking_card_holds (booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS booking_card_holds_charge_pi_uq
  ON public.booking_card_holds (charge_payment_intent_id)
  WHERE charge_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_venue
  ON public.booking_card_holds (venue_id, created_at DESC);
-- Release cron scans open holds:
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_open
  ON public.booking_card_holds (venue_id) WHERE released_at IS NULL;

ALTER TABLE public.booking_card_holds ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only
```

Group/multi-service note: **each booking row gets its own hold row** with its own per-service fee, but sibling rows share the same `stripe_customer_id` / `stripe_setup_intent_id` / `stripe_payment_method_id` (one card saved once). This lets staff charge exactly the no-showed attendee(s) of a group.

### 5.3 Migration C: reporting RPC update

Extend `report_deposit_summary` (defined in `20260304000001_reconciliation_and_reporting.sql:219-238`) via a new migration that `CREATE OR REPLACE`s it, adding:

```sql
-- additional returned columns
no_show_fees_charged_pence bigint,  -- SUM(bch.charged_pence) over bookings with deposit_status = 'Charged'
no_show_fees_charged_count bigint,
card_holds_active_count    bigint   -- deposit_status = 'Card Held' AND bch.released_at IS NULL
```

Join `booking_card_holds` on `booking_id`. Do **not** fold charged fees into `total_collected_pence` (that bucket means "deposits taken up front"); the reports UI shows the new columns separately (Section 13). Keep the existing function signature backwards-compatible if the reports route destructures by name (verify at implementation time; the route is `src/app/api/venue/reports/route.ts`).

Also update `Docs/schema.sql` (the curated inventory): add `booking_card_holds` under a "Deposits and card holds" note and the two enum value additions.

---

## 6. Configuration and settings

### 6.1 Feature flag

- Key: `card_hold_deposits`. Add to `APPOINTMENTS_FEATURE_FLAG_KEYS` (`src/lib/feature-flags/types.ts`), `venueFeatureFlagsSchema` (`card_hold_deposits: z.boolean().optional()`), `ENV_BY_FLAG` (`card_hold_deposits: 'FEATURE_FLAG_CARD_HOLD_DEPOSITS'`, `resolve.ts`). **Not** in `FLAG_DEFAULT_ON` (defaults off).
- Surface in the dashboard flag section (`src/app/dashboard/settings/sections/FeatureFlagsSection.tsx`) and super admin (`src/app/super/flags/FlagsPageClient.tsx`) following how the last flag (`compliance_records_enabled`) was added.
- Update `Docs/FEATURE_FLAGS.md` (new row; note default off).

### 6.2 Service form (venue-facing)

File: `src/components/dashboard/appointment-services/AppointmentServiceFormFields.tsx` (+ `appointment-service-form-values.ts`, `appointment-service-form-to-payload.ts`).

The existing payment requirement selector (`none` / `deposit` / `full_payment`) gains a fourth option, rendered only when the `card_hold_deposits` flag resolves on for the venue:

- Option label: **"Card hold"**
- Helper text: `"No payment is taken when the client books. Their card is stored securely and you can charge a no-show fee if they do not attend."`
- When selected, the existing amount field relabels from "Deposit (£)" to **"No-show fee (£)"** and continues to write `deposit_pence`. Validation: required, min £1, max £150 (mirror the deposit bounds used by the form; verify current bounds at implementation).
- The per-variant `deposit_pence` override keeps working and is relabelled the same way in variant rows when the service is `card_hold`.

Persisting API: the appointment-services routes validate `payment_requirement` against a zod union; extend the union with `'card_hold'` and **gate acceptance on the flag** (if flag off, reject `'card_hold'` with 400 `{ code: 'feature_disabled', feature: 'card_hold_deposits' }` using the existing `featureFlagDisabledResponse` helper in `src/lib/feature-flags/http.ts`). Do the same for the `service_items` write path (unified scheduling service editor).

### 6.3 Resolution logic

`src/lib/appointments/appointment-service-payment.ts`:

- `resolveAppointmentPaymentRequirement()`: `'card_hold'` must be **explicit** (never inferred from legacy `deposit_pence > 0`; that inference stays `'deposit'`).
- `resolveAppointmentServiceOnlineCharge()` / `...WithAddons()`: extend the return type to `chargeLabel: 'deposit' | 'full_payment' | 'card_hold'`. For `card_hold`, `amountPence` = the fee (base `deposit_pence`, variant override respected), and **add-ons never roll in** (same rule as deposit).
- **Flag-off safety:** if a service row carries `payment_requirement = 'card_hold'` but the venue flag resolves off (flag later disabled), resolve as `'none'` and `console.warn` once per resolution (`[card-hold] service <id> configured but flag off; treating as none`). Rationale: silently charging a deposit instead would take money the guest was never shown; taking nothing is the safe degradation. The settings UI shows a warning banner on such services ("Card hold is disabled for this venue; this service currently takes no deposit.").

### 6.4 Guarding other models

The enum value is visible to every `class_payment_requirement` column. v1 requires:
- Class type / event ticket / resource editors do not render the option (no UI change needed if they use their own hardcoded option lists; verify).
- The class/event/resource booking create paths defensively reject `'card_hold'` config with a 400 (`unsupported payment requirement`) rather than treating it as `'none'`, so a misconfiguration is loud. Add one shared helper `assertCardHoldSupportedForModel(bookingModel)` in `appointment-service-payment.ts` used by the create routes.

---

## 7. Public booking flow

### 7.1 Decision and creation (`POST /api/booking/create`)

In `handleNonTableBooking`, where the online charge is resolved today (appointment branch around line 1066; unified `service_items` branch around lines 836-858):

1. Resolve the charge as today. If `chargeLabel === 'card_hold'` **and** the `card_hold_deposits` flag resolves on:
   - Require `venue.stripe_connected_account_id` (same 400 as deposits: "This venue cannot take card details online right now").
   - Insert the booking row(s) exactly like a deposit booking: `status: 'Pending'`, `deposit_status: 'Pending'`, but **leave `deposit_amount_pence` NULL** and **do not set `stripe_payment_intent_id`**.
   - Create the dedicated Stripe Customer (D2) on the connected account:
     ```ts
     const customer = await stripe.customers.create(
       {
         email: guestEmail || undefined,
         name: guestName || undefined,
         metadata: {
           reserve_ni_purpose: 'card_hold',
           booking_id: bookingId,            // lead booking id for bundles
           venue_id: venueId,
         },
       },
       { stripeAccount: venue.stripe_connected_account_id },
     );
     ```
   - Create the SetupIntent:
     ```ts
     const si = await stripe.setupIntents.create(
       {
         customer: customer.id,
         usage: 'off_session',
         payment_method_types: ['card'],
         metadata: {
           reserve_ni_purpose: 'card_hold_setup',
           booking_id: bookingId,            // lead booking id
           venue_id: venueId,
         },
       },
       { stripeAccount: venue.stripe_connected_account_id },
     );
     ```
   - Insert one `booking_card_holds` row **per booking row** (Section 5.2), all sharing `stripe_customer_id` and `stripe_setup_intent_id`, each with its own `fee_pence` (that row's service fee, variant-adjusted) and the `terms_snapshot` (Section 7.4).
   - On any Stripe failure, delete the booking row(s) and the customer (mirror the existing PI-failure cleanup at line ~550).
2. Response contract (extends the existing shape):
   ```ts
   {
     ...existing fields,
     requires_deposit: true,            // unchanged: tells the client to show the payment step
     payment_mode: 'setup',             // NEW: 'payment' (default, existing) | 'setup'
     client_secret: si.client_secret,   // a seti_..._secret_... value in setup mode
     stripe_account_id: venue.stripe_connected_account_id,
     card_hold_fee_pence: totalFeePence,  // NEW: sum across the unit, for copy
   }
   ```
   Existing deposit/full-payment responses add `payment_mode: 'payment'` so the client branch is explicit.

`POST /api/booking/create-multi-service` and `POST /api/booking/create-group` follow the same pattern. **Mixed bundles** (Section 4): resolve the unit-level requirement by precedence `full_payment > deposit > card_hold > none`; card hold engages only when it is the strongest requirement in the bundle. When a money requirement wins, card-hold services in the bundle contribute nothing extra (v1).

### 7.2 Payment step (client)

`src/components/booking/PaymentStep.tsx` gains a mode:

```ts
type PaymentStepProps = {
  // existing props...
  mode?: 'payment' | 'setup';        // default 'payment'
  cardHoldFeePence?: number;         // required in setup mode
  venueName?: string;                // for consent copy
};
```

- `Elements` accepts a SetupIntent `clientSecret` unchanged; the confirm call branches: `mode === 'setup' ? stripe.confirmSetup({...}) : stripe.confirmPayment({...})`.
- On success, call the confirm route with `setup_intent_id` instead of `payment_intent_id` (Section 7.3).
- Copy in setup mode (exact strings; note title case and no em-dashes):
  - Heading: `Secure your booking`
  - Sub-heading: `No payment is taken today.`
  - Body: `Your card details are stored securely by our payment provider, Stripe. {venueName} may charge a no-show fee of up to {fee} if you miss your appointment.`
  - Consent line, rendered directly above the submit button (this is the disclosure Stripe expects for merchant-initiated charges, and the string is snapshotted; Section 7.4): `By saving your card you authorise {venueName} to charge up to {fee} if you do not attend this appointment. If you cancel the booking before the appointment, nothing will be charged.`
  - Submit button: `Save card and book`
- The flows that render `PaymentStep` (`AppointmentBookingFlow.tsx` and the unified flow path) pass the new props through from the create response. The step already only renders when `requires_deposit` is true; no flow-structure change.
- Confirmation screen (post-book) in setup mode: `Card saved. No payment has been taken.` alongside the normal confirmation content.

### 7.3 Confirm path (`POST /api/booking/confirm-payment`)

Extend the request schema: exactly one of `payment_intent_id` (existing) or `setup_intent_id` (new). Setup branch:

1. Retrieve the SetupIntent on the connected account; require `status === 'succeeded'`; extract `payment_method` id.
2. Find the `booking_card_holds` rows by `stripe_setup_intent_id` and their bookings with `status = 'Pending'` in this venue (mirror `confirmBookingsForSucceededPaymentIntent`'s matching and idempotency: already-confirmed rows return `alreadyConfirmed`).
3. Update holds: `stripe_payment_method_id`. Update bookings: `status: 'Booked'`, `deposit_status: 'Card Held'`, assign `confirm_token_hash` manage token exactly as the deposit path does.
4. Insert an `events` row per booking: `event_type: 'card_hold_saved'`, payload `{ booking_id, fee_pence }`.
5. Send booking confirmation comms (Section 11).

Implement as a sibling function `confirmBookingsForSucceededSetupIntent()` in `src/lib/booking/confirm-deposit-payment.ts` so both the route and the webhook share it.

### 7.4 Consent snapshot

`terms_snapshot` is written at create time with the exact consent string that will be displayed (server-rendered from the same template constant the client uses; export the template from a shared module `src/lib/booking/card-hold-terms.ts` so client copy and snapshot cannot drift):

```json
{ "version": 1, "text": "By saving your card you authorise {venue} to charge up to £25.00 if you do not attend this appointment. If you cancel the booking before the appointment, nothing will be charged.", "fee_pence": 2500, "accepted_at": null }
```

`accepted_at` is stamped in the confirm path (card successfully saved = consent acted on). This is the venue's dispute evidence package together with the booking record.

### 7.5 Public catalog surfacing

Wherever the public appointment catalog exposes deposit info per service today (check `GET /api/booking/appointment-catalog` and the service cards in the appointment flow), card-hold services surface: `payment_requirement: 'card_hold'` and the fee, so the service list can show a short line: `No-show fee of {fee} applies. No payment taken at booking.` If the catalog does not currently expose deposit info, add the two fields for card-hold services only (needed so guests are not surprised at the payment step).

---

## 8. Stripe integration detail

### 8.1 Objects and account

Everything on the venue's connected account via `{ stripeAccount: venue.stripe_connected_account_id }` (direct charges; no `application_fee_amount`, matching deposits). Statement descriptor is the venue's own (a benefit of direct charges for dispute recognition).

### 8.2 Purpose constants

Add to the existing purpose-constant module used by the webhook branches (`RESERVE_NI_PI_PURPOSE` in `src/types/class-commerce.ts`, or its successor if relocated):

```ts
CARD_HOLD_SETUP: 'card_hold_setup',            // SetupIntent metadata
CARD_HOLD_NO_SHOW_FEE: 'card_hold_no_show_fee' // charge PI metadata
```

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
    idempotencyKey: `card-hold-charge-${hold.id}`,   // one charge per hold, double-click safe
  },
);
```

The idempotency key is scoped to the hold id (not the request), so a retried click can never create a second charge. A **partial-then-full** charge is intentionally impossible in v1 (one charge per hold).

### 8.4 SCA / MIT compliance

- The SetupIntent performs SCA (3DS) at save time when the issuer requires it; `PaymentElement` handles the challenge inline in the booking flow.
- The later charge is a **merchant-initiated transaction (MIT)**: `off_session: true` tells Stripe to apply the MIT exemption using the SetupIntent's authentication as the mandate basis.
- The consent text (7.4) plus explicit save action is the mandate evidence. This mirrors the standard Stripe "charge for no-shows" integration pattern.

### 8.5 Charge failure handling

`stripe.paymentIntents.create` with `confirm: true` throws `StripeCardError` on decline. Handle:

| Error `code` | Meaning | v1 behaviour |
|---|---|---|
| `card_declined`, `expired_card`, `insufficient_funds`, etc | Issuer refused | Record `charge_failure_code` + `charge_failure_at` on the hold; keep `deposit_status = 'Card Held'`; insert `events` row `card_hold_charge_failed`; return 402 with a plain message: `The card was declined ({reason}). You can try again, or contact the client to arrange payment.` Retry allowed (new attempt updates the same hold; the idempotency key gains a `-retry-{n}` suffix derived from a persisted attempt counter, or simpler: append `charge_failure_at` epoch; implementer picks one and keeps it deterministic per attempt). |
| `authentication_required` | Issuer demands 3DS; impossible off-session | Same recording, message: `The card issuer requires the client to authorise this payment in person. Off-session charging is not possible for this card.` v1 offers no on-session fallback (Section 19 covers the fee-payment-link fast-follow). Cancel the stray `requires_action` PI (`stripe.paymentIntents.cancel`) so it does not linger. |

Never mutate `deposit_status` on failure. The hold remains chargeable until released/expired.

### 8.6 Webhook changes (`src/app/api/webhooks/stripe/route.ts`)

Order matters: the purpose branch must run **before** the generic `metadata.booking_id` deposit-confirm path, otherwise a fee PI would be misread as a deposit payment and wrongly flip statuses.

1. **`payment_intent.succeeded`** with `metadata.reserve_ni_purpose === 'card_hold_no_show_fee'`: source-of-truth completion. Find the hold by `charge_payment_intent_id` (or by `metadata.booking_id` if the row has no PI id yet, then set it). Set hold `charged_pence` (from `pi.amount_received`), `charged_at`; set booking `deposit_status: 'Charged'`; insert `events` row `card_hold_charged`; send the receipt email (Section 11) in `after()`. Idempotent: skip if already `'Charged'`.
2. **`payment_intent.payment_failed`** with the same purpose: record failure fields on the hold (as 8.5) if not already recorded; do not touch booking status. (The existing generic failure path only touches `deposit_status = 'Pending'` rows, so card holds are naturally excluded; the explicit branch is for bookkeeping and staff push notification `'payment_failed'` reuse.)
3. **`setup_intent.succeeded`** (new event type): backup confirm path; call `confirmBookingsForSucceededSetupIntent()` (7.3). Add the event to the webhook endpoint's enabled events (deployment checklist, Section 16).
4. **`setup_intent.setup_failed`** (new event type): informational log only in v1 (the client surface handles inline failure; abandoned rows are cleaned by cron, Section 12.1).
5. **`charge.refunded` / `charge.refund.updated`**: the existing handler looks up bookings by `bookings.stripe_payment_intent_id` and will miss fee PIs (stored on the hold). Add a purpose-aware branch: if the PI's metadata purpose is `card_hold_no_show_fee`, set booking `deposit_status: 'Refunded'`, stamp hold `released_at` (reason `'refunded'`), insert `events` row `card_hold_charge_refunded`. Idempotent on already-`'Refunded'`.

The charge endpoint (Section 9.2) also optimistically applies the success state when the synchronous confirm returns `succeeded` (same pattern as `/api/booking/confirm-payment` vs the webhook: either may land first; both are idempotent).

---

## 9. Staff surfaces

### 9.1 Booking detail display

`src/components/booking/BookingDetailContent.tsx` deposit block (pills around lines 591-602, actions from line 607):

| State | Pill | Detail line |
|---|---|---|
| `deposit_status = 'Card Held'`, not released | `Card held` (teal/info variant) | `No-show fee up to {fee}. No payment taken.` |
| `'Card Held'`, released (`released_at` set) | `Card hold ended` (neutral) | `The card hold was released on {date}.` |
| `'Charged'` | `No-show fee charged` (amber) | `{amount} charged on {date}.` |
| `'Refunded'` (was `'Charged'`) | `No-show fee refunded` (existing refunded styling) | `{amount} refunded.` |
| last charge attempt failed | keep `Card held` pill | append: `Last charge attempt failed: {plain reason}.` |

Data comes from `GET /api/venue/bookings/[id]` (extend the GET around lines 132-302 to include a `card_hold` object: `{ fee_pence, charged_pence, charged_at, released_at, charge_failure_code, charge_window_ends_at }`; null when no hold row).

Existing deposit action buttons must not appear for hold states: they are gated on `deposit_status` values (`'Pending'`, `'Paid'`) that card holds never occupy; verify each gate rather than assuming.

### 9.2 Charge action

**API:** extend `POST /api/venue/bookings/[id]/deposit` (`src/app/api/venue/bookings/[id]/deposit/route.ts`):

```ts
// zod: action gains 'charge_no_show_fee'; amount_pence optional
{ action: 'charge_no_show_fee', amount_pence?: number }
```

Guards, in order, each with a distinct 4xx `{ code }`. Note there is deliberately **no feature-flag guard here**: the flag gates the creation of new holds (config acceptance and booking-flow branch), never the servicing of holds that already exist with guest consent (see the normative rule at the end of Section 14).
1. Admin session (`requireAdmin` from `src/lib/venue-auth.ts`): 403 `admin_only`.
2. Hold row exists: 404 `no_card_hold`.
3. `booking.status === 'No-Show'`: 409 `not_no_show` (message: `Mark the booking as a no-show before charging the fee.`).
4. `deposit_status === 'Card Held'`: 409 `invalid_state` (already charged/refunded).
5. `released_at IS NULL` and now within charge window (Section 12.2): 409 `hold_released` / `hold_expired`.
6. `stripe_payment_method_id` present: 409 `no_saved_card`.
7. `amount_pence` (default `fee_pence`) clamped to `[1, fee_pence]`: 400 `invalid_amount` if above.

Then: create the PI (8.3); on synchronous success set hold + booking state as in 8.6.1 (idempotent with the webhook); `logBookingOp` structured line (`operation: 'card_hold_charge'`); insert the `events` row; if the write is cross-venue (linked accounts), call `recordBookingWriteAudit` with `action_type: 'edited_booking'` and before/after deposit states. Response: `200 { ok: true, charged_pence, payment_intent_id }` or `402 { code, message }` per 8.5.

**UI:** in the deposit actions block, when the client-side mirror of guards 3-7 passes and the viewer is admin, render a destructive-styled button `Charge no-show fee`. Clicking opens the existing confirm-dialog pattern (the same one destructive status changes use):
- Title: `Charge no-show fee`
- Body: `Charge {guestName}'s saved card for missing this appointment. The maximum you can charge is {fee}.`
- Amount input, pre-filled with the full fee, validated to at most the fee.
- Confirm button: `Charge {amount}` (updates live with the input).
- On 402, show the API's plain-language message inline.

The button must also appear in the compact surfaces that reuse `BookingDetailContent` (panel, expanded row, appointment sheet) automatically, since they share the deposit block.

### 9.3 Refunding a charged fee

Extend the existing `refund` action: when `deposit_status === 'Charged'`, refund against `charge_payment_intent_id` instead of `stripe_payment_intent_id` (`stripe.refunds.create({ payment_intent: hold.charge_payment_intent_id }, { stripeAccount })`). On success (or via the webhook branch 8.6.5): booking `deposit_status: 'Refunded'`, hold `released_at = now()`, `release_reason: 'refunded'`. UI: the existing `Refund deposit` button relabels to `Refund no-show fee` when the state is `'Charged'`. Admin-only, same as charging.

### 9.4 No-Show interplay (`PATCH /api/venue/bookings/[id]`)

- Marking No-Show: the existing forfeit branch (`deposit_status === 'Paid'` -> `'Forfeited'`, around lines 883-884) is untouched; card holds are not `'Paid'` so nothing money-related happens. **Do not auto-charge.** The no-show guest email (`no_show_notification`, lines ~906-942) gains no charge language at this point (nothing has been charged); if the venue later charges, the receipt email covers it.
- Undo No-Show (`No-Show -> Booked/Confirmed`): if `deposit_status === 'Card Held'`, nothing to restore (hold intact). If `'Charged'`, leave as `'Charged'`; the undo succeeds and the UI keeps showing the charged pill with the refund action available. Do not silently refund on undo (explicit money movement only, D3).
- Cancellation (staff cancel in `staff-cancel-booking.ts` and the PATCH cancel branch): after a successful cancel of a booking with an open hold, release it: `released_at = now()`, `release_reason: 'cancelled'`, insert `events` row `card_hold_released`, and (best-effort, non-blocking) delete the booking-scoped Stripe customer (Section 12.2). The refund-eligibility logic is untouched (holds are never `'Paid'`).

---

## 10. Guest surfaces

### 10.1 Manage page (`/manage/[bookingId]/[token]`, `ManageBookingView.tsx`)

- `GET /api/confirm` response gains the hold summary (fee, charged state) for the booking.
- Display, when `deposit_status = 'Card Held'` and not released: an info line in the booking summary: `Your card is securely on file. {venueName} may charge a no-show fee of up to {fee} if you miss this appointment. Cancel before your appointment to avoid any charge.`
- When `'Charged'`: `A no-show fee of {amount} was charged for this booking on {date}.`
- Cancel behaviour: unchanged UI. The cancel path (`POST /api/confirm`, cancel branch) releases the hold exactly like the staff cancel (9.4). Because holds are never `'Paid'`, the refund machinery is naturally skipped; ensure the late-cancel copy branch (route lines ~650-651) is not triggered for holds (it is keyed on paid deposits; verify) and instead the success message for a card-hold booking says: `Your booking is cancelled. Your card will not be charged and the card hold has been released.`
- Reschedule/modify: the hold carries over untouched (same card, same fee snapshot). The modify path re-computes `cancellation_deadline` as today; no hold changes. If a modify changes the service to one with a different card-hold fee, **keep the original snapshot** (the guest consented to that amount); note this in the modify code comment.

### 10.2 Emails and SMS

Templates live in `src/lib/emails/templates/`, senders in `src/lib/communications/send-templated.ts`, comm-log message types are constrained by migration (see `20260402000000_deposit_request_email_and_comm_logs_types.sql` for the mechanism; add new types the same way).

1. **Booking confirmation** (existing template): when the booking has an open hold, append a short section:
   - `No payment has been taken. Your card is securely on file and {venueName} may charge a no-show fee of up to {fee} if you do not attend. Cancel before your appointment to avoid any charge.`
2. **No-show fee receipt** (new): `card-hold-charged.ts`, comm-log type `card_hold_charged_email`. Sent from the webhook/charge success path.
   - Subject: `No-show fee charged: {venueName}`
   - Body core: `You missed your appointment at {venueName} on {date} at {time}. As set out when you booked, a no-show fee of {amount} has been charged to your saved card. If you think this is a mistake, please contact {venueName} directly.` Include venue contact block (reuse the standard footer partial).
3. **No SMS in v1** for the receipt (email only; SMS allowance is billed and the email is the receipt of record). The confirmation SMS, if the venue has SMS confirmations on, keeps its existing copy (it links to the manage page where hold terms are shown).

All copy: second person, plain, no em-dashes.

---

## 11. Events, audit, observability

- `events` rows (manual inserts, following the `auto_cancelled` precedent): `card_hold_saved`, `card_hold_charged`, `card_hold_charge_failed`, `card_hold_charge_refunded`, `card_hold_released`. Payloads carry `{ booking_id, fee_pence | charged_pence | failure_code | release_reason }`. These appear in the booking detail timeline automatically.
- `logBookingOp` (`src/lib/observability/booking-ops-log.ts`): new operations `card_hold_charge` and `card_hold_charge_failed` alongside the existing `cancel` / `refund_failed`.
- Cross-venue writes: `recordBookingWriteAudit` with `action_type: 'edited_booking'` (9.2).

---

## 12. Crons

### 12.1 Abandoned setup cleanup (extend `auto-cancel-bookings`)

The class-cart sweep pattern (online, `Pending/Pending`, older than 30 min, Stripe object definitively non-payable) gains a card-hold arm: select bookings joined to `booking_card_holds` where `status='Pending' AND deposit_status='Pending' AND source='online'` and created more than 30 minutes ago; retrieve the SetupIntent; if its status is `requires_payment_method` or `canceled`, cancel the booking (`status:'Cancelled'`, `deposit_status:'Failed'`, `cancellation_actor_type:'system'`, `events` row `auto_cancelled` with `reason:'card_hold_setup_abandoned'`), release the hold (`release_reason:'expired'`), and delete the Stripe customer. SetupIntents in `requires_action`/`processing` are left for the next sweep.

The phone 24h sweep and `deposit-reminder-2h` key on `source='phone'` and are unaffected (card hold is online-only in v1).

### 12.2 Hold release (new cron `/api/cron/release-card-holds`)

- Route: `src/app/api/cron/release-card-holds/route.ts`, `GET`/`POST`, `requireCronAuthorisation()` (`src/lib/cron-auth.ts`), registered in `vercel.json` daily at `30 5 * * *` (offset from the existing 05:00/05:15 deletes). Document in `Docs/DEVELOPMENT.md` alongside the other cron notes.
- Charge window constant: `CARD_HOLD_CHARGE_WINDOW_DAYS = 14` in `src/lib/booking/card-hold-terms.ts`. `charge_window_ends_at` = appointment end + 14 days (computed, not stored; the GET in 9.1 derives it).
- Sweep: holds with `released_at IS NULL` whose booking's appointment ended more than 14 days ago (any status, including No-Show that the venue chose not to charge, and Completed). For each: `released_at = now()`, `release_reason: 'expired'`, `events` row `card_hold_released`, best-effort `stripe.customers.del(hold.stripe_customer_id, { stripeAccount })` (deleting the customer detaches the card: data minimisation). Stripe deletion failure logs and continues; the row is still marked released (the charge guard keys on `released_at`, so an undeleted customer is a cleanup miss, not a security hole).
- Immediate release also happens inline on cancel (9.4, 10.1) and refund (9.3); the cron is the backstop and the expiry path.

### 12.3 Reconciliation (extend `/api/cron/reconciliation`)

Current query covers `deposit_status IN ('Paid','Refunded')` with a PI. Add:
- `'Card Held'` (not released): retrieve the SetupIntent; alert if not `succeeded` or if `stripe_payment_method_id` no longer attached (`expected_status: 'Card Held'`, `actual_stripe_status: si.status`).
- `'Charged'`: retrieve `charge_payment_intent_id`; alert if not `succeeded`.
The `reconciliation_alerts` row shape (`booking_id, expected_status, actual_stripe_status`) is reused unchanged.

---

## 13. Reporting

- RPC change in Section 5.3.
- `src/app/api/venue/reports/route.ts`: pass through the three new columns in `report4_deposit`.
- Reports UI (`src/app/dashboard/reports/ReportsView.tsx`, deposit section): add two stat lines under the existing deposit tiles: `No-show fees charged: {amount} ({count})` and `Active card holds: {count}`. Keep charged fees visually separate from deposits collected (different money semantics).
- `report_by_booking_model` (`deposit_pence_collected` counts `'Paid'` only) is intentionally unchanged in v1; card-hold revenue is venue-level in the deposit summary. Note this in the reports section code comment.

---

## 14. State machine summary

`deposit_status` transitions introduced (all others unchanged):

```
Pending ──(SetupIntent succeeded: confirm route or webhook)──▶ Card Held
Pending ──(setup abandoned: cron)─────────────────────────────▶ Failed
Card Held ──(admin charge succeeds, status must be No-Show)──▶ Charged
Card Held ──(cancel / expiry / admin release)────────────────▶ Card Held + released_at   (terminal)
Charged ──(admin refund or Stripe refund webhook)────────────▶ Refunded (+ released_at)  (terminal)
```

Booking `status` machine is completely unchanged. Charge eligibility = `status = 'No-Show' AND deposit_status = 'Card Held' AND released_at IS NULL AND now() <= charge_window_ends_at`.

Edge-case matrix:

| Scenario | Behaviour |
|---|---|
| Guest abandons at card step | Booking stays `Pending/Pending`; 30-min cron cancels + releases (12.1) |
| Guest cancels early or late | Cancel proceeds; hold released; no charge ever possible (D3) |
| Staff cancels | Same as guest cancel |
| Guest reschedules | Hold carries over, fee snapshot unchanged (10.1) |
| No-show, venue charges full fee | `Charged`; receipt email |
| No-show, venue charges partial | Allowed (clamp `[1, fee]`); remainder is forgone (one charge per hold) |
| No-show, venue does nothing | Hold expires 14 days after appointment; card detached |
| Charge declined | Hold stays chargeable; staff may retry within window (8.5) |
| Card requires 3DS off-session | Charge impossible; surfaced plainly; hold remains until expiry (8.5) |
| Undo No-Show after charge | Status reverts; money state untouched; refund is explicit (9.4) |
| Charged then disputed | Stripe dispute on venue's connected account; evidence = terms_snapshot + booking record + no-show event trail (Section 15) |
| Flag disabled after holds exist | Existing holds remain chargeable, refundable, and releasable; only the creation of new holds stops (normative rule below) |
| Venue disconnects Stripe | Charge fails at Stripe; connected account id was snapshotted on the hold so refunds/cleanup still route correctly |
| Group booking, one attendee no-shows | That booking row alone is marked No-Show and charged its own fee (5.2) |

Normative flag rule: **`card_hold_deposits` gates creation of new holds (config acceptance and the booking-flow branch). It does not gate charging, refunding, or releasing holds that already exist.** A guest who consented to a hold keeps exactly the deal they were shown, and the venue keeps the protection they were promised, regardless of later flag changes.

---

## 15. Security, compliance, privacy

- **PCI:** card data never touches ResNeo servers (Stripe Elements + SetupIntent, same posture as deposits).
- **SCA/MIT:** Section 8.4. Consent text + snapshot is the mandate record.
- **Authorization:** charging and refunding are admin-only server-side (`requireAdmin`); staff visibility only. All Stripe mutations service-role; `booking_card_holds` has no RLS policies (service-role only), matching the ledger convention.
- **Disputes:** no-show fees carry elevated dispute risk. Evidence pack per charge: `terms_snapshot` (exact consent text and fee), booking record (service, date/time), `events` trail (`booking_created`, `card_hold_saved` with timestamp, `booking_status_changed` to No-Show, `card_hold_charged`). v1 provides no automated dispute-evidence submission; the data is queryable.
- **GDPR/data minimisation:** the saved card is held only as long as it can be charged; release deletes the booking-scoped Stripe customer (detaching the PM). Stripe ids remain on the hold row for audit. Account deletion flows: the existing `account-hard-delete` cron anonymises guests; card-hold rows reference bookings (cascade) and contain no PII beyond Stripe ids.
- **Abuse guard:** amount clamped server-side to the consented fee; one charge per hold via unique idempotency key + `'Charged'` state check.

---

## 16. Implementation plan (phased, with file-by-file checklist)

Recommended sequence; each phase leaves the app shippable with the flag off.

### Phase 0: foundations
1. Migration A (enums), Migration B (`booking_card_holds`). Files: two new `supabase/migrations/*.sql` (Section 5).
2. `src/lib/booking/card-hold-terms.ts` (new): consent template + `CARD_HOLD_CHARGE_WINDOW_DAYS` + fee formatting helper.
3. Feature flag plumbing: `src/lib/feature-flags/types.ts`, `resolve.ts`; dashboard + super flag UIs; `Docs/FEATURE_FLAGS.md`.
4. Purpose constants (8.2).
5. Type updates: `deposit_status` unions in `src/types/**` (grep `'Forfeited'` to find every union/label map), display label maps in UI helpers.

### Phase 1: configuration
6. `src/lib/appointments/appointment-service-payment.ts`: `'card_hold'` in requirement + charge label resolution, flag-off degradation, `assertCardHoldSupportedForModel`.
7. Service form: `AppointmentServiceFormFields.tsx`, `appointment-service-form-values.ts`, `appointment-service-form-to-payload.ts`; zod unions + flag gate in the appointment-services API routes and the `service_items` write path.
8. Guard rails in class/event/resource create paths (6.4).

### Phase 2: booking flow
9. `POST /api/booking/create`: card-hold branch (7.1). Then `create-multi-service`, `create-group` with the bundle precedence rule.
10. `PaymentStep.tsx` setup mode + flow prop threading (`AppointmentBookingFlow.tsx`, unified path) + confirmation screen copy (7.2).
11. `confirm-deposit-payment.ts`: `confirmBookingsForSucceededSetupIntent()`; `POST /api/booking/confirm-payment` schema + branch (7.3).
12. Webhook: `setup_intent.succeeded` / `setup_intent.setup_failed` branches; enable the event types on the Stripe webhook endpoint (deployment note).
13. Public catalog surfacing (7.5).

### Phase 3: staff charge + guest visibility
14. `GET /api/venue/bookings/[id]`: `card_hold` object (9.1).
15. `POST /api/venue/bookings/[id]/deposit`: `charge_no_show_fee` action + guards + refund extension (9.2, 9.3).
16. Webhook: `payment_intent.succeeded` / `payment_failed` / `charge.refunded` purpose branches, ordered before the generic deposit path (8.6).
17. `BookingDetailContent.tsx`: pills, detail lines, charge button + dialog, refund relabel (9.1, 9.2).
18. Cancel paths release the hold: PATCH cancel branch, `staff-cancel-booking.ts`, `POST /api/confirm` cancel (9.4, 10.1).
19. `GET /api/confirm` + `ManageBookingView.tsx` guest copy (10.1).
20. Emails: confirmation section + `card-hold-charged.ts` template + comm-log type migration entry + sender in `send-templated.ts` (10.2).
21. Events + `logBookingOp` + cross-venue audit (11).

### Phase 4: lifecycle hygiene
22. `auto-cancel-bookings` card-hold sweep (12.1).
23. New cron `release-card-holds` + `vercel.json` + `Docs/DEVELOPMENT.md` (12.2).
24. `reconciliation` extension (12.3).
25. Reports: RPC migration (Migration C), route pass-through, `ReportsView.tsx` tiles (13); `Docs/schema.sql` inventory update.

### Phase 5: docs and rollout
26. Help centre: venue-side article update (how deposits work gains a card-hold section) and guest-facing manage/booking copy review. Follow CLAUDE.md help conventions (plain second person, no em-dashes, appointments focus).
27. Update this document's status header; add row to `Docs/Resneo-Appointments-Review-And-Roadmap.md`.
28. Rollout: deploy with flag off; enable `FEATURE_FLAG_CARD_HOLD_DEPOSITS` env on staging; pilot on one venue (flag per venue); watch `reconciliation_alerts`, webhook logs, and the first live charges; then default availability decision.

---

## 17. Test plan

### Unit (vitest, colocated `*.test.ts`)
- `appointment-service-payment`: `'card_hold'` resolution, explicitness (legacy `deposit_pence` never infers it), variant override, add-on exclusion, flag-off degradation to `'none'`, bundle precedence (`full_payment > deposit > card_hold > none`).
- `card-hold-terms`: consent rendering (amount formatting, venue name), snapshot shape, window computation.
- Charge guard matrix (9.2 guards 1-8) as a pure function extracted for testability: every 4xx path.
- Webhook branch ordering: fee-PI success must not hit the generic deposit confirm (regression test with a purpose-tagged PI payload).
- `deposit_status` label maps render the two new values everywhere a map exists.

### Integration (mocked Stripe)
- Create -> setup confirm -> `'Card Held'` (route and webhook paths, idempotent when both fire).
- Abandon -> cron cancel + release.
- No-Show -> charge success -> `'Charged'` + events + email enqueue; double-click -> single PI (idempotency key).
- Charge declined / `authentication_required` -> hold intact, failure recorded, correct 402 body.
- Cancel (guest and staff) -> hold released, customer deletion attempted.
- Refund of charged fee -> `'Refunded'`, released.
- Reconciliation: seeded divergence produces an alert for `'Card Held'` and `'Charged'`.

### Manual E2E (Stripe test mode, connected test account)
| Card | Expectation |
|---|---|
| `4242 4242 4242 4242` | Saves; off-session charge succeeds |
| `4000 0025 0000 3155` | Saves with 3DS challenge at booking; off-session charge later raises `authentication_required` (exercises 8.5 fallback messaging) |
| `4000 0000 0000 0341` | Attaches, then off-session charge declines (`card_declined`) |

Walk the full journey on staging: configure a card-hold service, book as guest (check copy + £0), verify confirmation email terms, mark No-Show inside grace (should fail) and after grace, charge partial amount, verify receipt email + reports tiles + reconciliation silence, refund, and separately let a hold expire via cron and confirm the Stripe customer is deleted.

---

## 18. API contract summary (quick reference)

| Surface | Change |
|---|---|
| `POST /api/booking/create` (and `create-multi-service`, `create-group`) | Response adds `payment_mode: 'payment' | 'setup'`, `card_hold_fee_pence`; setup mode returns SetupIntent `client_secret` |
| `POST /api/booking/confirm-payment` | Accepts `setup_intent_id` (XOR with `payment_intent_id`) |
| `GET /api/venue/bookings/[id]` | Adds `card_hold: { fee_pence, charged_pence, charged_at, released_at, charge_failure_code, charge_window_ends_at } | null` |
| `POST /api/venue/bookings/[id]/deposit` | New `action: 'charge_no_show_fee'` (+ optional `amount_pence`); `refund` handles `'Charged'` state |
| `GET /api/confirm` | Booking payload adds guest-safe hold summary |
| `POST /api/webhooks/stripe` | New event types `setup_intent.succeeded`, `setup_intent.setup_failed`; purpose branches for `card_hold_no_show_fee` on PI events and refunds |
| `GET/POST /api/cron/release-card-holds` | New cron |

---

## 19. Future work (explicitly not v1)

1. **Fee payment link fallback** for `authentication_required` declines: an on-session pay page (extend `/pay`) charging the fee with 3DS.
2. **Phone/staff-created bookings**: send a "secure your booking" card-save link (deposit-request flow in setup mode) with template copy changes.
3. **Late-cancellation fees**: charge window opening on late cancel, not just No-Show. Requires new consent text, policy configuration, and manage-page copy.
4. **Charge deposit and save card together** (`setup_future_usage` on the deposit PI) for mixed bundles or "deposit + no-show top-up" policies.
5. **Classes, events, resources** support (enum already carries the value).
6. **`booking_payments` ledger rows** for card-hold charges once the Tap to Pay ledger ships.
7. **Automated dispute evidence** assembly from the terms snapshot + event trail.
