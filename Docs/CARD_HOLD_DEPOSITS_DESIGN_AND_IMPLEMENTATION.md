# Card Hold Deposits: Design and Implementation Document

**Status: Proposed, not yet implemented (4 July 2026). No code written.**
When implementation ships, update this header (and move the doc to `Docs/archive/` per `Docs/archive/README.md` once it is purely historical). Do not leave a stale "not built" header on a shipped feature.

**Covers booking models:** appointments (`practitioner_appointment`, `unified_scheduling`), classes (`class_session`, including the class cart), events (`event_ticket`), resources (`resource_booking`), and **table reservations** (`table_reservation`).
**Covers booking channels:** the public online flows AND **staff-created bookings (phone and walk-in / in person)** via a "secure by card" link sent to the guest by email or SMS, with a per-booking staff toggle to waive the requirement.

**Relationship to other docs:**
- `Docs/TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md` is a separate, also-unshipped payments design (in-person balance collection). Card hold does **not** depend on it. Shared conventions (pence integers, direct charges, PI purpose constants, webhook-as-source-of-truth) are followed so the two can coexist. If the `booking_payments` ledger from that doc ships first, a card-hold charge should additionally write a ledger row; v1 of card hold does not require the ledger.
- `Docs/CLASS_COMMERCE_PRODUCT_RULES.md` is the normative rules doc for class entitlements. Section 7.4 defines how card holds compose with those rules without changing them.
- `Docs/PRD.md` §3.4 (phone booking deposit requests) is the UX baseline the staff flow extends.

---

## 1. Overview

### 1.1 Problem

Venues want no-show protection without charging guests money up front. Today the payment options per bookable entity are `none`, `deposit` (charged at booking), or `full_payment`; tables have their own per-person deposit system. A deposit deters no-shows but adds friction and refund admin. Venues want the Fresha-style middle ground: **take no money now, keep a card on file, and charge a defined no-show fee only if the client fails to attend, at the venue's explicit discretion.** For class businesses this is the dominant model (members book "free" under a membership, a no-show fee applies); for restaurants it is the standard alternative to per-person deposits.

### 1.2 Solution

A new payment requirement, **Card hold**, available on appointment services, unified service items, class types, events, resources, and table booking rules:

- The venue enables deposits as today and chooses **Card hold** as the type, with a defined no-show fee.
- **Online:** the guest must enter card details to book. **£0 is taken.** The card is saved securely with Stripe against the venue's connected account.
- **Phone / in person:** staff create the booking as today. If the entity requires a card hold, a **"Card hold" toggle** on the New Booking form (default on) controls it; staff may switch it off case by case. When on, the booking is held as `Pending` and the guest receives a **secure-your-booking link by email and/or SMS** to add their card details on their own device; the booking confirms when the card is saved. This mirrors today's phone deposit-request flow exactly (same link machinery, same 2-hour reminder, same 24-hour auto-cancel).
- If the guest does not attend, staff mark the booking **No-Show** exactly as today. That unlocks an explicit **"Charge no-show fee"** action on the booking. Nothing is ever charged automatically.
- The charge is a merchant-initiated, off-session Stripe payment of up to the defined fee, on the venue's connected account (direct charge, no platform fee, matching deposits).
- If the guest cancels (any time, any actor), the hold is released and can never be charged. Holds also auto-release 14 days after the booking.
- For class carts, card holds compose with entitlements: a membership- or credit-covered class can still require a card hold, and one card entry covers the whole cart.

### 1.3 Design principles (hard requirements)

1. **Seamless with deposits.** Same settings surfaces, same booking-flow payment step, same staff New Booking toggle pattern, same payment-link machinery, same staff booking-detail deposit block, same `deposit_status` state machine, same comms patterns.
2. **Explicit charge only.** No automation ever moves money. The only path to a charge is a staff/admin clicking the charge action on a booking that is already marked No-Show.
3. **Card required to book (when the hold applies).** A booking whose effective configuration demands a card hold must never reach `Booked` without a successfully saved card. Staff waiving the hold (per-booking toggle off) removes the demand; then the booking confirms normally.
4. **Webhook is source of truth** for money state.
5. **No em-dashes in any user-facing copy** (CLAUDE.md rule). All copy strings in this doc comply and must be used as written or adapted without introducing em-dashes.

---

## 2. Current state (verified against code, July 2026)

File references are current as of writing; re-verify line numbers before editing.

### 2.1 Payment configuration by model

| Model | Requirement column | Fee/deposit column | Semantics |
|---|---|---|---|
| Appointment services | `appointment_services.payment_requirement` (enum `class_payment_requirement`: `'none' | 'deposit' | 'full_payment'`) | `appointment_services.deposit_pence` (+ variant override `service_variants.deposit_pence`) | Fixed per booking (base + variant; add-ons excluded from deposits) |
| Unified service items | `service_items.payment_requirement` (same enum) | `service_items.deposit_pence` | Same |
| Class types | `class_types.payment_requirement` (same enum; migration `20260429100000`) | `class_types.deposit_amount_pence` (per person; `price_pence` for full payment) | Per-person x `party_size` (seats) |
| Events | `experience_events.payment_requirement` (**plain `text`**; migration `20260515120000`) | `experience_events.deposit_amount_pence` (per person) | Event-level, NOT per ticket type (`event_ticket_types` carry `price_pence` only); per-person x `party_size` (tickets); full payment = ticket total |
| Resources | `unified_calendars.payment_requirement` (same enum, `calendar_type='resource'`; migration `20260503120000`) | `unified_calendars.deposit_amount_pence` (**flat per booking**) | Full = `price_per_slot_pence` x slots; deposit = flat. Snapshot `bookings.resource_payment_requirement` |
| **Tables** | no requirement enum; per-service rules in `booking_restrictions` | `booking_restrictions.deposit_amount_per_person_gbp numeric(10,2)` (**GBP**, 0-100), gated by `deposit_required_from_party_size` + `online_requires_deposit`; legacy venue-wide fallback `venues.deposit_config` JSONB (`enabled, amount_per_person_gbp, online_requires_deposit, phone_requires_deposit, min_party_size_for_deposit, weekend_only`; zod `depositConfigSchema`, `src/types/config-schemas.ts:42-54`) | Per-person GBP x party, converted to pence at create (`Math.round(gbp*100)`) |

Table specifics (verified):
- Full `restrictionFieldsSchema` (`src/app/api/venue/booking-restrictions/route.ts:7-20`): `service_id`, `min_advance_minutes`, `max_advance_days`, `min_party_size_online`, `max_party_size_online`, `large_party_threshold`, `large_party_message`, `deposit_required_from_party_size`, `deposit_amount_per_person_gbp` (0-100), `online_requires_deposit`, `cancellation_notice_hours` (0-168). Invariant: threshold set => amount > 0 and <= 100; POST/PATCH force `online_requires_deposit = true` when a threshold is set.
- Availability engine (`src/lib/availability/engine.ts:678-757`): slot `deposit_required` = per-person amount > 0 AND `partySize >= deposit_required_from_party_size`; slot `deposit_amount` = per-person GBP x party. Settings UI: `src/app/dashboard/availability/components/ServiceBookingRulesSection.tsx`.
- **`venues.deposit_config.phone_requires_deposit` is dead config**: greps show it is written by onboarding and typed, but never read by any booking path. The staff toggle is the sole phone gate (2.8).

Appointment resolution: `src/lib/appointments/appointment-service-payment.ts` (`resolveAppointmentPaymentRequirement`, `resolveAppointmentServiceOnlineCharge[WithAddons]`, `chargeLabel: 'deposit' | 'full_payment'`). CDE models resolve inline in the create routes from the availability slot; events via `src/lib/experience-events/validate-event-ticket-booking.ts` (server-side prices; returns `ticketTotalPence`, `requiresDeposit`, `depositAmountPence`).

### 2.2 Online collection paths

- **Direct bookings (all models):** `POST /api/booking/create` (`src/app/api/booking/create/route.ts`). Branches: table `~412-472` (`onlineDepositApplies = isOnlineSource && slot.deposit_required`), event `~1109-1139`, class `~1140-1272`, resource `~1273-1357`. Paid path inserts `status:'Pending'`, `deposit_status:'Pending'`; free path `'Booked'`/`'Not Required'`. One customer-less PaymentIntent per unit on the connected account (`~530-538` tables, `~1688-1710` CDE): `{ amount, currency:'gbp', metadata:{ booking_id, venue_id }, automatic_payment_methods:{enabled:true} }`, `{ stripeAccount }`. PI id on `bookings.stripe_payment_intent_id`; booking rows deleted on PI failure.
- **Class cart:** `POST /api/booking/class-cart/checkout` -> `orchestrateClassCartCheckout` (`src/lib/class-commerce/orchestrate-class-cart-checkout.ts`). Entitlement precedence **course -> membership -> credits (opt-in) -> card** via `decideClassLineEntitlement` (`entitlement-engine.ts:32-101`). Covered/free lines insert `Booked` immediately; card lines insert `Pending/Pending` and share one PI (`metadata.booking_ids`, purpose `CLASS_CART_CHECKOUT`). All-covered carts return `{ status:'completed' }` with **no PI**. `rollbackGroup` restores entitlements and deletes the group's rows on failure.
- **Client:** `src/components/booking/PaymentStep.tsx` (Stripe Elements, `confirmPayment`), shared by `AppointmentBookingFlow`, `ClassBookingFlow` (~1032), `EventBookingFlow` (~757), `ResourceBookingFlow` (~1145), and `BookingFlow` (tables).
- **Confirm:** `POST /api/booking/confirm-payment` -> `confirmBookingsForSucceededPaymentIntent()` (`src/lib/booking/confirm-deposit-payment.ts`) flips `Pending` rows on the PI to `Booked`/`'Paid'`, assigns the manage token. Webhook `payment_intent.succeeded` is the backup path.

### 2.3 Booking and deposit state

