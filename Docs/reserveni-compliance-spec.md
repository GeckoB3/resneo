# ReserveNI: Compliance Records Feature Specification

**Status:** Draft for development
**Author:** Andrew (with Claude)
**Plan scope:** Available on every Appointments tier (`light`, `plus`, `appointments`). Hidden on `restaurant` / `founding` table-only SKUs in v1.
**Estimated effort:** 6–8 weeks for a single competent full-stack developer working with Cursor
**Document version:** 2.0 (rewritten against the live ReserveNI codebase)

---

## 0. Terminology mapping — read this first

The earlier draft of this document was written against a generic data model. ReserveNI's actual schema uses different names, and this rewrite is bound to the real tables. Whenever this spec says "contact" it means a ReserveNI **guest** ([public.guests](supabase/migrations/20260301000004_create_guests.sql)), and so on. The mapping is:

| This spec / UI term | ReserveNI schema reality |
|---|---|
| **Contact / Client** | `public.guests` row, unique on `(venue_id, email)`. Public UI calls these "Contacts"; the table is `guests`. |
| **Venue / Account** | `public.venues` row. One venue = one ReserveNI subscription. |
| **Service** | One of two tables depending on the venue's `booking_model`. For `practitioner_appointment` (legacy Model B): `public.appointment_services`. For `unified_scheduling` (modern Model B, the primary tier for new venues): `public.service_items`. The `/api/venue/appointment-services` endpoint transparently proxies to the right table via `venueUsesUnifiedAppointmentServiceData()`. Compliance requirements must do the same — see §4.5. |
| **Booking** | `public.bookings` row. Time is stored as `booking_date date` + `booking_time time`, not a single timestamp. The FK to the booked service also differs by model: `appointment_service_id` for `practitioner_appointment` venues; `service_item_id` for `unified_scheduling` venues (`appointment_service_id` is explicitly `NULL` for unified bookings). See §5.0 and §5.1. |
| **Staff** | `public.staff` row. RLS identifies the caller via `auth.jwt() ->> 'email'` joined to `staff.email`. |
| **Audit log** | The append-only `public.events` table is the per-venue **booking** audit log and is not extended. Contact-scoped audit goes to `public.contact_audit_events` (already exists for CRM/GDPR). Compliance gets a sibling table, `public.compliance_audit_events`, not a generic `compliance_audit_log` — see §4.7. |
| **Document upload** | Storage bucket `guest-documents` already holds free-form contact files (rendered by [ContactDocumentsSection](src/components/dashboard/contacts/ContactDocumentsSection.tsx)). Compliance file uploads add a sibling bucket `compliance-files`. |
| **Tab in a booking detail surface** | The unified booking detail surface ([ExpandedBookingContent.tsx](src/app/dashboard/bookings/ExpandedBookingContent.tsx) and [BookingDetailSurface.tsx](src/components/booking/BookingDetailSurface.tsx)) is **accordion-based** (`<details>` blocks with `bookingExpandAccordionDetailsClass`), not Radix `<Tabs>`. "Compliance tab" in the original spec means "Compliance accordion section" in this codebase. |
| **Settings sub-page** | `/dashboard/settings` is a **single Next route** with a [`TabBar`](src/components/ui/dashboard/TabBar.tsx)-driven [SettingsView.tsx](src/app/dashboard/settings/SettingsView.tsx). New settings areas are **new tab keys + a `sections/*Section.tsx` component**, not new route folders. The "Compliance" settings live under `/dashboard/settings?tab=compliance` plus a dedicated `/dashboard/compliance-types` builder page (see §3.3 and §7) — the same pattern Services already uses with [`/dashboard/appointment-services`](src/app/dashboard/appointment-services/page.tsx). |
| **Feature flag** | `venues.feature_flags` JSONB column ([20260520120000_venue_feature_flags.sql](supabase/migrations/20260520120000_venue_feature_flags.sql)), resolved through [src/lib/feature-flags/](src/lib/feature-flags/resolve.ts) with an env-var override. See §14.2. |
| **Public form URL** | ReserveNI already uses short-code public URLs at `/b/{code}` (table `booking_short_links`, 6–12 char codes). v1 compliance form links live at `/p/forms/{code}` and follow the same short-code pattern — see §3.4 and §4.6. There is no precedent for 32-char base32 tokens in this codebase. |
| **Communications send** | The existing communications subsystem ([src/lib/communications/](src/lib/communications/policies.ts)) uses **per-key message policies** (`booking_confirmation`, `pre_visit_reminder`, …) rather than free-text venue-editable templates. New compliance message keys plug into the same policy framework — see §12. |

There is **no `contacts` table, no `service_categories` table, no generic `tokens` table, and no `tier` column on `compliance_*` tables** in ReserveNI. Plan availability is enforced in the API layer using `isAppointmentPlanTier()` from [`src/lib/tier-enforcement.ts`](src/lib/tier-enforcement.ts).

Every SQL fragment, file path, and route in this document uses the real names from the codebase as of migration `20261024120000` (174 migrations applied). When new code is added it must follow the same conventions; reviewer should reject diffs that introduce table or column names absent from this map.

---

## 1. Purpose and scope

The Compliance Records feature gives ReserveNI venues a single, unified system for capturing, storing, and managing client compliance documentation. It covers patch tests, consultation forms, consent forms, declarations, vaccination records, intake questionnaires, and any future record type the platform needs to support.

The feature is deliberately industry-agnostic. It targets ReserveNI's first-wave segments — hair salons, barbers, beauticians, massage therapists, dog groomers — but the same primitives extend to medical aesthetics, tattoo studios, personal training, physiotherapy, and pet care segments as the customer base grows.

### 1.1 Goals

1. **One primitive, many uses.** A single `compliance_records` row expresses patch tests, consent forms, intake questionnaires, vaccination records, and future record types.
2. **Surfaces the data where work happens.** A `<ComplianceSection>` shared component appears as an accordion in the unified booking detail surface ([ExpandedBookingContent](src/app/dashboard/bookings/ExpandedBookingContent.tsx) / [BookingDetailSurface](src/components/booking/BookingDetailSurface.tsx)) and as a sibling section in [`ContactDetailPanel`](src/components/dashboard/contacts/ContactDetailPanel.tsx) alongside `ContactDocumentsSection`, `ContactHouseholdSection`, etc.
3. **Public submission flow.** Email or SMS a link to a client; the client completes the form via a public URL at `/p/forms/{code}`; the completed submission appears against their `guests` row and is automatically associated with any future `bookings` row whose `appointment_service_id` requires the record type.
4. **Pre-built template library.** Venues with no setup time get sensible defaults for their industry. Custom builder available for venues that want to tailor.
5. **Service-level requirements.** Services (`appointment_services` for legacy venues; `service_items` for unified-scheduling venues) can require one or more compliance record types. Missing or expired records produce warnings (and optionally block bookings) at the appropriate points in the customer and staff journeys.

### 1.2 Explicit non-goals for v1

These are deliberate omissions to keep v1 shippable. The data model accommodates all of them; the v1 UI does not expose them.

- Conditional logic on form fields (e.g. "if pregnant = yes, show pregnancy contraindications"). Deferred to v2.
- Photo capture as a field type. Deferred to v2.
- Calculated or scored fields (e.g. PAR-Q+ risk score). Deferred to v2.
- Multi-step / paginated forms. v1 forms are single-page.
- Third-party integrations (e.g. Colourstart). Out of scope for v1.
- HL7 / FHIR data export. Out of scope; this is not a medical records system.
- E-signature legal certification (e.g. eIDAS qualified signature). v1 captures a typed-name or drawn-signature with audit metadata, which is sufficient for the target segments.
- **Class / event / resource booking models.** Service requirements bind to **Model B appointment services** (both `appointment_services` for `practitioner_appointment` venues and `service_items` for `unified_scheduling` venues) in v1. Records remain visible on the guest even when their booking is Model C/D/E, but the booking does not trigger the requirements engine. See §5.0.

### 1.3 Out of scope permanently

- Becoming a clinical records system. ReserveNI captures compliance for the booking; it does not replace a clinician's EHR.
- Storing payment card or financial data in compliance records. That stays in Stripe.

---

## 2. Core concepts

The feature is built on three top-level concepts. Internalise these before reading the data model — every later section refers back to them.

### 2.1 Compliance Type

A venue-level definition of "a kind of record we collect," stored in `compliance_types`. Examples a hair salon might define:

- "PPD Patch Test" — 6-month validity, pass/fail result, captured by staff in venue
- "Colour Consultation" — one-off per visit, signed by client, captured online before appointment
- "Hair History Form" — lifetime validity (no expiry), completed once on first visit

A Compliance Type defines:

- Its **name** and **category** (test / consent / intake / declaration / certificate)
- Its **form schema** — the questions to ask, as a versioned JSONB document on `compliance_type_versions` (see §4.3)
- Its **validity rules** — how long a passed/completed record is valid for
- Its **result semantics** — pass/fail, signed, completed, or file-uploaded
- Its **capture method** — staff-in-venue, client-online, or both

### 2.2 Compliance Record

An actual instance of a Type, captured against a `guests` row, stored in `compliance_records`. A patch test taken on 2026-05-14 for guest Jane Doe is one row. It contains:

- A reference to the Type it instantiates (and the specific *version* of that type's form schema)
- A reference to the guest (`guest_id`, not `contact_id`)
- An optional reference to the booking it was captured against (`booking_id` nullable — records can be standalone)
- The captured data — the answers to the form questions, as a JSONB document matching the form schema
- The result (pass/fail/completed/signed/etc.)
- Capture metadata — captured by whom, when, where (IP, user agent, channel)
- Computed expiry date (derived from Type validity rules at capture time, stored on the record for query simplicity)

**Records live on the guest, not the booking.** A booking only ever displays a filtered view onto the guest's records — specifically, those matching the compliance requirements of its `appointment_service_id`. This is the central design decision of the feature: a patch test captured at one appointment is automatically available for any future appointment that needs one, without copy-paste or re-association.

### 2.3 Service Compliance Requirement

A many-to-many link between a service row and one or more compliance types (`service_compliance_requirements`). The service row is from `appointment_services` for `practitioner_appointment` venues or `service_items` for `unified_scheduling` venues — the same polymorphic FK split used by bookings (see §0 and §4.5). Each requirement specifies what happens when the requirement is unmet:

- **warn_staff** — staff see a warning indicator on the booking; no client-side effect
- **warn_client** — client sees a warning on the public booking page; can proceed
- **block_online** — client cannot complete an online booking until the record is on file
- **block_all** — booking cannot be created at all (staff or online) without a valid record

§5.4 covers how the requirements engine resolves these at booking time.

---

## 3. User-facing surfaces

The feature appears in six places. All six share underlying data and are kept consistent.

### 3.1 Unified booking detail — Compliance accordion

A new `<details>` section added to the unified booking detail surface, alongside the existing Booking Notes, Customer Profile Notes, Guest Tag Editor, Guest Bookings History, and Messaging accordions in [ExpandedBookingContent.tsx](src/app/dashboard/bookings/ExpandedBookingContent.tsx) / [BookingDetailSurface.tsx](src/components/booking/BookingDetailSurface.tsx). Uses the existing `bookingExpandAccordionDetailsClass` / `bookingExpandAccordionSummaryClass` / `bookingExpandAccordionBodyClass` styles so it matches the rest of the surface visually.

Visible whenever:
- The booking has a non-null `appointment_service_id` (legacy Model B) or `service_item_id` (unified Model B) AND at least one `service_compliance_requirements` row exists for that service, **or**
- The booking's `guest_id` already has at least one `compliance_records` row.

The accordion body contains:

1. **Requirements summary panel** (top — only rendered when the booking is Model B, i.e. has a non-null `appointment_service_id` or `service_item_id`). For each requirement of the booked service, a row showing:
   - Compliance Type name (e.g. "PPD Patch Test")
   - Status pill — Current / Expiring soon / Expired / Missing / Not applicable (`<Pill>` from [`@/components/ui/dashboard/Pill`](src/components/ui/dashboard/Pill.tsx) with new variants — see §11.4)
   - Latest matching record (date captured, result, captured by) if one exists
   - Quick action buttons — "Capture now" (opens form in a `<Dialog>` from [`@/components/ui/primitives/Dialog`](src/components/ui/primitives/Dialog.tsx)), "Send link" (see §3.4), "View record" (opens drawer via `<Sheet>`), "Mark complete in person" (for non-form records)

2. **All compliance records for this guest** (below). A list of every `compliance_records` row on the guest's file, regardless of whether it relates to this service. Each row links to the full record view.

3. **Audit trail** (collapsed inner `<details>` by default). Who did what, when, on this guest's compliance history (drawn from `compliance_audit_events`).

### 3.2 ContactDetailPanel — Compliance section

A new section added to [ContactDetailPanel.tsx](src/components/dashboard/contacts/ContactDetailPanel.tsx), rendered as a sibling of `ContactDocumentsSection`, `ContactMarketingSection`, `ContactHouseholdSection`, etc. The component file is `src/components/dashboard/contacts/ContactComplianceSection.tsx`. The "Requirements summary panel" from §3.1 is absent (there's no booked service to drive it). Instead, an "Attention" sub-panel shows:

- Records expiring within 30 days
- Open form submissions awaiting completion (rows in `compliance_form_links` with `status = 'pending'` and `expires_at > now()`)

The "All compliance records" list and audit trail are the same components used in §3.1, sharing the `<ComplianceRecordsList>` and `<ComplianceAuditTrail>` building blocks (see §11.2).

### 3.3 Settings → Compliance

A new tab key `compliance` added to the `TABS` array in [SettingsView.tsx](src/app/dashboard/settings/SettingsView.tsx), rendered by a new `ComplianceSettingsSection` (file: `src/app/dashboard/settings/sections/ComplianceSettingsSection.tsx`).

The tab body contains three sub-panels (driven by an inline `<TabBar>` within the section, identical pattern to existing settings sub-tabs):

1. **Templates and types** (`?tab=compliance&sub=types`)
   - List of all `compliance_types` rows for the current venue (rendered with `SectionCard` + `DashboardEntityRowActions`)
   - "Add from library" button — opens the Template Library modal (see §6) in a `<Dialog>`
   - "Create custom type" button — links to `/dashboard/compliance-types/new` (the form builder; see §7)
   - Each row shows: name, category, current version_number, validity, count of services that require it, count of records captured
   - Row-level actions: edit (links to `/dashboard/compliance-types/{id}/edit`), archive, duplicate

2. **Service requirements** (`?tab=compliance&sub=requirements`) — the **compliance-first** view
   - Table of `appointment_services` (active rows for this venue) with at least one compliance requirement
   - Column-style matrix editor: rows are services, columns are types, cells contain the enforcement level (or empty)
   - Inline add/remove of requirements
   - Useful for a bulk audit ("which of my services have no compliance requirements?") and for initial setup when defining multiple types at once
   - The per-service editor (§3.6) is the other entry point for the same data — both write to `service_compliance_requirements` via the same API

3. **General settings** (`?tab=compliance&sub=general`) — persisted in `venues.feature_flags.compliance` JSONB sub-object (see §14.2 for schema):
   - Default capture method for new types (`staff_in_venue` | `client_online` | `both`)
   - Default channel for sending form links (`email` | `sms` | `both`)
   - Reminder cadence (days before expiry to remind client — int)
   - Lock period (hours before a booking the client must complete required forms)
   - Behaviour when a client arrives and the form is incomplete (`warn_only` only in v1; `block_check_in` is deferred to v2 as it requires a check-in scan surface that does not yet exist in the dashboard)

**Why the form builder lives at a separate top-level dashboard route, not inside settings:** the existing dashboard convention is that complex editors (Services, Floor Plan, Linked Calendar) have their own top-level route under `/dashboard/<name>` with `loading.tsx` and skeleton support, and settings only contains read/light-edit forms. Compliance follows the same pattern with `/dashboard/compliance-types` (list and edit) — see §7.

### 3.4 Public form submission page

A public URL at `/p/forms/{code}` — no login required.

Why `/p/forms/`, not `/forms/`: the route prefix `/p/` is reserved in the codebase for short public guest links ([src/app/p/[id]/](src/app/p/) is already a public route directory). The `/forms/` slot is taken by free-text help articles in [src/lib/help/](src/lib/help/help-content.ts). The short-code generator follows the existing `booking_short_links` pattern from [src/lib/booking-short-links.ts](src/lib/booking-short-links.ts) — 8–12 chars, alphanumeric, base36, generated server-side with `crypto.randomBytes`.

When opened, the public page:

1. Renders the form schema (the *version* the link was issued against — not the current version) as a single-page web form
2. Captures the client's responses
3. Captures a signature if the Type requires one (drawn via `react-konva` — already a dependency, used elsewhere in the codebase — or typed)
4. On submit, creates the `compliance_records` row server-side and marks the link consumed
5. Returns a confirmation page

The submission link is sent by email or SMS using the new compliance message keys (see §12). The link row in `compliance_form_links` includes:

- A unique short `code` (10 chars, alphanumeric — single-use, see §4.6)
- An `expires_at` timestamp (default 14 days from issue; configurable per type)
- An optional `prefill` JSONB with the client's known details drawn from the `guests` row — `first_name`, `last_name`, `email`, `phone` (the `guests` table has no DOB column; see §4.6 for the exact shape)

### 3.5 Venue-wide Compliance dashboard

A new top-level page (`/dashboard/compliance`) showing:

- **Expiring soon** — table of `compliance_records` with `expires_at` in the next 30 days, with quick actions to send a new form link
- **Missing for upcoming bookings** — table of `bookings` in the next 14 days (filtered to Model B) where the service has unmet compliance requirements
- **Awaiting client submission** — outstanding rows from `compliance_form_links` with `status = 'pending'`

Added to [DashboardSidebar.tsx](src/app/dashboard/DashboardSidebar.tsx) as an extra nav item, gated on `isAppointmentPlanTier(venue.pricing_tier)` AND `feature_flags.compliance_records_enabled` resolving to `true`. Sits between "Contacts" and "Reports" in the sidebar order.

**Performance:** the "Missing for upcoming bookings" query joins `bookings`, `service_compliance_requirements`, and `compliance_records` for a 14-day window and can be expensive at scale. The dashboard route (`GET /api/venue/compliance/dashboard`) should compute this in a single CTE, leveraging the `idx_bookings_venue_date` composite index on `bookings` and the partial index `(venue_id, expires_at) WHERE status = 'completed'` on `compliance_records`. For venues with high booking volume, cache the dashboard response server-side for up to 5 minutes, keyed on `venue_id`.

This is the morning sweep view for reception staff.

### 3.6 Service editor — Compliance requirements section

The **service-first** entry point. When a staff member opens an existing `appointment_services` row in the service editor at `/dashboard/appointment-services` ([AppointmentServicesView.tsx](src/app/dashboard/appointment-services/AppointmentServicesView.tsx)), a new "Compliance requirements" section appears at the bottom of the service form, rendered as a `<SectionCard>` following the same visual pattern as the existing Processing Time, Variants, and Custom Availability sections.

**Why this surface matters:** staff setting up a new service (e.g. "Lash Lift") will naturally ask "what compliance does this service need?" from inside the service editor. Requiring them to navigate separately to Settings → Compliance → Service requirements to connect the two is a friction point that will cause requirements to go unconfigured.

**Contents of the section:**

- A list of the current `service_compliance_requirements` rows for this service, each showing:
  - Compliance type name and category pill
  - Enforcement level (`<select>` inline — warn staff / warn client / block online / block all)
  - "Remove" action
- An "Add requirement" button that opens a `<Dialog>` listing active `compliance_types` not already assigned to this service. Selecting a type and enforcement level calls `POST /api/venue/compliance/requirements` and refreshes the list.
- If the venue has no compliance types yet, the section shows an empty state: "No compliance types set up yet" with a link to Settings → Compliance → Templates and types.
- If the `compliance_records_enabled` feature flag is off for the venue, the section is hidden entirely (no hint of the feature for venues that haven't been enabled).

**Shared component:** the inline list and "Add requirement" dialog are extracted into a `<ComplianceRequirementsEditor serviceId={service.id} />` component (`src/components/dashboard/compliance/ComplianceRequirementsEditor.tsx`) so that the same component can also be embedded inside the Settings → Compliance → Service requirements matrix for per-row expansion. Do not write the UI twice.

**Default state:** a freshly created service has no requirements. Zero requirements = no compliance gates anywhere. Staff must explicitly add at least one requirement for the compliance system to affect that service's bookings.

---

## 4. Data model

### 4.1 Entity overview

Six new tables. All include the standard ReserveNI columns: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE` (indexed for RLS), `created_at timestamptz NOT NULL DEFAULT now()`, and `updated_at timestamptz NOT NULL DEFAULT now()` where the row is mutable.

| Table | Purpose |
|---|---|
| `compliance_types` | Definitions of record types active on a venue |
| `compliance_type_versions` | Immutable snapshots of a type's form schema |
| `compliance_records` | Captured instances of a type against a guest |
| `service_compliance_requirements` | Links `appointment_services` rows to required types |
| `compliance_form_links` | Single-use public submission links (short-code, mirroring `booking_short_links`) |
| `compliance_audit_events` | Append-only audit trail (sibling of `contact_audit_events`) |

### 4.2 `compliance_types`

The current definition of a compliance type on a venue. Mutable — but edits to the form schema create a new row in `compliance_type_versions` rather than overwriting.

```
compliance_types
├── id                          uuid PK
├── venue_id                    uuid FK → venues(id) ON DELETE CASCADE
├── name                        text NOT NULL              -- "PPD Patch Test"
├── slug                        text NOT NULL              -- "ppd-patch-test", unique per venue
├── category                    text NOT NULL CHECK (category IN ('test','consent','intake','declaration','certificate'))
├── description                 text
├── result_type                 text NOT NULL CHECK (result_type IN ('pass_fail','signed','completed','file_uploaded'))
├── validity_period_days        int                        -- null = lifetime, 0 = single-use, >0 = days
├── capture_methods             text[] NOT NULL            -- subset of {'staff_in_venue','client_online'}; CHECK non-empty
├── current_version_id          uuid REFERENCES compliance_type_versions(id) DEFERRABLE INITIALLY DEFERRED
├── library_template_slug       text                       -- e.g. 'lib-ppd-patch-test-v1' if cloned from library
├── form_link_expiry_days       int                        -- per-type override for link expiry; NULL = use venue-level default (14 days)
├── is_active                   boolean NOT NULL DEFAULT true
├── archived_at                 timestamptz
├── created_at                  timestamptz NOT NULL DEFAULT now()
├── updated_at                  timestamptz NOT NULL DEFAULT now()
└── UNIQUE(venue_id, slug)
```

**Slug generation:** `slug` is auto-derived server-side from `name` using a standard slugify transform (lowercase, spaces → hyphens, non-alphanumeric characters stripped). On collision within the same venue the server appends `-2`, `-3`, etc. until unique. Staff do not set the slug directly; it is computed on creation and does not change when `name` is subsequently renamed (stable identifier for any future external references).

**On enums vs text+CHECK:** ReserveNI's policy is to use `text` + `CHECK` constraints for new finite-value columns rather than Postgres `ENUM` types, because `ALTER TYPE … ADD VALUE` cannot run inside a transaction and so blocks zero-downtime migrations. The few existing enums (`booking_status`, `booking_model`, `deposit_status`) predate this policy. Follow `text` + `CHECK` for all new compliance columns; the inventory comment in [Docs/schema.sql](Docs/schema.sql) reflects this.

### 4.3 `compliance_type_versions`

Immutable. Every time the venue edits a type's form schema, a new version is created and the type's `current_version_id` is updated. Old records remain bound to the version they were captured under.

```
compliance_type_versions
├── id                          uuid PK
├── venue_id                    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE     -- denormalised for RLS
├── compliance_type_id          uuid NOT NULL REFERENCES compliance_types(id) ON DELETE CASCADE, indexed
├── version_number              int NOT NULL               -- 1, 2, 3 … per type
├── form_schema                 jsonb NOT NULL             -- see §4.3.1
├── changelog                   text                       -- optional note from the editor
├── created_by_staff_id         uuid REFERENCES staff(id) ON DELETE SET NULL
├── created_at                  timestamptz NOT NULL DEFAULT now()
└── UNIQUE(compliance_type_id, version_number)
```

`venue_id` is denormalised onto this table (and onto `compliance_records`, `service_compliance_requirements`, `compliance_form_links`, `compliance_audit_events`) so every RLS policy can be a single `venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email'))` predicate. This matches the established pattern in [contacts CRM tables](supabase/migrations/20260702120100_contacts_crm_phase2_3.sql).

#### 4.3.1 The `form_schema` JSONB shape

The form schema is a single JSON document. v1 supports a flat list of fields. v2 will support sections and conditional logic without breaking changes — the v1 schema is a special case of the v2 schema.

```json
{
  "schema_version": "1.0",
  "title": "PPD Patch Test",
  "description": "Patch test for sensitivity to PPD in hair colour products.",
  "intro_markdown": "Please read carefully before completing this form.",
  "fields": [
    {
      "id": "f_known_allergies",
      "type": "textarea",
      "label": "Do you have any known allergies?",
      "required": true,
      "max_length": 1000
    },
    {
      "id": "f_previous_reaction",
      "type": "select",
      "label": "Have you had a previous reaction to hair colour?",
      "required": true,
      "options": [
        { "value": "yes", "label": "Yes" },
        { "value": "no",  "label": "No" },
        { "value": "unsure", "label": "Unsure" }
      ]
    },
    {
      "id": "f_test_date",
      "type": "date",
      "label": "Date of patch test",
      "required": true,
      "default_value": "today"
    },
    {
      "id": "f_result",
      "type": "select",
      "label": "Result",
      "required": true,
      "staff_only": true,
      "options": [
        { "value": "pass", "label": "Pass" },
        { "value": "fail", "label": "Fail" },
        { "value": "inconclusive", "label": "Inconclusive" }
      ]
    },
    {
      "id": "f_signature",
      "type": "signature",
      "label": "Client signature",
      "required": true
    }
  ],
  "result_mapping": {
    "field": "f_result",
    "pass_values": ["pass"],
    "fail_values": ["fail", "inconclusive"]
  }
}
```

The schema is parsed and validated through `zod` in [`src/lib/compliance/form-schema.ts`](src/lib/compliance/form-schema.ts) (new file). `zod` is already the project's validation library (see [feature-flags/types.ts](src/lib/feature-flags/types.ts) and [appointment-services route](src/app/api/venue/appointment-services/route.ts) for established usage).

**Supported field types in v1:**

| Type | Renders as | Stored as |
|---|---|---|
| `text` | Single-line input | string |
| `textarea` | Multi-line input | string |
| `select` | Dropdown | string (one of the option values) |
| `multiselect` | Checkbox group | array of strings |
| `date` | Date picker | ISO 8601 date string |
| `signature` | Signature pad (drawn via `react-konva`) or typed-name input | object: `{ method, data, signed_at }` |
| `file` | File upload (via Supabase Storage signed URL — same pattern as [guest documents](src/components/dashboard/contacts/ContactDocumentsSection.tsx)) | object: `{ storage_path, file_name, mime_type, file_size_bytes }` |

**Field-level options available on all types:**

- `id` — short stable ID, used as the key in `compliance_records.responses`
- `label`, `help_text`, `required`, `staff_only` (hidden from the public form)

**`result_mapping`** — only used when the type's `result_type` is `pass_fail`. Tells the system which field's value determines the pass/fail outcome of the record.

### 4.4 `compliance_records`

```
compliance_records
├── id                          uuid PK
├── venue_id                    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE, indexed
├── guest_id                    uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE, indexed
├── compliance_type_id          uuid NOT NULL REFERENCES compliance_types(id) ON DELETE RESTRICT, indexed
├── compliance_type_version_id  uuid NOT NULL REFERENCES compliance_type_versions(id) ON DELETE RESTRICT
├── booking_id                  uuid REFERENCES bookings(id) ON DELETE SET NULL          -- nullable: the booking that prompted capture
├── status                      text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','expired','voided'))
├── result                      text CHECK (result IN ('pass','fail','inconclusive','completed','signed'))
├── responses                   jsonb NOT NULL DEFAULT '{}'::jsonb                       -- keyed by field id; see §4.4.1
├── captured_by_staff_id        uuid REFERENCES staff(id) ON DELETE SET NULL              -- null if client self-submitted
├── captured_at                 timestamptz NOT NULL DEFAULT now()
├── capture_channel             text NOT NULL CHECK (capture_channel IN ('staff_web','staff_mobile','client_email','client_sms','client_walkin','import'))
├── capture_ip                  inet                                                      -- client IP for online submissions
├── capture_user_agent          text
├── expires_at                  timestamptz                                               -- computed at capture time
├── notes                       text                                                      -- internal staff notes
├── voided_at                   timestamptz
├── voided_reason               text
├── voided_by_staff_id          uuid REFERENCES staff(id) ON DELETE SET NULL
├── reminder_sent_at            timestamptz                                               -- set when expiry-reminder cron dispatches; prevents double-send
├── created_at                  timestamptz NOT NULL DEFAULT now()
├── updated_at                  timestamptz NOT NULL DEFAULT now()
└── (indexes: (venue_id, guest_id, compliance_type_id, captured_at DESC); (venue_id, expires_at) WHERE status='completed')
```

The `capture_channel` values and their meanings:

- `staff_web` — staff completes the form on behalf of the client in the dashboard
- `staff_mobile` — staff completes it in the React Native app (once compliance is exposed there)
- `client_email` / `client_sms` — client self-submits via a link; the originating `compliance_form_links.sent_via` determines which
- `client_walkin` — client completes the form themselves on a staff device at the venue (handed tablet / kiosk mode); distinct from `staff_web` because the client, not staff, entered the responses
- `import` — bulk import of historical records through the existing import tool (`/dashboard/import`)

#### 4.4.1 The `responses` JSONB shape

Keyed by field `id` from the schema:

```json
{
  "f_known_allergies": "None.",
  "f_previous_reaction": "no",
  "f_test_date": "2026-05-14",
  "f_result": "pass",
  "f_signature": {
    "method": "drawn",
    "data": "data:image/png;base64,iVBOR…",
    "signed_at": "2026-05-14T14:23:11Z"
  }
}
```

For signature payloads, the base64 PNG is uploaded to the `compliance-files` Supabase Storage bucket via signed URL and the JSONB stores `{ "method": "drawn", "storage_path": "venues/{venue_id}/signatures/{record_id}.png", "signed_at": "..." }` rather than the data URL. This matches the existing pattern in `guest_documents` and avoids row bloat. The endpoint signs uploads server-side and never trusts a client-provided storage path.

#### 4.4.2 Computing `expires_at`

At capture time:

```
if compliance_type.validity_period_days IS NULL:
    expires_at = NULL                                    -- lifetime
elif compliance_type.validity_period_days = 0:
    expires_at = captured_at                             -- single-use, immediately expired
else:
    expires_at = captured_at + (validity_period_days || ' days')::interval
```

### 4.5 `service_compliance_requirements`

Binds a Model B service row to a compliance type. v1 does not support requirements on Model C/D/E entities.

Because Model B has two possible service tables (see §0), this table carries **polymorphic FKs** — exactly one of `appointment_service_id` or `service_item_id` must be non-null, enforced by a CHECK constraint. The `/api/venue/compliance/requirements` endpoint uses `venueUsesUnifiedAppointmentServiceData()` to decide which column to populate on write and which to filter on read, exactly as the appointment-services endpoint does.

```
service_compliance_requirements
├── id                          uuid PK
├── venue_id                    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE, indexed
├── appointment_service_id      uuid REFERENCES appointment_services(id) ON DELETE CASCADE, indexed   -- set for practitioner_appointment venues
├── service_item_id             uuid REFERENCES service_items(id) ON DELETE CASCADE, indexed          -- set for unified_scheduling venues
├── compliance_type_id          uuid NOT NULL REFERENCES compliance_types(id) ON DELETE RESTRICT
├── enforcement                 text NOT NULL CHECK (enforcement IN ('warn_staff','warn_client','block_online','block_all'))
├── lock_period_hours           int CHECK (lock_period_hours IS NULL OR lock_period_hours >= 0)       -- see §4.5.1
├── created_at                  timestamptz NOT NULL DEFAULT now()
├── updated_at                  timestamptz NOT NULL DEFAULT now()
├── UNIQUE(appointment_service_id, compliance_type_id)  -- partial unique index WHERE appointment_service_id IS NOT NULL
├── UNIQUE(service_item_id, compliance_type_id)         -- partial unique index WHERE service_item_id IS NOT NULL
└── CHECK (num_nonnulls(appointment_service_id, service_item_id) = 1)
```

#### 4.5.1 `lock_period_hours` semantics

`lock_period_hours` encodes the minimum lead time a valid record must pre-date the booking. `NULL` means no lead-time constraint — any valid unexpired record satisfies the requirement regardless of when it was captured.

When set (e.g. `48` for a PPD patch test), the record must have been captured **at least** `lock_period_hours` hours before the booking's scheduled start (`booking_date + booking_time`). A record captured 12 hours before a booking does not satisfy a 48-hour patch test requirement even if the result is "pass" and the record is otherwise unexpired.

**Effect on the resolution algorithm (§5.1 step 2):** the `captured_at ≤ booking_datetime − lock_period_hours` guard is added to the valid-record query.

**Effect on online booking / form links:** if `hours_until_booking < lock_period_hours`, the client can no longer satisfy the requirement by submitting a form online. The enforcement level still applies — but `warn_client` should additionally surface "The deadline for online submission has passed; please contact the venue" messaging on the booking page. Staff can still capture a record in venue (`staff_web`) at their discretion.

### 4.6 `compliance_form_links`

Single-use public submission links. Models on `booking_short_links` and shares the same generator helper (extracted to `src/lib/short-code.ts` if not already factored out; otherwise call the existing function and pass a different `purpose`).

```
compliance_form_links
├── id                          uuid PK
├── venue_id                    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE, indexed
├── code                        text NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 8 AND 12)
├── guest_id                    uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE, indexed
├── compliance_type_id          uuid NOT NULL REFERENCES compliance_types(id) ON DELETE RESTRICT
├── compliance_type_version_id  uuid NOT NULL REFERENCES compliance_type_versions(id) ON DELETE RESTRICT
├── booking_id                  uuid REFERENCES bookings(id) ON DELETE SET NULL
├── status                      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed','expired','revoked'))
├── consumed_record_id          uuid REFERENCES compliance_records(id) ON DELETE SET NULL
├── sent_via                    text CHECK (sent_via IN ('email','sms','manual_copy'))
├── sent_at                     timestamptz
├── prefill                     jsonb NOT NULL DEFAULT '{}'::jsonb
├── expires_at                  timestamptz NOT NULL
├── consumed_at                 timestamptz
├── revoked_at                  timestamptz
├── access_count                int NOT NULL DEFAULT 0
├── last_accessed_at            timestamptz
├── created_by_staff_id         uuid REFERENCES staff(id) ON DELETE SET NULL
├── created_at                  timestamptz NOT NULL DEFAULT now()
└── INDEX (guest_id, status); partial INDEX (compliance_type_id, guest_id) WHERE status='pending'
```

**Code generation:** 10 characters from a 36-char alphabet, drawn from `crypto.randomBytes`. ~52 bits of entropy is sufficient for a single-use, short-lived, revocable credential. The existing `booking_short_links` uses the same approach.

**Prefill object shape:** populated at link-creation time from the `guests` row. Only fields that exist on `guests` are included:
```json
{ "first_name": "Jane", "last_name": "Doe", "email": "jane@example.com", "phone": "+447700900000" }
```
There is no DOB column on `guests`; never include it. `phone` may be absent if the guest has none on file.

**Link expiry:** `expires_at` is computed as `created_at + (form_link_expiry_days || ' days')::interval`. `form_link_expiry_days` is resolved in priority order: (1) the per-type override `compliance_types.form_link_expiry_days`; (2) the venue-level general setting; (3) the platform default of 14 days.

**Public URL:** `https://reserveni.com/p/forms/{code}` (see §3.4 for path rationale).

### 4.7 `compliance_audit_events`

Append-only. Every meaningful action on the compliance subsystem writes one row. Sibling of the existing `contact_audit_events` ([20260702120100_contacts_crm_phase2_3.sql:6](supabase/migrations/20260702120100_contacts_crm_phase2_3.sql)) and follows the same pattern: service-role inserts only, no INSERT/UPDATE/DELETE policy for the dashboard JWT; SELECT scoped by venue.

```
compliance_audit_events
├── id                          uuid PK
├── venue_id                    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE, indexed
├── guest_id                    uuid REFERENCES guests(id) ON DELETE SET NULL, indexed
├── compliance_record_id        uuid REFERENCES compliance_records(id) ON DELETE SET NULL
├── compliance_form_link_id     uuid REFERENCES compliance_form_links(id) ON DELETE SET NULL
├── compliance_type_id          uuid REFERENCES compliance_types(id) ON DELETE SET NULL
├── event_type                  text NOT NULL              -- see §4.7.1
├── actor_type                  text NOT NULL CHECK (actor_type IN ('staff','client','system'))
├── actor_staff_id              uuid REFERENCES staff(id) ON DELETE SET NULL
├── metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb
├── created_at                  timestamptz NOT NULL DEFAULT now()
```

No `updated_at` column. A BEFORE UPDATE/DELETE trigger raises an exception, mirroring the `events_append_only` trigger on the bookings `events` table ([20260301000006_create_events.sql:33](supabase/migrations/20260301000006_create_events.sql)).

#### 4.7.1 `event_type` values

- `type.created`, `type.updated`, `type.archived`, `type.restored`
- `version.created`
- `requirement.added`, `requirement.removed`, `requirement.updated`
- `record.captured`, `record.updated`, `record.voided`, `record.viewed`
- `link.issued`, `link.sent`, `link.consumed`, `link.expired`, `link.revoked`

`record.viewed` is written by the GET endpoint serving individual records to staff, so reads of sensitive medical data are traceable. (Implementing this as a server-side hook rather than a database trigger because the trigger would need the calling staff `id` from a custom session variable; staff resolution already happens in `getVenueStaff` in the API route.)

---

## 5. Behaviour

### 5.0 Booking-model scope

Service compliance requirements bind to **Model B appointment services** only in v1. This covers both `appointment_services` rows (for `practitioner_appointment` venues) and `service_items` rows (for `unified_scheduling` venues). The requirements engine is invoked when a booking has a non-null `appointment_service_id` (legacy) or a non-null `service_item_id` (unified). Bookings where both columns are null — Model A table reservations, Model C event tickets, Model D classes, Model E resources — are silently skipped. Compliance records still appear on the guest profile for any booking model, but the requirements engine is never invoked unless the booking links to a Model B service.

This is a deliberate scope cut: the launch segments (hair, beauty, lash, dog grooming) are unambiguously Model B. Extending to dog-grooming-as-a-class or massage-as-a-resource is straightforward — add a `class_type_id` / `experience_event_id` / `venue_resource_id` column to `service_compliance_requirements` and teach the resolution engine to look there too — but it's not done in v1.

### 5.1 Booking creation — requirements check

When a booking is created (staff-side or online), the system runs the **Requirements Resolution Algorithm** for the booked service:

```
0. Determine the booked service FK via venueUsesUnifiedAppointmentServiceData():
     unified_scheduling venue  → service_fk_col = 'service_item_id',        service_fk_val = booking.service_item_id
     practitioner_appointment  → service_fk_col = 'appointment_service_id', service_fk_val = booking.appointment_service_id
     If service_fk_val IS NULL → skip (Model A/C/D/E booking — see §5.0)

1. Load service_compliance_requirements WHERE service_fk_col = service_fk_val
   (the matching FK column — appointment_service_id or service_item_id — as determined in step 0)

2. For each requirement, compute booking_datetime = (booking.booking_date + booking.booking_time)::timestamptz.
   Find the guest's most recent matching compliance_records WHERE:
     status = 'completed'
     AND (expires_at IS NULL OR expires_at > booking_datetime)
     AND voided_at IS NULL
     AND (requirement.lock_period_hours IS NULL
          OR captured_at <= booking_datetime - make_interval(hours => requirement.lock_period_hours))
   -- The lock_period_hours guard ensures a patch test captured 12 hours before a booking does
   -- not satisfy a 48-hour requirement (see §4.5.1).

3. Compute the requirement's resolved state:
     - SATISFIED       — a valid record exists (passes step 2 filters)
     - EXPIRING_SOON   — a valid record exists but expires within 30 days
     - EXPIRED         — most recent record exists but fails the expiry/lock filter
     - MISSING         — no record of this type exists for the guest at all

4. Apply the requirement's enforcement level:
     If state = SATISFIED        → allow
     If state = EXPIRING_SOON    → allow + flag for client reminder
     If state = EXPIRED / MISSING:
         If enforcement = warn_staff    → allow; staff see a warning badge on the booking card
         If enforcement = warn_client   → allow; see §5.1.1 for public-page UX
         If enforcement = block_online  → allow staff-side; block public booking page submission
         If enforcement = block_all     → block both; return HTTP 409 + structured error
```

Implemented in `src/lib/compliance/resolve-requirements.ts`. Called from the existing booking-creation paths:

- Public guest booking: [`/api/booking/...`](src/app/api/booking/) flow at the point where availability has been confirmed and the booking would be inserted.
- Staff booking: [`/api/venue/bookings`](src/app/api/venue/bookings/) `POST` handler.
- Staff edit that changes the service: `/api/venue/bookings/[id]` `PATCH` handler.

Blocked requests return the standard ReserveNI error envelope with `error: 'COMPLIANCE_REQUIREMENT_UNMET'` and a `details` array listing which types are missing/expired.

#### 5.1.1 `warn_client` UX on the public booking page

When `enforcement = 'warn_client'` the booking submission is allowed to proceed, but the public booking page must surface the warning **before** the guest submits. The mechanism is a pre-check call:

1. When the guest selects a service on the public booking page, the page calls `GET /api/public/compliance/pre-check?venue_id=...&service_id=...` (see §9.2). This returns the list of compliance requirements for that service and their enforcement levels — **without** the guest's identity (unauthenticated, no guest records looked up yet).
2. If any requirement has `enforcement = 'warn_client'` or `block_online`, the page renders an inline notice: "This treatment requires [type name] to be on file. If you have not completed this previously, you can complete it online — a link will be sent to you after booking." This sets guest expectations before they enter their details.
3. After the guest enters their email and before final submission, the page calls `POST /api/public/compliance/pre-check` with `{ venue_id, service_id, email }`. This checks whether a valid record already exists for that guest. If a `block_online` requirement is unmet, submission is blocked; if a `warn_client` requirement is unmet, the warning is re-displayed as a confirmation step ("I understand I will be sent a form to complete before my appointment").
4. If `lock_period_hours` has passed (the online submission window has closed), the `warn_client` warning changes to "Please contact the venue directly — the deadline for online form submission has passed."

The pre-check endpoints are described in §9.2. They use the admin Supabase client (service role) because no guest JWT exists yet.

### 5.2 Form link issuance

Triggered from any of:

- Staff clicks "Send link" on a booking's compliance section
- Staff clicks "Send form" on a contact's compliance section
- Automatic — booking created with unmet requirement and the type's `capture_methods` includes `client_online` (config flag controls auto-send vs manual; default manual)

Process:

1. Create a `compliance_form_links` row (admin client; service-role insert).
2. Render the email/SMS using the new compliance message keys (see §12).
3. Send via existing communications dispatch (`sendPolicyMessage` in [src/lib/communications/outbound.ts](src/lib/communications/outbound.ts) — extended with `compliance_form_request` and `compliance_form_reminder` message keys).
4. Log to `compliance_audit_events`: `link.issued` then `link.sent`.

If an unconsumed link for the same `(guest_id, compliance_type_id)` pair already exists, **do not** issue a new one. Re-send the existing one (`POST /api/venue/compliance/form-links/{id}/resend`). This prevents the client receiving multiple links for the same form.

**Walk-in / anonymous guests:** if the guest has no email address on file (common for walk-in bookings), form link issuance is unavailable — there is no delivery address. In this case:

- The "Send link" button in the booking compliance section is replaced by a disabled button with tooltip "Add an email address to this guest to send a form link."
- Staff should instead capture the record directly using the "Capture now" modal (§3.1), selecting `capture_channel = 'client_walkin'` if the client completes the form on a staff device at the venue, or `staff_web` if staff enter the data on their behalf.
- If the service has `block_online` or `block_all` enforcement, a staff member with admin permission can acknowledge and proceed regardless. The booking creation still succeeds for staff-side bookings; the requirement surfaces as unmet in the booking compliance section.
- `block_all` for walk-in guests without contact details is a venue-operations decision. If the venue wants hard blocking for genuinely uncapturable guests, they should set `block_online` instead and handle anonymous guests operationally.

### 5.3 Public form submission

A client opens `/p/forms/{code}`. The route handler ([src/app/p/forms/[code]/route.ts] for GET schema, [src/app/api/public/compliance/forms/[code]/route.ts] for POST submit) uses the admin client because public submissions are unauthenticated:

1. Look up `compliance_form_links` by `code`. Verify `status = 'pending'` AND `expires_at > now()`.
2. Load the bound `compliance_type_versions` — render that exact schema, not the current version.
3. On submit:
   - Validate response payload against the schema with `zod` (required fields present, types match).
   - Capture IP from `x-forwarded-for` (Vercel-set), user agent, signature (uploaded to `compliance-files` bucket if drawn).
   - Insert `compliance_records` row with `status = 'completed'`, `capture_channel = 'client_email' | 'client_sms'` (taken from `compliance_form_links.sent_via`), `captured_by_staff_id = NULL`.
   - Compute `result` (via `result_mapping` if applicable) and `expires_at`.
   - Mark the link `status = 'consumed'`, set `consumed_record_id`, `consumed_at = now()`.
   - Write `link.consumed` and `record.captured` audit events.
   - Return the confirmation page.
4. If validation fails, render the form again with inline errors. No link consumption.

If the link is already consumed, expired, or revoked, render an appropriate error page with a "Contact the venue" CTA (the existing `/manage` page does this for booking links and is a good visual model).

### 5.4 Record voiding

Compliance records cannot be hard-deleted (legal defensibility — see §13). They can be voided:

- Staff opens record → "Void this record" → reason required (max 500 chars)
- `voided_at`, `voided_by_staff_id`, `voided_reason` populated
- Record no longer counted in Requirements Resolution (the WHERE clause in §5.1 includes `voided_at IS NULL`)
- Still visible in the guest's history with a "Voided" pill

Voiding is irreversible. (`record.voided` audit event captures the reason in `metadata.reason`.)

### 5.5 Type editing

Staff opens a type → form builder → edits → saves:

1. A new `compliance_type_versions` row is created with the updated schema (`version_number = max(version_number) + 1`).
2. `compliance_types.current_version_id` is updated to point to the new version.
3. Existing records remain bound to their original `compliance_type_version_id`.
4. Existing form links issued against the previous version **continue to render the previous version** — the client sees what they were sent.

This is the central guarantee: a record's data, the form it was captured against, and the version of that form are tied together immutably.

### 5.6 Type archiving

Cannot hard-delete a type if any `compliance_records` reference it (enforced by `ON DELETE RESTRICT`). Archiving:

- Sets `is_active = false`, `archived_at = now()`
- Removes from "Add requirement" pickers in settings
- Existing `service_compliance_requirements` pointing to it become read-only and surface a warning
- Existing records remain queryable and viewable

### 5.7 Validity expiry — Vercel Cron job

A nightly cron route at `src/app/api/cron/compliance-expiry/route.ts`, registered in [vercel.json](vercel.json) at `0 2 * * *` (after `account-hard-delete` and `account-link-maintenance`). Uses `requireCronAuthorisation()` from [`src/lib/cron-auth.ts`](src/lib/cron-auth.ts), the standard pattern documented in [Docs/DEVELOPMENT.md](Docs/DEVELOPMENT.md).

Each run:

```sql
UPDATE compliance_records
SET status = 'expired', updated_at = now()
WHERE status = 'completed'
  AND expires_at IS NOT NULL
  AND expires_at < now();
```

Plus a client-reminder pass: for records where `expires_at - now()` falls within the venue's configured reminder cadence **and `reminder_sent_at IS NULL`** (not already reminded this cycle), send a `compliance_form_reminder` message with a freshly issued form link and then set `reminder_sent_at = now()` on the record. The `reminder_sent_at` guard prevents duplicate reminder messages if the cron is retried or accidentally invoked twice in close succession. If a venue's reminder cadence is longer than one day (e.g. "remind 7 days before expiry"), the guard also prevents a second send on subsequent nightly runs.

The cron run writes a `runs` row (the existing job-run audit table) on success/failure.

---

## 6. Template library

The library ships with the platform — not stored in the venue's database. Defined as TypeScript constants in [`src/lib/compliance/library/`](src/lib/compliance/library/) (new directory).

### 6.1 v1 library contents

For the launch segments (hair, beauty, barber, massage, dog grooming), v1 ships with these templates:

| Slug | Name | Category | Validity | Result type |
|---|---|---|---|---|
| `lib-ppd-patch-test-v1` | PPD Patch Test | test | 180 days | pass_fail |
| `lib-eyelash-patch-test-v1` | Eyelash Tint/Extension Patch Test | test | 90 days | pass_fail |
| `lib-eyebrow-patch-test-v1` | Eyebrow Tint Patch Test | test | 90 days | pass_fail |
| `lib-new-client-intake-v1` | New Client Intake Form | intake | null (lifetime) | completed |
| `lib-massage-intake-v1` | Massage Therapy Intake | intake | 365 days | completed |
| `lib-massage-consent-v1` | Massage Treatment Consent | consent | 0 (per visit) | signed |
| `lib-pregnancy-declaration-v1` | Pregnancy Declaration | declaration | 0 (per visit) | signed |
| `lib-dog-vaccination-v1` | Dog Vaccination Record | certificate | null (uses upload validity) | file_uploaded |
| `lib-dog-behaviour-v1` | Dog Behaviour Assessment | intake | null (lifetime) | completed |
| `lib-photo-consent-v1` | Photo/Social Media Consent | consent | null (lifetime) | signed |

Each template defines a full `form_schema`, suggested validity, and the `result_mapping` where applicable. The "Add from library" modal in settings (§3.3) clones the template into a new `compliance_types` + `compliance_type_versions` pair for the venue, writing the source slug to `compliance_types.library_template_slug`.

### 6.2 Library evolution

When a new library template is added or an existing one improved:

- It does **not** retroactively change venue copies (venues own their type definitions).
- The settings UI surfaces a "Library has a newer version" indicator for cloned types (compares `library_template_slug` to the latest library export), with a "Review changes" action that opens a diff modal.

### 6.3 Library file layout

```
src/lib/compliance/library/
  index.ts                   -- exports allTemplates(): LibraryTemplate[]
  templates/
    ppd-patch-test.ts
    eyelash-patch-test.ts
    new-client-intake.ts
    massage-intake.ts
    massage-consent.ts
    pregnancy-declaration.ts
    dog-vaccination.ts
    dog-behaviour.ts
    photo-consent.ts
  field-types.ts             -- TypeScript types + zod schemas for fields
```

---

## 7. Form builder

A visual editor for creating and editing `compliance_type_versions.form_schema`. Lives at a dedicated top-level dashboard route, not inside `/dashboard/settings`, to match how Services, Floor Plan, and Linked Calendar handle their complex editors:

- `/dashboard/compliance-types` — list view (also reachable via the Settings → Compliance tab as a "Manage types" link)
- `/dashboard/compliance-types/new` — create
- `/dashboard/compliance-types/[id]/edit` — edit

### 7.1 Layout

Three-pane (collapses to single-column on mobile):

1. **Left:** field palette — draggable cards for each field type (text, textarea, select, multiselect, date, signature, file).
2. **Centre:** form preview — drag-and-drop list of the current fields, in order, with inline editing.
3. **Right:** field properties panel — when a field is selected, shows its full configuration.

### 7.2 Field reordering

Drag and drop using `@dnd-kit/sortable` — already a project dependency (used by the Linked Calendars feature; see [package.json](package.json) line 31–33), so no new package install.

### 7.3 Form-level metadata

Top of the centre pane: editable title, description, intro markdown. Markdown is rendered through the existing `marked` + `sanitize-html` setup the project already uses for help articles.

### 7.4 Validation on save

Before allowing save (server-side validation in zod; client-side mirror for UX):

- Title required
- At least one field
- All field `id` values unique within the form
- If `result_type = 'pass_fail'`, exactly one `staff_only: true` select field whose option values cover the `pass_values` / `fail_values` declared in `result_mapping`
- At most one signature field per form (v1 limitation; relax in v2)
- At most one file field per form (v1 limitation)

### 7.5 Save semantics

Save creates a new `compliance_type_versions` row (see §5.5) and updates `current_version_id`. There is no draft state in v1 (drafts deferred to v2).

### 7.6 Preview mode

A "Preview as client" button renders the form using the `<ComplianceFormRenderer>` (see §11.3) in `mode="public"`. No persistence; pure preview.

---

## 8. Plan availability

The full Compliance Records feature is available on **all** Appointments tiers — `light`, `plus`, and `appointments` (Pro). Restaurant SKUs (`restaurant`, `founding`) do not see the feature in v1 because their booking model is `table_reservation` and v1 requirements bind to `appointment_services`.

Plan gating in code is a single line at every entry point:

```typescript
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
if (!isAppointmentPlanTier(venue.pricing_tier)) {
  return forbidden('Feature not available on this plan.');
}
```

Plus the sidebar item and Settings tab are conditionally rendered on the same predicate. No tier-based limits within the feature: every capability described in this specification is available to every Appointments customer:

- Unlimited active compliance types (library and custom)
- Full drag-and-drop form builder
- Service-level requirements and enforcement
- Public form submission via email **and** SMS
- Compliance dashboard
- Audit trail UI
- All field types, including signature and file upload

### 8.1 Rationale

Compliance is a credibility feature for the launch segments — beauty, lash, brow, dog grooming. A sole-trader beautician on Appointments Light who cannot patch-test through the platform will either churn or never sign up in the first place. The acquisition value of including the feature universally exceeds the marginal revenue from tier-gating it.

This is a deliberate strategic choice. SMS-channel sends still consume the venue's SMS allowance under their existing plan limits (handled by [`src/lib/sms-usage.ts`](src/lib/sms-usage.ts) and the existing meter on `sms_log`); there is no need to gate the feature itself to monetise the channel.

### 8.2 Implementation note

The data model and API do not need to enforce plan-based limits for this feature. Where an earlier draft suggested an "upgrade CTA" or "limit reached" surface, those should be omitted. Standard SMS-quota and usage limits from the parent plan still apply.

---

## 9. API surface

ReserveNI's API namespace convention is `/api/venue/*` for staff-authenticated routes (see [Docs/MOBILE_API.md](Docs/MOBILE_API.md) — these routes also accept Bearer tokens for the React Native app), `/api/booking/*` for public guest booking, and a small `/api/v1/*` namespace for documented external surfaces (`auth`, `manage-booking`, `me`). The original spec's `/api/v1/compliance/*` namespace does not match the codebase and is replaced here.

All staff routes use `getVenueStaff()` from [`src/lib/venue-auth.ts`](src/lib/venue-auth.ts), which resolves the staff row and returns an admin Supabase client (bypasses RLS — safe because the staff has been authenticated). Body validation uses `zod`. Response envelope follows existing routes (no `{data, meta, error}` wrapper unless the route is paginated — match existing patterns per-route).

### 9.1 Staff routes — `/api/venue/compliance/*`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/venue/compliance/types` | List active types for the current venue |
| `POST` | `/api/venue/compliance/types` | Create a new type (from library or custom) |
| `GET` | `/api/venue/compliance/types/[id]` | Fetch a type with its current version |
| `PATCH` | `/api/venue/compliance/types/[id]` | Update non-schema fields (name, validity, capture_methods, is_active) |
| `POST` | `/api/venue/compliance/types/[id]/versions` | Create a new schema version (form-builder save) |
| `GET` | `/api/venue/compliance/types/[id]/versions` | List versions |
| `POST` | `/api/venue/compliance/types/[id]/archive` | Archive a type |
| `POST` | `/api/venue/compliance/types/[id]/restore` | Restore an archived type |
| `GET` | `/api/venue/compliance/library` | List available library templates (from `src/lib/compliance/library/`) |
| `POST` | `/api/venue/compliance/library/[slug]/clone` | Clone a library template into the venue |
| `GET` | `/api/venue/compliance/records` | List records (filters: `guest_id`, `compliance_type_id`, `booking_id`, `status`, date range) |
| `POST` | `/api/venue/compliance/records` | Capture a record (staff in venue) |
| `GET` | `/api/venue/compliance/records/[id]` | Fetch a record with rendered version snapshot (writes `record.viewed` audit event) |
| `PATCH` | `/api/venue/compliance/records/[id]` | Edit `notes` only — `responses` are immutable |
| `POST` | `/api/venue/compliance/records/[id]/void` | Void a record (requires `reason`) |
| `GET` | `/api/venue/compliance/requirements` | List service requirements (filter: `appointment_service_id`) |
| `POST` | `/api/venue/compliance/requirements` | Add a requirement |
| `PATCH` | `/api/venue/compliance/requirements/[id]` | Update enforcement / lock period |
| `DELETE` | `/api/venue/compliance/requirements/[id]` | Remove a requirement |
| `POST` | `/api/venue/compliance/form-links` | Issue a form link and send via email/SMS |
| `GET` | `/api/venue/compliance/form-links` | List active links (filter: `guest_id`, `status`) |
| `POST` | `/api/venue/compliance/form-links/[id]/revoke` | Revoke an unconsumed link |
| `POST` | `/api/venue/compliance/form-links/[id]/resend` | Resend an existing link (does not regenerate `code`) |
| `GET` | `/api/venue/bookings/[id]/compliance` | Resolved compliance state for a booking (extends existing booking-detail surface) |
| `GET` | `/api/venue/guests/[guestId]/compliance` | All records for a guest (mirrors `/guests/[guestId]/documents`) |
| `GET` | `/api/venue/compliance/dashboard` | Aggregated view for the compliance dashboard (§3.5) |

The two right-most routes deliberately live under `/bookings/` and `/guests/` rather than under `/compliance/` because they are "data for the booking detail surface" / "data for the contact detail panel" — the codebase already follows this colocation pattern (see `/api/venue/guests/[guestId]/documents/`, `/api/venue/guests/[guestId]/timeline/`).

### 9.2 Public routes — client form submission and pre-check

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/public/compliance/pre-check` | Return service requirements + enforcement levels for a `?venue_id=&service_id=` (no guest identity needed; used when the service is selected on the booking page) |
| `POST` | `/api/public/compliance/pre-check` | Body `{ venue_id, service_id, email }` — additionally resolves whether the guest identified by email has valid records; returns per-requirement resolved state (`SATISFIED`, `MISSING`, `EXPIRED`, `LOCK_PASSED`) |
| `GET` | `/api/public/compliance/forms/[code]` | Fetch the form schema bound to a link (no auth) |
| `POST` | `/api/public/compliance/forms/[code]/submit` | Submit responses (no auth, single-use) |

Public routes use the admin client (service role) and enforce all guards in code. They live under `/api/public/` rather than `/api/booking/` because they are not part of the booking flow — they are a sibling concern.

**Rate limiting:** `POST /api/public/compliance/forms/[code]/submit` and `POST /api/public/compliance/pre-check` must be rate-limited at the edge (Vercel middleware or a lightweight in-memory counter per `x-forwarded-for` IP). Suggested limits: 10 submissions per code per hour; 30 pre-check requests per IP per minute. This prevents brute-force enumeration of guest email / record status via the pre-check endpoint. The `code` itself is already single-use and short-lived, but rate limiting is a defence-in-depth measure.

The user-facing URL `/p/forms/{code}` is a Next.js page route ([src/app/p/forms/[code]/page.tsx]) that calls the public API.

### 9.3 Plan-tier guard

Every staff route in §9.1 begins with:

```typescript
const staff = await getVenueStaff(supabase);
const venue = await staff.db.from('venues').select('id, pricing_tier').eq('id', staff.venue_id).single();
if (!isAppointmentPlanTier(venue.data?.pricing_tier)) {
  return NextResponse.json({ error: 'Feature not available on this plan.' }, { status: 403 });
}
```

(A small helper `requireCompliancePlan(staff)` is added to `src/lib/compliance/auth.ts` so the check is one line per route.)

---

## 10. Row-level security

All six tables enable RLS. Policies follow the established pattern:

```sql
CREATE POLICY "staff_select_compliance_types"
  ON compliance_types FOR SELECT
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

CREATE POLICY "staff_manage_compliance_types"
  ON compliance_types FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

CREATE POLICY "service_role_compliance_types"
  ON compliance_types FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Per-table specifics:

- `compliance_records` and `compliance_audit_events`: **no DELETE policy**. The audit table also has the append-only trigger (see §4.7).
- `compliance_form_links`: no public anon SELECT. The public form route looks links up via the admin client and never exposes the table through PostgREST.
- `compliance-files` Supabase Storage bucket: private. Files served via signed URLs only, exactly like the `guest-documents` bucket precedent.

Migration file should turn each policy into an `IF NOT EXISTS`-guarded block, matching the project's idempotent-migration convention.

---

## 11. UI components

Reuse and create as follows.

### 11.1 Reused

- `<Dialog>` from [`src/components/ui/primitives/Dialog.tsx`](src/components/ui/primitives/Dialog.tsx) (Radix-based, project standard — see [Docs/DESIGN_SYSTEM.md](Docs/DESIGN_SYSTEM.md))
- `<Sheet>` from `src/components/ui/primitives/Sheet.tsx` for right-drawer record views
- `<ConfirmDialog>` for void/archive confirmations
- `<SectionCard>`, `<PageHeader>`, `<PageFrame>`, `<TabBar>`, `<Pill>`, `<EmptyState>`, `<DashboardEntityRowActions>` from [`src/components/ui/dashboard/`](src/components/ui/dashboard/)
- `<details>` accordion using `bookingExpandAccordion*` class helpers in the booking detail surface (matches existing UI; do not introduce Radix `<Tabs>` there)
- Existing communications dispatch (`sendPolicyMessage`) for email/SMS sends — see §12
- Existing storage signing pattern (sign → upload → complete) used by [`ContactDocumentsSection`](src/components/dashboard/contacts/ContactDocumentsSection.tsx)
- `lint:modals` and `lint:ci` enforcement: no hand-rolled modal shells. The [DESIGN_SYSTEM.md](Docs/DESIGN_SYSTEM.md) rule applies — use `Dialog` / `Sheet` only

### 11.2 New shared component — `<ComplianceSection>`

The component used in both the booking detail surface and `ContactDetailPanel`:

```tsx
<ComplianceSection
  guestId={guest.id}
  bookingId={booking?.id}                       // optional — drives the requirements panel
  appointmentServiceId={booking?.appointment_service_id ?? null}   // practitioner_appointment venues
  serviceItemId={booking?.service_item_id ?? null}                 // unified_scheduling venues
/>
```

The component passes whichever is non-null to the requirements panel. The `GET /api/venue/bookings/[id]/compliance` endpoint returns the resolved requirement state using the same FK-selection logic as the resolution algorithm (§5.1 step 0).

Lives at `src/components/dashboard/compliance/ComplianceSection.tsx`. Internally splits into:

- `<ComplianceRequirementsPanel>` — only rendered when both `bookingId` and `appointmentServiceId` are present
- `<ComplianceRecordsList>` — the guest's full history
- `<ComplianceAuditTrail>` — collapsed by default

Data is fetched through SWR (`swr` is already a project dependency) using the API routes in §9.

### 11.3 New component — `<ComplianceFormRenderer>`

A single component that renders a `form_schema` document. Two modes:

- `<ComplianceFormRenderer schema={...} mode="staff" />` — includes `staff_only` fields, allows partial save (drafts deferred to v2 means save = submit in v1)
- `<ComplianceFormRenderer schema={...} mode="public" onSubmit={...} />` — hides `staff_only`, full submit

Used in:

- Form builder preview (§7.6)
- Staff capture modal (`<Dialog>` from §3.1)
- Public submission page (§3.4)

This is the single rendering implementation. Reviewer should reject any second renderer.

Built on `react-hook-form` + `@hookform/resolvers` + `zod` — all already in `package.json`.

### 11.4 New `<Pill>` variants

[`src/components/ui/dashboard/Pill.tsx`](src/components/ui/dashboard/Pill.tsx) currently supports a small set of colour variants; add (without breaking existing ones):

| Variant | Colour | Use |
|---|---|---|
| `compliance-current` | green | record valid, not expiring soon |
| `compliance-expiring` | amber | record valid, expiring within 30 days |
| `compliance-expired` | red | record expired |
| `compliance-missing` | grey | requirement unmet, no record |
| `compliance-pending` | blue | link issued, awaiting submission |
| `compliance-voided` | slate | record voided |

### 11.5 New component — `<ComplianceRequirementsEditor>`

The inline requirements editor described in §3.6. Shared between two surfaces:

- **Service editor** — embedded inside `AppointmentServicesView` as a `<SectionCard>` at the bottom of the service form
- **Settings → Compliance → Service requirements** — used per-row to allow drilling into a single service without the full matrix

```tsx
<ComplianceRequirementsEditor
  appointmentServiceId={service.id}
  complianceEnabled={featureFlags.compliance_records_enabled}
/>
```

Lives at `src/components/dashboard/compliance/ComplianceRequirementsEditor.tsx`. Fetches its own data via SWR (`GET /api/venue/compliance/requirements?appointment_service_id=...`). Mutations call `POST/PATCH/DELETE /api/venue/compliance/requirements/...` and revalidate on success.

Reviewer should reject a second inline-requirements implementation in the service editor that is not this component.

### 11.6 New component — `<ComplianceFormBuilder>`

The drag-and-drop builder described in §7. Internally uses `@dnd-kit/sortable`. The output is a `form_schema` JSON document. Lives at `src/components/dashboard/compliance/ComplianceFormBuilder.tsx`.

---

## 12. Communications

The existing communications subsystem is **policy-driven**, not template-driven: a `VenueCommunicationPolicies` JSONB on the venue defines per-message-key behaviour (enabled, channels, hours-before/after, optional `emailCustomMessage` / `smsCustomMessage` overrides), and rendering is done by `renderCommunicationEmail` / `renderCommunicationSms` in [`src/lib/communications/renderer.ts`](src/lib/communications/renderer.ts). New compliance messages plug into this same framework — they are not free-text templates editable per venue, and they are not added to a "templates" UI.

### 12.1 New message keys

Extend `CommunicationMessageKey` in [`src/lib/communications/policies.ts`](src/lib/communications/policies.ts) with:

- `compliance_form_request` — initial link, sent when staff issue a link or auto-send on booking
- `compliance_form_reminder` — sent if a pending link hasn't been consumed within the configured reminder cadence
- `compliance_record_expiring` — sent N days before an existing record's `expires_at`

`buildDefaultLanePolicies()` is updated to include defaults for each key. Compliance messages are added to the `appointments_other` lane (not `table`).

### 12.2 Template bodies

Bodies live as TypeScript constants alongside the existing renderer-resolved templates. There is no per-venue customisation of message *body* in v1 — only of channel and timing (the existing policy fields). Venues that want bespoke copy must wait for a v2 communications-templates editor that addresses this gap globally, not as a compliance-specific feature.

**Email — initial form request:**

> Subject: `Please complete your {{ form_name }} before your appointment`
>
> Hi {{ guest_first_name }},
>
> Before your upcoming appointment on {{ booking_date_long }} at {{ venue_name }}, please take a moment to complete your {{ form_name }}.
>
> [Complete the form] {{ form_link }}
>
> This link is unique to you and will expire in {{ expiry_days }} days.

**SMS — initial form request** (single segment, ≤160 chars):

> {{ venue_name }}: please complete your {{ form_name }} before your {{ booking_date_short }} visit. {{ form_link }}

**Email — reminder, Email — expiring soon:** equivalent bodies, see implementation file.

### 12.3 Channel / timing controls

Surfaced in **Settings → Communications** (the existing `CommunicationTemplatesSection`), alongside the other message-key policies. No new UI is added in Settings → Compliance for this — compliance messages join the existing list.

---

## 13. Privacy, security, and legal

### 13.1 Data classification

Some compliance records contain special-category data under UK GDPR (health, allergies, medical history). This has implications:

- **DPA addendum.** Venue terms (currently at [src/app/terms/data-processing/page.tsx](src/app/terms/data-processing/page.tsx)) must be reviewed to ensure compliance records are covered as processor-controller data; an update may be required before founding-pilot rollout.
- **Encryption at rest.** Compliance record payloads and signature files stored in Supabase are encrypted at rest by Supabase. No additional encryption needed for v1.
- **Access logging.** Every staff read of an individual record (`GET /api/venue/compliance/records/[id]`) writes to `compliance_audit_events` with `event_type = 'record.viewed'`. The dashboard list view does not write per-record view events (would be too noisy and not load-bearing for the audit story).
- **Retention.** Records are retained for as long as the guest exists. When a guest is GDPR-erased (existing pipeline, ultimately the `account-hard-delete` cron at [src/app/api/cron/account-hard-delete/route.ts]), the `ON DELETE CASCADE` on `compliance_records.guest_id` removes them. Add the `compliance-files` storage bucket to the erase manifest so signature/file objects are also deleted.

### 13.2 Signature legal weight

The signature captured (drawn or typed) is sufficient for the target segments under English/NI common-law contract principles, provided audit metadata is captured. Each signature is associated with:

- Form version ID (`compliance_type_version_id`)
- Timestamp (server-side `captured_at`)
- Client IP (`capture_ip`)
- User agent (`capture_user_agent`)
- Link ID (proves the URL came from a venue-issued source)

This is described in the venue terms as a "simple electronic signature." Regulated medical aesthetics venues that require a qualified electronic signature are out of scope for v1.

### 13.3 File upload security

For the `file` field type:

- Stored in the `compliance-files` Supabase Storage bucket (private; storage policies scope by `venue_id` in the path prefix, exactly like `guest-documents`)
- Upload flow mirrors `ContactDocumentsSection`: client requests a signed PUT URL, uploads directly, calls `/complete` to confirm
- File MIME type and size validated server-side on both `/sign` and `/complete` (max 10 MB; allowlist: `application/pdf`, `image/jpeg`, `image/png`, `image/heic`, `image/webp`)
- Files served via signed GET URLs with short expiry, never public direct links

### 13.4 Link security

- `code` is 10 chars from a 36-char alphabet (`crypto.randomBytes`) — ~52 bits of entropy, sufficient for a single-use, short-lived, revocable credential.
- Links are single-use (transition `pending → consumed` is atomic with the record insert via a serialisable transaction).
- Links expire after a configurable window (default 14 days).
- Links are revocable by staff at any time (`status → revoked`).
- Link URLs sent only via the venue's verified comms channels (email via SendGrid; SMS via Twilio).

---

## 14. Migration and rollout

### 14.1 Database migrations

Pattern follows recent multi-file migrations (e.g. [linked-accounts](supabase/migrations/20260919120000_linked_accounts.sql)): one logically-grouped migration file using `IF NOT EXISTS` / `CREATE POLICY ... IF NOT EXISTS` everywhere so it is idempotent on Supabase preview branches.

File: `supabase/migrations/2026XXXX_compliance_records.sql` containing in this order:

1. Create `compliance_types`, `compliance_type_versions` (deferrable FK from type → version), `compliance_records`, `service_compliance_requirements`, `compliance_form_links`, `compliance_audit_events`.
2. Create the indexes and partial indexes listed in §4.
3. Enable RLS on every table; create SELECT/ALL policies for staff JWT and `service_role`. No DELETE policy on `compliance_records` or `compliance_audit_events`.
4. Create the append-only trigger for `compliance_audit_events` (model on `events_append_only`).
5. Create the storage bucket: `INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('compliance-files', 'compliance-files', false, 10485760) ON CONFLICT (id) DO NOTHING;`.

After applying, regenerate the inventory in [Docs/schema.sql](Docs/schema.sql) per the convention noted at the top of that file (six new tables added to a new "Compliance" domain section).

### 14.2 Feature flag

Ship behind a venue-level flag. The compliance flag is added to [`src/lib/feature-flags/types.ts`](src/lib/feature-flags/types.ts):

```typescript
export const APPOINTMENTS_FEATURE_FLAG_KEYS = [
  'waitlist_v2',
  'guest_self_reschedule',
  'any_available_practitioner',
  'compliance_records_enabled',  // NEW
] as const;
```

…with `FEATURE_FLAG_COMPLIANCE_RECORDS_ENABLED` as the env-var override key (per the convention in `resolve.ts`). Default off. Global settings live in `venues.feature_flags.compliance` as a nested config object (auto-send default, reminder cadence, lock period, etc. from §3.3.3).

Document the flag in [Docs/FEATURE_FLAGS.md](Docs/FEATURE_FLAGS.md).

### 14.3 Soft-launch path

1. Internal test on a staff sandbox venue with the full library.
2. One founding-pilot enabled — a beauty/lash venue is the highest-value test (validates expiry semantics, online submission, blocking enforcement).
3. Roll to all opted-in pilots.
4. Default-on for new signups in segments where compliance is segment-critical (lash, brow, colour).

### 14.4 Documentation

A help-centre article per industry — "Compliance for hair salons", "Compliance for dog groomers", etc. Articles live in [`src/lib/help/articles/`](src/lib/help/articles/) following the existing pattern. Each article references the library templates relevant to that segment.

---

## 15. Build sequence

A suggested build order for a single developer working with Cursor. Each step is independently testable. Step file/route names follow the conventions established earlier in this document.

| Step | Scope | Estimated effort |
|---|---|---|
| 1 | DB migration: six tables + indexes + RLS + append-only trigger + storage bucket; regenerate `Docs/schema.sql` | 1 day |
| 2 | Add `compliance_records_enabled` to feature-flags module; document in `FEATURE_FLAGS.md` | 0.5 days |
| 3 | API endpoints: `/api/venue/compliance/types*` (CRUD + versions + archive/restore + library list/clone) | 2 days |
| 4 | Library: define the 10 v1 templates as TypeScript under `src/lib/compliance/library/` | 1 day |
| 5 | Settings → Compliance section: types list, "Add from library" modal, archive action | 1 day |
| 6 | Form builder pages under `/dashboard/compliance-types`: drag-and-drop, validation, save → new version | 4 days |
| 7 | API endpoints: `/api/venue/compliance/records*`, `/api/venue/compliance/requirements*` | 1 day |
| 8 | `<ComplianceRequirementsEditor>` shared component (§11.5) | 1 day |
| 9 | Service requirements in Settings → Compliance (matrix using step 8) + service editor section in `AppointmentServicesView` (§3.6, also using step 8) | 1 day |
| 10 | `<ComplianceFormRenderer>` shared component (staff + public modes) | 2 days |
| 11 | Staff capture modal (uses step 10) | 1 day |
| 12 | API endpoints: `/api/venue/compliance/form-links*` (issue, revoke, resend) | 1 day |
| 13 | Public form page `/p/forms/[code]` + `/api/public/compliance/forms/*` endpoints | 2 days |
| 14 | Communications: add three message keys to policies, defaults, renderers | 1 day |
| 15 | `<ComplianceSection>` shared component + `<ComplianceRecordsList>` + `<ComplianceAuditTrail>` | 2 days |
| 16 | Integrate `<ComplianceSection>` accordion into `ExpandedBookingContent` / `BookingDetailSurface` | 1 day |
| 17 | Integrate `<ComplianceSection>` into `ContactDetailPanel` (new `ContactComplianceSection.tsx`) | 1 day |
| 18 | Requirements Resolution Algorithm (server-side, `src/lib/compliance/resolve-requirements.ts`) | 2 days |
| 19 | Booking-creation hook to enforce requirements (public booking + staff `POST/PATCH /api/venue/bookings*`) | 1 day |
| 20 | Compliance dashboard at `/dashboard/compliance` + sidebar nav item | 2 days |
| 21 | Nightly expiry cron + reminder dispatch (register in `vercel.json`) | 1 day |
| 22 | End-to-end tests (Playwright), unit tests (Vitest), docs polish | 4 days |
| | **Total** | **~34 working days (≈ 6–8 weeks calendar)** |

---

## 16. Open questions for product review

These are items the spec has made a choice on but you may want to revisit before development starts.

1. **Plan-tier inclusion — RESOLVED.** Available on all Appointments tiers; not available on `restaurant` / `founding` (no Model B services to bind to). See §8.
2. **Booking-model scope — RESOLVED for v1.** Requirements bind to Model B appointment services (`appointment_services` for legacy, `service_items` for unified). Class / event / resource bindings are a v2 question. See §5.0.
3. **Link expiry default — RESOLVED.** Platform default is 14 days, overridable at the venue level (general settings) and per compliance type (`compliance_types.form_link_expiry_days`). No further action needed.
4. **Auto-send vs manual-send.** When a booking is created with an unmet online-capturable requirement, the system can auto-send the form link or wait for staff to send it. Default in this spec is **manual**, to avoid surprise client communications. Revisit after pilot data.
5. **Photo capture.** Genuinely useful for dog groomers (record of arrival condition), beauty (before/after), tattoo (placement). v1 punts it. If we want it in v1, add ~4 days to step 9.
6. **Public form mobile design.** v1 is responsive web. Native mobile capture (device camera for signature, file from photo library) ships when the React Native app picks up compliance — likely v2 with capture channel `staff_mobile`.
7. **Per-venue body customisation of compliance emails/SMS.** Spec keeps bodies as platform-rendered (no editor), matching how other policy messages work today. If the team wants venue-editable bodies, that's a cross-cutting communications change, not a compliance-only one.

---

## 17. Future evolution

Items the data model deliberately accommodates, to be exposed in later UI work:

- **Conditional logic** — `form_schema.fields[].show_if` is reserved but not used in v1
- **Sections** — `form_schema.sections[]` is reserved
- **Calculated fields** — `form_schema.computed[]` is reserved
- **Multi-signature consents** — `compliance_records.responses` is a free-form JSONB and can hold a `signatures[]` array without a schema migration
- **Library version tracking** — `library_template_slug` lets us identify venue copies of well-known forms and offer to sync with platform-updated library entries (or vendor-managed sources like Colourstart if integrated later)
- **External submission methods** — adding `capture_channel = 'api'` allows third-party integrations to post a record directly; the audit trail handles it
- **Class / event / resource requirements** — add `class_type_id`, `experience_event_id`, `venue_resource_id` columns to `service_compliance_requirements` and extend the resolution engine to look them up by the booking's corresponding FK

The principle is that v2 features extend the JSON schema and add UI; they do not require schema-shape migrations.

---

*End of specification.*
