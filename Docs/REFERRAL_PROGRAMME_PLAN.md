# Resneo Referral Programme — Implementation Plan

**Status:** Proposed (no code written yet)
**Date:** 2026-05-27
**Owner:** TBD

---

## 1. Goal

Allow existing Resneo customers ("venues") to refer new venues. Both referrer and referee receive **one free month** of their subscription:

- **Referee** — gets an extended trial: the standard 14-day free trial **plus** a 30-day referral month, applied **before** the first paid invoice.
- **Referrer** — receives a one-month credit on their Stripe customer balance, applied **only after the referee's first paid invoice settles successfully**.

The reward value follows the referrer's own plan price (so a Restaurant venue who refers an Appointments Light venue still gets a Restaurant-month credit). See §10.

Out of scope for this build:
- Multi-tier referrals (referrer of referrer).
- Cash payouts instead of credits.
- Public leaderboards.

---

## 2. Codebase context (what already exists)

Before implementing, note these existing files — the plan slots into them rather than re-inventing infrastructure:

- **Signup form (client):** [src/app/signup/page.tsx](../src/app/signup/page.tsx) — Supabase email/password signup; no referral input today.
- **Checkout session create:** [src/app/api/signup/create-checkout/route.ts](../src/app/api/signup/create-checkout/route.ts) — builds `stripe.checkout.sessions.create({...})` with `subscription_data: buildSignupCheckoutSubscriptionData()`.
- **Trial config (single source of truth):** [src/lib/signup-trial-copy.ts](../src/lib/signup-trial-copy.ts) — `SIGNUP_TRIAL_DAYS = 14` plus the copy strings used across the marketing site and signup pages.
- **Subscription-data builder:** [src/lib/stripe/subscription-line-items.ts](../src/lib/stripe/subscription-line-items.ts) — `buildSignupCheckoutSubscriptionData()` returns `{ trial_period_days: SIGNUP_TRIAL_DAYS }`. **This is the function the referee-side discount must extend.**
- **Venue provisioning (post-checkout):**
  - [src/app/api/signup/complete/route.ts](../src/app/api/signup/complete/route.ts) — called by `/signup/success?session_id=...` page, inserts the `venues` row.
  - [src/app/api/webhooks/stripe-subscription/route.ts](../src/app/api/webhooks/stripe-subscription/route.ts) — `handleCheckoutCompleted()` is the idempotent webhook path that also creates a venue if the success page didn't.
  - **Both paths must link the new venue to the pending referral** (whichever fires first wins; the second is a no-op).
- **Stripe subscription webhook (where referrer credit fires):** the same [stripe-subscription/route.ts](../src/app/api/webhooks/stripe-subscription/route.ts) already handles `invoice.payment_succeeded` (currently only clears `past_due`). We extend this handler — **do not add a new webhook endpoint** unless event subscriptions don't overlap.
- **Webhook idempotency:** [src/lib/webhooks/stripe-event-idempotency.ts](../src/lib/webhooks/stripe-event-idempotency.ts) (`claimStripeWebhookEvent` / `releaseStripeWebhookEvent`). The referral credit logic must run inside that claim, so retried events do not double-credit.
- **Pricing constants:** [src/lib/pricing-constants.ts](../src/lib/pricing-constants.ts) — `APPOINTMENTS_LIGHT_PRICE` (20), `APPOINTMENTS_PLUS_PRICE` (49), `APPOINTMENTS_PRO_PRICE` (99), `RESTAURANT_PRICE` (79). `pricing_tier` values stored: `light | plus | appointments | restaurant | founding`.
- **Venue model:** `venues.id`, `venues.name`, `venues.slug`, `venues.email`, `venues.stripe_customer_id`, `venues.pricing_tier`, `venues.plan_status` (see [src/app/api/signup/complete/route.ts](../src/app/api/signup/complete/route.ts) for full insert shape).
- **Auth/RLS pattern:** Staff identified by `auth.jwt() ->> 'email'`; venues protected by membership in the `staff` table. See [supabase/migrations/20260301000007_rls_policies.sql](../supabase/migrations/20260301000007_rls_policies.sql). New tables follow the same pattern.
- **Server-side venue auth helpers:** [src/lib/venue-auth.ts](../src/lib/venue-auth.ts) — `getVenueStaff(supabase)` + `requireAdmin(staff)`; `staff.db` is the admin client used for queries.
- **Dashboard navigation:** [src/app/dashboard/DashboardSidebar.tsx](../src/app/dashboard/DashboardSidebar.tsx) — `BASE_NAV_ITEMS` array; add a new "Refer & Earn" entry here.
- **Settings sections:** [src/app/dashboard/settings/sections/](../src/app/dashboard/settings/sections/) — pattern for the in-settings code/link surface if we prefer that over a dedicated page.
- **Email (SendGrid):** [src/lib/emails/send-email.ts](../src/lib/emails/send-email.ts) — `sendEmail({ to, subject, html, text, fromDisplayName, replyTo })`. Templates live under [src/lib/emails/templates/](../src/lib/emails/templates/).
- **Stripe server SDK:** [src/lib/stripe/index.ts](../src/lib/stripe/index.ts) — server-only `stripe` instance.
- **Migrations directory:** `supabase/migrations/`. Filenames follow `YYYYMMDDHHMMSS_description.sql`. Latest as of 2026-05-27 is `20261101120600_communication_logs_updated_at.sql`; new migrations should use the next sequential timestamp.

