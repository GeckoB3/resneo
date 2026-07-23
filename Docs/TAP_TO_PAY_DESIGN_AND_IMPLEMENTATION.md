# Tap to Pay — Design & Implementation Document

> **Status:** Draft for implementation · **Scope:** `resneo` (Next.js backend) + `resneo-app` (Expo/React Native staff app)
> **Canonical location:** this file (`resneo/Docs/TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md`). A pointer copy lives in `resneo-app/Docs/TAP_TO_PAY.md`.
> **Verified against code:** 2026-06-24 — see §16 for the verification log and the adjustments it produced. Every new table, column, endpoint, file, and UI state is specified; code blocks are implementation sketches aligned to existing patterns (follow the cited reference files for exact house style).
>
> **Implementation status (as of 2026-07-23):** The **resneo backend is implemented** per §15's backend list (migration, ledger, all three payment endpoints, webhook branches, receipt, GET/bootstrap extensions), with the §16 third-review adjustments; 49 dedicated tests plus the full suite pass. The **resneo-app mobile side is not built yet** — §7/§7A remain a design to implement.

---

## 1. Overview

### 1.1 Problem
Clients book appointments online and pay **nothing or a deposit**. There is currently no way to collect the **outstanding balance in person** at the appointment. Staff use a separate SumUp/Zettle terminal and Resneo keeps no record, so revenue reporting is incomplete and the booking→pay→rebook loop isn't closed in-app.

