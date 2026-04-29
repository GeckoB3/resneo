# ReserveNI — User Accounts: Implementation Reference

**Status:** Living reference — aligned with current MVP implementation where noted
**Owner:** Andrew
**Last updated:** 29 April 2026
**Purpose:** This is the canonical reference document for how user accounts work in ReserveNI. It is intended for use in Cursor as a long-running context document. When implementing any feature that touches users, customers, authentication, or booking identity, this document is the source of truth.

---

## 0. How to use this document in Cursor

When working on any feature that touches user accounts, paste the relevant section of this document into the Cursor agent prompt as context. Reference specific section numbers (e.g. "implement Section 4.2 — magic link login flow") to keep the agent focused.

**Do not let the agent deviate from the architectural decisions in this document without explicit approval.** If the agent suggests an alternative approach, evaluate it against the principles in Section 1 first. If a deviation is genuinely better, update this document, then implement the change. Code and spec must stay in sync.

When in doubt, the rule is: **build the foundation as if the consumer app is launching tomorrow, even though it isn't.**

---

## 1. Founding principles

These are the non-negotiable principles that drive every decision in this document. If you find yourself implementing something that violates one of these, stop and reconsider.

**1.1 Every customer is a user, even before they "create an account".**
The moment a customer makes any booking on the platform — restaurant reservation, hair appointment, yoga class, anything — a permanent user record is created in the auth system using their email address. They have not set a password. They have not verified their email. But they exist as a user.

Online account-linked bookings require an email address. Legacy imports, walk-ins, phone-only records, and anonymous placeholders may remain as unlinked `guests` rows with `user_id = null` until enough identity is supplied. Do not force a fake email address just to satisfy the account model.

**1.2 The booking is the signup. There is no separate signup flow.**
Customers never see a "create an account" form. They see a booking form. The account is a silent consequence of booking. The first time they actively log in (via magic link from a booking confirmation email), the account becomes "claimed" — email verified, fully usable.

**1.3 Customer identity is unified across the platform; customer relationships are scoped to each venue.**
There is one ReserveNI user per real person, identified by email. That user has separate `guests` records at each venue they've booked with. In earlier planning these were called `customer_records`; in the current codebase the existing `guests` table is the venue-scoped customer record and should be evolved rather than duplicated. A user's notes at their hairdresser are never visible to their yoga studio. But their identity, login, saved cards, and unified booking history are platform-wide.

**1.4 Authentication uses Supabase JWTs as the auth primitive.**
The same underlying authentication mechanism must work on the web today and on iOS/Android tomorrow. Supabase-issued JWT access tokens are the primitive. On the web, the current Next.js/Supabase SSR integration may store and refresh the session via secure httpOnly cookies; on mobile, tokens will live in platform secure storage. API routes that need explicit mobile compatibility should accept `Authorization: Bearer <access_token>` as well as the existing web session cookie.

**1.5 The consumer-facing nudge is the booking confirmation email, not in-app prompts.**
Every booking confirmation email contains a "Manage all your bookings on ReserveNI" magic link. This is the *only* nudge to claim the account. No in-app banners, no progressive prompts, no "hey, want to set a password?" modals. The user discovers the benefit of having an account through repeated use; the email is what makes that path frictionless.

**1.6 Login is via email magic link only.**
No SMS-based login. No social logins for now (may add later). No password is required to use the account, ever — but users may optionally set one for faster future logins.

**1.7 Some actions require an authenticated session; most don't.**
Single bookings (drop-in classes, restaurant reservations, individual appointments) work without an active login session — the `guests` row exists, but the user doesn't need to be logged in to make that booking. **Relationship-creating actions** (credits, courses, memberships, multi-bookings, recurring bookings, profile changes, payment method management) require the user to be logged in via magic link first.

**1.8 Every booking confirmation has a tokenised management link, separate from account login.**
Each booking confirmation email includes two distinct links: (a) a tokenised "Manage this booking" link that works without login, scoped to that one booking, and (b) the account login magic link that grants access to all bookings across the platform.

**1.9 No money in floats. Ever.**
All monetary values are integer minor units (pence). All values include a currency code. Never use JavaScript floats for money calculations. This rule has no exceptions.

**1.10 All application timestamps are ISO 8601 with timezone offset.**
Format: `2026-05-12T19:00:00+01:00`. Never naive timestamps (`2026-05-12T19:00:00`). Never Unix epoch in API payloads or application storage. Database column type is `timestamptz`; PostgreSQL may display these in UTC depending on client settings. The `user_profiles.timezone` field stores the user's preferred display timezone.

---

## 2. Data model

The data model is the foundation. Get this right and everything else follows.

### 2.1 Tables

