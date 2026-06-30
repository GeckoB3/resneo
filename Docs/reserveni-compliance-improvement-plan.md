# Resneo Compliance — Competitive Review & Improvement Plan

**Status:** Phases 1–3 implemented ✅ · Phase 4 implemented ✅ (G6+G7) · **§9 addendum (June 2026 end-to-end audit + in-booking form collection): Phase 0 (enforcement bypasses) implemented ✅; Phase 1 (helper text + em-dash cleanup) implemented ✅; Phase 2 (in-booking form collection) ✅ + Phase 3 (records trustworthy) ✅ + Phase 4 (operability + needs-staff-decision prompt) ✅ + Phase 5 (hygiene) ✅ implemented. The §9 plan (Phases 0 to 5) is complete; remaining items are the deferred Low items noted in §9.5 and browser/E2E verification on a seeded venue.** G8 ("true inline completion during booking") is promoted from "deferred" to a specified design in §9.3. · **§10 addendum (June 2026 usability review): the §9 functional work all shipped and is correct; a follow-up review of staff form-building and guest form-completion found a layer of UX/builder gaps. §10.4 Steps 1–5 are implemented ✅, and Step 6's worthwhile wins (U8 option-value guard, U9 library preview) too; the remaining Step 6 items (U14, U15, U16, U6, bulk) were deferred by judgment as net-negative or low-value for a polish pass. A final adversarial review (§10.5) then fixed five code bugs found in those changes, and a doc-vs-code audit verified this section is accurate. A later UX pass (§10.6) improved the settings menu and clarity, removed two dead settings, and merged the customer booking panels (U14) — see §10.**
**Date:** June 2026 (Phase 1 shipped; §9 addendum added June 2026)
**Scope:** How Vagaro, Phorest, Booksy and Fresha integrate compliance/intake/consent forms into booking, vs. Resneo's current implementation, and a prioritised plan to close the gaps. The §9 addendum extends this with a full code audit and the in-booking form-collection design.

> **Phase 1 status (G1–G3): DONE.** Auto-issue links for unmet client-online requirements when a booking is made; the form is carried in the **booking confirmation** (email HTML + text) and on the **`/manage` page**; pending links are **chased before the appointment** (capped, throttled, stops on completion). All off the booking critical path and fail-safe. Wired via `src/lib/compliance/auto-send.ts`, `send-templated.ts` (`enrichBookingForConfirmation`), `renderer.ts`, the nightly `compliance-expiry` cron, `/api/confirm`, and the Settings → Compliance toggle. Migration `20261206120000`. 11 new tests (212 green across compliance/comms/emails). Phases 2–4 below remain.

---

## 1. Executive summary

Resneo's compliance engine is, structurally, **as strong as or stronger than** the competitors on the *data and governance* side — versioned immutable forms, validity/expiry rules, enforcement levels (warn → block), a full audit trail, library templates, signatures, and prefill. The spec was well designed and the backend is solid.

The gap is **not capability — it is timing and seamlessness in the booking journey.** Every competitor treats the form as part of the *appointment lifecycle*: the moment a booking is made, the form is **automatically** put in front of the client (via the confirmation/booking link), **chased with reminders** until it's done, and **completable in‑venue** if it isn't. Resneo today mostly relies on a staff member *manually* clicking "Send link," and the form lives in a separate email rather than inside the booking/confirmation/reminder flow the client already uses.

> **One-line verdict:** Resneo has the better *vault*; competitors have the better *conveyor belt*. This plan builds Resneo's conveyor belt so compliance is met "seamlessly, at the right time, by the right person."

The single highest-impact change is **auto-send on booking + appointment-anchored reminders + surfacing the form in the booking confirmation/manage flow** (Phase 1). Everything else is incremental polish on top of an already-complete foundation.

---

## 2. How the competitors do it

### Common pattern (all four)
1. **Forms attach to services.** A service (e.g. Botox, colour, massage) carries one or more required forms. ✅ Resneo has this.
2. **Auto-send on / around booking.** When an appointment is booked, the relevant form is sent automatically — no staff action. The client gets a notification with a link.
3. **Completion via the client's existing booking surface.** The form is reached from the **confirmation email, reminder, or "manage/my appointments"** link — the same place the client manages the booking. They don't hunt for a separate email.
4. **Reminders until done.** If the form isn't completed, the client is chased (often email + SMS, 1–2 times) on a schedule tied to the appointment; reminders **stop once completed**.
5. **In‑venue fallback.** If still incomplete on arrival, staff complete it on the client's behalf or hand them a **tablet/kiosk** to self-complete.
6. **Stored on the client record & reusable.** Completed forms live on the client profile; "complete once vs every time" controls reuse.

### Per competitor (notable specifics)

| Competitor | Trigger & timing | Reminders | In‑venue | Mandatory? | Signature | Reuse |
|---|---|---|---|---|---|---|
| **Fresha** | "Automatic" forms attach to a service and are **sent automatically when the appointment is booked** ("Before appointment"). Client completes via **"Manage appointment" → app**. | Send reminders for incomplete forms. | Complete on **your device on arrival** or fill on their behalf. | **No** — "client forms aren't mandatory." | Yes | "Complete **every time or only once**." |
| **Phorest** | Auto‑send forms tied to the appointment — default **email 5 days before**; configurable SMS/email. | **Up to 2** messages (email + SMS) before the appointment; **second is suppressed if already completed**. Goal stated: "**more appointments starting on time**." | Pre‑send **or** fill in salon/clinic/spa. | Effectively soft (drives pre‑fill rate). | Digital signature; GDPR/HIPAA framed. | Up‑to‑date records re‑confirmed per visit. |
| **Booksy** | Custom forms completed **"upon booking" / "at the time of booking,"** or via the app before the appointment. Service‑level (Botox example). | App‑based. | — | Can **require at time of booking**. | Yes | Stored on client card. |
| **Vagaro** | Can **require a form when booking a service** (per‑service **or** whole menu), for **new customers only**, or on **membership purchase**; recurring **per‑visit** option. | Auto notifications; provider notified when mandatory. | **Check‑In App / kiosk** (tablet) — clients self‑register, check in, and complete forms in the waiting room. | **Yes** — explicit "Make Forms Mandatory." Dual signatures for liability. | Yes (incl. dual) | Per‑visit vs one‑off. |
| **Jane** (health, bonus) | Automatic intake form link in the **"Thanks for Booking" confirmation email**; portal completion (sign in / create account). | **Intake reminder 24h before** appointment. | — | **No** ("isn't a way to make the form itself mandatory"). | Require‑signature checkbox on consents. | "Prompt clients who have not completed this form." |

---

## 3. Side-by-side capability matrix (Resneo vs the field)

| Capability | Vagaro | Phorest | Booksy | Fresha | **Resneo today** |
|---|:--:|:--:|:--:|:--:|:--|
| Service‑level form requirements | ✅ | ✅ | ✅ | ✅ | ✅ |
| Custom form builder + library | ✅ | ✅ | ✅ | ✅ | ✅ (10 library + drag‑drop builder) |
| Digital signature | ✅ | ✅ | ✅ | ✅ | ✅ (draw or typed) |
| File upload (e.g. vaccination cert) | ✅ | ~ | ~ | ~ | ✅ |
| Prefill from client profile | ✅ | ✅ | ✅ | ✅ | ✅ |
| Stored on client record | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Auto‑send on booking** | ✅ | ✅ | ✅ | ✅ | ✅ **(P1 — carried in the booking confirmation)** |
| **Form surfaced in confirmation / manage‑booking** | ✅ | ✅ | ✅ | ✅ | ✅ **(P1 — confirmation email HTML+text & `/manage`)** |
| **Appointment‑anchored reminders if incomplete** | ✅ | ✅ (×2, stop on done) | ✅ | ✅ | ✅ **(P1 — ≤72h, capped 2, throttled, stops on completion)** |
| **Pre‑warn on the online booking page** | ✅ | ✅ | ✅ | ~ | ✅ **(P2 — live notice on service select + email resolve)** |
| **Block booking / hard mandatory** | ✅ | ~ | ✅ | ❌ | ✅ **(server‑side + P2 friendly client/staff messaging)** |
| **Kiosk / self‑service in‑venue completion** | ✅ | ✅ (in‑salon) | ~ | ✅ (their device) | ✅ **(P3 — client self‑completes on a venue device + reception check‑in; unattended kiosk optional)** |
| Validity / expiry with auto‑expire | per‑visit/one‑off | per‑visit | one‑off/every | once/every time | ✅ **lifetime / per‑visit / N‑day + nightly auto‑expire (richer)** |
| Lead‑time enforcement (e.g. patch test ≥48h before) | ~ | ~ | ~ | ~ | ✅ **`lock_period_hours` (unique strength)** |
| Immutable versioned forms (capture bound to version) | ~ | ~ | ~ | ~ | ✅ **(stronger legal/audit posture)** |
| Full append‑only audit trail | ~ | ~ | ~ | ~ | ✅ |
| Reuse across future bookings automatically | ~ | ✅ | ~ | ✅ | ✅ (records live on guest, auto‑matched) |

Legend: ✅ yes · ~ partial/unclear · ❌ absent · ⚠️ workaround only.

---

## 4. Where Resneo already leads

Worth protecting and marketing — these are genuine differentiators:

- **Lead‑time enforcement (`lock_period_hours`).** "A PPD patch test must be on file **at least 48 hours** before the colour appointment." No competitor reviewed enforces lead time; they only check existence/expiry.
- **Validity rules + nightly auto‑expiry.** Lifetime / single‑use / N‑day, computed at capture and enforced automatically — more expressive than "once vs every time."
- **Graduated enforcement** (`warn_staff` → `warn_client` → `block_online` → `block_all`) including genuine hard blocking, where Fresha/Jane are non‑mandatory.
- **Immutable versioned capture** — each record is bound to the exact form version the client signed, which is a stronger evidentiary position than competitors that mutate a single form.
- **Append‑only audit trail** with `record.viewed` logging for sensitive data access.

The plan below must **preserve** these while adding competitor‑grade seamlessness.

---

## 5. Gap analysis (prioritised)