- `booking_status` enum: `Pending, Booked, Confirmed, Seated, Completed, No-Show, Cancelled` (`BOOKING_STATUSES`, `src/lib/table-management/booking-status.ts:20-28`; `'Booked'` added by standalone migration `20260626120000`).
- `deposit_status` enum: `'Not Required' | 'Pending' | 'Paid' | 'Refunded' | 'Forfeited' | 'Waived' | 'Failed'`.
- **No-show, staff PATCH path:** `PATCH /api/venue/bookings/[id]` (`~868-970`), all models. Grace gate (`validateNoShowGracePeriod`, `venues.no_show_grace_minutes` default 15); forfeits a `'Paid'` deposit to `'Forfeited'`; group-aware; `no_show_notification` + staff push; `applyBookingLifecycleStatusEffects` maintains `guests.no_show_count`. Undo restores `'Paid'`.
- **No-show, class roster path:** `POST /api/venue/class-instances/[id]/attendees/[bookingId]/no-show` -> `applyAttendanceMutation` (`class-attendance.ts:124-163`). **Pre-existing bug:** writes `status = 'No Show'` (space); the enum only has `'No-Show'` (hyphen), so this update should fail at the database. It does not forfeit deposits or free the seat. Roster UI: `ClassInstanceDetailSheet.tsx` (~214-217).
- **Cancels:** staff PATCH (`~662-867`) and guest `POST /api/confirm` (`~479-755`): refund iff `now <= cancellation_deadline && deposit_status === 'Paid' && stripe_payment_intent_id`. Guest class cancel within window restores credits/allowance. `restoreAndReleaseClassBookings` (webhook `route.ts:48-119`) restores entitlements and frees seats on payment failure/refund.
- All models set `cancellation_deadline` + `cancellation_policy_snapshot` at create via `resolveCancellationNoticeHoursForCreate` (tables -> `booking_restrictions`, class -> `class_types`, event -> `experience_events`, resource -> `unified_calendars`, appointments -> services).
- Staff deposit actions: `POST /api/venue/bookings/[id]/deposit`, `action: 'send_payment_link' | 'waive' | 'record_cash' | 'refund'` (+ `amount_pence`). Surfaced in `BookingDetailContent.tsx` (~591-640).

### 2.4 Saved-card machinery that already exists (but is not used by bookings)

- Per-venue Stripe Customers: `venue_customer_stripe`, created by `ensureVenueStripeCustomerForUser()` (`src/lib/class-commerce/venue-stripe-customer.ts`).
- `POST /api/account/payment-methods/setup-intent` creates a SetupIntent (`usage:'off_session'`) on the connected account; the guest can list and **detach** wallet cards self-serve.
- **No booking flow currently attaches a customer, uses `setup_future_usage`, or performs off-session confirmation.**

### 2.5 Webhook

`POST /api/webhooks/stripe`, signature-verified, idempotent (`claimStripeWebhookEvent` / `webhook_events`). Connected account from `event.account`. Handles `payment_intent.succeeded` (purpose branches, else generic booking confirm), `payment_intent.payment_failed` (sets `'Failed'` on `Pending` rows + entitlement restore), `charge.refunded`/`charge.refund.updated`, `account.updated`, subscription events.

### 2.6 Crons

- `auto-cancel-bookings` (`src/app/api/cron/auto-cancel-bookings/route.ts`): **phone sweep** = `status='Pending' AND deposit_status='Pending' AND source='phone' AND created_at < now-24h` -> validated transition to `Cancelled` (`cancellation_actor_type:'system'`), `events` row `auto_cancelled` (`reason:'deposit_unpaid_timeout'`), `auto_cancel_notification` comms (EMAIL_AND_SMS policy), staff push `'payment_failed'`. **Class-cart sweep** = online + class + PI, 30-min cutoff, cancels only when the PI is definitively non-payable, sets `'Failed'`.
- `deposit-reminder-2h`: `source='phone' AND status='Pending' AND deposit_status='Pending'`, created 2-2.5h ago; regenerates the short link; sends message key `deposit_payment_reminder`.
- `reconciliation`: 48h lookback over `deposit_status IN ('Paid','Refunded')` with a PI; `reconciliation_alerts` on divergence.
- `class-recurring-materialize` -> `materializeRecurringReservation` (`~184-196`): auto-books **only** classes with no online card charge (skips `full_payment`/`deposit`).

### 2.7 Reporting, events, flags

- `report_deposit_summary` RPC: collected = `Paid + Forfeited`, refunded, forfeited. `report_by_booking_model` counts `'Paid'`.
- `events` table: trigger logs `booking_created`/`booking_status_changed`; app inserts custom rows (`auto_cancelled`, `class_no_show`, ...).
- Feature flags: key in `APPOINTMENTS_FEATURE_FLAG_KEYS` (`types.ts`), zod key, env in `ENV_BY_FLAG` (`resolve.ts`), default off unless in `FLAG_DEFAULT_ON`; gate helpers `assertAppointmentsFeatureEnabled` / `featureFlagDisabledResponse`.

### 2.8 Staff-created bookings and the payment-link machinery (verified)

- **Route:** `POST /api/venue/bookings` (`src/app/api/venue/bookings/route.ts`, `phoneBookingSchema` lines 82-129). Fields: `require_deposit: z.boolean().optional()`, `source: z.enum(['phone','walk-in']).optional()` (default `'phone'`); `booking_source` enum overall: `online, phone, walk-in, widget, booking_page, import`. `staffWalkIn = source === 'walk-in'`; **walk-ins never collect deposits in any model**.
- **Toggle semantics today (per model):** table: `requiresDeposit = !staffWalkIn && Boolean(require_deposit)` (pure toggle; **party-size threshold NOT applied** in the staff path; toggle on with no configured amount -> 400). Appointment: `full_payment` always requires payment; `deposit` only when the toggle is on. Event/class/resource: **toggle ignored**, config-driven, off for walk-ins.
- **Statuses:** deposit -> `Pending`/`'Pending'` + `deposit_amount_pence`; not required -> `'Booked'`/`'Not Required'`/`null`. So **create-time toggle-off yields `'Not Required'`** (the `'Waived'` value is reserved for the post-hoc `waive` action).
- **PI + link at create:** deposit paths create the PI inline (table `~1544-1565`, appointment `~1255-1272`) or via `applyStaffBookingPaymentAndComms` (`src/lib/booking/staff-booking-payment-comms.ts`, CDE), then `createOrGetPaymentShortLink(...)` and **auto-send** `sendDepositRequestNotifications(...)` in `after()`. Stripe failure rolls the insert back. Non-deposit paths send a manage link + confirmation instead.
- **Form UI:** `src/components/booking/UnifiedBookingForm.tsx`: `requireDeposit` state default **off** (line ~218), switch labelled "Require deposit" / "Send a payment link to the guest" (~1733-1751), rendered only when `!isEdit`; body sends `require_deposit` (~1037); success toast `'Booking created - deposit link sent'` (~1090).
- **Links:** `booking_short_links` table, `/b/{code}` (6-char base62), purpose `'payment'` TTL **24h** (`src/lib/booking-short-links.ts`); resolves to `/pay?t={HMAC token}` (`src/lib/payment-token.ts`: HMAC-SHA256 over booking uuid + expiry, secret `PAYMENT_TOKEN_SECRET`, 24h).
- **Pay API:** `GET /api/booking/pay` (`route.ts`): rate-limited, verifies the token, **requires `status === 'Pending'` and `stripe_payment_intent_id`** (else 404 "Booking not found or already completed"), retrieves the PI on the connected account, returns `{ client_secret, stripe_account_id, booking_id, venue_name, venue_address, booking_date, booking_time, party_size, deposit_amount_pence, guest_name, guest_email, refund_cutoff }`.
- **Pay page:** `src/app/pay/page.tsx` is self-contained (does NOT reuse `PaymentStep`): `BookingDetailsCard` + `RefundPolicy` + `<Elements>` + `PayForm` (`PaymentElement`, `confirmPayment` with `return_url: '/pay/success'`, `redirect:'if_required'`), then best-effort `POST /api/booking/confirm-payment { booking_id, guest_email }`.
- **Re-send:** deposit route `send_payment_link`: requires guest email or phone (400 otherwise), does NOT create a missing PI, deletes prior `deposit_request_sms`/`deposit_request_email` comm-logs (dedupe bypass), sends `sendDepositRequestNotifications` (email attempted subject to venue toggle `deposit_request_email_enabled`; SMS only when `guest_phone` present, gated by the `deposit_request_sms` policy), 422 if neither channel sent.
- **Comms:** templates `deposit-request-email.ts` (subject "Pay your deposit to confirm your booking at {venue}", CTA "Pay deposit") and `deposit-request-sms.ts` (160-char cap); message keys `deposit_payment_request` and `deposit_payment_reminder` (policies `EMAIL_AND_SMS`; per-venue channel flags via `policy-resolver.ts`, e.g. venue column `deposit_request_email_enabled`, default true).

---

## 3. Key design decisions (with rationale)

### D1. Stripe mechanism: save the card now, charge off-session later. NOT a manual-capture authorization.

Card-network authorizations expire after about 7 days; bookings are made weeks or months out. **The card is saved (SetupIntent, or PaymentIntent with `setup_future_usage`, both `off_session`) at booking; the no-show fee is a later merchant-initiated off-session PaymentIntent.** No funds are reserved in the meantime, matching "no payment taken up front".

### D2. A dedicated, booking-scoped Stripe Customer. NOT the guest's account wallet customer.

The saved PaymentMethod must be attached to a Stripe Customer to be charged off-session. The `venue_customer_stripe` customer is the guest's self-serve wallet: listed by `GET /api/account/payment-methods` and **detachable by the guest**, which would let them defeat the hold and would surprise guests with a card silently appearing in their wallet. **Every card-hold capture unit creates a dedicated Stripe Customer on the connected account** (metadata: lead `booking_id`, `venue_id`, `reserve_ni_purpose: 'card_hold'`). Never wallet-visible, not self-detachable, deleted wholesale at release (detaching the card: data minimisation).

### D3. Charge is gated strictly on booking status = `No-Show`, staff-explicit, admin-only.

