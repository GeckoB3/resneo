# Resneo Unified Booking Functionality - Delivery Plan & Reference

> **Status (May 2026): substantially delivered.** This began as the four-sprint
> delivery plan to bring Models C/D/E (events, classes, resources) to parity with
> Models A/B. That parity work has **shipped** — multi-model venues run end-to-end
> across public booking, staff tools, the unified calendar, bookings list/detail,
> reports and dashboard home. See
> `Docs/Resneo-Class-Event-Resource-Functionality-Review-And-Plan-May-2026.md`
> for the current per-model review and any remaining polish items.
>
> The document is **retained as a reference**, not a to-do list. The parts that
> remain authoritative are the **locked product decisions** below and the policy
> sections — refunds (whole-booking only in v1), the `enabled_models` compatibility
> matrix, RBAC rules, and the public `?tab=` slug contract (Appendix A). The
> sprint checklists are now a **historical record of how the work was scoped**.
> Where this plan and the current review/roadmap docs disagree, the review/roadmap
> docs win.

## Normative references

- **`Docs/Resneo_Booking_Models_Reference.md`** - Vocabulary for all six `BookingModel` values, public **flow components** (`BookingFlow`, `AppointmentBookingFlow`, `EventBookingFlow`, `ClassBookingFlow`, `ResourceBookingFlow`), and the distinction between **ticketed events** (`experience_events`) vs **calendar sessions** (`event_sessions`). Implementation and UI copy should stay aligned with that document.
- **`Docs/archive/ReserveNI_Unified_Scheduling_Engine_Plan.md`** - Unified Scheduling Engine (USE) for Model B (archived — engine shipped; retained for architecture rationale).
- **`Docs/PRD.md`** - Canonical product / pricing when **billing rules** for secondaries or tiers change (see **Billing and plan limits**).
- This file - **delivery plan** for multi-model parity and C/D/E completeness.

This document is **implementation guidance only** (no application code in this file).

### Locked product decisions (this revision)

| Topic | Decision | Where detailed |
|-------|----------|----------------|
| **Refunds / ticket lines** | **Option (a)** - whole booking only in v1 (no partial line refunds or quantity edits). | **Partial refunds and ticket lines (v1 decision)** under Payments |
| **Staff alerts for new bookings** | **Do not implement** for C/D/E in v1; Model B does not send them either. | **Operational extras** |
| **Staff calendar implementation** | **Option A** - extend **`PractitionerCalendarView`** into a multi-feed Schedule view (not a separate-only `VenueScheduleView` shell). | **4.2 Staff calendar** |

---

## North-star outcome

A venue **onboards with exactly one primary bookable service type** (`venues.booking_model`) - the main revenue and public-booking default. The venue **may add further bookable service types** at any time (`venues.enabled_models`), each with its own staff tools, engines, and guest flows.

**Complete product behaviour** means:

- **Onboarding** reflects the primary type only at first; optional checklist points at secondary types once enabled.
- **Settings** exposes primary vs secondary booking types, notification rules, and (where needed) per-model timing.
- **Dashboard** sidebar, **bookings** list/detail, **calendar**, **reports**, and **home** all **aggregate and filter** bookings across the primary model **and** every enabled secondary model - not appointments-only or “first model only.”
- **Guest-facing** booking, confirmation, reminders, and **manage/cancel links** behave correctly for **every** model the venue exposes.
- **Comms** stay deduplicated and model-aware; **RLS** and APIs remain safe when `enabled_models` expands surface area.

---

## Parity target - Models C / D / E vs Model A / B

“Parity” here means **guest and staff can run the venue end-to-end** for events, classes, and resources at a **similar level of completeness** as **table reservations (A)** and **unified appointments (B)**: catalogue management, booking, payment where applicable, cancellation rules, comms, roster/attendance, reporting, and dashboard surfaces - **not** that every legacy restaurant-only feature (e.g. floor plan) applies to C/D/E.

| Dimension | Model A / B (reference behaviour) | C / D / E must deliver |
|-----------|-----------------------------------|-------------------------|
| **Public book → pay** | Deposits / Stripe Connect, confirmation | Same **payment + confirmation** path for paid C/D/E bookings: PaymentIntent / `confirm-payment` / webhooks **idempotent**; booking row stores amounts and PI ids consistently with B where applicable. |
| **Guest self-serve** | Confirm/cancel links, refund against `cancellation_deadline` | **GET/POST `/api/confirm`** + UI show correct copy for non-appointment bookings; **full booking cancel** in v1; **no partial ticket/line refunds in v1** - see **Partial refunds and ticket lines (v1 decision)**. |
| **Staff operations** | Manual / phone bookings, venue APIs, status changes | **Staff-created bookings** for C/D/E (walk-in / phone) via venue booking APIs or **New Booking** flows - see **Staff-created bookings** section. |
| **Catalogue CRUD** | Tables/services/calendars | Events, class types + timetable + instances, resources - full CRUD as in Sprint 2. |
| **Comms** | Confirmation + reminders, dedup | Model-aware templates; no double-send with unified cron; **failed send** handling: log + same retry posture as existing comms (no silent drop without log). |
| **Reporting** | Revenue / volume | Sprint 4: **breakdown by `booking_model`**; optional **deposit vs captured** columns if B already splits - align report shape with B for mixed venues. |
| **Attendance / ops** | Table assignment / guest confirm | `checked_in_at`, rosters; optional **print/export roster** - see **Operational extras**. |

---

## Context

> **Historical context — written before delivery.** Retained to show the starting
> point. See the status banner at the top of this document for what shipped.

Resneo had Model A (`table_reservation`, complete) and Model B (`practitioner_appointment` / `unified_scheduling`, MVP shipped). Models C (`event_ticket`), D (`class_session`), and E (`resource_booking`) had database tables, availability engines, basic booking flow components, partial dashboard views, and venue API routes - but lacked staff CRUD parity, complete guest booking UX, comms/reminders, and attendee/roster management.