### P0 — The booking‑moment integration (the core of the brief)
- **G1. No auto‑send on booking.** `venues.feature_flags.compliance.auto_send_on_booking` exists in config but is **not wired** into booking creation, and the Settings toggle was removed to avoid implying behaviour that doesn't run. Today a human must click "Send link." *(This is the #1 gap and the heart of "at the right time, by the right person — automatically.")*
- **G2. Form not surfaced where the client already is.** The form arrives as a standalone `compliance_form_request` email. It is **not** included in the booking **confirmation** email, the **pre‑visit reminder**, or the **`/manage` booking page**. Competitors put it exactly there ("Manage appointment," "My Appointment History").
- **G3. No appointment‑anchored "incomplete form" reminders.** The nightly cron reminds on **record expiry** (`compliance_record_expiring`) but there is **no pass that chases a *pending, not‑yet‑completed* `compliance_form_link` before an upcoming appointment** (the `compliance_form_reminder` key exists but nothing dispatches it on a schedule). Phorest/Fresha/Jane all chase incomplete forms relative to the appointment.

### P1 — Public booking‑page experience
- **G4. Pre‑check not wired into the public booking page.** `GET/POST /api/public/compliance/pre-check` exist and are tested, but the booking page does **not** call them, so the guest gets **no inline notice** that a form is required (§5.1.1), and an unmet `block_online`/`block_all` requirement returns a **raw `409 COMPLIANCE_REQUIREMENT_UNMET`** the page renders as a generic error instead of a helpful "you'll need to complete X" flow. *(Server enforcement is correct and fail‑safe; only the guest‑facing UX is missing.)*

### P2 — Operational completeness & breadth
- **G5. No self‑service in‑venue / kiosk completion.** Staff can capture *on behalf of* the client (`staff_web`) or mark `client_walkin`, but there is **no "hand the client a tablet to self‑complete"** surface and **no check‑in view** of "today's arrivals with outstanding forms." Vagaro (kiosk) and Fresha ("their device on arrival") both have this.
- **G6. Group bookings not enforced.** `/api/booking/create-group` is not hooked into the requirements engine (single bookings, staff + online, are).
- **G7. Storage cleanup on edge‑case guest deletes.** Walk‑in/bulk/import‑undo raw guest deletes cascade‑delete records but orphan `compliance-files` storage objects (minor leak; the main GDPR erase path was fixed in the recent audit).
- **G8. (Optional, advanced) True inline completion during booking.** Booksy/Vagaro can have the client fill the form **as a step in the booking flow** before confirming. Most competitors actually do *auto‑send‑link* (G1/G2) rather than true inline — so this is a "fast‑follow," not table stakes.

---

## 6. The improvement plan

Design principle: **reuse the engine that already exists.** The resolution engine, form links, dispatch, renderer, and audit are all built and tested — the work is almost entirely *wiring them into the booking timeline and the public booking page*, not new infrastructure.

### Phase 1 — Auto‑send + appointment‑anchored chasing + confirmation integration (the core)
*Goal: a client who books a service that needs a form is automatically and seamlessly guided to complete it, without staff lifting a finger, and chased until done.*

1. **Wire auto‑send on booking (G1).**
   - After a successful booking insert in the staff (`POST /api/venue/bookings`) and public (`POST /api/booking/create`) paths, resolve requirements (engine already there). For each requirement in state `missing`/`expired` whose type's `capture_methods` includes `client_online` **and** `config.auto_send_on_booking` is on **and** the guest has an email/phone, call `issueOrReuseFormLink` + `dispatchComplianceFormLink('request')`.
   - Run this **after** the booking is committed and **off the critical path** (fire‑and‑forget / `after()`), so a comms hiccup never fails a booking. Respect the `lock_period_hours` online‑window (if the deadline has passed, skip online send and flag for in‑venue).
   - Re‑introduce the Settings → Compliance → General toggle **now that it does something**, defaulting **on** for `client_online`‑capable types (competitor‑standard), with the existing `auto_send` config field.

2. **Surface the form in the booking confirmation & reminder (G2).**
   - Extend the booking **confirmation** email/SMS and the **pre‑visit reminder** to include a "**Forms to complete before your visit**" block listing outstanding required forms with their `/p/forms/{code}` links — reusing the per‑link `complianceFormPublicUrl`.
   - Add the same block to the **`/manage` booking page** (and account "my bookings" surface) so the client reaches the form from the place they already manage the appointment — mirroring Fresha "Manage appointment" / Phorest "My Appointment History."
   - This means the dedicated `compliance_form_request` email becomes a *reinforcement*, not the only path.

3. **Appointment‑anchored reminder pass (G3).**
   - Add a pass to the existing comms cron (or `send-communications`) that finds **pending `compliance_form_links` attached to bookings in the next N hours** (driven by `config.reminder_cadence`/`lock_period_hours`) that are **not yet consumed**, and dispatches `compliance_form_reminder` — **email then SMS**, **at most 1–2 times**, **suppressed once the link is consumed** (Phorest‑style).
   - Add a small tracking column (e.g. `reminder_count` / `last_reminded_at`) to `compliance_form_links` to cap and de‑dupe sends. (One additive migration.)

> **Phase 1 alone closes the brief's core ask** and brings Resneo to parity with Fresha/Phorest/Booksy on the seamless "right time, right person, automatically" experience.

### Phase 2 — Public booking‑page experience (G4) ✅ implemented
*Goal: the guest understands and satisfies compliance during online booking, not via a confusing error.*

1. **Inline pre‑warning.** ✅ When a service with a `warn_client`/`block_online`/`block_all` requirement is selected, call `GET /api/public/compliance/pre-check` and render the §5.1.1 notice ("This treatment requires X; if you haven't completed it, you can do so online — a link will be sent after booking").
2. **Email‑step resolution.** ✅ After the guest enters their email, call `POST /api/public/compliance/pre-check` to resolve whether they already have valid records; show "already on file ✅" or "we'll send you a form" accordingly.
3. **Graceful block handling.** ✅ When the server returns `409 COMPLIANCE_REQUIREMENT_UNMET`, render the `message` as a friendly, actionable message (not a raw code) — for `block_online`, explain they'll receive the form/should contact the venue; for `lock_period` passed, the "deadline for online submission has passed — please contact the venue" copy.
4. **(Server polish)** ✅ Add a human‑readable `message` alongside the existing `error` code + `details` in the enforcement responses so any client surfaces something helpful by default.

**Implementation notes (Phase 2):**
- New self‑contained `src/components/booking/CompliancePreCheckNotice.tsx` does its own GET (on service select) + debounced POST (on email change) pre‑check, dedups requirements across multi‑service segments (worst‑state‑wins), and renders a tone‑graded notice (block / warn / all‑set). Fail‑quiet: renders nothing when the service has no requirements or the lookups fail. `warn_staff` requirements are not surfaced to the public guest.
- Dropped into the public appointment **details step** of `AppointmentBookingFlow.tsx`; `DetailsStep` gained an optional `onEmailChange` callback (fired from its watched email field) so the host can feed the typed/locked email to the notice without re‑rendering on each keystroke. Email is seeded from a signed‑in account when available.
- `complianceUnmetMessage(details, context)` in `enforce-booking.ts` builds the friendly copy; wired into all three booking‑enforcement 409s (`/api/booking/create`, `/api/venue/bookings`, `/api/venue/bookings/[id]`). `publicCreateErrorMessage` now prefers `data.message`.
- Scope note: the **group** booking details step (Phase 4 / G6 enforcement) was intentionally left out — the notice only attaches to the single/multi‑service flow whose create path already enforces compliance.

### Phase 3 — In‑venue self‑service & check‑in (G5) ✅ implemented
*Goal: the "fill it in when you arrive" fallback every competitor offers.*

1. **"Complete on this device now" from the booking detail / contact panel** — ✅ opens the shared `ComplianceFormRenderer` in a venue‑staff‑initiated, self‑complete mode (capture channel `client_walkin`), so the client fills it on a salon tablet without staff transcribing.
2. **A lightweight check‑in / "today" view** — ✅ a panel on the existing `/dashboard/compliance` listing today's bookings with **outstanding required forms**, each with one‑tap "Complete now (tablet)" / "Send link" actions — the reception "before they sit down" surface.
3. *(Optional later)* a kiosk‑mode route for unattended waiting‑room tablets. — **deferred** (still optional).

**Implementation notes (Phase 3):**
- **True self‑complete mode.** `ComplianceCaptureDialog` now lets the "Captured by" choice drive both the render and the attribution: `client_walkin` renders the form in **public mode** (staff‑only fields hidden, intro shown, "hand this device to the client" banner) and submits attributed to the client; `staff_web` keeps the full staff‑transcription form. New `initialChannel` prop opens it straight into tablet mode. The renderer re‑mounts on mode flip (keyed) so fields reset cleanly.
- **Server.** `/api/venue/compliance/records` POST derives `mode`/`actorType`/`capturedByStaffId` from `capture_channel`: `client_walkin` → `mode:'public'` (strips staff‑only via the same `validateResponses` public path used by the public link flow) + `actorType:'client'` + null staff id; else staff/staff. No schema change.
- **Check‑in panel.** New pure `src/lib/compliance/check-in.ts` `groupTodaysCheckIns(missing, todayStr)` (filter to today, group by booking, de‑dupe types keeping the harder enforcement, sort blocking‑first + by time) with 6 unit tests. Rendered as the top "Check‑in — today" `SectionCard` on `ComplianceDashboardView`, reusing the dashboard's existing `missing_for_bookings` data (no new query); today's bookings are removed from the "Missing for upcoming bookings" list so each appears once. Per‑form actions: **Complete now** (opens the capture dialog in `client_walkin` mode) + **Send link**.
- **Booking/contact panel.** `ComplianceSection` requirements rows gained a primary **Hand to client** button (opens the dialog in `client_walkin`) alongside the existing **Capture now** (staff) + **Send link**.
- Reuses the shared `ComplianceFormRenderer` + existing records/form‑links endpoints + the shipped dashboard; no migration.