### 1.2 Solution
Add **Stripe Tap to Pay on iPhone & Android** (contactless, **no hardware reader** — the staff phone's NFC is the reader) to the **resneo-app** staff app. A staff member opens an appointment, taps **Take payment**, and the client taps their card or phone to settle the balance.

**§7A additionally specifies an optional physical Stripe Terminal reader** (Bluetooth-paired, e.g. BBPOS WisePad 3) as a second card method for venues that prefer a dedicated reader. It reuses the same connection-token, Terminal Location, charge route, webhook, ledger, and receipt end to end — the only additions are mobile-side (a `bluetoothScan` discovery path and reader-management UX). The Tap to Pay design below (§1-§7) stands unchanged.

Payment is collected via **Stripe Connect direct charges**: the money lands **directly in the venue's Stripe account, with 0% taken by Resneo** (the platform sets no `application_fee` anywhere today, and this feature keeps it that way). Resneo never holds the funds — preserving the existing "platform is not a payment institution" posture.

### 1.3 The frictionless principle (hard requirement)
**Taking payment is an optional, per-appointment action. It is never required and never blocks anything.**

- A venue that does not want Tap to Pay simply never enables it → the app is byte-for-byte unchanged for them.
- A venue that enables it sees a **Take payment** button on appointments that have an outstanding balance — but using it is entirely the staff's choice, appointment by appointment.
- **No appointment lifecycle step depends on payment.** An appointment can be confirmed, seated, completed, no-showed, cancelled, or edited whether or not any payment was taken. There are **no payment gates, no nags, and no auto-prompts.**
- We deliberately do **not** add any "require payment before completion" setting — that would violate this requirement.

Section 3 specifies exactly how this optionality is enforced.

### 1.4 Non-goals (v1)
- **No tips** in v1 (a `tip_amount_pence` column is created now, default 0, so tips drop in later with no migration).
- **No retail POS** (product catalogue, inventory, baskets) — out of scope and off-strategy.
- **No forced/required payment** of any kind.
- **No saved-card off-session charging** for balances (card is physically present; not needed).
- **Appointments only** in v1 (classes/events are typically pre-paid online; restaurant tables rarely settle a balance this way).
- **No internet/smart countertop readers** (Stripe Reader S700, BBPOS WisePOS E, Verifone P400) in v1. The two card methods are **Tap to Pay** (§1-§7) and a **Bluetooth handheld reader** (§7A) — both paired to the practitioner's own device, matching Resneo's mobile per-practitioner model. A fixed till shared across staff (the internet/smart-reader shape) is a different workflow, needs its own onboarding (registration-code + reader-to-account association, `internet` discovery), and is deferred to §14.

---

## 2. Scope (v1)

| Dimension | v1 decision |
|---|---|
| Payment captured | **Outstanding balance only** (no tip prompt) |
| Methods | **Tap to Pay card** (phone NFC) + **physical Bluetooth reader** (§7A) + **cash/external recording** + **refunds** — all written to an audit ledger |
| Booking models | **Appointments only** (`booking_model ∈ {practitioner_appointment, unified_scheduling}`) |
| Rollout | Behind a **venue feature flag** (default off), pilot → widen |
| Money flow | Connect **direct charge**, **0% platform fee** |
| Optionality | **Per-appointment, fully optional** (Section 3) |

---

## 3. Optionality & frictionless per-appointment use

This is a first-class design constraint, not an afterthought. It is realised through three independent layers.

### 3.1 Two-layer model: capability vs. usage

**Capability (venue-level, configured once):** whether the app *offers* in-person payment at all for a venue. Derived from:
- `venues.in_person_payments_enabled` (new boolean flag, default **false**) — the venue has opted in.
- `card_present_ready` (derived) — the venue's connected Stripe account has the **card-present capability** active and a **Terminal Location** exists. Required specifically for the *Tap to Pay card* option; cash/external recording does not need it.

**Usage (per-appointment, decided live by staff):** whether to actually take a payment on *this* appointment. Always optional, never persisted as a requirement.

The capability layer is set up once per venue (or never, for venues that opt out). The usage layer imposes zero configuration burden — staff just tap, or don't.

### 3.2 What "frictionless to NOT use" means concretely
- **Venue not enabled** (`in_person_payments_enabled = false`): no Tap to Pay UI is rendered anywhere. `BookingDetailContent` behaves exactly as today. Zero new buttons, zero new network calls, zero behaviour change.
- **Venue enabled, but staff don't want to charge this appointment:** they ignore the **Take payment** button. The appointment can be completed/closed with an outstanding balance. No warning, no required step, no follow-up nag. `payment_state` simply stays `unpaid`/`deposit_paid` — these are **normal terminal states, not errors.**
- **Opening the sheet is non-committal:** staff can dismiss `TakePaymentSheet` at any state with **no side effects**. No `booking_payments` row reaches `succeeded` and no booking summary changes until a payment actually succeeds. An in-flight card PaymentIntent that is abandoned is cancelled client-side and/or expires server-side.

### 3.3 What "frictionless to USE" means concretely
- On an appointment with a balance, taking payment is: tap **Take payment** → (confirm/adjust amount) → **Tap to Pay** → client taps card → success. No per-appointment setup.
- The same sheet offers **Record cash/other** (one tap) and, for admins, **Refund** — so the one surface covers every in-person settlement path.

### 3.4 Enforcement checklist (must hold true)
1. No status-transition endpoint or UI control is modified to check `payment_state`. (Audit `useUpdateBookingStatus` and the booking status routes — they must remain payment-agnostic.)
2. The **Take payment** button is rendered **only** when `in_person_payments_enabled && isAppointment && !isCancelled && payment_state ∉ {paid, refunded} && (balanceDue === null || balanceDue > 0)`. `balanceDue` is `null` when the price is unknown (§5.7) — in that case the button still shows and staff enter the amount. Otherwise the button does not exist in the tree.
3. No code path auto-opens `TakePaymentSheet` (no `useEffect` triggers on status change, arrival, completion, etc.).
4. `payment_state ∈ {unpaid, deposit_paid, partially_paid}` is rendered as neutral information, never as a blocking error or a required-action callout.
5. Disabling the venue flag instantly removes the entire surface with no data migration and no orphaned UI.

---

## 4. Architecture overview

```
┌──────────────────────────── resneo-app (Expo / RN) ────────────────────────────┐
│ BookingDetailContent.tsx                                                        │
│   └─ "Take payment" (only if capability + balance + appointment)                │
│        └─ TakePaymentSheet.tsx                                                   │
│             ├─ Tap to Pay card  ─► useTakePayment()                             │
│             │     1. POST /charge            → { client_secret }                 │
│             │     2. Terminal SDK: retrieve → collect → confirm                  │
│             ├─ Record cash/other ─► useRecordExternalPayment()  → POST /charge   │
│             └─ Refund (admin)     ─► useRefundPayment()          → POST /charge   │
│   TerminalProvider.tsx  (tokenProvider → POST /payments/connection-token)        │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                        │  apiFetch (Bearer JWT)
┌──────────────────────────────────────▼────────────── resneo (Next.js) ──────────┐
│ POST /api/payments/connection-token   → terminal.connectionTokens.create + loc   │
│ POST /api/venue/bookings/[id]/charge  → card: PaymentIntent (card_present)        │
│                                          cash/external: ledger row only           │
│                                          refund: refunds.create                   │
│ POST /api/webhooks/stripe (extended)  → payment_intent.succeeded (purpose=balance)│
│        └─ confirm-balance-payment: write ledger + recompute summary + receipt     │
│ Stripe (per venue, via { stripeAccount: venues.stripe_connected_account_id })     │
│ DB: booking_payments (ledger) + bookings.{amount_paid_pence,tip_amount_pence,     │
│     payment_state}                                                               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Source-of-truth principle:** the **webhook** writes the authoritative paid state. The mobile success handler is optimistic UI + cache invalidation only; it never sets paid state from the client confirm result alone.

---

## 5. Data model (resneo)

New migration: `supabase/migrations/2026XXXXXXXXXX_booking_payments_ledger.sql`.
Model it on the existing class-commerce ledger (`supabase/migrations/20260702120000_class_commerce_phase2_ledgers.sql`) — same conventions: a named unique constraint on the Stripe PI, RLS enabled with **no policies** (service-role only), `gen_random_uuid()`, `amount_pence int CHECK (>= 0)`, `currency text DEFAULT 'gbp'`, `metadata jsonb DEFAULT '{}'`.

### 5.1 Enums
```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_payment_method') THEN
    CREATE TYPE public.booking_payment_method AS ENUM ('card_present','cash','external','online');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_payment_status') THEN
    CREATE TYPE public.booking_payment_status AS ENUM ('pending','succeeded','failed','refunded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_payment_state') THEN
    CREATE TYPE public.booking_payment_state AS ENUM
      ('unpaid','deposit_paid','partially_paid','paid','refunded');
  END IF;
END $$;
```
> Note: this is the DB enum for the whole-booking *state*. The **PaymentIntent metadata purpose** is a separate string constant — add `APPOINTMENT_BALANCE: 'appointment_balance'` to `RESERVE_NI_PI_PURPOSE` in `src/types/class-commerce.ts` (the webhook already branches on that constant for the class-commerce purposes; §6.4).

### 5.2 Ledger table `booking_payments` (source of truth)
```sql
CREATE TABLE IF NOT EXISTS public.booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  venue_id   uuid NOT NULL REFERENCES public.venues (id)   ON DELETE CASCADE,
  -- Connected account the charge settled on; stored so refunds route correctly
  -- even if the venue's account id later changes.
  stripe_connected_account_id text,
  stripe_payment_intent_id text,                 -- null for cash/external
  method public.booking_payment_method NOT NULL,
  status public.booking_payment_status NOT NULL DEFAULT 'pending',
  amount_pence int NOT NULL CHECK (amount_pence >= 0),       -- goods/services (balance)
  tip_amount_pence int NOT NULL DEFAULT 0 CHECK (tip_amount_pence >= 0), -- RESERVED, unused in v1
  currency text NOT NULL DEFAULT 'gbp',
  purpose text NOT NULL DEFAULT 'balance',       -- human label for the ledger row
  staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,  -- who collected it
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One ledger row per PaymentIntent → webhook update is idempotent.
-- (Partial index because cash/external rows have a NULL stripe_payment_intent_id.)
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_pi_uq
  ON public.booking_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking
  ON public.booking_payments (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_payments_venue
  ON public.booking_payments (venue_id, created_at DESC);

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;  -- no policies = service-role only
```

### 5.3 Summary columns on `bookings` (denormalised, derived)
```sql
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS amount_paid_pence int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_amount_pence  int NOT NULL DEFAULT 0,  -- reserved, unused in v1
  ADD COLUMN IF NOT EXISTS payment_state public.booking_payment_state NOT NULL DEFAULT 'unpaid';

-- Backfill so the balance is correct day one: a paid deposit counts toward amount_paid.
-- (Waived / Forfeited / Not Required deposits leave amount_paid at 0 → full amount due in
--  person, which is the correct behaviour.)
UPDATE public.bookings
   SET amount_paid_pence = COALESCE(deposit_amount_pence, 0),
       payment_state = 'deposit_paid'
 WHERE deposit_status = 'Paid' AND COALESCE(deposit_amount_pence,0) > 0;
```

**Do not overload `deposit_status`** — leave the deposit columns/flow untouched. `payment_state` is the new whole-booking state.

### 5.4 Venue capability columns
```sql
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS in_person_payments_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_terminal_location_id text;  -- lazily provisioned (Section 6.1)
```
`card_present_ready` is **derived at request time** (Section 6.6), not stored, so it can't drift from Stripe's actual capability state.

### 5.5 `payment_state` derivation
Computed by `recomputeBookingPaymentSummary` from `SUM(booking_payments WHERE status='succeeded')`, where `total` = the **resolved total** (§5.7), not the raw column:

| Condition | `payment_state` |
|---|---|
| `total > 0` and `amount_paid_pence >= total` | `paid` |
| `0 < amount_paid_pence < total`, only deposit so far | `deposit_paid` |
| `0 < amount_paid_pence < total`, with a balance payment | `partially_paid` |
| `amount_paid_pence = 0` | `unpaid` |
| every succeeded payment refunded | `refunded` |

**Precedence when refunds and a paid deposit coexist:** `refunded` applies only when at least one ledger row is `refunded` **and** the recomputed `amount_paid_pence` is 0. If the balance payment was refunded but the deposit is still paid, the recompute lands back on `deposit_paid` (the deposit was never refunded; the deposit flow owns its own refund, §5.3). The rows above are evaluated on the recomputed sums, so this falls out naturally — state it in the `recomputeBookingPaymentSummary` tests.

`unpaid` / `deposit_paid` / `partially_paid` are **normal, acceptable terminal states** (Section 3).

### 5.6 Summary helper
`src/lib/booking/payment-summary.ts`:
```ts
export async function recomputeBookingPaymentSummary(
  admin: SupabaseClient, bookingId: string,
): Promise<void> {
  // 1. Load the booking + resolve its total via resolveBookingTotalPence (§5.7).
  // 2. SUM amount_pence / tip_amount_pence over booking_payments WHERE status='succeeded'.
  //    (Include the paid deposit in amount_paid — it counts toward the balance.)
  // 3. Derive payment_state per the table above.
  // 4. UPDATE bookings SET amount_paid_pence, tip_amount_pence, payment_state, updated_at.
}
```
App-layer (not a DB trigger) to match class-commerce style and keep it legible. Called by the webhook, the cash/external handler, and the refund handler.

### 5.7 Resolving the total & balance — **IMPORTANT** (`booking_total_price_pence` is unreliable for appointments)
**Code-review finding:** `booking_total_price_pence` is **only written for event tickets and CSV imports**. Appointments created via the public widget, the mobile app, or staff booking leave it **NULL** (writers: `src/app/api/booking/create/route.ts`, `src/app/api/venue/bookings/route.ts`, `src/lib/import/run-execute.ts`). **The balance must not depend on that column alone.**

Add a canonical resolver in `src/lib/booking/payment-summary.ts`:
```ts
// Returns the appointment's full price in pence, or null when it cannot be determined.
export function resolveBookingTotalPence(b: {
  booking_total_price_pence?: number | null;
  service_variant_price_pence?: number | null;   // already loaded by the detail bundle
  addons_total_price_pence?: number | null;
}): number | null {
  if (typeof b.booking_total_price_pence === 'number' && b.booking_total_price_pence > 0)
    return b.booking_total_price_pence;
  const variant = b.service_variant_price_pence ?? 0;
  const addons = b.addons_total_price_pence ?? 0;
  const computed = variant + addons;
  return computed > 0 ? computed : null;   // null = unknown (free or un-priced)
}
```
- `service_variant_price_pence` is already loaded by `src/lib/booking/load-booking-detail-bundle.ts` (`StaffBookingDetailBundle`). Add-on totals come from the booking. For **group appointments**, sum the per-appointment subtotals (the existing group logic in `booking-confirmation-pricing.ts` / the detail bundle).
- `balanceDuePence = total === null ? null : Math.max(0, total - amount_paid_pence)`.

**Staff-confirmable amount (removes the hard dependency).** Because the total may be unknown, the amount is always **staff-confirmable**, never rigidly derived:
- **Known balance:** the sheet pre-fills it; the charge route clamps `amount_pence` (default = balance) to `[1, balanceDue]`.
- **Unknown balance (`null`):** the sheet **requires** a staff-entered amount; the charge route accepts `[1, MAX_IN_PERSON_PENCE]` (a constant, e.g. `100_000` = £1,000).
This also matches reality — in person, staff may charge an adjusted amount. The webhook recomputes `payment_state` from the ledger regardless of what the client showed.

**Recommended parallel improvement (non-blocking):** populate `booking_total_price_pence` at appointment-creation time in the three create routes above, and backfill existing appointments from variant + add-ons, so balances and revenue reporting become reliable. v1 does **not** depend on this thanks to the staff-confirmable amount.

---

## 6. Backend implementation (resneo)

All new routes follow the established mobile pattern (reference: `src/app/api/venue/staff/me/route.ts` and the deposit route `src/app/api/venue/bookings/[id]/deposit/route.ts`):
`createVenueRouteClient(request)` → `getVenueStaff(supabase)` → `staff` `{ id, venue_id, email, role: 'admin'|'staff', db }` (where `db` is the service-role client). Booking access + linked-venue routing reuse `loadStaffAccessibleBooking(staff, id)` + `linkedGrantAllowsMutation(...)` from `src/lib/booking/staff-booking-access.ts`, which resolve `ctx.ownerVenueId` so money routes to the correct connected account automatically.

### 6.1 Terminal Location provisioning (shared helper)
Tap to Pay's `connectReader` needs a `locationId` on the connected account. Provision lazily.

`src/lib/stripe/terminal-location.ts`:
```ts
export async function ensureTerminalLocation(
  admin: SupabaseClient, venueId: string, connectedAccountId: string,
): Promise<string> {
  // 1. SELECT stripe_terminal_location_id FROM venues WHERE id=venueId. If set, return it.
  // 2. Else load venue name/address; create a Location on the CONNECTED account:
  //    stripe.terminal.locations.create(
  //      { display_name, address: { line1, city, postal_code, country: 'GB' } },
  //      { stripeAccount: connectedAccountId },
  //    )
  // 3. Persist venues.stripe_terminal_location_id; return it.
}
```

### 6.2 `POST /api/payments/connection-token`
File: `src/app/api/payments/connection-token/route.ts`
```ts
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';

const schema = z.object({ owner_venue_id: z.string().uuid().optional() });

export async function POST(request: NextRequest) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  const ownerVenueId = parsed.success ? parsed.data.owner_venue_id : undefined;

  // Resolve the active venue. Own venue = staff.venue_id. For a linked (chair-rental)
  // venue, validate the grant with the EXISTING helper (verified to exist) — it requires
  // full-details + mutation rights, which is appropriate for taking a payment.
  let venueId = staff.venue_id;
  if (ownerVenueId && ownerVenueId !== staff.venue_id) {
    const scope = await resolveLinkedStaffCatalogScope(staff.db, staff.venue_id, ownerVenueId);
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });
    venueId = scope.venueId;
  }

  const { data: venue } = await staff.db
    .from('venues')
    .select('name, address, in_person_payments_enabled, stripe_connected_account_id, stripe_terminal_location_id')
    .eq('id', venueId).single();

  if (!venue?.in_person_payments_enabled)
    return NextResponse.json({ error: 'In-person payments are not enabled for this venue.' }, { status: 403 });
  if (!venue.stripe_connected_account_id)
    return NextResponse.json({ error: "This venue isn't set up for in-person payments yet." }, { status: 400 });

  try {
    const locationId = await ensureTerminalLocation(staff.db, venueId, venue.stripe_connected_account_id);
    const token = await stripe.terminal.connectionTokens.create(
      {}, { stripeAccount: venue.stripe_connected_account_id },
    );
    return NextResponse.json({ secret: token.secret, location_id: locationId });
  } catch {
    // Connected account lacks the card-present capability, etc.
    return NextResponse.json({ error: "This venue isn't enabled for in-person card payments yet." }, { status: 400 });
  }
}
```
> `resolveLinkedStaffCatalogScope(admin, staffVenueId, ownerVenueId)` returns `{ ok: true, venueId } | { ok: false, status, error }` (validated in code review). Catching the Stripe error and returning a clear 400 covers the #1 runtime failure mode (capability not enabled).

### 6.3 `POST /api/venue/bookings/[id]/charge`
File: `src/app/api/venue/bookings/[id]/charge/route.ts` (copy the deposit route's structure).
```ts
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';
import { requireAdmin } from '@/lib/venue-auth';

