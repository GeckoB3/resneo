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

Add to `.env.local` (see `e2e.env.example`):

```env
E2E_VENUE_SLUG=e2e-smoke-appointments
E2E_VENUE_NAME=E2E Smoke Salon
E2E_SERVICE_NAME=E2E Smoke Consultation
E2E_BASE_URL=http://localhost:3000
```

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

When enabled, configure these **secrets** for the job steps:

- `E2E_VENUE_SLUG`
- `E2E_STRIPE_CONNECTED_ACCOUNT_ID`
- Plus standard app secrets (Supabase, Stripe, `PAYMENT_TOKEN_SECRET`)

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
