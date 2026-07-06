# Reserve NI - Booking models reference

This document is the **single place** we align on what each `BookingModel` means in product and code. It reflects the **current** setup (see `src/types/booking-models.ts` and `src/lib/business-config.ts`). It does not prescribe implementation tasks; for delivery plans see `Docs/Resneo_Unified_Booking_Functionality.md` and related specs.

---

## Why this matters

`venues.booking_model` is a **PostgreSQL enum** (and TypeScript union) that decides:

- Which **public booking flow** (`BookingFlowRouter`) renders.
- Which **default terminology** applies (client / booking / staff labels).
- Which **dashboard** areas, engines, and APIs are in play.

Using the same vocabulary in docs, support, and engineering avoids confusion between “appointments” (unified scheduling), “tables” (restaurants), and ticketed events or classes.

---

## The six booking models

| Enum value | Plain-language role |
|------------|---------------------|
| `table_reservation` | **Restaurant / hospitality** - covers, tables, combinations, deposits. |
| `unified_scheduling` | **Appointment-style businesses using the Unified Scheduling Engine** - calendars, `service_items`, online booking. **This is what new appointment signups use.** |
| `practitioner_appointment` | **Legacy** appointment model - **same product behaviour as `unified_scheduling`** in almost all code paths; kept for existing `venues` rows. |
| `event_ticket` | **Ticketed / dated experiences** - `experience_events`, ticket lines, `EventBookingFlow`. |
| `class_session` | **Recurring group classes** - class types, timetable, instances, `ClassBookingFlow`. |
| `resource_booking` | **Bookable rooms / courts / equipment** - `venue_resources`, slots, `ResourceBookingFlow`. |

---

## Model A - `table_reservation` (restaurants)

**Use for:** Restaurants, cafés, pubs, hotel dining - anywhere the unit of sale is **table or cover** for a sitting.

**Public:** `BookingFlow` - party size, date/time from **table** availability (not `unified_calendars`).

**Staff dashboard:** Table management (where the plan allows), bookings as reservations, waitlist, availability and rules tuned to **tables** and deposits.

**Relationship to other models:** Completely separate stack from `unified_scheduling` (different tables, engines, and flows).

---

## Model B - `unified_scheduling` and `practitioner_appointment` (appointments)

### `unified_scheduling` (current)

**Use for:** Salons, clinics, tutors, trades - any **appointment-style** venue that uses the **Unified Scheduling Engine**: `unified_calendars`, `service_items`, assignments, availability, and **Stripe Connect** for the flows that require payment.

**Public:** `AppointmentBookingFlow` - same component as legacy practitioner (see above).

**Staff:** Services, staff/calendars, appointment bookings list, practitioner calendar, unified onboarding steps, etc.

**New signups:** `SIGNUP_SUPPORTED_BOOKING_MODELS` includes `unified_scheduling` as the appointment option (`src/lib/business-config.ts`).

### `practitioner_appointment` (legacy)

**Use for:** **Historical** venues only - rows where `venues.booking_model` was set before the product standardised on `unified_scheduling`, or venues never migrated.

**Behaviour:** Code treats **`practitioner_appointment` and `unified_scheduling` identically** wherever `isUnifiedSchedulingVenue()` is used (`src/lib/booking/unified-scheduling.ts`): same public flow (`AppointmentBookingFlow`), same sidebar pattern, same unified comms eligibility, etc.

**Signup:** New signup cards advertise **all five** booking models, with **unified appointments** (`unified_scheduling`) as the appointment option (`BOOKING_MODEL_SIGNUP_CARDS` in `src/lib/business-config.ts`). The deprecated signup key `model_practitioner_appointment` in `BUSINESS_TYPE_CONFIG` maps to the **`unified_scheduling`** model for stored config. `isSignupSupportedBookingModel()` still allows `practitioner_appointment` so legacy checks do not break.

**Rule of thumb:** **Prefer saying “unified scheduling” (or “appointment venues”)** in new docs; mention **`practitioner_appointment` only when discussing legacy DB values or migration.**

---

## Models C, D, E - events, classes, resources

