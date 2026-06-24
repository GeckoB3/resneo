# Reserve NI — Classes, Events & Resources: State Review & Remediation Plan

**Version:** 2.0
**Date:** 22 June 2026
**Scope:** End‑to‑end review of the **classes** (`class_session`), **ticketed events** (`event_ticket`) and **bookable resources** (`resource_booking`) systems — setup & customisation, public booking flows, staff‑created bookings, calendar & bookings‑screen management, booking‑detail screens, guest manage/confirm lifecycle, account portal, class commerce, and shared plumbing (comms, reports, import, embed, setup). Appointments (`unified_scheduling`) is treated as the reference implementation throughout.
**Status:** Assessment only — no code changes were made.
**Supersedes (partially):** `Docs/Resneo-Class-Event-Resource-Functionality-Review-And-Plan-May-2026.md` (v1.0, 19 May 2026), which is now stale in several material respects (see §2).

---

## How this review was produced

A full re‑audit of the current `staging` branch was carried out across the dashboard managers, public flows, APIs, libs, crons, account portal and shared infrastructure. Findings cite `file_path:line`. The May‑2026 review was treated as **untrusted** and every claim re‑verified against current code.

A sample of the highest‑severity findings was **independently re‑verified by reading the source directly** (marked ✔ verified below). Two earlier candidate findings were **disproven and excluded**: (a) a claimed "import inserts CDE rows with null FK / silent data loss" — the execute path correctly records `unsupported_resolution`, increments `skipped` and `continue`s before any insert (`src/lib/import/run-execute.ts:1057-1096`); and (b) a claimed comms "double‑send" for CDE — legacy lanes explicitly `continue` on `isCdeBookingRow` and the CDE lane runs only when `cdeOnly === isCde`. One finding was **down‑graded after verification**: guest self‑cancel restoring credits only for `class_session` (`src/app/api/confirm/route.ts:554`) is *by design* — credits/memberships are a class‑commerce concept and events/resources are Stripe‑only, so there is no value loss.

---

## ✅ Implementation status — 22 June 2026

**This review has been implemented.** All Critical/High findings and the large majority of Medium/Low findings are fixed in the working tree, and the two capacity migrations have been **applied to the database**. Gate at completion: **`tsc` clean · 1515 unit tests passing · 0 lint errors**. A four‑way adversarial regression review was run after implementation and its findings folded back in (see end of section).

Legend: ✅ Implemented · ◑ Partial (v1 / documented carve‑out) · ⏳ Deferred (needs schema/API or larger feature work)

### Status by finding

