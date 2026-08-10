# Deposit and payment robustness: implementation plan

Status: REVIEWED (revision 3, 2026-08-10). Two adversarial code-verification passes completed;
pass 1 found 3 blockers, 5 majors, 6 minors; pass 2 found 1 major, 6 minors, all incorporated.
PR 1 implementation started on this revision.
Baseline commit `cf17190b` (staging).

Revision 3 changes in brief (pass 2): every cleanup catch that abandons a booking after a PI was
successfully created must also cancel that PI (multi-service/group mixed-mode catches and the
staff payment helper's post-create short-link failure leave a live confirmable PI against a
deleted booking today); the widened sweep's SELECT gains the notification fields; the sweep and
reconciliation self-heal share one helper so comms cannot be forgotten in one of them; the
reconciliation arm is scoped to `status = 'Pending'` until Phase 4 ships accepted-row deposit
flips (otherwise every accepted-unpaid row would raise a false alert daily); webhook events
inserts are best-effort; `communication_logs` shape for D14 verified
(`booking_id`, `message_type`, `channel`, `created_at`).

Revision 2 changes in brief: the staff attendance toggle turned out to be a second, independent
promotion path (`Pending -> Confirmed`, single and group variants) and is now gated like the
primary action (B1); the accept guard is respecified over whole capture units, not single rows
(B2); the "Mark pending" revert was found to be dead code server-side, so the recovery story now
leans entirely on collectable links for accepted bookings, the dead button is removed, and the
incident ops guidance was corrected (B3); staff-sent payment links now shield a booking from the
30-minute sweep (M1); waive and record-cash now cancel the open PI (M2); the sweeps self-heal
succeeded-but-unconfirmed rows with comms instead of waiting for daily reconciliation (M3); the
e2e used a test card that would never be swept and was corrected, and a 24-hour backstop for
stuck `requires_action` rows added (M4); cadence wording fixed to 30-60 minutes (M5); plus the
/pay page honesty fix, pill status-gating, webhook push data fetch, and test-matrix updates.

Origin: live incident at CBL Beauty Lounge, 8-9 Aug 2026. A £20 deposit PaymentIntent
(`pi_3U2HsNQcFt9sbOM538RDgul9`) was created at 22:33, went to `requires_action` (3DS) at 00:38 and
`payment_intent.payment_failed` at 00:49. The booking survived as `Pending` / deposit `Failed`,
stayed on the venue calendar consuming the slot, and staff then promoted it (`Pending -> Booked`)
with no payment check. The venue believed the booking was secured; Stripe showed it incomplete.

This plan fixes both layers: (A) the system must clean up failed and abandoned money bookings so
they never linger, and (B) staff must not be able to silently accept an unpaid booking.

---

## 1. Goals and non-goals

### Goals

1. No online booking that requires money or a card on file can sit indefinitely in `Pending`
   after its payment fails or is abandoned. It is cancelled 30-60 minutes after creation, the
   slot is released, and both guest and venue are told.
2. A failed deposit is loudly visible to staff everywhere the booking appears.
3. Accepting an unpaid booking becomes an explicit, informed, audited staff decision, through
   EVERY promotion path, with a recovery path (payment link keeps working) afterwards.
4. The guest-facing flows never claim success the server has not verified.
5. Money edge cases (pay-after-cancel, pay-after-waive, missing PI linkage,
   paid-but-stuck-Pending) are closed or self-heal quickly.

### Non-goals (follow-ups, tracked separately)

- Advisory-lock overlap guard for appointment/table inserts (extend
  `supabase/migrations/20261225120000_cde_capacity_guards.sql` style to Model B). Capacity
  correctness, not payment; separate migration and review.
- Any change to the phone/walk-in payment-link business flow itself (24h window stays).
- Card-hold (SetupIntent) sweeps beyond the `Failed`-status widening in 3.4; their 30-minute
  cleanup already works.
- The legacy `'Deposit Pending'` status string referenced by the attendance branches: left as-is.

---

## 2. Design decisions

Decisions marked **[owner]** need sign-off before implementation; everything else is proposed as
the default and can be changed cheaply.