### Phase 4 — Breadth & hygiene
- **G6.** ✅ Hook `/api/booking/create-group` into the same enforcement helper (per‑sibling), matching single‑booking behaviour.
- **G7.** ✅ Have walk‑in/bulk/import‑undo guest deletes route through (or call) the compliance erase helper so `compliance-files` objects aren't orphaned.
- **G8 (optional, differentiator).** ⏸️ **Deferred.** True **inline completion during the public booking flow**: for `client_online` forms, offer an optional step that renders the form (via the shared `ComplianceFormRenderer`) **before confirming**, capturing the record atomically with the booking. This out‑does most competitors (who only auto‑send a link) and pairs powerfully with Resneo's blocking + lead‑time strengths — but it is the most complex and overlaps the auto‑send + pre‑check + tablet flows already shipped, so it is held as an optional future enhancement.

**Implementation notes (Phase 4):**
- **G6 group enforcement.** `/api/booking/create-group` now runs `checkBookingCompliance` per attendee **after** the guest is found/created and **before** any booking insert, so a blocked group creates nothing. Context is `online` for online‑like sources (`online`/`widget`/`booking_page`) and `staff` for `phone`/`walk-in` — mirroring the single‑booking gate (online blocks `block_online`+`block_all`; staff blocks only `block_all`). The service id is passed in the column matching the booking's storage (`useUnifiedBookingRows` → `service_item_id`, else `appointment_service_id`). Since all siblings share one guest, a single record satisfies every attendee. On block: `409 {error: COMPLIANCE_REQUIREMENT_UNMET, message, details}` where `details` carries each `person_label`. The helper is fail‑open, so compliance never breaks group booking.
- **G7 storage hygiene.** `eraseGuestVenuePii` already calls `eraseGuestCompliance` (covers bulk delete + the GDPR erase route). The remaining raw `guests.delete()` hard‑deletes now call `eraseGuestCompliance(admin, venueId, guestId)` first: `src/lib/import/run-undo.ts` (loops the import‑created `guestIdsDeleted` — the real risk, since those guests can accrue records during the undo window) and the three walk‑in rollback deletes in `/api/venue/bookings/walk-in` (defensive — those guests are freshly created, but the call guarantees no future orphaning). The helper is best‑effort and never throws.
- No migration; no UI change.

---

## 7. Sequencing, effort & risk

| Phase | Closes | Rough effort | Risk | Notes |
|---|---|---|---|---|
| **1. Auto‑send + reminders + confirmation block** | G1, G2, G3 | ~4–6 dev‑days | Low–med | Touches booking‑create + comms; keep all sends off the booking critical path (fire‑and‑forget). One additive migration for reminder tracking. **Highest ROI.** |
| **2. Public booking‑page pre‑check UX** | G4 | ~3–5 dev‑days | **Med** | Modifies the high‑traffic public booking flow — needs careful testing; server enforcement already correct, so this is purely additive UX. |
| **3. In‑venue self‑service + check‑in view** | G5 | ~3–4 dev‑days | Low | Reuses the shared renderer + the existing dashboard. |
| **4. Group bookings, storage hygiene, (optional) inline** | G6, G7, (G8) | ~2 days + (G8 ~4–6) | Low (G6/G7) / Med (G8) | G6/G7 are quick correctness wins; G8 is an optional differentiator. |

Guardrails throughout:
- **Never fail a booking because of compliance comms** — auto‑send/reminders are best‑effort and off the critical path (the booking‑creation enforcement check already fails‑open).
- **Respect SMS allowance** — reuse the existing per‑plan SMS metering; default reminders to email‑first.
- **Preserve the differentiators** — keep lead‑time, validity/expiry, blocking, versioning and audit intact; the plan adds delivery seamlessness on top, it does not replace the governance model.
- **Feature‑flag gated** — all of this stays behind `compliance_records_enabled`, off by default, Appointments‑tier only.

---

## 8. Recommendation

Do **Phase 1** next. It is the smallest change that moves Resneo from "manual, separate‑email compliance" to the competitor‑standard "**book → auto‑sent → chased → completed in the same flow**" experience, while leaning entirely on infrastructure that already exists and is tested. Phase 2 then makes the *online booking* experience first‑class, and Phase 3 covers the in‑venue reality of reception desks. With Phases 1–3, Resneo matches the seamlessness of Fresha/Phorest/Booksy/Vagaro **and** retains compliance capabilities (lead‑time enforcement, blocking, validity, versioned audit) that none of them offer.

---

## 9. Addendum (June 2026): end-to-end audit and in-booking form collection

This addendum was added after Phases 1 to 4 shipped. It records two things the original competitive review did not cover:

1. **A full end-to-end code audit** of the compliance feature (enablement and navigation, the four enforcement modes, every booking write path, types and templates and versioning, records and form links and the public form, the cron and comms, and the data model, RLS and GDPR). Each material finding was verified against the code.
2. **A new product requirement:** guests must be able to complete a compliance or intake form *during* the online booking itself, with the venue controlling whether it is mandatory, whether it appears in the booking flow or only as a link in the confirmation email, and who completes it (guest vs staff). This promotes the previously deferred **G8** (§6, Phase 4) into a specified design.

> **Important correction to §6.** §6 (Phase 4, G6) records group-booking enforcement as complete and implies booking-write coverage is comprehensive. The June 2026 audit found three further Model B write paths that create or modify bookings **without** calling `checkBookingCompliance`, so a `block_online` / `block_all` requirement is currently evadable online. These are C1, C2 and H1 in §9.1 and are the first work item in the updated plan (§9.4, Phase 0).

### 9.1 Audit findings (severity-ranked)

**Confirmed working end to end:** enablement toggle → server flag resolution → sidebar tab → page guards (tier + `compliance_records_enabled`); the pure resolver state machine (`resolve-requirements.ts`) with lock-window logic; block enforcement on the *main* public-single, staff-create and staff-edit paths (with admin override on staff); race-safe form-link dedup and atomic single-use consumption; immutable versioning (records pin to their captured version); the nightly cron (idempotent expiry, single-shot reminders, working SMS-to-email fallback); auto-send carried in the confirmation; venue-isolation RLS on all six tables with a trigger-enforced append-only audit; public-form staff_only stripping and storage-path scoping.

**Findings.** Severity reflects user impact. File references are `path:line` at the time of the audit.

#### Critical (online block is evadable)

| ID | Finding | Location | Fix |
|---|---|---|---|
| **C1** | **Guest self-reschedule bypasses compliance.** `/api/confirm` action `modify` rewrites a booking's service/date/time straight to the `bookings` row and never calls `checkBookingCompliance` (the file imports no compliance gate). A guest books a no-requirement slot, then self-reschedules onto a `block_online`/`block_all` service with no record on file. | `src/app/api/confirm/route.ts:1170-1431`; reached from `AppointmentBookingFlow.tsx:2202` | Gate the modify branch with context `online` before the update; return `409 COMPLIANCE_REQUIREMENT_UNMET` + `complianceUnmetMessage`. |
| **C2** | **Multi-service create never gates.** `/api/booking/create-multi-service` inserts one Model B row per segment with the service FK set, has zero compliance calls, and is publicly reachable from the booking page. A regulated service booked inside any 2+ service chain evades the online block. | `src/app/api/booking/create-multi-service/route.ts` | Resolve and gate each segment (context `online`); abort the whole group with 409 if any segment is blocked. |

#### High

| ID | Finding | Location | Fix |
|---|---|---|---|
| **H1** | **Walk-in route skips the staff gate.** `/api/venue/bookings/walk-in` inserts a Model B appointment with no `checkBookingCompliance`, so `block_all` (which should block staff too, subject to override) is silently unenforced on walk-ins. | `src/app/api/venue/bookings/walk-in/route.ts:339-441` | Add a staff-context gate + admin override; branch on `useUnifiedAppointmentStorage` so it does not no-op for unified-storage venues. |
| **H2** | **Captured signatures and files are unviewable.** The `compliance-files` bucket is private with no read RLS, and there is no venue route that signs a URL; the record dialog prints "Signature on file" / the file name as plain text. The drawn-signature data URL is dropped after upload, so the only copy is unreachable. Defeats the evidentiary purpose for `signed` / `file_uploaded` types. | `ComplianceRecordViewDialog.tsx:25-48`; `supabase/migrations/20261203120000_compliance_records.sql:327-329` | Add an authenticated, venue-scoped `GET .../records/[id]/file` returning `createSignedUrl(...)`; render an `<img>` / download link. |
| **H3** | **Staff cannot attach a file in-venue.** `ComplianceCaptureDialog` renders the form without a `fileUploadUrl`, so file fields are permanently disabled ("File upload is available on the public form"); a required file field then fails validation. `file_uploaded` types can only ever be satisfied by sending a link. | `ComplianceCaptureDialog.tsx:129`; `ComplianceFormRenderer.tsx:214` | Add a venue-authenticated upload endpoint and pass it as `fileUploadUrl`. |
| **H4** | **Failed/null pass-fail records still satisfy (safety-critical).** `isRecordValidForBooking` checks status/void/expiry/lock but never `result`. Because the pass/fail field must be `staff_only` (stripped from public forms), every client-submitted patch test lands `result = null` and counts as satisfied; a failed PPD/lash test is treated as a pass. | `src/lib/compliance/resolve-requirements.ts:59-74` | Exclude `fail`/`inconclusive`/null-`pass_fail` from the valid-record filter; require a staff pass/fail decision before a client-submitted `pass_fail` record counts. (Pairs with M7.) |
| **H5** | **Guest merge crashes on duplicate pending links.** `merge_guests_into` re-points `compliance_form_links` with no conflict handling, violating the later `uq_compliance_form_links_pending` partial unique index (23505 aborts the whole merge). The exact duplicate-guest case a merge exists to fix. | `supabase/migrations/20261205120000_compliance_merge_guests.sql:68-70` vs `20261207120000_compliance_form_link_dedup.sql:30-32` | Dedupe/revoke duplicate pending links (per venue, guest, type) before re-pointing. |

#### Medium