- Charge enabled only when `status='No-Show'`, `deposit_status='Card Held'`, hold not released, within the charge window.
- **Any cancellation (guest or staff, early or late) releases the hold**; a cancelled booking can never be charged in v1 (late-cancel fees: Section 19).
- Admin-only (money movement). Staff see the state but not the button.

### D4. State lives in the existing `deposit_status` enum plus one new 1:1 table.

Two new values: **`'Card Held'`** and **`'Charged'`**. Every existing surface stays on one state machine; existing predicates (`='Paid'`, `='Pending'`) are naturally false for card holds, which is correct everywhere. Hold internals live in **`booking_card_holds`** (one row per booking row, service-role only). `deposit_amount_pence` stays NULL for card-hold rows.

### D5. Configuration reuses each model's existing payment requirement and amount columns; tables get a `deposit_type` on their existing rules.

`'card_hold'` becomes a fourth requirement value where the enum exists. Tables have no requirement enum; instead the existing table deposit rules gain **`deposit_type: 'charge' | 'card_hold'`** (default `'charge'`). In both shapes, **the existing amount column holds the no-show fee** and the UI label switches to "No-show fee". Fee semantics mirror each model's deposit semantics:

| Model | Fee configured as | Booking fee snapshot |
|---|---|---|
| Appointment service / service item | fixed (`deposit_pence`, variant override, add-ons excluded) | the fixed amount |
| Class type | per person (`deposit_amount_pence`) | per-person x `party_size` (seats) |
| Event | per person (`deposit_amount_pence`, event-level) | per-person x `party_size` (tickets) |
| Resource | flat (`deposit_amount_pence`) | the flat amount |
| **Table** | per person GBP (`deposit_amount_per_person_gbp`), same party-size threshold and gates as today | per-person GBP x `party_size`, converted to pence (`Math.round(gbp*100)`) |

For tables, **all existing gates decide WHETHER protection applies** (online: party threshold, `online_requires_deposit`, legacy `weekend_only`; staff: the per-booking toggle, threshold not applied, mirroring deposits); **`deposit_type` decides WHAT KIND** (charge money vs hold card). The requirement remains exclusive per entity (no "deposit AND hold" on one entity; Section 19).

### D6. Staff-created bookings (phone and walk-in) support card holds via a secure-by-card link, with a per-booking staff toggle.

This mirrors the deposit-request flow the venue already knows (2.8): booking held `Pending`, link sent by email and/or SMS, 2-hour reminder, 24-hour auto-cancel, re-send action. Specifics:

- **Toggle:** the New Booking form shows a **"Card hold"** toggle **only when the selected entity's effective requirement is `card_hold`** (or, for tables, the service's rules have `deposit_type='card_hold'` with an amount configured). Default **on** (the entity requires it). Staff may switch it **off** case by case; the booking is then created exactly like a no-deposit booking (`'Booked'`/`'Not Required'`), matching today's create-time toggle-off semantics. The existing "Require deposit" toggle and its per-model semantics are untouched; the two toggles are never shown together (an entity is either deposit-type or card-hold-type).
- **Applies to all five models.** Unlike `require_deposit` (which CDE ignores), the card-hold toggle is honoured for tables, appointments, classes, events, and resources: the user requirement is explicit per-booking discretion everywhere.
- **Walk-ins included.** Deposits are hard-off for walk-ins today and stay that way. Card holds are **allowed** for walk-in bookings: a guest standing at the desk booking a future slot is exactly the no-show risk this feature addresses, and the link lands on their own phone. (For a truly immediate walk-in the toggle is pointless; staff switch it off.)
- **Channel selection** mirrors deposits: email is attempted subject to the venue's request-email toggle; SMS is sent when the guest has a phone number, subject to the SMS policy. Staff do not pick a channel; at least one channel must succeed (422 otherwise on re-send).
- **Consent** is displayed and accepted on the `/pay` page at card-save time (the guest sees the exact consent text before saving); `terms_snapshot.accepted_at` is stamped at confirm, same as online.

### D7. Three capture modes; mixed carts and bundles save the card on the payment.

A capture unit (single booking, appointment bundle, group appointment, class cart) resolves to one mode:

| Mode | When | Stripe object | Client confirm |
|---|---|---|---|
| `payment` | money due, no card-hold lines | PaymentIntent (today's, unchanged) | `confirmPayment` |
| `setup` | no money due, at least one card-hold line | SetupIntent (`usage:'off_session'`) | `confirmSetup` |
| `payment_with_setup` | money due AND card-hold lines | PaymentIntent + `customer` + `setup_future_usage:'off_session'` | `confirmPayment` |

One card entry, one confirmation; Stripe charges the money AND vaults the card. No hold is ever silently dropped. The `/pay` page supports `payment` (today) and `setup` (staff card-hold bookings); a staff booking never needs `payment_with_setup` in v1 because the staff toggle model keeps deposit-type and hold-type entities distinct per booking.

### D8. Class entitlements compose with card holds; the covered-but-held case is first-class.

Entitlements decide **how money is paid**; a card-hold class charges no money, so entitlements are not consumed for it: members and non-members book identically (free, card held). The gym pattern "membership covers the class, no-show fee applies" is exactly `payment_requirement='card_hold'`. In carts, `card_hold` lines bypass the entitlement engine and join the capture unit as hold lines (Section 7.2).

### D9. One canonical no-show status, and the roster bug gets fixed first.

The charge gate keys on `status='No-Show'`. The class attendance route writes `'No Show'` (space), not an enum value, and should be failing at the database today (2.3). **Phase 0 fixes `class-attendance.ts` to write `'No-Show'`**, verifies against a real database, adds a regression test. The roster no-show then feeds the same charge gate as the staff PATCH path.

---

## 4. Scope

### In scope (v1)

- **Models:** appointments (single, multi-service, group), classes (single and cart), events, resources, **tables**.
- **Channels:** public online flows (`/api/booking/create`, `create-multi-service`, `create-group`, `class-cart/checkout`) AND staff-created bookings (`POST /api/venue/bookings`, sources `phone` and `walk-in`) with the secure-by-card link (`/pay` page in setup mode), per-booking toggle, re-send action, reminder and auto-cancel parity.
- Per-entity configuration in every editor (appointment service form, service items, class timetable manager, event manager, resource timeline, **table booking rules**, legacy venue-wide table deposit config).
- Guest payment step in all three capture modes; confirm paths; webhook backup paths.
- Staff: hold visibility incl. "awaiting card" state, charge action (booking detail and class roster), refund of a charged fee, waive parity.
- Guest manage page; cancellation releases the hold; class credit/allowance interplay.
- Comms: card-request email/SMS, card-request reminder, confirmation hold terms, charged-fee receipt.
- Crons: abandoned-capture cleanup (online 30 min; staff 24h auto-cancel parity), hold auto-release, reconciliation, recurring-materialization skip.
- Reporting card-hold buckets; feature flag `card_hold_deposits` (default off).

### Out of scope (v1), with reasons

- **Automatic charging of any kind**, including late-cancel fees (D3).
- **Charging more than the disclosed fee** (clamped to snapshot).
- **Compound per-entity config** ("charge a deposit AND hold for a further fee" on one entity). Mixed *units* are covered by D7.
- **Recurring class reservations:** materialized bookings are created with no guest present; materialization skips card-hold classes (12.4).
- **Waitlists** (appointment-only subsystem today; conversions are staff-driven).
- **Courses** (prepaid; per-session no-show economics deferred).
- **Partial ticket no-show for events** (ticket-line edits rejected today; fee is per booking).
- **Tap to Pay / `booking_payments` ledger**; **multi-currency** (`'gbp'` hardcoded, matching every existing PI).
- **Import tool**: imported bookings never carry holds.

---

## 5. Data model

Four migrations. House conventions: `IF NOT EXISTS` guards, `gen_random_uuid()`, pence integer checks, RLS enabled with no policies (service-role only), named unique indexes.

### 5.1 Migration A: enum values (standalone, no transaction with usage)

Copy the structure of `20260626120000_booking_status_add_booked.sql`.

```sql
-- <timestamp>_card_hold_enums.sql
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'Card Held';
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'Charged';
ALTER TYPE class_payment_requirement ADD VALUE IF NOT EXISTS 'card_hold';
```

- `class_payment_requirement` is shared by `appointment_services`, `service_items`, `class_types`, `unified_calendars`, `bookings.resource_payment_requirement`; one `ADD VALUE` covers all.
- **Events need no DDL** (`experience_events.payment_requirement` is text); **tables need Migration B2** instead (no requirement enum).

### 5.2 Migration B: `booking_card_holds`

```sql
-- <timestamp>_booking_card_holds.sql
CREATE TABLE IF NOT EXISTS public.booking_card_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  venue_id   uuid NOT NULL REFERENCES public.venues (id)   ON DELETE CASCADE,
  stripe_connected_account_id text NOT NULL,   -- snapshotted so account changes cannot orphan the hold
  stripe_customer_id text,             -- dedicated, booking-scoped customer (D2), shared across the capture unit
  stripe_setup_intent_id text,         -- set in 'setup' mode; NULL in 'payment_with_setup' mode
  stripe_payment_method_id text,       -- set at confirm time from the succeeded intent
  fee_pence int NOT NULL CHECK (fee_pence > 0),   -- max chargeable for THIS booking row, snapshotted at create
  currency text NOT NULL DEFAULT 'gbp',
  -- Consent snapshot shown to the guest at save time (dispute evidence):
  -- { "text": "...", "version": 1, "fee_pence": <unit total>, "accepted_at": "<iso>" }
  terms_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  charge_payment_intent_id text,
  charged_pence int CHECK (charged_pence IS NULL OR charged_pence > 0),
  charged_at timestamptz,
  charged_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  charge_failure_code text,            -- 'card_declined', 'authentication_required', ...
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
CREATE INDEX IF NOT EXISTS idx_booking_card_holds_open
  ON public.booking_card_holds (venue_id) WHERE released_at IS NULL;

ALTER TABLE public.booking_card_holds ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only
```

**Row granularity and unit linkage.** One hold row per booking row, each with its own `fee_pence` (D5 semantics). All rows in a capture unit share `stripe_customer_id` (and `stripe_setup_intent_id` in setup mode). Linkage for confirmation: `setup` mode by `stripe_setup_intent_id`; `payment_with_setup` mode: every booking row of the unit, including card-hold-only rows, stores the unit's PI id in `bookings.stripe_payment_intent_id` (card-hold-only rows keep `deposit_amount_pence` NULL). This lets staff charge exactly the no-showed attendee (per-line in carts, per-member in groups).

### 5.3 Migration B2: table rules `deposit_type` (+ comm-log types)

```sql
-- <timestamp>_card_hold_table_rules_and_comm_types.sql
ALTER TABLE public.booking_restrictions
  ADD COLUMN IF NOT EXISTS deposit_type text NOT NULL DEFAULT 'charge'
  CHECK (deposit_type IN ('charge', 'card_hold'));
```

- Legacy venue-wide config: extend `depositConfigSchema` (`src/types/config-schemas.ts:42-54`) with `type: z.enum(['charge','card_hold']).default('charge')` (JSONB, no DDL).
- Also add the new `communication_logs` message types in this migration, using the same mechanism as `20260402000000_deposit_request_email_and_comm_logs_types.sql` (verify whether it is a CHECK constraint or enum and extend accordingly): `card_hold_request_email`, `card_hold_request_sms`, `card_hold_reminder_email`, `card_hold_reminder_sms`, `card_hold_charged_email`.

### 5.4 Migration C: reporting RPC update

Extend `report_deposit_summary` (`20260304000001_reconciliation_and_reporting.sql:219-238`) via `CREATE OR REPLACE`, adding:

```sql
no_show_fees_charged_pence bigint,  -- SUM(bch.charged_pence) where deposit_status='Charged'
no_show_fees_charged_count bigint,
card_holds_active_count    bigint   -- deposit_status='Card Held' AND bch.released_at IS NULL
```

Join `booking_card_holds` on `booking_id`. Do **not** fold charged fees into `total_collected_pence`. Keep the signature compatible with `src/app/api/venue/reports/route.ts`. Update `Docs/schema.sql` (table + enum additions + `booking_restrictions.deposit_type`).

---

## 6. Configuration and settings

### 6.1 Feature flag

- Key `card_hold_deposits`: `APPOINTMENTS_FEATURE_FLAG_KEYS`, `venueFeatureFlagsSchema` (`card_hold_deposits: z.boolean().optional()`), `ENV_BY_FLAG` (`'FEATURE_FLAG_CARD_HOLD_DEPOSITS'`). **Not** in `FLAG_DEFAULT_ON`. Surface in `FeatureFlagsSection.tsx` + `FlagsPageClient.tsx`; update `Docs/FEATURE_FLAGS.md`.
- **Normative flag rule:** the flag gates **creation of new holds** (config acceptance, booking-flow branches, staff-toggle visibility). It never gates charging, refunding, or releasing existing holds: the guest keeps the deal they consented to; the venue keeps the protection they were promised.

### 6.2 Editor surfaces (venue-facing)

Shared copy for the new option (all editors, rendered only when the flag resolves on):
- Option label: **"Card hold"**
- Helper text: `"No payment is taken when the client books. Their card is stored securely and you can charge a no-show fee if they do not attend."`
- Amount field relabels to **"No-show fee (£)"** (classes/events/tables: **"No-show fee per person (£)"**), writing the same column. Validation mirrors current deposit bounds per form; for classes **drop the "deposit <= price" constraint** when `card_hold` (no price relationship), cap at £150.

| Surface | Location | Change |
|---|---|---|
| Appointment services | `AppointmentServiceFormFields.tsx` (+ form-values/payload mappers; also onboarding `OnboardingAppointmentServiceList.tsx`) | fourth requirement option; variant override rows relabel |
| Service items | unified services editor (grep `payment_requirement`) | same |
| Class types | class type form in `ClassTimetableView.tsx` | same |
| Events | event form in `EventManagerView.tsx` | same; the API zod union is the **only** gate (text column), so extending it is mandatory |
| Resources | resource form in `ResourceTimelineView.tsx` | same |
| **Table rules** | `ServiceBookingRulesSection.tsx` (per-service deposit card) | when "Require deposits for this service" is on, a **"Deposit type"** selector appears: `Take deposit payment` (default) / `Card hold`. Threshold ("Deposit from party size") and "Amount per person (£)" fields are unchanged; selecting Card hold relabels the amount to "No-show fee per person (£)". Persist via `restrictionFieldsSchema` + `deposit_type: z.enum(['charge','card_hold']).optional()` in `/api/venue/booking-restrictions` (keep the existing invariant: threshold set => amount > 0 and <= 100; keep forcing `online_requires_deposit=true`) |
| Legacy venue-wide table config | `PATCH /api/venue/deposit-config` + `depositConfigSchema` | add `type` (5.3); the settings surface that edits `deposit_config` gains the same selector |

Every write path rejects `'card_hold'` with 403 `{ code:'feature_disabled', feature:'card_hold_deposits' }` when the venue flag is off.

### 6.3 Resolution logic

- Appointments: `appointment-service-payment.ts`: `'card_hold'` must be **explicit** (legacy `deposit_pence > 0` inference stays `'deposit'`); `chargeLabel` union gains `'card_hold'`; fee = variant-adjusted `deposit_pence`, **add-ons never included**.
- Classes/events/resources: slots already surface `payment_requirement` + amounts; only TS unions widen. Events: extend `validate-event-ticket-booking.ts` to return `cardHoldFeePence` (per-person x validated party) so pricing stays server-derived.
- Tables: `resolveDepositPerPersonGbp` and the slot computation gain `deposit_type` passthrough (restriction value, fallback legacy `deposit_config.type`); slot gains `deposit_type: 'charge' | 'card_hold'`. All gates unchanged (D5).
- **Flag-off safety:** entity configured `card_hold` while the venue flag is off resolves as `'none'` (tables: `deposit_required=false`) with a `console.warn`; editors show: `Card hold is disabled for this venue; this service currently takes no deposit.` Charging a deposit instead would take money the guest was never shown.

### 6.4 Model guard rails

Grep every switch/comparison on `payment_requirement` values and make handling exhaustive (`none | deposit | full_payment | card_hold`). Course enrollment and any other reader treats `'card_hold'` as `'none'`-with-warning rather than crashing.

---

## 7. Booking flows

### 7.0 Capture-mode resolution (shared helper)

New module `src/lib/booking/card-hold-capture.ts`:

```ts
export type CaptureMode = 'payment' | 'setup' | 'payment_with_setup';

export type CaptureUnitLine = {
  bookingId: string;
  chargePence: number;              // money due for this row (0 for card-hold and covered rows)
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

Also here: `createCardHoldCustomer(...)` (D2 metadata), `createCardHoldSetupIntent(...)`, `insertCardHoldRows(...)` (terms snapshot included), and the consent template import from `card-hold-terms.ts`.

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
    setup_future_usage: 'off_session',     // NEW: vaults the card on success
    metadata: { ...existingMetadata },
    automatic_payment_methods: { enabled: true },
  },
  { stripeAccount },
);
```

On Stripe failure during create: delete the unit's booking rows and the customer (mirror existing PI-failure cleanup); class carts run `rollbackGroup` (restores entitlements too).

### 7.1 Online direct bookings: `POST /api/booking/create`

Each model branch already computes `depositAmountPence` + `requiresDeposit`; extend each to compute `cardHoldFeePence` when the effective requirement is `'card_hold'` (flag on):

| Branch | `cardHoldFeePence` |
|---|---|
| Table (`~412-472`) | when `slot.deposit_required && slot.deposit_type === 'card_hold'`: `Math.round((slot.deposit_amount ?? 0) * 100)` (per-person x party, threshold/weekend gates already applied by the engine) |
| Appointment / service item | resolved fee (fixed; variant override; no add-ons) |
| Class (`~1140-1272`) | `class_types.deposit_amount_pence x party_size` |
| Event (`~1109-1139`) | from `validate-event-ticket-booking.ts` (per-person x tickets) |
| Resource (`~1273-1357`) | flat `unified_calendars.deposit_amount_pence`; `bookings.resource_payment_requirement` snapshot gets `'card_hold'` automatically |

Then:
1. `resolveCaptureMode` over the unit's rows (`create-multi-service` / `create-group` pass all rows).
2. `'none'` / `'payment'`: exactly today.
3. `'setup'`: insert rows `Pending`/`'Pending'`, `deposit_amount_pence: NULL`; require `stripe_connected_account_id` (same 400 as deposits); customer + SetupIntent + hold rows.
4. `'payment_with_setup'`: today's paid path + customer + `setup_future_usage`; card-hold-only rows also `Pending/Pending` with `deposit_amount_pence: NULL` and the unit PI id on `bookings.stripe_payment_intent_id`; hold rows (`stripe_setup_intent_id: NULL`).
5. **Class entitlements (single path):** unchanged; a `card_hold` class never enters the entitlement short-circuit (charge is 0, nothing consumed, D8). `pay_with_class_credits` for a card-hold class -> 400 (`nothing to pay with credits`).

Response contract (all create endpoints and the cart):

```ts
{
  ...existing fields,
  requires_deposit: boolean,            // true whenever a payment step must render (any mode)
  payment_mode: 'payment' | 'setup' | 'payment_with_setup',  // 'payment' for legacy paths
  client_secret: string,                // pi_..._secret_... or seti_..._secret_...
  stripe_account_id: string,
  card_hold_fee_pence: number | null,   // unit total of hold fees, for consent copy
}
```

### 7.2 Class cart: `orchestrateClassCartCheckout`

1. **Quote** (`quote-class-cart.ts`): each line gains `card_hold_fee_pence: number | null` (per-person x line party when the class type is `card_hold`, flag on); `online_charge_pence` stays 0 for such lines. `/class-cart/quote` passes it through so the cart review shows the fee per line and in the summary.
2. **Lines:** `card_hold` lines bypass `decideClassLineEntitlement` (D8) and insert `Pending`/`'Pending'` with `deposit_amount_pence: NULL` (extend `insertPendingPaidClassSessionBooking` for the null-money case or add a sibling helper; `group_booking_id` + `cancellation_deadline` handling as today). Track `cardHoldLines[]`.
3. **Capture mode** over `totalStripePence` + `cardHoldLines`:
   - `none`: unchanged `{ status:'completed' }`.
   - `payment`: unchanged single PI.
   - `setup` (e.g. every paid line entitlement-covered + one card-hold line): customer + SetupIntent; hold rows; `{ status:'payment_required', payment_mode:'setup', client_secret: si.client_secret, ... }`. Covered lines are already `Booked` (existing semantics, unchanged); only card-hold lines await the card, preserving principle 1.3 for them specifically.
   - `payment_with_setup`: the single PI gains `customer` + `setup_future_usage`; card-hold lines' rows store the PI id; hold rows inserted.
4. **Rollback:** `rollbackGroup` additionally deletes the card-hold customer (best effort).
5. Response type gains `payment_mode` + `card_hold_fee_pence`.

### 7.3 Payment step (online client)

`PaymentStep.tsx` gains `mode` (`'payment' | 'setup' | 'payment_with_setup'`, default `'payment'`), `cardHoldFeePence`, `venueName`. Confirm call: `mode === 'setup' ? stripe.confirmSetup({...}) : stripe.confirmPayment({...})`. On success, the confirm route is called with `setup_intent_id` (setup) or `payment_intent_id` (both payment modes).

Copy (exact strings):
- `setup` heading: `Secure your booking`; sub-heading: `No payment is taken today.`
- `setup` body: `Your card details are stored securely by our payment provider, Stripe. {venueName} may charge a no-show fee of up to {fee} if you miss your booking.`
- `payment_with_setup` keeps the amount display, plus: `Your card will also be stored securely. {venueName} may charge a no-show fee of up to {fee} if you miss your booking.`
- Consent line above the submit button in both hold modes (snapshotted, 7.5): `By saving your card you authorise {venueName} to charge up to {fee} if you do not attend. If you cancel the booking before it starts, nothing extra will be charged.`
- Submit: `setup` -> `Save card and book`; `payment_with_setup` keeps pay wording.

All five flows (`BookingFlow` for tables, `AppointmentBookingFlow`, `ClassBookingFlow`, `EventBookingFlow`, `ResourceBookingFlow`) thread the new props. Confirmation screens: `setup` -> `Card saved. No payment has been taken.`; `payment_with_setup` -> `Your card has been stored securely for this booking.` Public catalogs/service cards for card-hold entities: `No-show fee of {fee} applies. No payment is taken when you book.` (per person where applicable; tables surface it in the slot/summary step from `slot.deposit_type`).

### 7.4 Confirm paths

`POST /api/booking/confirm-payment` accepts exactly one of `payment_intent_id` | `setup_intent_id` | `booking_id` (the pay page sends `booking_id` today; resolve it server-side to the booking's PI or hold SI).

**Setup branch** (new `confirmBookingsForSucceededSetupIntent()` in `confirm-deposit-payment.ts`):
1. Retrieve the SI on the connected account; require `succeeded`; extract `payment_method`.
2. Find hold rows by `stripe_setup_intent_id`, bookings `Pending` in-venue (idempotent; `alreadyConfirmed` supported).
3. Holds: set `stripe_payment_method_id`; stamp `terms_snapshot.accepted_at`. Bookings: `status:'Booked'`, `deposit_status:'Card Held'`, assign `confirm_token_hash` manage token as the deposit path does.
4. `events` rows `card_hold_saved`; send confirmation comms (Section 10).

**Payment branch** (extend `confirmBookingsForSucceededPaymentIntent()`): per-row instead of blanket `'Paid'`:
- Row has a hold row and `deposit_amount_pence IS NULL` -> `'Card Held'`.
- Otherwise -> `'Paid'` (existing).
- When the PI carries a `payment_method` and unit hold rows exist (`payment_with_setup`), populate their `stripe_payment_method_id`, stamp `accepted_at`, insert `card_hold_saved` events.
The webhook calls the same functions, so routes and webhook stay in lockstep.

### 7.5 Consent snapshot

Written at create with the exact consent string to be displayed; template constant in `src/lib/booking/card-hold-terms.ts`, imported by the online client copy, the `/pay` page copy, and the server snapshot so they cannot drift:

```json
{ "version": 1, "text": "By saving your card you authorise {venue} to charge up to £25.00 if you do not attend. If you cancel the booking before it starts, nothing extra will be charged.", "fee_pence": 2500, "accepted_at": null }
```

`fee_pence` = capture-unit total shown to the guest; each row's chargeable maximum is its own `booking_card_holds.fee_pence`. `accepted_at` stamped at confirm. This plus the booking record and events trail is the dispute evidence package.

### 7.6 Staff-created bookings: `POST /api/venue/bookings`

**Request:** `phoneBookingSchema` gains `require_card_hold: z.boolean().optional()`. Semantics (all five models, sources `phone` AND `walk-in`):

1. Resolve the entity's effective requirement (6.3; tables: rules `deposit_type='card_hold'` with a per-person amount).
2. If it is not `card_hold`, the field is ignored (deposit logic untouched, including `require_deposit` and its per-model quirks).
3. If it is `card_hold`: `holdRequired = require_card_hold ?? true` (**default on**; the UI sends the toggle state explicitly).
   - `holdRequired === false` (staff waived): create exactly as a no-deposit booking: `status:'Booked'`, `deposit_status:'Not Required'`, `deposit_amount_pence: null`, manage link + confirmation comms (existing non-deposit path). Matches today's create-time toggle-off semantics; `'Waived'` stays reserved for the post-hoc action.
   - `holdRequired === true`: require `stripe_connected_account_id` (mirror the deposit 400); insert `status:'Pending'`, `deposit_status:'Pending'`, `deposit_amount_pence: null`; customer + SetupIntent + hold row(s) (fees per D5; **table staff path: per-person x party with no threshold, toggle is the gate, 400 if no amount configured**, mirroring the deposit staff path exactly); then in `after()`: `createOrGetPaymentShortLink(...)` + send **card-request comms** (Section 10.3). Stripe failure rolls back the insert (mirror existing).
4. Extend `applyStaffBookingPaymentAndComms` (`staff-booking-payment-comms.ts`) with the card-hold variant so the CDE branches and (refactored) table/appointment branches share one implementation.

**Form UI (`UnifiedBookingForm.tsx`):** when the selected entity resolves to `card_hold` (and flag on), render, in place of the deposit toggle, a switch labelled **"Card hold"** with sublabel **"Send a link to the guest to add their card details"**, default **on**. The two toggles are never shown together. Success toast: `'Booking created - card request link sent'` (or the normal confirmed toast when waived). Hidden when `isEdit`, like the deposit toggle.

### 7.7 The `/pay` page in setup mode

- **`GET /api/booking/pay`:** change the eligibility check from "has `stripe_payment_intent_id`" to "has a PI **or** an open unsaved hold with `stripe_setup_intent_id`". For the hold case, return `payment_mode:'setup'`, `client_secret` = the SI's secret (retrieved on the connected account), `card_hold_fee_pence` (unit total), plus the same booking/venue fields; `deposit_amount_pence` stays null. Existing 404 semantics unchanged otherwise (`status !== 'Pending'` -> "Booking not found or already completed"; an already-saved or released hold therefore 404s cleanly).
- **`src/app/pay/page.tsx`:** branch on `payment_mode`:
  - Header/amount card: instead of the deposit amount, show `No payment is taken today.` and `No-show fee of up to {fee} if you do not attend.`
  - Replace the refund-policy block with the consent text (7.5) rendered verbatim above the button.
  - `PayForm` calls `stripe.confirmSetup` (same `return_url`, `redirect:'if_required'`), then posts `/api/booking/confirm-payment { booking_id, guest_email }` as today (7.4 resolves it).
  - Success state: `Card saved. Your booking is confirmed. No payment has been taken.`
- Link TTLs are unchanged (short link + token 24h), consistent with the 24h auto-cancel (12.1).

---

## 8. Stripe integration detail

### 8.1 Objects and account

Everything on the venue's connected account via `{ stripeAccount }` (direct charges; no application fee, matching deposits). Statement descriptor is the venue's own, aiding dispute recognition.

### 8.2 Purpose constants

Add to `RESERVE_NI_PI_PURPOSE` (`src/types/class-commerce.ts`):

```ts
CARD_HOLD_SETUP: 'card_hold_setup',              // SetupIntent metadata
CARD_HOLD_NO_SHOW_FEE: 'card_hold_no_show_fee',  // charge PI metadata
```

(`payment_with_setup` PIs keep their existing purpose; the hold is discovered via hold rows.)

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
    idempotencyKey: `card-hold-charge-${hold.id}-${attempt}`,  // attempt = 0 or persisted retry counter
  },
);
```

One successful charge per hold (state check + unique index). Partial-then-full charging is impossible in v1.

### 8.4 SCA / MIT compliance

SCA runs at save time (SetupIntent or `setup_future_usage` payment; `PaymentElement` handles 3DS inline, on the booking flow or the `/pay` page). The later charge is merchant-initiated (`off_session: true`), using the save-time authentication as the mandate basis; the consent text (7.5) plus the explicit save action is the mandate evidence. This mirrors Stripe's documented no-show-fee pattern.

### 8.5 Charge failure handling

| Error `code` | Meaning | v1 behaviour |
|---|---|---|
| `card_declined`, `expired_card`, `insufficient_funds`, ... | Issuer refused | Record `charge_failure_code`/`charge_failure_at`; keep `'Card Held'`; `events` `card_hold_charge_failed`; 402: `The card was declined ({reason}). You can try again, or contact the client to arrange payment.` Retries allowed within the window (attempt counter feeds the idempotency key). |
| `authentication_required` | Issuer demands 3DS; impossible off-session | Same recording; message: `The card issuer requires the client to authorise this payment in person. Off-session charging is not possible for this card.` Cancel the stray `requires_action` PI. No on-session fallback in v1 (Section 19). |

Never mutate `deposit_status` on failure.

### 8.6 Webhook changes

Purpose branches run **before** the generic `metadata.booking_id` confirm path.

1. **`payment_intent.succeeded`**, purpose `card_hold_no_show_fee`: source-of-truth completion. Find the hold by `charge_payment_intent_id` (or `metadata.booking_id`, then set it). Set `charged_pence` (`amount_received`), `charged_at`; booking `'Charged'`; `events` `card_hold_charged`; receipt email in `after()`. Idempotent.
2. **`payment_intent.succeeded`**, generic + `CLASS_CART_CHECKOUT`: funnel into the extended per-row confirm (7.4); no new branch beyond that.
3. **`payment_intent.payment_failed`**, purpose `card_hold_no_show_fee`: record failure fields; do not touch booking status. (Generic failure path touches `'Pending'` rows only; `payment_with_setup` rows still `Pending` are correctly included: the capture failed.)
4. **`setup_intent.succeeded`** (new event type): backup confirm; `confirmBookingsForSucceededSetupIntent()`. Enable on the Stripe webhook endpoint (deployment checklist).
5. **`setup_intent.setup_failed`** (new event type): informational log (client handles inline failure; crons clean up abandonment).
6. **`charge.refunded` / `charge.refund.updated`**: existing lookup by `bookings.stripe_payment_intent_id` misses fee PIs; add purpose branch: fee-PI refund -> booking `'Refunded'`, hold released (`'refunded'`), `events` `card_hold_charge_refunded`. Idempotent.

---

## 9. Staff surfaces

### 9.1 Booking detail display

`BookingDetailContent.tsx` deposit block:

| State | Pill | Detail line |
|---|---|---|
| `'Pending'` + open unsaved hold (staff flow, awaiting card) | `Card request sent` (existing pending styling) | `Waiting for the guest to add card details. No-show fee up to {fee}.` + **`Resend link`** action (9.2b) |
| `'Card Held'`, not released | `Card held` (teal/info) | `No-show fee up to {fee}. No payment taken.` |
| `'Card Held'`, released | `Card hold ended` (neutral) | `The card hold was released on {date}.` |
| `'Charged'` | `No-show fee charged` (amber) | `{amount} charged on {date}.` |
| `'Refunded'` (was `'Charged'`) | `No-show fee refunded` (existing refunded styling) | `{amount} refunded.` |
| last charge attempt failed | keep `Card held` | append `Last charge attempt failed: {plain reason}.` |

`GET /api/venue/bookings/[id]` gains `card_hold: { fee_pence, saved: boolean, charged_pence, charged_at, released_at, charge_failure_code, charge_window_ends_at } | null`. Verify every existing deposit-action gate (they key on values card holds never occupy).

### 9.2 Deposit-route actions (`POST /api/venue/bookings/[id]/deposit`)

**(a) `charge_no_show_fee`** (new): `{ action:'charge_no_show_fee', amount_pence?: number }`. Guards in order, distinct 4xx codes; deliberately **no feature-flag guard** (6.1):
1. Admin session (`requireAdmin`): 403 `admin_only`.
2. Hold row exists: 404 `no_card_hold`.
3. `status === 'No-Show'`: 409 `not_no_show` (`Mark the booking as a no-show before charging the fee.`).
4. `deposit_status === 'Card Held'`: 409 `invalid_state`.
5. `released_at IS NULL` and within window: 409 `hold_released` / `hold_expired`.
6. `stripe_payment_method_id` present: 409 `no_saved_card`.
7. `amount_pence` (default `fee_pence`) within `[1, fee_pence]`: 400 `invalid_amount`.
Then create the PI (8.3); on synchronous success apply webhook-equivalent state (idempotent either way); `logBookingOp` (`card_hold_charge`); `events` row; cross-venue -> `recordBookingWriteAudit` (`edited_booking`). `200 { ok, charged_pence, payment_intent_id }` or `402 { code, message }`.

**(b) `send_payment_link`** (extended): when the booking has an open **unsaved** hold (`deposit_status='Pending'` + hold row, no `stripe_payment_method_id`), send the **card-request** comms instead of the deposit-request comms: delete prior `card_hold_request_sms`/`card_hold_request_email` comm-logs, reuse `createOrGetPaymentShortLink`, send via the card-request sender (10.3). Same guest-contact 400 and 422-if-no-channel semantics. Deposit behaviour for non-hold bookings unchanged.

**(c) `waive`** (extended): on a `Pending` booking with an open unsaved hold, waiving releases the hold (`release_reason:'admin'`, best-effort customer deletion per the shared-customer rule in 9.4) and sets `deposit_status:'Waived'`, leaving status handling exactly as today's deposit waive (staff confirm the booking via the normal status actions).

**(d) `refund`** (extended): when `deposit_status === 'Charged'`, refund against `hold.charge_payment_intent_id`; on success (or webhook 8.6.6): `'Refunded'`, hold released (`'refunded'`). Button relabels `Refund no-show fee`. Admin-only.

**Charge UI (booking detail):** destructive-styled `Charge no-show fee` when the client-side mirror of guards 2-6 passes and viewer is admin. Dialog: title `Charge no-show fee`; body `Charge {guestName}'s saved card for missing this booking. The maximum you can charge is {fee}.`; amount input pre-filled, max = fee; confirm `Charge {amount}`; 402 messages inline. Appears in every `BookingDetailContent` surface automatically.