| # | Decision | Proposal |
|---|---|---|
| D1 | Sweep window for abandoned/failed online money bookings | 30 minutes from `created_at`; the cron runs `*/30`, so cancellation lands 30-60 minutes after creation. Matches the existing class-cart and card-hold arms. The guest's payment element supports inline retry inside that window. |
| D2 | Does `payment_intent.payment_failed` cancel immediately? | No. It marks `Failed`, notifies staff, and lets the sweep cancel if the guest does not retry. Immediate cancel would kill legitimate inline retries on the same PI (supported today: `confirm-deposit-payment.ts:275`). |
| D3 | What does staff "accept anyway" do to the deposit? | Leaves `deposit_status` untouched (`Pending` or `Failed`), records an event, sends the guest the normal booking confirmation, and keeps the payment link collectable (D4). Staff who want to forgive the money use the existing `waive` action instead. |
| D4 | Payment links for accepted-but-unpaid bookings | `GET /api/booking/pay` accepts `status IN ('Pending','Booked','Confirmed')` when the deposit is still owed (`deposit_status IN ('Pending','Failed')`). Terminal statuses stay 404. This is the ONLY recovery path; the "Mark pending" revert is dead code (D13) and is removed, not fixed. |
| D5 | Staff alert channel for payment failure | `sendStaffPush(..., 'payment_failed')` (event already exists and is used by the auto-cancel cron). The legacy `kitchen_email` alert is kept unchanged where configured. |
| D6 | Guest comms on sweep cancellation | Reuse `auto_cancel_notification` (already has deposit and card-hold variants). |
| D7 | Cancel the Stripe PI when the booking stops owing it collectably | Yes, best-effort, wherever a booking that still owes its deposit is cancelled (sweeps, staff cancel, guest cancel) AND when the debt is extinguished another way: `waive` and `record_cash` (today both leave the PI confirmable, so a guest with an open tab can still pay a waived or cash-settled deposit, which lands as unrecorded or double-collected money). |
| D8 | Status-change audit | New `events` row `booking_status_changed` with `{from, to, actor_staff_id}` written by the staff PATCH route (both the status branch and the attendance branches when they change status). Crons keep their existing `auto_cancelled` events. |
| D9 | **[owner]** Label for the Pending primary action | Proposal: change "Confirm" to "Accept" (`BOOKING_PRIMARY_ACTIONS.Pending`), so it cannot be confused with the attendance "Confirm" on Booked bookings. |
| D10 | **[owner]** Mobile app compatibility | The staff PATCH gains a 409 for unpaid promotions (Phase 4). An out-of-date ResNeo app will show the error text instead of the dialog. Acceptable friction (staff sees "deposit not paid" and can act from the deposit card), but the app team must schedule the matching dialog. Confirm against `Docs/MOBILE_API.md` consumers before shipping Phase 4. |
| D11 | Late payment on an accepted-Booked row | The confirm paths flip `deposit_status` to `Paid` (or `Card Held`) without touching `status`, and send the deposit receipt only (no duplicate booking confirmation). |
| D12 | Attendance-confirm promotion from `Pending` | The staff attendance toggle currently promotes `Pending -> Confirmed` directly (an illegal transition per the map, long-standing). Keep the promotion (some venues may use Pending as manual approval) but subject it to the same unpaid guard as the primary action. Applies to the single-row branch AND the group helper. |
| D13 | The "Mark pending" revert (`Booked -> Pending`) | It has never worked: `BOOKING_REVERT_ACTIONS.Booked` targets `Pending`, but `BOOKING_STATUS_TRANSITIONS.Booked` does not include it, so the server always 400s. Remove the dead entry (and its rendered button) rather than legalise the transition; D4 makes it unnecessary. |
| D14 | Staff-sent payment links vs the sweep | When staff send a payment link for a Pending online booking (re-engaging the guest), the 30-minute sweep must not cancel it underneath them. Rows with a `deposit_request_*` or `card_hold_request_*` communication log newer than 24h are excluded from the online sweep; they follow the phone-style 24h deadline instead. |

---

## 3. Phase 1: sweep failed and abandoned online money bookings

All in `src/app/api/cron/auto-cancel-bookings/route.ts` plus the pure helpers in
`src/lib/booking/card-hold-cron.ts`. Cron cadence is `*/30` (vercel.json), so all "30 minute"
windows below land in practice 30-60 minutes after creation.

### 3.1 Widen the PI-status sweep (sweep 4) to every online money booking

