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

Card hold deposits: `POST /api/venue/bookings` accepts an optional `require_card_hold` boolean (default true for card-hold entities), and `GET /api/venue/bookings/[id]` returns a `card_hold` object (or `null`). See `Docs/CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION.md` §18 for the full contract. Since 2026-09-05 card holds are standard for every venue and the `card_hold_deposits` venue flag is retired: `feature_flags.resolved.card_hold_deposits` is still served as a constant `true` on `GET /api/venue` and `GET`/`PATCH /api/venue/feature-flags` so the app's entity editors and staff "Card hold" toggle keep working, and a PATCH that sends the key is ignored (the app's Booking settings toggle for it therefore reads as permanently on). The app should drop those gates and that toggle row; the compatibility key goes away once it has.

### Public endpoint (unchanged)

`GET /api/booking/appointment-catalog` is a public guest-facing endpoint (no auth). It uses the admin client and does not require Bearer tokens.

Since 2026-09-03 the public-booking billing guard on `/api/booking/*` (the 403 "Online booking is temporarily unavailable for this venue.", for a Light venue past due or a subscription that has ended) no longer applies to a **staff session**: a Bearer token for staff of that venue, or of a venue holding an active link over it that allows booking changes, is let through on `appointment-catalog`, `availability`, `appointment-calendar`, `validate-appointment-slot`, `create`, `create-multi-service` and `create-group`. The app's linked-calendar "New booking" reads a linked venue's catalog and creates multi-service visits through these public routes with `venue_id` set to the linked venue, and was being answered with the public's message. Send the Bearer token on those calls; without it the guard behaves as before.

Since 2026-09-02 the response also carries service categories, additively: a top-level `categories` array of `{ id, name, sort_order }` in booking-page order, and on each service in `practitioners[].services[]` a `category` object of the same shape, or `null` when the service has no category. A venue with no categories returns `categories: []`. Clients that ignore both keep working; a client that groups should list services under `category` in `categories` order, with uncategorised services last under a heading such as "Other services".

## Example request

```bash
curl -sS \
  -H "Authorization: Bearer <access_token>" \
  https://reserveni.com/api/venue/staff/me
```

Expect `200` with a JSON body containing the staff object, e.g. `{ "staff": { "id", "email", "name", "phone", "role", ... } }`.

### This route's 401 is BARE, and must stay that way

A caller who is not staff gets `401 { "error": "Unauthorised" }` with **no
`code`**. That is deliberate and the app depends on it: `useRole` probes this
route on launch and reads a bare 401 as "this person is a customer".

Everywhere else, a 401 carrying `code: "UNAUTHENTICATED"` means "this session is
dead" and the app signs the user out. So the two shapes are load-bearing in
opposite directions. If this route ever gained the code, every customer would be
signed out on launch, having done nothing wrong. Do not make the 401s across the
API "consistent": the asymmetry is the contract, and
`src/app/api/mobile-401-contract.test.ts` fails if either half moves.

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

Keep this entry, but note what now depends on it: **staff invites, and nothing
else.** Since 2026-08-31 the app signs in with the typed code above rather than
by following the link, and it has dropped password reset entirely. Invite links
still route through this scheme, so removing it would break them. It is no
longer on the critical path for customer sign-in or recovery.

**Add it to every project (staging and production) separately.** This list is per-project and is
not carried over by a migration. If the URL is missing, GoTrue does not return an error: it
silently substitutes the project's `SITE_URL`, so the email link lands on the website homepage and
the user is never signed in.

The value must match `Linking.createURL('callback')` exactly, which resolves to the `expo.scheme`
in `app.json` (`resneo`) with two slashes. It was `reserveniapp://callback` before the
ReserveNI-to-Resneo rebrand; that entry is dead and can be removed. The same URL serves
invite emails, so a missing entry breaks those too. It served password-reset emails as
well until the app dropped reset on 2026-08-31.

## Customer first entry (P3-4i)

The account link in a booking confirmation signs a customer in. On the web that
happens at `GET /auth/portal?t=…`, which sets cookies. **A native client cannot
consume a cookie**, so there are two transports for the same mechanism.

### Two ways in, and both are the same underneath