**Class roster:** `ClassInstanceDetailSheet.tsx` attendee rows: after a roster no-show, chargeable attendees show a compact `Charge no-show fee` affordance for admins (same endpoint + dialog). Non-admin staff see state only.

### 9.3 No-show and cancel interplay

- **Staff PATCH No-Show:** paid-deposit forfeit branch untouched (holds are never `'Paid'`). **Do not auto-charge.** `no_show_notification` gains no charge language.
- **Class roster no-show:** Phase 0 fixes the status string (D9); the roster then feeds the same gate. (It still does not forfeit paid deposits and does not enforce the grace window; pre-existing, out of scope, Section 19.)
- **Undo No-Show:** `'Card Held'` -> nothing to restore. `'Charged'` -> stays `'Charged'`; refund is explicit.
- **Cancels release the hold** in every path: staff PATCH cancel, `staff-cancel-booking.ts`, guest `/api/confirm` cancel, cart `rollbackGroup`, `restoreAndReleaseClassBookings` when it cancels rows, and the auto-cancel cron (12.1): set `released_at`, `release_reason:'cancelled'`, `events` `card_hold_released`, and best-effort delete the booking-scoped customer **only when no other live hold shares it** (a cart cancel of one line must not detach the card sibling holds rely on: check for open sibling holds on the same `stripe_customer_id` first). Credit/allowance restore logic is unrelated and unchanged.