const MAX_IN_PERSON_PENCE = 100_000; // £1,000 cap when the price is unknown

const schema = z.object({
  method: z.enum(['card_present', 'cash', 'external']).optional(),
  action: z.literal('refund').optional(),       // admin-only
  amount_pence: z.number().int().min(1).max(MAX_IN_PERSON_PENCE).optional(), // charges only; refunds are always full (v1)
  attempt_id: z.string().uuid().optional(),     // REQUIRED for card_present: client-generated per payment attempt (idempotency)
  payment_id: z.string().uuid().optional(),     // for refund: which ledger row
  note: z.string().max(500).optional(),
});
```
Handler steps:
1. Auth + `loadStaffAccessibleBooking(staff, id)` + `linkedGrantAllowsMutation(loaded.ctx.linkedGrant, loaded.ctx.isOwnVenue)` (identical to the deposit route). For the **refund** action additionally require `requireAdmin(staff)` → 403 otherwise.
2. `scopeVenueId = loaded.ctx.ownerVenueId`; `booking = loaded.ctx.booking` (loaded with `select('*')`, so it carries `booking_model`, `service_variant_id`, deposit + payment columns).
3. **Appointment guard (v1):** allow only `booking.booking_model ∈ {'practitioner_appointment','unified_scheduling'}` (legacy fallback when `booking_model` is null: `practitioner_id && appointment_service_id`). Otherwise → `400 { error: 'In-person payment is only available for appointments.' }`.
4. **Amount (see §5.7):** resolve `total = resolveBookingTotalPence(...)` (use the booking-detail bundle so `service_variant_price_pence`/`addons_total_price_pence` are available) and `balanceDue = total === null ? null : max(0, total − amount_paid_pence)`. For card/cash/external: if `balanceDue` known → default `amount_pence` to `balanceDue` and clamp to `[1, balanceDue]`; if `balanceDue` unknown → `amount_pence` is **required**, accepted in `[1, MAX_IN_PERSON_PENCE]`. Reject `amount_pence <= 0`. If `balanceDue === 0` (fully paid) and not a refund → `400 'Nothing left to pay.'`.
5. Branch by intent:

**(a) `action: 'refund'`** (gate with `requireAdmin(staff)`). **v1 refunds are always the FULL amount of the chosen ledger row** — never pass a partial `amount` (the row status is binary, so a partial refund would corrupt the recompute; partial refunds are a §14 item needing `refunded_amount_pence`). Two sub-branches by the row's method:
```ts
const { data: pay } = await staff.db.from('booking_payments')
  .select('*').eq('id', parsed.data.payment_id).eq('booking_id', id).single();
if (!pay || pay.status !== 'succeeded')
  return NextResponse.json({ error: 'This payment cannot be refunded.' }, { status: 409 });

if (pay.method === 'card_present') {
  // Stripe refund; ledger flip + recompute happen in the charge.refunded webhook (§6.4).
  // Mirror the deposit route: treat 'charge_already_refunded' as success so our
  // state converges with Stripe's.
  await stripe.refunds.create(
    { payment_intent: pay.stripe_payment_intent_id },   // full refund — no amount
    { stripeAccount: pay.stripe_connected_account_id, idempotencyKey: `refund:${pay.stripe_payment_intent_id}` },
  );
} else {
  // cash/external: no Stripe leg exists — write the reversal directly. This is
  // also the fix-up path for a mis-recorded cash payment (fat-fingered amount).
  await staff.db.from('booking_payments')
    .update({ status: 'refunded', note: parsed.data.note ?? pay.note, updated_at: new Date().toISOString() })
    .eq('id', pay.id);
  await recomputeBookingPaymentSummary(staff.db, id);
}
return NextResponse.json({ success: true });
```
> The deposit route's refund precedent is Stripe-only (it 400s without a PI) — but unlike deposits, cash rows here live in the ledger, so a no-Stripe reversal is trivial and fully audited (`status='refunded'`, admin `staff_id` in place, optional note).

**(b) `method: 'cash' | 'external'`** (no Stripe):
```ts
await staff.db.from('booking_payments').insert({
  booking_id: id, venue_id: scopeVenueId, method, status: 'succeeded',
  amount_pence: chargePence, staff_id: staff.id, note: parsed.data.note ?? null,
});
await recomputeBookingPaymentSummary(staff.db, id);
return NextResponse.json({ success: true });
```
This finally gives cash an audit trail (today's deposit `record_cash` writes none).

**(c) `method: 'card_present'`** (Tap to Pay):
```ts
const { data: venue } = await staff.db.from('venues')
  .select('stripe_connected_account_id').eq('id', scopeVenueId).single();
if (!venue?.stripe_connected_account_id)
  return NextResponse.json({ error: "This venue isn't set up for in-person payments yet." }, { status: 400 });

const pi = await stripe.paymentIntents.create(
  {
    amount: chargePence,                       // tip = 0 in v1
    currency: 'gbp',
    payment_method_types: ['card_present'],    // NOT automatic_payment_methods
    capture_method: 'automatic',               // see §13 capture-flow verify item
    metadata: {
      booking_id: id, venue_id: scopeVenueId,
      reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.APPOINTMENT_BALANCE, staff_id: staff.id,
    },
    // NO application_fee_amount — preserves 0% platform cut.
  },
  { stripeAccount: venue.stripe_connected_account_id,
    // Key on the client-generated attempt_id, NOT the amount. An amount-based key
    // (`balance:${id}:${pence}`) collides on legitimate equal-amount split payments
    // (two guests paying £20 each on one booking): Stripe would return the FIRST,
    // already-succeeded PI and the ledger insert would hit the unique index → 500.
    // attempt_id is minted once per user-initiated attempt (§7.7), so an accidental
    // double-POST of the same attempt reuses the key (double-tap safe) while a
    // genuinely new payment gets a fresh key.
    idempotencyKey: `balance:${id}:${parsed.data.attempt_id}` },
);
// (Reject card_present requests without attempt_id → 400.)

const { error: insertErr } = await staff.db.from('booking_payments').insert({
  booking_id: id, venue_id: scopeVenueId,
  stripe_connected_account_id: venue.stripe_connected_account_id,
  stripe_payment_intent_id: pi.id, method: 'card_present', status: 'pending',
  amount_pence: chargePence, staff_id: staff.id,
});
// An idempotent replay of the same attempt returns the same PI, whose row already
// exists — treat the unique-index violation (23505) as success, not a 500.
// (Note: upsert onConflict can't be used here — booking_payments_pi_uq is a
// PARTIAL unique index, which PostgREST's conflict target cannot infer.)
if (insertErr && insertErr.code !== '23505') throw insertErr;

