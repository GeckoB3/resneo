# Mobile API — Bearer auth for venue routes

The React Native app (`reserveni-app`) authenticates with Supabase and sends `Authorization: Bearer <access_token>` on API requests. Venue route handlers use `createVenueRouteClient(request)` from `@/lib/supabase/venue-route-client`, which reads the Bearer header and falls back to session cookies (web dashboard).

## Migrated routes (P0)

| Method | Path |
|--------|------|
| GET | `/api/venue` |
| GET | `/api/venue/staff/me` |
| GET | `/api/venue/dashboard-home` |
| GET | `/api/venue/bookings/list` |
| POST | `/api/venue/bookings` |
| GET, POST | `/api/venue/bookings/walk-in` |
| GET, PATCH, DELETE | `/api/venue/bookings/[id]` |
| GET | `/api/venue/bookings/[id]/summary` |
| GET | `/api/venue/guests` |
| GET | `/api/venue/guests/[guestId]` |
| GET | `/api/venue/appointment-availability` |

Card hold deposits: `POST /api/venue/bookings` accepts an optional `require_card_hold` boolean (default true for card-hold entities), and `GET /api/venue/bookings/[id]` returns a `card_hold` object (or `null`). See `Docs/CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION.md` §18 for the full contract.

### Public endpoint (unchanged)

`GET /api/booking/appointment-catalog` is a public guest-facing endpoint (no auth). It uses the admin client and does not require Bearer tokens.

## Example request

```bash
curl -sS \
  -H "Authorization: Bearer <access_token>" \
  https://reserveni.com/api/venue/staff/me
```

Expect `200` with a JSON body containing the staff object, e.g. `{ "staff": { "id", "email", "name", "phone", "role", ... } }`.

## Adding new venue routes

Any new `/api/venue/*` route handler that needs staff authentication should use:

```typescript
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';

export async function GET(request: NextRequest) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  // ...
}
```

Do **not** use `createClient()` in new venue route handlers — that reads cookies only and will return `401` for mobile clients.

## Manual setup (Supabase dashboard)

Add the mobile deep link to **Authentication → URL Configuration → Redirect URLs**:

```
resneo://callback
```

Required for magic-link sign-in from the mobile app.

**Add it to every project (staging and production) separately.** This list is per-project and is
not carried over by a migration. If the URL is missing, GoTrue does not return an error: it
silently substitutes the project's `SITE_URL`, so the email link lands on the website homepage and
the user is never signed in.

The value must match `Linking.createURL('callback')` exactly, which resolves to the `expo.scheme`
in `app.json` (`resneo`) with two slashes. It was `reserveniapp://callback` before the
ReserveNI-to-Resneo rebrand; that entry is dead and can be removed. The same URL serves
password-reset and invite emails, so a missing entry breaks those too.

## Customer first entry (P3-4i)

The account link in a booking confirmation signs a customer in. On the web that
happens at `GET /auth/portal?t=…`, which sets cookies. **A native client cannot
consume a cookie**, so there are two transports for the same mechanism.

### Two ways in, and both are the same underneath

**1. The six-digit code, with no ResNeo route at all.** The sign-in email now
carries the `email_otp` that `generateLink` returns alongside the link; the
route used to discard it. A client can take it straight to Supabase:

```ts
await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
```

**2. `POST /api/v1/auth/portal-token/exchange`**, for the token in a
confirmation email's account link.

```
POST /api/v1/auth/portal-token/exchange
{ "token": "<the ?t= value from the link>" }

200 { "access_token": "…", "refresh_token": "…", "expires_at": 1788035589 }
401 { "error": "That sign-in link is no longer valid. Ask for a new one.",
      "code": "UNAUTHENTICATED" }
429 { "error": "Too many attempts. Try again shortly.", "code": "RATE_LIMITED" }
```

The **refresh token is not optional**: `setSession` rejects a session without
one, so a client must install both.

**A 401 here means "get a fresh link", nothing more.** Expired, revoked,
unknown and malformed all return the same body on purpose, so a caller cannot
learn which tokens have ever been issued. Do not branch on the reason; there
is not one.

### What the client must do that ResNeo does not

**Call `claim_user_account()` after every sign-in.** This is a CLIENT
OBLIGATION, not something the exchange does. It links the customer's guest rows
at every venue they have booked with, and without it a freshly signed-in
customer sees an empty portal. The app already does this over PostgREST
(`providers/AuthProvider.tsx:218`, `app/(auth)/callback.tsx:70`); the RPC is
granted to `authenticated`, best-effort and non-blocking:

```ts
await supabase.rpc('claim_user_account');
```

It works only once `email_confirmed_at` is set, which `verifyOtp` does. That is
why both routes in above go through `verifyOtp` and why no other way of
establishing a session may be substituted.

### Errors, and one that is NOT Supabase's

`lib/auth/completeSession.ts` classifies a failed verification by matching
GoTrue's own prose (`access_denied`, `expired`, `already been used`,
`code verifier`). Those are Supabase's strings and are safe to match. **A
ResNeo-authored error must not be fed to that matcher**: branch on the `code`
field instead, which comes from the frozen union in
`src/lib/api/error-codes.ts`.

### Deep links: NOT YET SERVED

