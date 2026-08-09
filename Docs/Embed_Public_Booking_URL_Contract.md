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

## Example

`https://<your-domain>/embed/my-venue?tab=classes&accent=2563EB`