```sql
-- Managed by Supabase Auth
auth.users
  - id (uuid, pk)
  - email (citext, unique)
  - encrypted_password (nullable -- NULL when user hasn't set a password)
  - email_confirmed_at (nullable -- NULL until first magic link click)
  - phone (nullable, not used for auth)
  - last_sign_in_at
  - created_at, updated_at
  -- Other Supabase-managed fields

-- Application-level user data
public.user_profiles
  - id (uuid, pk, fk to auth.users.id ON DELETE CASCADE)
  - display_name (text, nullable -- current booking forms collect a single name)
  - first_name (text, nullable)
  - last_name (text, nullable)
  - phone (text, nullable -- E.164 format e.g. +447700900123)
  - profile_image_url (text, nullable)
  - locale (text, default 'en-GB')
  - timezone (text, default 'Europe/London')
  - notification_preferences (jsonb, default '{}')
  - default_login_destination (text, nullable -- 'account', 'dashboard', or 'ask')
  - stripe_customer_id (text, nullable)
  - account_claimed_at (timestamptz, nullable -- set when user first verifies via magic link)
  - last_active_at (timestamptz)
  - deleted_at (timestamptz, nullable -- soft deletion for GDPR)
  - created_at, updated_at

-- Devices for push notifications (future mobile app)
public.user_devices
  - id (uuid, pk)
  - user_id (uuid, fk to auth.users.id ON DELETE CASCADE)
  - platform (text, not null -- 'ios', 'android', 'web')
  - push_token (text, nullable)
  - device_name (text, nullable)
  - app_version (text, nullable)
  - os_version (text, nullable)
  - last_seen_at (timestamptz)
  - created_at
  - UNIQUE (user_id, push_token)

-- The bridge between platform users and individual venues.
-- Existing table: evolve public.guests; do not create a duplicate customer_records table.
public.guests
  - id (uuid, pk)
  - venue_id (uuid, fk to venues.id ON DELETE CASCADE)
  - user_id (uuid, fk to auth.users.id ON DELETE SET NULL)
  - email (text/citext, nullable -- required for account-linked guests; legacy/walk-in rows may be null)
  - phone (text, nullable)
  - name (text, nullable -- current table shape; split into first/last only if the UI needs it)
  - customer_profile_notes (text, nullable -- venue-private notes about this customer)
  - tags (text[], default '{}' -- e.g. 'vip', 'regular', 'allergy:nuts')
  - no_show_count (int, default 0 -- no-show tracking, scoped to this venue)
  - visit_count (int, default 0)
  - global_guest_hash (text, nullable -- existing legacy/cross-venue matching aid)
  - identifiability_tier (generated text -- existing directory/filtering helper)
  - custom_fields (jsonb, default '{}' -- import-defined venue fields)
  - waiver_signed_at (timestamptz, nullable)
  - waiver_version (text, nullable -- which version they signed)
  - marketing_consent (boolean, default false -- per-venue GDPR/PECR consent)
  - marketing_consent_at (timestamptz, nullable)
  - marketing_opt_out (boolean, default false -- existing inverse preference; migrate carefully)
  - source (text -- 'self_booked', 'admin_added', 'imported')
  - first_booked_at (timestamptz)
  - last_booked_at (timestamptz)
  - total_bookings_count (int, default 0)
  - total_spent_minor (bigint, default 0)
  - created_at, updated_at
  - UNIQUE (venue_id, email)
  - INDEX (email)
  - INDEX (user_id, venue_id)
  - INDEX (venue_id, last_booked_at DESC)

-- Venue staff roles.
-- Existing table: evolve public.staff; do not create a parallel business_roles table.
public.staff
  - id (uuid, pk)
  - venue_id (uuid, fk to venues.id ON DELETE CASCADE)
  - user_id (uuid, nullable, fk to auth.users.id ON DELETE CASCADE)
  - email (text, not null -- retained for existing invite/login compatibility)
  - name (text, nullable)
  - role (text, not null -- current roles: 'admin', 'staff')
  - permissions (jsonb, default '{}' -- future granular overrides)
  - invited_at (timestamptz, nullable)
  - accepted_at (timestamptz, nullable)
  - revoked_at (timestamptz, nullable)
  - created_at, updated_at
  - UNIQUE (user_id, venue_id, role) WHERE revoked_at IS NULL
  - INDEX (user_id) WHERE revoked_at IS NULL
  - INDEX (venue_id, role) WHERE revoked_at IS NULL
```

**Important migration note:** The current production schema already has `public.guests`, `bookings.guest_id`, communications linked to `guest_id`, imports linked to `guest_id`, and dashboard/customer-profile features built around `guests`. Implement this plan by adding the missing account fields to `guests` and refactoring the existing matching service. Do **not** introduce a parallel `customer_records` table unless the whole booking/reporting/import/dashboard surface is deliberately migrated.

**Staff role migration note:** The current production schema already has `public.staff` and dashboard auth helpers that resolve venue access from staff email. Implement staff/customer overlap by adding `staff.user_id`, soft-revocation fields, and optional permission metadata to `staff`. Do **not** introduce a separate `business_roles` table unless the dashboard auth surface is deliberately migrated to a new role table. If a future abstraction is needed, name it `venue_roles`, not `business_roles`, to match ReserveNI's schema language.

### 2.2 Key design decisions

`**auth.users.encrypted_password` is nullable.**
Supabase Auth supports passwordless users natively. A user created during a booking has no password until they choose to set one. They authenticate via magic link.

`**auth.users.email_confirmed_at` is set on first magic link click.**
Until the first successful magic link login, the email is unverified. The `account_claimed_at` field on `user_profiles` mirrors this and is the application-level signal that the user has actively engaged.

`**guests.user_id` is nullable.**
This handles the rare case where a venue-scoped guest record exists but the auth user creation failed transiently. Under normal operation, every online booking with an email creates both. The nullable field also supports imported/admin-added records that don't yet have an associated user.

`**guests.email` should be populated for account-linked customers.**
For online bookings that participate in silent signup, email is required and normalised. Walk-ins or legacy/imported records may still have phone-only or anonymous guest rows; these can remain `user_id = null` until enough identity is supplied. When a user changes their email, linked `guests.email` values are updated through an explicit conflict-safe service or an `auth.users` update trigger. Never rely on joining through `auth.users` for the customer email in venue workflows — it is slow and creates RLS complications.