The goal was to bring C, D, E to parity with B (and operational completeness comparable to A/B where relevant), align post-signup onboarding with signup, and deliver **multi-model venues** end-to-end - including **reports, calendar, and dashboard home** - not only the public booking page and bookings list. **This has since been delivered** (May 2026).

---

## Primary `table_reservation` + secondary models (`enabled_models`)

When the **primary** is **restaurant (Model A)** and secondaries (e.g. `event_ticket`) are enabled:

| Topic | Rule |
|-------|------|
| **Waitlist / floor plan** | Remain **table-only** features. Do not attach restaurant waitlist semantics to event/class bookings without a dedicated Phase 2 design. |
| **Sidebar / public** | Secondary models appear in **nav** and **public tabs** like any other multi-model venue. |
| **Calendar** | Must show **non-table** bookings when secondaries are enabled (Sprint 4); restaurant calendar views stay valid for **table** bookings only if product keeps separate subviews - **minimum:** filters by model so staff never lose C/D/E. |
| **Reports / home** | Aggregate **all** enabled models; label segments clearly (“Reservations” vs “Event tickets”). |
| **Compatibility** | See **`enabled_models` compatibility (default policy)** below - Settings PATCH enforces validation rules; **v1 default** is permissive (no arbitrary X+Y blacklist). |

---

## `enabled_models` compatibility (default policy)

**Goal:** Remove mid-sprint product debate. Unless commercial rules change later, use this matrix.

| Rule | Detail |
|------|--------|
| **Secondaries allow-list (v1)** | Only **`event_ticket`**, **`class_session`**, **`resource_booking`** may appear in `enabled_models`. Do not add `table_reservation` or duplicate the primary as a secondary. |
| **Combinations** | **Allow any combination** of C/D/E secondaries together (e.g. events + classes + resources) if the venue enables them - **no MVP blacklist** of pairs unless a technical conflict appears (none expected in current architecture). |
| **Validation** | Reject: duplicate entries, repeating `booking_model`, invalid enum values, values outside the allow-list. |
| **Restaurants + secondaries** | **Allowed** - e.g. primary `table_reservation` with `event_ticket` - subject to **Primary `table_reservation` + secondary models** rules (waitlist stays table-only). |

Product may later restrict combinations for **billing** reasons; engineering should not invent restrictions beyond this section without an updated PRD.

---

## Staff-created bookings (phone / walk-in)

Model B supports staff creating bookings from the dashboard; C/D/E should not rely only on the public site.

**Requirements:**

- **Venue APIs** (`POST`/`PATCH` under `src/app/api/venue/bookings` or dedicated routes): Support creating and updating bookings with **`booking_model`** implicit or explicit, correct **FKs** (`experience_event_id`, `class_instance_id`, `resource_id`, `ticket_lines`, `capacity_used`, `booking_end_time`, etc.), **pricing** consistent with public `booking/create`, and **same validation** as guest create (availability engines).
- **UI:** **`/dashboard/bookings/new`** (or equivalent) must allow staff to place **event / class / resource** bookings when those models are primary or enabled - or document a **single** “Quick add” path per model from the relevant manager view (events / timetable / resources). Pick **one** UX pattern and implement consistently.
- **Audit:** Staff actions should appear in booking **events** / timeline where Model B already does.

---

## Payments, Stripe, and refunds

**Reference implementation:** Existing **`booking/create`**, **`confirm-payment`**, **Stripe webhooks** (`app/api/webhooks/stripe`), Connect direct charges - **extend**, do not fork, for C/D/E.

| Topic | Requirement |
|-------|-------------|
| **PaymentIntent lifecycle** | C/D/E paid bookings follow the same **success / failure / webhook** patterns as B; handlers remain **idempotent**. |
| **Booking row shape** | `deposit_amount_pence`, `deposit_status`, `stripe_payment_intent_id`, `cancellation_deadline`, `cancellation_policy_snapshot` populated for C/D/E when paid or cancellable - **required** for guest cancel/refund. |
| **Full cancel (guest or staff)** | Cancelling the **entire booking** refunds per policy (full PI refund or none per window). **Only** path for refunds in v1 - see below. |

### Partial refunds and ticket lines - v1 decision (Option A - locked)

**Decision:** **Option (a) - whole booking only in v1.** There are **no** partial refunds, partial ticket-line adjustments, or quantity-only changes in v1. Any refund path operates on the **entire** `bookings` row and its **full** PaymentIntent (or policy-defined no-refund).

**Rationale (brief):** Avoids partial Stripe refunds, `ticket_lines` reconciliation complexity, and support edge cases until a future phase explicitly scopes Option (b).

**Implementation requirements:**

| Area | Instruction |
|------|-------------|
| **Stripe** | Use **full** `stripe.refunds.create` on the booking’s PI when policy allows - **no** partial refund amounts for ticket line adjustments in v1. |
| **Guest cancel / `/api/confirm`** | Only **cancel whole booking** → refund or not per `cancellation_deadline` + policy. **Do not** expose UI to “remove one ticket type” or “reduce quantity” without cancelling the whole booking. |
| **Venue APIs** | **PATCH** on bookings must **not** support partial line-item edits that imply partial refund in v1. If staff must change an order, **cancel + recreate** (new booking) or handle offline; document in staff UX if needed. |
| **`event_ticket` / `ticket_lines`** | **Read** for display, pricing at create, and **full-booking** cancellation. **Do not** add endpoints that mutate `ticket_lines` in place for a subset of lines in v1. |
| **Copy / confirm emails** | State clearly that changes to ticket quantities require **cancelling the booking** (where policy allows) and rebooking - or contact the venue. |
| **Phase 2** | Partial refunds / line-level changes require a separate spec (Stripe partial refunds, inventory, disputes). |

**Release notes:** Record “v1: event ticket refunds are full-booking only” in changelog for venue-facing comms.

### Billing and plan limits (engineering default)

| Topic | Default for v1 |
|-------|----------------|
| **Secondary models** | Treat **`enabled_models`** as a **product capability**, not a separate Stripe meter, unless **`Docs/PRD.md`** or pricing docs explicitly add a billable add-on. |
| **`calendar_count`** | Stays tied to **unified scheduling / practitioners** as today - **do not** auto-increase `calendar_count` when a venue enables a secondary C/D/E model (different concept). |
| **Subscription SKU** | Implementing secondaries **must not** require engineering to invent new Stripe price IDs; if product later ties “Business tier = N secondaries” to billing, document in PRD and implement then. |

