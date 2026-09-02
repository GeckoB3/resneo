# Compliance forms in the customer booking flow: placement, identity-aware requirements, and venue-wide forms

**Status:** plan, not implemented. Written 2026-09-01 against `staging` at `e6553941`. The four open decisions in section 7 were resolved by the user the same day; the body below reflects them.
**Progress:** all four parts implemented on `staging` 2026-09-01, uncommitted. Part C's migration (`20270201120000_compliance_venue_wide_requirements.sql`) has not been pushed to any database yet; follow the standing migration ritual (staging db push, test, prod db push).
**Authorities:** `reserveni-compliance-spec.md` (the shipped model), `archive/reserveni-compliance-improvement-plan.md` §9 (the in-booking collection design and its resolved decisions). This document changes three things in that model and says exactly which.

## 0. The three asks, and what the code does today

| Ask | Today | Why |
|---|---|---|
| A. Inline compliance forms should sit **below** the customer detail fields, not above them | The "Before you book" card renders above the whole details step, including the cancellation policy and every field | `BookingComplianceBlock` is a sibling rendered before `<DetailsStep>` at `src/components/booking/AppointmentBookingFlow.tsx:4936-4951` (single and multi-service) and `:5830-5838` (group). `DetailsStep.tsx` knows nothing about compliance |
| B. Only show a form when **this customer** actually needs it (once per customer, once per service, once per period) | Forms are fetched by **service only** and always shown. The email pre-check exists but only drives the notice text; it never hides a form | `BookingComplianceForms.tsx:134-166` calls `GET /api/public/compliance/inline-forms?venue_id&service_id`, which has no identity. `CompliancePreCheckNotice.tsx:121-164` does resolve by email (`POST /api/public/compliance/pre-check`), but the two components share nothing except `suppressTypeIds` |
| C. Some forms should apply to **all bookings**, not one service (new client intake) | Impossible. A requirement row must reference exactly one service | `CHECK (num_nonnulls(appointment_service_id, service_item_id) = 1)` in `supabase/migrations/20261203120000_compliance_records.sql:127`; the resolver refuses to run without a service FK (`src/lib/compliance/resolve-requirements.ts:267-270`); the editor and settings panels only enumerate services |
| D. Staff must **never** be prevented from booking because of compliance | `block_all` blocks staff (spec §5.1 step 4). The server supports an admin override, but **no staff UI sends it**, so an admin sees a red banner and no way through | `isBlocking` in `resolve-requirements.ts:170-185`; `override_compliance` accepted at `src/app/api/venue/bookings/route.ts:139,1394`, `walk-in/route.ts:70,421`, `[id]/route.ts:2897`, but never set anywhere in `src/components` |

Two facts that make B and C cheaper than they look:

1. **"Once per customer / once per period / once per visit" already exists.** It is `compliance_types.validity_period_days`: `null` = lifetime (once per customer, ever), `N` = once every N days, `0` = per visit. The resolver already honours it (`isRecordValidForBooking`, `resolve-requirements.ts:71-92`). Nothing new is needed on the type. A new client intake form is simply a venue-wide requirement on a type with lifetime validity.
2. **The pre-check already answers "does this customer need it".** `publicPreCheckForGuest` (`src/lib/compliance/public-forms-service.ts:453-482`) returns `SATISFIED / MISSING / EXPIRED / LOCK_PASSED` per type for an email. The gap is wiring, not engine.

The main gaps to close are in section 3 (identity rule mismatch, forms not gated on the resolved state) and section 4 (schema and every loader that filters by service FK).

## 1. Non-negotiables carried forward