`**UNIQUE (venue_id, email)` is the most important constraint in the schema.**
Within a single venue, an email maps to exactly one identified guest record. This is what makes the customer matching service deterministic. Do not violate this constraint. Do not work around it.

**Stripe customer ID lives on `user_profiles`, not `guests`.**
One Stripe Customer per user, platform-wide. Saved cards are user-level. Charges are routed via Stripe Connect to the right venue at transaction time.

**Stripe Connect + saved cards (current conclusion):** Deposits use **direct charges** on the venue’s **connected account** (`stripe.paymentIntents.`* with `{ stripeAccount }` — see booking pay/create routes). A PaymentMethod or Customer created on the **platform** account cannot be attached to PaymentIntents on arbitrary connected accounts without cloning or per-account SetupIntents. Therefore `**user_profiles.stripe_customer_id` alone is not sufficient** for “save once, charge many venues” until one of: (a) per–connected-account Customer + PaymentMethod storage keyed by `(user_id, stripe_connected_account_id)`, (b) shared-token / destination-charge architecture, or (c) another Stripe-supported pattern explicitly chosen and documented. Until that architecture is implemented, saved-card UI remains disabled; see `/api/account/payment-methods` response for the machine-readable blocker.

**Staff roles and customer relationships are independent.**
A user may be staff/admin at one venue and a customer at another venue, or even a customer at their own venue. Staff access lives in `staff`; customer history lives in `guests`. Never infer one from the other. A venue viewing a `guests` record must not see that person's staff/admin roles at other venues.

### 2.3 Row Level Security (RLS) policies

All tables must have RLS enabled. Here are the core policies — adapt as needed:

`**user_profiles`**

- Users can SELECT/UPDATE their own profile only (`id = auth.uid()`).
- Service role bypasses for admin operations.
- Venue staff cannot read user_profiles directly — they read `guests`.

`**user_devices`**

- Users can SELECT/INSERT/UPDATE/DELETE only their own devices.
- Service role bypasses.

`**guests`**

- Users can access their own venue-scoped customer relationships where `user_id = auth.uid()` for account dashboard features, but not by exposing raw `guests` rows wholesale.
- Account-facing reads should use a safe view/RPC/API projection that excludes venue-private fields such as `customer_profile_notes`, staff-only tags, no-show counts, and import/custom fields unless a field is explicitly intended for customer visibility.
- Venue staff can SELECT/INSERT/UPDATE `guests` where `venue_id` is in their permitted venues (existing staff-by-email policies can continue, but account-facing policies must also support `user_id`).
- Marketing-consent-required actions require `marketing_consent = true` AND a recent `marketing_consent_at`.

`**staff`**

- Venue staff can SELECT their own active staff rows.
- Venue admins can SELECT/INSERT/UPDATE staff rows for their venue.
- `revoked_at IS NULL` is required for active dashboard access.
- During migration, email-based staff policies may continue for compatibility, but new account-aware checks should prefer `staff.user_id = auth.uid()` when available.

`**auth.users`**

- Managed by Supabase. Don't write custom RLS here.

### 2.4 Triggers

**On `auth.users` INSERT:** Create a corresponding `user_profiles` row. Capture name from `raw_user_meta_data` if present.

**On email change:** Email lives in `auth.users`, not `user_profiles`. Handle email changes through an explicit service or an `auth.users` UPDATE trigger. Before changing linked `guests.email`, check for `(venue_id, new_email)` conflicts and either block the change with a clear error or require a deliberate merge workflow.

**MVP implementation (current codebase):** `POST /api/v1/me/email/change` uses the service role to call `guest_email_collides_for_user_change(p_email text, p_user_id uuid)`, which returns true when any `guests` row already has that email with a different `user_id` (protecting `(venue_id, email)` uniqueness and avoiding silent merges). It then calls `supabase.auth.updateUser({ email })` (Supabase verification email as configured). After Auth applies the new email, the trigger `sync_guests_email_after_auth_email_change` on `auth.users` updates `guests.email` for rows where `user_id = NEW.id` to match `NEW.email`.

**On `guests` INSERT or UPDATE:** Recalculate `total_bookings_count` and `total_spent_minor` from booking tables. (Or maintain via separate triggers on booking tables — choose one approach and stick to it.)

---

## 3. The customer matching service

This is the keystone of the architecture. Every booking flows through this service. Get it right.

In the current codebase, this service starts as `findOrCreateGuest()` in `src/lib/guests.ts`. Implement this plan by refactoring/evolving that function into the account-aware matcher. Do not create a second matcher beside it.

### 3.1 Inputs

A booking attempt provides:

- `venue_id` (required)
- `email` (required, normalised to lowercase)
- `name`, `phone` (required for new account-linked booking records, optional for matching)

### 3.2 Algorithm