If pricing changes, update **`Docs/PRD.md`** (or the canonical pricing spec) and reference it here - avoid blocking the build on unstated commercial rules.

---

## RBAC - staff vs admin

Today some nav items (e.g. reports, availability) are **admin-gated**. For C/D/E:

| Area | Default policy (adjust if product disagrees) |
|------|-----------------------------------------------|
| **Event manager / class timetable / resources** | **All dashboard staff** for the venue can access **unless** a section handles PII or payouts - then **admin-only**. |
| **Settings → Booking types / enable secondaries** | **Admin** (venue owner) only - matches sensitive venue configuration. |
| **Settings → Communications templates** | Match existing Settings rules (often admin; if staff can edit comms today, keep parity). |
| **Reports** | Keep existing **admin-only** rule unless product explicitly opens reports to staff. |

Document final rules in Settings UI and enforce in API routes.

---

## Operational extras (explicit scope)

| Feature | Scope |
|---------|--------|
| **Print / PDF roster** (classes, events) | **Phase 2** unless quick win: export CSV from roster view counts as MVP. |
| **Staff notification** on new C/D/E booking (email/SMS to venue) | **Out of v1 - locked.** Model B **does not** currently send staff alerts for new appointments; **do not** implement new staff-facing “new booking” alerts for C, D, or E in this programme. Staff discover bookings via **Bookings** list, **dashboard home**, **calendar**, and **roster** views. **Phase 2:** revisit if product adds global staff alerts for B + C/D/E together. |
| **Guest modify booking** (change time) | **Out of v1** for C/D/E unless `/api/confirm` already supports `modify` for B - align with existing confirm route capabilities. |
| **Duplicate booking** | **Out of v1** unless trivial; staff can create a new booking. |

---

## Architectural decision: multi-model foundation

### How it works (Vagaro/Mindbody pattern)

| Concept | Role |
|--------|------|
| `venues.booking_model` | **Primary** model - default public booking experience, main onboarding path, base terminology, and “anchor” for billing/plan assumptions where applicable. |
| `venues.enabled_models` | JSONB array of **additional** `BookingModel` values (no duplicates; must not repeat `booking_model`). |
| Dashboard | `DashboardSidebar` renders nav for **primary + all enabled secondaries** (deduplicated); ordering: primary group first, then secondaries in a stable order (e.g. enum order). |
| Public booking | `/book/[slug]` leads with primary flow; secondaries appear as tabs when `enabled_models.length > 0`. URL and tab state - see **Public URL and tab state (Sprint 3)**. |
| Settings | Admin enables secondaries, runs mini-setup, and configures notification defaults/overrides (see below). |

### Important: two different “event” concepts in code (do not conflate)

The codebase today has **two** event-like paths:

| Mechanism | Booking model | Data | Typical use |
|-----------|-----------------|------|-------------|
| **A - Ticketed / marketing events** | `event_ticket` | `experience_events`, ticket lines on `bookings` | Festivals, one-off ticket sales, `EventBookingFlow`. |
| **B - Calendar sessions (unified engine)** | `unified_scheduling` | `event_sessions` + `unified_calendars`, optional `service_items` | Session blocks on a calendar (e.g. group slots), booked via `event_session_id` in `booking/create`. |

**Plan requirement:**

- Product copy and **internal docs** must **name these distinctly** (e.g. “Events (tickets)” vs “Calendar sessions” / “Group sessions”) wherever both can appear for the same venue.
- **UI** must not merge them into one list without clear labelling.
- **Scope for this plan:** parity work for **C (`event_ticket` / `experience_events`)** and **D/E** as documented; **unified `event_sessions`** remain the unified-scheduling feature - when a venue is `unified_scheduling` + `enabled_models` includes `event_ticket`, staff see **both** relevant nav areas and reporting filters for **both** session bookings and ticketed events.

Future “single events module” consolidation is **out of scope** unless explicitly scheduled; this plan only requires **coexistence without data corruption** and **clear terminology**.

---

## Database migrations and booking policy storage

### Required columns

```sql
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS enabled_models jsonb NOT NULL DEFAULT '[]'::jsonb;
```

### Migration and rollout

- **`enabled_models`:** `NOT NULL DEFAULT '[]'::jsonb` - every existing venue row gets **no secondaries** after migration.
- **Behaviour:** **No change** to public or staff experience for existing customers until they (or support) enable secondaries via Settings (or admin tools) - no forced opt-in.
- **Support / comms:** “Nothing new appears until the venue adds another booking type in Settings.”
- **Feature flag:** Not required for the column itself; the **UI + Settings** that surface secondaries gate the feature.

**Attendance:** Add nullable `bookings.checked_in_at TIMESTAMPTZ`. Use for door check-in and rosters for C/D/E. Do **not** overload `status = 'Seated'` for non-table attendance. **Audit first:** align with `client_arrived_at`, `guest_attendance_confirmed_at`, and any newer columns so one **canonical** attendance story is documented in migrations + app layer.

### Policy and notification storage (venue-level)

To support **per-model** cancellation windows and **reminder lead times** without six duplicate Settings screens:

- **Minimum:** Extend `venues.booking_rules` JSON (or adjacent JSONB) with namespaced keys, e.g.  
  `cancellation_notice_hours_by_model: { event_ticket?: number, class_session?: number, resource_booking?: number }`  
  and  
  `reminder_hours_before_by_model` or `reminder_offsets` for scheduled comms.
- **Alternative:** Dedicated `venues.notification_preferences` JSONB if `booking_rules` becomes crowded - document the chosen shape in the migration and in `src/lib/notifications/`.

**Rule:** Every booking row used for guest cancel/refund must have **`cancellation_deadline`** (and optional `cancellation_policy_snapshot`) set in **`booking/create`** (or equivalent) using these rules, for **all** models - not only `unified_scheduling`.