---

## 10. Guest surfaces and comms

### 10.1 Manage page (`ManageBookingView.tsx`)

- `GET /api/confirm` gains the guest-safe hold summary.
- `'Card Held'`, open: `Your card is securely on file. {venueName} may charge a no-show fee of up to {fee} if you miss this booking. Cancel before it starts to avoid any charge.`
- `'Charged'`: `A no-show fee of {amount} was charged for this booking on {date}.`
- Cancel: unchanged UI; the path releases the hold. Success copy for a card-hold booking: `Your booking is cancelled. Your card will not be charged and the card hold has been released.` Verify the late-cancel "non-refundable" branch (keyed on paid deposits) does not fire for holds.
- Reschedule/modify (incl. `guest_self_reschedule` flows): hold carries over untouched, same card, same fee snapshot; if the modify changes the entity to one with a different fee, **keep the original snapshot** (consented amount); code comment required.

### 10.2 Confirmation and receipt emails

Templates in `src/lib/emails/templates/`, senders in `send-templated.ts`; the renderer varies nouns via `bookingLabel(booking)`.

1. **Booking confirmation** (all models): with an open hold, append: `No payment has been taken. Your card is securely on file and {venueName} may charge a no-show fee of up to {fee} if you do not attend. Cancel before your booking starts to avoid any charge.`
2. **No-show fee receipt** (new `card-hold-charged.ts`, comm-log type `card_hold_charged_email`), sent on charge success:
   - Subject: `No-show fee charged: {venueName}`
   - Body: `You missed your {bookingLabel} at {venueName} on {date} at {time}. As set out when you booked, a no-show fee of {amount} has been charged to your saved card. If you think this is a mistake, please contact {venueName} directly.` Standard footer.
3. No SMS receipt in v1 (email is the receipt of record). CDE reminder crons (`cde_reminder_1/2`) unchanged.

### 10.3 Card-request comms (staff flow)

New message keys, modelled exactly on the deposit-request pair (policies `EMAIL_AND_SMS`; per-venue channel gating reuses the existing deposit-request toggles via `policy-resolver.ts`, i.e. `deposit_request_email_enabled` and the `deposit_request_sms` policy govern both request kinds in v1, avoiding new settings):

1. **`card_hold_request`** (email `card_hold_request_email` + SMS `card_hold_request_sms`), sent automatically at staff create (7.6) and by `send_payment_link` re-sends (9.2b). New sender `sendCardHoldRequestNotifications(booking, venue, venueId, paymentLink)` beside `sendDepositRequestNotifications`.
   - Email subject: `Add your card details to confirm your booking at {venueName}`
   - Email heading: `Card details needed`
   - Email body core: `No payment is taken now. Add your card details to secure your booking. {venueName} may charge a no-show fee of up to {fee} if you do not attend.` CTA button: `Add card details` -> the payment link. Include the standard booking summary block (date, time, party size or service, venue address) as the deposit-request email does.
   - SMS: `{venueName}: card details needed to secure your booking for {date} at {time}. No payment is taken now. Add: {link}` (respect the 160-char cap pattern; drop the reassurance clause first if over).
2. **`card_hold_payment_reminder`** (email + SMS), sent by the reminder cron (12.1): same shapes with `Reminder:` prefixed to the SMS and subject `Reminder: add your card details to confirm your booking at {venueName}`.