return NextResponse.json({ payment_intent_id: pi.id, client_secret: pi.client_secret, amount_pence: chargePence });
```
> The balance PI id lives only in `booking_payments`, **not** in `bookings.stripe_payment_intent_id` (that column holds the deposit PI). So even absent the webhook early-return, the existing deposit-confirmation path — which matches `bookings.stripe_payment_intent_id` — would never act on a balance PI. Double-safe.

### 6.4 Webhook extension
File: `src/app/api/webhooks/stripe/route.ts` + new helper `src/lib/booking/confirm-balance-payment.ts`.

Verified structure: the idempotency claim (`claimStripeWebhookEvent`) runs **before** any event-type handling and is released on error in the `catch`. The `payment_intent.succeeded` handler already early-returns for class-commerce purposes (`RESERVE_NI_PI_PURPOSE.CLASS_*`). Add the balance branch **alongside those**, before the deposit fallthrough (deposits carry `booking_id` with **no** purpose):
```ts
const meta = pi.metadata ?? {};
if (meta.reserve_ni_purpose === RESERVE_NI_PI_PURPOSE.APPOINTMENT_BALANCE) {
  const connectedAccountId = (event as Stripe.Event & { account?: string }).account ?? null;
  await confirmBalancePaymentFromPaymentIntent(supabase, {
    paymentIntentId: pi.id,
    bookingId: meta.booking_id,
    venueId: meta.venue_id,
    amountReceivedPence: pi.amount_received,
    connectedAccountId,
  });
  return NextResponse.json({ received: true });   // early return is safe (idempotency already claimed)
}
```
`confirmBalancePaymentFromPaymentIntent` (idempotent — guarded by the existing `webhook_events` claim **and** the PI-unique index):
1. `UPDATE booking_payments SET status='succeeded', updated_at=now() WHERE stripe_payment_intent_id=pi.id AND status<>'succeeded'`. If no row exists (event beat the route's insert), insert one from metadata.
2. `recomputeBookingPaymentSummary(admin, bookingId)`.
3. Optionally insert a booking `events` row (`event_type='balance_payment_taken'`) — the detail screen already renders `events`.
4. Send the receipt via `after(...)` — the route already imports `after` from `next/server` and uses it for deposit-paid comms (§6.5).

**Refund webhook:** extend the existing `charge.refunded` / `charge.refund.updated` branch to also flip the matching `booking_payments` row to `refunded` and `recomputeBookingPaymentSummary` (→ `payment_state='refunded'` per the §5.5 precedence rule).

**Abandoned-PI hygiene:** also handle `payment_intent.canceled` for `reserve_ni_purpose = APPOINTMENT_BALANCE`: flip the matching `pending` ledger row to `failed`. Otherwise rows for abandoned attempts (staff dismisses the sheet, §3.2) sit at `pending` forever — harmless to the recompute (which sums only `succeeded`) but noise in any future payments-history UI. No recompute needed since nothing succeeded.

### 6.5 Receipt
Add `'payment_receipt'` to the `MessageType` union in `src/lib/communications/types.ts`, and add `sendPaymentReceiptEmail({ bookingId, venueId, amountPaidPence, paidAt })` in `src/lib/communications/send-templated.ts`, modelled on the **existing `sendCardHoldChargedReceipt`** (the other webhook-triggered receipt: id-based params, `enrichBookingEmailForComms`, a dedicated render template, `deliverEmailMessage`). Reuse `venueRowToEmailData` (`src/lib/emails/venue-email-data.ts`). Email-first. This is the customer's record (direct-charge card-present has no Stripe-hosted email by default).

Three details locked in by the implementation (do not regress):
- **Comm-log type is `payment_receipt_email`** (house `*_email` convention in `CommunicationLogMessageType`, `src/lib/communications/policy-resolver.ts`), and `communication_logs.message_type` carries a **DB CHECK constraint** that must be extended as a strict superset in the same migration as the ledger — without it every receipt insert fails silently at Postgres.
- **Log mode is `upsert`, NOT `dedupe`**: a booking can carry several balance payments (equal-amount split payments, §6.3c) and each must send its own receipt; dedupe would swallow every receipt after the first. Webhook idempotency (the `webhook_events` claim) already prevents duplicate sends for the same payment. Known cosmetic trade-off: upsert reuses one comm-log row, so the staff timeline shows the latest receipt only.
- Render template: `src/lib/emails/templates/payment-receipt.ts` (no em-dashes in customer copy).

### 6.6 Booking GET + venue bootstrap extensions
- The booking detail GET (`/api/venue/bookings/[id]`) is assembled by `src/lib/booking/load-booking-detail-bundle.ts` (`StaffBookingDetailBundle`, which already loads `service_variant_price_pence`). Extend it to also return `amount_paid_pence`, `payment_state`, the **resolved** `booking_total_price_pence` (via `resolveBookingTotalPence`, §5.7) and a computed `balance_due_pence` (may be `null` when the price is unknown). The detail screen prefetches `/api/venue/bookings/[id]/summary` too — add the same fields there if `TakePaymentSheet`/the gate reads from it.
- Extend the venue bootstrap endpoint `GET /api/venue` (feeds `VenueProvider`) to return:
  - `in_person_payments_enabled` (from the column),
  - `card_present_ready` (derived). For v1, derive as `in_person_payments_enabled && !!stripe_connected_account_id` and let the connection-token 400 be the authoritative gate; a later improvement syncs the real Stripe capability (§14).

### 6.7 Feature flag
`venues.in_person_payments_enabled` is the master switch (default false). Set it per pilot venue (superuser dashboard toggle or SQL). When false: the bootstrap returns `in_person_payments_enabled=false`, the app renders nothing, and all three endpoints refuse with 403/403/403. Frictionless off.

**The kill switch is total: it gates refunds too.** Disabling the flag 403s the whole charge endpoint including `action: 'refund'` — no half-alive endpoint state. This is safe because the escape hatch fully reconciles: a refund issued from the **Stripe dashboard** flows back through the `charge.refunded` webhook, which is ledger-driven and NOT flag-gated, so the `booking_payments` row flips to `refunded` and the booking summary recomputes correctly even while the flag is off. If pilot feedback shows venues toggling the flag off while holding refundable payments, loosening the gate to admit refund-only is a deliberate two-line change, not a workaround.

---

## 7. Mobile implementation (resneo-app)

### 7.1 Dependency
```bash
npx expo install @stripe/stripe-terminal-react-native
```
- The **Terminal SDK** is the correct package for Tap to Pay + connection tokens + Connect. `@stripe/stripe-react-native` does **not** do Tap to Pay.
- It is a **public-preview beta** — **pin the exact version** in `package.json`. Per `resneo-app/AGENTS.md`, re-read that exact version's reference before coding; the discover/connect API moved across betas (`connectReader({ discoveryMethod: 'tapToPay', reader, locationId })` is current; older betas used `connectLocalMobileReader`).

### 7.2 Native config — `app.json`
Append to the existing `plugins` array:
```json
[
  "@stripe/stripe-terminal-react-native",
  {
    "tapToPayCheck": true,
    "appDelegate": true,
    "locationWhenInUsePermission": "Location is required to accept in-person card payments."
  }
]
```
iOS (`ios` block):
- Add the **entitlement** (the plugin does not): `"entitlements": { "com.apple.developer.proximity-reader.payment.acceptance": true }`. Verify it lands in the built `.entitlements` (an EAS prebuild can overwrite — use a tiny custom config plugin if needed).
- Bundle stays `com.resneo.app`. Min iOS 16.4+ (SDK 56's floor already exceeds this). Real device only (iPhone XS+).

Android: the plugin injects `NFC`, location, and Bluetooth permissions + the Tap-to-Pay guard. Requires NFC + Android 11+, Google-certified, non-rooted. `package` stays `com.resneo.app`.

### 7.3 Build — `eas.json`
- Cannot run in Expo Go. `expo-dev-client` is already installed — update the `development`/`preview`/`production` profiles to build the new native module.
- The Apple **development** entitlement must be on the EAS credentials' Apple account before a dev build can tap a live card; the **publishing** entitlement before TestFlight/App Store.

### 7.4 Env
Add `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (the **platform** publishable key) to `.env.example`/`.env.local` and `lib/env.ts` — the Terminal SDK needs it at init.

### 7.5 `providers/TerminalProvider.tsx`
Mount it in `providers/AppProviders.tsx`, **just inside `ToastProvider`** (verified nesting: SafeArea → QueryClient → Auth → Venue → LinkedVenue → VenueLiveSync → PushNotifications → Toast → …). That position guarantees access to the access token + venue + `ownerVenueId`. Render children untouched when the venue isn't enabled (so non-enabled venues never load Terminal):
```tsx
export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const { venue } = useVenueContext();
  const accessToken = useAccessToken();
  const { ownerVenueId } = useLinkedVenueContext();

  // Frictionless OFF: if the venue can't take in-person payments, render children untouched.
  if (!venue?.in_person_payments_enabled) return <>{children}</>;

  const tokenProvider = useCallback(async (): Promise<string> => {
    const { secret } = await apiFetch<{ secret: string; location_id: string }>(
      '/api/payments/connection-token',
      { accessToken, method: 'POST', body: JSON.stringify(ownerVenueId ? { owner_venue_id: ownerVenueId } : {}) },
    );
    return secret;
  }, [accessToken, ownerVenueId]);

  return (
    <StripeTerminalProvider logLevel="verbose" tokenProvider={tokenProvider}>
      {children}
    </StripeTerminalProvider>
  );
}
```
On `ownerVenueId` change (linked-venue switch), disconnect any connected reader and re-discover — the connection token then mints against the new account.

### 7.6 `lib/payments/terminal.ts` + `useTapToPayReader()`
**Lazy** reader lifecycle (don't initialise on launch — it's heavy and needs permissions):
```ts
// 1. initialize() once.
// 2. Request location (+ NFC/BT) permissions.
// 3. discoverReaders({ discoveryMethod: 'tapToPay', simulated: __DEV__ }).
// 4. onUpdateDiscoveredReaders → connectReader({ discoveryMethod: 'tapToPay', reader, locationId }).
//    locationId comes from the connection-token response (cache it).
// Cache the connected reader; reconnect only when disconnected or venue changes.
// Expose status: 'idle' | 'initializing' | 'discovering' | 'connecting' | 'ready' | 'error'.
```