---

## Signup and onboarding

### No duplicate business-type step

Signup (`/signup/business-type`, plan, payment) stays the source of truth for `business_type` and primary `booking_model` (`getBusinessConfig` / Stripe provisioning).

### Wizard behaviour

- **`src/lib/business-type-defaults.ts`** (re-exports **`src/lib/business-config.ts`**): Maps `business_type` → defaults (services, class types, sample events/resources, terminology hints) for **pre-fill** only.
- **`src/app/onboarding/page.tsx`:**  
  - Derives **step list** from `venue.booking_model` **and** any already-enabled `enabled_models` (usually empty at first onboarding).  
  - For **primary** `unified_scheduling` / `practitioner_appointment`, keep existing unified steps (hours, services, etc.).  
  - For **primary** C/D/E (admin-provisioned or future signup): show steps relevant to that model (e.g. first event draft, first class type, first resource) without re-asking business category.

### Final step checklist

“Complete your setup” must link to **Events**, **Timetable**, **Resources** as applicable - including when those models are **secondary** (enabled after go-live): checklist items appear when `booking_model` or `enabled_models` includes the relevant type.

### Signup eligibility

`isSignupSupportedBookingModel()` currently limits which primaries can self-serve. Document explicitly:

- **Secondary** models via `enabled_models` are enabled **after** a supported primary exists (e.g. `unified_scheduling` + `event_ticket`).
- **Primary** `event_ticket` / `class_session` / `resource_booking` may require **admin provisioning** until signup is expanded.

---

## Delivery structure (phased)

| Phase | Focus |
|-------|--------|
| **Sprint 1** | Foundation: migrations (`enabled_models`, `checked_in_at`, policy JSON shape), `resolveVenueMode` + sidebar, hybrid comms plumbing, bookings detail model-aware, business-type defaults, **notification defaults in venue JSON**. |
| **Sprint 2** | C / D / E: staff CRUD, guest flow polish, attendance, **cancellation + refund** in create + venue APIs, **resource pricing** formula, instance generation + cron, **staff-created bookings**, **payments alignment**. |
| **Sprint 3** | Multi-model UX: Settings booking types + mini-setup, **public tabs**, terminology, **CommunicationTemplatesSection** updates, **RBAC** applied to new routes. |
| **Sprint 4** | **Cross-cutting surfaces:** unified **calendar**, **reports**, **dashboard home**, **guest confirm/cancel** API + UI enrichment, **embeds** strategy; **RLS** pass. |

Sprints 2–3 can overlap slightly with Sprint 4 only after bookings list/detail and APIs are stable - calendar and reports should consume **one** consistent booking shape per model.

---

## API and route inventory (implementers)

Keep a single mental map so availability and create stay consistent:

| Area | Typical routes / modules |
|------|---------------------------|
| **Public availability** | `src/app/api/booking/availability/route.ts`, `src/app/api/booking/unified-availability/route.ts` - branch by `booking_model` / venue mode. |
| **Public create** | `src/app/api/booking/create/route.ts` - `handleNonTableBooking` for C/D/E and unified B. |
| **Venue bookings** | `src/app/api/venue/bookings/**` - extend for staff create/edit C/D/E with same validation as public. |
| **Staff schedule (calendar)** | New or extended **`src/app/api/venue/...`** route returning merged **Schedule** / `ScheduleBlock[]` for `PractitionerCalendarView` - see **4.2**. |
| **Confirm/cancel** | `src/app/api/confirm/route.ts`. |
| **Cron comms** | `src/app/api/cron/send-communications/route.ts`, `src/lib/cron/unified-scheduling-comms.ts` - scope by venue so unified + C/D/E never double-send. |

---

## Sprint 1: Foundation

### 1.1 Onboarding driven by signup

- Pre-population uses **`getBusinessConfig`** / **`BUSINESS_TYPE_CONFIG`** from **`src/lib/business-config.ts`** (see also **`src/lib/business-type-defaults.ts`**).
- Extend onboarding steps for C/D/E primaries (admin) and for secondaries when present.
- Final checklist with deep links.

### 1.2 `enabled_models` + sidebar + venue mode

- Migration(s) for `enabled_models`, `checked_in_at`, and policy/notification JSON fields as agreed.
- **`resolveVenueMode`:** Load `enabled_models`; type `VenueMode` includes `enabledModels: BookingModel[]`.
- **`DashboardSidebar`:** Nav from `[booking_model, ...enabledModels]` (dedupe, stable order). When **multiple** models are active, **rename generic labels** where needed (e.g. “Appointments” when primary is unified + secondaries exist - see terminology).

**Guardrail:** C/D/E cron/comms must not double-send with `runUnifiedSchedulingComms` / legacy loops - keep venue scoping explicit in code paths.

### 1.3 Communications - hybrid, model-aware

- Fewer canonical **message types** where templates differ only by variables; pass `booking_model` + FK ids into compile/render.
- **`booking/create`:** Send confirmation for C/D/E after successful create.
- **`send-communications`:** Scheduled reminders for C/D/E using **venue notification JSON** (lead times per model or fallback defaults).
- **Dedup:** `communication_logs` uniqueness.
- **Failure:** Log failed sends with context; align retry behaviour with existing comms (no silent swallow).

### 1.4 Bookings dashboard - model-aware detail

- **C / D / E** fields in `ExpandedBookingContent` / `BookingDetailPanel` as already listed.
- **`BookingsDashboard`:** Filters or subtabs **by model** when `enabled_models` is non-empty (optional in Sprint 1 if timeboxed; **required by Sprint 4** at latest).

### 1.5 Notification & cancellation defaults (venue JSON)

- Define and document JSON shape for **cancellation_notice_hours** and **reminder offsets** per model (or global fallback).
- Wire **read** path into template preview / cron **selection** of offsets (full **Settings UI** can land in Sprint 3 if needed).

---

## Sprint 2: Models C, D, E - detailed checklists

Complete **every row** in each checklist before calling the model “done” for the sprint.

### 2A - Event ticket (`EventManagerView`, `EventBookingFlow`)