> **Convention note:** Venue rows are inserted from **two** code paths (signup-complete API + subscription webhook) for idempotency. Every write that "happens when a new venue is created" must run from both, or — better — be triggered off the new-venue insert itself rather than embedded in either route.

---

## 3. Database schema (Supabase)

New migration: `supabase/migrations/<next-timestamp>_referrals.sql`.

### 3.1 `referral_codes`

One row per venue. Created lazily when the venue first opens the Refer & Earn page (or eagerly during signup — see §4).

```sql
CREATE TABLE IF NOT EXISTS referral_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid NOT NULL UNIQUE REFERENCES venues (id) ON DELETE CASCADE,
  code          text NOT NULL UNIQUE,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes (lower(code));
CREATE INDEX IF NOT EXISTS idx_referral_codes_venue ON referral_codes (venue_id);
```

- `code` is **case-insensitive** in lookup; we lower() on read and on insert.
- `UNIQUE(venue_id)` — one canonical code per venue. A future "rotate code" feature would update in place, not add rows.
- `active = false` lets us soft-disable a code without breaking historic `referrals` rows.

### 3.2 `referrals`

One row per *attempted* referral. Tracks the lifecycle from link click → signup → first paid invoice → credit issued.

```sql
CREATE TYPE referral_status AS ENUM (
  'pending',              -- code attached but no venue yet (rare; we usually create after signup)
  'referee_signed_up',    -- referred venue exists and has extended trial
  'credited',             -- referrer has received Stripe balance credit
  'failed',               -- referee never paid (cancelled, payment failed permanently)
  'void'                  -- self-referral / abuse / manual reversal
);

CREATE TABLE IF NOT EXISTS referrals (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        text NOT NULL,
  referrer_venue_id           uuid NOT NULL REFERENCES venues (id) ON DELETE RESTRICT,
  referred_venue_id           uuid REFERENCES venues (id) ON DELETE SET NULL,
  status                      referral_status NOT NULL DEFAULT 'pending',
  referee_trial_applied_at    timestamptz,
  referrer_credited_at        timestamptz,
  referrer_credit_amount_pence integer,        -- snapshot at credit time
  referrer_credit_currency    text DEFAULT 'gbp',
  stripe_balance_transaction_id text,          -- to deduplicate credits
  void_reason                 text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- One credit per referred venue, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_referred_venue
  ON referrals (referred_venue_id)
  WHERE referred_venue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_venue_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals (status);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals (lower(code));
```

### 3.3 `referral_audit`

Lightweight append-only log of state transitions. Useful for support investigations and accounting reconciliation.

```sql
CREATE TABLE IF NOT EXISTS referral_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id  uuid NOT NULL REFERENCES referrals (id) ON DELETE CASCADE,
  from_status  referral_status,
  to_status    referral_status NOT NULL,
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_audit_referral ON referral_audit (referral_id, created_at DESC);
```

### 3.4 RLS

Follow the existing pattern from [20260301000007_rls_policies.sql](../supabase/migrations/20260301000007_rls_policies.sql):