```
function matchOrCreateGuest(venue_id, email, name, phone):
    email = lowercase(trim(email))

    // Step 1: Find or create auth user for this email
    auth_user = lookup auth user by email
    // Supabase Admin has no direct getUserByEmail helper in every client version.
    // Use the safest available repo pattern or a server-side SQL/RPC lookup.

    if auth_user does not exist:
        auth_user = supabase.auth.admin.createUser({
            email: email,
            email_confirm: false,         // unverified until first magic link click
            // omit password; user is passwordless until they set one
            user_metadata: { name }
        })
        // user_profiles row is auto-created by the trigger in 2.4

    // Step 2: Find or create guest record at this venue
    record = SELECT * FROM guests
             WHERE venue_id = $1 AND email = $2

    if record does not exist:
        record = INSERT INTO guests (
            venue_id, user_id, email, name, phone,
            source, first_booked_at
        ) VALUES (
            $venue_id, $auth_user.id, $email, $name, $phone,
            'self_booked', now()
        )
    else:
        // Existing record — update if user_id was null
        if record.user_id IS NULL:
            UPDATE guests SET user_id = $auth_user.id WHERE id = $record.id

        // Optionally update name/phone only if currently empty
        // Do NOT overwrite existing populated fields — the venue's customer record is authoritative
        // If the submitted name differs significantly, flag for staff review instead of overwriting

    return record
```

The existing `findOrCreateGuest()` currently also matches by phone and may update populated fields. That is useful for legacy/venue workflows, but account-linked booking should prefer deterministic email matching. Preserve phone matching only for flows that do not have an email, and be careful not to link a phone-only guest to the wrong platform user.

### 3.3 Edge cases to handle

**Same email, different name on a new booking.**
A guest record at this venue already exists for `andrew@example.com` with name "Andrew Smith". A new booking comes in with the same email but name "Andy Smith". Do NOT overwrite the name — the venue's existing record is authoritative. Add a flag/note for the staff to review if names differ significantly.

**Email change at the auth.users level.**
When a logged-in user changes their email, the change must cascade to linked `guests.email`. Crucially, this might collide with an existing record at the same venue under the new email. Handle this with a conflict check before the update.

**A customer who has booked at multiple venues claims their account.**
When a user clicks a magic link and verifies their email for the first time, all `guests` rows with that email across the platform should already be linked to their `user_id` (because matching happened at booking time). No special action needed beyond setting `account_claimed_at` — the linking is eager, not lazy.

**Admin manually adds a customer at a venue.**
The admin enters name, email, phone in the venue dashboard. Same algorithm runs — a passwordless auth user is created if not already existing, and the guest record is linked. The customer doesn't yet know about the account; they'll discover it via the next booking confirmation email or via an explicit "claim" invite from the venue.

---

## 4. Authentication flows

### 4.1 The "first booking" flow (no login required)

This is the most common entry point. The user has never used ReserveNI before.

1. Customer visits a venue's booking page (e.g. yoga studio's class schedule).
2. Selects a class, clicks "Book".
3. Fills in: name, email, phone, payment details.
4. Submits.
5. **Server-side:**
  - `matchOrCreateGuest()` runs (Section 3.2).
  - Booking is created and linked to the `guests` row via `bookings.guest_id`.
  - Payment is processed via Stripe.
6. **Confirmation email** is sent (Section 5).
7. The user is **not** logged in. They have no active session. But an auth user exists for them.

### 4.2 Magic link login flow

This is the only login flow. Triggered by clicking the "Manage all your bookings" link in any booking confirmation email, or by visiting `/login` directly.

1. User lands on `/login` and enters email, OR clicks magic link in email (which already has email embedded).
2. Server requests a Supabase magic link. The current branded-email implementation uses `admin.auth.admin.generateLink()` and sends the link through SendGrid via `/api/auth/send-magic-link`; browser fallback may use `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '...' } })`.
3. Supabase issues a single-use token.
4. User clicks the link. Lands on `/auth/callback`.
5. Supabase verifies the token, sets `email_confirmed_at` on the auth.users row.
6. **Post-auth account claim step:** Set `account_claimed_at = now()` on `user_profiles` if it was null.
7. Session cookie/token issued. User is logged in.
8. Redirect to `/account` (or to a deep-linked destination if specified in the original email link).

The current app has two magic-link paths: server-side `/auth/confirm` for generated links and client-side `/auth/callback` for PKCE fallback. The account-claim step must run after both successful flows. A small authenticated endpoint such as `POST /api/auth/account-claimed` is acceptable if it is called immediately after the browser callback exchanges the code.

### 4.3 Returning user flow

1. User visits `/login`, enters email.
2. Supabase sends magic link.
3. User clicks link, is logged in.
4. Lands on `/account` showing all their bookings, credits, memberships across all venues.

### 4.4 Optional password setup

**This is not promoted in-flow. It's available in account settings only.**

1. Logged-in user visits `/account/security`.
2. Sees a "Set a password for faster login" option.
3. Enters a password, submits.
4. Server calls `supabase.auth.updateUser({ password })`.
5. From now on, user can log in with email + password OR with magic link. Both work.

### 4.5 Session management

**Access token lifetime:** 1 hour (Supabase default).
**Refresh token lifetime:** 30 days (Supabase default).
**Refresh token rotation:** On every refresh, issue new refresh token, invalidate old.
**Storage on web:** Supabase SSR manages secure cookies for the web session. Treat the JWT access token as the auth primitive, but do not rewrite the web app away from Supabase SSR cookies just for this feature.
**Storage on mobile (future):** Both tokens in platform secure storage (Keychain/Keystore).

### 4.6 "Sign out everywhere" flow

1. User visits `/account/security` and clicks "Sign out from all devices".
2. Server calls `supabase.auth.signOut({ scope: 'global' })`.
3. All refresh tokens invalidated. All sessions across all devices terminated.
4. User is signed out on this device too. Redirected to homepage.

### 4.7 Account deletion flow

Required for App Store compliance when mobile app launches.