| Track | Deliverables |
|-------|----------------|
| **Staff / catalogue** | Full event CRUD; ticket types; capacity; recurrence decision (MVP); cancel event with attendee comms. |
| **Attendees** | List; `checked_in_at`; staff cancel booking + refund policy. |
| **Guest public** | `EventBookingFlow` polish; ticket maths; Stripe; confirmation email/SMS. |
| **API** | `GET/PATCH/DELETE` `experience-events/[id]`; check-in route; availability unchanged from engine pattern. |
| **Payments** | PI + booking row fields; **whole-booking refund only** per **Partial refunds and ticket lines (v1 decision)**. |
| **Staff booking** | Create/edit event booking via venue API / New Booking as per **Staff-created bookings**. |

### 2B - Class session (`ClassTimetableView`, `ClassBookingFlow`)

| Track | Deliverables |
|-------|----------------|
| **Staff / catalogue** | Class type CRUD; timetable; `generate-instances` + dedupe + horizon (default 4 weeks); on-demand + optional weekly cron. |
| **Instances** | Cancel instance; notify enrolled guests; capacity integrity. |
| **Roster** | List; `checked_in_at`; export **CSV** minimum for roster optional. |
| **Guest public** | `ClassBookingFlow` polish; payment; confirmation. |
| **Payments / cancel** | Same as 2A where applicable. |
| **Staff booking** | Staff-created class bookings per **Staff-created bookings**. |

### 2C - Resource booking (`ResourceTimelineView` / calendar resource mode, `ResourceBookingFlow`)

| Track | Deliverables |
|-------|----------------|
| **Staff / catalogue** | Resource CRUD; `WorkingHoursControl`-style availability; timeline via `PractitionerCalendarView` **resource mode** or wrapper. |
| **Guest public** | Duration, slots, payment, confirmation. |
| **Pricing** | `booking/create`: `total_price_pence` from duration, `slot_interval`, `price_per_slot_pence` with **documented rounding**. |
| **Payments / cancel** | Full booking cancel + refund rules. |
| **Staff booking** | Staff-created resource bookings per **Staff-created bookings**. |

### Cancellation and refunds (guest + staff)

| Concern | Requirement |
|--------|-------------|
| **Staff** | Venue APIs cancel bookings with policy, Stripe refund when applicable, comms to guest. |
| **Guest** | **`/api/confirm`** POST cancel path already refunds when `cancellation_deadline` + paid deposit + PI exist - **ensure C/D/E bookings populate these fields** and that **GET** returns enough context for the confirm UI. |
| **GET `/api/confirm`** | Extend booking select + JSON: for each model, return **human-readable labels** (event title, class name + instance time, resource name + window) so the guest page is not appointment-only. |
| **Confirm UI** | Guest-facing page(s) that consume `/api/confirm` must branch on **resolved booking type** (from `booking_model` + FK presence), not only `is_appointment`. |

### Waitlist - Phase 2

Restaurant waitlist is table-oriented. **Phase 2:** event/class waitlist + promote on cancel. Explicitly **out of Sprint 2** unless scoped as a thin MVP.

---

## Sprint 3: Multi-model enablement (Settings + public)

### 3.1 Settings - booking types

- Primary `booking_model` (read-only or change-only via support if product requires).
- **Enable secondary models** - validation per **`enabled_models` compatibility (default policy)** and **Primary `table_reservation` + secondary models** where relevant.
- PATCH `enabled_models` with validation (no dupes, no duplicate of primary, allow-list for secondaries).
- **Mini-setup** wizards: deep link to Events / Timetable / Resources seed.

### 3.2 Settings - communications

- **CommunicationTemplatesSection** (and related venue APIs): document **merge variables** for model-aware confirmations/reminders (`event_name`, `class_name`, `resource_name`, etc.).
- If per-model **SMS/email toggles** are required, add without exploding enum cardinality - prefer **one template with branches** unless compliance demands separate types.

### 3.3 Public booking - tabs and URL state

- **`BookPublicLayout`:** Tabs when `enabled_models.length > 0`.
- **`BookingFlowRouter`:** `activeModel` prop; default `venue.booking_model`.
- **Labels:** From terminology + curated strings - primary tab **default and visually primary**.

**Public URL and tab state (canonical):**

| Topic | Decision |
|-------|----------|
| **Source of truth** | **Query parameter `?tab=`** - shareable, bookmarkable, works for **embeds** and support links. |
| **Values** | Stable **slugs** - canonical list in **Appendix A**; **not** raw enum strings in the URL unless product prefers them. |
| **On load** | Read `tab` from `searchParams`; validate against what the venue exposes (`booking_model` ∪ `enabled_models`); invalid or missing → **primary** tab. |
| **On tab change** | **`router.replace`** (or `history.replaceState`) so refresh and shared links preserve the tab - avoid **hash-only** or **client-only** state as the only source of truth. |
| **Embeds** | Same contract as public page - **`?tab=`** on embed URL matches full-page behaviour (see **4.5 Embeds and widgets**). |

### 3.4 Guest UX polish (acceptance criteria)

| Area | Requirement |
|------|-------------|
| **Loading** | Skeleton or inline spinner on **tab** and **step** transitions; avoid blank flashes when switching flows. |
| **Errors** | Align with `AppointmentBookingFlow`: inline message + retry where applicable (availability fetch failed, payment failed). |
| **Empty** | If a tab has nothing bookable (no upcoming events/classes), show an **empty state** with short copy (and optional contact link) - not an infinite spinner. |
| **Tab switch** | **Reset** the non-primary flow’s **wizard / basket state** when switching tabs (**v1 default**) to avoid cross-model bugs; do not persist half-completed flows across tabs unless explicitly scoped later. |

### 3.5 `BookingsDashboard` filters (if not in Sprint 1)

- When multiple models: filter chips or dropdown **All | Appointments | Events | Classes | Resources** (wording from terminology); include **Tables** or **Reservations** label when primary is `table_reservation`.

---

## Appendix A: Public `?tab=` slug contract