Renderer cases, policy entries, and policy-resolver mappings follow the `deposit_payment_request`/`deposit_payment_reminder` precedents exactly. Comm-log types added in Migration B2 (5.3).

---

## 11. Events, audit, observability

- `events` rows: `card_hold_saved`, `card_hold_charged`, `card_hold_charge_failed`, `card_hold_charge_refunded`, `card_hold_released`, payloads `{ booking_id, fee_pence | charged_pence | failure_code | release_reason }`. Surface automatically in the booking timeline. (`class_no_show` unchanged and complementary.)
- `logBookingOp`: operations `card_hold_charge`, `card_hold_charge_failed`.
- Cross-venue writes: `recordBookingWriteAudit` (9.2a).

---

## 12. Crons

### 12.1 Abandoned capture cleanup and staff-flow timeout (extend `auto-cancel-bookings`)

Two arms, mirroring the two existing sweeps:

- **Online 30-minute arm** (generalise the class-cart sweep): rows `status='Pending' AND deposit_status='Pending' AND source='online'` older than 30 min joined to `booking_card_holds`. Setup-mode units: retrieve the SI; if `requires_payment_method` or `canceled` -> cancel rows (`'Cancelled'`/`'Failed'`, `cancellation_actor_type:'system'`), `events` `auto_cancelled` (`reason:'card_hold_setup_abandoned'`), release holds (`'abandoned'`), delete the customer, restore entitlements for any covered siblings via the existing machinery. `requires_action`/`processing` waits for the next sweep. `payment_with_setup` units are covered by extending the existing PI-status check beyond class carts.
- **Staff 24-hour arm** (mirror the phone deposit sweep): rows `status='Pending' AND deposit_status='Pending' AND source IN ('phone','walk-in')` older than 24h **with a hold row** (the walk-in source is included here because card holds, unlike deposits, are allowed for walk-ins, D6): validated transition to `Cancelled`, `events` `auto_cancelled` (`reason:'card_hold_setup_timeout'`), release + customer deletion, `auto_cancel_notification` comms and staff push exactly as the deposit sweep. The existing phone deposit sweep predicate is untouched (hold rows never carry `deposit_amount_pence`, deposit rows never have hold rows; the arms partition cleanly).

### 12.2 Card-request reminder (extend `deposit-reminder-2h`)

Add a second selection to the cron: `status='Pending' AND deposit_status='Pending' AND source IN ('phone','walk-in')` created 2-2.5h ago **with an open unsaved hold**; regenerate the short link; send `card_hold_payment_reminder` (10.3). The deposit selection and message are untouched.

### 12.3 Hold release (new cron `/api/cron/release-card-holds`)

- `src/app/api/cron/release-card-holds/route.ts`, `GET`/`POST`, `requireCronAuthorisation()`, `vercel.json` daily `30 5 * * *`. Document in `Docs/DEVELOPMENT.md`.
- `CARD_HOLD_CHARGE_WINDOW_DAYS = 14` in `card-hold-terms.ts`; `charge_window_ends_at` = booking end + 14 days (derived).
- Sweep: holds `released_at IS NULL` whose booking ended > 14 days ago (any status, including uncharged No-Show and Completed): `released_at`, `release_reason:'expired'`, `events` `card_hold_released`, best-effort `stripe.customers.del` with the shared-customer check (last open hold deletes the customer). Stripe deletion failure logs and continues (the charge guard keys on `released_at`; an undeleted customer is a cleanup miss, not a security hole).
- Inline releases on cancel/waive/refund do the same; the cron is the backstop and expiry path.

### 12.4 Reconciliation and recurring materialization

- `reconciliation`: add `'Card Held'` (not released): retrieve the saving intent (SI, or unit PI for `payment_with_setup`); alert if not `succeeded` or PM detached. Add `'Charged'`: retrieve `charge_payment_intent_id`; alert if not `succeeded`. Reuses `reconciliation_alerts` unchanged.
- `materializeRecurringReservation`: add `card_hold` to the skip (no guest present to save a card; booking without the hold would violate 1.3). Message: `Auto-booking is only supported for classes with no online card requirement.`

---

## 13. Reporting

- RPC change (5.4); pass-through in `reports/route.ts` (`report4_deposit`); `ReportsView.tsx` deposit section gains `No-show fees charged: {amount} ({count})` and `Active card holds: {count}`, visually separate from deposits collected.
- `report_by_booking_model` intentionally unchanged in v1 (code comment required).

---

## 14. State machine and edge cases

`deposit_status` transitions introduced (all others unchanged):

```
Pending ──(card saved: confirm route or webhook; setup OR payment_with_setup)──▶ Card Held
Pending ──(capture abandoned online 30m / staff link timeout 24h: cron 12.1)──▶ Failed (online) / Cancelled row
Pending ──(staff waive action on an unsaved hold)───────────────────────────────▶ Waived (+ hold released)
Card Held ──(admin charge succeeds; status must be No-Show)────────────────────▶ Charged
Card Held ──(cancel / expiry / abandonment / admin release)──▶ Card Held + released_at   (terminal)
Charged ──(admin refund or Stripe refund webhook)────────────▶ Refunded (+ released_at)  (terminal)
```

Booking `status` machine unchanged. Charge eligibility = `status='No-Show' AND deposit_status='Card Held' AND released_at IS NULL AND now() <= charge_window_ends_at`.

| Scenario | Behaviour |
|---|---|
| Guest abandons at the online card step (any model) | `Pending/Pending`; 30-min sweep cancels, releases, restores entitlements where consumed |
| Staff booking: guest never opens the link | 2h reminder; 24h auto-cancel with `auto_cancel_notification`, hold released, customer deleted (12.1) |
| Staff booking: link expired but guest wants to save | Staff `Resend link` regenerates (24h TTL) via `send_payment_link` (9.2b) |
| Staff toggles the card hold off at create | Booking `Booked`/`'Not Required'`; no hold ever exists; no link sent (D6) |
| Staff waives after sending the link | `'Waived'`, hold released, link 404s ("already completed") |
| Guest cancels early or late | Cancel proceeds; hold released; no charge ever possible (D3) |
| Staff cancels | Same |
| Guest reschedules / self-reschedules | Hold carries over, fee snapshot unchanged (10.1) |
| No-show, venue charges full or partial fee | `Charged` (clamp `[1, fee]`); one charge per hold; receipt email |
| No-show, venue does nothing | Hold expires 14 days after the booking; card detached |
| Charge declined / requires 3DS | Hold stays chargeable; retry within window; plain surfacing (8.5) |
| Undo No-Show after charge | Status reverts; money untouched; refund explicit |
| Charged then disputed | Direct charge on the venue's account; evidence = terms snapshot + booking + events trail (15) |
| Flag disabled after holds exist | Existing holds chargeable/refundable/releasable; only new-hold creation stops (6.1) |
| Venue disconnects Stripe | Charges fail at Stripe; snapshotted account id keeps refunds/cleanup routed |
| Group appointment, one member no-shows | That row alone is marked and charged (per-row holds) |
| Class cart: paid line + card-hold line | `payment_with_setup`: paid line `'Paid'`, hold line `'Card Held'`, one card entry |
| Class cart: credit-covered line + card-hold line | Credit consumed for the covered line (already `Booked`); hold line `Pending` until saved (`setup`); abandonment cancels only the hold line |
| Card-hold line cancelled from a multi-line cart | Its hold releases; shared customer survives while sibling holds remain open (9.3) |
| Member books a card-hold class | Identical to non-member: free, card held; no allowance consumed (D8) |
| `pay_with_class_credits` on a card-hold class | 400: nothing to pay (7.1) |
| Recurring reservation hits a card-hold class | Materialization skips with message (12.4) |
| Event booking with N tickets no-shows | One booking, one hold, fee = per-person x N; all-or-nothing (Section 4) |
| Table booking under the party threshold (online) | `deposit_required` false, so no hold: threshold gates protection exactly as it gates deposits (D5) |
| Staff table booking, toggle on, no per-person amount configured | 400, mirroring the deposit staff path |
| Walk-in future booking with card hold | Allowed (D6); staff 24h arm covers timeout |
| Roster no-show then charge | Works: roster writes canonical `'No-Show'` after the Phase 0 fix (D9) |

---

## 15. Security, compliance, privacy

- **PCI:** card data never touches ResNeo servers (Stripe Elements on the booking flows and the `/pay` page).
- **SCA/MIT:** Section 8.4; consent text + snapshot is the mandate record for all three save paths (online setup, online payment_with_setup, `/pay` page setup). The consent is always displayed on the surface where the card is entered.
- **Authorization:** charging/refunding admin-only server-side (`requireAdmin`); all Stripe mutations service-role; `booking_card_holds` has no RLS policies. The `/pay` page is token-gated (HMAC, 24h) and rate-limited, as today.
- **Disputes:** evidence per charge: `terms_snapshot` (exact consent text, unit fee, `accepted_at`), booking record (entity, date/time, party/tickets), events trail (`booking_created`, `card_hold_saved`, no-show transition, `card_hold_charged`). No automated evidence submission in v1.
- **GDPR/data minimisation:** the saved card lives only while a hold can still be charged; release deletes the booking-scoped Stripe customer (detaching the PM), subject to the shared-customer check. Stripe ids remain on hold rows for audit. `account-hard-delete` anonymisation unaffected.
- **Abuse guards:** server-side clamp to the consented fee; single-charge enforcement; grace-window gate on the PATCH no-show path.

---

## 16. Implementation plan (phased, with file-by-file checklist)

Each phase leaves the app shippable with the flag off.