Today sweep 4 is restricted to `source = 'online'` + `class_instance_id NOT NULL` (route.ts:425-436)
plus payment_with_setup hold units. Replace the class-only candidate query with:

- `status = 'Pending'`
- `deposit_status IN ('Pending', 'Failed')`  (the `'Failed'` widening is load-bearing: today one
  failed attempt exempts a row from every sweep, because `payment_intent.payment_failed` rewrites
  the very column the sweeps filter on)
- `source IN ('online', 'widget', 'booking_page')` (use `CARD_HOLD_ONLINE_SOURCES`)
- `stripe_payment_intent_id NOT NULL`
- `created_at < now - 30min`, `limit 200`
- SELECT must carry `booking_date, booking_time, party_size` (guest notification payload) plus
  `class_instance_id` and `group_booking_id` (event reason + notification dedupe), which the
  current class-only query does not.

Drop the `class_instance_id` filter entirely. This automatically covers appointments, tables,
events, single classes, resources, multi-service and group bookings; group/multi-service siblings
share one PI and are already grouped by the per-PI loop.

**D14 exclusion**: before the per-PI loop, drop candidates that have a
`communication_logs` row of type `deposit_request_email|deposit_request_sms|card_hold_request_email|card_hold_request_sms`
created in the last 24h (one `.in('booking_id', ...)` query, mirroring `excludeBookingsWithHolds`).

Keep the existing per-PI verification on the correct account (hold snapshot account wins). Then:

- `requires_payment_method` / `canceled` / `requires_confirmation`: definitively not paid ->
  cancel the rows (`status: 'Cancelled'`, `deposit_status: 'Failed'`, actor `system`), release
  holds, then best-effort `stripe.paymentIntents.cancel(piId)` (skip when already `canceled`).
- `succeeded` (M3 self-heal): the webhook and client confirm both missed a real payment. Run the
  shared helper `selfHealSucceededPaymentIntent` (new,
  `src/lib/booking/self-heal-succeeded-payment.ts`, also used by 3.5 and 8.2 so the comms cannot
  be forgotten in one caller): confirm via `confirmBookingsForSucceededPaymentIntent`, send the
  deposit-paid comms for the confirmed ids (the confirm helper is DB-only), and insert a
  `reconciliation_alerts` row (`succeeded_unconfirmed_selfhealed`). A `booking_cancelled` confirm
  result inserts the alert only (matches the webhook's J2 handling).
- `requires_action` / `processing`: skip this run. **24h backstop (M4)**: when such a row's
  `created_at` is older than 24h, treat `requires_action` as abandoned (cancel rows + cancel PI);
  `processing` is never force-cancelled.

Event payload `reason`: keep `card_hold_setup_abandoned` for hold units, keep
`class_cart_abandoned` for class-cart rows, use new `online_payment_abandoned` for everything
else.

### 3.2 Notify on sweep cancellation

For each cancelled capture unit (dedupe by `group_booking_id`, fall back to booking id), call the
existing `sendAutoCancelNotifications` (guest email/SMS + staff push `payment_failed`). Copy comes
from the existing `auto_cancel_notification` template; plain second person, no em-dashes.

### 3.3 Sweep rows that never got a PaymentIntent

New small arm: `status='Pending'`, `deposit_status='Pending'`, `deposit_amount_pence > 0`, online
sources, `stripe_payment_intent_id IS NULL`, older than 30 minutes. These are rows where the PI
create succeeded but the DB write failed (see Phase 6, 8.1) or an unknown crash path. Nothing can
ever pay them. Cancel with reason `payment_setup_incomplete`.

### 3.4 Widen the `'Failed'` filter in the other sweeps

- Sweep 1 (phone deposits, 24h): `deposit_status IN ('Pending','Failed')`.
- Sweeps 3 and 4 hold joins: `.in('booking.deposit_status', ['Pending','Failed'])`
  (payment_with_setup rows get flipped to `Failed` by the webhook too, since they share the money
  PI).
- `deposit-reminder-2h` phone arm: include `'Failed'` so a guest whose attempt bounced still gets
  the reminder link.

### 3.5 Verify the PI before the phone sweep cancels

Sweep 1 currently cancels 24h-old phone bookings on DB state alone. Before cancelling, group by
PI and retrieve it (rows with no PI genuinely never paid; cancel as today). If `succeeded`: do
not cancel; self-heal exactly as in 3.1 (confirm + comms + alert). If `processing`: skip this run.

Tests: extend `route.card-hold.test.ts` (and split a `route.online-sweep.test.ts`) with:
widened-source sweep; `'Failed'` row sweep; group sibling sweep; D14 comm-log exclusion; PI
cancelled after row cancel; `succeeded` self-heal sends comms and alert; `requires_action` young
row skipped and 24h-old row cancelled; never-got-PI arm; phone-sweep self-heal.

---

## 4. Phase 2: `payment_intent.payment_failed` webhook improvements

In `src/app/api/webhooks/stripe/route.ts` (generic failure branch, lines 407-480):

1. After flipping rows to `Failed`, insert one `events` row per booking:
   `event_type: 'deposit_payment_failed'`, payload `{ payment_intent_id, failure_code }` from
   `pi.last_payment_error`. Best-effort (log, never throw): the `Failed` flip is the critical
   write; an events failure must not trigger webhook redelivery storms.
2. Send `sendStaffPush(..., 'payment_failed')` once per venue. Note: `rowsToFail` carries ids
   only; fetch the lead booking's guest name / date / time for the push body (the helper needs
   them). Keep the `kitchen_email` custom message exactly as-is for venues that configured it.