```sql
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_audit ENABLE ROW LEVEL SECURITY;

-- A venue's own staff can read their referral_code row.
CREATE POLICY "staff_select_own_referral_code"
  ON referral_codes FOR SELECT
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

-- A venue's own staff can read referrals where they are the referrer
-- (so they can see who they signed up). They do NOT see the referee's
-- contact details directly — the API surface joins only on venue name.
CREATE POLICY "staff_select_own_referrals_as_referrer"
  ON referrals FOR SELECT
  USING (referrer_venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

-- Writes are service-role only. No client INSERT/UPDATE policy is created.
-- referral_audit is also service-role only.
```

> Service role bypasses RLS, so all our API routes write via `getSupabaseAdminClient()` (the existing pattern — see `src/app/api/signup/complete/route.ts:56`).

---

## 4. Referral code generation

Format: `<SLUGIFIED-VENUE-NAME>-<4-char-random>`, e.g. `GREENWAY-X4F2`. Upper-case, alphanumeric, hyphens.

Generator lives in a new file: `src/lib/referrals/code.ts`. It must:

1. Take the venue's `name` (the default is `"My Business"` for fresh signups — see `signup/complete/route.ts:131`, so the slug may be `"MY-BUSINESS"` until the venue is renamed during onboarding). Acceptable; the random suffix preserves uniqueness.
2. Slugify → uppercase A–Z/0–9 only, max 20 chars before the suffix.
3. Append `-` + 4 random chars from `[A-Z2-9]` (no I/O/0/1 to reduce verbal-handoff confusion).
4. Insert into `referral_codes` with retry-on-conflict (up to 5 attempts; each attempt regenerates the suffix). The `UNIQUE(code)` constraint guarantees correctness; we just retry.

**When to generate:**

- Eagerly, at venue insertion time in both [src/app/api/signup/complete/route.ts](../src/app/api/signup/complete/route.ts) and [src/app/api/webhooks/stripe-subscription/route.ts](../src/app/api/webhooks/stripe-subscription/route.ts) (`handleCheckoutCompleted`). Use the upsert/conflict-ignore pattern so both paths racing for the same venue is safe.
- Backfill migration step: also insert a `referral_codes` row for every existing venue (idempotent — `ON CONFLICT (venue_id) DO NOTHING`). The migration script lives next to the schema migration, or as a one-shot under `scripts/`.
- **Important:** if a venue is later renamed, we do **not** regenerate the code — codes are stable identifiers, not vanity URLs.

---

## 5. Referee-side flow (the new venue gets the extended trial)

### 5.1 Capturing the `ref` param

Add a thin shim on top of `/signup`:

1. Update [src/app/signup/page.tsx](../src/app/signup/page.tsx) (or wrap it in a server component that reads `searchParams.ref`). On mount:
   - Read `ref` from URL.
   - `GET /api/referrals/validate?code=<code>` returns `{ valid: true, referrer_venue_name }` or `{ valid: false, reason }`.
   - If valid, persist into a first-party cookie `reserveni_ref` (HttpOnly **false** so the client can read it for the banner; `SameSite=Lax`; 30-day expiry; not Secure on local dev). Cookie value: just the code string — small, validated server-side again at checkout.
   - Show a banner: *"Referred by {referrer_venue_name} — your first month is free after your 14-day trial."*
2. Add an optional collapsed `<details>Have a referral code?</details>` input on the signup form for users without a link. On change, validate live and update the cookie.
3. New API route: `src/app/api/referrals/validate/route.ts` (server). Looks up `referral_codes` by `lower(code)` joined to `venues` for the display name, returns `{ valid, referrer_venue_name }`. Must check `referral_codes.active = true` AND `venues.plan_status IN ('active','trialing','cancelling')` ("good standing").

### 5.2 Carrying the code through Checkout

Modify [src/app/api/signup/create-checkout/route.ts](../src/app/api/signup/create-checkout/route.ts):