### Phase 0: foundations and pre-existing fixes
1. **Fix the class roster no-show status string** (D9): `class-attendance.ts` ~126/131 `'No Show'` -> `'No-Show'`; verify against a real database; regression test; audit for other space-variant literals.
2. Migrations A, B, B2 (5.1-5.3).
3. `src/lib/booking/card-hold-terms.ts` (consent template, `CARD_HOLD_CHARGE_WINDOW_DAYS`, fee formatting) and `src/lib/booking/card-hold-capture.ts` (7.0).
4. Feature flag plumbing (`types.ts`, `resolve.ts`, both flag UIs, `Docs/FEATURE_FLAGS.md`).
5. Purpose constants (8.2). Type updates: `deposit_status` unions + display-label maps (grep `'Forfeited'`); `ClassPaymentRequirement` union + every exhaustive switch (6.4); `booking_restrictions`/slot types gain `deposit_type`.

### Phase 1: configuration
6. `appointment-service-payment.ts` (6.3); table engine `deposit_type` passthrough (`engine.ts`, `resolveDepositPerPersonGbp`, slot type).
7. Editor forms + payload/zod + flag gating: appointment services (incl. onboarding), service items, class types, events (zod is the only gate), resources, **table rules** (`ServiceBookingRulesSection.tsx` + `booking-restrictions` route schema + invariant), legacy `deposit-config` route + `depositConfigSchema` `type` (6.2).
8. Slot TS types widened; `validate-event-ticket-booking.ts` returns `cardHoldFeePence`.

### Phase 2: online booking flows
9. `POST /api/booking/create`: capture-mode integration across table, appointment, class, event, resource branches; `pay_with_class_credits` rejection (7.1). Then `create-multi-service`, `create-group`.
10. Class cart: quote fields, orchestration modes, rollback customer cleanup, response types, `insertPendingPaidClassSessionBooking` null-money support (7.2).
11. `PaymentStep.tsx` modes + copy; prop threading in all five flows; confirmation screens; catalog fee lines (7.3).
12. Confirm paths: `confirmBookingsForSucceededSetupIntent()`, per-row extension of the PI confirm, `confirm-payment` schema incl. `booking_id` resolution (7.4).
13. Webhook: `setup_intent.succeeded`/`setup_failed`; enable event types on the Stripe endpoint (deployment note) (8.6).

### Phase 3: staff flow
14. `POST /api/venue/bookings`: `require_card_hold` semantics across all five model branches; extend `applyStaffBookingPaymentAndComms` with the card-hold variant; staff table fee path (7.6).
15. `UnifiedBookingForm.tsx`: Card hold toggle + toast (7.6).
16. `GET /api/booking/pay` setup mode + `/pay` page branch, consent rendering, success copy (7.7).
17. Card-request comms: templates (email/SMS), `sendCardHoldRequestNotifications`, renderer cases, policies + policy-resolver mappings, reminder key (10.3).

### Phase 4: staff charge + guest visibility
18. `GET /api/venue/bookings/[id]`: `card_hold` object incl. `saved` (9.1).
19. Deposit route: `charge_no_show_fee`, `send_payment_link` card-aware re-send, `waive` release, `refund` for `'Charged'` (9.2).
20. Webhook purpose branches for the fee PI (8.6.1/3/6).
21. `BookingDetailContent.tsx` pills (incl. awaiting-card + resend), charge dialog, refund relabel; `ClassInstanceDetailSheet.tsx` roster affordance (9.1, 9.2).
22. Hold release on every cancel path incl. shared-customer check (9.3).
23. `GET /api/confirm` + `ManageBookingView.tsx` guest copy incl. cancel success message (10.1).
24. Emails: confirmation hold section, `card-hold-charged.ts` + sender (10.2).
25. Events + `logBookingOp` + cross-venue audit (11).

### Phase 5: lifecycle hygiene
26. `auto-cancel-bookings`: online 30-min arm + staff 24h arm (12.1).
27. `deposit-reminder-2h`: card-request reminder arm (12.2).
28. New cron `release-card-holds` + `vercel.json` + `Docs/DEVELOPMENT.md` (12.3).
29. `reconciliation` extension; `materializeRecurringReservation` skip (12.4).
30. Reports: Migration C, route pass-through, `ReportsView.tsx` tiles; `Docs/schema.sql` (13).

### Phase 6: docs and rollout
31. Help centre: deposits articles gain a card-hold section (venue-side how-to incl. the staff toggle and link flow; guest-facing copy review). CLAUDE.md copy rules apply.
32. Update this document's status header; add a row to `Docs/Resneo-Appointments-Review-And-Roadmap.md`.
33. Rollout: deploy flag-off; staging env flag; pilot one venue; watch `reconciliation_alerts`, webhook logs, first live charges and first staff-link bookings; then default-availability decision.

---

## 17. Test plan

### Unit (vitest, colocated)
- `resolveCaptureMode`: all outcomes; multi-line units.
- `appointment-service-payment`: `'card_hold'` explicitness, variant override, add-on exclusion, flag-off degradation.
- Table engine: `deposit_type` passthrough; threshold still gates `deposit_required`; legacy fallback incl. `type`.
- Fee math per model (class/event x party, resource flat, table per-person GBP -> pence).
- `card-hold-terms`: consent rendering, snapshot shape, window computation.
- Charge guard matrix (9.2a) as a pure function: every 4xx.
- Staff route `require_card_hold` semantics per model: default on, waive-off -> `'Not Required'`, walk-in allowed, table no-amount -> 400, deposit-toggle paths untouched.
- Webhook ordering: fee-PI success never reaches generic confirm; `payment_with_setup` confirms per-row.
- `class-attendance` writes `'No-Show'` (Phase 0 regression).
- Entitlement engine untouched by card-hold lines; `pay_with_class_credits` rejection.
- Display-label maps cover both new `deposit_status` values; comm renderer cases for the new keys.

### Integration (mocked Stripe)
- Each model online: create -> save -> `'Card Held'` (route and webhook, idempotent overlap). Tables: threshold boundary (party at/below threshold).
- Staff flow per model: create with toggle on -> `Pending` + SI + link comms enqueued; `/api/booking/pay` returns setup payload; confirm via `booking_id` -> `'Card Held'`; toggle off -> `'Booked'/'Not Required'`, no hold; waive after send -> `'Waived'` + released + pay 404.
- Re-send: comm-log deletion + re-send; 422 when no channel.
- Class cart matrices: paid+hold, covered+hold, hold-only, covered-only; PM propagation; rollback deletes customer.
- Abandonment: online 30-min (setup + payment_with_setup) and staff 24h arms; releases, customer deletion, entitlement restore, `auto_cancel_notification`.
- No-Show (PATCH and roster) -> charge -> `'Charged'` + events + receipt; double-click -> one PI; declines (`card_declined`, `authentication_required` with stray-PI cancel); retry.
- Cancels from every path release; shared-customer survival for multi-line carts.
- Refund of a charged fee -> `'Refunded'` + released.
- Reconciliation alerts for both new states; release cron expiry + deletion-skip logic; recurring skip.

### Manual E2E (Stripe test mode, connected test account)
| Card | Expectation |
|---|---|
| `4242 4242 4242 4242` | Saves; off-session charge succeeds |
| `4000 0025 0000 3155` | 3DS at save; off-session charge later raises `authentication_required` |
| `4000 0000 0000 0341` | Attaches; off-session charge declines |

Staging walkthrough: configure one card-hold entity per model incl. a table service; book each online (copy + £0, or amount + save line); phone-create a table booking with the toggle on, receive the SMS/email, save the card via `/pay`, verify confirm; phone-create with the toggle off; let one staff booking time out (reminder at 2h, auto-cancel at 24h); class cart with membership coverage + card-hold class; PATCH no-show inside grace (refused) and after; roster no-show + roster charge; partial charge; receipt email; reports tiles; refund; hold expiry via cron with customer deletion; recurring skip message.

---

## 18. API contract summary (quick reference)

| Surface | Change |
|---|---|
| `POST /api/booking/create` (+ `create-multi-service`, `create-group`) | Response adds `payment_mode`, `card_hold_fee_pence`; setup mode returns a SetupIntent `client_secret` |
| `POST /api/booking/class-cart/checkout` (+ `/quote`) | Same additions; quote lines add `card_hold_fee_pence` |
| `POST /api/booking/confirm-payment` | Accepts `setup_intent_id` (XOR `payment_intent_id`); `booking_id` form resolves to the booking's PI or hold SI |
| `POST /api/venue/bookings` | New `require_card_hold` (default true for card-hold entities, all models, phone and walk-in) |
| `GET /api/booking/pay` | Eligibility: PI **or** open unsaved hold; setup payload `{ payment_mode:'setup', client_secret, card_hold_fee_pence, ... }` |
| `GET /api/venue/bookings/[id]` | Adds `card_hold: {...} | null` |
| `POST /api/venue/bookings/[id]/deposit` | New `action:'charge_no_show_fee'`; `send_payment_link` card-aware; `waive` releases; `refund` handles `'Charged'` |
| `GET /api/confirm` | Guest-safe hold summary |
| `POST /api/webhooks/stripe` | New event types `setup_intent.succeeded`/`setup_failed`; purpose branches for `card_hold_no_show_fee`; per-row confirm |
| `POST/PATCH /api/venue/booking-restrictions` | `deposit_type` field |
| `PATCH /api/venue/deposit-config` | `type` field |
| `GET/POST /api/cron/release-card-holds` | New cron |
| Entity editors' write APIs | `payment_requirement` unions accept `'card_hold'` (flag-gated) |

---

## 19. Future work (explicitly not v1)

1. **Fee payment link fallback** for `authentication_required` declines: on-session pay page charging the fee with 3DS.
2. **Late-cancellation fees**: charge window opening on late cancel, not just No-Show; new consent text, policy config, manage-page copy.
3. **Compound per-entity config**: "charge a deposit AND hold for a further no-show fee" on one entity (`payment_with_setup` already supports the capture; this is config/UX).
4. **Roster no-show parity**: grace window + paid-deposit forfeiture on the class roster path (pre-existing inconsistency).
5. **Waitlist integration** if/when CDE waitlists ship.
6. **Course session no-show fees.**
7. **`booking_payments` ledger rows** for card-hold charges once the Tap to Pay ledger ships.
8. **Automated dispute evidence** assembly from the terms snapshot + events trail.
9. **Retiring the dead `phone_requires_deposit` legacy config field** (2.1), independent cleanup.