**Rule:** The same **slug** values are used everywhere: main public page **`/book/[slug]`**, **embed iframe** base URL + `?tab=`, partner docs, and support links. Implement as a **single shared constant map** in code (e.g. `PUBLIC_BOOK_TAB_SLUGS`) so `BookPublicLayout`, `BookingFlowRouter`, and embed entry points cannot drift.

| Slug | Flow component | Tab visible when |
|------|------------------|-------------------|
| `appointments` | `AppointmentBookingFlow` | `booking_model` is `unified_scheduling` or `practitioner_appointment` (this tab is the primary tab for those venues when multi-tab; no `enabled_models` entry adds unified - secondaries are C/D/E only). |
| `events` | `EventBookingFlow` | `booking_model === 'event_ticket'` **or** `enabled_models` **contains** `event_ticket`. |
| `classes` | `ClassBookingFlow` | `booking_model === 'class_session'` **or** `enabled_models` **contains** `class_session`. |
| `resources` | `ResourceBookingFlow` | `booking_model === 'resource_booking'` **or** `enabled_models` **contains** `resource_booking`. |
| `tables` (or `reservations` - pick **one** canonical slug per codebase) | `BookingFlow` | `booking_model === 'table_reservation'` (primary tab for restaurants). Same slug on embeds. |

**Validation:** On load, if `?tab=` is **missing** or **invalid** for this venue, default to the **primary** model’s slug. Reject slugs for models not in `booking_model` ∪ `enabled_models` (with fallback).

**Note:** If product prefers `reservations` over `tables`, document the chosen canonical slug in code comments and partner docs only once.

---

## Sprint 4: Cross-cutting dashboard, reports, calendar, embeds, security

This sprint makes **“everything integrated”** true for staff day-to-day operations.

### 4.1 Dashboard home (`/dashboard`)

- **Today / upcoming** summaries must include bookings from **all** active models (primary + `enabled_models`).
- Cards or sections: counts by type, next actions (e.g. classes starting soon, events today).
- **Empty states** per model when a type is enabled but has no data yet.

**Files (indicative):** `src/app/dashboard/page.tsx`, `src/app/api/venue/dashboard-home/route.ts` - extend queries to filter by `booking_model` / FKs and merge.

### Guests / CRM (acceptance)

- **Guest detail / history** (dashboard guest profile or equivalent) **lists bookings for all `booking_model` values** the venue uses; row labels use **terminology** and/or **booking type** so C/D/E rows are as clear as A/B.

### 4.2 Staff calendar (`/dashboard/calendar`) - Option A locked (extend `PractitionerCalendarView`)

**Today:** `/dashboard/calendar` is shown when the venue is **schedule-eligible** (unified/practitioner primary, or C/D/E primary, or C/D/E in `enabled_models`); see `isVenueScheduleCalendarEligible` in code. All eligible venues use **`PractitionerCalendarView`** (shared appointments calendar with user-configured columns + merged C/D/E feeds where applicable). Table-only venues are redirected away from this route.

**Decision (locked):** **Option A -** evolve **`PractitionerCalendarView`** (`src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx` and related modules) into a broader **Schedule** experience that can **load multiple feed types** and **paint them on one timeline/grid** (practitioner slots, class instances, resource blocks, ticketed events; plus existing unified appointment data).

**Not chosen:** Option B (standalone `VenueScheduleView` shell only) - do **not** build a parallel full replacement calendar as the primary path; extend the existing component family so date navigation, layout, and behaviour stay consistent.

**Entry rule:** Show the calendar page when **any** of `booking_model` or `enabled_models` implies a time-based staff view: at minimum `unified_scheduling`, `practitioner_appointment`, `class_session`, `resource_booking`, `event_ticket` (events may be day-long - still show on calendar).

**Model A (`table_reservation`) - not on Schedule calendar (v1):** The **Schedule** view / `ScheduleBlock` feed is **only** for **time-based / service** models: appointments (unified), classes, resources, and ticketed events (and `event_session` when included). **`table_reservation` bookings are not included** in `ScheduleBlock` in v1 - staff continue to use the **bookings list**, **floor plan / table management**, and existing table tools for Model A. **Phase 2 (optional):** surface table reservation blocks on the same schedule grid if product wants a single timeline.

**Unified view (target):** Single surface with:

- **Filters (MVP shipped):** by practitioner; **Show** schedule filter (all / appointments-only / event / class / resource) for merged C/D/E. **Phase 2:** dedicated filters by **resource** column and **location** when multi-site or multi-resource filtering is product-ready (not required for MVP parity).
- **Implementation note (codebase):** MVP filters are implemented in `PractitionerCalendarView` and `GET /api/venue/schedule` (including resource-oriented day mode when `resource_booking` is enabled). **Not implemented in v1:** standalone **location** filters and additional per-column **resource** pickers in the toolbar beyond what the Day / Show / resource flows already provide - those stay **Phase 2** unless product re-scopes.
- **Colour legend:** appointment vs event vs class instance vs resource block (consistent keys across the app).

**View matrix (implemented behaviour - `PractitionerCalendarView`):**

| View | Appointments (practitioner / unified grid) | Events / classes / resources (`ScheduleBlock` feed) |
|------|--------------------------------------------|------------------------------------------------------|
| **Day** | Time grid per staff/calendar column; drag/drop. | Extra lanes (Events / Classes / Resources) when enabled; same vertical time scale. |
| **Week** | Table: staff × day with appointment chips. | **Additional row** under all staff: compact chips per day from the schedule API (events, classes, resources). |
| **Month** | - | **Per-cell** total count + coloured dots (blue = appointments, amber/emerald/slate = C/D/E when secondaries enabled); tooltip with breakdown; click drills to **day** view. |
| **Filter “Show”** | “Appointments only” hides C/D/E lanes/row/month dots for C/D/E; other options narrow C/D/E while keeping the practitioner grid visible. | |

**Note:** `ScheduleBlock` / `GET /api/venue/schedule` remains **C/D/E (+ empty shells)** only in v1 - unified **service** appointments and **`event_session`** bookings render on the **practitioner grid** only (not duplicated on the merged feed). Model A tables stay on Day sheet / Floor plan.