**1. The typed code, with no ResNeo route at all.** The sign-in email now
carries the `email_otp` that `generateLink` returns alongside the link; the
route used to discard it. A client can take it straight to Supabase:

```ts
await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
```

**Do not hardcode the code's length.** This paragraph said "six-digit" until
2026-08-31 and an app trusted it, shipping an input that truncated the code as
the user typed, so the box silently refused to hold what the email had just
issued. `otp_length` is a per-project HOSTED setting: `supabase/config.toml`
says six but configures a local `supabase start` only, and staging currently
issues eight. Treat the code as an opaque string of unknown length.

**This is now the app's primary way in**, not a fallback. Supabase's link
redirects into `resneo://callback`, which needs the scheme allowlisted and
needs the mail client and browser both willing to hand a custom scheme off from
an HTTP 302. Many will not, Gmail on Android especially, and it fails by
silently landing on the website. The typed code has none of that in its path.

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
| GET | `/api/v1/me/venues` | One row per venue the customer is known at: `guest_id`, names, first and last booked, counts, marketing consent |
| PATCH | `/api/account/marketing-preferences` | Turn one venue's offers on or off. Takes the `guest_id` from `/api/v1/me/venues`; unversioned because it predates this surface (C7b) |
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

**`resneo://` is still the only deep-link entry point in the SHIPPED app, but
the web half is now in place.** `ios.associatedDomains` and the Android `https`
intent filter were removed on 2026-08-09 because the association files were
never served, and a FAILED Android verification is worse than none, since the
app stops being offered as a handler at all.

Since 2026-08-31 this repo serves both, as route handlers under
`src/app/.well-known/` (C12): `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json`, each 200, `application/json`, no redirect,
middleware excluded. **On `www.resneo.com` only.** The apex 307s to www, and a
verifier does not follow a redirect, so the app must declare www and only www;
if the apex is ever added it has to serve these files directly.

The AASA claims five portal paths and **excludes the rest of `/account`**,
because the app has no screen for them. A portal route the app also gains has
to be added to the AASA and to the app's `+native-intent.tsx` translation
together. Restoring `app.json` and shipping a build is the app repo's step, and
comes after verifying these files against the deployed site, not before.

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

**Only `resneo://callback` is implemented today**, and since 2026-08-31 staff
invites are all that still arrive through it: the app signs in with the typed
code and no longer does password reset. The rest of this table is the contract
for the customer app to build against, not a description of what exists.

**Every row needs a not-installed fallback and none may be a dead end.** A deep
link that fails silently is worse than a web page: the customer taps a link in
an email and nothing happens at all, with no way to tell whether the booking is
still there.

## Several services in one visit (2026-09-02)

`GET /api/booking/availability` accepts an optional `services` query parameter: a JSON array of up to four `{ service_id, variant_id?, addon_ids?, duration_minutes? }` entries in visit order. When present, the day view returns the starts at which the WHOLE chain fits back to back with one person (or, with `any_available=1`, with anyone who offers every service). Slots are labelled with the first `service_id` and carry the visit's span as `duration_minutes`. The top-level `service_id`, `variant_id`, `addon_ids` and `duration_minutes` are ignored when `services` is sent. Works on combined (collective) pages, where each entry is an offering id.

`POST /api/booking/create-multi-service` now accepts an optional per-entry `duration_minutes` (staff custom core duration, honoured for the `phone` and `walk-in` sources only) and resolves a collective id in `venue_id` with offering ids in `service_id`, as `create` already did. `POST /api/booking/create-group` accepts up to 40 rows (ten people, four services each).

## Staff booking for a venue collective (2026-09-04)

A venue that is an active member of a live collective (`unified_catalog`, two or more eligible
members) can book for the whole collective as one business. Nothing changes for a venue with
pairwise links only, and nothing changes for the app until it opts in; every addition below is
additive.

- `GET /api/venue/linked-calendar/venue-profile?venueId=<collective id>` answers with the
  collective's virtual venue (`venue.id` is the collective id, `venue.is_collective: true`),
  `booking_model: "unified_scheduling"`, `enabled_models: []`, and a `collective` object
  (`id`, `member_venue_ids`). A partner venue id answers as before.