| ID | Finding | Location |
|---|---|---|
| **M1** | **No helper text on the four enforcement options** (bare dropdown labels). Copy proposed in §9.3. | `ComplianceRequirementsEditor.tsx:142`; `shared.ts:14` |
| **M2** | **`warn_staff` gives no booking-time warning,** only a passive amber flag visually identical to every other unmet state. Consider a non-blocking `warnings` array from `checkBookingCompliance` surfaced in the staff modal. | `enforce-booking.ts:91`; `booking-flags.ts:155` |
| **M3** | **"Both" form-link channel never sends SMS** for automated reminders (both senders collapse it to email via `=== 'sms' ? 'sms' : 'email'`); the settings helper text actively promises SMS. | `expiry-cron.ts:55`; `auto-send.ts:148` |
| **M4** | **No form-link management UI.** Revoke/resend/manual-copy/SMS endpoints exist but have no caller; the staff surface hardcodes `send_via:'email'` and discards the returned `public_url`. | `ComplianceSection.tsx:92`; `ComplianceDashboardView.tsx:74` |
| **M5** | **Per-visit (`validity_period_days = 0`) records expire at the capture instant,** so a just-completed form never satisfies a future-dated blocking requirement. A shipped, advertised config. | `form-schema.ts:381`; `resolve-requirements.ts:66` |
| **M6** | **Archived types are hidden from the public pre-check but still enforced at create,** so the guest gets no warning then a surprise 409 (the two paths disagree). | `public-forms-service.ts:318` |
| **M7** | **Pass/fail result field is not validated as `required`,** enabling the null-result satisfaction in H4. | `form-schema.ts:167-194` |
| **M8** | **Orphaned uploaded files** for abandoned/revoked/expired links are never deleted and survive guest GDPR erasure (only swept at venue hard-delete), since `eraseGuestCompliance` collects paths only from `compliance_records.responses`. | `gdpr.ts:23`; `form-links-service.ts` revoke; `public-forms-service.ts` expire |
| **M9** | **Em-dashes in user-facing copy** (CLAUDE.md violation), 6 locations: `ComplianceSettingsSection.tsx:81`; `CompliancePreCheckNotice.tsx:161,168,187,205,222` (guest-facing; line 192's `hasBlock` guard string-matches line 161, edit together); `shared.ts:179,185`; `ComplianceRecordViewDialog.tsx:26`; `ComplianceDashboardView.tsx:111` ("Check-in — today"); `SignaturePad.tsx:90` (aria-label). | as listed |

#### Low

`warn_client` is invisible when staff book for the client (only the public flow renders it) · public create hardcodes context `online` even for `phone`/`walk-in` source (`create/route.ts:1529`) · booking import creates Model B rows without evaluation (likely by design, document it) · submit/file endpoints rate-limited per-code not per-IP · `access_count` non-atomic read-then-write · GDPR erase writes no audit event · expiry reminder gives no date or days-remaining · booking-time math ignores venue timezone in lock/reminder windows · settings disabled-state inferred from an API error rather than the known flag · `file_uploaded` result conflated with `completed` in `computeResult` · most compliance selects/textareas lack `htmlFor`/`id` (the enforcement select has no accessible name) · raw record `result` rendered verbatim as a pill · archiving a type does not warn about attached service requirements.

### 9.2 The new requirement, mapped to today's primitives

The product ask is that a guest can complete a form in the booking journey, the venue decides mandatory vs optional and where the form appears, some forms are staff-only, and an unmet hard requirement shows a venue-set message telling the guest what to do.

| Requirement | Today | Gap |
|---|---|---|
| Complete a form during online booking | Forms are completable only via an emailed link after booking (`auto-send.ts`) or in-venue by staff. The booking-page pre-check only *displays* status. | No inline form capability exists. |
| Venue sets mandatory vs optional | Partial: `enforcement` (`block_*` ≈ mandatory, `warn_*` ≈ optional). But "mandatory" today means "a record must already exist," not "complete it now." | No "complete inline to proceed" concept. |
| Optional: in-flow vs confirmation-email link | Only a venue-wide `auto_send_on_booking` toggle (email link only). | No per-form choice; no in-flow option. |
| Form saved to the guest's records | Capture logic exists; `compliance_records.booking_id` exists. But capture needs a form-link `code` and an existing `guest_id`. | No path to capture during booking creation. |
| Staff-only forms (PPD patch test) | **Exists:** `compliance_types.capture_methods` (`staff_in_venue` / `client_online`); auto-send already skips staff-only types. | Booking flow just needs to honour it. |
| Block online + venue-set message | `block_online`/`block_all` block; messages are hardcoded in `CompliancePreCheckNotice` / `complianceUnmetMessage`. | No venue-configurable message field anywhere. |

### 9.3 Design: in-booking form collection (promotes G8)

**Principle (unchanged):** reuse the engine. Keep `enforcement` as the mandatory/optional axis and `capture_methods` as the audience axis; add one per-requirement field for *where* the form appears and one message field. No new enforcement semantics.

**Data model (one additive migration):**
- `service_compliance_requirements.online_collection` enum `inline` | `confirmation_link` | `none`, default `confirmation_link` (preserves current behaviour). Only meaningful when the type supports `client_online`.
- `compliance_types.online_unmet_message text` (nullable, max ~500 chars): the venue's "do this first" message for the blocked-and-cannot-self-resolve case. Per-type for v1 (it describes the document, e.g. "Please book a patch test first"); a per-requirement override can be added later.
- Add a `client_booking` value to the `compliance_records.capture_channel` CHECK and to `COMPLIANCE_CAPTURE_CHANNELS`, so inline-during-booking records are attributable.

**Venue-facing configurations** that fall out of `enforcement` × `online_collection` × `capture_methods`:

| Venue intent | enforcement | online_collection | type capture_methods | Behaviour in the flow |
|---|---|---|---|---|
| Mandatory, complete in the booking | `block_online` (or `block_all`) | `inline` | includes `client_online` | Form renders in the flow; cannot confirm until completed (the saved record satisfies the gate). |
| Optional, in the booking flow | `warn_client` | `inline` | includes `client_online` | Form offered inline, guest may skip; record saved if completed. |
| Optional, link in confirmation email | `warn_client` | `confirmation_link` | includes `client_online` | Not shown in flow; link carried in the confirmation (today's auto-send, now per-form). |
| Staff-only / "book something first" (PPD) | `block_online` | `none` | `staff_in_venue` only | Guest is blocked and shown `online_unmet_message`; no form offered (they cannot self-complete it). |

This stays internally consistent: `block_*` always means "cannot book online while unmet"; whether the guest can resolve it inline depends on the type being client-completable and `online_collection = inline`, otherwise they see the venue message.

**Booking-flow UX.** Expand the existing pre-check anchor in `AppointmentBookingFlow` (after the details step, where email/identity is known) into an interactive "Forms for this booking" section:
- For each unmet, client-completable, `inline` requirement: render the form via the shared `ComplianceFormRenderer` in public mode (staff_only fields stripped).
- Mandatory (block): disable Confirm until completed. Optional (warn): allow Confirm; save if filled.
- For a blocked requirement the guest cannot self-resolve (staff-only / `none`): show `online_unmet_message` and block Confirm, with no form.
- The server always re-validates: the create routes capture the submitted record(s), then run `checkBookingCompliance`, which now passes. The client pre-check is never trusted.

**API.**
- Extend `/api/booking/create`, `/api/booking/create-multi-service`, `/api/booking/create-group` to accept `compliance_submissions: [{ compliance_type_id, responses }]`. Server flow: resolve/create the guest by email, validate each submission against the type's current version in public mode (reuse `buildResponseSchema` + `captureComplianceRecord`), capture records with `capture_channel = 'client_booking'` and `booking_id` set, then run the gate, then create the booking.
- New public endpoint to fetch inline form schemas for the chosen service(s) (extend the existing `GET /api/public/compliance/pre-check` to include the current `form_schema` for `client_online` + `inline` requirements, staff_only stripped).

**Settings UI.**
- `ComplianceRequirementsEditor`: add the `online_collection` control (shown only when the selected type supports `client_online`) plus the helper text (M1).
- Type editor: add `online_unmet_message`.

**Proposed enforcement helper text (M1)** (no em-dashes, accurate to the model above):
- **Warn staff:** "The booking still goes through. Your team sees an outstanding-form flag on the calendar and booking so they can collect the record before the appointment. The client is not told."
- **Warn client:** "The booking still goes through. When the client books online they see a note that a form is needed, and your team sees the flag too."
- **Block online booking:** "Clients cannot book this service online until a valid record is on file. Your team can still book them in from the dashboard."
- **Block all bookings:** "No one can book this service until a valid record is on file, online or from the dashboard. An admin can override when booking from the dashboard."

### 9.4 Design decisions (resolved June 2026)

1. **Inline file/signature uploads: build full inline support.** A secure short-lived pre-booking upload endpoint will let file and signature fields be completed inline (not just text/choice). Built in Phase 2b.
2. **`online_unmet_message` scope: per compliance type.** One message per type (e.g. a patch test shows "Please book a patch test first" wherever it blocks). A per-requirement override can be added later.
3. **Per-form placement replaces the venue-wide toggle.** The old `auto_send_on_booking` venue toggle is removed; each requirement's `online_collection` (`inline` / `confirmation_link` / `none`) fully decides whether and where the form is offered. Implemented in Phase 2a (the toggle's value is migrated into per-requirement `online_collection`).

### 9.5 Updated plan (supersedes the remaining work in §6)

- **Phase 0: close the enforcement bypasses (C1, C2, H1). ✅ implemented (June 2026).** Added a centralised `enforceBookingCompliance` helper (`src/lib/compliance/enforce-booking.ts`) that wraps `checkBookingCompliance`, applies the staff admin-override, and returns the canonical 409 body. Wired it into the three unguarded Model B write paths: `/api/confirm` appointment self-reschedule (context `online`, C1), `/api/booking/create-multi-service` (per segment, context by source, C2), and `/api/venue/bookings/walk-in` (context `staff` + admin override, branching on `useUnifiedAppointmentStorage`, H1; added an `override_compliance` field). 5 new unit tests on the helper (153 compliance tests green); typecheck and lint clean. Note: the repo has no route-level integration-test harness, so the regression guard is the shared helper's unit tests plus identical call shape across all sites; a route-level harness remains a worthwhile follow-up.
- **Phase 1: direct asks (M1 helper text, M9 em-dash cleanup). ✅ implemented (June 2026).** Added a `description` to each `ENFORCEMENT_OPTIONS` entry (`shared.ts`) plus an `ENFORCEMENT_DESCRIPTIONS` map, and rendered the selected mode's explanation under both the inline requirement-row select and the Add-requirement dialog select (`ComplianceRequirementsEditor.tsx`), with an `sr-only` label on the previously-unlabelled inline select. The copy matches §9.3 and describes the model Phase 2 will complete. Removed the 6 user-facing em-dashes flagged in M9: `ComplianceSettingsSection.tsx` (colon), `CompliancePreCheckNotice.tsx` (5 guest-facing strings, including the row separator and the line-192 guard kept in sync), the `Today’s check-ins` dashboard card title, the `SignaturePad` aria-label (colon), and the empty-value placeholders in `shared.ts` / `ComplianceRecordViewDialog.tsx` (now en-dashes, which the house rule permits); test assertions updated. Remaining em-dashes in the feature are in code comments only (out of scope). Typecheck/lint clean; 156 compliance tests green.
- **Phase 2: in-booking form collection (§9.3, promotes G8).** Built in three increments:
  - **2a — Foundation. ✅ implemented (June 2026).** Migration `20261229120000_compliance_in_booking_collection.sql` adds `service_compliance_requirements.online_collection` (`inline`/`confirmation_link`/`none`, with the old `auto_send_on_booking` venue toggle migrated into it: on → confirmation_link, off → none), `compliance_types.online_unmet_message`, and the `client_booking` capture channel. Constants, zod, requirements-service and routes carry `online_collection`; the resolver loads it; `auto-send` now gates per requirement (`confirmation_link`) instead of the removed venue toggle. The Service-requirements editor gained an "Online booking" placement control (shown only for client-completable types; staff-only types show an in-venue note); the venue-wide auto-send toggle was removed from Settings. `online_unmet_message` column added (editor field + display land in 2c). Typecheck/lint clean; 157 compliance tests green.
  - **2b — Server capture + endpoints. ✅ implemented (June 2026).** Shared `uploadComplianceFile` helper extracted in `files.ts` (the existing public form-link upload now reuses it). New unauthenticated pre-booking upload endpoint `POST /api/public/compliance/booking-upload?venue_id=&draft_id=` (per-IP rate limit, UUID-format guards, compliance-enabled-venue check; stores under `venues/{venueId}/uploads/booking-draft/{draftId}/` and returns the FileResponse the renderer expects). New public schema endpoint `GET /api/public/compliance/inline-forms?venue_id=&service_id=` returns the client-completable, `inline` requirements of a service with their current-version form schema (staff_only stripped via `stripStaffOnlyFields`). New `src/lib/compliance/booking-capture.ts`: `captureBookingComplianceSubmissions` validates each submission against the type's current version in public mode, rejects staff-only types (a guest cannot self-certify a patch test), confines `file` paths to the draft prefix (`submissionStoragePathsAreSafe`), and captures via `captureComplianceRecord` (channel `client_booking`, `bookingId` null); `linkBookingComplianceRecords` backfills `booking_id` after insert. All three create routes (`/api/booking/create`, `/create-multi-service`, `/create-group`) accept `compliance_submissions` + `compliance_draft_id`, capture after guest resolution and BEFORE the gate (so a just-completed mandatory form satisfies it), and backfill the booking id after insert. 8 new tests (162 compliance tests green); typecheck/lint clean.
  - **2c — Booking-flow UI. ✅ implemented (June 2026).** New `src/components/booking/BookingComplianceForms.tsx`: fetches `/inline-forms` for the chosen service(s), renders each via the shared `ComplianceFormRenderer` (public mode) with `fileUploadUrl` pointed at the booking-upload endpoint + a generated `draft_id`, captures each form on submit (per-form validation is free), shows a completed/Edit state, and reports up the collected submissions + whether every mandatory (block_*) form is done. Mounted in `AppointmentBookingFlow`'s public details step beside `CompliancePreCheckNotice`; `handleDetailsSubmit` blocks Confirm until mandatory forms are complete and threads `compliance_submissions` + `compliance_draft_id` into the single- and multi-service create bodies (group inline forms deferred, matching the existing pre-check scoping; the server still gates + accepts submissions there). The `online_unmet_message` is now wired editor-to-display: a textarea in `ComplianceFormBuilder` (create + edit + hydrate), through the zod create/patch schemas, `createComplianceType`, and the PATCH allowlist; surfaced to guests on a blocked pre-check row (`publicServiceRequirements` returns it; `CompliancePreCheckNotice` shows the venue's message and suppresses types already rendered inline via a new `suppressTypeIds` prop). Typecheck clean; 165 compliance tests green; 0 lint errors.

  **Phase 2 (in-booking form collection) is complete.** Remaining browser/E2E verification needs a seeded venue (compliance enabled + an `inline` client-online requirement on a bookable service).