| Group | Findings | Status | Notes |
|-------|----------|:------:|-------|
| **Money & revenue** | M1–M7 | ✅ | Shared event‑ticket validator used by public + staff routes (M1/C2); idempotent + prorated course refund (M2/M3); corrected cart precedence + dead engine rewired (M4/M6); membership reconcile cron + refund‑restore (M5/M7). |
| **Capacity / integrity** | C1–C12 | ✅ | C1 via the applied `enforce_cde_capacity` trigger (advisory‑lock; 409 mapped in every booking route incl. staff); C4 timetable machinery **removed**; C3 ticket upsert‑by‑id; C5/C6/C7/C10/C11/C12 fixed. |
| **Security** | S1 | ✅ | Manage‑link HMAC now expires (30‑day TTL, backward‑compatible). |
| **Security** | S2, S3 | ⏳ | Own‑venue calendar‑scope PII gate on `bookings/list` (S2) and venue‑sourced `stripe_account_id` in fulfill routes (S3) not yet done — Medium defense‑in‑depth; recommended next. |
| **Functionality** | F1, F2 | ✅ | Reports render the per‑model breakdown + tier/utilisation analytics (F1); embed passes `onHeightChange` to all CDE flows (F2). |
| **Classes (§5.1)** | setup / timetable / roster | ✅ | Dead timetable removed; cancel→refund/notify; reschedule→move bookings; capacity‑override guard; calendar‑scoped rosters; modals → design‑system primitives. |
| **Class commerce (§5.2)** | credits / courses / memberships / cart / recurring | ✅ | Period‑reset epoch fix; recurring re‑check + dedupe; pending‑enrolment cleanup cron; account credit‑expiry display. |
| **Events (§5.3)** | manager / booking / attendees | ✅ | Ticket upsert‑by‑id (no orphaning); series grouping; public‑booking hardening; tier analytics; clone; status‑filtered roster; NumericInput editor. |
| **Resources (§5.4)** | engine / flow / timeline / sheet | ✅ | check‑in guard; interval / `max<min` / `%24` / TZ / multi‑range fixes; month‑grid a11y; mark‑no‑show; `no-store` cache. |
| **Calendar & list (§5.5)** | feed / strip / list / detail | ◑ | Feed hardened (fail‑closed / limits / N+1 / uptake math); stale‑strip + dead deep‑link fixed; list de‑dup + CDE fixes. **Full CDE drag‑reschedule deferred** (clear non‑draggable affordance shipped). |
| **Booking detail (§5.6)** | surfaces / account / manage | ✅ | De‑restauranted drawer; enriched CDE context; account `/events` + `/resources` hubs + single‑load detail; friendly statuses; policy‑aware refund copy. |
| **Cross‑cutting (§5.7)** | embed / tabs / sidebar / home / import | ✅ | Wide shell + storefront tabs for CDE‑primary venues; mobile tab scroll; distinct sidebar icons; CDE dashboard‑home cards; import pre‑flight. |
| **Guest/staff self‑modify (§5.6 #1, §4 T7)** | manage link + staff modify | ◑ | Guest **resource + class** self‑reschedule and **staff class** slot‑move shipped. Events stay cancel+rebook; credit/membership‑paid class moves stay cancel+rebook (v1 carve‑outs). |

### Deferred (net‑new features needing schema/API work)
- **Full resource calendar drag‑reschedule** — needs a resource‑aware drag preview + PATCH branch + column pinning; a clear non‑draggable affordance ships in the interim.
- **Multi‑resource booking + per‑resource photos/descriptions** — need a schema migration + batch‑create API; a bookable‑length range ships interim.
- **S2 / S3** security defense‑in‑depth (above); minor: staff `event-offerings` horizon; staff resource reschedule `cancellation_deadline` refresh (pre‑existing).

### Post‑review regression fixes (folded in after the adversarial pass)
- Allowance memberships with a NULL `current_period_start` no longer read as unlimited‑free (money‑safe: allowance withheld until the period syncs via the reconcile cron).
- Staff event/class/resource booking routes now return a clean **409** (not 500) on the capacity‑trigger race; one‑off class‑instance create maps the unique‑index conflict to 409.
- Guest resource self‑reschedule now excludes the booking’s own slot from occupancy so nearby moves are offered.

### Applied migrations
- `supabase/migrations/20261225120000_cde_capacity_guards.sql` — `enforce_cde_capacity` trigger (event/class count + resource overlap, advisory‑lock serialised).
- `supabase/migrations/20261225120100_class_instances_unique_slot.sql` — unique `(class_type_id, instance_date, start_time)`.

---

## 🔁 Follow‑up re‑review & calendar‑closure fix — 23 June 2026

A second independent pass re‑verified the 22 June claims directly against the current `staging` tree (five parallel audits across commerce, events, resources, calendar/list, booking‑detail/plumbing/security). **The large majority of the ✅ claims hold up and are backed by real code, not stubs.** This section records (1) a scheduling‑correctness bug found *and fixed* in this pass, (2) a money bug where a prior ✅ was only half‑true (now fixed), and (3) smaller corrections — **all of which have now been implemented** (one item, platform commission, was confirmed intentional and one, CDE import create‑new, stays deferred). Gate after this pass: **`tsc` clean · 0 lint errors · 1536 unit tests passing**.

### ✅ Fixed this pass — class sessions could be scheduled over closures, leave & breaks (High, Bug)

**Symptom (reported):** scheduling class sessions did not fully respect calendar/business closures — a session could be placed on top of a venue closure, staff leave, a day off or a break.

**Root cause (verified):** every class‑scheduling entry point funnels through `assertClassSessionWindowFreeOnCalendar` → `assertExperienceEventWindowFreeOnCalendar` (`src/lib/experience-events/calendar-event-window-conflicts.ts`). That check only looked at `experience_events`, unified `calendar_blocks`, active `bookings` and other `class_instances`. It **never consulted** the calendar‑availability sources the appointment engine treats as authoritative (`src/lib/availability/appointment-engine.ts:963‑994`):

| Source | Meaning | Checked before | Checked now |
|--------|---------|:--------------:|:-----------:|
| `availability_blocks` (service_id null, `closed`/`special_event`/`amended_hours`) | **Business closure** / amended hours | ✗ | ✅ |
| `practitioner_leave_periods` (full‑day or partial) | **Calendar closure** — staff leave | ✗ | ✅ |
| `unified_calendars.days_off` (exact date) | **Calendar closure** — one‑off day off | ✗ | ✅ |
| `unified_calendars.break_times` / `break_times_by_day` | **Break** | ✗ | ✅ |
| `practitioner_calendar_blocks` (legacy block table) | Blocked time | ✗ (only the unified `calendar_blocks` twin was checked) | ✅ |
| `bookings` / events / class sessions / `calendar_blocks` | **Pre‑existing booking** | ✅ | ✅ |

This affected **all four scheduling paths** (single `class-instances` POST, `class-instances/bulk` POST, instance reschedule PATCH, and the class‑type instructor/duration change re‑validation in `classes/route.ts`) because they share that one funnel.

**Fix:** new module `src/lib/calendar/class-schedule-availability-conflicts.ts` (pure evaluator + thin, **fail‑closed** fetcher), wired into `assertClassSessionWindowFreeOnCalendar` *before* the existing overlap check. It returns a specific, date‑stamped message per clash, e.g.:
- "The venue is closed on Mon 6 Jul 2026, so this class can't be scheduled then. Remove or amend that closure first."
- "Studio A is on leave from 12:00 to 13:00 on Mon 6 Jul 2026, which clashes with this class time."
- "This class time (13:30–14:30) overlaps a break (13:00–14:00) on Studio A's calendar on Mon 6 Jul 2026."
- existing overlap messages are now suffixed with the offending date+time so **bulk** scheduling errors name the clashing session (e.g. "…overlaps a class session on this calendar (Mon 6 Jul 2026 at 09:00).").

Returned as **409** by every route (the schedule modal already surfaces `json.error` in its red alert). Covered by 18 new unit tests (`…class-schedule-availability-conflicts.test.ts`).

**Deliberate design carve‑out (documented in the code):** like the public class‑availability engine, scheduled classes remain **not** bound by *recurring weekly* opening/working hours — only the **date‑specific** closures/leave/days‑off/breaks above can block a session. This preserves the intended "a 7pm class on a venue that closes at 5pm is still bookable" behaviour while catching every real closure/leave/break/booking clash. If stricter "must be inside weekly working hours" behaviour is wanted for classes too, that is a one‑line policy change in the new module (reuse `validateExperienceEventWindowAgainstVenueAndCalendar`, the events validator) — flag it and it can be added.

### ✅ Fixed this pass — entitlement precedence (M4/M6) on the single‑class path (money, High)

M4/M6 were ✅ **for the multi‑session cart** but **not** the **single‑class** booking path: `src/app/api/booking/create/route.ts` consumed class credits after checking only the credit *balance*, never course/membership coverage — so a member/enrollee who booked a single class and opted to pay with credits **burned a credit for a session already covered**, and a covered member who didn't opt in was charged the deposit.

**Fix:** the `class_session` branch now resolves entitlement coverage in product‑rule precedence (course → membership → credits → card), reusing the **same** helpers as the cart (`userCourseCoversClassInstance`, `membershipCoversClassType`, `membershipUnlimitedCoversClassType`, `consumeMembershipAllowanceForBooking`). For a signed‑in member/enrollee whose email matches the booking, a covered session is now **free** (no deposit, no credit) and allowance‑plan memberships ledger the consumption against the new booking row (mirroring the cart, idempotent, with booking‑delete rollback on failure). Credits remain opt‑in and are only consumed when **not** covered. `src/app/api/booking/create/route.ts` (class branch + post‑insert allowance redemption).

### Smaller corrections (all fixed this pass except where noted)

| Finding | Sev | Status | Where |
|---------|-----|--------|-------|
| **Class detail‑sheet booked count** counted No‑Show/Completed as booked → "X / Y booked" overstated in the roster sheet | Low | ✅ fixed | `ClassInstanceDetailSheet.tsx` now uses `isCapacityConsumingStatus` (canonical set shared with the API list + schedule feed) |
| **Check‑in/roster commerce‑gate asymmetry** — buttons rendered then 403 on non‑commerce venues | Medium | ✅ fixed | roster GET returns `can_manage_attendance` (`…/attendees/route.ts`); the sheet hides check‑in / no‑show / check‑in‑all when false (no access‑policy change) |
| **`syncCalendarBlockForClassInstance` delete‑only no‑op** run on every freshly‑inserted row | Low | ✅ fixed | removed the wasted per‑row calls from single + bulk create (`class-instances/route.ts`, `class-instances/bulk/route.ts`); reschedule/cancel cleanup unchanged |
| **Account portal CDE detail** showed no class spot count | Low | ✅ fixed | `class_spots` (capacity / booked / remaining — no attendee PII) added in `account-bookings.ts`, rendered on `account/bookings/[bookingId]/page.tsx`; computed only for the single‑booking detail (not the list) |
| **Allowance "remaining" math** re‑implemented inline in the account API — drift risk | Medium | ✅ fixed | `account/memberships/route.ts` now nets via the shared `netAllowanceConsumed` + `ALLOWANCE_CONSUMING_REASONS` |
| **S1 backward‑compat** — legacy expiry‑less `?hmac=` links accepted forever | Low | ✅ hardened | legacy acceptance now bounded by the existing rotation cutoff `LEGACY_MANAGE_LINK_ACCEPT_UNTIL_MS` (1 Aug 2026), same as legacy `/m/` links; deterministic before/after‑cutoff tests added |
| **Resource party‑size field** (1–50) was cosmetic — resources have no capacity model | Medium | ✅ fixed | removed the field from `ResourceSlotBookingForm.tsx`; `party_size` is now always 1 |
| **No platform `application_fee`/`on_behalf_of`** on any class charge | Medium | Resolved as intended | platform takes no per‑transaction Stripe fee on **any** model (0 hits repo‑wide); confirmed intentional — commission handled via subscription billing. No change. |
| **CDE import "create new"** is service/staff only | Medium | Deferred (as documented) | `import/create-reference-entity.ts:158` — references can be mapped or skipped but not created in‑flow |

**Confirmed accurately implemented this pass** (spot‑checked, no false ✅): M1/C2 (shared `validate-event-ticket-booking`), C3 (`syncEventTicketTypes` upsert‑by‑id), C8 (`parent_event_id` + `series_key` grouping + `[id]` PATCH now re‑validates placement), C1 (`enforce_cde_capacity` trigger + 409 mapping in all write routes), C7 (resource check‑in status guard), C12 (multi‑range hours round‑trip), C4/C5/C6/C10/C11 (timetable removed; PATCH‑cancel → refund/notify; reschedule moves+notifies bookings; calendar‑scoped roster reads; unique‑slot migration), F1 (`report_by_booking_model` + tier/utilisation analytics rendered), F2 (`onHeightChange` wired to all CDE flows), M2/M3/M5/M7 (idempotent prorated course refund; reconcile cron; refund‑restore), schedule‑feed hardening, wide shell + marketing tabs + dashboard‑home cards + distinct sidebar icons. **Still correctly deferred:** S2, S3, full CDE calendar drag, multi‑resource booking, class waitlist, partial ticket refund, event/credit‑class guest self‑move.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [What changed since the May‑2026 review](#2-what-changed-since-the-may-2026-review)
3. [Critical & high‑severity issues (fix‑first)](#3-critical--high-severity-issues-fix-first)
4. [Cross‑cutting themes](#4-cross-cutting-themes)
5. [Subsystem detail](#5-subsystem-detail)
   - 5.1 [Classes — setup, timetable & roster](#51-classes--setup-timetable--roster)
   - 5.2 [Class commerce — credits, courses, memberships, cart, recurring](#52-class-commerce--credits-courses-memberships-cart-recurring)
   - 5.3 [Events (ticketed)](#53-events-ticketed)
   - 5.4 [Resources](#54-resources)
   - 5.5 [Calendar & bookings‑screen management](#55-calendar--bookings-screen-management)
   - 5.6 [Booking‑detail screens & guest lifecycle](#56-booking-detail-screens--guest-lifecycle)
   - 5.7 [Cross‑cutting plumbing](#57-cross-cutting-plumbing)
6. [UI & design assessment](#6-ui--design-assessment)
7. [Functional gaps vs appointments](#7-functional-gaps-vs-appointments)
8. [Prioritised remediation plan](#8-prioritised-remediation-plan)
9. [Appendix — severity tally](#9-appendix--severity-tally)

---

## 1. Executive summary

Classes, events and resources are **not stubs** — each has a dedicated staff manager, an availability engine, a public booking flow, Stripe Connect payment paths, calendar integration, roster tooling, scheduled comms and import support. Classes additionally ship a genuinely deep **commerce** layer (credits, courses, Stripe‑subscription memberships, multi‑session cart, recurring reservations) that exceeds the appointments product. Resources have **caught up** since May — they now have a calendar detail sheet and a real staff slot‑modify with engine‑validated slot picker.

However, the re‑audit surfaced a tranche of **correctness, money and data‑integrity bugs** that the previous (parity‑focused) review did not look for, plus a consistent set of **UI/design debt** and **functional gaps**. The headline issues are concentrated where the public/guest paths diverge from the better‑hardened staff paths, and where capacity is enforced without any database‑level guard.

### Verdict by model (current state)

| Model | Maturity vs appointments | Headline |
|-------|--------------------------|----------|
| **Classes** | Closest on commerce; **weakest on scheduling correctness** | World‑class commerce engine sitting on a **non‑functional weekly‑timetable path** (instance generation is unwired) and several entitlement/refund bugs |
| **Events** | Solid setup + roster | **Public booking trusts client‑supplied ticket prices** (revenue hole) and capacity is non‑atomic; recurrence produces ungrouped standalone events |
| **Resources** | Most improved; now has detail sheet + staff modify | Engine and TZ handling are the strongest of the three; remaining risk is **double‑book races** and check‑in without a status guard |

### The five things to fix this week

*(All five are now ✅ fixed — see [Implementation status](#-implementation-status--22-june-2026) above.)*

1. **Events: public booking accepts client ticket prices** → pay £0 for a paid event. ✔ verified — `src/app/api/booking/create/route.ts:1079‑1090`.
2. **Classes: course‑cancellation refund has no idempotency** → double‑click = double refund. ✔ verified — `src/app/api/account/courses/cancel/route.ts:104‑124`.
3. **All CDE models: capacity is non‑atomic** (read‑then‑insert, no DB exclusion constraint or lock) → oversell under concurrency. Events `…/create/route.ts:1063‑1067`; resources `…/bookings/[id]/route.ts:1407‑1424`; classes `quote-class-cart.ts` / `insert-*-class-session-booking.ts`.
4. **Classes: the weekly‑timetable → instance‑generation path is dead code** → "weekly rule" UX produces zero sessions. ✔ verified — `generate-instances` has no caller and no cron (`vercel.json`).
5. **Guest manage link: non‑expiring HMAC bearer token + wrong refund copy.** ✔ verified — `src/lib/short-manage-link.ts:151‑168`; hard‑coded "48 hours"/"reservation" at `ManageBookingView.tsx:349‑359`.

---

## 2. What changed since the May‑2026 review

The May review's verdict table and parity matrix are **stale** on resources and on help content. Corrections:

| May‑2026 claim | Current reality | Evidence |
|----------------|-----------------|----------|
| Resources: "No instance detail sheet" | **Wrong** — full sheet exists (guest info, payment, check‑in, cancel, message, "Change slot") | `src/components/practitioner-calendar/ResourceInstanceDetailSheet.tsx`, wired at `PractitionerCalendarView.tsx:7201‑7214` |
| Resources: staff get "contact/notes patch only" | **Wrong** — resources have a real reschedule with engine‑validated slot picker | `StaffResourceBookingModifyForm.tsx`, `StaffResourceBookingModifySlotPicker.tsx`, routed at `StaffExpandedBookingModifyModal.tsx:364‑374` |
| "Classes — weekly timetable + recurrence ●" (complete) | **Wrong** — instance generation is unwired; weekly rules create no sessions | `generate-instances` has zero callers; cron list has no entry |
| CDE "Dedicated help articles ○ Missing" | **Partly wrong** — class/event/resource help articles exist | `src/lib/help/articles/…` |
| `BookingModifySurface` abstraction "to build" (C0.1) | **Shipped** | `src/components/booking/BookingModifySurface.tsx` |

Still accurate from May: drag‑reschedule remains blocked for all CDE on the calendar; events & classes still have no staff slot‑move (contact/notes only); guests still cannot self‑modify any CDE booking; no `/account/events` or `/account/resources` hubs.

---

## 3. Critical & high‑severity issues (fix‑first)

Ordered by blast radius. "✔" = re‑verified directly during this review.

### Money & revenue

| # | Issue | Sev | Status | Where |
|---|-------|-----|:------:|-------|
| M1 ✔ | **Public event booking trusts `ticket_lines[].unit_price_pence` from the request body** — no re‑derivation from `event_ticket_types`, no `ticket_type_id` ownership check. A crafted request pays £0 (or any amount) for a `full_payment` event and can forge ticket lines. The **staff** route validates all of this (`/api/venue/bookings/route.ts:297‑328`); the public one does not. | **Critical** | ✅ | `src/app/api/booking/create/route.ts:1079‑1090` |
| M2 ✔ | **Course cancellation refund is not idempotent** — `stripe.refunds.create({payment_intent})` with no idempotency key, and the refund fires *before* the enrollment is marked cancelled. Double‑submit or a retry between refund and DB update = second full refund. | **Critical** | ✅ | `src/app/api/account/courses/cancel/route.ts:104‑124` |
| M3 | **Course cancellation always refunds 100%** regardless of timing or sessions already delivered — a 6‑week course cancelled in week 5 refunds the entire fee (no proration). | High | ✅ | `…/courses/cancel/route.ts:95‑118` |
| M4 ✔ | **Cart entitlement precedence is inverted** — when the guest opts to pay with credits, credits are consumed *before* checking course/membership coverage, so a member/enrollee burns a credit for a session already paid for. Contradicts `CLASS_COMMERCE_PRODUCT_RULES.md` §1/§15 ("prefer course over credits"). | High | ✅ | cart (`orchestrate-class-cart-checkout.ts`) **and** single‑class path (`booking/create/route.ts`) now both resolve course → membership → credits → card; see [23 Jun follow‑up](#-followup-rereview--calendarclosure-fix--23-june-2026) |
| M5 | **Membership lifecycle depends on a manually‑configured Connect webhook with no reconciliation** — if the Stripe Dashboard subscription events aren't wired, memberships silently never activate, or a cancelled subscription keeps granting unlimited free classes. No backfill/reconcile job. | High | ✅ | `sync-membership-from-stripe.ts`; `webhooks/stripe/route.ts:246‑257` |
| M6 | **Dead, and wrong, entitlement engine** — `decideClassLineEntitlement` is referenced only by its own test; if used it prefers credits over course/membership (also inverted). Two sources of truth for precedence. | Medium | ✅ | cart uses `decideClassLineEntitlement`; the single‑class path now applies the same course→membership→credits precedence via the shared coverage helpers — see [23 Jun follow‑up](#-followup-rereview--calendarclosure-fix--23-june-2026) |
| M7 | **Refund webhook branches don't restore credits/allowance or free class capacity** — a Stripe‑originated refund marks `deposit_status=Refunded` but leaves consumed credits and the booking/capacity intact. | Medium | ✅ | `webhooks/stripe/route.ts:164‑231, 258‑318` |

### Capacity, concurrency & data integrity

| # | Issue | Sev | Status | Where |
|---|-------|-----|:------:|-------|
| C1 | **Capacity is non‑atomic for every CDE model.** Availability is read, then the booking is inserted later with no row lock, `SELECT … FOR UPDATE`, transaction or DB exclusion constraint. Concurrent bookers (the on‑sale moment for events; two cart lines for the same class; two hirers of one court) can each pass the check and both commit. Only class *credits* are protected (advisory‑lock RPC). | High | ✅ | Events `create/route.ts:1063‑1067`; Resources `bookings/[id]/route.ts:1407‑1424` + `create` path; Classes `quote-class-cart.ts:134‑143`, `insert-*-class-session-booking.ts` |
| C2 | **Public event booking ignores per‑tier capacity and doesn't check `party_size == Σ ticket quantities`** — a VIP tier can be oversold; `party_size:1` with 10 ticket rows corrupts counts and roster. Staff route enforces both. | High | ✅ | `create/route.ts:1054‑1090` |
| C3 | **Editing an event deletes & recreates all `event_ticket_types` rows**, minting new ids, so existing `booking_ticket_lines.ticket_type_id` point at deleted tiers — silently freeing per‑tier capacity and breaking roster provenance. Fires on every edit. | High | ✅ | `experience-events/route.ts:588‑600`; `[id]/route.ts:131‑148` |
| C4 ✔ | **Weekly‑timetable instance generation is unwired** — `POST /generate-instances` has no caller and no cron; `class_timetable`, `interval_weeks`, `recurrence_end_date`, `total_occurrences` produce no sessions. The dashboard can edit/delete weekly rules but never *create* one. | High | ✅ removed | `…/classes/generate-instances/route.ts` (no callers); `vercel.json` |
| C5 | **Class instance PATCH‑cancel bypasses the refund/notify pipeline and is weaker‑authed** — `PATCH {is_cancelled:true}` (calendar‑scope staff, or any API caller) just flips a flag; it never cancels/refunds/notifies the attached bookings, unlike the admin‑only `/cancel` route. Strands paid guests. | High | ✅ | `classes/route.ts:484‑557` vs `class-instances/[id]/cancel/route.ts` |
| C6 | **Rescheduling a class instance doesn't move or notify its bookings** — `class_instances.start_time` changes but linked `bookings.booking_time` doesn't; roster, calendar and guest all disagree. | High | ✅ | `classes/route.ts:540‑557` |
| C7 | **Resource check‑in writes `checked_in_at` with no status guard** — a Cancelled/No‑Show/Completed resource booking can be "checked in" via the API. The `client_arrived` PATCH path restricts status; check‑in doesn't. | High | ✅ | `…/bookings/[id]/check-in/route.ts:59‑66` |
| C8 | **`parent_event_id` is never set on recurrence** — weekly/series events insert N independent rows, so the booking catalogue shows a 12‑week class as 12 separate "events", defeating the pick‑event→pick‑date UX. | Medium | ✅ | `experience-events/route.ts:254, 310‑363` |
| C9 | **Pending course enrollments never expire** — abandoned paid checkouts permanently hold a seat (capacity counts `pending_payment`); a popular course can be fully "held" by never‑completed checkouts. | Medium | ✅ | `courses/checkout/route.ts:77‑92`, `courses/enroll/route.ts:65‑80` |
| C10 | **Roster reads aren't calendar‑scoped** — instance/attendee GETs check only venue ownership, not `staffMayManageClassTypeSessions`, so any staff member can read full guest PII for classes they don't manage. Write paths *do* enforce scope. | Medium | ✅ | `class-instances/[id]/route.ts`, `[id]/attendees/route.ts` |
| C11 | **No uniqueness constraint on `(class_type_id, instance_date, start_time)`** — app‑level dedupe only; concurrent bulk submits can insert duplicate sessions. | Medium | ✅ | `class-instances/bulk/route.ts:76‑101` |
| C12 | **Editor silently collapses multi‑range weekly resource hours to a single range** — opening & saving a resource with split hours (09–12 + 14–18) discards the second range, shrinking availability. | Medium | ✅ | `ResourceTimelineView.tsx:159‑182, 1846, 1864` |

### Security / privacy

| # | Issue | Sev | Status | Where |
|---|-------|-----|:------:|-------|
| S1 ✔ | **Non‑expiring HMAC manage link** — `createBookingHmac` signs `manage:${bookingId}` with no expiry/nonce; `?hmac=` is a permanent bearer token for full guest PII + cancel/confirm authority. The v3 token path enforces a TTL and burns on use; the hmac path never does. | High | ✅ | `src/lib/short-manage-link.ts:151‑168` |
| S2 | **`bookings/list` returns full guest PII for all CDE rows with no calendar‑scope/role gate** — a staff member with no assigned calendars still receives every guest's email/phone across all CDE bookings. | Medium | ⏳ deferred | `…/bookings/list/route.ts:352‑355` |
| S3 | **Fulfill endpoints trust client‑supplied `stripe_account_id`** — passed straight to `paymentIntents.retrieve`; exploitability is low (PI metadata still gates the grant) but the account id should come from the venue row, not the client. | Medium | ⏳ deferred | `account/credits/fulfill/route.ts:32‑34`, `account/courses/fulfill/route.ts:32‑34` |

### Functionality surfaced but not rendered

| # | Issue | Sev | Status | Where |
|---|-------|-----|:------:|-------|
| F1 ✔ | **`report_by_booking_model` is computed and shipped to the client but never rendered** — the events‑vs‑classes‑vs‑resources revenue/volume split exists in the payload and is dropped on the floor. UI‑only fix; highest value‑to‑effort ratio in the audit. | High | ✅ | `ReportsView.tsx:81,120` (declared, never used) vs `api/venue/reports/route.ts:451,583` |
| F2 | **Embed never passes `onHeightChange` to Event/Class/Resource flows** — only appointment/table flows push remeasure on step change; CDE embed relies solely on a `ResizeObserver` that misses overflowing popovers (date pickers, dropdowns), so embedded CDE booking clips/under‑sizes. | High | ✅ | `BookingFlowRouter.tsx:125‑137` |

---

## 4. Cross‑cutting themes

These patterns recur across all three models and are the structural roots behind many individual findings.

**T1 — Public/guest paths are less hardened than staff paths.** The single most important theme. The staff event‑booking route validates ticket ownership, per‑tier capacity, price equality and `party_size==Σqty`; the public route validates none of it (M1, C2). Two divergent event PATCH paths exist, one of which skips conflict/hours validation (`experience-events/[id]/route.ts`). Wherever logic is duplicated rather than shared, the guest path is the weaker copy. **Recommendation: extract a single server‑side "validate & price a CDE booking" module and call it from both audiences.**

**T2 — Capacity has no database‑level guard, anywhere.** Every model does read‑then‑insert. Credits got an advisory‑lock RPC; nothing else did. This is a latent oversell across events, classes and resources (C1). **Recommendation: a `tstzrange` GiST exclusion constraint for resources, and an atomic capacity‑decrement RPC (instance/event `FOR UPDATE`) covering all cart lines, mirroring `consume_class_credits_atomically`.**

**T3 — Timezone handling is inconsistent at the display layer.** The engines mostly do the right thing (venue IANA timezone — resources are exemplary). But "today"/initial month and several displayed dates are computed in the browser's local zone or UTC, producing off‑by‑one‑day issues: classes stats/agenda mix local & UTC (`ClassTimetableView.tsx:409‑438`); resource calendar "today" is browser‑local (`ResourceCalendarMonth.tsx:24‑27`); booking detail uses four different conventions across four surfaces (UTC list, profile‑TZ detail, browser‑local manage). `estimated_end_time` is stored as venue‑local wall‑clock serialised as UTC (resources, classes). `minutesToTime` can emit `"24:30"` for late‑night sessions (`schedule/route.ts`). **Recommendation: one venue‑TZ date/format helper used by every surface; never `new Date()`/`toISOString().slice(0,10)` for "today".**

**T4 — Capacity‑consuming statuses are defined three different ways.** The schedule feed counts everything except `Cancelled` (so No‑Show/Completed inflate "12/12 booked"); the availability engine uses an allow‑list `['Booked','Confirmed','Pending']`; the timetable list and detail sheet each differ again. Chips and rosters disagree. **Recommendation: one exported `CAPACITY_CONSUMING_STATUSES` constant, used everywhere.**

**T5 — Restaurant semantics leak into CDE surfaces.** The shared booking‑detail drawer hard‑codes "cover(s)", a "Table" tile and a "Table assignment" section for every model (`BookingDetailContent.tsx:158‑199`); the cancelled‑booking banner says "48‑hour refund window" regardless of policy (`booking-detail-panel-ui.tsx:54‑58`); the guest manage cancel copy says "48 hours"/"reservation" (`ManageBookingView.tsx:349‑359`). For an event/class/resource this reads as a different product. **Recommendation: model‑aware terminology + policy‑driven refund copy everywhere `refund_notice_hours` is already in scope.**

**T6 — Mega‑components and bespoke overlays drive drift and accessibility gaps.** Two ~2,300‑line bookings dashboards duplicate all CDE logic and have *already* diverged (one drops CDE rows when a model is disabled; one doesn't). Three bespoke detail sheets reimplement headers, dismiss, status maps and `aria-modal` differently. Five hand‑rolled `fixed inset-0` modals in the class timetable (plus the resource delete modal) reimplement focus‑trap/ESC/scroll‑lock — mostly incompletely — instead of using the `Dialog`/`Sheet` primitives. `window.confirm`/`alert()` are used for consequential actions (cancel class & refund, "payment successful"). Labels are visual‑only (`<label>` with no `htmlFor`/`id`). **Recommendation: migrate to `Dialog`/`Sheet`/`AlertDialog`/`FormField`; consolidate the two dashboards and three sheets.**

**T7 — Guest self‑modify is universally absent; staff slot‑modify is asymmetric.** `showGuestModify = canModify && !isCde && …` blocks every CDE guest from rescheduling (`ManageBookingView.tsx:194‑197`). Staff can move a *resource* slot but not an event/class slot — for events/classes the modal still says "the allocated slot cannot be changed here… cancel and rebook" (`StaffExpandedBookingModifyModal.tsx:174‑177`). Same "Modify booking" button, three different behaviours.

---

## 5. Subsystem detail

Severity key: **Critical / High / Medium / Low**. Category: Bug / Security / UI / Gap.

### 5.1 Classes — setup, timetable & roster

**State.** Class‑type CRUD is solid and well‑validated (Zod cross‑field rules: deposit ≤ price, duration 5–480, etc.). The one‑off/bulk **`ClassScheduleModal`** is genuinely good — three scheduling modes on a month grid, client‑side expansion, a 100‑instance cap, idempotent bulk insert with "X skipped". Roster/attendance (check‑in, no‑show, "check in all", CSV export, admin cancel‑and‑refund) is reasonably complete. Capacity is computed consistently as `capacity_override ?? class_type.capacity`. Realtime sync keeps the view fresh.

**Key findings** (beyond C4/C5/C6/C10/C11 above):

| Title | Sev | Cat | Where |
|-------|-----|-----|-------|
| Interval‑weeks anchor is the rule's `created_at`, not a chosen start week — fortnightly phase is arbitrary and unalignable | High | Bug | `class-timetable-interval.ts:5‑20` |
| `generate-instances` date loop mixes UTC (`toISOString`) and local (`getDay`) — wrong‑weekday drift across DST (latent; path is unwired) | High | Bug | `generate-instances/route.ts:48‑90` |
| Capacity override can be set below current bookings (oversell, no guard) | Medium | Bug | `classes/route.ts:540`; form `ClassTimetableView.tsx:711‑714` |
| Check‑in requires the commerce plan but reading the roster doesn't — buttons render then 403 for non‑commerce venues | Medium | Bug | `check-in/route.ts:25` vs `attendees/route.ts` |
| `syncCalendarBlockForClassInstance` only deletes, never creates — every creator `Promise.all`s a no‑op across all rows (pure N‑query overhead, misleading) | Medium | Bug | `instructor-calendar-block.ts:218‑227` |
| `booked_spots` in the timetable list excludes only `Cancelled`, so No‑Show/Completed count as booked (≠ engine) | Low | Bug | `classes/route.ts:299` |
| Five hand‑rolled modals + `window.confirm` for cancel‑class; inputs lack `htmlFor`/`id`; month grid duplicated in 2 components | Medium | UI/A11y | `ClassTimetableView.tsx:1198‑1660`; `ClassInstanceDetailSheet.tsx:408` |
| No class waitlist for full classes (machinery exists elsewhere) | Medium | Gap | `class-instances/**` |
| No drag‑move/"move session", no PDF roster | Medium/Low | Gap | timetable read‑only calendar |

**Top priorities:** (1) decide the fate of the weekly‑timetable engine — wire `generate-instances` to a cron + add a create‑rule UI and fix the DST/anchor bugs, **or** delete the machinery and lean on the (good) bulk scheduler; (2) close C5/C6 so cancel/reschedule actually refund, notify and move bookings; (3) calendar‑scope the roster reads (C10); (4) consolidate modals/forms onto primitives.

### 5.2 Class commerce — credits, courses, memberships, cart, recurring

**State.** The strongest engine of the three models and ahead of appointments. Verified‑correct: **atomic FIFO credit consumption** via the `consume_class_credits_atomically` RPC (advisory lock, `FOR UPDATE`, `expires_at NULLS LAST, created_at ASC`, idempotency short‑circuit, partial‑pack split); **fulfillment idempotency** for credit/course purchases (unique `stripe_payment_intent_id` lock before grant); **webhook event de‑dup**; **credit/membership restore on cancellation** (idempotent, policy‑gated); **multi‑session cart atomicity** (`group_booking_id` rollback). Crons exist for credit expiry, membership reset and recurring materialisation.

**Key findings** (beyond M2–M7 above):

| Title | Sev | Cat | Where |
|-------|-----|-----|-------|
| Membership period‑reset rollover falls back to epoch when no prior reset row exists → over‑counts consumption, wrongly denies rollover | Medium | Bug | `cron/class-membership-period-reset/route.ts:93‑126`; `membership-allowance-coverage.ts:50` |
| Allowance "remaining" math is implemented twice (coverage lib vs account UI) — drift risk between what the member sees and what checkout grants | Medium | Bug | `membership-allowance-coverage.ts:155‑170` vs `account/memberships/route.ts:106‑130` |
| Recurring rule validated against `class_timetable` slot but materialised against `class_instances.start_time` — any drift → silent no‑op `skipped`, member quietly stops being booked | Low | Bug | `account/class-recurring/route.ts:150‑165` vs `materialize-recurring-reservation.ts:241‑248` |
| Recurring reservations gate on membership at creation but **not** at materialisation — a lapsed member keeps getting auto‑booked free | Medium | Bug/Gap | `materialize-recurring-reservation.ts` |
| Recurring dedupe uses `.maybeSingle()` — duplicate legacy rows crash/insert a third booking | Medium | Bug | `materialize-recurring-reservation.ts:315‑322` |
| No application fee / `on_behalf_of` on credit/course/membership charges — platform commission on class GMV appears uncollected (confirm intent) | Medium | Gap | `account/memberships/checkout/route.ts:84‑107` (repo‑wide: no `application_fee`) |
| `alert()`/`window.confirm()` in cart & products client; per‑line cart shows only `£amount` with no credit/membership/course coverage hint → "Due now" can differ from what's charged | Medium | UI | `ClassMultiSessionCart.tsx:166,209‑211`; `ClassCommerceProductsClient.tsx:1473` |
| Account credit section never shows **expiry dates** (only "N left"); no skeletons (`Suspense fallback={null}`) | Low | UI | `AccountCreditsSection.tsx:227‑234`; `account/credits/page.tsx:6` |
| 1,854‑line products client; `<select multiple>` "hold Ctrl/Cmd" eligibility picker; membership form writes interval to `rules` *and* top‑level fields (dup source of truth) | Low | UI | `ClassCommerceProductsClient.tsx` |
| No promo/admin‑override path (`promo_or_admin` tier is declared but unused); no partial refunds | Low | Gap | `entitlement.ts:10` |

**Top priorities:** (1) M2 course double‑refund (idempotency key + re‑assert status); (2) M4/M6 fix precedence and remove the dead engine; (3) C1 class‑capacity oversell; (4) M5 membership reconciliation cron + re‑check at materialisation; (5) M3/C9 course proration + stale‑pending cleanup.

### 5.3 Events (ticketed)

**State.** Setup breadth is good (multi‑tier tickets, three schedule modes, per‑event booking window, payment requirement, image, optional calendar placement). Calendar‑window conflict checking is thorough. The **staff** booking‑create branch is correctly hardened. Venue cancel deactivates the event, refunds each booking and notifies. Attendee roster + CSV + check‑in work.

**Key findings** (beyond M1/C1/C2/C3/C8 above):

| Title | Sev | Cat | Where |
|-------|-----|-----|-------|
| Whole‑booking refund only — no partial / per‑ticket refund anywhere (drop 1 of 4 tickets) | Medium | Gap | `experience-events/[id]/cancel/route.ts:81‑106`; `staff-cancel-booking.ts:122‑163` |
| Two divergent edit/PATCH paths; the `[id]` path **skips** calendar‑window/hours re‑validation, so an admin can place an overlapping event | Medium | Bug | `experience-events/route.ts:388‑613` vs `[id]/route.ts:83‑161` |
| Attendee fetch/CSV ignore status — Cancelled/No‑show appear in roster & export | Low | Bug | `[id]/attendees/route.ts:33‑41` |
| Public offerings horizon caps at 120 days but events can be created 365 out — distant events never appear publicly | Low | Bug | `EventBookingFlow.tsx:75‑83`; `event-offerings/route.ts:32` |
| Paid event can ship a £0 tier unnoticed (help text is advisory, not enforced) | Low | UI/Bug | `EventManagerView.tsx:208,533‑537,1334` |
| Custom‑dates entered as a raw textarea; invalid months pass the regex; no preview/past‑date rejection | Low | UI | `EventManagerView.tsx:1018‑1027` |
| Ticket‑tier price/cap use ad‑hoc text inputs (not `NumericInput`); labels not associated; `window.confirm` for cancel‑event | Low | UI | `EventManagerView.tsx:1221‑1268, 707‑710` |
| Detail panel re‑fetches event+attendees on every venue‑wide realtime ping (no debounce/relevance filter) | Low | Bug | `EventManagerView.tsx:458‑465` |
| No per‑event analytics (tickets by tier, revenue, fill‑rate); no `/account/events` hub; no clone/duplicate | Low | Gap | — |

**Top priorities:** M1 (price trust), C2 (party/tier checks), C1 (atomic capacity), C3 (upsert ticket types by id), C8 (`parent_event_id`). Honourable mention: consolidate the two PATCH paths (the structural root that let M1 happen).

### 5.4 Resources

**State (most‑improved).** The engine is the best of the three: **timezone/DST handled correctly** (venue IANA clock, 15‑minute DST‑safe stepping), **host‑calendar intersection is thorough** (resource hours ∩ host working hours − breaks − host occupancy − sibling resources ∩ venue business hours), the server **re‑validates and re‑prices** every public booking, and staff reschedule re‑validates against the engine with optimistic concurrency (`updated_at` → 412). Auth is consistent (per‑calendar scoping for non‑admins). Resources now have a calendar detail sheet and staff slot‑modify (the May doc's two "missing" items).

**Key findings** (beyond C1/C7/C12 above):

| Title | Sev | Cat | Where |
|-------|-----|-----|-------|
| Staff reschedule duration is **not** constrained to slot‑interval multiples — a 35‑min booking on a 15‑min resource (public path *is* constrained) | Medium | Bug | `validate-resource-booking-modification.ts:15‑24,89` |
| Server doesn't reject `max_booking_minutes < min` (client guards it; direct API doesn't) | Medium | Bug | `resources/route.ts:114‑125` |
| `computeEndTime` wraps past midnight with `%24` → end < start when a stale prefilled time survives a duration change | Medium | Bug | `ResourceBookingFlow.tsx:495‑501` |
| `estimated_end_time` stored as venue‑local wall‑clock serialised as UTC (off by venue offset for any true‑instant consumer) | Medium | Bug | `bookings/[id]/route.ts:1393‑1402` |
| "Today"/initial month from browser clock, not venue TZ → wrong min‑bookable day for out‑of‑TZ guests | Medium | Bug | `ResourceCalendarMonth.tsx:24‑27` |
| Resource detail sheet `onUpdated` refreshes the bookings list but **not** the schedule feed → stale week‑strip after a slot change | Medium | Bug | `PractitionerCalendarView.tsx:7211‑7213` |
| Party‑size input (1–50) on the staff resource form but resources have **no capacity model** — it consumes nothing | Medium | Gap | `ResourceSlotBookingForm.tsx:364‑371` |
| No "mark no‑show" on the resource sheet (status fully supported in the backend) | Low | Gap | `ResourceInstanceDetailSheet.tsx:456‑498` |
| Hand‑rolled delete modal (no focus trap/ESC); dead `ResourceDetailHero`; month grid no arrow‑key nav (31 tab stops); slot buttons no `aria-pressed` | Medium/Low | UI/A11y | `ResourceTimelineView.tsx:1965‑2016`; `ResourceCalendarMonth.tsx:145‑159` |
| `resource-calendar` GET returns `max-age=45` on an authenticated dashboard route (stale‑after‑edit lag — see your venue‑catalog‑cache memory) | Low | Bug | `resource-calendar/route.ts:124‑127` |
| No multi‑resource / equipment‑bundle booking; no per‑resource photo/description; thin confirmation (no booking ref / "emailed you") | Medium/Low | Gap | `ResourceBookingFlow.tsx:747‑799,1090‑1110` |

**Top priorities:** (1) close the double‑book window (C1 exclusion constraint + in‑flight submit guard) and the check‑in status guard (C7); (2) constrain staff duration to interval + reject `max<min` server‑side; (3) fix the end‑time/TZ trio; (4) stop dropping multi‑range hours (C12) and fix the stale‑strip refresh; (5) the a11y/primitive cluster.

### 5.5 Calendar & bookings‑screen management

**State.** CDE is genuinely *on* the calendar, not just visible: the schedule feed emits class/event/resource blocks, assigned instances render inside their practitioner column, unassigned ones render in the **week CDE strip**, and all three models have detail sheets. The bookings list treats CDE as first‑class for type pills, filters, check‑in and bulk message. Resources are now staff‑modifiable including slot change.

**Key findings:**

| Title | Sev | Cat | Where |
|-------|-----|-----|-------|
| **Drag‑reschedule blocked for all CDE** — resource bookings are `!b.resource_id`‑excluded; class/event instances aren't draggable shells at all. Adjacent appointment vs CDE columns look identical but behave differently | High | Gap | `PractitionerCalendarView.tsx:6514‑6515` |
| Resource slot‑change from the **strip** leaves the strip stale (`onUpdated` calls only `refetchBookingsList`, not `refetchSchedule`) — event sheet does both | High | Bug | `PractitionerCalendarView.tsx:7211‑7213` |
| Schedule‑feed uptake counts include No‑Show/Completed (and stale `client_arrived_at`) → "12/12 booked" overstated | Medium | Bug | `schedule/route.ts:215‑235` |
| Schedule feed **fails open** — an events/class sub‑query error returns 200 with that whole category silently missing | Medium | Bug | `schedule/route.ts:358‑360,416‑418` |
| Schedule feed has no row limit / date‑span cap, plus a per‑class‑type N+1 (up to 5 sequential hops each) | Medium | Bug/Gap | `schedule/route.ts:101‑111,165‑184` |
| Events/classes staff modify is contact/notes‑only ("slot cannot be changed here" → cancel & rebook) while resources get a slot picker | Medium | Gap/UX | `StaffExpandedBookingModifyModal.tsx:64‑84,174‑177` |
| `?experience_event_id=` deep‑link from the event sheet is dead (neither dashboard reads the param) | Medium | Bug | `EventInstanceDetailSheet.tsx:233` |
| Inline list expand suppresses the CDE title card and shows no roster — if the API didn't denormalise a name, the CDE name appears nowhere (the drawer *does* show it) | Medium | Gap | `ExpandedBookingContent.tsx:256‑262` |
| Two ~2,300‑line dashboards duplicate CDE logic and have already diverged (one drops CDE rows when a model is disabled, with no empty‑state hint) | High | Gap (maint.) | `AppointmentBookingsDashboard.tsx:650‑654` / `BookingsDashboard.tsx` |
| `bookings/list` status filter applied **after** a 250‑row DB cap (guest‑history mode); session/id queries are unbounded | Medium | Bug | `bookings/list/route.ts:190,391‑405` |
| Day sheet is covers/period‑centric — CDE rows get a pill but no event/class/resource context, capacity or roster | Medium | UI/Gap | `DaySheetView.tsx:317‑409` |
| `minutesToTime` uncapped → "24:30" for late‑night blocks | Low | Bug | `schedule/route.ts:268,275,277` |
| Three bespoke detail sheets (different `aria-modal`, popover vs sheet, roster as concertina vs table); heavy ad‑hoc Tailwind; cramped 10px week‑strip cells with nested scroll on mobile | Low/Med | UI | sheets + `WeekScheduleCdeStrip.tsx` |

**Top priorities:** (1) ship CDE drag (at least resources, which already have a modify backend) or make non‑draggable visually obvious; (2) fix the stale‑strip refresh; (3) correct uptake math (T4); (4) harden the schedule feed (fail‑closed + limit + N+1); (5) close the events/classes slot‑move and dead‑deep‑link gaps.

### 5.6 Booking‑detail screens & guest lifecycle

**State.** Four distinct detail surfaces (dashboard expanded row, dashboard drawer/panel, account portal detail, guest manage/confirm) all infer the CDE model correctly. CDE context (title/subtitle) is centralised in `resolveCdeBookingContext`. Guest cancel is **policy‑aware on the server** (refund gated on `cancellation_deadline`; class credit/allowance restore when in‑window; fail‑safe on refund error). Optimistic concurrency on modify. Multi‑session class groups collapse by `group_booking_id`.

**Key findings** (beyond S1 above):

| Title | Sev | Cat | Where |
|-------|-----|-----|-------|
| **Guest manage cancel copy is not policy‑aware for CDE** — hard‑codes "Full refund if cancelled 48+ hours… your reservation", even though `refundHours` is in scope and the word should be "booking" | High | Bug | `ManageBookingView.tsx:349‑359` |
| **Account portal CDE detail shows zero CDE context** — `loadAccountBookings` selects only generic columns; no event/class/resource name, no ticket lines, no session/roster. Same data the confirm GET assembles is simply not wired in | High | Gap/UI | `account/bookings/[bookingId]/page.tsx:76‑117`; `account-bookings.ts:124‑132` |
| Context resolver returns only `{title, subtitle}` — no ticket‑type breakdown ("2× Adult, 1× Child"), no roster/spot count, no resource duration; party shown as raw "covers"/"Guests" | Medium | Gap | `cde-booking-context.ts:22‑74` |
| Shared drawer is table‑centric — "cover(s)", a "Table" tile and "Table assignment" section for every CDE model; no CDE title in the hero | Medium | UI | `BookingDetailContent.tsx:158‑199,598‑631` |
| CDE context card is suppressed exactly when it's the only title source → subtitle (start/end, host) never shown to staff | Medium | UI | `ExpandedBookingContent.tsx:256‑262` |
| Four surfaces, four timezone conventions for the same booking (UTC list / profile‑TZ detail / browser‑local manage) | Medium | Bug | `account/bookings/page.tsx:73`; `ManageBookingView.tsx:173` |
| `loadAccountBookingById` loads up to 200 bookings (minting a manage short‑link for each) just to `.find()` one | Medium | Bug (perf) | `account-bookings.ts:180‑187` |
| Group/multi‑session cancel semantics ambiguous — guest cancels one session, staff status‑action hits the whole group; opposite behaviours, no "cancel whole course" affordance | Medium | Gap | `account/bookings/page.tsx:78‑89` |
| Staff cancelled‑booking banner hard‑codes "48‑hour refund window" regardless of policy | Low | UI | `booking-detail-panel-ui.tsx:54‑58` |
| Account list leaks raw enum status ("No‑Show") and UTC dates to guests; no friendly labels | Low | UI | `account/bookings/page.tsx:71‑76` |
| Manage page collapses expired / already‑used / already‑cancelled into a generic "Invalid link"; no re‑request path | Low | UI | `ManageBookingView.tsx:126‑138` |
| Compliance forms surfaced only on the manage page, not the confirm page or account portal | Low | Gap | `confirm/route.ts:283` |
| Account detail/list have no loading/error UI; venue‑join failure silently renders "Venue" | Low | UI | `account/bookings/[bookingId]/page.tsx` |

**Top priorities:** (1) enable CDE guest self‑modify *or* at minimum fix the misleading refund copy (T7/the manage‑copy bug); (2) S1 non‑expiring HMAC link; (3) wire real CDE context into the account portal + kill the 200‑row fan‑out; (4) reconcile group‑cancel semantics; (5) unify date/TZ/status presentation and de‑restaurant‑ify the drawer (T3/T5).

### 5.7 Cross‑cutting plumbing

**State (mostly healthy).** Public tab model→slug mapping and ordering is correct, the embed `?tab=`/`?accent=` contract is honoured and the doc is current, staff new‑booking tabs are correctly gated and ordered, CDE confirmations + scheduled reminders are model‑aware and de‑duplicated (resources included), import reference resolution for event/class/resource is correct (unresolved rows are skipped with an audit record), the sidebar exposes all three managers, and the setup checklist covers every active model for both primary and secondary paths.

**Key findings** (beyond F1/F2 above):

| Title | Sev | Cat | Where |
|-------|-----|-----|-------|
| CDE flows render in the cramped `max-w-lg` shell when the venue's **primary** is CDE (only `unified_scheduling` gets the wide two‑column shell) | Medium | UI | `BookPublicBookingFlow.tsx:129‑135` |
| Services/Team/About marketing tabs suppressed for all CDE‑primary venues (early‑return `['book']`) — they lose their storefront | Medium | Gap | `booking-page-tabs.ts:43` |
| No event‑tier or resource‑utilisation analytics; events/resources have no model‑specific report (classes do) | Medium | Gap | `reports/route.ts` |
| No "create new" path or pre‑flight catalogue check for CDE import references — empty‑catalogue rows skip at execute time with no up‑front warning | Medium | Gap | `import/create-reference-entity.ts` |
| No CDE dashboard‑home widgets (today's classes / fill %, ticket sales, resource bookings) | Medium | Gap | `dashboard-home-payload.ts` |
| Public tab bar wraps to ragged centered rows on mobile (no horizontal scroll like the staff bar) | Low | UI | `BookPublicBookingFlow.tsx:144` |
| Tab switch remounts the whole flow, discarding in‑progress state | Low | UI | `BookPublicBookingFlow.tsx:177` |
| Staff tab labels hard‑coded singular (`Class`/`Event`/`Resource`); ignore venue terminology overrides the public tabs respect | Low | UI/Copy | `staff-booking-modal-options.ts:26‑32` |
| CDE reminder offsets not independently configurable from appointment offsets (shared 24h/2h lanes) | Low | Gap | `communications/policies.ts` |
| Events/Classes/Resources (and Bookings) all use the same `CalendarIcon` in the sidebar — poor wayfinding for hybrid venues | Low | UI | `DashboardSidebar.tsx:60‑68` |
| `?tab=` deep‑link help copy hidden from Appointments‑plan venues (the main CDE audience) | Low | Copy | `BookingTypesSection.tsx:216‑226` |

**Top priorities:** (1) F1 render `report_by_booking_model` (UI‑only, data already shipped); (2) F2 wire `onHeightChange` through CDE embed flows; (3) marketing tabs + wide shell for CDE‑primary venues; (4) CDE import pre‑flight + dashboard‑home cards.

---

## 6. UI & design assessment

The design system (`src/components/ui/primitives` & `ui/dashboard`: `Dialog`, `Sheet`, `FormField`, `Button`, `PageHeader`, `EmptyState`, `Pill`, tokens in `globals.css`) is solid — but CDE surfaces are **partially migrated**, and that inconsistency is the dominant design problem.

**Recurring UI/design issues across CDE:**

- **Overlays:** ~7 hand‑rolled `fixed inset-0` modals (5 in the class timetable, the resource delete modal, event add‑calendar) reimplement focus‑trap/ESC/scroll‑lock — most **incompletely** (no focus trap, no focus restore). The detail sheets are three separate bespoke implementations with different `aria-modal` values and dismiss logic.
- **Confirmations:** `window.confirm`/`alert()` used for the most consequential actions — "Cancel class & notify guests" (refunds!), "Cancel event", "Payment successful", staff enrollment cancel. Inconsistent with the `AlertDialog`/`ConfirmDialog` used elsewhere, unstyled, not theme‑aware.
- **Forms:** labels are visual‑only (`<label>` with no `htmlFor`, inputs with no `id`) throughout the timetable and several flows; `FormField` is unused there. Ticket price/cap and resource duration use ad‑hoc text inputs rather than `NumericInput`. The class eligibility picker is a `<select multiple>` "hold Ctrl/Cmd" control.
- **Empty/loading/error states:** the account commerce pages render `Suspense fallback={null}` (blank then pop‑in, no skeletons), while the staff products client has skeletons — opposite ends of the bar within one feature. Resource/calendar fetch errors show "no availability" rather than a retry. Account portal detail/list have no error UI.
- **Accessibility:** missing focus management in bespoke modals; month grids with up to 31 tab stops and no arrow‑key/`role="grid"`; slot buttons without `aria-pressed`; raw enum statuses surfaced to guests.
- **Copy & terminology:** restaurant language ("covers", "Table", "48‑hour", "reservation") leaks into CDE detail/cancel surfaces; hard‑coded refund windows; singular staff tab labels that ignore terminology overrides.
- **Mobile:** the public model‑tab bar wraps raggedly; the week CDE strip uses 10px text inside 7 nested vertical scroll regions within a horizontally‑scrolling table.

**Visual polish that *is* good:** the `ClassScheduleModal` month‑grid scheduler, the event manager's live image preview and conflict messaging, the resource detail sheet's action set, and realtime‑synced lists.

---

## 7. Functional gaps vs appointments

> **Update (22 Jun 2026):** many gaps below are now closed — see the **Implementation status** section at the top. Notably now ●: staff slot‑modify (classes), guest self‑modify (classes/resources), instance/detail sheets, model‑specific + by‑model reports, account hubs (events/resources). Still ○: **full CDE calendar drag‑reschedule**, **multi‑resource booking**, class **waitlist**, **partial ticket refund**, and event/credit‑class **guest self‑move** (kept as cancel+rebook).

| Capability | Appointments | Events | Classes | Resources |
|------------|:---:|:---:|:---:|:---:|
| Staff CRUD manager | ● | ● | ● | ● |
| Public + embed booking | ● | ● | ● | ● |
| Atomic capacity guard (DB‑level) | ◐ | ○ | ○ (credits only) | ○ |
| Calendar drag‑reschedule | ● | ○ | ○ | ○ |
| Staff slot‑modify | ● | ○ (contact only) | ○ (contact only) | ● |
| Guest self‑modify (manage link) | ● | ○ | ○ | ○ |
| Guest cancel + policy refund | ● | ● | ● (+ credit restore) | ● |
| Instance/detail sheet on calendar | ● | ● | ● | ● |
| Roster / attendees | ◐ | ● | ● | ◐ |
| Commerce (packs/subs/courses) | ○ | ○ | ● | ○ |
| Account portal hub | ◐ | ○ | ● | ○ |
| Model‑specific reports in UI | ◐ | ○ | ● | ○ |
| Reports by `booking_model` (UI) | ○ (data exists, unrendered) | ○ | ○ | ○ |
| Waitlist | ○ | ○ | ○ | ○ |
| Partial refund | n/a | ○ | ◐ (credits) | ○ |
| Recurrence/series grouping | ● | ○ (ungrouped) | ◐ (unwired) | n/a |

● shipped · ◐ partial · ○ missing

---

## 8. Prioritised remediation plan

### Phase 0 — Stop the bleeding (days, not weeks)

Pure correctness/security/money fixes, mostly small and local:

1. **Harden public event booking** (M1, C2) — re‑derive prices from `event_ticket_types`, validate `ticket_type_id` ownership, per‑tier capacity and `party_size==Σqty`. Ideally extract the staff route's validation into a shared module (addresses T1).
2. **Idempotent course refund** (M2) — deterministic Stripe `idempotencyKey` (`course_refund:<enrollment_id>`) + re‑assert `status='active'` immediately before refund.
3. **Atomic capacity** (C1) — resource `tstzrange` GiST exclusion constraint; instance/event capacity‑decrement RPC; add in‑flight submit guards on public confirm.
4. **Resource check‑in status guard** (C7); **class PATCH‑cancel** routed through the refund/notify pipeline or rejected (C5).
5. **Manage link**: give the `?hmac=` path a TTL+nonce (or migrate to v3 tokens) (S1); fix the policy‑aware cancel copy (manage‑copy bug, T5).
6. **Event ticket‑type edit** → upsert by id, not delete+recreate (C3); consolidate the two PATCH paths so `[id]` re‑validates (T1).
7. **Entitlement precedence** (M4/M6) — course/membership before credits; delete the dead engine.

### Phase 1 — Decisions & medium bugs (1–3 weeks)

8. **Class weekly‑timetable decision** (C4) — wire `generate-instances` to a cron + add the create‑rule UI and fix the DST/anchor bugs, *or* delete the machinery. Pick one; don't ship half.
9. **Class reschedule moves & notifies bookings** (C6); **calendar‑scope roster reads** (C10); **uniqueness constraint** (C11).
10. **Membership reconciliation cron** + re‑check at recurring materialisation (M5/recurring‑lapse); **course proration + stale‑pending cleanup** (M3/C9); **refund webhook restores credits/capacity** (M7).
11. **Resource fixes**: staff duration→interval multiple, server `max<min` rejection, `%24` end‑time, `estimated_end_time` TZ, venue‑TZ "today", multi‑range hours, stale‑strip refresh.
12. **Schedule feed**: fail‑closed, add limit + span cap, fix N+1; **capacity‑status unification** (T4).
13. **Reports**: render `report_by_booking_model` (F1); **embed**: wire `onHeightChange` to CDE flows (F2).

### Phase 2 — Parity & UX (3–8 weeks)

14. **CDE guest self‑modify** behind a flag (the #1 support‑call driver) reusing the modify infrastructure; **events/classes staff slot‑move** (close the asymmetry with resources).
15. **CDE calendar drag** (start with resources, which have the backend) or an explicit non‑draggable affordance.
16. **Account portal**: wire CDE context into detail + kill the 200‑row fan‑out; reconcile group‑cancel semantics; friendly status labels; unify date/TZ across surfaces.
17. **Design‑system migration**: replace bespoke modals/`window.confirm`/`alert` with `Dialog`/`Sheet`/`AlertDialog`; route inputs through `FormField`; de‑restaurant‑ify the drawer; add skeletons/error states.

### Phase 3 — Depth & consolidation (8+ weeks)

18. Class & event **waitlist**; **partial ticket refunds**; **event series grouping** (`parent_event_id`).
19. Consolidate the two bookings dashboards and three detail sheets; CDE **dashboard‑home cards**; event‑tier & resource‑utilisation **analytics**; CDE‑primary **marketing tabs + wide shell**; **multi‑resource / equipment bundles**; `/account/events` & `/account/resources` hubs; PDF roster.

---

## 9. Appendix — severity tally

Approximate counts across the audit (de‑duplicated; cross‑cutting items counted once):

| Severity | Count | Examples |
|----------|------:|----------|
| **Critical** | 2 | Event price‑trust (M1); course double‑refund (M2) |
| **High** | ~16 | Non‑atomic capacity (C1); ticket‑type orphaning (C3); unwired timetable (C4); class cancel/reschedule (C5/C6); resource check‑in guard (C7); HMAC link (S1); reports unrendered (F1); embed height (F2); precedence (M4); membership reconcile (M5); CDE drag; stale strip; account CDE context; manage copy |
| **Medium** | ~35 | Per‑subsystem tables above |
| **Low** | ~30 | Polish, copy, a11y nits |

**Excluded as disproven during verification:** import "silent data loss" (rows are correctly skipped); comms "double‑send" (lanes correctly de‑dupe); guest‑cancel credit‑restore "asymmetry" (by design — events/resources are Stripe‑only).

**Most‑cited root causes (fix these and many findings collapse):** (T1) un‑shared validation between public and staff paths; (T2) no DB‑level capacity guard; (T3) browser‑local/UTC dates at the display layer; (T4) inconsistent capacity‑status definitions; (T6) bespoke overlays & duplicated mega‑components.

---

*End of document.*