1. User visits `/account/security` and clicks "Delete my account".
2. Confirmation modal: must type `DELETE MY ACCOUNT` to confirm.
3. Server marks `user_profiles.deleted_at = now() + 30 days`.
4. PII in linked `guests` records is anonymised: name → "Deleted User", email → `deleted-{user_id}-{guest_id}@reserveni.deleted` (one distinct placeholder per `guests` row so `(venue_id, email)` uniqueness is preserved), phone → null.
5. Bookings are retained (venues have legitimate operational interest).
6. User is signed out everywhere.
7. Confirmation email sent: "Your account will be permanently deleted on [date]. To cancel, click here."
8. Background job at the 30-day mark hard-deletes the auth.users row.

---

## 5. Booking confirmation emails

Every booking, regardless of model, sends a confirmation email. The email is the entire user-facing "create an account" mechanism — there are no other prompts.

### 5.1 Required components

Every confirmation email must contain:

1. **Booking details** — what, when, where, how much.
2. **The "Manage this booking" link** — tokenised, scoped to this one booking, no login required. Used for cancel/reschedule/view.
3. **The "Manage all your bookings on ReserveNI" link** — magic link login, grants access to the user's full account across all venues.
4. **Venue contact details.**
5. **Cancellation policy in plain text.**

### 5.2 The "Manage this booking" link

**Canonical (MVP): v2 HMAC short links** — compact URLs that preserve SMS/email character budgets, reuse the existing `PAYMENT_TOKEN_SECRET` HMAC infrastructure, carry explicit expiry, and avoid separate JWT signing/rotation machinery.

Format (implemented in `src/lib/short-manage-link.ts`):

```
https://{public_host}/m/v2.{base64url_payload}.{base64url_signature}
```

The `base64url_payload` decodes to JSON:

- `v` — literal `2`
- `bid` — `booking_id` (UUID)
- `exp` — Unix seconds; links after this time are rejected

The trailing signature is an 18-character base64url prefix of `HMAC-SHA256(secret, "manage2:" + payload)`.

Verifying the segment grants access to that one booking only. The user is NOT logged in via this link — it's a scoped capability token, not an authentication.

**Legacy v1** stateless links used the shape `/m/{payload}.{signature}` (16-byte booking id encoding + 12-char HMAC). They remain accepted only until **2026-08-01 00:00:00 UTC** (`LEGACY_MANAGE_LINK_ACCEPT_UNTIL_MS` in code); after that cutoff only v2 links verify.

If the user wants to do anything beyond what the token allows (see other bookings, buy credits, etc.), they're prompted to log in via the standard magic link flow.

**Optional future:** scoped JWT query tokens (e.g. `?token=`) remain a valid alternative if product needs ever outgrow the HMAC format. Do not ship JWT and HMAC as *parallel primary* schemes without a documented migration; the MVP standard is v2 HMAC as above.

**Stable API alias:** `POST /api/v1/manage-booking/verify` accepts the raw path segment (the part after `/m/`) as `token` and returns `{ booking_id }` for mobile/clients that prefer JSON over redirects — see Section 11.5.

### 5.3 The "Manage all your bookings on ReserveNI" link

Format:

```
https://reserveni.com/auth/magic?email={email}&context=customer&redirect=/account
```

Clicking this triggers a fresh magic link send to the user's email. They click that, log in, and land on their account dashboard.

The `context` value is a routing hint, not an authorisation claim. Booking confirmation emails always use `context=customer`; staff invitation emails use `context=dashboard`; direct visits to `/login` may omit context.

**Why two emails?** Because the original confirmation email might be days or weeks old by the time they want to log in. Magic link tokens are short-lived (1 hour). The "Manage all your bookings" link is really a "send me a fresh login link" link.

Alternative implementation (lower friction): the original email could contain a magic link with a longer expiry (e.g. 7 days) for first-time login. Acceptable for the very first booking; not for subsequent bookings.

### 5.4 Tone of the call to action

The "Manage all your bookings" CTA should not be aggressive. It's a soft offer, not a sales pitch.

**Good:**

> Want to see all your bookings in one place? [Sign in to ReserveNI →]

**Avoid:**

> Create your free ReserveNI account now to unlock features!

The user is already a customer. They already have an account. The phrasing must reflect this.

---

## 6. The "Manage Booking" page (no-login flow)

When a user clicks the tokenised "Manage this booking" link, they land on a page that:

1. Verifies the token.
2. Shows the booking details.
3. Offers actions allowed by the token (typically: view, cancel, reschedule).
4. Has a footer link: "See all your bookings? [Sign in to ReserveNI]".

The sign-in link starts a magic link flow. After login, they're returned to this same booking but now with the full account context (can see other bookings, buy credits, etc.).

---

## 7. Authorisation: when login is required

Operations are split into three tiers.

### 7.1 Public (no auth required)

- Browsing venues, classes, schedules, prices
- Reading reviews
- Viewing public venue profiles

### 7.2 Booking-flow auth (no active session needed)

These operations create or link a `guests` row and silent auth user, but don't require an active login:

- Booking a single class drop-in (paid or free)
- Booking a single appointment
- Making a restaurant reservation
- Booking a single event ticket
- Booking a single facility/resource
- Joining a waitlist

The user provides email + name + phone as part of the booking. Customer matching service runs. Booking is created.

### 7.3 Authenticated session required

These operations require the user to be currently logged in via magic link:

- Buying a credit pack
- Enrolling in a course bundle
- Starting a membership/subscription
- Multi-booking transactions (booking 2+ sessions in one go)
- Setting up recurring/standing reservations
- Modifying or cancelling a membership
- Adding/removing payment methods
- Updating profile information
- Viewing other bookings (beyond the one in the tokenised link)
- Writing reviews (when implemented)
- Account deletion