- **Phase 3: records trustworthy (H4, M7, H2, H3). ✅ implemented (June 2026).**
  - **H4** — `isRecordValidForBooking` now rejects a pass_fail record unless `result === 'pass'` (a `fail`/`inconclusive`/undecided-`null` record, e.g. a client-submitted patch test awaiting a staff decision, no longer satisfies a booking). `result_type` is threaded onto `ResolverRecord`, loaded via a `compliance_types!inner(result_type)` join in all three record-load sites (`resolve-requirements.ts`, `booking-flags.ts`, `dashboard-service.ts`); non-pass_fail types are unaffected.
  - **M7** — `validateFormSchemaForType` now requires the pass/fail result field to be `required: true` (the shipped patch-test templates already comply).
  - **H2** — new authenticated `GET /api/venue/compliance/records/[id]/file?field=` returns a 120s signed URL after venue-scoping the record and confirming the path is the one stored on that record under the venue prefix; logs a `record.viewed` audit event. `ComplianceRecordViewDialog` renders "View signature" / "Download {file}" buttons instead of plain text.
  - **H3** — new authenticated `POST /api/venue/compliance/records/upload` (reuses `uploadComplianceFile`, stores under `venues/{venueId}/uploads/staff/{nonce}/`); `ComplianceCaptureDialog` passes it as `fileUploadUrl`, so staff can attach files when capturing in venue (works in both staff and hand-to-client tablet modes). Completes the "everything inline incl. files" decision (§9.4.1).
  - 4 new tests (pass_fail validity + required-result-field); 169 compliance tests green; typecheck + lint clean.
- **Phase 4: operability (M4 link management, M2 `warn_staff`, M3 channel, M5 per-visit, H5 merge). ✅ implemented (June 2026).**
  - **M4** — `ComplianceSection` lists the guest's form links with a status pill and, for pending links, Copy link / Resend email / Resend SMS / Revoke (existing `resend` + `revoke` endpoints; Copy builds `/p/forms/{code}`).
  - **M2** — `summariseBlocking` + `checkBookingCompliance` now return a non-blocking `warnings` array; the staff create route returns `compliance_warnings`; `AppointmentBookingFlow`'s staff confirmation shows an "Outstanding compliance forms" notice.
  - **M3** — "Both" removed from `COMPLIANCE_FORM_LINK_CHANNELS` + the settings dropdown; `parseComplianceConfig` coerces a stored `both` back to the `email` default.
  - **M5** — per-visit (`validity 0`) now expires at the end of the capture day in venue local time via `endOfCaptureDayInVenueTimezone` (`venue-local-clock.ts`), threaded through `computeExpiresAt` and `captureComplianceRecord`.
  - **H5** — migration `20261230120000_compliance_merge_guests_dedup.sql` revokes a source's duplicate pending links before re-pointing, fixing the 23505 merge crash.
  - **NEW "needs staff decision" prompt** (follow-on to H4): records PATCH accepts a pass/fail `result` (pass_fail types only, audited `record.updated`); `ComplianceRecordViewDialog` shows a "Needs a pass or fail decision" control for undecided pass_fail records; `ComplianceSection` flags them with an "Awaiting decision" badge.
  - 169 compliance tests green; typecheck + lint clean.
- **Phase 5: hygiene (M6, M8, and the Low items). ✅ implemented (June 2026).**
  - **M6** — `publicServiceRequirements` no longer filters out archived types, so the public pre-check matches what the create gate enforces (the requirement row persists when only the type is archived). No more surprise 409.
  - **M8** — `eraseGuestCompliance` now also removes each of the guest's form-link upload prefixes (`venues/{venueId}/uploads/{code}/`, via a new `removeStoragePrefix` helper) and writes a `guest.compliance_erased` audit event with counts; `revokeFormLink` reaps the revoked link's orphaned uploads. (Auto-expired-link orphans for never-erased guests remain covered by the erase path + the venue-deletion sweep; an inline expire-time reap was skipped to avoid public-page latency.)
  - **Low** — public `/api/booking/create` derives `staff` vs `online` context from `source` (no longer over-blocks a phone/walk-in on `block_online`); the public submit endpoint adds a per-IP limiter alongside per-code (blunts enumeration); GDPR erasure is now audited (`guest.compliance_erased`, see M8); the record dialog shows friendly result labels (Pass/Fail/…) instead of raw tokens.
  - **Deliberately deferred** (lower value or cross-cutting, tracked for a later pass): the a11y label-association sweep across compliance selects/textareas; venue-timezone in the lock-period / reminder-window math (a known cross-cutting booking-engine nuance, not compliance-specific); atomic `access_count` increment (analytics-only, needs an RPC); a date/days-remaining in the expiry-reminder template; the settings "disabled" hint reading the resolved flag instead of an API error; an archive-confirmation warning when a type still has service requirements; and documenting that booking import intentionally bypasses compliance.
  - 169 compliance tests green; typecheck + lint clean.

**The §9 plan (Phases 0 to 5) is implemented.** Remaining items are the deferred Low items above and end-to-end browser verification on a seeded venue.

Guardrails from §7 still hold: never fail a booking because of compliance comms (the gate already fails open on internal error); respect SMS allowance; preserve lead-time, validity, blocking, versioning and audit; everything stays behind `compliance_records_enabled`, Appointments-tier, off by default.