3. No booking-status change here (D2). The Phase 1 sweep is the enforcement arm.

Tests: focused `route.payment-failed.test.ts`: events inserted, push sent once per venue with
real booking fields, no status change, existing `Failed` flip and credit-restore behaviour
unchanged.

---

## 5. Phase 3: staff visibility of failed deposits

1. `src/lib/booking/booking-staff-indicators.ts`: add

   ```ts
   export function showDepositFailedPill(row: BookingStaffIndicatorInput): boolean {
     return row.deposit_status === 'Failed';
   }
   ```

   (No amount gate: a `Failed` row always represents a failed collection attempt, including
   payment_with_setup hold rows whose `deposit_amount_pence` is NULL.)
2. Render a red "Deposit failed" pill (danger variant, dot) beside the existing "Deposit pending"
   pill in every surface that shows it today, **status-gated at the render site exactly like the
   pending pill** (`['Pending','Booked','Confirmed'].includes(status)`, so Cancelled rows do not
   carry the pill):
   - `src/components/booking/AppointmentDetailSheet.tsx` (~line 627)
   - `src/components/booking/AppointmentRegistryCard.tsx` (~line 170)
   - `src/components/booking/BookingDetailContent.tsx` (~line 208)
   Grep for `showDepositPendingPill` at implementation time to catch new callers.
3. Pill copy: `Deposit failed` with `title="The deposit payment failed. Send a new payment link or accept without payment."`
4. Unit tests in `booking-staff-indicators.test.ts`.

---

## 6. Phase 4: guard every unpaid promotion and keep the deposit collectable

### 6.1 Server guard on the status branch, per capture unit (B2)

`src/app/api/venue/bookings/[id]/route.ts`, status branch (after the transition check at ~772):

When `newStatus IN ('Booked','Confirmed')` and `booking.status === 'Pending'` and the **capture
unit** still owes its capture, require an explicit `accept_unpaid: true` field in the PATCH body;
otherwise return:

```
409 { error: 'The deposit for this booking has not been paid.',
      code: 'DEPOSIT_UNPAID',
      deposit_status, deposit_amount_pence, card_hold_fee_pence }
```

Definitions:

- "Capture unit" = the row plus, when `group_booking_id` is set, every sibling loaded via
  `loadGroupBookingSiblings`. The guard trips when ANY unit row still owes; `accept_unpaid`
  covers the whole unit (the existing group status sync then flips the siblings as today).
- "Still owes" = `deposit_status IN ('Pending','Failed')` AND (`deposit_amount_pence > 0` OR an
  open unsaved hold exists: `booking_card_holds` row with `released_at IS NULL AND
  stripe_payment_method_id IS NULL`).

When `accept_unpaid` is used:

- flip the status as today (group sync included);
- insert `events` row `booking_accepted_without_payment` per flipped row with
  `{ staff_id, deposit_status }`;
- assign manage tokens where missing and send the standard booking confirmation comms (the guest
  of an unpaid booking has never received one; reuse `assignConfirmTokens` +
  `sendDepositPaidBookingComms` with a skip-deposit-receipt flag).

