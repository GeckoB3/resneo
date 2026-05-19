# Reserve NI — Classes, Events & Resources Functionality Review & Plan

**Version:** 1.0  
**Date:** 19 May 2026  
**Scope:** Staff setup and management, working-page integration, guest booking and management, and customer account portal for **classes** (`class_session`), **ticketed events** (`event_ticket`), and **bookable resources** (`resource_booking`) — compared against **appointments** (`unified_scheduling`) as the reference implementation.  
**Out of scope:** Restaurant-only surfaces (floor plan, table grid, dining waitlist, covers mode) except where shared infrastructure affects C/D/E venues.  
**Audience:** Product, engineering, and founding-venue GTM.

**Companion document:** [ReserveNI-Appointments-Functionality-Review-And-Plan-May-2026.md](./ReserveNI-Appointments-Functionality-Review-And-Plan-May-2026.md) — competitive benchmark, salon POS gaps, and appointment-first Tier 1 roadmap.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Methodology](#2-methodology)
3. [Booking models and terminology](#3-booking-models-and-terminology)
4. [Current state — feature inventory](#4-current-state--feature-inventory)
5. [Comparison to appointments](#5-comparison-to-appointments)
6. [Staff tools — setup and management](#6-staff-tools--setup-and-management)
7. [Working page integration](#7-working-page-integration)
8. [Guest booking and management](#8-guest-booking-and-management)
9. [Customer account portal](#9-customer-account-portal)
10. [Strengths and differentiators](#10-strengths-and-differentiators)
11. [Gap analysis](#11-gap-analysis)
12. [Implementation plan](#12-implementation-plan)
13. [Success metrics](#13-success-metrics)
14. [Dependencies and risks](#14-dependencies-and-risks)
15. [Related documents](#15-related-documents)
16. [Appendix — parity checklist](#16-appendix--parity-checklist)

---

## 1. Executive summary

Reserve NI ships **four non-restaurant booking models** on one platform. Recent product and engineering focus has rightly concentrated on **appointments** (Model B / `unified_scheduling`) — drag-reschedule, service catalogue depth, processing time, group bookings, and reception-desk polish. **Classes, events, and resources** (Models C, D, E) are **not stubs**: each has dedicated staff managers, availability engines, public booking flows, Stripe payment paths, calendar feed integration, roster tooling, and venue APIs. They are, however, **uneven in maturity** relative to appointments.

**Verdict by model:**

| Model | Maturity vs appointments | Headline |
|-------|--------------------------|----------|
| **Classes** | **Closest parity** — ahead on **commerce** (credits, courses, memberships, recurring) | Strongest C/D/E surface; account portal is class-centric |
| **Events** | **Solid book + roster** — behind on **post-booking guest/staff modify** | Ticket tiers and attendee sheets work; no guest reschedule |
| **Resources** | **Solid book + timeline** — weakest on **calendar ops and portal** | No instance detail sheet; drag blocked on calendar |

**Cross-cutting gap (all three):** Appointments define the **reference lifecycle** — guest self-modify via `/manage/[token]`, staff slot change via `StaffAppointmentModifyForm`, calendar drag-reschedule. For C/D/E, guests get **view + cancel only**; staff get **contact/notes patch only** (cancel + rebook to move a slot). This is **documented and code-enforced**, not accidental omission.

**Strategic posture:**

| Do | Do not |
|----|--------|
| Market “one platform” with classes/events/resources **included** on Appointments Light | Promise Fresha-level guest reschedule for classes until shipped |
| Extend **class commerce patterns** to appointment packages (reuse entitlement engine) | Fork four separate booking engines into one UI before guest-modify parity |
| Close **CDE guest-modify** and **staff reschedule** after appointment Tier 1 | Build event-specific marketplace discovery |
| Keep **dedicated managers** (timetable, event manager, resource timeline) — staff know these workflows | Hide C/D/E on calendar behind appointment-only mental model |

---

## 2. Methodology

### 2.1 How this review was produced

| Source | Use |
|--------|-----|
| **Codebase audit** | `src/app/dashboard/`, `src/app/book/`, `src/app/account/`, `src/app/manage/`, `src/app/api/venue/`, `src/app/api/booking/`, `src/app/api/account/`, `src/components/booking/`, `src/lib/availability/`, `src/lib/class-commerce/`, `src/lib/experience-events/` |
| **Normative docs** | `Docs/ReserveNI_Unified_Booking_Functionality.md`, `Docs/ReserveNI_Booking_Models_Reference.md`, `Docs/CLASS_COMMERCE_PRODUCT_RULES.md`, `Docs/Embed_Public_Booking_URL_Contract.md` |
| **Companion review** | `Docs/ReserveNI-Appointments-Functionality-Review-And-Plan-May-2026.md` — appointments as benchmark |
| **Prior unified booking plan** | Sprint parity targets for C/D/E vs Model B |

Maturity key throughout: **● Complete** · **◐ Partial** · **○ Missing**

### 2.2 Comparison baseline

**Appointments (`unified_scheduling`)** are treated as the **reference implementation** for:

- Staff catalogue CRUD and availability configuration  
- Calendar manipulation (drag, resize, blocks)  
- Bookings list operations and expandable detail  
- Guest public book → pay → confirm → manage link  
- Staff-created bookings from dashboard  
- Communications (confirmation + reminders)  
- Reporting segmentation  

Where C/D/E match or exceed appointments, that is called out explicitly (classes commerce is the main example).

---

## 3. Booking models and terminology

From `src/types/booking-models.ts` and `Docs/ReserveNI_Booking_Models_Reference.md`:

| Enum | Model | Primary staff surface | Public flow component |
|------|-------|----------------------|------------------------|
| `event_ticket` | C — Ticketed experiences | `/dashboard/event-manager` | `EventBookingFlow` |
| `class_session` | D — Group classes | `/dashboard/class-timetable` (+ products) | `ClassBookingFlow` |
| `resource_booking` | E — Rooms / facilities | `/dashboard/resource-timeline` | `ResourceBookingFlow` |
| `unified_scheduling` | B — Appointments | `/dashboard/appointment-services`, `/dashboard/calendar` | `AppointmentBookingFlow` |

**Important:** Do not conflate **`event_ticket`** (`experience_events`, ticket lines) with **`event_sessions`** on unified calendars (group slots booked as `unified_scheduling`). Both can coexist when a venue is appointment-primary with events enabled as a secondary model. Product copy must label them distinctly (“Events (tickets)” vs “Calendar sessions”).

**Multi-model venues:** `venues.booking_model` (primary) + `venues.enabled_models` (secondaries). Sidebar, public `/book/[slug]` tabs, setup checklist, and bookings list all respect enabled models via `mergeModelNavEntries` and `venueExposesBookingModel`.

---

## 4. Current state — feature inventory

### 4.1 Classes (`class_session`)

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Class types CRUD | ● | `api/venue/classes`, `ClassTimetableView` |
| Weekly timetable + recurrence | ● | `ClassTimetableEntry`, interval weeks, `class-recurring-materialize` cron |
| Instance generation | ● | `classes/generate-instances`, `class-instances` APIs |
| Instance cancel / capacity override | ● | PATCH instance, calendar blocks |
| Public class booking | ● | `ClassBookingFlow` (~979 lines), `class-offerings` API |
| Multi-session cart checkout | ● | `ClassMultiSessionCart`, atomic `group_booking_id` |
| **Class commerce** — credit packs | ● | `CLASS_COMMERCE_PRODUCT_RULES.md`, venue + account APIs |
| **Class commerce** — course bundles | ● | Enrollment, roster linkage |
| **Class commerce** — memberships | ● | Stripe Subscriptions on Connect |
| Recurring reservations (materialized) | ● | `class_recurring_reservations`, cron |
| Roster / check-in / CSV export | ● | `ClassInstanceDetailSheet` |
| Staff booking (phone/walk-in) | ● | `StaffSurfaceBookingStack` → `ClassBookingFlow` |
| Deposits / full pay (Stripe Connect) | ● | Same webhook path as appointments |
| CDE scheduled reminders | ● | `runSecondaryModelScheduledComms`, `cde_reminder_1/2` |
| Dedicated account portal hub | ● | `/account/classes`, credits, courses, memberships, recurring |
| Class commerce reports | ● | `api/venue/class-commerce-reports` |
| Guest self-reschedule | ○ | `ManageBookingView`: `showGuestModify` false for CDE |
| Staff slot modify | ○ | `StaffExpandedBookingModifyModal` → `cde_details` only |
| Calendar drag-reschedule | ○ | Class instances link to timetable, not draggable bookings |
| PDF roster | ○ | CSV export exists; PDF Phase 2 per unified booking doc |
| Dedicated help articles | ○ | Appointments have `lib/help/articles/appointments.ts`; classes rely on inline/tooltips |
| Waitlist | ○ | Table waitlist only |

**Primary routes:** `/dashboard/class-timetable`, `/dashboard/class-timetable/products`

### 4.2 Events (`event_ticket`)

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Event CRUD | ● | `EventManagerView`, `api/venue/experience-events` |
| Multi-tier ticket types | ● | `EventTicketType`, ticket lines at create |
| Recurring / series events | ● | `parent_event_id`, `materialize-event-sessions` cron |
| Public event booking | ● | `EventBookingFlow` (~644 lines), `event-offerings` API |
| Attendee list + check-in | ● | `EventInstanceDetailSheet`, `.../attendees` API |
| Event cancel (venue) | ● | `experience-events/[id]/cancel` |
| Staff booking | ● | Staff stack tab + venue bookings API |
| Deposits / full pay | ● | `booking/create` event branch |
| Guest cancel + refund (whole booking) | ● | `/manage`, `/confirm` — v1 whole-booking only |
| Partial ticket refunds | ○ | **Locked:** whole-booking refund only (unified booking doc) |
| Staff alerts on new bookings | ○ | Explicitly out of scope (same as appointments) |
| Guest self-reschedule | ○ | CDE manage link: cancel only |
| Staff slot modify | ○ | Contact/notes only |
| Dedicated account portal section | ○ | Bookings list only — no `/account/events` |
| Dedicated help articles | ○ | — |
| Per-practitioner public URL | ○ | Appointments only: `/book/{venue}/{practitioner-slug}` |

**Primary route:** `/dashboard/event-manager`

### 4.3 Resources (`resource_booking`)

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Resource CRUD | ● | `api/venue/resources`, `ResourceTimelineView` |
| Timeline + exceptions calendar | ● | `ResourceExceptionsCalendar`, `availability_exceptions` |
| Slot interval / min-max duration | ● | `VenueResource` fields, `resource-booking-engine` |
| Host calendar intersection | ● | `display_on_calendar_id`, host hours in engine |
| Public month/slot booking | ● | `ResourceBookingFlow` (~784 lines) |
| Staff booking | ● | Staff stack tab |
| Deposits / full pay | ● | Shared payment requirement enum with classes |
| Bookings list visibility | ● | Type filter in `AppointmentBookingsDashboard` |
| Multi-resource single booking | ◐ | Occupancy engine exists; not clearly first-class UX |
| Equipment bundles | ○ | Competitor feature — not evident |
| Instance detail sheet on calendar | ○ | Events/classes have sheets; resources deep-link to timeline |
| Calendar drag (resource bookings) | ○ | `PractitionerCalendarView`: `canDrag` false when `resource_id` set |
| Guest self-reschedule | ○ | Same CDE restriction |
| Dedicated account portal section | ○ | Bookings list only |
| Help beyond tooltips | ◐ | `lib/help/resource-booking-tooltips.ts` only |

**Primary route:** `/dashboard/resource-timeline`

### 4.4 Shared spine (all models including appointments)

| Capability | Status | C/D/E notes |
|------------|--------|-------------|
| Unified bookings list | ● | `AppointmentBookingsDashboard` when appointment-primary; CDE type pills |
| Staff new booking tabs | ● | `/dashboard/bookings/new?tab=appointment\|class\|event\|resource` |
| Public multi-tab book page | ● | `BookPublicBookingFlow`, `public-book-tabs.ts` |
| iFrame embed | ● | `/embed/[venue-slug]` — same tab contract |
| CRM (contacts) | ● | All booking models attach to guest records |
| CSV import | ● | Reference types: event, class, resource in import wizard |
| Setup checklist | ● | Per-model steps in `SetupChecklist` + `compute-setup-status` |
| Enable/disable models in settings | ● | `BookingTypesSection` |
| Confirm/cancel SMS link | ● | `/confirm/[token]` — cancel works for CDE |
| Bulk guest messaging | ● | From bookings list toolbar |
| Linked venue calendars | ● | Differentiator — C/D/E bookings visible cross-venue |
| Venue collectives | ● | `/book/c/{slug}` multi-venue booking |

---

## 5. Comparison to appointments

### 5.1 Feature parity matrix

| Capability | Appointments | Events | Classes | Resources |
|------------|:------------:|:------:|:-------:|:---------:|
| Staff CRUD manager | ● | ● | ● | ● |
| Staff new booking | ● | ● | ● | ● |
| Public multi-tab book | ● | ● | ● | ● |
| Availability engine | ● | ● | ● | ● |
| Stripe deposits / full pay | ● | ● | ● (+ commerce) | ● |
| Calendar primary grid | ● | ◐ strip + sheet | ◐ strip + sheet | ◐ strip + timeline link |
| Drag-reschedule on calendar | ● | ○ | ○ | ○ |
| Bookings list ops | ● | ● | ● (+ groups) | ● |
| Roster / attendees UI | ◐ | ● | ● | ○ |
| Staff slot modify | ● | ○ | ○ | ○ |
| Guest self-modify (manage link) | ● | ○ | ○ | ○ |
| Guest cancel + policy refund | ● | ● | ● | ● |
| CDE scheduled reminders | ● (unified) | ● (cde_*) | ● | ● |
| Account portal depth | ◐ bookings | ◐ bookings | ● hub + commerce | ◐ bookings |
| Commerce (packs / subs) | ○ | ○ | ● | ○ |
| Import / migration | ● | ● | ● | ● |
| Class-specific reports | — | ○ | ● | ○ |
| Reports by `booking_model` | ◐ | ◐ | ◐ | ◐ |
| Per-practitioner public URL | ● | ○ | ○ | ○ |
| Waitlist | ○ (appt) | ○ | ○ | ○ |
| Service variants / buffers | ● | ○ | ○ | ○ |
| Processing time blocks | ● | ○ | ○ | ○ |

### 5.2 Where C/D/E exceed appointments

1. **Class commerce** — Credits (FIFO expiry), course bundles, Stripe memberships, multi-session cart, recurring materialization, entitlement precedence (`CLASS_COMMERCE_PRODUCT_RULES.md`). No equivalent **appointment package** product exists yet (appointments review Tier 2).

2. **Event ticket lines** — Multi-tier pricing at create with quantity; native to `event_ticket` model.

3. **Resource hire mechanics** — Min/max duration, slot intervals, per-date exceptions calendar — purpose-built for room/facility hire.

### 5.3 Where appointments remain the reference

1. **Guest lifecycle after booking** — Reschedule/modify on `/manage/[bookingId]/[token]` embeds `AppointmentBookingFlow` for appointments; C/D/E excluded via `showGuestModify = canModify && !isCde`.

2. **Staff operational editing** — `StaffAppointmentModifyForm` vs `cde_details` branch (contact, internal notes, message: slot cannot move here).

3. **Calendar manipulation** — Drag, duration resize, undo, guest notify defer — appointment bookings only; resource rows explicitly non-draggable.

4. **Validation endpoints** — `validate-appointment-slot`, `validate-appointment-modification` — appointment-only.

5. **Public URL depth** — Per-practitioner booking slug for marketing individual stylists.

6. **Help and onboarding content** — Appointments have structured help articles; C/D/E rely more on in-product tooltips and founder-led onboarding.

### 5.4 Architecture note — unified engine vs dedicated flows

`BookingFlowRouter` documents the current split:

- **Appointments** — `AppointmentBookingFlow` backed by unified calendars + `service_items`.
- **C/D/E** — Dedicated legacy flows; engine support exists (`getUnifiedAvailableSlots`, `event_sessions`); **full UI consolidation is a future cutover**, not current behaviour.

This is intentional technical debt: shipping parity on **guest modify** and **staff reschedule** does not require waiting for flow consolidation.

---

## 6. Staff tools — setup and management

### 6.1 Navigation and discovery

`DashboardSidebar` injects model-specific links from `MODEL_NAV_ITEMS`:

| Model | Sidebar label | Route |
|-------|---------------|-------|
| `event_ticket` | Events | `/dashboard/event-manager` |
| `class_session` | Classes | `/dashboard/class-timetable` |
| `resource_booking` | Resources | `/dashboard/resource-timeline` |
| `unified_scheduling` | Services | `/dashboard/appointment-services` |

Secondary models appear when listed in `enabled_models`. **Calendar Availability** (`/dashboard/calendar-availability`) shows for unified/practitioner primary **or** when C/D/E are primary/secondary (`shouldShowAppointmentAvailabilitySettings`).

**Settings → Booking types** (`BookingTypesSection`): admin enables/disables models on the appointments plan; links to each manager for setup.

**Setup checklist** (`SetupChecklist`, `compute-setup-status.ts`): per-model gates — e.g. at least one class type, one experience event, one resource calendar before “complete.”

### 6.2 Event manager

**Surface:** `EventManagerView` — create/edit experiences, dates, capacity, ticket types, Stripe pricing, recurrence.

**APIs:** `api/venue/experience-events` (CRUD), `[id]/attendees`, `[id]/cancel`, `event-offerings` for public/staff catalog.

**Lib:** `lib/experience-events/` — validation, calendar window conflicts, zod schemas.

**Cron:** `materialize-event-sessions` — materializes bookable sessions for calendars tied to events.

**Compared to appointment services:** Events are **instance-catalogue** oriented (discrete dates) rather than **repeating service + practitioner assignment**. No variants, buffers, or processing time — appropriate for ticketed experiences.

**Gaps:** No in-manager bulk duplicate; staff must cancel + recreate to change ticket mix (v1 refund policy). No staff email alert on new sale (locked out of scope).

### 6.3 Class timetable and commerce

**Timetable surface:** `ClassTimetableView` — class types, weekly rules, generated instances, cancel/override capacity, link to roster.

**Commerce surface:** `/dashboard/class-timetable/products` — `ClassCommerceProductsClient` for credit packs, courses, memberships.

**APIs:** `classes`, `class-instances` (+ bulk, cancel, attendees), `class-offerings`, `class-availability`, `class-*-products`, `class-commerce-reports`, `classes/generate-instances`.

**Lib:** `lib/availability/class-session-engine.ts`, `lib/class-commerce/*` (entitlement, consume credits, fulfill purchases, recurring materialize), `lib/class-instances/*`.

**Cron:** `class-recurring-materialize`.

**Compared to appointments:** Classes add **product catalog + entitlement engine** appointments lack. Timetable is **analogous to appointment services + calendar** but uses **instances** (concrete dates) not free-form slot picking.

**Gaps:** No drag-move instance from calendar (staff use timetable). Instructor assignment is FK + display name, not full practitioner service matrix.

### 6.4 Resource timeline

**Surface:** `ResourceTimelineView` — CRUD on `unified_calendars` where `calendar_type='resource'`; `ResourceExceptionsCalendar` for per-date closed/replacement hours.

**APIs:** `resources`, `resources/[id]`, `resource-options`, `resource-calendar`, `resource-availability`.

**Lib:** `lib/availability/resource-booking-engine.ts`, `lib/booking/resource-host-calendar-conflicts.ts`.

**Compared to appointments:** Resources use **duration-based slots** (min/max minutes, interval) not service catalogue. **Host calendar** intersection is richer than a simple practitioner column.

**Gaps:** No `ResourceInstanceDetailSheet` on main calendar (staff jump to timeline). Multi-resource bookings unclear in UI.

### 6.5 Staff-created bookings (all models)

**Unified entry:** `/dashboard/bookings/new` — tabbed client loads flows via `StaffSurfaceBookingStack`:

- `AppointmentBookingFlow`
- `ClassBookingFlow`
- `EventBookingFlow`
- `ResourceBookingFlow`

**Modal entry:** Same stack from calendar and bookings list (`DashboardStaffBookingModal`).

**Create APIs:** Public `api/booking/create` branches per model; staff paths use venue bookings APIs with `bookingAudience: 'staff'`.

**Parity with appointments:** ● Staff can place all four types when model enabled. ◐ Audit/events timeline parity with appointment staff actions should be verified per booking type.

### 6.6 Staff modify existing bookings

`StaffExpandedBookingModifyModal` routes:

| Branch | Models | Capabilities |
|--------|--------|--------------|
| `appointment` | unified_scheduling | Full slot/service change via `StaffAppointmentModifyForm` |
| `table` | table_reservation | Table assignment modify |
| `cde_details` | event, class, resource | Guest contact, internal notes only |

**Explicit UX message:** slot cannot be moved here — cancel and rebook.

This is the **largest staff-side gap** vs appointments for C/D/E operations.

---

## 7. Working page integration

### 7.1 Practitioner calendar (`/dashboard/calendar`)

| Integration | Appointments | C/D/E |
|-------------|--------------|-------|
| Schedule feed API | ● | ● `api/venue/schedule` loads CDE when enabled |
| Week CDE strip | — | ● `WeekScheduleCdeStrip` — click event/class; resource links to timeline |
| Month grid counts | appointment blocks | ● per-day counts for event/class/resource |
| Drag-reschedule | ● | ○ resource bookings: `canDrag` false if `resource_id` |
| Detail sheets | `AppointmentDetailSheet` | ● `EventInstanceDetailSheet`, `ClassInstanceDetailSheet` |
| Resource detail on calendar | — | ○ deep-link only |

**Assessment:** Calendar is **appointment-first for manipulation**; C/D/E are **visibility + roster entry points**. Acceptable for MVP if managers are complete — friction for hybrid venues doing same-day changes on the calendar.

### 7.2 Bookings list (`/dashboard/bookings`)

When `isAppointmentDashboardExperience` (appointments SKU or unified primary):

- **`AppointmentBookingsDashboard`** — unified list with type pills; `CDE_MODELS` filter; expanded rows show `cde_context` (event name, class summary, resource name).

When table-primary:

- **`BookingsDashboard`** — still surfaces C/D/E when secondaries enabled.

**List API:** `api/venue/bookings/list` selects `experience_event_id`, `class_instance_id`, `resource_id`.

**Parity:** ● List, filter, expand, message, check-in. ◐ Modify from list opens appointment modify or CDE details-only.

### 7.3 Day sheet

`DaySheetView` — labels C/D/E when table-primary venue has secondaries. **Dining-oriented**; not the primary ops surface for appointment businesses running classes.

### 7.4 Dashboard home

`lib/dashboard/dashboard-home-payload.ts` — appointment-tone alerts and widgets. **Limited C/D/E-specific home cards** (e.g. today’s class fill %, event sales today). Gap for hybrid venue at-a-glance ops.

### 7.5 Reports

| Report type | C/D/E support |
|-------------|---------------|
| General `ReportsView` | ◐ `report_by_booking_model` field exists in types; **not deeply segmented in UI** for mixed venues |
| Class commerce | ● dedicated API + dashboard consumption |
| Event/resource revenue breakdown | ◐ inherits booking aggregates; lacks event-tier analytics |

**Unified booking doc requirement:** Sprint 4 breakdown by `booking_model` — **partially met**, not marketing-ready for “events P&L” standalone.

### 7.6 Import

`/dashboard/import/*` — reference resolution for `event`, `class`, `resource` types; denormalization in `lib/import/*`. **Works** for migration — important differentiator vs competitors who ignore events/classes in import.

---

## 8. Guest booking and management

### 8.1 Public entry points

| URL | Behaviour |
|-----|-----------|
| `/book/[venue-slug]` | `BookPublicBookingFlow` — tabs per enabled model |
| `/book/[venue-slug]/[practitioner-slug]` | Appointments only |
| `/embed/[venue-slug]` | Same tab contract; postMessage height |
| `/book/c/[collective-slug]` | Multi-venue collective |

Tab contract: `lib/booking/public-book-tabs.ts` — must stay aligned with `Docs/Embed_Public_Booking_URL_Contract.md`.

### 8.2 Flow comparison

| Step | Appointments | Events | Classes | Resources |
|------|--------------|--------|---------|-----------|
| Catalogue pick | Service + variant + practitioner | Event + ticket tiers | Class instance / cart | Resource + duration |
| Availability | Engine + validate endpoint | Offerings + capacity | Offerings + credits | Month grid + slots |
| Auth for paid | Policy toggle | Same | **Required** for cart/commerce | Same |
| Payment | Stripe Connect PI | Same | Same + credit deduct | Same |
| Confirmation | Email/SMS | Same | Same | Same |

**Classes unique steps:** credit balance check, membership allowance, multi-session cart quote (`class-cart/quote`, `class-cart/checkout`).

### 8.3 Manage and confirm links

| Path | Appointments | C/D/E |
|------|--------------|-------|
| `/manage/[bookingId]/[token]` | View, **modify**, cancel | View, **cancel only** |
| `/confirm/[bookingId]/[token]` | Confirm / cancel SMS | Confirm / cancel |

Code reference — guest modify gate:

```184:184:src/app/manage/[bookingId]/[token]/ManageBookingView.tsx
  const showGuestModify = canModify && !isCde && (isAppointment || isTableBooking);
```

**Product rule (locked):** `Docs/ReserveNI_Unified_Booking_Functionality.md` — guest modify (change time) **out of v1** for C/D/E unless aligned with appointment reschedule shipping.

### 8.4 Cancellation and refunds

- **v1:** Whole-booking cancel only for all models; no partial ticket line refunds (events).
- **Policy:** `cancellation_deadline`, `cancellation_policy_snapshot` on booking row — populated for paid C/D/E.
- **Classes paid with credits:** restore credits on allowed cancel per `CLASS_COMMERCE_PRODUCT_RULES.md`.

---

## 9. Customer account portal

### 9.1 Navigation structure

`AccountNav` primary links:

| Section | Relevance |
|---------|-----------|
| Overview | All |
| Bookings | **All models** — `loadAccountBookings` |
| Classes | **Class hub** — links to commerce sub-pages |
| Credits / Courses / Memberships / Recurring | **Class commerce only** |
| Payment methods | Connect per-venue saved cards |
| Profile / Security | All |

**Missing:** `/account/events`, `/account/resources` — events and resources appear only under generic **Bookings**.

### 9.2 Bookings list behaviour

- `account/bookings/page.tsx` — loads any `booking_model`.
- **Class multi-session:** collapsed by `group_booking_id` in `lib/account/account-bookings.ts`.
- Detail: `account/bookings/[bookingId]/page.tsx`.

### 9.3 Class commerce portal (ahead of appointments)

Authenticated users can:

| Action | Route |
|--------|-------|
| View/purchase credit packs | `/account/credits` |
| Enroll in courses | `/account/courses` |
| Manage memberships | `/account/memberships` |
| Manage recurring class reservations | `/account/recurring` |
| Saved payment methods | `/account/payment-methods` |

`api/account/class-commerce-venues` — venues where user has class products.

**Gap vs appointments:** No appointment packages, no “my upcoming appointments” hub separate from bookings list (appointments use same list).

### 9.4 Account portal parity summary

| Capability | Appointments | Classes | Events | Resources |
|------------|:------------:|:-------:|:------:|:---------:|
| List in /account/bookings | ● | ● | ● | ● |
| Dedicated hub page | ○ | ● | ○ | ○ |
| Self-modify booking | ◐ (manage link) | ○ | ○ | ○ |
| Commerce / subscriptions | ○ | ● | ○ | ○ |
| Saved cards | ◐ | ● | ◐ | ◐ |

---

## 10. Strengths and differentiators

### 10.1 Platform strengths (C/D/E specific)

1. **All three models on Appointments Light** — acquisition wedge vs competitors charging extra for “classes module.”

2. **Class commerce depth** — Entitlement engine, FIFO credits, Stripe memberships on Connect, multi-session atomic checkout — exceeds typical salon “class list” features and matches fitness-studio expectations (Mindbody/Vagaro class) without a second product.

3. **Single bookings list + CRM** — Event ticket buyer and class attendee and resource hirer share the same contact record and comms abstraction.

4. **Import with C/D/E reference types** — Lower switching cost for venues running workshops, weekly classes, and room hire alongside appointments.

5. **CDE reminder cron** — Separate `cde_reminder_1/2` path in `send-communications` — model-aware scheduling without double-sending appointment reminders.

6. **Linked venues + collectives** — Rare in SMB scheduling; supports NI studio networks and tourism collectives running mixed programming.

### 10.2 Honest weaknesses

1. **Post-booking friction** — Guests must call/email to move a class or event; staff cancel+rebook.

2. **Calendar ops asymmetry** — Hybrid venues see appointments move on drag; classes/events/resources do not.

3. **Portal asymmetry** — Class members get a rich hub; event attendees and resource bookers get a thin bookings row.

4. **Reporting** — Class commerce reports exist; no equivalent “event sales by tier” or “resource utilisation” dashboard.

5. **Four separate public flow bundles** — Larger embed payload if all tabs enabled; consolidation deferred.

---

## 11. Gap analysis

Gaps ordered by **impact on C/D/E venues × distance from appointment reference**.

### Tier 1 — Operational parity (must ship for “hybrid studio ready”)

| Gap | Models | Why it hurts | Current state |
|-----|--------|--------------|---------------|
| **Guest self-modify / reschedule** | C, D, E | #1 support call driver after book | `ManageBookingView` blocks CDE |
| **Staff slot modify** | C, D, E | Reception cannot fix mistakes without cancel | `cde_details` branch only |
| **Calendar move for class instance** | D | Instructor illness → move one session | Timetable only, not calendar drag |
| **Resource detail on calendar** | E | Ops wants one surface | Timeline-only |
| **Reports by booking_model in UI** | C, D, E | Owner cannot see event vs class revenue split | Partial types, weak UI |

### Tier 2 — Commerce and retention (classes-led)

| Gap | Models | Why it hurts |
|-----|--------|--------------|
| **Appointment packages** | B (uses class patterns) | Salons want prepaid bundles — class packs ≠ haircut packages |
| **Guest-facing event hub in account** | C | Repeat ticket buyers want “my events” |
| **Partial ticket refund** | C | Large events need line-level refunds — locked v1 |
| **Class waitlist** | D | Full classes = lost revenue — Mindbody default |
| **PDF roster** | C, D | Printed sign-in sheet at door |

### Tier 3 — Polish and consolidation

| Gap | Notes |
|-----|-------|
| Unified `BookingFlowRouter` cutover | Reduce maintenance; not user-visible until parity |
| Dedicated help articles for C/D/E | Reduce support load |
| Dashboard home widgets per model | Today’s classes, ticket sales |
| Multi-resource booking UX | Room + equipment |
| Equipment bundles | Competitor feature |

### Tier 4 — Inherited from appointments roadmap

These affect C/D/E guests equally but are tracked in the appointments review:

- Native staff mobile app  
- WhatsApp / two-way inbox  
- Reserve with Google  
- Chair-side checkout (less relevant for pure class/event venues)

**Recommendation:** Ship **CDE Tier 1** in the same programme as **appointment guest reschedule** (P1.1 in appointments plan) — shared `/api/confirm` or account modify infrastructure, model-specific validation in each engine.

---

## 12. Implementation plan

Horizon: **May 2026 → May 2027**. Phases align with appointments review where shared infrastructure applies.

### Phase 0 — Foundation (Weeks 1–4, May–Jun 2026)

| ID | Work | Outcome |
|----|------|---------|
| C0.1 | `BookingModifySurface` abstraction — props: model, bookingId, policy | One modal pattern for staff + guest |
| C0.2 | Engine validation wrappers: `validate-class-modification`, `validate-event-modification`, `validate-resource-modification` | Mirror `validate-appointment-modification` |
| C0.3 | Feature flags: `cde-guest-modify`, `cde-staff-modify` | Safe rollout per model |
| C0.4 | Extend Playwright: public class book → manage link cancel; event book → confirm | Regression |

### Phase 1 — Guest and staff modify (Weeks 5–14, Jun–Aug 2026)

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| C1.1 | **Guest class reschedule** | P0 | Policy-aware; same instance vs move instance; credit/membership re-attach |
| C1.2 | **Guest event change** | P1 | v1: cancel+rebook UX with policy copy OR move to same event series instance if capacity |
| C1.3 | **Guest resource reschedule** | P1 | New slot picker in manage link; `resource-booking-engine` validation |
| C1.4 | **Staff CDE modify forms** | P0 | Replace `cde_details`-only with slot change where engine allows |
| C1.5 | Enable `showGuestModify` for CDE behind flag | P0 | `ManageBookingView` + embedded mini-flows per model |

**Exit:** Demo “change my class time” without support ticket.

### Phase 2 — Calendar and ops (Weeks 10–20, Jul–Oct 2026)

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| C2.1 | `ResourceInstanceDetailSheet` | P1 | Parity with event/class sheets |
| C2.2 | Class instance drag on calendar (optional) | P2 | Or “move” action in sheet |
| C2.3 | Reports UI: filter/tabs by `booking_model` | P1 | Unified booking doc Sprint 4 |
| C2.4 | Dashboard home: today’s classes + upcoming events cards | P2 | |
| C2.5 | Class waitlist (capacity full → notify on space) | P2 | Separate from table waitlist |

### Phase 3 — Portal and commerce (Weeks 16–28, Sep 2026–Jan 2027)

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| C3.1 | `/account/events` hub | P2 | List + tickets for `event_ticket` |
| C3.2 | `/account/resources` or merge into bookings with filters | P3 | |
| C3.3 | **Appointment packages** via class commerce engine | P1 | Reuse entitlement — appointments review P2.3 |
| C3.4 | PDF roster export | P3 | Or print-friendly CSS |
| C3.5 | Partial ticket refunds spec + build | P3 | Separate Stripe partial refund design |

### Phase 4 — Consolidation (Weeks 24–40, Nov 2026–May 2027)

| ID | Work | Notes |
|----|------|-------|
| C4.1 | `BookingFlowRouter` unified engine cutover evaluation | Only if modify parity shipped |
| C4.2 | Dedicated help articles: classes, events, resources | |
| C4.3 | Multi-resource booking UX | |
| C4.4 | Event analytics: sales by tier, capacity % | |

### 12.1 Dependency on appointments Tier 1

| Appointments work | Unblocks for C/D/E |
|-------------------|-------------------|
| P0.1 Dialog/Sheet primitives | CDE modify modals |
| P1.1 Guest self-reschedule infrastructure | C1.x guest modify |
| P0.2 Unified `BookingDetailSurface` | Consistent list/calendar/detail |

**Run C0/C1 in parallel with appointment P1.1** — shared confirm/account APIs, model-specific validators.

---

## 13. Success metrics

| Metric | Target (6 months post Phase 1) |
|--------|--------------------------------|
| CDE manage-link **modify** usage | > 15% of eligible CDE bookings use self-serve modify vs cancel-only |
| Support tickets “change my class/event time” | −40% for venues with CDE modify enabled |
| Staff cancel+rebook rate for CDE | −25% (staff using modify instead) |
| Class commerce attach rate | Maintain or ↑ credits/membership purchase conversion |
| Hybrid venue retention (appt + class enabled) | NPS ≥ appointment-only cohort |

---

## 14. Dependencies and risks

| Risk | Mitigation |
|------|------------|
| Class modify breaks credit FIFO | Integration tests on entitlement restore/reconsume |
| Event modify implies partial refund expectation | Clear copy: whole-booking policy until C3.5 |
| Resource modify double-books occupancy | Reuse `resource-booking-engine` atomic check |
| Four flows diverge further | Phase 4 consolidation gate on modify parity |
| Scope creep into POS | Chair checkout stays appointments-track; classes use existing commerce |

---

## 15. Related documents

| Document | Relevance |
|----------|-----------|
| [ReserveNI-Appointments-Functionality-Review-And-Plan-May-2026.md](./ReserveNI-Appointments-Functionality-Review-And-Plan-May-2026.md) | Appointments benchmark, competitive set, Tier 1 salon gaps |
| [ReserveNI_Unified_Booking_Functionality.md](./ReserveNI_Unified_Booking_Functionality.md) | C/D/E parity programme, refund policy, staff-created bookings |
| [ReserveNI_Booking_Models_Reference.md](./ReserveNI_Booking_Models_Reference.md) | Enum vocabulary, flow component names |
| [CLASS_COMMERCE_PRODUCT_RULES.md](./CLASS_COMMERCE_PRODUCT_RULES.md) | Credits, courses, memberships, cart atomicity |
| [Embed_Public_Booking_URL_Contract.md](./Embed_Public_Booking_URL_Contract.md) | Public tab URLs |
| [UI_EXCELLENCE_REVIEW_AND_PLAN.md](./UI_EXCELLENCE_REVIEW_AND_PLAN.md) | Shared Dialog/Sheet for modify surfaces |

---

## 16. Appendix — parity checklist

Use for sprint planning and sales demos. **Y** = shipped · **P** = partial · **N** = not shipped.

### Staff setup

| Item | Events | Classes | Resources |
|------|:------:|:-------:|:---------:|
| Dedicated manager page | Y | Y | Y |
| CRUD via venue API | Y | Y | Y |
| Setup checklist step | Y | Y | Y |
| Settings enable/disable model | Y | Y | Y |
| Onboarding inline create | Y | Y | Y |
| Import reference type | Y | Y | Y |

### Staff operations

| Item | Events | Classes | Resources |
|------|:------:|:-------:|:---------:|
| New booking from dashboard | Y | Y | Y |
| Bookings list filter | Y | Y | Y |
| Calendar visibility | P | P | P |
| Instance/detail sheet | Y | Y | N |
| Roster / attendees | Y | Y | P |
| Staff slot modify | N | N | N |
| Check-in | Y | Y | Y |
| Bulk message guests | Y | Y | Y |

### Guest public

| Item | Events | Classes | Resources |
|------|:------:|:-------:|:---------:|
| Public tab on /book | Y | Y | Y |
| Embed tab | Y | Y | Y |
| Pay deposit/full online | Y | Y | Y |
| Manage link cancel | Y | Y | Y |
| Manage link modify | N | N | N |
| SMS confirm link | Y | Y | Y |

### Account portal

| Item | Events | Classes | Resources |
|------|:------:|:-------:|:---------:|
| Appears in /account/bookings | Y | Y | Y |
| Dedicated hub section | N | Y | N |
| Commerce (packs/subs) | N | Y | N |
| Saved payment methods | P | Y | P |

### Comms & reporting

| Item | Events | Classes | Resources |
|------|:------:|:-------:|:---------:|
| Confirmation email/SMS | Y | Y | Y |
| Scheduled reminders | Y | Y | Y |
| Model-specific reports | N | Y | N |
| Reports by booking_model UI | P | P | P |

---

*End of document.*