---

### 10.5 Final review (June 2026): bugs found and fixed

A final adversarial code review of the §10 changes, plus a doc-vs-code accuracy
audit, was run. The doc audit found §10 accurate (only the audit-time `path:line`
citations drift, as the section already disclaims). The code review surfaced six
items; the five substantive ones are now fixed, with tests green throughout.

1. **Duplicate version on a retried single-request save / version churn. ✅ fixed.**
   `createComplianceTypeVersion` now skips publishing when the submitted schema is
   byte-identical to the current version (order-insensitive comparison), so a
   single-request PATCH save retried after a transient metadata-update failure no
   longer accumulates identical immutable versions, and a metadata-only edit no
   longer creates a redundant version. (`types-service.ts`; new unit test.)
2. **Non-UUID fallback draft id broke inline file uploads. ✅ fixed.**
   `BookingComplianceForms` previously generated a non-UUID id where
   `crypto.randomUUID` is unavailable (insecure origins / older browsers); the
   pre-booking upload endpoint and booking-create both UUID-validate the draft id,
   so uploads would 400. It now emits an RFC4122-v4 UUID (`makeDraftUuid`).
3. **Submit-time draft clear could orphan uploads on a fail-then-reload; stale
   cross-booking submissions. ✅ fixed.** The submit clear no longer removes the
   stable draft id, so a reload after a failed submit reuses the same upload prefix
   and already-uploaded files stay valid. Separately, the reported `submissions`
   are now scoped to the current service set's forms, so a persisted draft from a
   previously-abandoned booking (kept for resume) is never captured against a new
   booking. (`BookingComplianceForms.tsx`.)
4. **Signature pad wiped an in-progress stroke on resize. ✅ fixed.** The
   `ResizeObserver` now skips re-measuring while a stroke is being drawn, so a
   mid-stroke resize (e.g. a mobile URL bar collapsing) no longer erases the
   current line. (`SignaturePad.tsx`.)
5. **"Add option" could create a duplicate option value. ✅ fixed.** The button now
   picks the next free `option_N`, closing the one gap the U8 de-dup didn't cover.
   (`ComplianceFormBuilder.tsx`.)
6. **Pass/fail mapping when a staff-only select already exists. No change needed.**
   Switching to pass/fail with a pre-existing staff-only select leaves the mapping
   empty, and save is correctly blocked until it is mapped (the auto-insert path
   pre-fills pass/fail). Working as intended; noted for consistency only.

Re-verified clean: tenant isolation on restore/duplicate/PATCH; auth/admin/plan
gating on the new routes; draft-restore hydration (no SSR mismatch);
`form-draft` quota/SSR/expiry handling; clear-on-success vs persist-on-change;
public-mode `staff_only` stripping; and the version-number retry on unique
collision. After the fixes: typecheck + lint + lint:modals clean; 1676 unit tests
green.

### 10.6 UX pass (June 2026): menus, clarity, and workflow

A follow-up pass over the staff and guest surfaces to make the experience
quicker and clearer. No migration; typecheck + lint + lint:modals clean; 1676
tests green.

- **Settings → Compliance now opens on General settings**, and the sub-tabs are
  reordered to the setup flow (General → Templates & types → Service
  requirements), so a venue lands where the feature is turned on.
  (`ComplianceSettingsSection.tsx`.)
- **Enable-toggle clarity:** "Enable compliance records" is now a prominent banner
  with a plain-language explanation of what turning it on does; the
  reminder-cadence and form-link-expiry fields gained help text.
- **Removed two dead settings.** "Default capture method" and "Default lock period
  (hours)" had **no consumers anywhere in the code**, so they misled staff; both
  are removed from General settings. (Lead time was then given a real home in the
  per-service requirement editor — see below.)
  - **Lead-time UI — ✅ now added.** Lead-time enforcement (`lock_period_hours`,
    the "patch test at least 48h before colour" differentiator) was enforced by
    the engine but had no way to configure it in the dashboard. The per-service
    requirement editor now exposes a **"Lead time: N hours before the
    appointment"** control on each requirement (persists on blur) and in the
    Add-requirement dialog. The whole server path already supported it
    (`complianceRequirement{Create,Patch}Schema`, `addRequirement` /
    `updateRequirement`, covered by tests), so this was UI-only.
    (`ComplianceRequirementsEditor.tsx`.)
- **U14 — booking-flow panels merged. ✅** The customer's pre-check notice and
  inline-forms block now render inside one shared "Before you book" card. Each
  gained an `embedded` mode (drops its own card chrome) and an `onActiveChange`
  callback, so `AppointmentBookingFlow` shows the wrapper card and heading only
  when at least one panel has content. (`CompliancePreCheckNotice.tsx`,
  `BookingComplianceForms.tsx`, `AppointmentBookingFlow.tsx`.)
- **Compliance dashboard:** a one-line summary strip (today / upcoming / expiring
  / awaiting counts) and a friendly "You're all caught up" state.
  (`ComplianceDashboardView.tsx`.)
- **Forms (staff + guest):** a "Fields marked * are required" hint above the form.
  (`ComplianceFormRenderer.tsx`.)
- **Form builder:** field-type icons in the "Add field" palette and on field
  cards, plus a friendlier empty state. (`ComplianceFormBuilder.tsx`.)

### 10.7 End-to-end QA pass (June 2026): bugs found and fixed

A further full review of staff and customer flows (three independent passes plus
direct tracing). The functional core held up; the items below were fixed. No
migration; typecheck + lint + lint:modals clean; 1676 tests green.

**Bugs fixed**

1. **Inline-booking drafts were never cleared after a successful booking →
   stale answers on the next visit.** The clear was tied to the
   `submittingBooking` prop, but `BookingComplianceForms` unmounts the instant
   submission starts (the flow swaps to the submitting panel), so the prop was
   never observed `true` and the effect never ran. Moved the clear to the parent,
   firing when the flow reaches `confirmation`/`payment` (success). A failed
   submit now correctly still resumes on reload; a completed booking no longer
   leaves stale answers behind. (`BookingComplianceForms.clearBookingComplianceDrafts`,
   `AppointmentBookingFlow.tsx`.)
2. **Deep link to Templates & types opened the wrong tab.** Changing the default
   sub-tab to General (§10.6) broke the `?sub=types` link from the requirements
   editor, because the settings section never read the `sub` param. It now honours
   `?sub=`. (`ComplianceSettingsSection.tsx`.)
3. **Service requirements tab dead-ended when compliance was OFF.** The panel
   hard-coded `complianceEnabled` to true, so with the feature off it fired
   403-ing requests and sat on "Loading…". It now reads the real feature flag and
   shows the same "turn it on in General settings" guidance the Types tab does.
   (`ComplianceSettingsSection.tsx`.)
4. **The dashboard "morning sweep" went stale after every action.** The dashboard
   route caches per venue for 5 min and only busts the cache on `?refresh=1`, but
   the client re-fetched the bare URL after a capture / send, so actioned items
   lingered for up to 5 minutes. The client now revalidates against `?refresh=1`.
   (`ComplianceDashboardView.tsx`.)
5. **In-venue capture left a sent form link live.** Capturing a record staff-side
   didn't retire a still-pending link, so it kept nagging in "awaiting client
   submission" and the guest could still open the old link and create a duplicate
   record. Staff capture now consumes any matching pending links (audited).
   (`form-links-service.consumePendingLinksForCapture`, `records/route.ts`.)
6. **Pre-check flashed contradictory "contact the venue" copy for inline forms.**
   For a type that is both blocking and collected inline, the pre-check briefly
   showed a scary block row until the inline component reported its type ids. The
   pre-check now self-suppresses `inline` requirements from its own data (the
   API already returns `online_collection`), removing the flash entirely.
   (`CompliancePreCheckNotice.tsx`.)

**Clarity / correctness polish**

7. Record `result` now shows a friendly label (Pass / Fail / Inconclusive) in the
   guest records list, not the raw token. (`shared.RESULT_LABELS`, `ComplianceSection.tsx`.)
8. Form-link send/resend messages are honest when nothing was actually
   dispatched ("we couldn't send it — no mobile/email on file, use Copy link")
   instead of a reassuring "ready". (`ComplianceSection.tsx`.)
9. A consumed-link submit race now shows the reassuring "thank you" state, not an
   error banner. (`PublicComplianceForm.tsx`.)
10. The requirement editor warns when a requirement blocks online booking but is
    set to "Do not collect online" for a client-completable type (a dead-end
    config). (`ComplianceRequirementsEditor.tsx`.)

**Verified solid (no change needed):** signed-URL flow for signatures/files;
pass/fail "needs decision"; void; form-link issue/dedup/revoke; the merged
"Before you book" card never shows an empty card; stable draft UUID; draft
restore/resume; signature-pad mobile resize; storage-path security guards;
per-tenant isolation on every new path.

**Follow-ups since picked up and implemented (§10.8):** the dashboard send-link
channel fallback and per-field server errors. Still open:

- **No client-side file size/type guard** before upload, so an oversized photo is
  rejected only after a round trip on mobile.
- **"Complete now" on the dashboard opens hand-to-client mode** by default; the
  label and default could be aligned (kept as-is pending a product call).
- Minor jargon ("lead time", "capture method") could carry a one-line hint;
  multiselect groups can't take `aria-required`/`aria-invalid` (invalid ARIA), so
  required/invalid is conveyed via the label asterisk + `aria-describedby` error.

### 10.8 Follow-ups implemented (June 2026)

Two of the §10.7 reported items, picked up. No migration; typecheck + lint +
lint:modals clean; 1676 tests green.

- **Dashboard "Send link" now just works for any guest.** The form-links route
  resolves a deliverable channel itself: it uses the requested channel if the
  guest has that destination, otherwise falls back to the other channel they do
  have, and if neither is on file it still creates the link and returns
  `dispatched:false` + `public_url`. The route now returns `sent_via` (the channel
  actually used). The dashboard reports how it was sent and, when nothing could be
  delivered, copies the link to the clipboard so a phone/email-less guest is never
  a dead end; the per-guest panel messaging was aligned. No per-row channel toggle
  was added (it would clutter the sweep). (`form-links/route.ts`,
  `ComplianceDashboardView.tsx`, `ComplianceSection.tsx`.)