1. Accept an optional `referral_code` field on the POST body (the client reads it from the cookie / form and includes it).
2. Re-validate server-side (same query as `validate`). On invalid, **silently drop** the code (don't fail signup) and log.
3. If valid, look up the referrer venue id and:
   - Add `referral_code` and `referrer_venue_id` to the checkout `metadata` object.
   - Override the trial length: pass `subscription_data: buildSignupCheckoutSubscriptionDataWithReferral()` (a new sibling of `buildSignupCheckoutSubscriptionData` — see §5.3).

### 5.3 Extending the trial

Add to [src/lib/stripe/subscription-line-items.ts](../src/lib/stripe/subscription-line-items.ts):

```ts
import { SIGNUP_TRIAL_DAYS } from '@/lib/signup-trial-copy';
import { REFERRAL_REFEREE_BONUS_DAYS } from '@/lib/referrals/constants';

export function buildSignupCheckoutSubscriptionDataWithReferral(): Stripe.Checkout.SessionCreateParams.SubscriptionData {
  return {
    trial_period_days: SIGNUP_TRIAL_DAYS + REFERRAL_REFEREE_BONUS_DAYS,
  };
}
```

New constant file `src/lib/referrals/constants.ts`:

```ts
export const REFERRAL_REFEREE_BONUS_DAYS = 30;
export const REFERRAL_REWARD_PENCE_BY_TIER: Record<string, number> = {
  light: Number(process.env.REFERRAL_REWARD_LIGHT_PENCE ?? 2000),
  plus: Number(process.env.REFERRAL_REWARD_PLUS_PENCE ?? 4900),
  appointments: Number(process.env.REFERRAL_REWARD_APPOINTMENTS_PENCE ?? 9900),
  restaurant: Number(process.env.REFERRAL_REWARD_RESTAURANT_PENCE ?? 7900),
};
export const REFERRAL_MAX_UNREDEEMED_CREDITS = 6;
```

> **Confirmed pricing (inc-VAT):** Appointments Light £20, Appointments Plus £49, Appointments Pro £99, Restaurant £79. Reward equals the referrer's full monthly price — the user-visible promise is "one free month".

### 5.4 Creating the `referrals` row

In **both** venue-creation paths ([signup/complete/route.ts](../src/app/api/signup/complete/route.ts) and `handleCheckoutCompleted` in [webhooks/stripe-subscription/route.ts](../src/app/api/webhooks/stripe-subscription/route.ts)):

1. After the `venues` insert succeeds, check checkout `session.metadata.referral_code`.
2. If present:
   - Resolve `referrer_venue_id` again from the code (do not trust metadata for the FK; metadata is for indexing).
   - Run the anti-abuse checks (§7) — on any failure, write the row with `status: 'void'` and `void_reason` set, **do not** extend the trial server-side, and continue. (At this point the extended trial is already applied in Stripe; we can't undo cleanly. Log and move on — the credit gate at §6 still protects us.)
   - On success, insert a `referrals` row:
     ```
     code, referrer_venue_id, referred_venue_id = new venue id,
     status = 'referee_signed_up',
     referee_trial_applied_at = now()
     ```
   - The `UNIQUE(referred_venue_id)` index makes the two code paths idempotent — second write fails harmlessly.

### 5.5 In-app messaging

On the dashboard for a referred venue, surface a small banner during the trial:

> "Trial: 14 days + 30 days referral credit — your first charge will be on {trial_end_date}."

Compute from `venues.subscription_current_period_end` (already set during webhook handling). Banner component lives near existing trial UI (search for `SIGNUP_TRIAL_DAYS` usage in the dashboard if any, otherwise add to `DashboardHomeClient.tsx`).

---

## 6. Referrer-side flow (the credit fires after referee's first paid invoice)

Extend the existing `invoice.payment_succeeded` branch in [src/app/api/webhooks/stripe-subscription/route.ts](../src/app/api/webhooks/stripe-subscription/route.ts) (around lines 137–150 today).

New logic, in a dedicated helper `src/lib/referrals/credit-referrer.ts` so the webhook route stays readable:

```ts
export async function maybeCreditReferrerForInvoice(
  admin: SupabaseAdmin,
  invoice: Stripe.Invoice,
): Promise<void>
```

Steps:

1. **Amount filter** — `if (invoice.amount_paid <= 0) return;` (skip £0 trial-end and proration invoices).
2. **Customer → venue** — resolve `referred_venue_id` from `invoice.customer` (string) via `venues.stripe_customer_id`.
3. **Find pending referral** — `SELECT * FROM referrals WHERE referred_venue_id = $1 AND status = 'referee_signed_up'`. If none, return.
4. **First-paid-invoice guard** — additionally verify Stripe has no prior `paid` invoice for this customer (defence in depth against retroactive backfills). Lightweight: list last 5 invoices for the customer, check if any earlier-dated one with `amount_paid > 0` exists.
5. **Stacking cap** — count `status = 'credited'` referrals for `referrer_venue_id` minus those already drawn down (heuristic: count rows where `referrer_credited_at` is within the referrer's current/next billing cycle window OR no later invoice has reset the balance). MVP: simple "count credited in last 12 months minus credits older than the referrer's most recent paid invoice". If `>= REFERRAL_MAX_UNREDEEMED_CREDITS`, **defer**: write `referral_credit_queue` row (table below) and mark referral as `credited` with `void_reason = 'queued_over_cap'` and **do not** push to Stripe. Flag this branch with a `TODO: revisit cap accounting` — the brief explicitly allows deferring this work.
6. **Compute reward** — read referrer's current `pricing_tier` and look up `REFERRAL_REWARD_PENCE_BY_TIER`. Snapshot the value into `referrer_credit_amount_pence`.
7. **Apply Stripe balance credit** —
   ```ts
   const tx = await stripe.customers.createBalanceTransaction(referrerStripeCustomerId, {
     amount: -rewardPence,   // negative = credit to customer
     currency: 'gbp',
     description: `Referral reward — referred ${refereeVenueName}`,
     metadata: { referral_id, referred_venue_id, referrer_venue_id },
   });
   ```
8. **Persist** — update the referral row inside a single transaction: `status='credited'`, `referrer_credited_at=now()`, `stripe_balance_transaction_id=tx.id`. Insert a `referral_audit` row.
9. **Email referrer** — via [src/lib/emails/send-email.ts](../src/lib/emails/send-email.ts):
   > Subject: *"Your referral signed up — £{X} credit applied to your next invoice"*
   > Body: rendered HTML from a new template under `src/lib/emails/templates/referral-credited.html.ts` (and `.text.ts`).

**Idempotency:**

- The whole webhook handler is wrapped in `claimStripeWebhookEvent(...)` already — a retried event won't re-execute the body.
- Belt-and-braces: `stripe_balance_transaction_id` is recorded on the referral. Before calling `createBalanceTransaction`, re-`SELECT` the referral row and abort if `stripe_balance_transaction_id IS NOT NULL`.

**Failure modes:**

- Referee cancels before first paid invoice → on `customer.subscription.deleted` (already handled in this webhook), find referrals where `referred_venue_id` matches and `status='referee_signed_up'`, set `status='failed'`. No credit.
- Permanent payment failure → harder to detect cleanly; in MVP, leave the referral in `referee_signed_up` until Stripe transitions the subscription to `canceled`. Acceptable.

### 6.1 Optional cap-queue table (deferred)

```sql
-- Optional, only if §6 step 5 needs it. Brief allows deferring.
CREATE TABLE IF NOT EXISTS referral_credit_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id  uuid NOT NULL REFERENCES referrals (id) ON DELETE CASCADE,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
```

---

## 7. Anti-abuse

All checks run server-side inside the `referrals` row creation in §5.4. Failures → `status='void'` with a descriptive `void_reason`.

1. **Self-referral guards** — reject when any of these match between referrer venue and the just-created referee:
   - Auth email or `venues.email` domain. (Compare the email **domain** only, since some operators legitimately use the same domain for two venues — but this is an MVP guard; tighten if abuse appears.)
   - Stripe customer fingerprint: `stripe.customers.retrieve(customerId, { expand: ['default_source'] })` and compare `default_source.fingerprint` if both venues have a card on file.
   - Companies House number: **not currently stored** on `venues` (verify via `grep -n companies_house src/`). If absent, drop this check from MVP; document as a follow-up. (Verify before implementation.)
2. **Single credit per referee** — enforced by `UNIQUE(referred_venue_id)` on `referrals`.
3. **Code must be active and venue in good standing** — re-validated at every step (validate API, checkout creation, referral row insert, credit application). Don't trust prior checks.
4. **Stacking cap** — see §6 step 5.
5. **All state transitions audited** — `referral_audit` row on every change. Helper `recordReferralTransition(referralId, from, to, detail)` in `src/lib/referrals/audit.ts`.

---

## 8. Referrer dashboard ("Refer & Earn")

**Location:** new page `src/app/dashboard/referrals/page.tsx`. Add a nav entry to [src/app/dashboard/DashboardSidebar.tsx](../src/app/dashboard/DashboardSidebar.tsx) in `BASE_NAV_ITEMS` between Contacts and Reports, label "Refer & Earn", admin-visible to all roles (it's a benefit, not an admin tool — review the visibility matrix at the top of `DashboardSidebar.tsx`).

**Server data load** (server component):

- `getVenueStaff(supabase)` → resolve venue id.
- Read `referral_codes` row (create lazily if missing).
- Read `referrals WHERE referrer_venue_id = staff.venue_id ORDER BY created_at DESC`. Join referee venue **name only** (no contact info — privacy).
- Read Stripe customer balance (`stripe.customers.retrieve(...).balance`) for "credit remaining" display. Negative balance = credit available.

**UI sections:**

1. **Your referral code** — large code chip + shareable link (`${NEXT_PUBLIC_BASE_URL}/signup/choose-plan?ref=${code}`), copy-to-clipboard button. The link lands on the plan-selection page so the referee can pick Light / Plus / Pro / Restaurant before signing up; the referral cookie persists from that page through the rest of the funnel.
2. **Share** — WhatsApp / email / copy-link quick actions. `mailto:` and `https://wa.me/?text=...` are fine, no SDK needed.
3. **How it works** — three-step explainer with the £X amount derived from the referrer's plan.
4. **Your referrals (table)** — columns: *Referred on*, *Venue*, *Status* (badge: Pending / Signed up — trialling / Credited / Void), *Credit value*. Show void rows greyed.
5. **Credit summary** — *Total credit earned*, *Credit remaining on next invoice* (from Stripe balance). Link to Settings → Plan to see how it applies.

**API routes (for client interactions):**

- `GET /api/referrals/me` — bundles all the above for hydration / refresh after share.
- `POST /api/referrals/rotate` — admin-only, regenerates the suffix and deactivates the old code (sets `active=false` on the old row, inserts a new one). **Deferred unless requested** — flag in the UI as a "Need a new code? Contact support" link for MVP.

---

## 9. VAT and accountancy

Resneo's headline prices already include VAT (£20 / £49 / £79 / £99). The referral reward equals the referrer's full inc-VAT monthly price, applied as a Stripe customer balance credit. A £79 Restaurant credit fully covers a £79 invoice line.

- Document on the Refer & Earn page: *"Reward is applied as a credit on your next invoice. The credit is the full monthly price of your plan."*
- Per-tier pence amounts are exposed via env vars (§10) so finance can adjust without a code release if pricing ever changes.

---

## 10. Environment variables

Add to `.env.example` and Vercel:

| Var | Default | Purpose |
|---|---|---|
| `REFERRAL_REWARD_LIGHT_PENCE` | `2000` | Per-tier reward override (Appointments Light = £20 inc-VAT). |
| `REFERRAL_REWARD_PLUS_PENCE` | `4900` | Appointments Plus = £49 inc-VAT. |
| `REFERRAL_REWARD_APPOINTMENTS_PENCE` | `9900` | Appointments Pro = £99 inc-VAT. |
| `REFERRAL_REWARD_RESTAURANT_PENCE` | `7900` | Restaurant = £79 inc-VAT. |
| `REFERRAL_REFEREE_BONUS_DAYS` | `30` | Trial extension days. |
| `REFERRAL_MAX_UNREDEEMED_CREDITS` | `6` | Stacking cap. |
| `REFERRAL_PROGRAMME_ENABLED` | `true` | Master kill-switch; disables code generation, banner, credit application. |

`NEXT_PUBLIC_BASE_URL` already exists and is used to compute the shareable link.

---

## 11. Stripe Dashboard configuration

No new webhook endpoint is required — both `invoice.payment_succeeded` and `customer.subscription.deleted` are already subscribed at [/api/webhooks/stripe-subscription](../src/app/api/webhooks/stripe-subscription/route.ts) (see comment block at line 30 of that file). Confirm in the Stripe Dashboard before launch.

No new products / prices / coupons are needed: rewards are applied as **customer balance credits**, not Stripe coupons or promotion codes.

---

## 12. Testing strategy

Patterns are already established (`*.test.ts` colocated, vitest). Add tests next to each new module.

**Unit:**
- `src/lib/referrals/code.test.ts` — slug + suffix collisions, retry behaviour.
- `src/lib/referrals/credit-referrer.test.ts` — mocks Stripe and Supabase; covers happy path, idempotent retry, amount=0 invoice, missing referral row, stacking cap.

**Integration / route:**
- `referrals/validate` valid/invalid/expired/disabled.
- `signup/create-checkout` with referral cookie sets metadata + 44-day trial; without sets 14-day trial (regression).
- Webhook: replay an `invoice.payment_succeeded` event twice → exactly one credit, one email.

**E2E (Playwright, already in repo):**
- Visit `/signup/choose-plan?ref=GREENWAY-X4F2` → banner appears → pick a plan → continue → sign up → checkout has 44-day trial. Stub Stripe Checkout for this.
- Visit legacy `/signup?ref=GREENWAY-X4F2` → redirects to `/signup/choose-plan?ref=GREENWAY-X4F2`.
- Referrer dashboard shows the new referral as "Signed up — trialling".

---

## 13. Migration / rollout plan

1. Land database migration + backfill script for `referral_codes` (one row per existing venue).
2. Ship code generation + Refer & Earn dashboard behind `REFERRAL_PROGRAMME_ENABLED=false`. Verify dashboard renders for staging venues.
3. Ship referee-side capture (cookie, validate API, signup banner, checkout trial extension) behind the same flag.
4. Ship referrer-side webhook credit logic behind the flag.
5. Internal test: create a sandbox referrer and referee on Stripe test mode; run a full cycle (signup → skip trial via Stripe clock → first invoice → assert credit + email).
6. Flip `REFERRAL_PROGRAMME_ENABLED=true` in production, communicate via dashboard notice + email blast.

Phased optionality:
- **Phase 1 (MVP):** §3–8, with stacking cap as a hard "no more credits, queue silently" (no UI for queued credits).
- **Phase 2:** rotate-code endpoint, queued-credit admin UI, Companies House self-referral check (once that field is captured at signup).

---

## 14. File map (what to add / modify)

**New:**
- `supabase/migrations/<ts>_referrals.sql` — schema + RLS + backfill.
- `src/lib/referrals/constants.ts`
- `src/lib/referrals/code.ts` + `.test.ts`
- `src/lib/referrals/credit-referrer.ts` + `.test.ts`
- `src/lib/referrals/audit.ts`
- `src/app/api/referrals/validate/route.ts`
- `src/app/api/referrals/me/route.ts`
- `src/app/dashboard/referrals/page.tsx` (+ client components)
- `src/lib/emails/templates/referral-credited.html.ts` + `.text.ts`

**Modified:**
- `src/app/signup/page.tsx` — read `?ref=`, banner, optional input.
- `src/app/api/signup/create-checkout/route.ts` — accept `referral_code`, validate, set extended trial, stash in `session.metadata`.
- `src/app/api/signup/complete/route.ts` — create `referrals` row post-venue-insert.
- `src/app/api/webhooks/stripe-subscription/route.ts` — same in `handleCheckoutCompleted`; extend `invoice.payment_succeeded` to call `maybeCreditReferrerForInvoice`; in `handleSubscriptionDeleted`, mark referrals failed.
- `src/lib/stripe/subscription-line-items.ts` — add `buildSignupCheckoutSubscriptionDataWithReferral()`.
- `src/app/dashboard/DashboardSidebar.tsx` — add "Refer & Earn" entry.

---

## 15. Open questions (resolve before build)

1. **Reward calibration for tier mismatches.** When a Restaurant venue (£79) refers an Appointments Light venue (£20), the *referrer* gets £79 credit but the *referee* only had a £20-tier trial extended. That's intentionally generous to the referrer; confirm it doesn't create unintended arbitrage (e.g. low-tier accounts created solely to trigger high-tier referrer rewards). Anti-abuse §7 should keep it bounded.
2. **Companies House number** is not currently captured on `venues`. Drop that anti-abuse check or add it to venue profile capture? (Self-referral card/email-domain checks cover the realistic abuse.)
3. **"Good standing"** for a referrer code. Plan currently excludes `past_due` and `cancelled`. Confirm `cancelling` (cancel-at-period-end) should *still* allow referrals — they're paying through their notice period.
4. **Rotating codes.** Out of MVP; surface as "contact support" link. Confirm.

**Resolved:**
- Pricing: £20 / £49 / £99 (Appointments Light / Plus / Pro) and £79 (Restaurant) — confirmed by product. Codebase constants in [src/lib/pricing-constants.ts](../src/lib/pricing-constants.ts) match.
- VAT: Resneo prices already include VAT. Reward equals full inc-VAT monthly price.

---

## 16. Out of scope (explicit)

- Multi-tier referrals (rewards for referring referrers).
- Cash payouts or bank transfers.
- Public leaderboards or social proof widgets.
- Branded short links (e.g. `rni.link/greenway`).
- Promotion code integration in Stripe (we use balance credits, not coupons).
- Marketing-site CMS edits for the public-facing referral programme page (this plan covers product surfaces only).