### 7.7 Mutation hooks — `lib/queries/useTakePayment.ts`
Model on `useBookingDeposit` (`lib/queries/useBookingMutations.ts`); use `invalidateBookingCaches`. `useAccessToken` from `lib/queries/useAccessToken`, `apiFetch` from `lib/api/client`.
```ts
// useTakePayment(bookingId): card flow
//   mutationFn({ amountPence? }):
//     0. const attempt_id = Crypto.randomUUID();   // ONE per user-initiated attempt —
//        minted when the staff member taps the pay button, NOT per network call, so a
//        double-fired mutation reuses it (idempotent) while "take another payment"
//        later mints a fresh one (§6.3c).
//     1. const { payment_intent_id, client_secret } =
//          await apiFetch('/api/venue/bookings/${bookingId}/charge',
//            { accessToken, method:'POST', body: JSON.stringify({ method:'card_present', amount_pence, attempt_id }) });
//     2. await retrievePaymentIntent(client_secret);
//     3. await collectPaymentMethod({ paymentIntent });   // staff prompts the tap here
//     4. await confirmPaymentIntent({ paymentIntent });
//   onSuccess: invalidateBookingCaches (webhook writes paid state; refetch shows it)
//   errors: cancel → cancelCollectPaymentMethod; decline/SCA → surface + allow retry/fallback

// useRecordExternalPayment(bookingId): POST /charge { method:'cash'|'external', amount_pence, note }
// useRefundPayment(bookingId):        POST /charge { action:'refund', payment_id }   // always full (v1, §6.3a)
```
> The mobile success handler never marks paid from the client result. It invalidates caches; the booking GET (reflecting the webhook's write) is the truth.

### 7.8 UI — types, button gate, sheet
**Type** (`types/booking-detail.ts`): add `booking_total_price_pence?: number | null`, `amount_paid_pence?: number | null`, `balance_due_pence?: number | null`, `payment_state?: 'unpaid'|'deposit_paid'|'partially_paid'|'paid'|'refunded' | null`.

**Button gate** in `components/bookings/BookingDetailContent.tsx` (inside the existing "Payments & confirmation" `CollapsibleCard`; `useVenueContext()` is already used in this file). `isAppointmentVenue` is the existing **venue-level** prop (derived via `isAppointmentExperience()`); the backend charge route is the authoritative **per-booking** appointment guard (§6.3).
```tsx
// balance_due_pence comes from the API; null = price unknown → staff enter the amount.
const balanceDue = booking.balance_due_pence ?? null;
const isPaid = booking.payment_state === 'paid' || booking.payment_state === 'refunded';
const canTakePayment =
  venue?.in_person_payments_enabled === true &&
  isAppointmentVenue &&
  booking.status !== 'Cancelled' &&
  !isPaid &&
  (balanceDue === null || balanceDue > 0);

{canTakePayment && (
  <Button label="Take payment" onPress={() => setTakePaymentTarget({ id: booking.id, guestName, balanceDue })} />
)}
{booking.payment_state === 'paid' && <Text tone="muted">Paid · {formatPositivePence(booking.amount_paid_pence)}</Text>}
```
Render nothing else when `!canTakePayment` — the surface simply doesn't exist (frictionless off / optional).

**`components/bookings/TakePaymentSheet.tsx`** — model on `components/bookings/DepositSheet.tsx` (uses `Sheet`, `Button`, `Text`, `spacing`, `hapticSuccess/Warning`, `ApiError`; state `takePaymentTarget` mirrors `depositTarget`). Contents:
- Header: outstanding balance + guest name. **When `balanceDue` is `null`** (unknown price), show a **required amount-entry field** instead of a fixed balance.
- **Primary:** **Tap to Pay** (shown only if `card_present_ready`).
- **Secondary:** **Record cash / other** → `useRecordExternalPayment`.
- **Admin:** **Refund** (two-step confirm, like DepositSheet's refund).
- **Close** — dismiss with no side effects at any time.

Capture state machine (card): `idle → connecting (discover/connect) → ready ("Hold the client's card near the top of your phone") → collecting → confirming → success | error`.
- **success:** green check, "£X collected", "Receipt emailed to {guest}", Close.
- **error:** inline message + **Retry**; for SCA/high-value decline or ineligible device, show **Send payment link** fallback (reuse the deposit route's `send_payment_link` machinery / `createOrGetPaymentShortLink`).

Strict TS, no `any`, comments for a beginner (house style per `.cursorrules`).

---

## 7A. Physical Bluetooth card reader (Stripe Terminal reader) — additive to §7

This section adds a **third in-person method alongside Tap to Pay**: a physical Stripe Terminal card reader that pairs to the staff device over **Bluetooth** (Stripe's `bluetoothScan` discovery). It is purely additive. Everything in §5, §6, §9 (backend, data model, security) and the whole webhook/ledger/receipt pipeline is **reused unchanged**; the new work is almost entirely mobile (a second discovery/connection path plus reader-management UX) with **one optional, non-breaking backend touch**.

The same frictionless principle (§3) applies: a physical reader is just another way to run the same `card_present` collection. Nothing about it is required, and a venue that never pairs a reader never sees any of it.

### 7A.1 What is reused vs. what is new

| Layer | Tap to Pay (§1-§7) | Physical Bluetooth reader (this section) |
|---|---|---|
| Connection token (`POST /api/payments/connection-token`) | reused | **reused, byte-for-byte** |
| Terminal Location (`ensureTerminalLocation`, §6.1) | reused | **reused** (Bluetooth readers also attach to a Location at connect time) |
| Charge route (`POST …/charge`), PaymentIntent (`card_present`), ledger, webhook, receipt | reused | **reused, byte-for-byte** (same `payment_method_types: ['card_present']`) |
| Venue flag / capability (`in_person_payments_enabled`, `card_present_ready`) | reused | **reused** (same `card_present` capability, same derivation §6.6) |
| Data model (`booking_payments`, summary cols, enums) | reused | **reused** (`method` stays `'card_present'`; reader kind is optional `metadata`, §7A.6) |
| SDK discovery method | `discoveryMethod: 'tapToPay'` | **`discoveryMethod: 'bluetoothScan'`** |
| Reader lifecycle | phone NFC, no pairing | **pair / reconnect / battery / firmware update UX (new)** |
| iOS entitlement | proximity-reader entitlement **required** | **none required** (Bluetooth readers need no Apple entitlement) |
| Device eligibility | iPhone XS+/iOS 16.4+, NFC Android 11+ certified | **any Bluetooth-capable iOS/Android device** (much wider) |

**Consequence:** the entire backend delivered in §12 Phase 1 already supports physical readers with zero change (or one optional metadata field). The reader work is a self-contained mobile add-on that can ship in the same release or a fast follow.

### 7A.2 Reader hardware (UK / GBP)

- **Recommended reader for Resneo's market: BBPOS WisePad 3** — Stripe's Bluetooth reader for the **UK/EU**, supporting **chip + contactless + on-reader PIN**. (The Stripe Reader M2 is a US/CA/AU/etc. device and is **not** the right model for GBP venues.)
- **This directly mitigates the §13 UK SCA risk.** High-value or PIN-required cards that would make Tap to Pay fall back to a payment link can simply be **chip-inserted with the PIN entered on the reader keypad**. So the physical reader is not only an alternative, it closes the one Tap-to-Pay gap in §13.
- **Wider device support:** because collection happens on the reader (not the phone NFC), there is **no NFC requirement and no iPhone XS+ / Android 11+ / certified-device constraint**. Older and cheaper staff devices work.

### 7A.3 Capability & gating (delta only)

No new venue column and no new backend gate. The physical reader is enabled by the **same** `venues.in_person_payments_enabled` flag and needs the **same** `card_present` capability + Terminal Location already required for Tap to Pay. What changes is only how the **client decides which options to show**:

- `supportsTapToPay` — a **device** check from the SDK (`Terminal.supportsReadersOfType({ deviceType: 'tapToPay' })` or the SDK's tap-to-pay support helper). True on eligible NFC phones only.
- `readerConnected` — whether a Bluetooth reader is currently paired/connected (client state).

`TakePaymentSheet` (§7A.6) shows **Tap to Pay** only when `supportsTapToPay`, and shows **Use card reader** whenever `in_person_payments_enabled` (offering pairing if none is connected yet). A venue with only physical readers on non-NFC devices therefore gets a fully working "Take payment" surface even though Tap to Pay is unavailable.

> Optional future nicety (not v1): a per-venue `preferred_in_person_method` to pin one method as default. v1 keeps it purely client-driven + "remember last used" (§7A.6) to stay frictionless.

### 7A.4 Native config deltas — `app.json` / permissions

The `@stripe/stripe-terminal-react-native` plugin already covers Bluetooth on Android (it injects the Bluetooth + location permissions and, on Android 12+, `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`). Extend the **plugin config** (§7.2) so iOS advertises Bluetooth and, optionally, background reconnection:

```json
[
  "@stripe/stripe-terminal-react-native",
  {
    "tapToPayCheck": true,
    "appDelegate": true,
    "locationWhenInUsePermission": "Location is required to accept in-person card payments.",
    "bluetoothAlwaysUsagePermission": "Bluetooth is used to connect to your card reader.",
    "bluetoothPeripheralUsagePermission": "Bluetooth is used to connect to your card reader.",
    "bluetoothBackgroundMode": true
  }
]
```
- iOS adds `NSBluetoothAlwaysUsageDescription` (and, for older OS targets, `NSBluetoothPeripheralUsageDescription`). **Verify the exact plugin prop names against the pinned SDK version's config-plugin schema** — like the discover/connect API (§7.1), these have drifted across betas. Keep all usage strings **free of em-dashes** (they become user-facing per project copy rules).
- **iOS entitlement:** the Bluetooth path needs **no** `com.apple.developer.proximity-reader.payment.acceptance` entitlement. A build that ships **only** the reader path can skip the Apple entitlement entirely, removing §12's "longest pole". A build that ships **both** methods keeps the entitlement (for Tap to Pay) and simply adds the Bluetooth usage strings above.
- Bundle/`package` unchanged (`com.resneo.app`).

### 7A.5 Discovery & connection — `lib/payments/bluetoothReader.ts` + `useBluetoothReader()`

Sibling to `useTapToPayReader` (§7.6), same **lazy** philosophy (never initialise on launch). Reuses the same `initialize()` and the same `locationId` from the connection-token response.

```ts
// useBluetoothReader():
// 1. initialize() once (shared with the tapToPay path).
// 2. Request Bluetooth (+ location) permissions.
// 3. discoverReaders({ discoveryMethod: 'bluetoothScan', simulated: __DEV__ }).
//    onUpdateDiscoveredReaders → a LIST (a busy salon may see several readers).
// 4. connectReader({ discoveryMethod: 'bluetoothScan', reader, locationId }).
//    (Beta churn, per §7.1: older betas used connectBluetoothReader({ reader, locationId }).
//     Re-read the pinned version's reference before coding.)
// 5. Persist the connected reader's serial (AsyncStorage). On next open, auto-scan and
//    reconnect to that serial without a picker.
// Status: 'idle' | 'scanning' | 'found' | 'connecting' | 'updating' | 'ready'
//         | 'disconnected' | 'error'.
```

**Firmware updates are a first-class state, not an afterthought.** Bluetooth readers require mandatory software updates on first pairing and periodically thereafter, and these **block collection** for anywhere from tens of seconds to several minutes:
- Handle `onDidStartInstallingUpdate` / `onDidReportReaderSoftwareUpdateProgress` / `onDidFinishInstallingUpdate` (and `onDidReportAvailableUpdate` for optional updates).
- While `status === 'updating'`, the sheet shows a determinate progress UI and **disables** the Tap/Insert step. Copy (em-dash free): `"Updating your reader. Keep it nearby and switched on. This can take a few minutes."`

Also handle: `onDidDisconnect` (unexpected drop → attempt one silent reconnect to the remembered serial, then surface `"Reader disconnected. Trying to reconnect."`), battery level via the reader's `batteryLevel` / `onDidReportBatteryLevel` (warn under ~15%: `"Reader battery low. Charge it soon."`), and low-signal/no-reader-found timeouts.

**Provider wiring:** extend `TerminalProvider` (§7.5) so that when the venue is enabled it registers the Bluetooth lifecycle listeners too. On `ownerVenueId` change (linked-venue switch), disconnect the reader and clear the remembered serial for that scope, exactly as the tapToPay path re-mints its token.

### 7A.6 Taking payment with a reader — `TakePaymentSheet` delta

The collection flow is **identical from `useTakePayment`'s point of view** — same `POST …/charge` returning a `client_secret`, same `retrievePaymentIntent → collectPaymentMethod → confirmPaymentIntent`. The **only** difference is which reader is connected when `collectPaymentMethod` runs. So `useTakePayment` (§7.7) is reused as-is; no new mutation hook is required for the happy path.

Method selection inside the existing sheet:
```tsx
// Primary options, shown by availability (§7A.3):
//   [Tap to Pay on this phone]  — only if supportsTapToPay
//   [Use card reader]           — always (if in_person_payments_enabled); if no reader
//                                 is connected, tapping it opens the pairing flow first
// Secondary: [Record cash / other]   Admin: [Refund]     Always: [Close]
// Persist the last-used method (AsyncStorage) so staff aren't re-asked each time.
```
- Card-reader capture state machine mirrors §7.8 with two extra states surfaced from `useBluetoothReader`: `connecting` (discover/connect) and `updating` (firmware). Prompt copy for the tap step becomes reader-aware: `"Hold the card to the reader, or insert the chip."`
- **On-reader PIN:** when the reader requests a PIN for a high-value/SCA card, the customer enters it on the reader keypad and `confirmPaymentIntent` resolves normally. The **Send payment link** fallback (§7.8 / §8-D) stays as the last resort for a declined or unreachable-reader case, but is needed far less often than on Tap to Pay.
- **Reader management entry point:** add a **"Card reader"** row in the manage/settings area (sibling to the existing `components/manage/SessionSettingsSheet.tsx`) that opens `ReaderSettingsSheet` (§7A.7) to pair, view battery/firmware, and forget a reader outside of a live payment.

### 7A.7 Reader management UX — `components/bookings/ReaderSettingsSheet.tsx`

Model on `DepositSheet.tsx` (same `Sheet`/`Button`/`Text`/`spacing`/haptics primitives). Responsibilities:
- **Pair:** scan → list discovered readers by name/serial → connect → remember. Shows the `updating` progress UI if a mandatory update runs on first connect.
- **Status:** connected reader name, **battery level**, firmware/update state, and a **Forget reader** action (clears the remembered serial).
- Reachable both from the settings row (§7A.6) and inline from `TakePaymentSheet` when a staff member taps **Use card reader** with nothing paired yet.

Strict TS, no `any`, beginner comments, and **all UI strings free of em-dashes** (project copy rule).

### 7A.8 Backend deltas — minimal and optional

- **No new route. No schema migration. No enum change.** The reader charge is the exact same `card_present` PaymentIntent produced by `POST …/charge` (§6.3), confirmed by the same webhook (§6.4), written to the same `booking_payments` ledger.
- **Optional (recommended for reporting):** let the charge schema accept `reader_type?: 'tap_to_pay' | 'bluetooth'` and write it into `booking_payments.metadata` (and PI `metadata`). This distinguishes the two card-present channels in revenue reporting **without** touching the `booking_payment_method` enum (which stays `'card_present'`). Backwards compatible — absent field defaults to unknown/tap-to-pay.
- `card_present_ready` derivation (§6.6) is unchanged; the connection-token 400 remains the authoritative capability gate for **both** methods.

### 7A.9 End-to-end flow (physical reader)

Open appointment with a balance → **Take payment** → **Use card reader** → (first time: pair; if needed, firmware update with progress) → reader `ready` → **collect** (customer taps contactless or inserts chip + PIN on the reader) → **confirm** → Stripe sends `payment_intent.succeeded` (purpose = `appointment_balance`) → the **same** webhook writes the ledger `succeeded` + recompute → `payment_state='paid'` → app invalidates, refetch shows Paid → guest gets the receipt. (Identical to flow §8-A from the webhook onward.)

### 7A.10 Testing additions (on top of §11)

- **Simulated reader first:** `discoverReaders({ discoveryMethod: 'bluetoothScan', simulated: true })` yields a simulated Bluetooth reader in `__DEV__` — full discover/connect/collect/confirm with **no hardware**, so most of the path is testable before a WisePad 3 arrives.
- **Jest / RTL:** `useBluetoothReader` state machine including the **`updating`** and **`disconnected`/reconnect-by-serial** paths; method-selection gate (Tap to Pay hidden when `!supportsTapToPay`; **Use card reader** shown and opening pairing when no reader connected); "remember last method/serial".
- **Manual (real WisePad 3):** first-pair firmware update; low battery warning; disconnect **mid-collection** then reconnect; **on-reader PIN** on a high-value card completing without a payment link; contactless tap on the reader.
- Reuses the same connected **test-mode** account (card-present capability + Terminal Location) as §11.

### 7A.11 Rollout & risks (delta)

- **Faster pilot path:** because the Bluetooth path needs **no Apple entitlement** (§7A.4), a reader-only pilot can go live **without waiting on Apple's 1-2 week publishing entitlement** — useful if the pilot venue prefers a physical reader.
- **New risks & mitigations:**
  - *Firmware update time* → determinate progress UI, "keep reader powered/nearby" copy, never block silently (§7A.5).
  - *Reader supply / correct model per region* → standardise on **WisePad 3** for UK; document ordering in the pilot runbook.
  - *Multiple readers in one salon* → discovery returns a list; label readers by name/serial in `ReaderSettingsSheet`; remember per device.
  - *Keeping readers charged* → surface battery level + low-battery warning.
  - *Bluetooth pairing/permission friction on iOS* → clear usage strings + a permission-denied recovery state in the sheet.

### 7A.12 Estimate delta

**~+2.5 to +4 eng-days** on top of the §12 total, essentially all mobile (discovery/connect, firmware-update UX, reader-management sheet, method selection, tests). Backend is **~0.25d** for the optional `reader_type` metadata, or **0** if deferred. Calendar-independent of Apple. Slots in as an extension of §12 Phase 4-5, or as a fast follow after the Tap-to-Pay pilot.

### 7A.13 File-by-file (additive to §15)

**resneo-app (mobile) — new**
- `lib/payments/bluetoothReader.ts` + `useBluetoothReader` (discover/connect/update/battery/reconnect).
- `components/bookings/ReaderSettingsSheet.tsx` (pair / status / forget).

**resneo-app (mobile) — modified**
- `providers/TerminalProvider.tsx` — register Bluetooth lifecycle listeners when enabled.
- `components/bookings/TakePaymentSheet.tsx` — method selection (Tap to Pay vs card reader) + reader-aware states.
- `components/bookings/BookingDetailContent.tsx` — unchanged gate; the button now leads to either method.
- `app.json` — Bluetooth plugin props + iOS Bluetooth usage strings (§7A.4).
- manage/settings screen — a "Card reader" row that opens `ReaderSettingsSheet`.
- `types/booking-detail.ts` / reader status types — add reader connection/update state.

**resneo (backend) — modified (optional)**
- `src/app/api/venue/bookings/[id]/charge/route.ts` — accept optional `reader_type` and persist to `booking_payments.metadata` (no enum/schema change).

---

## 8. End-to-end flows

**A. Card Tap to Pay (happy path):** open appointment with deposit paid → **Take payment** → sheet shows balance → **Tap to Pay** → reader connects → client taps → confirm → Stripe sends `payment_intent.succeeded` (purpose=`appointment_balance`) → webhook writes ledger `succeeded` + recompute → `payment_state='paid'` → app invalidates, refetch shows Paid → guest gets receipt.

**B. Cash/external:** **Take payment** → **Record cash** → POST `/charge {method:'cash'}` → ledger row `succeeded` + recompute → Paid. No Stripe.

**C. Refund (admin):** Paid appointment → **Refund** → confirm → `refunds.create` on connected account → `charge.refunded` webhook → ledger row `refunded` + recompute → `payment_state='refunded'`.

**D. SCA/decline:** confirm fails → sheet shows reason + **Retry** and **Send payment link** → staff still get paid out-of-band.

**E. Venue not enabled:** `in_person_payments_enabled=false` → no Terminal init, no button, no calls. Identical to today.

**F. Completed without payment:** staff mark the appointment Completed with a balance outstanding → allowed, no warning; `payment_state` stays `deposit_paid`/`unpaid`.

**G. Unknown price:** appointment with no resolvable total (variant + add-ons both 0/absent) → button still shows; sheet requires a staff-entered amount; charge proceeds against `MAX_IN_PERSON_PENCE` cap. (Genuinely free appointments: staff simply don't tap — frictionless.)

---

## 9. Security & money-safety
- **Auth chain:** every endpoint goes through `getVenueStaff` (Bearer JWT → staff row → venue scope). Refund requires `requireAdmin(staff)`.
- **Tenant isolation:** `loadStaffAccessibleBooking` + `linkedGrantAllowsMutation` (booking-scoped) and `resolveLinkedStaffCatalogScope` (connection-token, no booking) enforce that staff act only on their venue's or a validly-linked venue's data; charges route to that venue's connected account.
- **Idempotency:** card create uses an `idempotencyKey`; the ledger PI-unique index + `webhook_events` claim give double protection against double-tap and webhook replay.
- **0% fee guarantee:** no `application_fee_amount` is ever set. Add a unit test asserting the charge route never passes it.
- **Webhook is source of truth:** client confirm never writes paid state.
- **RLS:** `booking_payments` is service-role only (no policies) — never queried from the client; the app reads payment state through the authenticated booking GET.

---

## 10. Feature flag & rollout
1. **Prereqs (Section 12 Phase 0):** Apple entitlements; enable **card-present capability** + ensure a **Terminal Location** on the pilot venue's connected account.
2. Set `venues.in_person_payments_enabled = true` for the pilot venue only.
3. Verify end-to-end on real devices; then widen venue-by-venue.
4. Kill switch: set the flag false → surface vanishes instantly, no migration.

---

## 11. Testing & verification

**Backend (no mobile build needed):**
- `vitest` on `resolveBookingTotalPence`: column wins when set; else `variant + addons`; else `null`. And `recomputeBookingPaymentSummary` truth table (§5.5), including the resolved-total path.
- `vitest` on the `charge` route: card creates a `card_present` PI on the connected account with the correct amount and **no `application_fee`**; cash/external insert a `succeeded` ledger row + recompute; refund (admin-gated; non-admin → 403; **card row → Stripe full refund; cash/external row → direct ledger reversal, no Stripe call**; non-succeeded row → 409); **appointment guard** (`booking_model` not in the allowed set → 400); **known-balance clamp** and **unknown-balance staff-entered amount** (cap enforced; missing amount → 400); **idempotency:** same `attempt_id` replayed → same PI, one ledger row (23505 tolerated); **two equal-amount payments with distinct `attempt_id`s → two PIs, two rows** (the split-payment case); card_present without `attempt_id` → 400.
- Webhook: feed `payment_intent.succeeded` with `reserve_ni_purpose: APPOINTMENT_BALANCE` (Stripe CLI or crafted event) → ledger flips `succeeded`, summary recomputes, receipt sent. Re-deliver same event → no double-credit. `charge.refunded` → `refunded` + recompute. Confirm a balance PI does **not** trigger the deposit-confirmation path.
- Stripe **test mode** with a connected test account that has card-present capability + a Terminal Location.

**Mobile:**
- `jest` + `@testing-library/react-native`: `TakePaymentSheet` state machine (incl. the unknown-price amount-entry path), `useTakePayment` call mapping (Terminal SDK mocked), button-gate logic (hidden when not enabled / not appointment / paid / cancelled; shown when `balanceDue` is `null`).
- EAS **dev build** (dev entitlement granted): Terminal `simulated: true` reader first → full collect/confirm; then a **real card** on a physical iPhone XS+/iOS 16.4+ and an NFC Android 11+ device.
- E2E: open an appointment with a deposit paid → Take payment → tap → success → web dashboard shows Paid + ledger row → guest receives receipt email. Then verify completing an appointment **without** paying is unobstructed.

**Frictionless regression checks (§3.4):**
- Disable the flag → entire surface gone, app behaves as pre-feature.
- Status transitions never blocked by `payment_state`.
- No auto-open of the sheet anywhere.

---

## 12. Phased delivery & estimates (~13–18 eng-days; calendar-bound by Apple)

| Phase | Work | Est. | Risk |
|---|---|---|---|
| **0. Prereqs (day 1)** | Request Apple **dev** (~1–2 business days) + **publishing** (~1–2 weeks) entitlements; enable card-present + Terminal Location on pilot venue. | 0.5d work, 1–2wk calendar | **Longest pole** |
| **1. Data model + endpoints** | Migration (ledger + summary + venue cols + backfill), `payment-summary.ts` (incl. `resolveBookingTotalPence`), `terminal-location.ts`, `RESERVE_NI_PI_PURPOSE.APPOINTMENT_BALANCE`, the 3 routes, webhook branch + `confirm-balance-payment.ts`, booking GET + bootstrap extensions, flag. Fully testable in Stripe test mode. | 4–5d | Low |
| **2. Receipt** | `payment_receipt` MessageType + sender, wired into webhook `after`. | 0.5d | Low |
| **3. Custom dev build** | Pinned package + plugin + entitlement; EAS dev build; confirm boots + `initialize()` succeeds. | 1.5–2.5d (build wait) | Medium |
| **4. Terminal provider + hooks** | `TerminalProvider`, `useTapToPayReader` (discover/connect + venue-switch reconnect), `useTakePayment`/`useRecordExternalPayment`/`useRefundPayment`. Simulated reader → real card. **Resolve the capture-flow question (§13).** | 2.5–3.5d | Med-high (beta churn) |
| **5. UI** | Type extension, button gate, `TakePaymentSheet` (card/cash/refund, known + unknown-price amount, states, fallback). | 1.5–2d | Low-med |
| **6. Harden + store builds** | Double-tap/partial/refund end-to-end, flag gating, production/TestFlight builds (needs publishing entitlement), pilot one venue. | 1.5–2.5d | Medium |

---

## 13. Risks & mitigations
- **Apple entitlement lead time** — request both tiers on day 1.
- **Connect card-present capability + Location** — verify on the pilot venue up front; clear backend 400s; some venues may need to re-onboard/accept updated terms.
- **`booking_total_price_pence` NULL for appointments** — handled by `resolveBookingTotalPence` + the staff-confirmable amount (§5.7); optionally populate it at creation time for clean reporting.
- **Terminal capture flow (verify in Phase 1/4)** — confirm against the pinned SDK whether `confirmPaymentIntent` captures immediately with `capture_method: 'automatic'`, or whether card-present requires a server-side capture step (`capture_method: 'manual'` + a `stripe.paymentIntents.capture(...)` call, typically from the webhook). Default to `'automatic'`; if the SDK/account requires manual, add a capture step. This affects only the charge route + webhook, not the data model.
- **UK SCA / contactless-only** — high-value cards may force PIN-on-glass or decline → **Send payment link** fallback in the error state.
- **Android device eligibility** — NFC + Android 11+, certified, non-rooted; detect ineligible devices and message clearly (offer cash/link).
- **Beta SDK churn** — pin the version; re-verify discover/connect against that version's docs.
- **Webhook vs client race** — webhook is source of truth; PI-unique index + `webhook_events` give double idempotency.

---

## 14. Future (post-v1)
- **Tips** — surface the reserved `tip_amount_pence` column with a tip selector + include in the charge amount.
- **Partial refunds** — v1 refunds are full-per-payment only (§6.3a). Partial needs a `refunded_amount_pence` column on `booking_payments` (the binary `status` can't represent it) + recompute over `amount_pence − refunded_amount_pence` + webhook handling of partial `charge.refund.updated` amounts.
- **Other booking models** — extend the gate beyond appointments where a balance concept applies.
- **Saved-card off-session** — charge a stored card for no-shows/remote balances (infra exists: `venue_customer_stripe`).
- **Card-present capability auto-sync** — listen to `account.updated` to keep `card_present_ready` exact.
- **Populate `booking_total_price_pence` at creation** — make balances/reporting authoritative across all flows.
- **Internet/smart countertop readers** (Stripe Reader S700, BBPOS WisePOS E, Verifone P400) — a shared fixed till rather than a device-paired reader. **Revisit only if the pilot surfaces demand from larger front-desk / reception-style venues**; it is not a coverage gap (Tap to Pay + Bluetooth already cover every device class and card-present interaction) but a different deployment shape. Clean bolt-on when needed: `internet` discovery + registration-code onboarding + reader-to-account association, reusing the same connection-token, charge route, webhook, and ledger. The method-selection UI (§7A.6) is additive, so no rework to the existing two methods.

---

## 15. Appendix — file-by-file change list

### resneo (backend) — new
- `supabase/migrations/2026XXXX_booking_payments_ledger.sql` — enums, `booking_payments`, summary cols, venue cols, backfill.
- `src/lib/booking/payment-summary.ts` — `recomputeBookingPaymentSummary` + `resolveBookingTotalPence`.
- `src/lib/stripe/terminal-location.ts` — `ensureTerminalLocation`.
- `src/app/api/payments/connection-token/route.ts`.
- `src/app/api/venue/bookings/[id]/charge/route.ts`.
- `src/lib/booking/confirm-balance-payment.ts`.

### resneo (backend) — modified
- `src/types/class-commerce.ts` — add `APPOINTMENT_BALANCE: 'appointment_balance'` to `RESERVE_NI_PI_PURPOSE`.
- `src/app/api/webhooks/stripe/route.ts` — balance branch (early return) + refund branch extension.
- `src/lib/communications/types.ts` (`MessageType` += `'payment_receipt'`) + `send-templated.ts` (`sendPaymentReceiptEmail`).
- `src/lib/booking/load-booking-detail-bundle.ts` + the GET `/api/venue/bookings/[id]` (and `/summary`) — return `amount_paid_pence`, `payment_state`, resolved `booking_total_price_pence`, `balance_due_pence`.
- Venue bootstrap route `GET /api/venue` — return `in_person_payments_enabled`, `card_present_ready`.
- *(Optional, recommended)* `src/app/api/booking/create/route.ts`, `src/app/api/venue/bookings/route.ts` — populate `booking_total_price_pence` for appointments.
- (DB types regenerated.)

### resneo-app (mobile) — new
- `providers/TerminalProvider.tsx`.
- `lib/payments/terminal.ts` + `useTapToPayReader`.
- `lib/queries/useTakePayment.ts` (+ `useRecordExternalPayment`, `useRefundPayment`).
- `components/bookings/TakePaymentSheet.tsx`.
- *(Physical Bluetooth reader, §7A.13)* `lib/payments/bluetoothReader.ts` + `useBluetoothReader`; `components/bookings/ReaderSettingsSheet.tsx`.

### resneo-app (mobile) — modified
- `package.json` — pinned `@stripe/stripe-terminal-react-native`.
- `app.json` — plugin + iOS entitlement; `eas.json` — build profiles.
- `lib/env.ts` + `.env.example` — `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- `types/booking-detail.ts` — payment fields.
- `components/bookings/BookingDetailContent.tsx` — button gate + paid indicator.
- `providers/AppProviders.tsx` — mount `TerminalProvider` just inside `ToastProvider` (no-op when venue not enabled).
- `types/venue.ts` (`VenueBootstrap`) — add `in_person_payments_enabled`, `card_present_ready` (already carries `stripe_connected_account_id`).

---

## 16. Verification log (2026-06-24)

Each design assumption was checked against the actual code. Outcome and the adjustment it produced:

| # | Assumption | Result | Adjustment made |
|---|---|---|---|
| 1 | Stripe SDK has Terminal API | ✅ TRUE (`stripe@^20.4.0`; `terminal.connectionTokens`/`locations` exist) | none |
| 2 | `getVenueStaff` → `{id,venue_id,email,role,db}`, `role==='admin'` | ✅ TRUE; `requireAdmin()` helper exists | refund uses `requireAdmin(staff)` (§6.3) |
| 3 | `loadStaffAccessibleBooking` exposes `ctx.{booking,ownerVenueId,isOwnVenue,linkedGrant}`; booking has all columns | ✅ TRUE (`select('*')`) | none |
| 4 | A helper resolves linked-venue scope **without** a booking | ⚠️ invented name wrong | use real `resolveLinkedStaffCatalogScope(admin, staffVenueId, ownerVenueId)` (§6.2) |
| 5 | Webhook idempotency-safe early-return for a purpose branch | ✅ TRUE (claim precedes handling; class-commerce branches already early-return; `after` imported; `event.account` available) | use `RESERVE_NI_PI_PURPOSE.APPOINTMENT_BALANCE`; placement note (§6.4) |
| 6 | `booking_total_price_pence` populated for appointments | 🔴 **FALSE** (only event-tickets/imports) | **`resolveBookingTotalPence` + staff-confirmable amount (§5.7)**; null-balance gate (§3.4/§7.8); optional creation-time population (§14) |
| 7 | Appointment detection field | ✅ `booking_model ∈ {practitioner_appointment, unified_scheduling}` (per-booking) | exact guard specified (§6.3); mobile gate noted as venue-level |
| 8 | Class-commerce ledger conventions to copy | ✅ TRUE | partial unique index (nullable PI) confirmed (§5.2) |
| 9 | Comms layer (`sendPolicyMessage`, `venueRowToEmailData`, `MessageType`, `createOrGetPaymentShortLink`) | ✅ TRUE | model on real `sendDepositConfirmationEmail`; `MessageType += 'payment_receipt'` (§6.5) |
| 10 | Mobile: `VenueBootstrap.stripe_connected_account_id`, deposit wiring, `useBookingDeposit`/`invalidateBookingCaches`/`useAccessToken`/`apiFetch`, UI primitives, `useBookingDetail`→`/api/venue/bookings/[id]` | ✅ TRUE | none |
| 11 | Provider mount = "app root layout" | ⚠️ imprecise | real file `providers/AppProviders.tsx`, just inside `ToastProvider` (§7.5) |
| 12 | Terminal `capture_method: 'automatic'` works for Tap to Pay confirm | ❓ unverified | explicit Phase 1/4 verify item + manual-capture fallback (§13) |

**Net:** one critical issue (#6, appointment price) — resolved by the price resolver + staff-confirmable amount, with no change to the overall architecture. Everything else was confirmed or required only a precise reference. The design is implementable end-to-end as written.

### Second review (2026-07-23)

Re-verified the §16 symbol references against `staging` (all still hold; feature still unbuilt — no migration, no payment routes). Pressure-testing the money-flow edges surfaced four correctness gaps, all fixed in place, none architectural:

| # | Finding | Fix |
|---|---|---|
| 13 | Amount-based idempotency key (`balance:${id}:${pence}`) collides on legitimate equal-amount split payments → replayed PI → unique-index 500 | Client-minted `attempt_id` per payment attempt keys the PI create; ledger insert tolerates 23505 (§6.3c, §7.7) |
| 14 | Partial refunds corrupt the recompute (binary row status vs partial amount) | v1 refunds are full-per-payment only; partial deferred to §14 with `refunded_amount_pence` |
| 15 | Cash/external rows unrefundable (refund sketch assumed a PI; deposit-route precedent is Stripe-only) and no way to void a mis-recorded cash payment | Refund on a cash/external row skips Stripe and writes the ledger reversal directly, admin-gated (§6.3a) |
| 16 | `refunded` vs `deposit_paid` precedence ambiguous when a balance refund coexists with a paid deposit | `refunded` only when a refunded row exists AND recomputed `amount_paid_pence` = 0 (§5.5) |

Plus hygiene: `payment_intent.canceled` flips abandoned `pending` ledger rows to `failed` (§6.4). §11 tests extended to cover all of the above. Open items unchanged: the §13 capture-flow question and pinned-SDK verification (§7.1, §7A.4/§7A.5) remain deliberate build-time checks.

### Third review (2026-07-23) — backend implemented

The resneo backend landed as specified (all §15 backend files; 49 new vitest cases; full suite, tsc, and eslint clean). Three implementation adjustments, now reflected in the sections above:

| # | Adjustment | Where |
|---|---|---|
| 17 | Receipt comm-log type is `payment_receipt_email` and the `communication_logs.message_type` DB CHECK constraint is extended in the ledger migration — the spec had missed the constraint, which would have silently failed every receipt insert | §6.5 |
| 18 | Receipt log mode is `upsert`, not `dedupe` — dedupe would swallow the receipt for the second equal-split payment; webhook idempotency already prevents duplicates | §6.5 |
| 19 | The venue flag 403-gates refunds too (kill switch is total); Stripe-dashboard refunds still reconcile via the flag-agnostic `charge.refunded` webhook | §6.7 |

Also carried through from house patterns: cross-venue charge/refund writes are audited via `recordBookingWriteAudit` (§9 tenant-isolation posture), and the balance total is resolved via a `resolveBookingTotalPenceFromRow` helper that fetches the variant price from `service_variants` (the price is not on the bookings row). Deploy notes: apply the migration before the routes, and add **`payment_intent.canceled`** to the Stripe webhook endpoint's subscribed events.