- **Server field errors now show under the offending field.**
  `ComplianceFormRenderer` gained a `serverErrors` prop that maps a server
  rejection's `field_errors` onto the matching fields via react-hook-form
  `setError`, reusing the existing inline-error + `aria-invalid`/`aria-describedby`
  wiring. Wired into the public link form and the staff capture dialog (both
  receive `field_errors` directly). The inline-booking-create path still surfaces
  only the top-level message (its errors arrive at the whole-flow response and
  routing them to the right sub-form is a larger change) — left as a follow-up.
  (`ComplianceFormRenderer.tsx`, `PublicComplianceForm.tsx`,
  `ComplianceCaptureDialog.tsx`.)

### 10.9 Second end-to-end QA pass (June 2026)

Another full staff + customer review (two independent passes plus direct
tracing). The earlier fixes were verified solid; three further items were fixed.
No migration; typecheck + lint + lint:modals clean; 1676 tests green.

**Bugs fixed**

1. **Group bookings had no compliance UI at all — a hard online dead-end.** The
   "Before you book" card (pre-check + inline forms) rendered only in the
   single/multi flow, while the `group_details` step had neither — yet
   `create-group` enforces compliance and 409s a `block_online` requirement. So a
   service bookable solo became un-bookable in a group with no online way to
   satisfy it. Fixed by extracting the card into a self-contained
   `BookingComplianceBlock` (which owns its own active-state, so no shared-flag
   bugs) and rendering it in both the single and group details steps; the group
   submit now gates on mandatory forms and threads `compliance_submissions` +
   `compliance_draft_id` (the route already captured them before its gate). The
   clear-on-success effect now also covers the group success steps.
   (`BookingComplianceBlock.tsx`, `AppointmentBookingFlow.tsx`.)
2. **Form links were mislabeled after an internal SMS→email fallback.**
   `dispatchComplianceFormLink` silently re-sends by email when SMS fails but
   returned `{ok:true}` with no channel, so the caller recorded `sent_via='sms'`
   and the UI/audit said "sent by SMS" when it went by email. Dispatch now returns
   the channel it actually used, and all four senders (manual send, resend,
   auto-send reminders, expiry cron) persist/return that. (`dispatch.ts`,
   `form-links/route.ts`, `.../resend/route.ts`, `auto-send.ts`, `expiry-cron.ts`.)
3. **The venue "Default form-link channel" setting was ignored on manual sends.**
   The Send-link buttons hard-coded `send_via:'email'`, so a venue set to SMS never
   sent by SMS. The buttons now omit the channel and the route falls back to
   `config.default_form_link_channel` (then to whatever destination the guest has).
   (`zod-schemas.ts`, `form-links/route.ts`, `ComplianceDashboardView.tsx`,
   `ComplianceSection.tsx`.)

**Reviewed and confirmed solid:** the merged card's empty-state handling, the
pre-check inline self-suppression, draft clear-on-success vs failed-submit resume,
`consumePendingLinksForCapture` scoping, the `?refresh=1` dashboard revalidation,
the `useSearchParams` sub-tab (no SSR/build concern), the canonicalJson save dedup,
and the serverErrors plumbing on the public form + capture dialog.

**Still open (low priority, by judgment):** inline-booking-create `field_errors`
not shown per-field (the §10.8 follow-up — arrives at the flow level); the inline
`mandatoryComplete` is vacuously true in the sub-second window before forms load
(server re-checks, so no bypass — just a blunter error path); a client-side file
size/type guard before upload.

## Sources

