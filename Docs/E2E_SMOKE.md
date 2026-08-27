# E2E smoke tests (P0.4)

Playwright smoke coverage for critical guest paths:

1. **Public book → Stripe deposit → guest confirm link** (`e2e/appointment-book-pay-confirm.spec.ts`)
2. **Guest self-reschedule on manage link** (`e2e/guest-self-reschedule.spec.ts`) — requires `guest_self_reschedule` on fixture venue (enabled by seed)

## Prerequisites

1. **Stripe test mode** keys in `.env.local`:
   - `STRIPE_SECRET_KEY` (`sk_test_…`)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`)

2. **Supabase** dev project:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`

3. **Payment link signing:**
   - `PAYMENT_TOKEN_SECRET` (same value the app uses in dev)

4. **Stripe Connect test account** on the fixture venue:
   - Create or reuse a connected account in [Stripe test dashboard](https://dashboard.stripe.com/test/connect/accounts/overview)
   - Set `E2E_STRIPE_CONNECTED_ACCOUNT_ID=acct_…`

## One-time fixture setup

```bash
# After setting E2E_STRIPE_CONNECTED_ACCOUNT_ID in .env.local
node scripts/seed-e2e-smoke-venue.mjs
```

The script seeds **two** venues and is safe to re-run:

| Venue | Slug | What it is for |
|---|---|---|
| Default appointments fixture | `E2E_VENUE_SLUG` | The standard service-first flow: deposit, card hold, and an options-and-extras service. |
| Staff-first fixture | `e2e-smoke-staff-first` (fixed) | The staff-first flow. Two calendars, "E2E Alex" and "E2E Bailey", offering overlapping but different services at different prices, so a service list that ignored the chosen person would show. |

The staff-first slug is deliberately not configurable: if both fixtures could be
pointed at one venue, the suite would test one ordering twice and the other not
at all. The seed script and `globalSetup` both refuse that.

Add to `.env.local` (see `e2e.env.example`, and the seed script prints these):

```env
E2E_VENUE_SLUG=e2e-smoke-appointments
E2E_VENUE_NAME=E2E Smoke Salon
E2E_SERVICE_NAME=E2E Smoke Consultation
E2E_OPTIONS_SERVICE_NAME=E2E Smoke Options Consultation
E2E_STAFF_FIRST_VENUE_SLUG=e2e-smoke-staff-first
E2E_BASE_URL=http://localhost:3000
```

Leaving `E2E_STAFF_FIRST_VENUE_SLUG` unset skips the staff-first specs and runs
the rest.

## Run locally

```bash
# Terminal 1 — app (optional if Playwright starts dev server)
npm run dev

# Terminal 2 — install browsers once
npx playwright install chromium

# Run smoke (starts dev server automatically when not in CI)
npm run test:e2e
```

## CI

The `e2e-smoke` job in `.github/workflows/ci.yml` runs only when the repository variable **`RUN_E2E_SMOKE`** is set to `true` (Settings → Secrets and variables → Actions → Variables). GitHub does not allow `secrets` in job-level `if` expressions.

**Status: green as of 2026-08-27** (10 tests, ~1.8 min). Configured and verified
against the **staging** Supabase project. Never point it at production: the specs
create real bookings and take real test-mode Stripe payments.

Configure these **secrets**, all pointing at staging:

| Secret | Note |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Takes the **publishable** key. The app reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ..._ANON_KEY`, so the older name still resolves. |
| `SUPABASE_SECRET_KEY` | |
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | |
| `PAYMENT_TOKEN_SECRET` | Must match the app under test, or every `?hmac=` link 403s. |
| `E2E_STRIPE_CONNECTED_ACCOUNT_ID` | `acct_…`, written onto both fixture venues by the seed. |

And these repository **variables**:

| Variable | Value |
|---|---|
| `RUN_E2E_SMOKE` | `true` |
| `E2E_VENUE_SLUG` | `e2e-smoke-appointments` |
| `E2E_VENUE_NAME` | `E2E Smoke Salon` |
| `E2E_SERVICE_NAME` | `E2E Smoke Consultation` |
| `E2E_OPTIONS_SERVICE_NAME` | `E2E Smoke Options Consultation` |
| `E2E_STAFF_FIRST_VENUE_SLUG` | `e2e-smoke-staff-first` |

**The fixture names are variables, not secrets, on purpose.** None is sensitive, and
as secrets GitHub masked them everywhere they appeared, so the run log read
`[e2e] Smoke fixture venue slug: ***` and `/book/***`: precisely the information
needed to diagnose a failing run.

**`E2E_VENUE_SLUG` is the one that must never go missing.** Without it every
appointment spec **skips** and the job passes having tested nothing
(`e2e/global-setup.ts:12-17`). The same applies to `E2E_STAFF_FIRST_VENUE_SLUG`
and the staff-first ordering. A green run is only meaningful if both are set.

**Anything the app needs at runtime belongs in the Playwright step's env, not only
in build and seed**, because the web server Playwright starts inherits that step's
environment.

If `RUN_E2E_SMOKE` is unset or not `true`, the job is skipped.

If `RUN_E2E_SMOKE` is unset or not `true`, the job is skipped.

## What the tests assert

### Book → pay → confirm (P0.4)

1. Opens `/book/{E2E_VENUE_SLUG}`
2. Selects service, practitioner (if shown), first available day/slot
3. Submits guest details and pays deposit with Stripe test card `4242…`
4. Sees **Appointment Confirmed** (or venue terminology equivalent)
5. Opens `/confirm/{bookingId}?hmac=…` and sees venue name + service on the guest confirm page

### Guest self-reschedule (P1a.2)

1. Books as above
2. Opens `/manage/{bookingId}/{hmac}`
3. Clicks **Change appointment**, picks another available slot, saves
4. Sees **Your appointment has been updated**

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| Test skipped | Set `E2E_VENUE_SLUG` |
| No available slots | Re-run seed; ensure calendar has Mon–Fri 09:00–17:00 working hours |
| Payment step missing | Service needs `payment_requirement: deposit` and venue needs Connect |
| Stripe iframe timeout | Confirm `pk_test` / `sk_test` keys and Connect account ID |
| Invalid confirm link | `PAYMENT_TOKEN_SECRET` must match the running app |
| "Phone is required" while the digits are visible | The field parses against the country selector and rejects the 07700 900xxx drama range. Use a real-shaped number; `AppointmentBookingFlow.flow-order.test.tsx` records the same trap |
| Day never becomes clickable | The calendar day cells are `gridcell`, not `button`: grid semantics re-map the role |
| Form field not found by label | The public branch of `DetailsStep` bypasses `FormField`, so its inputs have no `id` and the labels are not associated. Use placeholder or `name` |
| Payment never confirms | The helper now fails with Stripe's own message rather than timing out. Read that message first |
| Confirmation email not sent | Expected: SendGrid is not configured for this job, so that path is **not covered** by the suite |

## Files

| Path | Role |
|------|------|
| `playwright.config.ts` | Runner config + dev server |
| `e2e/appointment-book-pay-confirm.spec.ts` | Book → pay → confirm smoke |
| `e2e/guest-self-reschedule.spec.ts` | Manage-link reschedule smoke |
| `e2e/helpers/book-appointment.ts` | Shared public booking flow |
| `e2e/helpers/stripe-payment.ts` | Stripe Payment Element fill |
| `e2e/helpers/manage-link.ts` | HMAC confirm + manage URL builders |
| `scripts/seed-e2e-smoke-venue.mjs` | Fixture venue seed |
