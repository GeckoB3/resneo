# Resneo Compliance — Competitive Review & Improvement Plan

**Status:** Phases 1–3 implemented ✅ · Phase 4 implemented ✅ (G6+G7; G8 deferred — optional)
**Date:** June 2026 (Phase 1 shipped)
**Scope:** How Vagaro, Phorest, Booksy and Fresha integrate compliance/intake/consent forms into booking, vs. Resneo's current implementation — and a prioritised plan to close the gaps.

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

## Sources

- Vagaro — [Forms feature](https://www.vagaro.com/pro/forms), [Make Forms Mandatory](https://support.vagaro.com/hc/en-us/articles/24398220401819-Make-Forms-Mandatory-for-Your-Customers), [Dual‑signature forms](https://www.vagaro.com/learn/vagaros-dual-signature-forms-improve-intake-liability), [Notifications & reminders](https://support.vagaro.com/hc/en-us/articles/115000439594-Send-Notifications-and-Reminders-to-Your-Customers), [Check‑In Kiosks](https://support.vagaro.com/hc/en-us/articles/5024382031131-Manage-Your-Check-In-Kiosks), [Self check‑in](https://support.vagaro.com/hc/en-us/articles/115003955413-Self-Check-In-at-a-Business-for-Customers-of-a-Vagaro-Business)
- Phorest — [Digital Consultation Forms](https://www.phorest.com/us/features/digital-consultation-forms/), [Automated Consultation Forms](https://www.phorest.com/updates/save-time-with-new-automated-consultation-forms/), [Schedule forms to send automatically](https://support.phorest.com/hc/en-us/articles/7218939979026-How-do-I-schedule-Consultation-Forms-to-send-to-clients-automatically), [Send a form before an appointment](https://support.phorest.com/hc/en-us/articles/360017376400-How-do-I-send-a-Consultation-Form-to-a-client-to-fill-out-before-their-appointment)
- Booksy — [Introduces Custom Forms](https://biz.booksy.com/en-us/blog/booksy-introduces-custom-forms), [Introduces Consent Forms](https://biz.booksy.com/en-gb/blog/booksy-introduces-consent-forms)
- Fresha — [Client forms overview](https://www.fresha.com/help-center/knowledge-base/clients/607-client-forms-overview), [Complete forms](https://www.fresha.com/help-center/knowledge-base/clients/183-complete-forms), [How clients complete consultation forms](https://support.fresha.com/hc/en-us/articles/360017574719-How-do-clients-complete-consultation-forms-), [Appointment reminders](https://www.fresha.com/help-center/knowledge-base/calendar/167-send-appointment-reminders)
- Jane (health, comparison) — [Intake Form FAQ](https://jane.app/guide/intake-form-faq), [Consent forms](https://jane.app/guide/consent-forms)
