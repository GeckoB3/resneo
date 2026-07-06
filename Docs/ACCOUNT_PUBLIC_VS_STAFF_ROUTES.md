# Account-related booking routes (public vs staff)

Short reference for `require_account_login_for_bookings` and silent auth signup.

**Related:** for admin vs calendar-scoped-staff permissions on venue mutation routes, see [`api-venue-permissions-matrix.md`](api-venue-permissions-matrix.md).

## Public guest-facing (widget / online / booking_page)

| Route | Notes |
| --- | --- |
| `POST /api/booking/create` | Primary public booking API. Uses `findOrCreateGuest` with `silentAuthSignup` for online-like sources. **Enforces** `venues.require_account_login_for_bookings`. |
| `POST /api/booking/create-group` | Group appointments. **Always requires** a signed-in user and matching booking email today. Venue login flag is redundant but consistent with account-first flows. |
| `POST /api/booking/create-multi-service` | Same as create-group: **always signed-in**. |
| `POST /api/booking/waitlist` | Public waitlist join. Inserts `waitlist_entries` only (no `guests` row yet). **Does not** enforce venue login flag (Section 7.2: waitlist is no-session). |

## Staff / dashboard (venue session)

| Route | Notes |
| --- | --- |
| `POST /api/venue/bookings` | Staff-created bookings. Uses `findOrCreateGuest` with `silentAuthSignup` when an email is present so the guest can be linked to auth for comms. **Does not** apply public `require_account_login_for_bookings` (guest is not booking through their own session). |

## Staff waitlist conversion

| Route | Notes |
| --- | --- |
| `PATCH /api/venue/waitlist` | When confirming a waitlist entry, creates a booking via `findOrCreateGuest` with `silentAuthSignup` if email exists. Staff-only. **Does not** apply the venue public-login flag. |