When an unauthenticated user attempts one of these, they see a magic link login prompt. After authentication, they're returned to the original action.

### 7.4 Per-venue override

Each venue has a setting in their dashboard:

> **Require account login for all bookings**
> When enabled, customers must be logged in to ReserveNI to book any class, appointment, or service. New customers will be prompted to sign in via magic link before booking.

Default: **off**. Most venues get the lower-friction Section 7.2 flow. Studios with strict customer tracking needs (waiver compliance, no-show enforcement) can opt in.

When enabled, the booking flow becomes:

1. Customer clicks "Book"
2. If not authenticated → magic link prompt
3. After login → standard booking flow

### 7.5 Staff and customer role overlap

A single `auth.users` row may simultaneously be a customer and hold staff/admin roles at one or more venues. This is expected. Venue owners, practitioners, and staff will often book with other ReserveNI venues. Do not create separate staff and customer accounts for the same real person.

The architecture is:

- **Identity is unified.** One `auth.users` row per real person, identified by email.
- **Roles are venue-scoped.** Staff/admin access is represented by active `staff` rows linked to `auth.users.id` where possible.
- **Customer relationships are venue-scoped.** Customer history, notes, tags, marketing consent, visits, and no-shows live in `guests`.
- **Surfaces are separate.** `/account/`* is the customer portal. `/dashboard/`* is the venue staff dashboard. They share authentication but remain separate mental and product contexts.

Post-login routing follows these rules:

1. **Explicit destination wins.** If a magic link or login request includes a safe `redirect`/`redirectTo` destination, honour it. A booking email that points to `/account/bookings/{id}` must not send a venue owner to `/dashboard`.
2. **Context hint breaks ties.** `context=customer` prefers `/account`; `context=dashboard` prefers `/dashboard` if the user has an active staff role.
3. **No staff roles defaults to account.** A user with no active `staff` rows lands on `/account`.
4. **Staff roles with no explicit destination should ask or use preference.** If a user has one or more active staff roles and no explicit destination, send them to a "Where would you like to go?" chooser unless `user_profiles.default_login_destination` is set to `account` or `dashboard`.
5. **Multiple venues require explicit venue selection.** Do not implicitly choose the first staff row when a user has active staff roles at multiple venues. Ask them which venue dashboard they want, or use a remembered venue preference if one is added later.

Both surfaces need a context switcher:

- In `/account`, users with active staff roles can switch to each permitted venue dashboard.
- In `/dashboard`, users can switch to "My account" and, if applicable, other venue dashboards.
- Switching context never requires re-authentication; API permission checks decide what the user can actually access.

Permissions are enforced at the API layer, not by URL alone. A user may navigate to `/dashboard`, but every dashboard API route must verify an active staff row for the requested venue. If access is missing, return 403 or redirect to `/account` with a clear message.

Privacy rule: staff context at one venue must never be exposed to another venue where the person is only a customer. A dentist viewing a guest must not see that the guest owns a salon elsewhere on ReserveNI.

Redirect safety rule: `redirect`, `redirectTo`, and equivalent magic-link destination parameters must be same-origin, path-only, and allowlisted with the existing safe redirect helpers. Never let account or dashboard login links become open redirects.

---

## 8. The Account Dashboard

Located at `/account`. The single place where users manage their identity and see their unified booking history.

### 8.1 Sections

- **My Bookings** — upcoming and past, across all venues, all models. Filterable by status and venue.
- **My Credits** — credit packs at each venue, with expiry warnings.
- **My Memberships** — active subscriptions, with pause/cancel options.
- **My Payment Methods** — saved cards via Stripe (MVP: gated until Connect direct-charge customer/PM scoping is implemented — Section 2.2).
- **Profile** — name, phone, profile image, locale, timezone, notification preferences.
- **Security** — set/change password, sign out everywhere, delete account.

**MVP sequencing:** Ship **saved cards** before building transactional surfaces for credits, memberships, courses, or recurring bookings. Until then, **My Credits** / **My Memberships** (and similar) may appear as empty or disabled sections rather than implying live purchase flows.

### 8.2 Empty states

For new users (first login), the dashboard might show only one booking. The empty states should:

- Not feel barren ("Your future bookings will appear here").
- Not advertise unrelated venues (no cross-promotion until the consumer app exists).
- Direct the user back to the venue they originally booked with if they want to book again.

---

## 9. Per-venue marketing consent

GDPR-correct handling.

### 9.1 At booking time

The booking form has an unticked checkbox:

> [ ] I'd like to receive marketing emails from {Business Name} about offers and events.

If ticked, `guests.marketing_consent = true` and `marketing_consent_at = now()` for that venue-scoped guest row.

### 9.2 What this consent grants

- Marketing emails from this specific venue only.
- Does NOT grant consent to ReserveNI platform marketing.
- Does NOT grant consent to other venues on ReserveNI.

### 9.3 What does not require consent (operational)

- Booking confirmations
- Booking reminders
- Cancellation notifications
- Membership renewal notices
- Credit expiry warnings
- Account security notifications (password changes, login alerts)

These are operational, not marketing, under GDPR. The lawful basis is contract performance, not consent.

### 9.4 Withdrawal

Every marketing email must contain an unsubscribe link that sets `marketing_consent = false` for that specific (user, venue) pair. The user can also manage all marketing consents in `/account/profile`.

---

