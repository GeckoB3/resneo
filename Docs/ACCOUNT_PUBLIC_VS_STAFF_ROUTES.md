# Account-related booking routes (public vs staff)

Short reference for `require_account_login_for_bookings` and silent auth signup.

**Last verified against the code: 2026-08-26.**

**The venue flag is the only gate on the three public create routes, and it defaults to off.** All three call the single helper `nextResponseIfVenueRequiresAccountLoginForBooking` (`src/lib/booking/require-account-login-for-public-booking.ts:8`), whose first line is `if (!params.requireAccountLogin) return null;`. `venues.require_account_login_for_bookings` defaults to `false` (`src/app/dashboard/settings/sections/RequireAccountLoginSection.tsx:21`). So when a venue has not turned it on, `create`, `create-group` and `create-multi-service` are all reachable without a session. Treat all three as anonymous write endpoints when enumerating attack surface.

> Corrected 2026-08-26. This table previously claimed `create-group` and `create-multi-service` "always require" a signed-in user. That was never true of the shipped code: the flag-conditional helper landed in `c7dd7bfc` (2026-04-29) and neither route has any other auth call.

**Related:** for admin vs calendar-scoped-staff permissions on venue mutation routes, see [`api-venue-permissions-matrix.md`](api-venue-permissions-matrix.md).

## Public guest-facing (widget / online / booking_page)

| Route | Notes |
| --- | --- |
| `POST /api/booking/create` | Primary public booking API. Uses `findOrCreateGuest` with `silentAuthSignup` for online-like sources. **Enforces** `venues.require_account_login_for_bookings`. |
| `POST /api/booking/create-group` | Group appointments. Identical to `create`: `findOrCreateGuest` with `silentAuthSignup` for online-like sources, and **enforces** `venues.require_account_login_for_bookings` through the same helper (`route.ts:205`). **Anonymous-reachable when that venue flag is off, which is the default.** |
| `POST /api/booking/create-multi-service` | Same as `create-group` (`route.ts:209`). **Anonymous-reachable when the venue flag is off.** |
| `POST /api/booking/waitlist` | Public waitlist join. Inserts `waitlist_entries` only (no `guests` row yet). **Does not** enforce venue login flag (Section 7.2: waitlist is no-session). |

## Staff / dashboard (venue session)

| Route | Notes |
| --- | --- |
| `POST /api/venue/bookings` | Staff-created bookings. Uses `findOrCreateGuest` with `silentAuthSignup` when an email is present so the guest can be linked to auth for comms. **Does not** apply public `require_account_login_for_bookings` (guest is not booking through their own session). |

## Staff waitlist conversion

| Route | Notes |
| --- | --- |
| `PATCH /api/venue/waitlist` | When confirming a waitlist entry, creates a booking via `findOrCreateGuest` with `silentAuthSignup` if email exists. Staff-only. **Does not** apply the venue public-login flag. |
