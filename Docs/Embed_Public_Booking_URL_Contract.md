# Public booking embed - URL contract for partners

This document describes the **same** query parameters as the full-page public booking flow (`/book/[venue-slug]`). The embed route (`/embed/[venue-slug]`) uses **`BookPublicBookingFlow`** and must stay aligned.

## Base URL

- **Full page:** `https://<your-domain>/book/<venue-slug>`
- **Embed (iframe):** `https://<your-domain>/embed/<venue-slug>`

Optional: `?accent=<RRGGBB>` (no `#`) for accent colour on the embed page.

## `?tab=` - canonical tab slugs

Use **`?tab=<slug>`** to open a specific bookable service tab. Invalid or missing values fall back to the venue **primary** model tab (see `resolvePublicBookTabFromQuery` in `src/lib/booking/public-book-tabs.ts`).

| Slug           | Booking model(s)        | Notes                                      |
|----------------|-------------------------|--------------------------------------------|
| `tables`       | `table_reservation`     | Restaurant reservations                    |
| `appointments` | `practitioner_appointment`, `unified_scheduling` | Single tab for both B variants   |
| `events`       | `event_ticket`          | Ticketed experience events                 |
| `classes`      | `class_session`         | Class instances                            |
| `resources`    | `resource_booking`      | Bookable resources                         |

**Rules:**

1. Only tabs for models in **`venues.booking_model`** ∪ **`venues.enabled_models`** are valid; anything else resolves to the primary tab.
2. If the venue exposes only one tab, `?tab=` is ignored and the primary tab is always shown.
3. Canonical slug list: `PUBLIC_BOOK_TAB_SLUGS` in `src/lib/booking/public-book-tabs.ts` - do not introduce alternate names (e.g. hash-only or postMessage-only tab APIs) without updating that module and this document.

## `?start=service` - skip the single/group chooser

Appointment venues normally open on "How would you like to book?" (a single
appointment or a group booking). Pass **`?start=service`** to skip that and open
on the first step of the booking itself.

The step it lands on follows the venue's own booking order:

| Venue setting | Lands on |
|---|---|
| Default (service first) | "Select a service" |
| Staff-first booking on | "Who would you like to see?" |

Either way the back link is hidden, because the chooser it would return to was
deliberately skipped. The parameter name is historical: read it as "start on the
booking", not "start on the service list". Group bookings remain reachable from
the venue's own page, just not from a link that opted out of the chooser.

## `?start=time` - the link already knows the service

**`?start=time`** does everything `?start=service` does, and additionally
passes THROUGH the service step, for a link that already names the service in
`?service_id=`. Without it a "book this again" link lands the customer back on
the list they already chose from.

It can never skip a required choice. The link is passed through the ordinary
service selection, so a service with options stops on "Choose your option" and
one with extras stops on "Add extras to your booking". Only a service with
neither reaches the times.

If `?service_id=` names a service the venue has since retired, the flow stays
on the service list, exactly as a stale `?service_id=` already behaves. A link
that has aged badly leaves the customer somewhere they can still book.

## `?service_id=` - name the service

The `service_items.id` of the service to select. Two effects, and the second is
easy to miss:

1. It preselects the service.
2. **On staff-first venues it changes the order.** A link that names the
   service means the customer has already committed to the what, so the "who
   would you like to see?" step is not shown first.

Used on its own it does NOT skip the service step; pair it with `?start=time`
for that.

## Practitioner: a path segment, not a parameter

`/book/<venue-slug>/<practitioner-slug>` opens the flow locked to one
practitioner, showing only their services and times. **This route already
existed and was undocumented**; it is recorded here because a partner reading
this page would otherwise conclude there is no way to link to one person.

- The slug is `unified_calendars.slug`, not the practitioner's name.
- Unified-scheduling venues only. Anything else 404s, as does an unknown or
  inactive slug.
- There is deliberately no `?practitioner=` equivalent. One way to say a thing
  is enough, and the path form is the one already in the wild.

## There is no duration parameter, on purpose

Duration is derived from the service and the option chosen, and duration
OVERRIDES are a staff-only tool. A public link that could assert a duration
would let a URL commit a venue to a length its own booking page offers no way
to choose, at a price that does not match. Ask for a variant with
`?service_id=` and let the flow price it.

## Example

`https://<your-domain>/embed/my-venue?tab=classes&accent=2563EB`

Rebooking the same service with the same person:

`https://<your-domain>/book/my-venue/ada-lovelace?service_id=<service-id>&start=time`