`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
are **not published**, so a sign-in link tapped on a phone opens a browser
rather than the app. They need the Apple Team ID and the Play app-signing
SHA-256, which pre-flight F7 is still to obtain; the bundle id and package name
(`com.resneo.app`) are already known.

**Do not restore universal links in the app before the files verify.** They
were removed on 2026-08-09 precisely because the files 404, and a *failed*
Android verification is worse than none: the app stops being offered as a
handler at all. The order is: serve the files, confirm a 200 with the right
content type and no redirect on both apex and www, then restore `app.json`,
then ship a build.

## The customer surface (P5-1)

Everything above is the venue app. This section is the customer's own account,
which had no documentation at all until now.

**All of these need a Bearer token and answer only about the caller.** Ownership
is resolved server-side from the session, never from a parameter: there is no
`user_id` argument anywhere here, and supplying somebody else's booking id
returns 404 rather than 403, so a stranger learns nothing from a guessed id.

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/v1/me/profile` | `{ profile, user }`. PATCH the same path to update; preferences are MERGED, never assigned |
| GET | `/api/v1/me/home` | The hub aggregate: next booking, outstanding payments, upcoming list, venue history |
| GET | `/api/v1/me/bookings` | The caller's bookings |
| GET | `/api/v1/me/bookings/by-model?model=event_ticket\|resource_booking` | The events and resources hubs. `limit` optional, capped at 100 |
| GET | `/api/v1/me/bookings/[id]` | One booking in full. The body **is** the shared booking DTO, the same object the web's own detail page renders, so a client shows what the web shows without a second interpretation of a booking |
| DELETE | `/api/v1/me/bookings/[id]` | Cancel |
| GET | `/api/v1/me/bookings/[id]/reschedule-options` | Whether this booking can be moved and what a move would need. Returns **no slots**: the availability call is separate |
| POST | `/api/v1/me/bookings/[id]/reschedule` | Move it. Body keys are read by name, not forwarded wholesale; ask `reschedule-options` first rather than guessing and getting a 400 |
| POST | `/api/v1/me/bookings/[id]/confirm` | Confirm attendance, the action the "please confirm you are coming" email asks for. Idempotent, so a double tap is not an error |
| GET | `/api/v1/me/venues` | One row per venue the customer is known at: names, first and last booked, counts, marketing consent |
| GET | `/api/v1/me/payments` | Settled payments. `?booking_id=` narrows to one |
| GET | `/api/v1/me/waitlist` | Waitlist places |
| DELETE | `/api/v1/me/waitlist/[id]` | Leave one. 409 when it is already gone |
| GET | `/api/v1/me/export` | The whole account as one JSON document, as a download |
| DELETE | `/api/v1/me/payment-methods/[venueId]/[paymentMethodId]` | Remove a card. 409 `requires_confirmation` when it pays for a membership; repeat with `?acknowledge=true` |
| GET | `/api/v1/me/devices` | Registered devices. POST the same path to register, DELETE `/api/v1/me/devices/[id]` to remove one |
| POST | `/api/v1/me/email/change` | Start an email change. 409 when another guest record already owns that address at any venue. The change applies only after the customer confirms from the new inbox |
| GET | `/api/v1/me` | The same handler as `/profile`, kept because it is the conventional root for "who am I". PATCH works here too |

**Two shapes worth knowing before writing a client.**

`409 { requires_confirmation: true, message }` means "this will affect
something, say you meant it". Show `message` verbatim, because it names what is
affected, and repeat the call with the acknowledgement parameter. The venue
availability routes use the same shape.

Errors carry a `code` from a frozen union (`src/lib/api/error-codes.ts`). Branch
on `code`, never on the human sentence in `error`, which is copy and will change.

## Deep links: the `resneo://` route map (P5-3)

**`resneo://` is the only deep-link entry point today.** There are no universal
or app links: `ios.associatedDomains` and the Android `https` intent filter were
removed on 2026-08-09 because the association files were never served, and a
FAILED Android verification is worse than none, since the app stops being
offered as a handler at all. Restoring them needs the Apple Team ID, the Play
app-signing certificate SHA-256 and a settled domain (F7).

**Every https link in an email therefore opens a browser.** That is the current
behaviour, and for customers it is the only possible one, because the shipped
app has no customer surface yet.

| Link the customer receives | App route to open | If the app is not installed |
|---|---|---|
| `/auth/confirm?token_hash=…&type=…` | `resneo://callback?token_hash=…&type=…` | The web page completes it and lands on the portal |
| `/auth/portal?t=…` (AD7 first entry) | `resneo://callback` after the exchange | The web route sets cookies and lands on the booking |
| `/account` | `resneo://account` | The web portal hub |
| `/account/bookings` | `resneo://account/bookings` | The web list |
| `/account/bookings/{id}` | `resneo://account/bookings/{id}` | The web detail page |
| `/manage/{bookingId}/{token}` | `resneo://manage/{bookingId}/{token}` | The web manage page, which needs no sign-in |
| `/m/v3…` (short manage link) | Resolve on the web first, then route by its target | The web page it resolves to |
| `/b/{code}` (short booking link) | Resolve on the web first, then route by its target | The web page it resolves to |
| Stripe Checkout return | `resneo://account/bookings/{id}` | The web return page |

**The two short links resolve on the WEB, deliberately.** `/m/v3…` and `/b/…`
are opaque: only the server knows what they point at, and an app that guessed
would have to reimplement the resolver and keep it in step. Follow the redirect,
then route on where it lands.

**Only `resneo://callback` is implemented today** (magic-link and
password-reset sign-in). The rest of this table is the contract for the customer
app to build against, not a description of what exists.

**Every row needs a not-installed fallback and none may be a dead end.** A deep
link that fails silently is worse than a web page: the customer taps a link in
an email and nothing happens at all, with no way to tell whether the booking is
still there.