**Implementation guidance (granular):**

1. **Data model**  
   - Introduce a **normalized schedule item** (e.g. `ScheduleBlock` or equivalent) as a **discriminated union** by source: `unified_appointment` | `event_ticket` | `class_session` | `resource_booking` (and `event_session` if shown for unified venues). **Do not** add a `table_reservation` variant in v1 - see **Model A (`table_reservation`) - not on Schedule calendar (v1)** above.  
   - Each variant carries: `start`, `end`, `venue_id`, `booking_model`, display title, **colour/legend key**, and optional FKs (`booking_id`, `class_instance_id`, `experience_event_id`, `resource_id`, `practitioner_id` / `calendar_id`).  
   - Map DB/API rows into this shape in **one** aggregator (hook or server route) so the view stays dumb.

2. **Fetching**  
   - **Extend or add** a venue API (e.g. under `src/app/api/venue/…`) that accepts `{ venue_id, date_range, filters }` and returns **merged** `ScheduleBlock[]` for the feeds the venue has enabled.  
   - Reuse existing queries where possible (practitioner appointment fetches today); **add** queries for class instances, resource bookings, `experience_events` in range, etc.  
   - **Performance:** batch by date range; avoid N+1; consider **parallel** fetch per feed type then merge-sort by start time.

3. **`PractitionerCalendarView` evolution**  
   - Add props such as **`enabledFeedTypes`** / **`venueMode`** (from `resolveVenueMode`) so the component knows which feeds to request.  
   - **Internal structure:** split into subcomponents (e.g. **legend**, **toolbar filters**, **day/week grid**, **block renderer**) so the file does not become unmaintainable - Option A is **not** an excuse for a single 5000-line file.  
   - **Rendering:** map each `ScheduleBlock` to a positioned block (same coordinate system as current appointment blocks); **different row lanes** if needed (e.g. “Resources” vs “Staff A”) - product can start with **one lane per model type** then refine.  
   - **Click-through:** block click navigates to **booking detail** or **manager** screen with correct context (existing patterns).

4. **Calendar page gate** (`src/app/dashboard/calendar/page.tsx`)  
   - Replace `isUnifiedSchedulingVenue`-only gate with: show when **primary or `enabled_models`** includes any model that contributes schedule blocks (per entry rule above).  
   - Pass `venueId`, `booking_model`, `enabled_models`, and currency into the extended view.

5. **MVP fallback (still allowed)**  
   - If the **full month grid** with all feeds is not ready in one pass: ship **week view** + **list/detail** for non-appointment types **inside the same** `PractitionerCalendarView` evolution (e.g. a “Schedule list” mode for overflow) - **must not** hide secondary models entirely.  
   - Do **not** revert to a separate siloed page per model as the only option.

6. **Tests**  
   - Unit-test merge ordering and filter logic; smoke-test calendar with **multi-model** venue fixture.

**Files (indicative):** `PractitionerCalendarView.tsx`, related hooks/API clients, new `src/app/api/venue/.../schedule` (or similar) aggregator, `calendar/page.tsx`.

### 4.3 Reports (`/dashboard/reports`)

- Revenue, volume, and attendance metrics **broken down by `booking_model`** (and optionally by service/event/class/resource).
- Date filters apply to **all** included models.
- Export (if any) includes **`booking_model` / type** column.
- Align **deposit vs paid** columns with Model B reporting where mixed venues need comparable numbers.

**Files (indicative):** `src/app/dashboard/reports/page.tsx`, report APIs under `src/app/api/venue/…` as used today.

### 4.4 Guest manage / cancel - API and UI completeness

| Piece | Action |
|-------|--------|
| `GET /api/confirm` | Select `booking_model`, `experience_event_id`, `class_instance_id`, `resource_id`, `event_session_id`, ticket metadata as needed; compute **display names** with joins or batched queries. |
| `POST /api/confirm` | Reuse cancel + refund logic; ensure **status transitions** valid for C/D/E; optional model-specific side effects (e.g. release class capacity - verify against existing triggers). |
| Guest app / pages | Any **confirm/cancel** React page must render **non-appointment** layouts (event summary, class summary, resource window). |

### 4.5 Embeds and widgets

- **Canonical approach:** Align with **3.3 Public URL and tab state** - embed base URL **defaults to primary** tab; optional **`?tab=<slug>`** opens the same tab as the full public booking page (same slugs as multi-tab UI).
- **Single documented contract** for partners (no divergent hash-only or postMessage-only tab APIs in v1 unless required).
- **Out of scope** for v1 if timeboxed: full oEmbed; minimum is **documented URL contract** including `?tab=`.

### 4.6 Security - RLS and API review

When `enabled_models` and new PATCH routes ship:

- **RLS:** Venue staff may only mutate rows for their `venue_id`; secondary models do not bypass tenancy.
- **Public booking APIs:** Only expose availability and create for **enabled** models (reject creates for models not in `booking_model ∪ enabled_models`).
- **Settings PATCH:** Validate `enabled_models` server-side; prevent arbitrary JSON injection of unrelated keys.

Add a **pre-release checklist** row per new route in team process (not necessarily in this file’s body beyond this bullet).

---

## Critical files (expanded)

| Area | Files / notes |
|------|----------------|
| DB | Migrations: `enabled_models`, `checked_in_at`, policy/notification JSON |
| Defaults | `src/lib/business-config.ts`, `src/lib/business-type-defaults.ts` (re-export) |
| Onboarding | `src/app/onboarding/page.tsx` |
| Venue mode | `src/lib/venue-mode.ts` |
| Sidebar | `src/app/dashboard/DashboardSidebar.tsx` |
| Comms | `src/lib/communications/*`, `send-communications`, `booking/create`, `unified-scheduling-comms` |
| Guest | `src/app/api/confirm/route.ts`, confirm/cancel UI routes under `src/app` |
| Stripe | `src/app/api/booking/confirm-payment`, `src/app/api/webhooks/stripe/**` |
| Venue bookings | `src/app/api/venue/bookings/**` - staff create C/D/E |
| Bookings UI | `BookingsDashboard.tsx`, `ExpandedBookingContent.tsx`, `BookingDetailPanel.tsx`, `bookings/new` if present |
| Home | `src/app/dashboard/page.tsx`, `src/app/api/venue/dashboard-home/route.ts` |
| Calendar | `calendar/page.tsx`, **`PractitionerCalendarView`** (extend per **4.2 Option A**); **venue schedule API** (merged `ScheduleBlock[]`) |
| Reports | `src/app/dashboard/reports/page.tsx`, venue report APIs |
| C / D / E | Event, class, resource dashboards and `src/app/api/venue/**`, `EventBookingFlow`, `ClassBookingFlow`, `ResourceBookingFlow` |
| Public | `BookPublicLayout.tsx`, `BookingFlowRouter.tsx` - **`?tab=`** slugs (see Sprint 3.3) |
| Settings | Settings shell, **new** booking-types section, `CommunicationTemplatesSection`, venue PATCH routes |