### 6.2 Gate the attendance promotion paths (B1, D12)

The attendance toggle is a second, independent promotion path and must be gated identically:

- Single-row branch (`[id]/route.ts:558-564`): `staff_attendance_confirmed: true` on a
  `Pending` (or legacy `'Deposit Pending'`) booking sets `status = 'Confirmed'` directly. Before
  doing so, run the same capture-unit guard; 409 `DEPOSIT_UNPAID` unless `accept_unpaid: true`
  accompanies the PATCH. When accepted, the same events + comms as 6.1 apply.
- Group helper (`src/lib/booking/group-booking-status-sync.ts:182-188`,
  `applyGroupStaffAttendanceChange`): same promotion per sibling. Hoist the guard to the PATCH
  route BEFORE calling the helper (the helper stays dumb); pass an `allowUnpaidPromotion` flag it
  asserts on.
- The guest-side attendance confirm is unaffected: guests only obtain manage links after payment
  or acceptance, and the guard is staff-route-scoped.

### 6.3 Status-change audit (D8)

Both branches above (and the plain status branch): insert `events` row `booking_status_changed`,
payload `{ from, to, staff_id }`. Cheap, and makes the next incident reconstructable.

### 6.4 Client dialog

New shared component `src/components/booking/AcceptUnpaidBookingDialog.tsx`, driven by the 409:

- Heading: `Deposit not paid`
- Body: `The £{amount} deposit for this booking has not been paid. The last attempt failed.` (or
  `has not been paid yet.` when `deposit_status === 'Pending'`; card-hold variant names the card
  request instead).
- Actions: `Send payment link` (POST `[id]/deposit` `send_payment_link`), `Accept without payment`
  (retry PATCH with `accept_unpaid: true`), `Go back`.

Wire it via a small shared hook (`useAcceptUnpaidGuard`) wrapping the status PATCH into every
caller: `AppointmentDetailSheet.tsx` (`setStatus` ~416 and the attendance toggle),
`app/dashboard/bookings/ExpandedBookingContent.tsx` (~1100),
`app/dashboard/day-sheet/DaySheetView.tsx`, `app/dashboard/table-grid/TimelineGrid.tsx`,
`app/dashboard/bookings/BookingDetailPanel.tsx`. Grep for status PATCH senders at implementation
time.

### 6.5 Rename the Pending primary action (D9, owner) and remove the dead revert (D13)

- `src/lib/table-management/booking-status.ts:43`: `Pending: { label: 'Accept', target: 'Booked' }`.
  All surfaces render the label from this map, so one change propagates. Check e2e snapshots.
- Delete `BOOKING_REVERT_ACTIONS.Booked` (`Mark pending`): the server has always rejected
  `Booked -> Pending` (`BOOKING_STATUS_TRANSITIONS.Booked` does not include `Pending`), so the
  button can only ever produce an error toast. D4 removes any need for it.

### 6.6 Keep the payment link alive after acceptance (D4)

`src/app/api/booking/pay/route.ts` (~109): replace the `status !== 'Pending'` 404 with:

- allow `status IN ('Pending','Booked','Confirmed')` when `deposit_status IN ('Pending','Failed')`
  and a PI (or open unsaved hold) exists;
- retrieve the PI as today; if its status is `canceled` (a D7 cancellation), return the friendly
  "This link has expired. Please contact the venue for a new one." 400; if `succeeded`, return the
  existing "already secured/completed" nicety.

`[id]/deposit` `send_payment_link` non-hold branch: add a guard rejecting when
`deposit_status NOT IN ('Pending','Failed')` (Paid/Waived/Refunded) with a clear message, and
allow it for `Booked`/`Confirmed` statuses.

### 6.7 Late payment completes the accepted row (D11)

`src/lib/booking/confirm-deposit-payment.ts` `confirmBookingsForSucceededPaymentIntent`:

- Current behaviour: only `status === 'Pending'` rows flip; accepted-Booked rows with an owed
  deposit fall into the zero-candidate path and return `alreadyConfirmed`, silently losing the
  payment record. Add a second candidate class: rows with `status IN ('Booked','Confirmed')` AND
  `deposit_status IN ('Pending','Failed')`. For these, update `deposit_status` only (`'Paid'`, or
  `'Card Held'` per the existing hold rule) with the race-safe conditions in the UPDATE itself,
  leaving `status` untouched.
