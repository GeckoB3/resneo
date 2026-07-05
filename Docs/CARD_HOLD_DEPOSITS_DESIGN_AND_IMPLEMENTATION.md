# Card Hold Deposits: Design and Implementation Document

**Status: Implemented (5 July 2026). This document was the implementation spec; the feature shipped on branch docs-review behind the `card_hold_deposits` flag (default off). Retained as the design reference.**
Adversarially reviewed against the codebase on 4 July 2026 in two rounds (six independent verification passes: Stripe mechanics, booking/staff flows, lifecycle/comms, amended-claims verification, implementability walkthrough, fresh-eyes code sweep); all confirmed findings are folded into this text.

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
- Availability engine (`src/lib/availability/engine.ts:678-757`): slot `deposit_required` = per-person amount > 0 AND `partySize >= deposit_required_from_party_size` (`depositThresholdMet`, engine.ts:375-378, reads the restriction threshold only); slot `deposit_amount` = per-person GBP x party. **These are the only online gates.** The legacy `venues.deposit_config` contributes only `amount_per_person_gbp` as an amount fallback (`src/lib/availability/fetch.ts:193-199`). Settings UI: `src/app/dashboard/availability/components/ServiceBookingRulesSection.tsx`.
- **Dead legacy config (verified):** `deposit_config.phone_requires_deposit`, `weekend_only`, `min_party_size_for_deposit`, and `enabled` are written by onboarding and typed, but never read by any booking path. The engine threshold is the sole online gate; the staff toggle is the sole phone gate (2.8). A legacy-config-only venue (no restriction row threshold) can never trigger an online deposit.

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
- **Re-send:** deposit route `send_payment_link`: requires guest email or phone (400 otherwise), does NOT create a missing PI, deletes prior `deposit_request_sms`/`deposit_request_email` comm-logs (dedupe bypass), sends `sendDepositRequestNotifications` (both channels gated by the `deposit_payment_request` communication policy; SMS additionally requires `guest_phone`), 422 if neither channel sent.
- **Comms:** templates `deposit-request-email.ts` (subject "Pay your deposit to confirm your booking at {venue}", CTA "Pay deposit") and `deposit-request-sms.ts` (160-char cap); message keys `deposit_payment_request` and `deposit_payment_reminder` (defaults `EMAIL_AND_SMS` in `policies.ts`). Channel gating is per message key via the `venues.communication_policies` JSONB resolved by `resolveCommPolicy` (`policy-resolver.ts`, lookup `policies[lane][messageKey]`, log types via the explicit `LOG_MESSAGE_TYPE_MAP`). The venue column `deposit_request_email_enabled` is vestigial (only a test fixture references it); it does not gate live sends.
- **Staff deposit toggles today live in two places:** `UnifiedBookingForm.tsx` is the TABLE staff form only; the appointment staff toggle (`staffRequireDeposit`) lives in `AppointmentBookingFlow.tsx` (staff audience, ~578, 2100-2104, 3982). CDE staff creation goes through the Class/Event/Resource flows in staff audience (`venueBookingsCreateUrl()`, `src/lib/booking/booking-flow-api.ts:132-134`) plus `ResourceSlotBookingForm.tsx`, none of which have a deposit toggle today.

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

Two new values: **`'Card Held'`** and **`'Charged'`**. Every existing surface stays on one state machine. **Predicate caveat, load-bearing:** `deposit_status='Paid'` predicates are naturally false for card holds everywhere, which is correct. But `'Pending'` is **shared with deposits during capture** (a card-hold booking sits `Pending/'Pending'` until the card saves), so every existing `'Pending'` predicate that means "an unpaid deposit exists" must be amended to exclude hold rows: the two crons (12.1, 12.2), the confirm path (7.4), and the legacy deposit actions and their UI gates (9.1, 9.2). Do not trust "the values are new, nothing can match" reasoning for `'Pending'`. Hold internals live in **`booking_card_holds`** (one row per booking row, service-role only). `deposit_amount_pence` stays NULL for card-hold rows.

### D5. Configuration reuses each model's existing payment requirement and amount columns; tables get a `deposit_type` on their existing rules.

`'card_hold'` becomes a fourth requirement value where the enum exists. Tables have no requirement enum; instead the existing table deposit rules gain **`deposit_type: 'charge' | 'card_hold'`** (default `'charge'`). In both shapes, **the existing amount column holds the no-show fee** and the UI label switches to "No-show fee". Fee semantics mirror each model's deposit semantics:

| Model | Fee configured as | Booking fee snapshot |
|---|---|---|
| Appointment service / service item | fixed (`deposit_pence`, variant override, add-ons excluded) | the fixed amount |
| Class type | per person (`deposit_amount_pence`) | per-person x `party_size` (seats) |
| Event | per person (`deposit_amount_pence`, event-level) | per-person x `party_size` (tickets) |
| Resource | flat (`deposit_amount_pence`) | the flat amount |
| **Table** | per person GBP (`deposit_amount_per_person_gbp`), same party-size threshold and gates as today | per-person GBP x `party_size`, converted to pence (`Math.round(gbp*100)`) |

For tables, **the existing gates decide WHETHER protection applies**, and per 2.1 the real gates are: online, a restriction-row party threshold plus a per-person amount > 0 (nothing else; `weekend_only` and `min_party_size_for_deposit` are dead legacy config); staff, the per-booking toggle with the threshold not applied, mirroring deposits. **`deposit_type` decides WHAT KIND** (charge money vs hold card). **Legacy `deposit_config` fallback, stated precisely:** the legacy per-person amount is read as a fallback in BOTH the availability engine (`resolveDepositPerPersonGbp`) and the staff route, but online gating still requires a restriction-row threshold, so a legacy-only venue never triggers online protection. Therefore the `deposit_type` resolution rule is the same in both places: `restriction.deposit_type ?? deposit_config.type ?? 'charge'`, and it matters online only in the configuration "restriction supplies the threshold, amount falls back to legacy". The requirement remains exclusive per entity (no "deposit AND hold" on one entity; Section 19).

### D6. Staff-created bookings (phone and walk-in) support card holds via a secure-by-card link, with a per-booking staff toggle.

This mirrors the deposit-request flow the venue already knows (2.8): booking held `Pending`, link sent by email and/or SMS, 2-hour reminder, 24-hour auto-cancel, re-send action. Specifics:

- **Toggle:** the New Booking form shows a **"Card hold"** toggle **only when the selected entity's effective requirement is `card_hold`** (or, for tables, the service's rules have `deposit_type='card_hold'` with an amount configured). Default **on** (the entity requires it). Staff may switch it **off** case by case; the booking is then created exactly like a no-deposit booking (`'Booked'`/`'Not Required'`), matching today's create-time toggle-off semantics. The existing "Require deposit" toggle and its per-model semantics are untouched; the two toggles are never shown together (an entity is either deposit-type or card-hold-type).
- **Applies to all five models.** Unlike `require_deposit` (which CDE ignores), the card-hold toggle is honoured for tables, appointments, classes, events, and resources: the user requirement is explicit per-booking discretion everywhere.
- **Walk-ins included.** Deposits are hard-off for walk-ins today and stay that way. Card holds are **allowed** for walk-in bookings: a guest standing at the desk booking a future slot is exactly the no-show risk this feature addresses, and the link lands on their own phone. (For a truly immediate walk-in the toggle is pointless; staff switch it off.)
- **Channel selection** mirrors deposits mechanically: email is attempted subject to the venue's communication policy for the message key; SMS is sent when the guest has a phone number, subject to the same policy. Staff do not pick a channel; at least one channel must succeed (422 otherwise on re-send). The card-request keys get their own policy entries (10.3).
- **Consent** is displayed and accepted on the `/pay` page at card-save time (the guest sees the exact consent text before saving); `terms_snapshot.accepted_at` is stamped at confirm, same as online.
- **Cross-venue creation (linked accounts):** `POST /api/venue/bookings` resolves the OWNER venue for entity, Stripe account, and comms; the card-hold toggle and hold creation are gated on the **owner venue's** `card_hold_deposits` flag, and the hold rides the owner venue's connected account.
- **The linked-calendar cross-venue CREATE route is rejected for card-hold entities.** `POST /api/venue/linked-calendar/booking` (~156-298) creates owner-venue appointment bookings via the `linked_apply_booking_insert` RPC with zero payment logic; a card-hold service booked through it would confirm with no hold, violating principle 1.3. v1: this route returns 400 `{ code: 'card_hold_service_unsupported' }` for services resolving to `card_hold`, with the message `This service requires a card hold. Create the booking from the main booking form.` (Deposit-type services already behave analogously today by simply not collecting; card hold's promise is stronger, hence the explicit rejection.)
- **The quick-add walk-in route** (`/api/venue/bookings/walk-in`, inserts `'Seated'`/`'Not Required'` for a guest being seated now) needs **no** card-hold handling; do not "fix" it.
- **API-compat consequence of the default-on toggle:** `POST /api/venue/bookings` is also consumed by the mobile app (`Docs/MOBILE_API.md`) and `ResourceSlotBookingForm.tsx`, which do not send `require_card_hold`. Once a venue configures a card-hold entity, bookings from those clients default to hold-required (`Pending` + auto-sent link) with no visible waive control until those UIs are updated. This is the correct default (the venue opted in per entity and per flag), but it is a behaviour change for unupdated clients: Phase 3 adds the toggle to `ResourceSlotBookingForm`, and the rollout notes (Section 16) must flag the mobile app.

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
- **Waitlist special-casing.** Two facts, verified: (a) guest-facing appointment waitlist **offer conversions go through `POST /api/booking/create`** (`waitlist_offer_id`), so card holds apply to them automatically: de facto in scope, and tested (Section 17). (b) The staff **table**-waitlist confirm (`PATCH /api/venue/waitlist`, `route.ts:362-380`) inserts a `'Booked'`/`'Not Required'` row directly, bypassing the staff create route; a card-hold table service converted this way gets no hold. This is an **accepted v1 gap** (staff can send a card request only by policy discussion; the conversion is a deliberate staff act), noted here so it is not mistaken for an oversight.
- **Courses** (prepaid; per-session no-show economics deferred).
- **Partial ticket no-show for events** (ticket-line edits rejected today; fee is per booking).
- **Tap to Pay / `booking_payments` ledger**; **multi-currency** (`'gbp'` hardcoded, matching every existing PI).
- **Import tool**: imported bookings never carry holds.
- **Booking-creator inventory, remaining entries (for completeness; no hold handling):** the seed scripts (`scripts/seed-e2e-smoke-venue.mjs`, `seed-live-test-bookings.ts`, `seed-plus1-demo-bookings.mjs`) insert booking rows directly and never create holds; `src/lib/booking/create-appointment-from-waitlist.ts` is dead code (imported only by its own test) and must gain hold handling if ever revived; the linked-calendar create route rejects card-hold services (D6).

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
  charge_attempt_count int NOT NULL DEFAULT 0,  -- incremented atomically before each Stripe charge attempt; feeds the idempotency key

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
- Also add the new `communication_logs` message types in this migration. The mechanism is a **DROP-and-recreate CHECK constraint** (`communication_logs_message_type_check`), and the constraint has been superseded several times since the deposit migration. **Base the new list on the CURRENT constraint in `supabase/migrations/20261214120000_owner_booking_notification.sql` (~50 values), not on `20260402000000` (12 values): copying the stale list would silently break every comm type added since.** Recreate as a strict superset using the same `NOT VALID` + `VALIDATE CONSTRAINT` pattern that migration uses, adding: `card_hold_request_email`, `card_hold_request_sms`, `card_hold_payment_reminder_email`, `card_hold_payment_reminder_sms`, `card_hold_charged_email`. (The reminder log types are deliberately named after the message key `card_hold_payment_reminder`, matching the `deposit_payment_reminder` -> `deposit_payment_reminder_email/sms` mapping convention in `policy-resolver.ts:73-76`.)

### 5.4 Migration C: reporting RPC update

`report_deposit_summary` (`20260304000001_reconciliation_and_reporting.sql:219-238`) **`RETURNS jsonb`** built with `jsonb_build_object`, and the reports route passes the object through by named keys, so this is a plain `CREATE OR REPLACE` (no return-type change, no DROP needed) **adding three keys to the `jsonb_build_object`**:

```
no_show_fees_charged_pence  -- SUM(bch.charged_pence) where deposit_status='Charged'
no_show_fees_charged_count
card_holds_active_count     -- deposit_status='Card Held' AND bch.released_at IS NULL
```

LEFT JOIN `booking_card_holds` on `booking_id` (aggregation-safe: the unique index guarantees 1:1). Do **not** fold charged fees into `total_collected_pence`. New keys flow to `report4_deposit` automatically. Update `Docs/schema.sql` (table + enum additions + `booking_restrictions.deposit_type`).

---

## 6. Configuration and settings

### 6.1 Feature flag

- Key `card_hold_deposits`: `APPOINTMENTS_FEATURE_FLAG_KEYS`, `venueFeatureFlagsSchema` (`card_hold_deposits: z.boolean().optional()`), `ENV_BY_FLAG` (`'FEATURE_FLAG_CARD_HOLD_DEPOSITS'`). **Not** in `FLAG_DEFAULT_ON`. Surface in `FeatureFlagsSection.tsx` + `FlagsPageClient.tsx`; update `Docs/FEATURE_FLAGS.md`.
- **Normative flag rule:** the flag gates **creation of new holds** (config acceptance, booking-flow branches, staff-toggle visibility). It never gates charging, refunding, or releasing existing holds: the guest keeps the deal they consented to; the venue keeps the protection they were promised.

### 6.2 Editor surfaces (venue-facing)

Shared copy for the new option (all editors, rendered only when the flag resolves on):
- Option label: **"Card hold"**
- Helper text: `"No payment is taken when the client books. Their card is stored securely and you can charge a no-show fee if they do not attend."`
- Amount field relabels to **"No-show fee (£)"** (classes/events/tables: **"No-show fee per person (£)"**), writing the same column. Validation mirrors current deposit bounds per form; for classes **drop the "deposit <= price" constraint** when `card_hold` (no price relationship), cap at £150. **Every editor requires the fee to be at least £1 when `card_hold` is selected** (the hold table enforces `fee_pence > 0`; a zero-fee card hold must be impossible to configure, and resolution treats fee <= 0 as `'none'`-with-warning, 6.3).

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

**Onboarding forms:** `src/app/onboarding/page.tsx` contains its own inline class/resource/event forms with hardcoded `'none'|'deposit'|'full_payment'` unions (~141, 270, 343, plus a reader at ~2151), and `RestaurantSetupWizard.tsx` (~177-194) writes booking_restrictions and deposit-config. **These stay charge-only in v1** (no card-hold option during onboarding; venues configure it from the dashboard editors afterwards). The 6.4 guard-rail sweep must still make their readers exhaustive.

### 6.3 Resolution logic

- Appointments: `appointment-service-payment.ts`: `'card_hold'` must be **explicit** (legacy `deposit_pence > 0` inference stays `'deposit'`); `chargeLabel` union gains `'card_hold'`; fee = variant-adjusted `deposit_pence`, **add-ons never included**.
- Classes/events/resources: slots already surface `payment_requirement` + amounts; only TS unions widen. Events: extend `validate-event-ticket-booking.ts` to return `cardHoldFeePence` (per-person x validated party) so pricing stays server-derived.
- Tables: `resolveDepositPerPersonGbp` and the slot computation gain `deposit_type` passthrough using the rule `restriction.deposit_type ?? deposit_config.type ?? 'charge'` (same rule in the engine and the staff route, per D5); slot gains `deposit_type: 'charge' | 'card_hold'`. Online gates unchanged (threshold + amount, D5). **Staff-surface slot exposure (decided, not optional):** the staff toggle must know "card hold configured" even when the party is below the threshold, but the engine only populates `deposit_amount` when `deposit_required` is true. For slots served to the staff audience, expose the configured `deposit_type` and per-person amount **unconditionally** (threshold still gates `deposit_required` for the online decision). The client `Slot` mapping in `UnifiedBookingForm.tsx` (~54-61, 550-558) currently strips all deposit fields and must pass the new ones through.
- **Flag-off and zero-fee safety:** entity configured `card_hold` while the venue flag is off, **or with a resolved fee <= 0**, resolves as `'none'` (tables: `deposit_required=false`) with a `console.warn`; editors show: `Card hold is disabled for this venue; this service currently takes no deposit.` (or the zero-fee variant). Charging a deposit instead would take money the guest was never shown; inserting a hold with fee 0 would violate the table CHECK at booking time.

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

// payment_with_setup mode: today's PI create gains three fields
const pi = await stripe.paymentIntents.create(
  {
    amount: totalMoneyPence,
    currency: 'gbp',
    customer: customer.id,                 // NEW
    setup_future_usage: 'off_session',     // NEW: vaults the payment method on success
    payment_method_types: ['card'],        // NEW: card-only, replacing automatic_payment_methods
    metadata: { ...existingMetadata },
  },
  { stripeAccount },
);
```

**Why card-only on `payment_with_setup`:** with `automatic_payment_methods`, Stripe would offer any off-session-capable method the account has enabled (Link, PayPal, Revolut Pay, ...), vaulting a non-card method. That would make the consent copy ("your card details are stored") inaccurate and weaken dispute evidence, and the charge/failure handling (8.3, 8.5) assumes card semantics. Restricting to `['card']` (which still permits Apple Pay / Google Pay, as they tokenise to cards) narrows the visible method set relative to today's deposit flow for these units; that trade-off is accepted and deliberate. Plain `payment` mode is untouched. The `setup` mode SI is already card-only, matching the existing pattern in `src/app/api/account/payment-methods/setup-intent/route.ts`.

On Stripe failure during create: delete the unit's booking rows and the customer (mirror existing PI-failure cleanup); class carts run `rollbackGroup` (restores entitlements too).

### 7.1 Online direct bookings: `POST /api/booking/create`

Each model branch already computes `depositAmountPence` + `requiresDeposit`; extend each to compute `cardHoldFeePence` when the effective requirement is `'card_hold'` (flag on):

| Branch | `cardHoldFeePence` |
|---|---|
| Table (`~412-472`) | when `slot.deposit_required && slot.deposit_type === 'card_hold'`: `Math.round((slot.deposit_amount ?? 0) * 100)` (per-person x party, threshold gate already applied by the engine) |
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
5. **Response type:** the `'payment_required'` variant of `ClassCartCheckoutResponse` currently REQUIRES `payment_intent_id: string` and `checkout_charge_kind: 'deposit' | 'full_payment'` (`src/types/class-commerce.ts:126-137`); setup mode has neither. Make both optional (or union in a setup variant), add `payment_mode` + `card_hold_fee_pence`, and update the consumers (`ClassBookingFlow.tsx:561`, `ClassMultiSessionCart.tsx:26-34,199`). Note: `persistClassCartCheckoutTransaction` requires a non-null PI and is only invoked on the PI path; a setup-mode cart therefore has **no checkout-transaction audit row, which is intentional** (the hold rows are the record).

### 7.3 Payment step (online client)

`PaymentStep.tsx` gains `mode` (`'payment' | 'setup' | 'payment_with_setup'`, default `'payment'`), `cardHoldFeePence`, `venueName`. Confirm call: `mode === 'setup' ? stripe.confirmSetup({...}) : stripe.confirmPayment({...})`. On success, the confirm route is called with `setup_intent_id` (setup) or `payment_intent_id` (both payment modes).

Copy (exact strings):
- `setup` heading: `Secure your booking`; sub-heading: `No payment is taken today.`
- `setup` body: `Your card details are stored securely by our payment provider, Stripe. {venueName} may charge a no-show fee of up to {fee} if you miss your booking.`
- `payment_with_setup` keeps the amount display, plus: `Your card will also be stored securely. {venueName} may charge a no-show fee of up to {fee} if you miss your booking.`
- Consent line above the submit button in both hold modes (snapshotted, 7.5): `By saving your card you authorise {venueName} to charge up to {fee} if you do not attend. If you cancel the booking before it starts, nothing extra will be charged.`
- Submit: `setup` -> `Save card and book`; `payment_with_setup` keeps pay wording.

All five flows (`BookingFlow` for tables, `AppointmentBookingFlow`, `ClassBookingFlow`, `EventBookingFlow`, `ResourceBookingFlow`) thread the new props, plus `ClassMultiSessionCart.tsx` if it is revived (it consumes PaymentStep and the checkout API but is currently imported nowhere). Confirmation screens: `setup` -> `Card saved. No payment has been taken.`; `payment_with_setup` -> `Your card has been stored securely for this booking.` Public catalogs/service cards for card-hold entities: `No-show fee of {fee} applies. No payment is taken when you book.` (per person where applicable; tables surface it in the slot/summary step from `slot.deposit_type`).

**Suppress the legacy deposit and refund-policy copy in hold contexts.** The flows currently render deposit-charge copy wherever `requiresDeposit` is true, which stays true in hold modes: `DetailsStep.tsx` (~390-404) shows `Deposit of £{X} per person required` plus the `formatOnlinePaidRefundPolicyLine` refund text (`src/lib/booking/public-deposit-refund-policy.ts`: "Full refund if you cancel {h}+ hours before ... No refund ... or for no-shows"), and the flows pass the same line as `cancellationPolicy` into PaymentStep (e.g. `ClassBookingFlow.tsx:374-377,1040`). Left unsuppressed, the guest would read "Deposit required ... full refund if you cancel" beside "No payment is taken today." In `setup` mode (and for the hold portion of `payment_with_setup`), replace the deposit banner with the hold line from this section and omit the deposit refund-policy line (the consent line already states the cancellation rule for holds).

**Embed:** the embed flow (`EmbedBookingClient` -> `BookPublicBookingFlow` -> `BookingFlowRouter` -> the same flows, create routes, and PaymentStep) has zero embed-specific payment code, so setup mode works there without changes; the only embed-specific risk is a 3DS challenge during `confirmSetup` inside the iframe, covered by a manual E2E row (Section 17).

### 7.4 Confirm paths

`POST /api/booking/confirm-payment` accepts exactly one of `payment_intent_id` | `setup_intent_id` | `booking_id` (the pay page sends `booking_id` today; resolve it server-side to the booking's PI or hold SI).

**Setup branch** (new `confirmBookingsForSucceededSetupIntent()` in `confirm-deposit-payment.ts`):
1. Retrieve the SI on the connected account; require `succeeded`; extract `payment_method`.
2. Find hold rows by `stripe_setup_intent_id`, bookings `Pending` in-venue (idempotent; `alreadyConfirmed` supported).
3. Holds: set `stripe_payment_method_id`; stamp `terms_snapshot.accepted_at`. Bookings: `status:'Booked'`, `deposit_status:'Card Held'`, assign `confirm_token_hash` manage token as the deposit path does.
4. `events` rows `card_hold_saved`; send confirmation comms (Section 10).

**Payment branch** (extend `confirmBookingsForSucceededPaymentIntent()`): per-row instead of blanket `'Paid'`, and **only for rows with `deposit_status='Pending'`** (the current blanket update also flips `'Not Required'` zero-deposit group siblings to `'Paid'`, which the rewrite must stop doing):
- Row has a hold row and `deposit_amount_pence IS NULL` -> `'Card Held'`.
- Row `deposit_status='Pending'` without a hold row -> `'Paid'` (existing behaviour, now explicit).
- When the PI carries a `payment_method` and unit hold rows exist (`payment_with_setup`), populate their `stripe_payment_method_id`, stamp `accepted_at`, insert `card_hold_saved` events.
The webhook calls the same functions, so routes and webhook stay in lockstep.

**Already-confirmed race:** the route's shortcut currently returns `already_confirmed` only when `deposit_status === 'Paid'`, and `validateBookingStatusTransition('Booked','Booked')` fails. Extend the shortcut to treat `'Card Held'` (and the hold-saved state generally) as already-confirmed and skip the transition validation in that case, otherwise the webhook-won race returns a 400 to the guest.

### 7.5 Consent snapshot

Written at create with the exact consent string to be displayed; template constant in `src/lib/booking/card-hold-terms.ts`, imported by the online client copy, the `/pay` page copy, and the server snapshot so they cannot drift:

```json
{ "version": 1, "text": "By saving your card you authorise {venueName} to charge up to £25.00 if you do not attend. If you cancel the booking before it starts, nothing extra will be charged.", "fee_pence": 2500, "accepted_at": null }
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

**Form UI, all five staff surfaces.** The switch is labelled **"Card hold"** with sublabel **"Send a link to the guest to add their card details"**, default **on**, rendered when the selected entity resolves to `card_hold` (owner venue's flag on), in place of the deposit toggle where one exists (the two are never shown together). Hidden when editing, like the deposit toggle. Success toast: `'Booking created - card request link sent'` (or the normal confirmed toast when waived). The staff surfaces are NOT one form:
- **Tables:** `UnifiedBookingForm.tsx` (existing deposit toggle location; needs the slot data exposure from 6.3).
- **Appointments:** `AppointmentBookingFlow.tsx` staff branch (where `staffRequireDeposit` lives today, ~2100, ~3982).
- **Classes / events:** `ClassBookingFlow.tsx` / `EventBookingFlow.tsx` staff-audience branches (no deposit toggle exists today; the card-hold toggle is new UI there). Slot payloads already carry `payment_requirement` + amounts for both.
- **Resources:** `ResourceBookingFlow.tsx` staff branch AND `ResourceSlotBookingForm.tsx` (posts to the staff route today without any toggle; must gain the toggle or its bookings inherit the default-on behaviour with no waive control).

### 7.7 The `/pay` page in setup mode

- **`GET /api/booking/pay`:** change the eligibility check from "has `stripe_payment_intent_id`" to "has a PI **or** an open unsaved hold with `stripe_setup_intent_id`". For the hold case, return `payment_mode:'setup'`, `client_secret` = the SI's secret (retrieved on the connected account), `card_hold_fee_pence` (unit total), plus the same booking/venue fields; `deposit_amount_pence` stays null. Existing 404 semantics unchanged otherwise (`status !== 'Pending'` -> "Booking not found or already completed"; an already-saved or released hold therefore 404s cleanly).
- **`src/app/pay/page.tsx`:** branch on `payment_mode`:
  - Header/amount card: instead of the deposit amount, show `No payment is taken today.` and `No-show fee of up to {fee} if you do not attend.`
  - Replace the refund-policy block with the consent text (7.5) rendered verbatim above the button.
  - `PayForm` calls `stripe.confirmSetup` (same `return_url`, `redirect:'if_required'`), then posts `/api/booking/confirm-payment { booking_id, guest_email }` as today (7.4 resolves it).
  - Success state: `Card saved. Your booking is confirmed. No payment has been taken.`
- **`/pay/success` must branch too.** `src/app/pay/success/page.tsx` (~39-41) hard-codes `Deposit paid / Your deposit has been received` for any `redirect_status=succeeded`; a 3DS-challenged card save redirects there and would tell the guest they paid a deposit when £0 was taken. Detect setup mode from Stripe's redirect params (`setup_intent` / `setup_intent_client_secret` present instead of `payment_intent`) and show `Card saved. No payment has been taken.` Additionally, after a redirect the `/pay` page's inline confirm call never ran (the browser navigated away), so the success page should best-effort post `/api/booking/confirm-payment` (the webhook remains the guaranteed path).
- **Account snapshot:** the SI retrieval here (and everything else touching an existing hold) uses `hold.stripe_connected_account_id`, NOT the venue's current account, and must not 500 on a venue whose current account is missing/changed (unlike the existing PI path, which reads the venue row).
- Link TTLs are unchanged (short link + token 24h), consistent with the 24h auto-cancel (12.1). Optional copy nicety: when the link is reopened after a successful save, the 404 message may say `This booking is already secured.` instead of the generic "already completed" text.

---

## 8. Stripe integration detail

### 8.1 Objects and account

Everything on the venue's connected account via `{ stripeAccount }` (direct charges; no application fee, matching deposits). Statement descriptor is the venue's own, aiding dispute recognition.

### 8.2 Purpose constants

Add to `RESERVE_NI_PI_PURPOSE` (`src/types/class-commerce.ts`):

```ts
CARD_HOLD_CUSTOMER: 'card_hold',                 // booking-scoped Customer metadata (D2)
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
    payment_method_types: ['card'],
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
    idempotencyKey: `card-hold-charge-${hold.id}-${attempt}`,
  },
);
```

`attempt` = the hold's `charge_attempt_count` **after** the atomic claim (below). Without a per-attempt component, a retry after a decline would reuse the key and Stripe would replay the cached decline for 24 hours.

**Atomic single-charge claim.** The 9.2a guards are read-then-act, so two concurrent requests could both pass them, and a simple counter increment does NOT serialise them (both would see `charge_payment_intent_id IS NULL`, get different attempt numbers, different idempotency keys, and create two distinct PIs). The scheme that actually holds:

1. Claim the attempt: `UPDATE booking_card_holds SET charge_attempt_count = charge_attempt_count + 1, updated_at = now() WHERE id = $1 AND charge_payment_intent_id IS NULL AND released_at IS NULL RETURNING charge_attempt_count;` Zero rows: 409 `invalid_state`.
2. Create the PI (8.3) with the returned attempt in the idempotency key.
3. **Conditionally persist:** `UPDATE booking_card_holds SET charge_payment_intent_id = $pi WHERE id = $1 AND charge_payment_intent_id IS NULL;` **Zero rows here means a concurrent request won the race between steps 1 and 2: cancel your own just-created PI (`stripe.paymentIntents.cancel`, best effort; if it already succeeded, Stripe's idempotent refund via the standard refund action is the operator remedy) and return 409.** The conditional write, not the unique index, is the single-charge gate (the index only prevents two holds sharing one PI id).
4. On a failed attempt (8.5), clear `charge_payment_intent_id` so the claim reopens for a retry.

The Section 17 concurrency test must exercise two INTERLEAVED requests (both past step 1 before either reaches step 3), not just a sequential double-click. One successful charge per hold; partial-then-full charging is impossible in v1.

### 8.4 SCA / MIT compliance

SCA runs at save time (SetupIntent or `setup_future_usage` payment; `PaymentElement` handles 3DS inline, on the booking flow or the `/pay` page). The later charge is merchant-initiated (`off_session: true`), using the save-time authentication as the mandate basis; the consent text (7.5) plus the explicit save action is the mandate evidence. This mirrors Stripe's documented no-show-fee pattern.

### 8.5 Charge failure handling

| Error `code` | Meaning | v1 behaviour |
|---|---|---|
| `card_declined`, `expired_card`, `insufficient_funds`, ... | Issuer refused | Record `charge_failure_code`/`charge_failure_at`; keep `'Card Held'`; clear `charge_payment_intent_id` (the attempt's PI is dead, freeing the claim for a retry); `events` `card_hold_charge_failed`; `logBookingOp` operation `card_hold_charge_failed`; 402: `The card was declined ({reason}). You can try again, or contact the client to arrange payment.` Retries allowed within the window (`charge_attempt_count` feeds the idempotency key). |
| `authentication_required` | Issuer demands 3DS; impossible off-session | Same recording; message: `The card issuer requires the client to authorise this payment in person. Off-session charging is not possible for this card.` Cancel the stray `requires_action` PI. No on-session fallback in v1 (Section 19). |

Never mutate `deposit_status` on failure.

### 8.6 Webhook changes

Purpose branches run **before** the generic `metadata.booking_id` confirm path.

1. **`payment_intent.succeeded`**, purpose `card_hold_no_show_fee`: source-of-truth completion. Find the hold by `charge_payment_intent_id` (or `metadata.booking_id`, then set it). Set `charged_pence` (`amount_received`), `charged_at`; booking `'Charged'`; `events` `card_hold_charged`; receipt email in `after()`. Idempotent.
2. **`payment_intent.succeeded`**, generic + `CLASS_CART_CHECKOUT`: funnel into the extended per-row confirm (7.4); no new branch beyond that.
3. **`payment_intent.payment_failed`**, purpose `card_hold_no_show_fee`: record failure fields; do not touch booking status. (Generic failure path touches `'Pending'` rows only; `payment_with_setup` rows still `Pending` are correctly included: the capture failed.)
4. **`setup_intent.succeeded`** (new event type): backup confirm; `confirmBookingsForSucceededSetupIntent()`. Enable on the Stripe webhook endpoint (deployment checklist).
5. **`setup_intent.setup_failed`** (new event type): informational log (client handles inline failure; crons clean up abandonment).
6. **`charge.refunded` / `charge.refund.updated`**, two changes:
   - Purpose branch (existing lookup by `bookings.stripe_payment_intent_id` misses fee PIs): fee-PI refund -> booking `'Refunded'`, hold released (`'refunded'`), `events` `card_hold_charge_refunded`. Idempotent.
   - **Constrain the generic flip.** The existing handler selects ALL bookings by `stripe_payment_intent_id` and flips every non-`'Refunded'` row to `'Refunded'` (`route.ts:390-429`). In a `payment_with_setup` unit the card-hold-only rows share that PI, so refunding the money part of a mixed unit would stamp sibling `'Card Held'` rows `'Refunded'`, permanently killing their holds without release. The generic path must **exclude rows that have a hold row** (equivalently: skip rows with `deposit_amount_pence IS NULL` that join to `booking_card_holds`), leaving hold state changes exclusively to the fee-PI purpose branch.

---

## 9. Staff surfaces

### 9.1 Booking detail display

`BookingDetailContent.tsx` deposit block:

| State | Pill | Detail line |
|---|---|---|
| `'Pending'` + open unsaved hold (staff flow, awaiting card) | `Card request sent` (existing pending styling) | `Waiting for the guest to add card details. No-show fee up to {fee}.` + **`Resend link`** action (9.2b) |
| `'Pending'` + released hold (booking cancelled before the card was saved) | no hold pill (booking is Cancelled) | `The card request was cancelled with the booking.` (informational only) |
| `'Card Held'`, not released | `Card held` (teal/info) | `No-show fee up to {fee}. No payment taken.` |
| `'Card Held'`, released | `Card hold ended` (neutral) | `The card hold was released on {date}.` |
| `'Charged'` | `No-show fee charged` (amber) | `{amount} charged on {date}.` |
| `'Refunded'` (was `'Charged'`) | `No-show fee refunded` (existing refunded styling) | `{amount} refunded.` |
| last charge attempt failed | keep `Card held` | append `Last charge attempt failed: {plain reason}.` |

`GET /api/venue/bookings/[id]` gains `card_hold: { fee_pence, saved: boolean, charged_pence, charged_at, released_at, charge_failure_code, charge_window_ends_at } | null`.

**Legacy deposit actions must be explicitly hidden and guarded for hold states.** The central UI gate is **negative** (`BookingDetailContent.tsx:602` and `ExpandedBookingContent.tsx:~1861` show Send payment link / Waive / Record cash whenever `deposit_status` is not `'Paid'`/`'Refunded'`), so without changes those buttons WOULD render on `'Card Held'`/`'Charged'` bookings, and the server actions are unguarded (`waive` would clobber `'Card Held'` without releasing; `record_cash` would flip it to `'Paid'`, making a never-collected amount forfeitable). Required: (a) UI: hide all three legacy actions when a hold row exists (the awaiting-card `Pending` state shows only the card-aware `Resend link`; `'Card Held'`/`'Charged'` show only the card-hold actions); (b) server: see the guards in 9.2.

**Other staff surfaces:**
- `AppointmentDetailSheet.tsx` (~767-773, 858-883) and `ResourceInstanceDetailSheet.tsx` (~432-443) display deposit info only when `deposit_amount_pence > 0`, so hold states would show **nothing** on the surfaces appointment and resource staff actually work in. Both gain a hold state line (pill + fee, from the same `card_hold` payload) and a link to the full booking detail where the charge action lives.
- **List/glance surfaces approximation (accepted for v1):** the day-sheet badge, floor-plan attention icon, and table-grid `'!'` icon key off `deposit_status='Pending'` and will show "Deposit pending" for an awaiting-card booking. This is imprecise but directionally right (staff attention is warranted; the booking is unsecured). Documented as accepted; a hold discriminator in those payloads is an optional later refinement, not v1 scope.

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

**(b) `send_payment_link`** (extended): when the booking has an open **unsaved** hold (`deposit_status='Pending'` + hold row, no `stripe_payment_method_id`, `released_at IS NULL`), send the **card-request** comms instead of the deposit-request comms: delete prior `card_hold_request_sms`/`card_hold_request_email` comm-logs, reuse `createOrGetPaymentShortLink`, send via the card-request sender (10.3). Same guest-contact 400 and 422-if-no-channel semantics. **A booking whose hold is released (any reason) returns 409 `hold_released`.** Deposit behaviour for non-hold bookings unchanged.

**(c) `waive`** (extended): on a `Pending` booking with an open **unsaved** hold, waiving releases the hold (`release_reason:'admin'`, best-effort customer deletion per the shared-customer rule in 9.3) and sets `deposit_status:'Waived'`, leaving status handling exactly as today's deposit waive (staff confirm the booking via the normal status actions). **On any other hold state (`'Card Held'`, `'Charged'`): 409 `invalid_state`** (a saved hold is released only by cancel, refund, or expiry).

**(d) `record_cash`** (guarded): **409 `invalid_state` whenever a hold row exists.** Today it unconditionally sets `'Paid'` + amount; on a hold booking that would fabricate a paid deposit which the no-show path would then "forfeit".

**(e) `refund`** (extended): when `deposit_status === 'Charged'`, refund against `hold.charge_payment_intent_id` **on `hold.stripe_connected_account_id`** (the snapshot, NOT the venue's current account: the existing deposit refund reads the venue row and 400s when the account is missing; the hold path must not, so refunds survive a venue account change). On success (or webhook 8.6.6): `'Refunded'`, hold released (`'refunded'`). Button relabels `Refund no-show fee`. Admin-only.

**Charge UI (booking detail):** destructive-styled `Charge no-show fee` when the client-side mirror of guards 2-6 passes and viewer is admin. Dialog: title `Charge no-show fee`; body `Charge {guestName}'s saved card for missing this booking. The maximum you can charge is {fee}.`; amount input pre-filled, max = fee; confirm `Charge {amount}`; 402 messages inline. Appears in every `BookingDetailContent` surface automatically.

**Class roster:** `ClassInstanceDetailSheet.tsx` attendee rows: after a roster no-show, chargeable attendees show a compact `Charge no-show fee` affordance for admins (same endpoint + dialog). Non-admin staff see state only.

### 9.3 No-show and cancel interplay

- **Staff PATCH No-Show:** paid-deposit forfeit branch untouched (holds are never `'Paid'`). **Do not auto-charge.** `no_show_notification` gains no charge language.
- **Class roster no-show:** Phase 0 fixes the status string (D9); the roster then feeds the same gate. (It still does not forfeit paid deposits and does not enforce the grace window; pre-existing, out of scope, Section 19.)
- **Undo No-Show:** `'Card Held'` -> nothing to restore. `'Charged'` -> stays `'Charged'`; refund is explicit.
- **Cancels release the hold** in every path: staff PATCH cancel (group cancels release **per sibling row**, each with its own hold), `staff-cancel-booking.ts`, guest `/api/confirm` cancel, cart `rollbackGroup`, `restoreAndReleaseClassBookings` when it cancels rows, the auto-cancel cron (12.1), and **the linked-accounts cross-venue cancel** (`PATCH /api/venue/linked-calendar/booking`, which cancels via the SQL RPC `linked_apply_booking_update` and passes through none of the other hooks; add the release there in the route after a successful cancel). In each: set `released_at`, `release_reason:'cancelled'`, `events` `card_hold_released`, and best-effort delete the booking-scoped customer **only when no other live hold shares it** (a cart cancel of one line must not detach the card sibling holds rely on: check for open sibling holds on the same `stripe_customer_id` first). Cancelling a `Pending` awaiting-card booking (guest phoned before saving) works the same way: `deposit_status` stays `'Pending'` on the Cancelled row, hold released. Customer deletion and any Stripe cleanup always use `hold.stripe_connected_account_id`. Credit/allowance restore logic is unrelated and unchanged. Paths verified safe to skip: course-enrollment cancels (course bookings never carry holds), import undo (imported bookings excluded; undo deletes rows), class-instance and event cancel cascades (both route through `cancelStaffBookingWithNotify`, already hooked).
- **Staff hard delete** (`DELETE /api/venue/bookings/[id]`, permanently removes Cancelled bookings): the `ON DELETE CASCADE` destroys the hold row, including the `terms_snapshot` dispute evidence and the `stripe_customer_id` needed for cleanup if the release-time deletion had failed. Before the row delete, best-effort delete the hold's Stripe customer (snapshot account); the evidence loss on hard delete is accepted and documented (hard delete is an explicit destructive staff act on an already-cancelled booking).
- **No modify path ever recomputes `fee_pence`.** Staff party-size edits, CDE class moves, practitioner reassignment, and guest modifies all keep the consented snapshot (the staff table "additional deposit" branch is `'Paid'`-gated and cannot touch holds; no PATCH path deletes and reinserts booking rows).

---

## 10. Guest surfaces and comms

### 10.1 Manage page (`ManageBookingView.tsx`)

- `GET /api/confirm` gains the guest-safe hold summary.
- **`Pending` + open unsaved hold (reachable):** the manage/confirm surfaces have no Pending gate (guest modify explicitly allows `Pending`, and `/c/` links redirect for any non-Cancelled status), and staff-flow confirmation comms can hand the guest a manage link pre-save. Show: `Add your card details to secure this booking. No payment is taken.` with a button to the payment link (reuse `createOrGetPaymentShortLink`). Guest cancel pre-save works and releases the unsaved hold (9.3); guest modify pre-save keeps the SI, link, and fee snapshot intact.
- `'Card Held'`, open: `Your card is securely on file. {venueName} may charge a no-show fee of up to {fee} if you miss this booking. Cancel before it starts to avoid any charge.`
- `'Charged'`: `A no-show fee of {amount} was charged for this booking on {date}.`
- **Signed-in account area:** `src/app/account/bookings/[bookingId]/page.tsx` (~166), `src/lib/account/account-bookings.ts` (~92), and the `DashboardHomeClient.tsx` pill render `deposit_status` raw; the new values happen to read acceptably ("Card Held") but the booking detail page should carry the same hold line as the manage page (it is a consent-bearing surface). Add these files to the Phase 0 display-map list.
- Cancel: unchanged UI; the path releases the hold. Success copy for a card-hold booking: `Your booking is cancelled. Your card will not be charged and the card hold has been released.` Verify the late-cancel "non-refundable" branch (keyed on paid deposits) does not fire for holds.
- Reschedule/modify (incl. `guest_self_reschedule` flows): hold carries over untouched, same card, same fee snapshot; if the modify changes the entity to one with a different fee, **keep the original snapshot** (consented amount); code comment required.

### 10.2 Confirmation and receipt emails

Templates in `src/lib/emails/templates/`, senders in `send-templated.ts`; the renderer varies nouns via `bookingLabel(booking)`.

1. **Booking confirmation** (all models): with an open hold, append: `No payment has been taken. Your card is securely on file and {venueName} may charge a no-show fee of up to {fee} if you do not attend. Cancel before your booking starts to avoid any charge.`
   **The confirmation pricing helpers must become hold-aware too:** `src/lib/communications/booking-confirmation-pricing.ts` (`isFreeBookingDisplay` ~42-47, `paymentStatusLine` ~190, `bookingConfirmationSmsPriceSuffix` ~371) currently renders a card-hold booking as "free" or "pay at venue" in the confirmation SMS and email payment line. Hold bookings get a dedicated status line (`No payment taken. Card held for a no-show fee of up to {fee}.`) and SMS suffix (`Card held, no payment taken. No-show fee up to {fee}.`, subject to the 160-char pattern).
2. **No-show fee receipt** (new `card-hold-charged.ts`, comm-log type `card_hold_charged_email`), sent on charge success:
   - Subject: `No-show fee charged: {venueName}`
   - Body: `You missed your {bookingLabel} at {venueName} on {date} at {time}. As set out when you booked, a no-show fee of {amount} has been charged to your saved card. If you think this is a mistake, please contact {venueName} directly.` Standard footer.
3. No SMS receipt in v1 (email is the receipt of record). CDE reminder crons (`cde_reminder_1/2`) unchanged.

### 10.3 Card-request comms (staff flow)

New message keys, modelled on the deposit-request pair. **Channel gating decision:** the policy resolver keys strictly by message key (`policies[lane][messageKey]`), and the old `deposit_request_email_enabled` venue column is dead config, so "reusing the deposit toggles" is not a thing that exists. The new keys therefore get **their own policy entries** with defaults `EMAIL_AND_SMS`, and the communications settings UI (`CommunicationTemplatesSection.tsx`, which enumerates per-key cards) gains cards for them. A venue's existing deposit-request channel customisations do not govern card-hold comms; that is accepted and documented here.

1. **`card_hold_request`** (email `card_hold_request_email` + SMS `card_hold_request_sms`), sent automatically at staff create (7.6) and by `send_payment_link` re-sends (9.2b). New sender `sendCardHoldRequestNotifications(booking, venue, venueId, paymentLink)` beside `sendDepositRequestNotifications`.
   - Email subject: `Add your card details to confirm your booking at {venueName}`
   - Email heading: `Card details needed`
   - Email body core: `No payment is taken now. Add your card details to secure your booking. {venueName} may charge a no-show fee of up to {fee} if you do not attend.` CTA button: `Add card details` -> the payment link. Include the standard booking summary block (date, time, party size or service, venue address) as the deposit-request email does.
   - SMS: `{venueName}: card details needed to secure your booking for {date} at {time}. No payment is taken now. Add: {link}` (respect the 160-char cap pattern; drop the reassurance clause first if over).
2. **`card_hold_payment_reminder`** (email + SMS), sent by the reminder cron (12.1): same shapes with `Reminder:` prefixed to the SMS and subject `Reminder: add your card details to confirm your booking at {venueName}`.

**Full plumbing list** (a "follow the precedent" instruction under-counts; these are the files the deposit keys actually touch): `policies.ts` (key union + `buildDefaultLanePolicies` + `ALLOWED_CHANNELS_BY_MESSAGE` + per-key `sanitizeLanePolicies` handling), `policy-resolver.ts` (`CommunicationLogMessageType` union + `LOG_MESSAGE_TYPE_MAP` entries mapping `card_hold_request` -> `card_hold_request_email/sms` and `card_hold_payment_reminder` -> `card_hold_payment_reminder_email/sms`), `renderer.ts` cases, `types.ts` `MessageType`, `service.ts` `mapMessageType` (the reminder cron sends via `sendCommunication`), `display-labels.ts` (unknown log types fall back to lowercased space-separated text like "card hold request email"; add proper labels), `CommunicationTemplatesSection.tsx` (settings cards), and the comm-log CHECK constraint in Migration B2 (5.3).

---

## 11. Events, audit, observability

- `events` rows: `card_hold_saved`, `card_hold_charged`, `card_hold_charge_failed`, `card_hold_charge_refunded`, `card_hold_released`, payloads `{ booking_id, fee_pence | charged_pence | failure_code | release_reason }`. Surface automatically in the booking timeline. (`class_no_show` unchanged and complementary.)
- `logBookingOp`: operations `card_hold_charge` (charge success path, 9.2a) and `card_hold_charge_failed` (charge failure path, 8.5). Note `BookingOpLogFields.operation` is a closed TS union (`booking-ops-log.ts:7`); both values must be added to it.
- Cross-venue writes: `recordBookingWriteAudit` (9.2a).

---

## 12. Crons

### 12.1 Abandoned capture cleanup and staff-flow timeout (extend `auto-cancel-bookings`)

**CRITICAL: the existing sweeps must be amended, not just added to.** The existing phone deposit sweep selects only on `status='Pending' AND deposit_status='Pending' AND source='phone'` (`route.ts:30-36`); it references neither `deposit_amount_pence` nor hold rows, so a phone card-hold booking MATCHES it and would be cancelled with the wrong reason (`deposit_unpaid_timeout`), the wrong guest copy, no hold release, and no customer cleanup. Therefore:

- **Amend the existing phone deposit sweep** to exclude card-hold bookings: add `AND NOT EXISTS (SELECT 1 FROM booking_card_holds h WHERE h.booking_id = bookings.id)` (or the equivalent join filter).
- **Online 30-minute arm** (generalise the class-cart sweep). **Source values, load-bearing:** the direct public flows post `source: 'booking_page'` (or `'widget'` when embedded); ONLY the class-cart orchestrator writes `'online'`. A `source='online'` predicate would clean up abandoned class carts and nothing else. The arm's predicate is therefore rows `status='Pending' AND deposit_status='Pending' AND source IN ('online','widget','booking_page')` older than 30 min joined to `booking_card_holds`. Setup-mode units: retrieve the SI; if `requires_payment_method` or `canceled` -> cancel rows (`'Cancelled'`/`'Failed'`, `cancellation_actor_type:'system'`), `events` `auto_cancelled` (`reason:'card_hold_setup_abandoned'`), release holds (`'abandoned'`), delete the customer. Covered (entitlement-paid) sibling lines are `Booked`, never matched by this sweep, and their credits correctly stay consumed (Section 14). `requires_action`/`processing` waits for the next sweep. `payment_with_setup` units are covered by extending the existing PI-status check beyond class carts (same widened source set).
- **Staff 24-hour arm**: rows `status='Pending' AND deposit_status='Pending' AND source IN ('phone','walk-in')` older than 24h **with a hold row** (walk-in included because card holds, unlike deposits, are allowed for walk-ins, D6): validated transition to `Cancelled` (`deposit_status` stays `'Pending'` on the Cancelled row, matching the deposit sweep), `events` `auto_cancelled` (`reason:'card_hold_setup_timeout'`), release (`release_reason:'abandoned'`) + customer deletion, staff push as the deposit sweep, and the `auto_cancel_notification` comms **with a card-hold copy variant**: the existing template says the booking was cancelled "because the deposit wasn't paid in time", which is false for a card hold. Card-hold variant copy: `because card details were not added in time`.

### 12.2 Card-request reminder (extend `deposit-reminder-2h`)

Add a second selection to the cron: `status='Pending' AND deposit_status='Pending' AND source IN ('phone','walk-in')` created 2-2.5h ago **with an open unsaved hold**; regenerate the short link; send `card_hold_payment_reminder` (10.3).

**CRITICAL: the existing deposit selection must also be amended** to exclude bookings with hold rows. As written today it selects on `source='phone' AND status='Pending' AND deposit_status='Pending'` only, so a phone card-hold booking would receive a `deposit_payment_reminder`, and because `deposit_amount_pence` is NULL the template's fallback (`route.ts:58`) tells the guest to pay a hard-coded **£5.00 deposit that does not exist**. Add the same `NOT EXISTS booking_card_holds` filter to the deposit selection.

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
Pending ──(online abandonment sweep, 30m: cron 12.1)───────────────────────────▶ Failed, row Cancelled
Pending ──(staff link timeout, 24h: cron 12.1)──────────▶ stays 'Pending', row Cancelled, hold released
Pending ──(manual cancel before save, any path 9.3)─────▶ stays 'Pending', row Cancelled, hold released
Pending ──(payment_with_setup unit's PI fails: webhook 8.6.3)───────────────────▶ Failed
Pending ──(staff waive action on an unsaved hold)───────────────────────────────▶ Waived (+ hold released)
Card Held ──(admin charge succeeds; status must be No-Show)────────────────────▶ Charged
Card Held ──(booking cancelled, any path / 14-day expiry)────▶ Card Held + released_at   (terminal)
Charged ──(admin refund or Stripe refund webhook)────────────▶ Refunded (+ released_at)  (terminal)
```

(There is deliberately no ad-hoc "admin release" of a saved hold: `waive` applies only to `Pending` unsaved holds; a saved hold is released only by cancel, refund, or expiry. Re-sending the card link on a released hold is 409, 9.2b.)

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
| Linked venue books a card-hold service via the linked-calendar route | 400 with a plain message directing to the main booking form (D6) |
| Roster no-show then charge | Works: roster writes canonical `'No-Show'` after the Phase 0 fix (D9) |

---

## 15. Security, compliance, privacy

- **PCI:** card data never touches ResNeo servers (Stripe Elements on the booking flows and the `/pay` page).
- **SCA/MIT:** Section 8.4; consent text + snapshot is the mandate record for all three save paths (online setup, online payment_with_setup, `/pay` page setup). The consent is always displayed on the surface where the card is entered.
- **Authorization:** charging/refunding admin-only server-side (`requireAdmin`); all Stripe mutations service-role; `booking_card_holds` has no RLS policies. The `/pay` page is token-gated (HMAC, 24h) and rate-limited, as today.
- **Disputes:** evidence per charge: `terms_snapshot` (exact consent text, unit fee, `accepted_at`), booking record (entity, date/time, party/tickets), events trail (`booking_created`, `card_hold_saved`, no-show transition, `card_hold_charged`). No automated evidence submission in v1.
- **GDPR/data minimisation:** the saved card lives only while a hold can still be charged; release deletes the booking-scoped Stripe customer (detaching the PM), subject to the shared-customer check. Stripe ids remain on hold rows for audit. `account-hard-delete` anonymisation unaffected. **Venue hard delete caveat:** `admin_hard_delete_venue` deletes booking rows directly, cascading away the hold rows before anything can enumerate their Stripe customers; the venue hard-delete path must first delete the venue's open card-hold customers on Stripe (a simple pre-pass over `booking_card_holds WHERE venue_id = ... AND released_at IS NULL`), otherwise vaulted cards persist on the connected account indefinitely.
- **Venue-initiated GDPR guest tooling:** `POST /api/venue/gdpr/erase-guest` anonymises PII with no Stripe interaction, so an "erased" guest's card could stay vaulted and chargeable. Extend it: release any open holds on the guest's bookings (reason `'admin'`) and delete their booking-scoped Stripe customers. `export-guest` exports booking deposit fields; add a guest-safe hold summary (fee, state, consent text and timestamp: the snapshot is personal data).
- **Abuse guards:** server-side clamp to the consented fee; single-charge enforcement; grace-window gate on the PATCH no-show path.

---

## 16. Implementation plan (phased, with file-by-file checklist)

Each phase leaves the app shippable with the flag off.

### Phase 0: foundations and pre-existing fixes
1. **Fix the class roster no-show status string** (D9): `class-attendance.ts` ~126/131 `'No Show'` -> `'No-Show'`; verify against a real database; regression test; audit for other space-variant literals.
2. Migrations A, B, B2 (5.1-5.3).
3. `src/lib/booking/card-hold-terms.ts` (consent template, `CARD_HOLD_CHARGE_WINDOW_DAYS`, fee formatting) and `src/lib/booking/card-hold-capture.ts` (7.0).
4. Feature flag plumbing (`types.ts`, `resolve.ts`, both flag UIs, `Docs/FEATURE_FLAGS.md`).
5. Purpose constants (8.2). Type updates: `deposit_status` unions + display-label maps. A `'Forfeited'` grep misses most display enumerations; the verified list: `DaySheetView.tsx:266-287`, `bookings-list-shared.ts:45-51`, `RegistryBookingAccordionList.tsx:88`, `ExpandedBookingContent.tsx:867-877,1108-1121`, `BookingsDashboard.tsx:2286`, `booking-staff-indicators.ts`, the account-area surfaces (`account/bookings/[bookingId]/page.tsx:~166`, `account-bookings.ts:~92`, `DashboardHomeClient.tsx` pill), plus import write maps `value-map.ts:21` / `normalize.ts:295-300` (imports must NOT map to the new values). `ClassPaymentRequirement` union + every exhaustive switch (6.4); `booking_restrictions`/slot types gain `deposit_type`; `BookingOpLogFields.operation` union gains the two card-hold ops (11).

### Phase 1: configuration
6. `appointment-service-payment.ts` (6.3); table engine `deposit_type` passthrough (`engine.ts`, `resolveDepositPerPersonGbp`, slot type).
7. Editor forms + payload/zod + flag gating: appointment services (incl. onboarding), service items, class types, events (zod is the only gate), resources, **table rules** (`ServiceBookingRulesSection.tsx` + `booking-restrictions` route schema + invariant), legacy `deposit-config` route + `depositConfigSchema` `type` (6.2).
8. Slot TS types widened; `validate-event-ticket-booking.ts` returns `cardHoldFeePence`.

### Phase 2: online booking flows
9. `POST /api/booking/create`: capture-mode integration across table, appointment, class, event, resource branches; `pay_with_class_credits` rejection (7.1). Then `create-multi-service`, `create-group`.
10. Class cart: quote fields, orchestration modes, rollback customer cleanup, response types, `insertPendingPaidClassSessionBooking` null-money support (7.2).
11. `PaymentStep.tsx` modes + copy; prop threading in all five flows; suppression of the legacy deposit banner and refund-policy line in hold contexts (`DetailsStep.tsx`, `cancellationPolicy` props, `public-deposit-refund-policy.ts` call sites); confirmation screens; catalog fee lines (7.3).
12. Confirm paths: `confirmBookingsForSucceededSetupIntent()`, per-row extension of the PI confirm, `confirm-payment` schema incl. `booking_id` resolution (7.4).
13. Webhook: `setup_intent.succeeded`/`setup_failed`; enable event types on the Stripe endpoint (deployment note) (8.6).

### Phase 3: staff flow
14. `POST /api/venue/bookings`: `require_card_hold` semantics across all five model branches; extend `applyStaffBookingPaymentAndComms` with the card-hold variant; staff table fee path; owner-venue flag resolution for cross-venue creation (7.6, D6).
15. Staff toggles across the five surfaces: `UnifiedBookingForm.tsx` (tables, incl. `Slot` mapping passthrough), `AppointmentBookingFlow.tsx` staff branch, `ClassBookingFlow.tsx` / `EventBookingFlow.tsx` staff branches, `ResourceBookingFlow.tsx` + `ResourceSlotBookingForm.tsx`; toasts (7.6).
16. `GET /api/booking/pay` setup mode (snapshot account) + `/pay` page branch, consent rendering, success copy, **and the `/pay/success` setup-mode branch with best-effort confirm** (7.7).
16b. Linked-calendar create route: 400 rejection for card-hold services (D6).
17. Card-request comms: templates (email/SMS), `sendCardHoldRequestNotifications`, renderer cases, policies + policy-resolver mappings, reminder key (10.3).

### Phase 4: staff charge + guest visibility
18. `GET /api/venue/bookings/[id]`: `card_hold` object incl. `saved` (9.1).
19. Deposit route: `charge_no_show_fee` incl. the atomic claim (8.3), `send_payment_link` card-aware re-send, `waive` release + hold-state guard, `record_cash` hold-state guard, `refund` for `'Charged'` (9.2); UI hiding of legacy actions on hold states (9.1).
20. Webhook purpose branches for the fee PI (8.6.1/3/6).
21. `BookingDetailContent.tsx` pills (incl. awaiting-card + resend), charge dialog, refund relabel; `ClassInstanceDetailSheet.tsx` roster affordance; hold state lines on `AppointmentDetailSheet.tsx` + `ResourceInstanceDetailSheet.tsx` (9.1, 9.2).
22. Hold release on every cancel path incl. the linked-calendar cross-venue cancel route (PATCH) and the shared-customer check; staff hard-delete customer pre-pass (9.3); venue hard-delete Stripe-customer pre-pass and GDPR erase-guest/export-guest extensions (15).
23. `GET /api/confirm` + `ManageBookingView.tsx` guest copy incl. cancel success message (10.1).
24. Emails/SMS: confirmation hold section, hold-aware `booking-confirmation-pricing.ts` (status line + SMS suffix), `card-hold-charged.ts` + sender (10.2).
25. Events + `logBookingOp` + cross-venue audit (11).

### Phase 5: lifecycle hygiene
26. `auto-cancel-bookings`: **amend the existing phone deposit sweep to exclude hold rows**, then add the online 30-min arm + staff 24h arm with the card-hold auto-cancel copy variant (12.1).
27. `deposit-reminder-2h`: **amend the existing deposit selection to exclude hold rows**, then add the card-request reminder arm (12.2).
28. New cron `release-card-holds` + `vercel.json` + `Docs/DEVELOPMENT.md` (12.3).
29. `reconciliation` extension; `materializeRecurringReservation` skip (12.4).
30. Reports: Migration C, route pass-through, `ReportsView.tsx` tiles; `Docs/schema.sql` (13).

### Phase 6: docs and rollout
31. Help centre: deposits articles gain a card-hold section (venue-side how-to incl. the staff toggle and link flow; guest-facing copy review). CLAUDE.md copy rules apply.
32. Update this document's status header; add a row to `Docs/Resneo-Appointments-Review-And-Roadmap.md`.
33. Rollout: deploy flag-off; staging env flag; pilot one venue; watch `reconciliation_alerts`, webhook logs, first live charges and first staff-link bookings; then default-availability decision. **Mobile note:** the mobile app posts to `/api/venue/bookings` without `require_card_hold`; once a pilot venue configures a card-hold entity, mobile-created bookings for it default to hold-required with no waive control until the app ships the toggle. Communicate this to the pilot venue and sequence the mobile update accordingly.

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
- Staff flow per model: create with toggle on -> `Pending` + SI + link comms enqueued; `/api/booking/pay` returns setup payload; confirm via `booking_id` -> `'Card Held'`; toggle off -> `'Booked'/'Not Required'`, no hold; waive after send -> `'Waived'` + released + pay 404; re-send on a released hold -> 409.
- Linked-calendar create route returns 400 for card-hold services.
- Regression (flag-independent): the per-row confirm no longer flips `'Not Required'` zero-deposit group siblings to `'Paid'`.
- Config write paths return 403 `feature_disabled` for `'card_hold'` with the flag off; zero-fee `card_hold` config resolves to `'none'` with a warning.
- Charge concurrency: two INTERLEAVED requests (both past the claim before either persists a PI id) -> exactly one charge, the loser's PI cancelled, 409 returned.
- Venue hard-delete pre-pass deletes open hold customers before the booking rows.
- Re-send: comm-log deletion + re-send; 422 when no channel.
- Class cart matrices: paid+hold, covered+hold, hold-only, covered-only; PM propagation; rollback deletes customer.
- Abandonment: online 30-min (setup + payment_with_setup) and staff 24h arms; releases, customer deletion, `auto_cancel_notification` with card copy. **Fixtures MUST use `source='booking_page'` (the value direct flows actually send), not `'online'`,** plus one `'online'` cart fixture and one `'widget'` fixture.
- No-Show (PATCH and roster) -> charge -> `'Charged'` + events + receipt; double-click -> one PI; declines (`card_declined`, `authentication_required` with stray-PI cancel); retry.
- Cancels from every path release (incl. the linked-calendar cross-venue cancel); shared-customer survival for multi-line carts.
- Refund of a charged fee -> `'Refunded'` + released. **Refund of the MONEY part of a mixed `payment_with_setup` unit -> sibling `'Card Held'` rows untouched** (regression for the constrained generic refund flip, 8.6.6).
- Legacy deposit actions on hold states: `record_cash` and `waive` return 409 on `'Card Held'`/`'Charged'`; UI hides them.
- Cron exclusions: a phone card-hold booking is NOT cancelled by the deposit sweep and does NOT receive a `deposit_payment_reminder` (regressions for the amended predicates, 12.1/12.2).
- Appointment waitlist offer conversion onto a card-hold service -> setup mode applies.
- Reconciliation alerts for both new states; release cron expiry + deletion-skip logic; recurring skip.

**E2E seed:** `scripts/seed-e2e-smoke-venue.mjs` currently seeds only a `'deposit'` service; add one card-hold appointment service (and ideally a card-hold table rule) so the smoke environment can exercise these paths.

### Manual E2E (Stripe test mode, connected test account)
| Card | Expectation |
|---|---|
| `4242 4242 4242 4242` | Saves; off-session charge succeeds |
| `4000 0025 0000 3155` | 3DS at save; off-session charge later raises `authentication_required` |
| `4000 0000 0000 0341` | Attaches; off-session charge declines |

Staging walkthrough: configure one card-hold entity per model incl. a table service; book each online (copy + £0, or amount + save line); **book one card-hold service through the embed flow, including a 3DS card, to verify `confirmSetup` inside the iframe**; phone-create a table booking with the toggle on, receive the SMS/email, save the card via `/pay` (repeat once with the 3DS card to verify the `/pay/success` setup copy and webhook-only confirm), verify confirm; phone-create with the toggle off; let one staff booking time out (reminder at 2h with card copy, auto-cancel at 24h with card copy); class cart with membership coverage + card-hold class; PATCH no-show inside grace (refused) and after; roster no-show + roster charge; partial charge; receipt email; reports tiles; refund; hold expiry via cron with customer deletion; recurring skip message.

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