---

## Reusable patterns

- Availability: `fetchXInput` → `computeXAvailability`; validate on create.
- `WorkingHoursControl` for resources; colour picker for class types.
- `checked_in_at` for attendance; `status` for lifecycle.
- Terminology from `resolveVenueMode()` for **all** new labels including tabs, filters, report column headers.
- **Dual event** naming in UI when both `event_sessions` and `experience_events` exist.

---

## Observability (recommended)

Server-side **structured logging** on critical paths - does not change guest-facing scope; helps production debugging.

| When to log | Examples |
|-------------|----------|
| **Operations** | `booking/create` success/failure for C/D/E; venue-initiated cancel; **`/api/confirm`** cancel; Stripe refund success/failure. |

| Field | Notes |
|-------|--------|
| **`booking_id`** | Always when known. |
| **`venue_id`** | Always. |
| **`booking_model`** | Always. |
| **`operation`** | e.g. `create`, `cancel`, `refund`. |
| **`error` / code** | On failure only. |

**Do not** log full card data; **minimise PII** in INFO logs (avoid full guest email unless existing patterns require it). Follow existing `console.error` / logger conventions; a small shared helper is optional - do not block shipping on APM tooling.

---

## Verification and minimum E2E matrix

### Expanded checklist

1. **Onboarding:** Primary-only and primary+secondary (simulated); no duplicate business-type grid; defaults applied.
2. **Enable secondary model:** Settings PATCH; mini-setup; sidebar shows new section; public tabs appear.
3. **Public booking:** Complete flow per enabled model; **disabled** model rejected at API if tampered.
4. **Staff-created booking:** Create event/class/resource booking from dashboard or venue API; appears in list and respects availability.
5. **Bookings list/detail:** Correct fields and filters for mixed models.
6. **Guest link:** GET `/api/confirm` shows correct title/body for event, class, resource, appointment, unified session.
7. **Guest cancel:** Refund within policy; no refund after deadline; Stripe state consistent.
8. **Comms:** Confirmation + reminders; no duplicate cron sends; logs keyed by model context.
9. **Calendar:** Appointments + at least one secondary type visible when enabled.
10. **Reports:** Metrics include all enabled models; filters work; export includes type.
11. **Dashboard home:** Upcoming items across models.
12. **RLS:** Spot-check staff cannot cross venues; public cannot create disabled models.
13. **RBAC:** Staff vs admin access matches **RBAC** section.
14. **Restaurant + secondary:** If tested, waitlist/floor plan unchanged; C/D/E still visible on calendar/reports.
15. **`?tab=` URL:** Deep link opens correct tab; invalid tab falls back to primary; embed URL matches.
16. **Observability:** Critical paths emit structured logs with `booking_id` / `venue_id` / `booking_model` where applicable.
17. **Whole-booking refunds:** No UI or API for partial ticket cancellation or partial Stripe refund in v1; only full-booking cancel path.
18. **No staff alerts:** Confirm no new “new booking” email/SMS to venue staff was added for C/D/E (parity with B: none).
19. **Guests / CRM:** Guest detail / history shows bookings for all models the venue uses; labels per **Guests / CRM (acceptance)**.

### Minimum E2E matrix (automate or manual before release)

| Scenario | Primary | Secondary | Must pass |
|----------|---------|-----------|-----------|
| Guest books + pays | `unified_scheduling` | - | Appointment |
| Guest books event | `event_ticket` | - | Ticket + confirm email |
| Guest books class | `class_session` | - | Roster capacity |
| Guest books resource | `resource_booking` | - | Pricing formula |
| Multi-tab public | `unified_scheduling` | `event_ticket` | Tabs + correct router |
| Restaurant + secondary | `table_reservation` | `event_ticket` | Public tabs + bookings list + home + calendar + reports behaviour as in **§14** (waitlist/floor plan unchanged for tables; C/D/E visible on calendar/reports; **`?tab=`** / embed slugs per **Appendix A**) |
| Guest cancel | each of C/D/E | - | `/api/confirm` + refund rule |
| Staff create | each of C/D/E | - | Venue API or UI |

---

## Revision note

**Locked decisions:** **(1)** Partial refunds - **Option (a)** whole-booking only in v1, with granular implementation table under Payments. **(2)** Staff notifications - **out of v1** for C/D/E; no new staff alerts (B does not send them). **(3)** Calendar - **Option A** only: extend **`PractitionerCalendarView`** with normalized `ScheduleBlock`, merged venue API, internal subcomponents, calendar page gate update; Option B shell explicitly **not** chosen.

This document also includes: **`enabled_models` compatibility (default policy)**; **billing and plan limits**; **migration and rollout**; **public `?tab=` URL contract** and **embed alignment**; **Appendix A** (`?tab=` slug table); **Sprint 3 guest UX polish**; **observability**; **Guests / CRM** acceptance; **Schedule calendar excludes Model A table rows in v1**; expanded **verification** (items 17–19); **E2E** restaurant + secondary row.

Earlier revisions added: **normative references**; **parity matrix**; **primary restaurant + secondaries**; **staff-created bookings**; **RBAC**; **API route inventory**; **Sprint 2 checklists**; **critical files**; **E2E matrix**.