- Comms: deposit receipt only for these rows (suppress the booking-confirmation resend; the
  acceptance already sent one). Thread a per-row flag into `sendDepositPaidBookingComms`.
- Mirror in `confirmBookingsForSucceededSetupIntent` for accepted card-hold bookings
  (deposit_status `'Pending' -> 'Card Held'`, status untouched).

Tests: `confirm-deposit-payment.test.ts` accepted-row cases (paid, hold, mixed unit of Pending +
accepted rows); new `[id]/route.status-guard.test.ts` (409 without flag on primary action AND on
attendance toggle, single and group; accept_unpaid flips + events + comms; paid/waived rows
unaffected; audit event on every status change); `booking/pay/route.test.ts` (Booked+Failed
serves the client_secret; canceled PI friendly 400; Cancelled booking 404); deposit-route
send-link gate tests.

---

## 7. Phase 5: honest guest-facing flows

### 7.1 Shared confirm helper

New `src/lib/booking/client-confirm-payment.ts` (client-safe):

```ts
export type ConfirmOutcome = 'confirmed' | 'processing' | 'cancelled' | 'unconfirmed';
export async function confirmBookingPaymentWithServer(body: {
  booking_id?: string; payment_intent_id?: string; setup_intent_id?: string; guest_email?: string;
}): Promise<ConfirmOutcome>
```

Behaviour: up to 3 attempts with backoff (port of `BookingFlow.tsx:304-320`); maps
`{confirmed:true}` to `confirmed`, `code:'BOOKING_CANCELLED'` to `cancelled`,
`payment_status/setup_status === 'processing'` to `processing`, everything else to `unconfirmed`.

### 7.2 Flows consume the outcome

Update `handlePaymentComplete` (and the group variant) in `AppointmentBookingFlow.tsx`,
`ClassBookingFlow.tsx`, `EventBookingFlow.tsx`, `ResourceBookingFlow.tsx`, `BookingFlow.tsx`,
`ClassMultiSessionCart.tsx`, and the staff-link `/pay` page (`src/app/pay/page.tsx`, whose local
"Deposit paid. Your booking is confirmed." card has the same unconditional-success problem):

- `confirmed`: confirmation step as today.
- `processing` / `unconfirmed`: confirmation step in a "payment processing" variant: heading
  `Almost done`, body `Your payment is being processed. You will get your confirmation by email
  or text as soon as it clears.` No unconditional "confirmed" claim.
