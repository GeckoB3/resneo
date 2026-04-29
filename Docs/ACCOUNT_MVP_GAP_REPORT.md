# User accounts MVP — gap closure report

**Date:** 29 April 2026  
**Scope:** Account-platform MVP only (per gap-closure plan). Credits, memberships, courses, and recurring bookings remain intentionally out of product scope.

## Status

| Area | Status |
|------|--------|
| Public vs staff booking entry points | Documented in `Docs/ACCOUNT_PUBLIC_VS_STAFF_ROUTES.md` |
| Account-aware guest matching | `findOrCreateGuest` + `guest-matching-rules`; phone-only skipped for silent auth public email bookings |
| `require_account_login_for_bookings` on public APIs | Shared helper under `src/lib/booking/require-account-login-for-public-booking.ts` |
| Confirmation emails: v2 manage + account CTA | `renderer` + `account-portal-links`; regression test in `renderer.booking-confirmation.test.ts` |
| Account deletion request | RPC anonymises guests; email + global sign-out; cron hard-delete |
| Email change | Collision RPC + `auth.updateUser`; `auth.users` trigger syncs linked `guests.email` |
| v1 / account APIs + Bearer | `createRouteHandlerClient` (cookies + `Authorization: Bearer`) |
| Account dashboard MVP | Bookings filters, detail polish, staff-only venue dashboard nav, disabled future sections |
| Saved cards | Still blocked by Connect direct-charge architecture unless per-venue SetupIntent work is done |

## Intentionally not in this MVP

- Venue credit packs / balances UI  
- Memberships, course bundles, recurring bookings  
- Platform-wide saved payment methods  

## Verification

- `npx tsc --noEmit`
- `npm test` (Vitest)