These are **not** the restaurant stack and **not** the same as `unified_scheduling`, though they share the generic **`bookings`** table and venue-level settings.

| Enum | Domain | Public flow | Typical staff areas |
|------|--------|-------------|---------------------|
| `event_ticket` | One-off or ticketed experiences | `EventBookingFlow` | Event manager, events, ticket types |
| `class_session` | Timetabled classes | `ClassBookingFlow` | Class timetable, class types, instances, roster |
| `resource_booking` | Bookable assets | `ResourceBookingFlow` | Resources, availability, timeline |

**Business types in `BUSINESS_TYPE_CONFIG`:** Many directory entries (e.g. escape rooms, yoga studios, meeting rooms) map to C/D/E models. **Self-serve signup now offers all five booking models** on the main cards: `table_reservation`, `unified_scheduling`, `event_ticket`, `class_session`, and `resource_booking` (see `BOOKING_MODEL_SIGNUP_CARDS` and `SIGNUP_SUPPORTED_BOOKING_MODELS` in `src/lib/business-config.ts`). A venue no longer needs to be admin-provisioned to start on `event_ticket`, `class_session`, or `resource_booking`.

**Source of truth for enabled models:** `venues.active_booking_models` (migration `20260610120000_venues_active_booking_models.sql`, resolved in `src/lib/venue-mode.ts`) is now the authoritative set of models a venue exposes, superseding the older `enabled_models` column (which is retained only as a compatibility view).

---

## Public booking: which React flow runs?

`BookingFlowRouter` (`src/components/booking/BookingFlowRouter.tsx`) chooses the **public** experience by `venue.booking_model`:

| `booking_model` | Component |
|-----------------|-----------|
| `table_reservation` | `BookingFlow` |
| `practitioner_appointment` | `AppointmentBookingFlow` |
| `unified_scheduling` | `AppointmentBookingFlow` |
| `event_ticket` | `EventBookingFlow` |
| `class_session` | `ClassBookingFlow` |
| `resource_booking` | `ResourceBookingFlow` |

**Naming tip:** When discussing implementation, using these **component names** is clear. Note that **`AppointmentBookingFlow` covers both `practitioner_appointment` and `unified_scheduling`**.

---

## Two different “event” concepts (do not merge)

The codebase has **two** ways something “event-like” can appear:

1. **`event_ticket` + `experience_events`** - Ticketed / marketing events, guest-facing `EventBookingFlow`, ticket lines on bookings.
2. **`unified_scheduling` + `event_sessions`** - **Calendar sessions** (group slots on a `unified_calendar`), booked with `event_session_id` in the unified booking API - same **appointment** signup, different **product** shape than ticketed events.

They are **different data** and **different flows**. Copy and internal docs should **name them distinctly** (e.g. “Events (tickets)” vs “Calendar sessions” / “Group sessions”) wherever both could apply.

---

## Terminology defaults

Default labels per model live in `DEFAULT_TERMINOLOGY` in `src/types/booking-models.ts`. Venues can override via `venues.terminology` JSONB.

---

## Summary table

| Question | Answer |
|----------|--------|
| Is `unified_scheduling` the “new” appointment path? | **Yes** - it is the canonical model for **new** appointment-style signups using the Unified Scheduling Engine. |
| Is `practitioner_appointment` only for old venues? | **Effectively yes** - it is **legacy**; behaviour is aligned with `unified_scheduling` in code. |
| Are restaurants part of unified scheduling? | **No** - **`table_reservation`** is a separate model, flow, and data model. |
| What do `EventBookingFlow`, `ClassBookingFlow`, `ResourceBookingFlow` map to? | **`event_ticket`**, **`class_session`**, **`resource_booking`** respectively. |

---

## Related documents

- `Docs/Resneo_Unified_Booking_Functionality.md` - multi-model product and delivery plan (`enabled_models`, settings, calendar, etc.).
- `Docs/archive/ReserveNI_Unified_Scheduling_Engine_Plan.md` - Unified Scheduling Engine (USE) build guide (archived — engine shipped; retained for architecture rationale).
- `Docs/Resneo_Bookable_Services_Landscape_Plan.md` - broader services landscape.