- Vagaro — [Forms feature](https://www.vagaro.com/pro/forms), [Make Forms Mandatory](https://support.vagaro.com/hc/en-us/articles/24398220401819-Make-Forms-Mandatory-for-Your-Customers), [Dual‑signature forms](https://www.vagaro.com/learn/vagaros-dual-signature-forms-improve-intake-liability), [Notifications & reminders](https://support.vagaro.com/hc/en-us/articles/115000439594-Send-Notifications-and-Reminders-to-Your-Customers), [Check‑In Kiosks](https://support.vagaro.com/hc/en-us/articles/5024382031131-Manage-Your-Check-In-Kiosks), [Self check‑in](https://support.vagaro.com/hc/en-us/articles/115003955413-Self-Check-In-at-a-Business-for-Customers-of-a-Vagaro-Business)
- Phorest — [Digital Consultation Forms](https://www.phorest.com/us/features/digital-consultation-forms/), [Automated Consultation Forms](https://www.phorest.com/updates/save-time-with-new-automated-consultation-forms/), [Schedule forms to send automatically](https://support.phorest.com/hc/en-us/articles/7218939979026-How-do-I-schedule-Consultation-Forms-to-send-to-clients-automatically), [Send a form before an appointment](https://support.phorest.com/hc/en-us/articles/360017376400-How-do-I-send-a-Consultation-Form-to-a-client-to-fill-out-before-their-appointment)
- Booksy — [Introduces Custom Forms](https://biz.booksy.com/en-us/blog/booksy-introduces-custom-forms), [Introduces Consent Forms](https://biz.booksy.com/en-gb/blog/booksy-introduces-consent-forms)
- Fresha — [Client forms overview](https://www.fresha.com/help-center/knowledge-base/clients/607-client-forms-overview), [Complete forms](https://www.fresha.com/help-center/knowledge-base/clients/183-complete-forms), [How clients complete consultation forms](https://support.fresha.com/hc/en-us/articles/360017574719-How-do-clients-complete-consultation-forms-), [Appointment reminders](https://www.fresha.com/help-center/knowledge-base/calendar/167-send-appointment-reminders)
- Jane (health, comparison) — [Intake Form FAQ](https://jane.app/guide/intake-form-faq), [Consent forms](https://jane.app/guide/consent-forms)

---

## 10. Addendum (June 2026): staff-builder and guest-completion usability review

This addendum was added after the §9 plan (Phases 0 to 5) shipped. §9 made the
feature *functionally* complete and correct: enforcement is watertight, records
are trustworthy, in-booking collection works, and the data/governance model is
strong. This pass looked at a different layer — **how quick and easy the feature
is to use** for (a) a salon staff member building and managing forms, and (b) a
client completing a form or booking. Everything below is a usability, builder, or
polish gap, not an architectural defect. Findings were verified against the code;
file references are `path:line` at the time of review.

> **Scope note.** None of these block the feature shipping or compromise data
> integrity. They are the difference between "works" and "fast and pleasant." A
> few overlap with §9 Low/deferred items (cross-referenced); the rest are new.

### 10.1 Staff: building and managing forms

| ID | Finding | Location | Impact |
|---|---|---|---|
| **U1 ✅** | **The custom form builder cannot set help text, character limits, or default values.** Each field card exposes only label, Required, Staff-only, and (for select/multiselect) options. The schema and renderer fully support `help_text`, `max_length`, and `default_value` (incl. date `'today'`), and the renderer *displays* help text — but there is no input for any of them, so a hand-built form can never carry guidance or a prefilled date. Only library templates (authored in TypeScript) can. | `ComplianceFormBuilder.tsx:494-558` (FieldCard); supported at `form-schema.ts:46-92`; rendered at `ComplianceFormRenderer.tsx:117` | **High.** Intake forms lean on help text; this is the most-felt builder gap. |
| **U2 ✅** | **Pass/fail setup is back-to-front** — and pass/fail is the most common salon form (patch tests). Staff must first add a *staff-only select* field, then scroll to the amber box below the field list to nominate it as the result field and tag pass/fail values. Nothing guides the order; the rules (must be select + staff_only + required, values present, no overlap) surface only as save-time errors, inviting repeated fix cycles. | `ComplianceFormBuilder.tsx:603-682` (ResultMappingEditor); rules at `form-schema.ts:168-198` | **High.** Friction on the single most-used form type. |
| **U3 ✅** | **Result type locks silently after creation.** The dropdown is disabled in edit mode with only a small grey note and no warning at creation time. A wrong choice means archiving and rebuilding the whole form. | `ComplianceFormBuilder.tsx:294-309` | Medium. |
| **U4 ✅** | **No version history, changelog, or rollback in the UI.** Versions are stored immutably and `GET .../types/[id]/versions` exists, but no component consumes it, the builder never collects the `changelog` it already supports (the save POSTs `form_schema` only), and there is no view/restore of a prior version. A bad edit can only be superseded, not reverted. | builder save `ComplianceFormBuilder.tsx:245-254`; endpoint `types/[id]/versions/route.ts`; no UI caller | Medium. |
| **U5 ◑** | **No "Duplicate type" and no bulk actions.** Making a variant means rebuilding by hand; archiving many types is one click each. (Duplicate shipped; bulk actions still open.) | `ComplianceSettingsSection.tsx` TypesPanel | Low/Medium. |
| **U6** | **The feature is spread across three surfaces.** Daily work lives at `/dashboard/compliance` (the "morning sweep"); all setup (types, requirements, general) lives under `/dashboard/settings?tab=compliance`, and the builder is reachable only from there (`/dashboard/compliance-types` just redirects). Easy to get lost. | `dashboard/compliance/page.tsx`; `compliance-types/page.tsx` (redirect); `ComplianceSettingsSection.tsx` | Low. |
| **U7 ✅** | **Editing a form fires two sequential saves that can half-apply.** Edit PATCHes the type meta, then POSTs a new version separately; if the first succeeds and the second fails, state is partially saved behind an error. | `ComplianceFormBuilder.tsx:227-255` | Low (robustness). |
| **U8 ✅** | **Dropdown option values auto-derive from labels on every keystroke with no collision guard,** so two labels that slugify identically (e.g. "Yes" / "Yes!") silently share a value and can corrupt select validation or result mapping. | `ComplianceFormBuilder.tsx:574-579` | Low (edge case). |
| **U9 ✅** | **Library templates can't be previewed before cloning** (only a field count is shown); slug collisions are silently suffixed. | `ComplianceSettingsSection.tsx` LibraryDialog | Low. |

### 10.2 Guests: completing forms and booking

| ID | Finding | Location | Impact |
|---|---|---|---|
| **U10 ✅** | **No save-progress / resume anywhere.** Inline booking forms live in React state; the public link form keeps nothing locally. A refresh, dropped mobile connection, or tab close loses all entry (and strands any in-progress upload). Worst on long forms on a phone. | `BookingComplianceForms.tsx`; `PublicComplianceForm.tsx` | **High.** |
| **U11 ✅** | **Signature pad mobile bug.** The canvas backing store is sized once on mount from `getBoundingClientRect()` and never re-measured; if the width changes after mount (orientation change, or rendering inside an animating dialog) the live pointer mapping no longer matches the scaled backing store, so strokes land offset/distorted. Fixed 160px height is also cramped on phones. | `SignaturePad.tsx:27-47,91` | **High** (touch is the primary signing surface). |
| **U12 ✅** | **"Cannot book online" can dead-end the guest.** When a service needs an in-venue-only type (e.g. patch test) with `block_online`, the per-type `online_unmet_message` (shipped in §9.3) explains next steps — but it is optional. Unset, the guest sees a generic "Must be completed before this can be booked online" with no action. | `CompliancePreCheckNotice.tsx:171-191`; message is an optional builder field | Medium. Extends §9.3. |
| **U13 ✅** | **Returning clients with a different email read as MISSING.** Pre-check resolves "already on file" by venue+email; a regular who books under a second email is told the requirement is unmet and may be blocked online. Escape hatch is the "contact the venue" copy. | `pre-check` POST; `public-forms-service.ts` `publicPreCheckForGuest` | Medium. |
| **U14 ✅** | **Two stacked "what you need" panels** in the details step (the pre-check notice and the inline forms block) risk reading as duplication, even though `suppressTypeIds` dedups type ids between them. Now merged into one shared "Before you book" card (§10.6). | `AppointmentBookingFlow.tsx` | Low/Medium. |
| **U15** | **No self-service correction after submit.** A consumed public link shows "Already submitted, contact the venue" — a typo means a phone call. | `p/forms/[code]/page.tsx` consumed copy | Low. |
| **U16** | **Expired links fail silently** — expiry happens on access/cron with no "your link expired" message, so guests may keep retrying a dead link. (Related to the §9.5 Low item on the expiry-reminder template, but distinct: this is the *link*, not the record.) | `public-forms-service.ts:112-122` | Low. |
| **U17 ✅** | **Form renderer accessibility gaps** — no `aria-invalid`, `aria-describedby` (help text not linked), or `aria-required`; validation errors are not programmatically tied to their fields. Reinforces the §9.5 deferred "a11y label-association sweep." | `ComplianceFormRenderer.tsx` | Low/Medium. |

### 10.3 Verification notes (claims checked and rejected)

During this review three plausible-sounding concerns were checked and found to be
non-issues, recorded here so they are not re-raised:

- The public pre-check POST **is** rate-limited (30/IP/min). `pre-check/route.ts:42`.
- Group bookings **do** enforce compliance per attendee (the "not wired" idea was a stale reading of §6/§9 history, not the code). `create-group/route.ts:504-528`.
- Single-use link consumption **is** atomic with rollback on capture failure — no race. `public-forms-service.ts:214-258`.

### 10.4 Suggested implementation order

Sequenced by value-per-effort, front-loading the two changes a salon and a client
feel most, and grouping by the surface each touches so work batches cleanly. All
of it stays behind `compliance_records_enabled`, Appointments-tier, off by default.

- **Step 1 — Builder field options (U1) + pass/fail flow (U2). ✅ implemented (June 2026).** `FieldCard` gained a help-text input on every field plus a `FieldExtras` block carrying character limit + default value (text/textarea), default selection (select), default selections (multiselect), and a No default / Today / specific-date control (date) — all already supported by the schema and renderer. Choosing result type = pass/fail now auto-inserts a ready-made staff-only `Result (staff decision)` select (`required`, options Pass/Fail) and wires `result_mapping`, so a valid pass/fail form exists immediately; the field and its options stay fully editable and the amber panel's copy was updated to match. All in `ComplianceFormBuilder.tsx`. Typecheck + lint clean; 169 compliance / 1664 total tests green.
- **Step 2 — Signature pad mobile fix (U11) + guest accessibility (U17). ✅ implemented (June 2026).** `SignaturePad` now re-measures its canvas via a `ResizeObserver` (sizing was previously one-shot on mount, the cause of offset strokes after an orientation change or dialog open), redraws the saved signature to fit on each re-measure, and defaults to a taller 200px pad. `ComplianceFormRenderer` adds `aria-required` / `aria-invalid` / `aria-describedby` to every input, links help text and error text by id, marks the error `role="alert"`, and wraps the multiselect group in `role="group"` with `aria-labelledby`. No data-model change. Typecheck + lint clean; tests green.
- **Step 3 — Draft persistence (U10). ✅ implemented (June 2026).** New `src/lib/compliance/form-draft.ts` holds SSR-guarded, best-effort localStorage helpers (`loadFormDraft` / `saveFormDraft` / `clearFormDraft` / `clearFormDraftsByPrefix`) with a 7-day TTL, covered by `form-draft.test.ts` (7 tests incl. TTL expiry, prefix clear, SSR + quota-throw safety). `ComplianceFormRenderer` gained an optional `draftKey`: it restores a saved draft once per key after mount (no SSR mismatch), autosaves on change (debounced 300ms), and clears on a clean submit only. The public link form passes `draftKey={`public:${code}`}` and now rethrows a failed submit so the draft is kept for retry. `BookingComplianceForms` persists a stable per-venue draft id and the completed-responses map, restores both on mount, gives each inline form its own `draftKey`, and clears all of a venue's booking drafts once the booking is submitted. Staff/preview contexts pass no `draftKey` (no drafts on shared devices). Typecheck + lint clean; 1671 tests green (7 new).
- **Step 4 — Blocked-online guidance (U12) + returning-client lookup (U13). ✅ implemented (June 2026).** `CompliancePreCheckNotice` now shows actionable default copy when the venue has set no `online_unmet_message`: a blocked MISSING requirement reads "This needs to be on file before you can book online. Please contact the venue to arrange it." (the venue's own message still wins when set), an EXPIRED one points the guest to renew with the venue, and a `warn_client` requirement on an in-venue-only type no longer falsely promises an email link (it now says the team will complete it at the appointment) — using the `client_online` flag the pre-check API already returns, so no API change. For U13 the blocked MISSING copy adds a nudge that a returning client may have used a different email or phone last time and should check with the venue. **Note:** the deeper cross-email guest identity match was intentionally *not* changed — `findOrCreateGuest` deliberately skips phone matching for silent-auth public bookings (an account-linking safety measure), so the booking gate would still create a new guest and block; matching the pre-check on phone alone would produce a false "on file". The escape-hatch copy is the correct low-risk fix; a true cross-identity match belongs with the guest merge/dedup subsystem. Copy-only, no migration; typecheck + lint + lint:modals clean; 1671 tests green.
- **Step 5 — Staff management niceties (U4, U5, U3, U7). ✅ implemented (June 2026).** New service functions `restoreComplianceTypeVersion` and `duplicateComplianceType` (`types-service.ts`, both reusing the existing create/version flows so slugs, audit and validation are consistent), with 4 new unit tests. New admin routes `POST /types/[id]/versions/restore` and `POST /types/[id]/duplicate`. **U4:** the edit builder now shows a read-only Version history panel (v-number, date, changelog, "(current)") with one-click Restore that re-publishes a prior version as a new monotonic version (records keep their captured version) and re-hydrates the editor; a "What changed" changelog field is saved with each version. **U3:** the new-form builder now warns under the result-type select that it can't be changed after creation. **U7:** `complianceTypePatchSchema` + the PATCH handler accept an optional `form_schema` (+ `changelog`) so the edit save updates settings and publishes the new version in a single request (validating the schema first, so an invalid form changes nothing); the builder no longer fires two sequential writes. **U5:** a Duplicate action in the settings types list creates an independent "{name} (copy)"; bulk actions were not included (lower value, left for Step 6). Typecheck + lint + lint:modals clean; 1675 tests green (4 new).
- **Step 6 — Lower-priority polish. ◑ partially implemented (June 2026); the rest deferred by judgment.**
  - **U8 ✅** — the builder's option editor now de-duplicates derived option values (appends `_2`, `_3`, …) so two labels that slugify the same no longer silently share a value and corrupt select validation / pass-fail mapping. (`ComplianceFormBuilder.tsx` OptionsEditor.)
  - **U9 ✅** — `templateSummaries()` now carries each template's `form_schema`, and the "Add from library" dialog has a per-template **Preview** toggle that renders the form read-only (shared `ComplianceFormRenderer` in preview mode) before cloning. (`library/index.ts`, `ComplianceSettingsSection.tsx`.)
  - **Deferred (with reasons), not done:**
    - **U14 (two-panel consolidation): ✅ later implemented in §10.6** (the merge was done as part of the UX pass once it was explicitly requested).
    - **U15 (self-service resubmit):** a consumed link's "already submitted, contact the venue" copy is already actionable; true self-correction means re-opening a consumed link and voiding/re-capturing a record that may already have been acted on — an integrity/audit concern best handled by staff, by design.
    - **U16 (proactive expired-link email):** the on-page expired copy already tells the guest to ask the venue for a new link; a proactive email needs a new cron pass, message template and dispatch — infra-heavy for low value (sits with the §9.5 deferred expiry-reminder items).
    - **U6 (navigation consolidation):** the daily dashboard and Settings already cross-link; unifying the IA is a broader, riskier dashboard change disproportionate to the benefit.
    - **Bulk type actions (U5 remainder):** low value (venues have few types); deferred.

Steps 1 to 5 are implemented, and Step 6's two worthwhile wins (U8, U9) with
them — all with no migration. The remaining Step 6 items (U14, U15, U16, U6,
bulk actions) were assessed and **deferred by judgment**: each is either
net-negative to force (booking-flow regression risk, data-integrity concerns) or
low-value infra for a polish pass. The reasons are recorded per item above. This
completes the actionable usability work from the §10 review.