- `GET /api/venue/appointment-calendar` and `GET /api/venue/appointment-availability` accept
  the collective id as `owner_venue_id`; `practitioner_id` is a calendar from the merged
  catalogue (`GET /api/booking/appointment-catalog?venue_id=<collective id>`) and `service_id`
  an offering. Availability is the union of the provider calendars, each on its owning venue's
  clock, with the staff allowance for today.
- `POST /api/venue/bookings` accepts the collective id as `owner_venue_id` with the offering as
  `appointment_service_id` and the calendar as `practitioner_id`. The server resolves the owning
  venue and source service, applies the collective's price and duration, writes the booking in
  the owning venue with `collective_id` and `collective_service_item_id` set, and records the
  link audit and cross-venue notification when the owner is another member.
- `GET /api/venue/staff-collective` returns `{ collective: null }` or
  `{ collective: { id, name, host_venue_id, member_venue_ids, calendar_ids } }`, the collective
  the caller's venue books for and the calendars its combined catalogue offers.
- Visits and groups keep using `POST /api/booking/create-multi-service` and `create-group` with
  `venue_id = <collective id>`; when a member's staff session is on the request and the bookings
  land in another member's venue, the same audit and notification are now recorded.
- The staff catalogue (`GET /api/booking/appointment-catalog?venue_id=<collective
  id>&include_hidden=true` with a member's session) lists the combined page's offerings only,
  exactly as the customer catalogue does (an offering with no category falls under "Other
  services"), plus the hidden add-on groups staff see on their own catalogue. For a few hours on
  2026-09-05 it also listed each member's own services flagged `venue_only: true` under a
  `"{Venue} only"` category; that was withdrawn the same day, the flag no longer appears, and a
  member books its own other services through its own venue id. The staff hints on the shared
  public routes (`staff=1` on `GET /api/booking/availability`, `staff: true` on
  `POST /api/booking/validate-appointment-slot`, a staff `source` on the visit and group creates)
  are still accepted but nothing reads them for this.

## Processing snapshot on calendar-grid rows (2026-09-05)

`GET /api/venue/calendar-grid` booking rows also carry, additively:

- `appointment_service_id`, `service_item_id` and `service_variant_id`: what the booking is for
  (the legacy service, the unified catalogue item, the chosen variant), each null when absent.
- `processing_time_blocks`: the processing gaps recorded for the booking when it was made, as
  `[{ id, start_minute, duration_minutes }]` in minutes from the booking's start. Null when the
  row has no snapshot (derive the gaps from the service's or variant's own
  `processing_time_blocks` instead); an empty array is a real snapshot of a booking with no gaps.

That is the precedence the web diary uses: the snapshot first, else the pattern. A booking taken
inside another's gap can then be drawn nested in it the way
`src/lib/calendar/booking-cluster-layout.ts` does, including one that starts in a gap running to
the host's end and finishes after the host.

## Calendar availability parity: two more routes take the Bearer (2026-09-06)

`GET /api/venue/calendar-entitlement` (the plan pill, the "Add calendar" gate and the tier limit
copy) and `GET /api/venue/calendar-column-conflicts` (the "Conflict" pill and the resource
overlap box) built their client from cookies alone and answered a Bearer token with 401. Both
now use `createVenueRouteClient(request)` like the rest of `/api/venue/*`. The response shapes
are unchanged; the dashboard's cookie session keeps working through the fallback.

## Deferred guest notification for a linked booking (R26, 2026-09-06)

`POST /api/venue/bookings/[id]/guest-modification-notify` now loads the booking through
`loadStaffAccessibleBooking` and refuses with 403 unless `linkedGrantAllowsMutation` passes,
the same gate as the `PATCH` that deferred the message. The message is sent as the OWNER
venue (the booking's `venue_id`), never the caller's. Before this the route filtered on the
caller's venue and answered 404 for a partner's booking, so a linked move never emailed the
guest.

Statuses: bare `{ "error": "Unauthorised" }` 401 with no staff row; 404 `Booking not found`;
403 `You do not have access to this booking.` (no link), `This link does not include that
calendar.` (link scoped to other calendars), or `This link does not allow messaging guests on
the other venue’s bookings.` (view-only link). The 200 body is unchanged:
`{ ok: true, emailSent, smsSent, skipped, skippedReason? }`.

App side: a partner's move may now send `defer_modification_guest_notification: true` and
offer Notify, exactly as for an own booking; `skip_booking_modification_guest_notification`
keeps working. No request field changed.

## Guest documents for a linked venue (R26 second ask, 2026-09-06)

The five guest-document routes accept `owner_venue_id=<uuid>` so a partner's guest's
Records can be read and added to across a link:

```
GET    /api/venue/guests/[guestId]/documents
GET    /api/venue/guests/[guestId]/documents/[documentId]/download
POST   /api/venue/guests/[guestId]/documents/sign
POST   /api/venue/guests/[guestId]/documents/[documentId]/complete
DELETE /api/venue/guests/[guestId]/documents/[documentId]
```

Gates, all in `src/lib/guests/linked-guest-access.ts`: an accepted link whose grant is
`full_details` AND shares PII for every one of them; plus an edit grant for sign and
complete; plus the FULL MANAGEMENT grant for delete (destroying a file the owner venue holds
follows booking cancel and booking delete, not booking edit). `PATCH` on a document is
own-venue only.

403 bodies: `You do not have access to that venue’s client records.`,
`This link does not allow changing the other venue’s client records.`,
`This link does not allow deleting the other venue’s client records.`. A guest that does
not belong to the resolved venue answers 404 `Guest not found`. Success shapes are unchanged.

The storage path and `guest_documents.venue_id` stay the OWNER venue's; the contact audit
event is written against the owner venue with `acting_venue_id` and `link_id` in its
metadata.

## Is Ask ResNeo switched on? (R27, 2026-09-06)

A client that draws an Ask ResNeo entry point can ask first, so it hides the row instead of
leading someone to the unavailable message. The same boolean, two places:

```
GET /api/venue           ->  { ..., "assistant_enabled": true }   (no extra request)
GET /api/venue/assistant ->  { "enabled": true }
```

Both run `assistantEnabledFor(staff.venue_id)`, the same check `POST /api/venue/assistant`
runs, so the flag and the behaviour cannot disagree. The GET answers **200 with
`enabled: false`** when the assistant is off, not 404: the POST 404s because the feature does
not exist for that caller, while the GET is a question whose answer is "no". It sends
`Cache-Control: no-store`, because the flag flips with an environment variable and with the
beta allowlist. Bare `{ "error": "Unauthorised" }` 401 with no staff row.

`assistant_enabled` on the venue bootstrap is additive; nothing else in that payload changed.

## Processing time may run past the end of a service (2026-09-08)

`processing_time_blocks` (on services, variants, calendar-grid booking rows and the public
catalogue) may now include a block that starts at the service's end and runs on, or one that
starts inside the service and finishes after it. `start_minute` is still minutes from the
booking's start and must be within `0..duration_minutes` inclusive; `start_minute +
duration_minutes` may exceed the duration by up to 480 minutes. The stored `booking_end_time`
and `duration_minutes` are unchanged: the tail is not part of the service length.

What the tail means:

- The practitioner is FREE for it (another booking may be taken there), and the buffer follows
  it rather than the service end. `GET /api/booking/availability` and
  `POST /api/booking/validate-appointment-slot` already apply this.
- In a multi-service visit the next service starts at `previous start + previous duration +
  previous tail + previous buffer`. `POST /api/booking/create-multi-service` enforces exactly
  that (its error text is now "each start = previous end + processing time + buffer" and
  `expected_start` says where). The `services` chain param on the availability route returns
  starts spaced the same way, and `duration_minutes` on those slots carries the whole span.
- `validate-appointment-slot` phantoms accept an optional `processing_time_blocks` array so an
  earlier segment's gaps count as free while a later one is checked. Omit it and the phantom is
  treated as busy throughout, which is still safe for a consecutive chain.
- A pattern is re-fitted when a booking's length differs from the catalogue's: a block that
  reaches the end of the service keeps its distance from the end (a 60 minute colour with a 30
  minute tail booked with a 15 minute add-on snapshots the tail at minute 75), while a block in
  the middle stays put and is trimmed only if the booking is shortened past it.

The web diary paints a tail as empty space (the card stops where the practitioner's last busy
stretch ends), paints a middle gap as a pale band, and draws a booking taken in either at full
lane width with no inset; the app's grid may keep its own treatment, but it should not clamp a
block to the row's duration, and should place the next service of a visit after the tail.