## 10. Implementation sequencing

Build in this order. Do not skip ahead.

### Phase 1: Foundation (do this first, before any user-facing changes)

1. Add `user_profiles` table with all fields from Section 2.1.
2. Add `user_devices` table (even though web doesn't use push tokens — schema is forward-compatible).
3. Add the missing account-linkage fields to `guests`: `user_id`, consent timestamps, booking totals, and any other Section 2.1 fields not already present.
4. Add the missing account-linkage fields to `staff`: `user_id`, `accepted_at`, `revoked_at`, and optional `permissions`.
5. Add the `account_claimed_at`, `last_active_at`, `deleted_at`, and `default_login_destination` fields to `user_profiles`.
6. Add Supabase trigger to create `user_profiles` row on `auth.users` insert.
7. Implement RLS policies (Section 2.3), preserving existing staff venue policies while adding user-facing policies.
8. Backfill `staff.user_id` from `auth.users.email` where possible. Keep email-based lookup during migration, but prefer `user_id` for new checks.
9. Refactor `findOrCreateGuest()` into the account-aware `matchOrCreateGuest()` service (Section 3.2). This remains the backend function called by every booking endpoint.
10. Refactor existing booking flows (appointments, restaurants, classes, events, resources) to call the updated matching service. The user-facing UX doesn't change yet — just the backend now creates auth users silently.
11. Verify existing identified guests have been migrated: every `guests` row with a valid email should have a `user_id` where possible. Run a one-off migration script if needed, leaving anonymous/phone-only records unlinked.

### Phase 2: Login and account dashboard

1. Build `/login` page with magic link flow.
2. Build/extend `/auth/callback` and `/auth/confirm` to handle magic link verification and the account-claim step.
3. Build post-login routing from Section 7.5: explicit destination first, then context hint, then preference/chooser.
4. Build the "Where would you like to go?" chooser for users with both account and staff contexts.
5. Build `/account` dashboard skeleton with sections from 8.1.
6. Add context switcher entry points between `/account` and permitted `/dashboard` venues.
7. Update booking confirmation emails to include the "Manage all your bookings" link (Section 5).
8. Build `/account/security` with set-password, sign-out-everywhere, delete-account flows.
9. Test end-to-end: book → receive email → click magic link → see booking in account dashboard.

### Phase 3: Tokenised booking management

1. **Done (MVP):** v2 HMAC `/m/v2.{payload}.{sig}` links (Section 5.2) with legacy v1 cutoff; verification helpers and `/api/v1/manage-booking/`* aliases in the codebase.
2. Optional later: evaluate scoped JWT links only if product requirements exceed the HMAC format.
3. Ensure the guest-facing manage page and emails use the canonical v2 links; keep actions (view/cancel/reschedule) within the policy implied by the manage surface.
4. Update confirmation emails to include the scoped manage link (Section 5.2).

### Phase 4: Class-specific features

1. **Done (MVP wiring):** per-venue **Require account login for bookings** (`venues.require_account_login_for_bookings`) in dashboard Settings (profile tab) and enforced in booking create when enabled.
2. Build credit packs purchase flow (requires login per Section 7.3).
3. Build course enrolment flow (requires login).
4. Build membership subscription flow (requires login via Stripe Subscriptions + Connect).
5. Build "My Credits", "My Memberships" sections of the account dashboard.

### Phase 5: Polish

1. Add per-venue marketing consent at booking time (Section 9.1).
2. Add account deletion flow (Section 4.7).
3. Add notification preferences to user_profiles (operational vs marketing toggles).
4. Add timezone handling — display all booking times in user's preferred timezone.

---

## 11. Open API surface (relevant subset)

This section maps the user-account-related endpoints. Full API spec is in a separate document.

Current implementation note: the repo currently uses App Router endpoints such as `/api/auth/send-magic-link` rather than a versioned `/api/v1` namespace. The `/api/v1` paths below are the desired stable external/mobile API surface. Web implementation may start with existing route names, but mobile-facing endpoints should settle on this versioned shape before release.

### 11.1 Authentication

- `POST /api/v1/auth/magic-link/request` — send magic link to email
- `GET /api/v1/auth/magic-link/callback` — verify magic link token, issue session
- `POST /api/v1/auth/logout` — terminate current session (or all with `scope: global`)
- `POST /api/v1/auth/password/set` — set or change password (requires active session)

### 11.2 Profile

- `GET /api/v1/me` — current user profile
- `PATCH /api/v1/me` — update profile fields
- `POST /api/v1/me/email/change` — initiate email change (verification required)
- `DELETE /api/v1/auth/account` — delete account (Section 4.7)

### 11.3 Devices (forward-compatible for mobile)

- `POST /api/v1/me/devices` — register device for push notifications
- `GET /api/v1/me/devices` — list user's devices
- `DELETE /api/v1/me/devices/:id` — unregister device

### 11.4 Bookings (cross-venue unified view)

- `GET /api/v1/me/bookings` — all bookings, filterable
- `GET /api/v1/me/bookings/:id` — single booking
- `DELETE /api/v1/me/bookings/:id` — cancel (subject to policy)

### 11.5 Booking management without login

- `POST /api/v1/manage-booking/verify` — JSON body `{ "token": "<segment>" }` where `<segment>` is the path segment from a manage URL (e.g. everything after `/m/` for `…/m/v2.{payload}.{sig}`). Returns `{ "booking_id": "…" }` or `400` when invalid/expired.
- `GET /api/v1/manage-booking/:token` — view booking
- `DELETE /api/v1/manage-booking/:token` — cancel booking

---

## 12. What to avoid

These are mistakes that will cost time later. Do not implement these.

### 12.1 Do not build a separate "guest checkout" flow

There is one booking flow. The customer matching service handles the rest. If you find yourself writing a `bookAsGuest()` function, stop.

### 12.2 Do not require email verification before allowing booking

The user provides their email; the booking proceeds. Email verification happens lazily when they first click a magic link. A booking with an unverified email is a valid booking.

### 12.3 Do not show "create account" CTAs anywhere except in confirmation emails

No banners. No modals. No "would you like to save your details?" prompts in the booking flow. The confirmation email is the entire account-creation surface.

### 12.4 Do not use Stripe checkout's customer creation as a substitute for your own user records

Always create your auth user and user_profile first. Then create the Stripe Customer linked to your user. Stripe Customers are derived from your data, not vice versa.

### 12.5 Do not implement SMS-based authentication

Cost scales with success. Email magic links are sufficient. If a future business case justifies SMS, revisit then.

### 12.6 Do not confuse web session storage with the auth primitive

Supabase JWTs are the auth primitive. The web app may use Supabase SSR cookies to store and refresh sessions, but API design should remain compatible with bearer-token clients for mobile. Do not build account features that only work because a browser cookie exists.

### 12.7 Do not store sensitive data outside `auth.users` and `user_profiles`

Health information, identity documents, anything PII-heavy — stays scoped to specific venue records (`guests.customer_profile_notes` for example) and never replicated to platform-wide tables. Greenway Practice's records management policy applies here.

### 12.8 Do not mix marketing and operational emails

Operational emails (booking confirmations, reminders) are sent regardless of consent. Marketing emails require consent. Two separate sending paths in code, two separate domains/IPs in SendGrid if possible.

---

## 13. Glossary

**auth user:** The Supabase-managed identity. Has email, optionally password. One per real person.

**user_profile:** The application's view of a user. Linked 1:1 to auth user. Holds platform-wide preferences.

**guest / venue-scoped customer record:** The venue-scoped view of a customer, stored in the existing `guests` table. Many per user (one per venue they've booked with). Holds venue-private notes, tags, marketing consent, visits, and no-show counts.

**staff role:** A venue-scoped dashboard permission stored in the existing `staff` table. A user can have staff roles at zero, one, or many venues while also being a customer anywhere on the platform.

**context:** The product surface the user is trying to enter after login: `customer` for `/account/`*, `dashboard` for `/dashboard/`*. Context is a routing hint, not an authorisation claim.

**Account claim:** The act of a user verifying their email for the first time via magic link, transitioning their account from "silent" to "active".

**Silent signup:** Account creation as a side effect of booking, without the user explicitly creating an account.

**Tokenised booking management link:** A signed URL segment (MVP: **v2 HMAC** under `/m/v2.…`, see Section 5.2) that grants scoped access to one booking without requiring login. JWT query tokens are an optional future shape, not the MVP default.

**Magic link login:** Email-based passwordless authentication. Supabase Auth handles delivery.

**Booking model:** One of the five booking types ReserveNI supports — Restaurants (A), Appointments (B), Events (C), Classes (D), Facilities (E).

---

## 14. Future considerations

Not for immediate implementation. Documented here so they don't get lost.

**Social logins (Google, Apple):** Mandatory before iOS app launch (Apple App Store rule). Add when consumer app is in development.

**Family/household accounts:** A parent booking classes for their children. Will require a `dependents` model linked to user_profiles. Defer until a customer venue explicitly needs it.

**Two-factor authentication:** Supabase supports it. Add when warranted by user demand or compliance.

**Passkeys / WebAuthn:** Adoption still patchy. Add when reaching wider adoption.

**Cross-venue identity linking edge cases:** What happens when two emails belonging to the same person need to merge? Out of scope for now; manual support process if it arises.

**Public profiles for the consumer app:** When users start writing reviews and creating itineraries, they need a public-facing profile distinct from their venue-private `guests` records. New table: `public_user_profiles` with display name, avatar, privacy settings.

---

## 15. Decision log

When the design changes, record it here with date and rationale. Future-you and future-collaborators will need this context.

**2026-04-29:** Initial specification. Adopted silent signup pattern with magic-link-only authentication. Decided against SMS authentication on cost grounds. Decided against in-app prompts to claim account in favour of email-only nudge.

**2026-04-29:** Added staff/customer overlap guidance. Decided on unified identity with venue-scoped staff roles, separate UI surfaces (`/account` and `/dashboard`), explicit-destination-wins routing, and context switching without re-authentication. Decided to evolve the existing `staff` table instead of introducing a parallel `business_roles` table.

**2026-04-29:** **Manage links:** Adopted **v2 HMAC** `/m/v2.{payload}.{sig}` as the canonical no-login manage-booking format for MVP (compact links, shared secret with payment-link HMAC, built-in expiry, legacy v1 cutoff 2026-08-01 UTC). JWT links documented only as a possible future alternative.

**2026-04-29:** **Product sequencing:** Prioritise **saved payment methods** next among account-wallet features. **Credits, memberships, courses, recurring bookings** stay documented but should appear disabled or empty in `/account` until their data models and venue surfaces are specified.

**2026-04-29:** **Deletion anonymisation:** Guest placeholder emails use `deleted-{user_id}-{guest_id}@reserveni.deleted` so venue-scoped uniqueness and audit trails remain safe.

---

*End of reference document v1.1*