- Reuse the existing customer booking flow (`AppointmentBookingFlow` + `DetailsStep`) and the existing settings surfaces (Settings → Compliance, the service editor's requirements section). No new booking step, no new settings page.
- The server stays the security boundary. The create routes already capture inline submissions and then run the gate (`create/route.ts:1742-1764` then `:1882`). The client pre-check is a courtesy, never trusted.
- Everything stays behind `compliance_records_enabled` and the Appointments tier (`src/lib/compliance/auth.ts:24-68`).
- No em-dashes in any user-facing copy.
- Migrations are expanding only (the staging → prod ritual cannot take a contracting migration; see `migration-deploy-process` in memory).

## 2. Part A: put the forms below the customer details

### 2.1 Constraint

`ComplianceFormRenderer` renders its own `<form>` and submit button (`src/components/dashboard/compliance/ComplianceFormRenderer.tsx:151,320-329`). `DetailsStep` is one `<form>` (`DetailsStep.tsx:443-707`). Forms cannot nest, so the block cannot simply be dropped between the fields and the submit button inside that element.

### 2.2 Design

Split `DetailsStep`'s markup into three parts without changing its react-hook-form state:

1. `<form id={formId} onSubmit={handleSubmit(onValidSubmit)}>` containing the contact fields, address, notes and the appointment request field (everything up to the end of the field list, roughly `:443-651`).
2. A new slot prop, `beforeFooter?: React.ReactNode`, rendered after that form closes. The flow passes `<BookingComplianceBlock … />` here.
3. A footer `<div>` holding the marketing and terms checkboxes (`:654-673`) and the submit button (`:676-704`). The button gains `form={formId}` so it still submits the fields form from outside it; the checkboxes stay registered with react-hook-form (registration is by ref, not by DOM ancestry, so validation of `acceptTerms` keeps working).

Result, top to bottom: summary chips → cancellation policy → name, email, phone, notes → **compliance forms** → consent checkboxes → Confirm. Pressing Enter inside a compliance form submits that form only (it is its own element), which is the current behaviour.

`DetailsStep` has seven consumers (`BookingFlow`, `ClassBookingFlow`, `EventBookingFlow`, `ResourceBookingFlow`, `appointment-public-ui`, `BookingSubmittingPanel`, `AppointmentBookingFlow`). The prop is optional and the split is purely structural, so the others are untouched. Verify each still renders the checkboxes and button (a `form=` attribute on a button outside its form is standard HTML, but the class-based `submitClassName` override from `publicDetailsFieldProps` must survive the move).

### 2.3 Changes

- `src/components/booking/DetailsStep.tsx`: the split above, plus `beforeFooter`.
- `src/components/booking/AppointmentBookingFlow.tsx:4936-4951` and `:5830-5838`: move `BookingComplianceBlock` from a sibling into the `beforeFooter` prop. The `mandatoryComplete` guard in `handleDetailsSubmit` (`:2563-2566`) stays; its message "Please complete the required form(s) above before booking." must change to "below" or, better, "Please complete the required form(s) before booking." and the error should scroll the block into view (add a `ref` on the block wrapper and `scrollIntoView` in the guard).
- The block's own heading stays "Before you book". Consider renaming to "A form for this booking" once it sits under the fields; optional.

Effort: half a day. Ship on its own.

## 3. Part B: show a form only when this customer needs it

### 3.1 Behaviour

1. Customer picks a service and time, lands on the details step. **No inline form is shown yet** (identity unknown). If a requirement exists that cannot be met online (`online_collection = 'none'`, or a staff-only type), the existing notice still explains it as today.
2. As the customer types, once the email is well-formed (the existing 500 ms debounce in `CompliancePreCheckNotice.tsx:124-128`), the flow resolves every requirement for the chosen service(s) **and venue-wide requirements** against that identity and the chosen slot.
3. For each requirement resolved `MISSING`, `EXPIRED` or `LOCK_PASSED` whose `online_collection = 'inline'` and type is client-completable: render the form under the fields. Mandatory ones (`block_online`, `block_all`) gate Confirm; `warn_client` ones are offered but skippable (today's rule, `BookingComplianceForms.tsx:41,181-183`).
4. For each requirement resolved `SATISFIED` or `EXPIRING_SOON`: show nothing for that type. The customer books unimpeded. (`EXPIRING_SOON` still satisfies the booking; the expiry cron handles renewal reminders.)
5. If the customer changes their email, re-resolve. Forms already filled stay in local draft state (`form-draft.ts`) and are only sent if still required for the final identity, which is the current filtering rule at `BookingComplianceForms.tsx:174-180`.
6. Signed-in customers arrive with the account email pre-filled (`AppointmentBookingFlow.tsx:725-727`), so their check runs immediately on entering the step.

Decision (resolved 2026-09-01): forms **appear after** the email is typed rather than appearing immediately and disappearing when a match is found. It is the literal reading of the ask ("if it is not required, the form should not be shown") and avoids a form vanishing under the customer's cursor. The cost is that a brand-new customer sees a form pop in below the fields after typing their email. A one-line placeholder while identity is unknown ("Some services need a short form. We will check once you have entered your email.") keeps this from feeling abrupt. The alternative, show first and hide on a match, was considered and rejected.

### 3.2 One endpoint instead of three calls per service

Today the block issues, per unique service, `GET pre-check`, `POST pre-check` (with email) and `GET inline-forms`. For a three-segment multi-service booking that is nine requests. Replace with one:

`POST /api/public/compliance/booking-requirements`

Request:
```json
{
  "venue_id": "uuid",
  "service_ids": ["uuid", "uuid"],
  "booking_date": "2026-09-14",
  "booking_time": "10:30",
  "email": "optional"
}
```

Response, one entry per compliance type after deduping across services and venue-wide rows:
```json
{
  "identity_known": true,
  "requirements": [
    {
      "compliance_type_id": "uuid",
      "compliance_type_name": "New client intake",
      "enforcement": "block_online",
      "online_collection": "inline",
      "client_online": true,
      "online_unmet_message": null,
      "scope": "venue",
      "state": "MISSING",
      "form": { "version_id": "uuid", "form_schema": { … staff_only stripped … } }
    }
  ]
}
```

- `state` is `null` when no identity was supplied (`identity_known: false`).
- `form` is present only when `state` is unmet, `online_collection = 'inline'`, and the type is client-completable and active. This is the existing eligibility filter from `publicInlineFormsForService` (`public-forms-service.ts:401-407`) applied after resolution.
- Rate limit per IP as the pre-check is today (`PRECHECK_PER_IP_PER_MIN = 30`, `pre-check/route.ts:11`). The response reveals only requirement state, never record contents, which matches what the existing POST pre-check already exposes.
- Reference time is the chosen slot, not `new Date()` as in `publicPreCheckForGuest` today (`:470`). This makes lock periods and expiry correct for a booking two weeks out.

Implementation: a new `publicBookingRequirements(admin, params)` in `public-forms-service.ts` composed from `loadAndResolveServiceRequirements` (one call per service id, plus the venue-wide rows once Part C lands) and the schema loading half of `publicInlineFormsForService`. Worst-wins merge across services by `STATE_RANK`, as the notice does now (`CompliancePreCheckNotice.tsx:47,146-152`). The old `pre-check` and `inline-forms` routes have no other consumers (grep confirms) and can be deleted in the same change, with their tests folded into the new service's tests.

### 3.3 Fix the identity rule so the check matches the booking

The pre-check matches a guest by `ilike` on the raw email (`public-forms-service.ts:456-462`). Booking creation uses `findOrCreateGuest` (`src/lib/guests.ts:139-232`), which applies `normaliseEmail` and an exact match. The two can disagree on whitespace or unusual casing, and the pre-check never sees the account-linking rule below.

**Why phone stays out of the public check (decision, 2026-09-01).** `findOrCreateGuest` matches by email, then by phone, else inserts. But every online create route passes `silentAuthSignup: true` whenever an email is present (`create/route.ts:268`, `create-group/route.ts:178`, `create-multi-service/route.ts:182`), and in that mode the phone fallback is **skipped on purpose** so a new email is never attached to an unrelated phone record (`guests.ts:142-143`). The public details form always has an email. So an online booking is matched by email or gets a brand-new guest; the phone is never consulted. A phone match in the check would therefore tell a customer "already on file", hide the form, and then the server gate, running against the fresh guest, would reject the booking. Relaxing the account-linking rule instead would let a new account attach to another person's guest history, which is a bigger problem than the one being solved. Email only it is. A returning customer who used a different email last time sees the form again, and the notice's existing "you may have used a different email" nudge covers that case.

Implementation: extract the read-only email lookup from `findOrCreateGuest` into `findGuestByEmail(admin, venueId, email)` in `src/lib/guests.ts` (same `normaliseEmail`, same exact match) and use it in the new endpoint. The create routes keep `findOrCreateGuest` unchanged; both now agree on who the customer is.

### 3.4 Client changes

- `BookingComplianceBlock.tsx` becomes the single owner of the fetch: it takes `serviceIds`, `email`, `bookingDate`, `bookingTime`, calls the new endpoint (debounced on identity, immediate on service or slot change) and passes the result down. `CompliancePreCheckNotice` and `BookingComplianceForms` become presentational and stop fetching. `suppressTypeIds` plumbing disappears because both children read the same list.
- `DetailsStep` keeps `onEmailChange` (`DetailsStep.tsx:235-245`), wired only for the public audience as today. No phone callback.
- `BookingComplianceState` gains `resolving: boolean`. While a resolve is in flight and any known inline requirement is mandatory, `handleDetailsSubmit` waits for it (a short "Checking your details" state on the button) rather than submitting blind. The server still re-checks; this only avoids a needless 409.
- Handle `COMPLIANCE_REQUIREMENT_UNMET` (409) explicitly in `publicCreateErrorMessage`'s callers (`AppointmentBookingFlow.tsx:2635,2774,3025`): re-run the requirements fetch, scroll to the block, and show the server message next to the forms instead of only in the top banner. Today no component references the code at all.
- Group flow (`:5830-5838`): same block, same endpoint, `service_ids` = every attendee's service. The group flow collects one set of contact details, so one identity resolves all attendees, as the server already assumes (`create-group/route.ts:643-647`).

### 3.5 Server hardening that falls out

`captureBookingComplianceSubmissions` (`src/lib/compliance/booking-capture.ts:53-151`) validates a submission against the type's current version and the client-online capture method, but **not** that the type is a requirement of the booked service(s) with `online_collection = 'inline'`. Add that membership check (service rows plus venue-wide rows) and reject others with 400. Cheap, and it stops a crafted request creating records for arbitrary types.

Also carry `version_id` in each submission and reject with a friendly 409 if it no longer matches the current version (a venue edited the form mid-booking). Today the server silently validates against the new version, which can fail on a required field the customer never saw.

Effort: two to three days including tests. Ships after Part A, before Part C.

## 4. Part C: requirements that apply to all bookings

### 4.1 Model

Add a scope to the requirement row rather than a second table, so every loader, the editor and the audit trail stay on one path.

Migration (expanding):
```sql
ALTER TABLE public.service_compliance_requirements
  ADD COLUMN scope text NOT NULL DEFAULT 'service'
  CHECK (scope IN ('service', 'venue'));

ALTER TABLE public.service_compliance_requirements
  DROP CONSTRAINT service_compliance_requirements_one_service_fk;
ALTER TABLE public.service_compliance_requirements
  ADD CONSTRAINT service_compliance_requirements_scope_fk CHECK (
    (scope = 'service' AND num_nonnulls(appointment_service_id, service_item_id) = 1)
    OR (scope = 'venue' AND num_nonnulls(appointment_service_id, service_item_id) = 0)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_compliance_req_venue_type
  ON public.service_compliance_requirements (venue_id, compliance_type_id)
  WHERE scope = 'venue';
```

Existing rows default to `scope = 'service'` and satisfy the new constraint unchanged. Code deployed before this migration filters by service FK and never sees a venue row, so the migration can land first (the standing ritual: staging code, staging push, test, prod push).

Scope in this iteration: **Model B appointment bookings only** (bookings with a service FK). Classes, events and resources have no requirements engine at all (spec §5.0) and extending to them is separate work. For an appointments business "all bookings" and "all service bookings" are the same thing. Decision confirmed 2026-09-01.

### 4.2 Resolution rule

`loadAndResolveServiceRequirements` (`resolve-requirements.ts:260-360`) loads rows where the service FK matches **or** `scope = 'venue'`:

```ts
.eq('venue_id', venueId)
.or(`${column}.eq.${serviceId},scope.eq.venue`)
```

When a type appears both venue-wide and on the specific service, the **service row wins** (it is the more specific setting; a venue may want a longer lead time or a stricter enforcement for one service). Dedupe by `compliance_type_id` after loading, preferring `scope = 'service'`. Unit test this.

`applicable` semantics do not change: a booking without a service FK is still skipped, per the scope decision above.

### 4.3 Every consumer that filters by service FK

Each of these must include venue rows, or the feature will be enforced at booking time but invisible on the dashboard, which is the worst combination:

| Site | Today | Change |
|---|---|---|
| `resolve-requirements.ts:273-280` (the gate, the booking detail accordion, auto-send, the public endpoint) | `.eq(column, serviceId)` | `.or(...)` plus dedupe, as above |
| `public-forms-service.ts:305-311, 363-369` | same | folded into `publicBookingRequirements` (Part B) |
| `booking-flags.ts:77-89` (calendar and bookings list badges) | `.in(column, ids)` per FK | add a second query for `scope = 'venue'` and merge per booking with the same dedupe rule |
| `dashboard-service.ts:194-210` (compliance dashboard: today's check-ins, outstanding) | same shape | same |
| `types-service.ts:294-297` (service count on the type row, archive guard) | counts rows by type | count still works; label the count "services and all bookings" or split it |
| `requirements-service.ts` `listRequirementsForVenue:101-116` | returns both FK columns | also return `scope` |
| `requirements-service.ts` `addRequirement:118-180` | `serviceId` required, 404 if not the venue's | accept `{ scope: 'venue' }` with no `serviceId`; insert with both FKs null; map 23505 on the new unique index to "All bookings already require that compliance type." |
| `zod-schemas.ts:66-72` `complianceRequirementCreateSchema` | `service_id` required | `scope` optional default `service`; `service_id` required iff `scope = 'service'` (a `superRefine`) |
| `src/app/api/venue/compliance/requirements/route.ts:29-63` | GET by service or venue list; POST | GET accepts `?scope=venue`; POST passes `scope` through |
| `auto-send.ts:75` | uses the loader | no change once the loader is right; verify the confirmation-link path sends the intake form for a venue-wide `confirmation_link` row |

### 4.4 Settings UI

Reuse the existing pieces; add one row group.

- **Settings → Compliance → Service requirements** (`ServiceRequirementsPanel.tsx:74-112`): add a pinned first accordion row titled **"All bookings"** above the per-service rows, rendering the same `ComplianceRequirementsEditor` in venue mode. Its count pill counts `scope = 'venue'` rows. Helper text under the title: "Forms listed here are asked for on every appointment booking, whatever the service. Use this for a new client intake form or a general consent."
- **`ComplianceRequirementsEditor.tsx:31-35`**: make `appointmentServiceId` optional and add `scope: 'service' | 'venue'`. Venue mode fetches `?scope=venue` and POSTs `{ scope: 'venue', … }`. Fields are identical (enforcement, lead time, online booking placement). The grouping helpers at `ServiceRequirementsPanel.tsx:47-53` and `AppointmentServicesView.tsx:232-240` currently skip rows with no FK; they must route those rows to the "All bookings" group instead of dropping them.
- **Service editor** (`AppointmentServicesView.tsx:1328-1336`): show a read-only line above the per-service list when venue-wide rows exist: "Also required for all bookings: New client intake (block online)". With a link to Settings → Compliance. This stops a venue adding the same form twice.
- **Rename the tab** "Service requirements" to "Requirements" so the "All bookings" row is not a contradiction.
- **Templates and types panel**: the library's `new-client-intake` template (`src/lib/compliance/library/templates/new-client-intake.ts`) already has lifetime validity and `client_online`. After cloning it, the venue sets one requirement under "All bookings" with `inline` and `block_online`. Consider a one-click "Ask every new client to complete this" affordance in the clone dialog later; not in scope now.

Copy rule applies throughout: no em-dashes.

### 4.5 "Once per customer" and "once per period" in the UI

No new setting. The existing "Validity" control on the type ("No expiry", "Per visit", N days; `shared.ts:99-105`) is exactly this. Add helper text to the validity field so the intent is discoverable: "No expiry: the customer completes this once. Per visit: every booking. A number of days: again after that long."

Effort: three to four days including the migration round and tests. Ships after Part B.

## 5. Part D: staff are never blocked

### 5.1 Decision

Decision confirmed 2026-09-01. In the `staff` enforcement context, **nothing blocks**. `block_all` becomes a strong warning for staff instead of a hard stop. This is a semantic change to the shipped model (spec §5.1 step 4, and the helper copy at `shared.ts:35-39` "No one can book … An admin can override") and needs the spec and the helper text updated in the same change.

Why not keep `block_all` and wire the override button? Because the ask is that staff are never prevented, so a "block that every admin must click through" is a warning with worse ergonomics, and non-admin staff would still be stuck.

### 5.2 Changes

- `isBlocking` (`resolve-requirements.ts:170-185`): return `false` whenever `context === 'staff'`. `summariseBlocking` (`:205-230`) puts unmet `block_all` and `block_online` requirements into `warnings` for staff, with a new `severity: 'required' | 'advisory'` field so the UI can tell "the venue requires this for everyone" from "worth chasing".
- `enforceBookingCompliance` / `checkBookingCompliance` (`enforce-booking.ts`): no change to shape; the 409 path is now unreachable for staff. Remove `adminOverride` and the `override_compliance` request field from `venue/bookings/route.ts`, `walk-in/route.ts` and `[id]/route.ts`, since nothing is left to override. (Removing a request field the mobile app might send: check `Docs/MOBILE_API.md` first; if the app sends it, keep accepting and ignoring it for one release.)
- `create-group/route.ts:662-676` uses the raw check rather than the helper, and `create-multi-service` uses the helper; after this change both behave the same for staff, but switch the group route to the helper anyway so there is one call shape.
- Staff booking UI: the existing "Outstanding compliance forms" card on the confirmation screen (`AppointmentBookingFlow.tsx:5110-5120`) already renders `compliance_warnings` from the staff route. Extend it to the group and multi-service staff paths (they return no warnings today) and show the required-severity items first with "Capture in venue" linking to the booking's compliance accordion, where `ComplianceCaptureDialog` already exists.
- Staff flow never renders `BookingComplianceBlock` (`:4937`, `:5830`); keep it that way. Staff capture forms after booking, in venue or by sending a link, which is the existing tooling.
- Copy: `ENFORCEMENT_OPTIONS` descriptions in `shared.ts` for `block_all` become "Clients cannot book this online until a valid record is on file. Your team can still book it from the dashboard and will see a clear reminder to collect the form." `block_online` copy stays. The enforcement picker then offers two block modes that differ only in how loudly staff are reminded; consider merging them into one "Block online booking" in a later cleanup, but do not drop the enum value now (existing rows reference it).
- Spec: rewrite §5.1 step 4 and §5.2's override paragraph; note the date and this document.
- Tests: `resolve-requirements.test.ts` (`isBlocking`, `summariseBlocking` for staff), `enforce-booking.test.ts` (override removed, staff never blocked, warnings carry severity).

Effort: one day. Small and independent; can ship first or second.

## 6. Sequence and test plan

| Order | Part | Why this order |
|---|---|---|
| 1 | A. Placement | Isolated, visible, no server change |
| 2 | D. Staff never blocked | Pure library change plus copy; removes the dead override plumbing before B and C build on the gate |
| 3 | B. Identity-aware forms | Replaces the three public endpoints with one; C's public side then comes for free |
| 4 | C. Venue-wide requirements | Needs the migration round; largest surface (every loader plus settings) |

Tests to add (there is no component test of the block today; the flow tests never mention compliance):

- `public-forms-service.test.ts`: `publicBookingRequirements` for anonymous, email match, a phone-only returning guest resolves as `MISSING` (mirrors creation), satisfied type produces no `form`, slot-based lock period, venue-wide plus service dedupe.
- `resolve-requirements.test.ts`: venue row merge and service-wins rule; staff context never blocks.
- `booking-capture.test.ts`: submission for a type that is not a requirement of the booked service is rejected; version mismatch is rejected.
- `requirements-service.test.ts`: `addRequirement` with `scope: 'venue'`, duplicate maps to 409.
- New `BookingComplianceBlock.test.tsx`: no forms before identity; form appears on `MISSING`; disappears on `SATISFIED`; mandatory gate; 409 re-fetch.
- Browser pass on the dev venue with the feature flag on, an inline `block_online` intake under "All bookings", and one per-service form: new customer, returning customer by email, returning customer whose only prior contact was a phone number (form shown again, booking succeeds), staff booking the same customer.

## 7. Decisions (resolved with the user, 2026-09-01)

1. **Forms appear after the email is typed** (section 3.1), not shown first and hidden on a match. Agreed.
2. **"All bookings" means all appointment bookings** in this iteration; classes, events and resources are out of scope. Agreed.
3. **Staff see a loud warning with a "Capture in venue" link instead of a block** (section 5). Agreed.
4. **Phone numbers do not join the public identity check.** The user wanted them included if it did not conflict with other functionality. It does: online booking creation deliberately ignores the phone when an email is present, for account-linking safety, so a phone match in the check would contradict the booking's own guest resolution and produce a rejected booking (section 3.3). Email only.