- `cancelled`: error state with the server's message (`This booking was cancelled because it was
  not completed in time. Please make a new booking. If you were charged, the venue will arrange a
  refund.`) and a "Start again" action.
- `ClassMultiSessionCart`: delete the `alert('Payment successful...')`; replace with the same
  state-driven copy.
- Map Stripe's confirm error for a canceled PI (the sweep got there first) to the same friendly
  cancelled copy instead of the raw Stripe message.

### 7.3 3DS redirect return

- `src/components/booking/PaymentStep.tsx:88`: `return_url` becomes
  `/pay/success?booking_id=${bookingId}`; add a required `bookingId` prop threaded from each flow
  (all flows have it in their create result).
- `src/app/pay/success/page.tsx`: run the best-effort confirm for payment mode too (drop the
  `mode !== 'setup'` early return; body `{ booking_id }` or `{ payment_intent_id }` from Stripe's
  `payment_intent` param). Keep the render states; they are driven by `redirect_status`.
- Failure card: keep `Try again` (history.back) but add
  `If that does not work, contact the venue to finish your booking.`

Tests: `redirect-params.test.ts` additions; new `client-confirm-payment.test.ts` (outcome mapping
plus retry); flow component tests where they exist; otherwise the Phase 8 e2e.

---

## 8. Phase 6: hardening

### 8.1 Error-check the PI linkage write

Everywhere a PI is created and then written to `bookings.stripe_payment_intent_id` without
checking the result:

- `src/app/api/booking/create/route.ts` (~594 and ~1914)
- `src/app/api/booking/create-multi-service/route.ts` (~741 and ~809)
- `src/app/api/booking/create-group/route.ts` (both branches)
- `src/app/api/venue/bookings/route.ts` (~1452 and ~1845)
- `src/lib/booking/staff-booking-payment-comms.ts` (~190)

On update error: `stripe.paymentIntents.cancel` the just-created PI (best-effort),
`cancelBookingAfterPaymentFailure(...)` (or the route's existing delete for staff routes), and
return the route's existing "Payment setup failed" 500. Never return a client_secret whose PI is
not persisted.

**Orphaned-PI catches (pass-2 major)**: every existing cleanup catch that abandons the booking
AFTER a PI was successfully created must also cancel that PI, or a guest holding the client
secret can pay money against a deleted booking (the webhook then finds nothing and acks):

- `create-multi-service/route.ts` mixed-mode catch (~825): deletes bookings and the hold
  customer, never cancels the PI created at ~791; same shape in the payment-mode catch when the
  linkage write starts being checked.
- `create-group/route.ts`: both catches, same shape.
- `staff-booking-payment-comms.ts` deposit catch (~196): a `createOrGetPaymentShortLink` failure
  AFTER the PI create throws `payment_failed`, the caller deletes the booking, and the PI stays
  live. Track the created PI id in the try scope and cancel it in the catch (mirror the
  SetupIntent-cancel precedent in `create/route.ts` ~1970).

### 8.2 Reconciliation arm for stuck money rows (daily backstop)

`src/app/api/cron/reconciliation/route.ts` (runs 06:00 daily): new arm querying bookings with
`status = 'Pending'`, `deposit_status IN ('Pending','Failed')`, `stripe_payment_intent_id NOT
NULL`, updated between 30 minutes and 48 hours ago, limit 200, grouped by PI. If `succeeded`:
self-heal via the shared `selfHealSucceededPaymentIntent` helper (confirm + comms + alert; a
`booking_cancelled` result alerts only). The Phase 1 sweeps are the fast path (30-60 min); this
catches anything they miss. **Scope note**: the arm stays `status = 'Pending'` in PR 1; widening
to accepted `Booked`/`Confirmed` rows only makes sense after Phase 4's 6.7 ships (before that,
the confirm helper cannot flip an accepted row's deposit and every accepted-unpaid booking would
raise a false alert daily). Widen it in PR 2.

### 8.3 Cancel the open PI wherever the debt ends un-collected (D7)

Shared helper `cancelOpenDepositIntent(admin, rows)` (skips when any live sibling still owes the
same PI; retrieves before cancelling and never touches `succeeded`/`processing`), called from:

- staff cancel: `src/app/api/venue/bookings/[id]/route.ts` cancel branch (~800) and
  `src/lib/booking/staff-cancel-booking.ts`;
- guest cancel: `src/app/api/confirm/route.ts` cancel action;
- `waive` and `record_cash` in `[id]/deposit/route.ts` (M2: today both leave the PI confirmable,
  so a guest can later pay a waived deposit, which the confirm path books as status-flip with
  `deposit_status` stuck at `Waived`: money taken and recorded nowhere; or double-collect a
  cash-settled one);
- the Phase 1 sweeps (already specified there).

Tests: helper unit tests (sibling-owing skip, succeeded/processing untouched); waive and
record_cash cancel the PI; guest-cancel and staff-cancel paths.

---

## 9. Test plan

| Area | File(s) | New cases |
|---|---|---|
| Sweep widening | `auto-cancel-bookings/route.card-hold.test.ts` + new `route.online-sweep.test.ts` | booking_page/widget deposit rows swept; `Failed` rows swept; group siblings swept together; D14 comm-log exclusion; requires_action young row NOT swept, 24h-old row swept; PI cancelled after cancel; `succeeded` self-heals with comms + alert; no-PI arm; phone sweep self-heals |
| Webhook | new `route.payment-failed.test.ts` | events row inserted; staff push once per venue with fetched booking fields; status untouched |
| Confirm paths | `confirm-deposit-payment.test.ts` | accepted-Booked deposit flip (paid + hold); mixed units; receipt-only comms flag; status untouched; idempotent replay |
| Staff guard | new `[id]/route.status-guard.test.ts` | 409 on primary action; 409 on attendance toggle (single + group); group unit with one owing sibling trips; accept_unpaid flips + events + comms; paid/waived/cash rows unaffected; audit event on every status change |
| Pay route | `booking/pay/route.test.ts` | Booked+Failed serves client_secret; canceled PI friendly 400; Cancelled booking 404; succeeded nicety |
| Deposit actions | `[id]/deposit` tests | send-link status/deposit gates; waive cancels PI; record_cash cancels PI |
| Indicators | `booking-staff-indicators.test.ts` | failed pill logic |
| Client helper | new `client-confirm-payment.test.ts` | outcome mapping + retry |
| E2E (`e2e/`) | new spec | create deposit booking, decline the payment with test card `4000 0000 0000 0002` (PI lands `requires_payment_method`; an abandoned-3DS card stays `requires_action` and is deliberately NOT swept inside 24h, so it cannot drive this test), invoke the cron endpoint, assert booking Cancelled + slot rebookable; staff accept-unpaid dialog path |

Manual QA matrix (staging, seeded venue from the linked-accounts dev fixtures):

1. Online deposit booking, abandon at payment step: cancelled within 30-60m, guest email
   received, slot reopens.
2. Online deposit booking, failed card: staff push received, red pill visible, cancelled within
   30-60m.
3. Failed attempt then inline retry with good card inside the window: booking confirmed, deposit
   Paid.
4. Staff taps Accept on unpaid Pending: dialog appears; "Send payment link" delivers a working
   link; paying it flips deposit to Paid without touching status; receipt only, no duplicate
   confirmation.
5. Staff toggles attendance-confirm on unpaid Pending: same dialog, no silent promotion (repeat
   for a multi-service group).
6. Accept without payment: booking Booked, guest gets confirmation, events rows present.
7. Staff sends a payment link on a Pending online booking at minute 10: booking survives the
   30-minute sweep; still cancelled by the 24h deadline if never paid.
8. Waive on an unpaid deposit, then try the old payment tab: payment fails cleanly (PI
   cancelled); no money taken.
9. Phone booking paid via link where the webhook is blocked (simulate): 24h sweep self-heals with
   comms instead of cancelling.
10. Old-app simulation (raw PATCH without `accept_unpaid`): clean 409 with readable message, on
    both the status and attendance fields.

---

## 10. Rollout

No feature flags (repo convention per the customer-portal plan): staging first, then production.

1. **PR 1: Phases 1, 2, 6 (8.1, 8.2)** - server-only, no UI contract changes. Deploy to staging;
   manually invoke `/api/cron/auto-cancel-bookings` and `/api/cron/reconciliation`; verify counts
   and events against seeded fixtures before production. Known transitional gap: until PR 3, a
   guest who dawdles past the sweep window sees Stripe's raw canceled-intent error instead of the
   friendly copy; accepted.
2. **PR 2: Phases 3, 4 and 8.3** - staff guard (both promotion paths) + dialog + pay-route
   widening + confirm-path change + PI-cancel-on-waive ship together (the guard without the
   dialog would strand web staff; the dialog's "send link" needs the pay-route change; waive is
   one of the dialog's escape hatches, so its PI-cancel rides along). Coordinate the app-team
   follow-up (D10).
3. **PR 3: Phase 5** - guest flow honesty + /pay page + /pay/success. Independent of PR 2.
4. After PR 1 has run in production for a week, check `reconciliation_alerts` and the
   `auto_cancelled` events volume for surprises.

Immediate operational guidance for the live incident (no code needed):

- The CBL booking (`#3fcdfe96`) is `Booked` with deposit `Failed`. Note: "Mark pending" does NOT
  work (D13, dead button) and a re-sent payment link would show the guest "Booking not found or
  already completed" while the booking is `Booked`. The venue's real options today: collect the
  £20 in person at the visit (the £35.00 outstanding balance already includes the full price;
  use `Record cash` on the deposit card if settling the deposit specifically), or cancel and
  rebook if the customer will not attend.
- Until PR 1 ships, venues should treat any booking showing "Deposit Failed" as unpaid.

## 11. Effort estimate

| Phase | Estimate |
|---|---|
| 1 (sweeps incl. self-heal + exclusions) | 2 days incl. tests |
| 2 (webhook) | 0.5 day |
| 3 (pills) | 0.5 day |
| 4 (guard on both paths + collectability + confirm paths + dead revert) | 3 days incl. tests |
| 5 (client flows + /pay + /pay/success) | 1.5 days |
| 6 (hardening incl. waive/record_cash PI-cancel) | 1 day |
| E2E + QA + rollout babysitting | 1 day |
| **Total** | **~9.5 days** |
