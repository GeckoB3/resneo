# Reserve NI — Appointments Functionality Review & Roadmap

**Version:** 1.0 (consolidated)
**Date:** 21 May 2026
**Last reviewed:** 4 July 2026 (factual-accuracy pass: compliance module, referrals, and feature-flag defaults corrected to match shipped code).
**Supersedes:** `Resneo-Appointments-Functionality-Review-And-Plan-May-2026.md` (v1.0) and
`Resneo-Appointments-Functionality-Review-And-Plan-May2026.md` (v3.0) — both removed.
**Scope:** Appointment-style businesses using **appointments**, **classes**, **ticketed events**, and
**bookable resources**, plus shared capabilities (CRM, payments, comms, online booking, staff tools).
Restaurant-only surfaces (floor plan, table grid, dining waitlist, covers mode) are out of scope
except where they are shared infrastructure.
**Target trades (first wave):** hair salons, barbers, beauticians, massage therapists, dog groomers,
and other appointment-led independents.
**Audience:** Product, engineering, founding-venue GTM.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Target customer & positioning](#2-target-customer--positioning)
3. [Current state — feature inventory](#3-current-state--feature-inventory)
4. [Competitive benchmark](#4-competitive-benchmark)
5. [Strengths & differentiators](#5-strengths--differentiators)
6. [Gap analysis](#6-gap-analysis)
7. [Open strategic question — checkout & POS](#7-open-strategic-question--checkout--pos)
8. [Roadmap](#8-roadmap)
9. [Success metrics](#9-success-metrics)
10. [Risks & dependencies](#10-risks--dependencies)
11. [Related documents](#11-related-documents)
12. [Appendix — feature parity checklist](#12-appendix--feature-parity-checklist)

---

## 1. Executive summary

Reserve NI is **not a thin appointment scheduler**. It is a **multi-model booking platform** with a
mature scheduling engine, unified calendar, deep service catalogue, class/event/resource managers,
Stripe Connect payments, a communications abstraction, GDPR-native CRM, AI-assisted import tooling, a
customer account portal, and rare **linked-venue / collective** capabilities. For hybrid independents
(salon + classes + pop-up events + room hire) Reserve NI is **already broader than Booksy, Fresha, or
Phorest**.

**May 2026 inflection point.** Engineering has closed the **Tier 1 reception-desk gaps** that
previously blocked sales demos. The following are **complete in the codebase** and ship behind
per-venue feature flags. Most default off until pilot rollout, but **guest self-reschedule defaults
on** (it persists only an explicit `false`; omitted means on, per `FLAG_DEFAULT_ON` in
`src/lib/feature-flags/resolve.ts`):

- **Any-available practitioner** booking, flag `any_available_practitioner` (default off)
- **Guest self-reschedule**, flag `guest_self_reschedule` (**default on**; manage link + `/api/confirm` modify)
- **Appointment waitlist v2** — flag `waitlist_v2` (join, staff offer, auto-offer on cancel, expiry cron)
- **Calendar blocks UI** — create/edit/delete on the practitioner calendar (not flagged)
- **Unified booking detail** — one `BookingDetailSurface` across calendar, list, contacts, floor plan
- **UI primitives** (Radix Dialog/Sheet) migrated across operational paths

The competitive story has shifted from *"we're missing desk workflows"* to *"we match Booksy/Fresha
on daily desk operations in code; we still trail on compliance, growth channels, native mobile, and
end-of-visit payment."*

**Verdict.** Reserve NI is **credible for founding-venue pilots** on the wedge buyer — independents
who run *appointments + classes/events/rooms*, collectives, and migrations from spreadsheets or
Fresha exports. It is **not yet credible** for compliance-led beauty (colour, lash, brow — patch
tests), nor for venues that expect to close the till inside the booking tool. The biggest open
question is **how far to go on end-of-visit checkout** — see §7.

**Next 90 days (priority order):**

1. **Production pilot rollout** — apply migrations, enable Phase 1a flags on pilot venues, run the
   demo script, begin measuring §9 baselines.
2. **Resolve the checkout/POS question** (§7) — decide scope before Phase 1b payment work starts.
3. **Phase 1b** — saved cards, pay-balance link, appointment packages (+ checkout-lite if §7 lands
   that way).
4. **Week-12 gate** — pull patch-test tracking forward if Phase 1a held schedule.

---

## 2. Target customer & positioning

### 2.1 Target customer

Independent and small multi-site operators in **Northern Ireland and the UK** who:

- Take **appointments** as core revenue **and/or** run **classes, ticketed events, or room/resource
  hire** from the same brand.
- Want **direct Stripe payouts** — the venue owns the customer payment relationship.
- Need **staff-usable web tools today** (tablet at reception), not necessarily a native app on day one.
- Value **migration** (CSV import, founder-led onboarding) over marketplace lock-in.
- Often operate as **collectives or chair-rental arrangements**, where independent payment flows are
  a feature, not a problem.

First-wave trades: **hair salons, barbers, beauticians, massage therapists, dog groomers.** These
share a common shape — a bookable practitioner, a service catalogue with durations and buffers,
deposits for no-show protection, repeat clients, and an end-of-visit payment. They differ in
compliance load (beauticians/colour need patch tests; massage needs health intake) and in record
type (groomers need pet records, not just client records).

### 2.2 Pricing context

| Tier | Positioning |
|------|-------------|
| **Appointments Light** | Sole trader, 1 calendar, all non-restaurant models, email reminders, pay-as-you-go SMS |
| **Appointments (Plus/Pro)** | Multi-calendar, higher limits, full feature surface |
| **Restaurant** | Out of scope for this document |

Competitors price per bookable staff member (Fresha Team) or in tiered salon plans (Phorest
Starter/Ultimate/Elite). Reserve NI's **multi-model inclusion on the Light tier** is an acquisition
wedge — provided onboarding is fast.

### 2.3 Strategic wedge

**Reserve NI wins when the buyer says:** *"We do appointments and classes"* / *"We hire rooms and run
workshops"* / *"We're a salon that also hosts events"* — situations where Fresha/Booksy/Phorest need
2–3 products or awkward workarounds.

**Reserve NI is challenged when the buyer says:** *"We need patch tests, a card machine at the chair,
and Fresha's client discovery."* The roadmap closes the first two over time; marketplace discovery is
deliberately not pursued (see §5.2).

---

## 3. Current state — feature inventory

Maturity key: **● Complete** · **◐ Partial** · **○ Missing** · **⚑ Complete, behind feature flag**

### 3.1 Appointments & unified scheduling

| Capability | Status | Evidence / notes |
|------------|:------:|------------------|
| Bookable calendars (columns) | ● | `calendar-availability`, plan limits, drag reorder |
| Service catalogue (variants, buffers, colours) | ● | `appointment-services`, staff overrides |
| Three-layer availability (venue / calendar / service) | ● | `appointment-engine.ts` |
| Public appointment booking | ● | `AppointmentBookingFlow`, practitioner slug routes |
| Staff booking + walk-in | ● | `DashboardStaffBookingModal`, walk-in API |
| Day / week / month calendar | ● | `PractitionerCalendarView` |
| Drag-reschedule + duration resize | ● | Calendar grid, undo, deferred guest notify |
| Processing-time blocks | ● | Per-service and per-booking layout |
| Multi-service / group appointments | ● | `group_booking_id` clustering |
| Status workflow (Booked → Confirmed → Started → Completed) | ● | Shared status system + attendance confirm |
| Deposits / full pay online (Stripe Connect) | ● | Service payment requirements, webhooks |
| Practitioner leave / days off | ● | Availability tabs, `practitioner-leave` |
| **Calendar blocks UI** | ● | Create/edit/delete on practitioner calendar |
| **Any-available practitioner** | ⚑ | `appointment-any-practitioner.ts`; flag `any_available_practitioner` |
| **Guest self-reschedule** | ⚑ | `guest-appointment-modify-policy.ts`; flag `guest_self_reschedule` (**defaults on**, unlike the other flags) |
| **Appointment waitlist** | ⚑ | Join / offer / auto-offer on cancel / expiry cron; flag `waitlist_v2` |
| Late-reschedule fee enforcement | ○ | Deferred to Phase 1b (needs saved cards) |
| Native staff mobile app | ○ | Responsive web only |

**Primary routes:** `/dashboard/calendar`, `/dashboard/practitioner-calendar`, `/dashboard/bookings`,
`/dashboard/appointment-services`, `/dashboard/calendar-availability`.

### 3.2 Classes

| Capability | Status | Notes |
|------------|:------:|-------|
| Class types + weekly timetable | ● | `class-timetable`, generate instances |
| Instance lifecycle (cancel, capacity override) | ● | Venue APIs + calendar blocks |
| Public class booking | ● | `ClassBookingFlow` |
| Roster / attendance / CSV export | ● | Class instance detail sheets |
| Class commerce (credits, courses, memberships) | ● | `CLASS_COMMERCE_PRODUCT_RULES.md` |
| Recurring reservations (materialized) | ● | Cron + `class_recurring_reservations` |

### 3.3 Events / ticketed experiences

| Capability | Status | Notes |
|------------|:------:|-------|
| Event CRUD + sessions | ● | `event-manager`, cron materialization |
| Multi-tier tickets | ● | Ticket lines at create |
| Attendee management + cancel | ● | Event APIs |
| Public event booking | ● | `EventBookingFlow` |
| Partial ticket refunds | ○ | Whole-booking refund only in v1 |

### 3.4 Resources

| Capability | Status | Notes |
|------------|:------:|-------|
| Resource CRUD | ● | Venue `resources` APIs |
| Timeline + exceptions calendar | ● | `resource-timeline` |
| Public month/slot booking | ● | `ResourceBookingFlow` |
| Multi-resource single booking | ◐ | Occupancy engine exists; not clearly first-class |

### 3.5 Shared operations spine

| Capability | Status | Notes |
|------------|:------:|-------|
| Unified bookings list (all models) | ● | `AppointmentBookingsDashboard` + filters |
| Unified booking detail / modify | ● | `BookingDetailSurface` + `BookingDetailContent` |
| Bulk SMS / email | ● | `BulkGuestMessageModal` |
| CSV export (filtered) | ● | Bookings + reports |
| Realtime + polling fallback | ● | Supabase + connection banner |
| Guest search from toolbar | ● | `OperationsToolbarGuestSearchPanel` |
| Linked venue calendars & bookings | ● | **Differentiator** |
| Venue collectives (`/book/c/{slug}`) | ● | Multi-venue public booking |

### 3.6 CRM & compliance

| Capability | Status | Notes |
|------------|:------:|-------|
| Contacts list + detail | ● | `ContactsDashboard`, `ContactDetailPanel` |
| Tags, notes, custom fields | ● | Guest APIs |
| Documents (upload / sign) | ● | `ContactDocumentsSection` |
| GDPR export / erase | ● | Venue GDPR routes |
| Merge contacts | ● | Admin merge modal |
| Household linking | ● | `ContactHouseholdSection` |
| Guest loyalty ledger | ◐ | Manual admin point adjustments only — no automated earn/redeem |
| Consultation forms builder | ● | Shipped: form-schema builder + template library (`new-client-intake.ts`, `massage-intake.ts`, consent forms) in `src/lib/compliance/`; tablet-friendly public form links; flag `compliance_records_enabled` |
| Patch test registry + expiry alerts | ● | Shipped: compliance records + expiry cron (`src/app/api/cron/compliance-expiry`), booking-block enforcement; patch-test templates (`eyebrow-patch-test.ts`, `eyelash-patch-test.ts`, `ppd-patch-test.ts`) |
| Before/after photo gallery | ○ | Phorest-class gap |
| Pet / animal profiles | ○ | Groomer-specific gap (breed, coat, temperament, vaccination) |

### 3.7 Payments & commerce

| Capability | Status | Notes |
|------------|:------:|-------|
| Stripe Connect onboarding | ● | Settings → Payments |
| Deposits + cancellation refunds | ● | Policy snapshot on booking |
| Deposit reminders (cron) | ● | `deposit-reminder-2h` |
| Saved cards (guest) | ◐ | SetupIntent endpoint exists; off-session use not wired |
| **Checkout at appointment** (balance, tips, receipt) | ○ | See §7 — open strategic question |
| Appointment packages (prepaid bundles) | ◐ | Class packs exist; not general appointment packages |
| Gift cards / vouchers | ○ | Not built |
| Commission / payroll | ○ | Not built |

### 3.8 Communications

| Capability | Status | Notes |
|------------|:------:|-------|
| Email + SMS templates | ● | Communications abstraction (`lib/communications/`) |
| Confirmation + reminders (cron) | ● | `send-communications` |
| Per-booking staff message | ● | Booking message API |
| Confirm / cancel SMS link | ● | `/confirm/[token]` |
| Reschedule notification | ● | Staff drag + guest-initiated modify |
| WhatsApp | ○ | Channel abstraction ready; implementation not built |
| Two-way SMS inbox | ○ | Not built |
| Review requests post-visit | ○ | Not built |

### 3.9 Online booking & distribution

| Capability | Status | Notes |
|------------|:------:|-------|
| Hosted booking page | ● | `/book/[venue-slug]` |
| iFrame widget + postMessage | ● | `/embed/[venue-slug]` |
| Multi-tab public page (enabled models) | ● | `BookingFlowRouter` |
| Require-account-login toggle | ● | Settings |
| Customer account portal | ● | `/account/*`, v1 APIs, magic link |
| Reserve with Google | ○ | Not built |
| Facebook / Instagram booking | ○ | Not built |
| Consumer marketplace | ○ | Not pursued by design |

### 3.10 Reports, import, staff

| Capability | Status | Notes |
|------------|:------:|-------|
| Booking summary by status / source | ● | `ReportsView` |
| Practitioner + service breakdown | ● | Appointment insights payload |
| Deposit collected / refunded | ● | Reports |
| No-show / cancellation rates | ● | Reports |
| Class commerce reports | ● | Dedicated API |
| Baseline metrics snapshots | ● | Cron `baseline-metrics-snapshot` (Sun 03:00 UTC) |
| Cohort / retention / LTV | ○ | Advanced analytics not built |
| CSV import with AI column mapping | ● | `/dashboard/import/*`, 24-hour undo |
| Calendar sync (Google / Outlook) | ○ | Batch import only |
| Admin vs Staff roles | ● | Venue auth |
| Staff scoped to managed calendars | ● | `getStaffManagedCalendarIds` |
| Shift roster | ○ | Uses availability templates instead |
| Granular permissions (manager / front desk) | ○ | Not built |

---

## 4. Competitive benchmark

Scoring: 1 = far behind · 5 = parity or ahead. Reserve NI scores assume Phase 1a flags **enabled**.

| Dimension | Reserve NI | Fresha | Booksy | Phorest |
|-----------|:----------:|:------:|:------:|:-------:|
| Multi-model (appt + class + event + resource) | **5** | 2 | 2 | 2 |
| Scheduling engine depth | **4** | 4 | 4 | 4 |
| Calendar UX polish | 3 | **5** | 4 | 4 |
| Bookings list / ops | **4** | 4 | 4 | 4 |
| Online booking | 4 | **5** | **5** | 4 |
| Deposits / no-show protection | **4** | 4 | 4 | 4 |
| End-of-visit checkout / POS | 1 | **5** | 4 | **5** |
| CRM depth (salon) | 3 | 4 | 3 | **5** |
| Compliance (forms / patch tests) | 1 | 3 | 2 | **5** |
| Class / membership commerce | **5** | 3 | 2 | 3 |
| Appointment waitlist | **4** | **5** | **5** | 4 |
| Guest self-service (reschedule, account) | **4** | **5** | **5** | 4 |
| Marketing / reviews / discovery | 1 | **5** | 4 | 3 |
| Native staff mobile | 1 | **5** | **5** | **5** |
| Linked multi-venue / collectives | **5** | 2 | 1 | 2 |
| Import / migration | **5** | 3 | 3 | 3 |
| Direct Stripe Connect payouts | **5** | 3 | 3 | 3 |

**Read:** Phase 1a closed the desk-workflow gaps (waitlist, self-service moved 1 → 4). The three
remaining structural weaknesses are **checkout/POS**, **compliance**, and **marketing/discovery +
native mobile**.

---

## 5. Strengths & differentiators

### 5.1 Defend and market

1. **One platform, four bookable models** — one calendar grid, one bookings list, one CRM, one comms
   layer. Competitors require Mindbody + something else, or ignore events/resources entirely.
2. **Class commerce depth** — credits, course bundles, memberships, recurring materialization,
   entitlement precedence. Well beyond a typical "class list".
3. **Linked accounts & venue collectives** — cross-venue calendar visibility and collective booking
   pages suit NI networks (salon groups, shared studios, tourism collectives).
4. **Stripe Connect architecture** — funds land in the venue account; Reserve NI never holds
   non-deposit funds. Strong trust story versus opaque marketplace payouts, and a natural fit for
   chair-rental collectives.
5. **Operational scheduling mechanics** — drag-reschedule with validation, duration resize,
   processing buffers, group appointment stacks, undo.
6. **GDPR-native CRM + documents** — merge, erase, household, signed documents — closer to
   clinic-grade record-keeping than Booksy's client card.
7. **AI-assisted import** — lowers switching cost from spreadsheets, Fresha exports, or legacy tools.
8. **NI-local, founder-led support** — in-region onboarding versus offshore competitor support.

### 5.2 Where "more features" is the wrong goal

Competitors win deals with **fewer visible features perfectly integrated**: book → remind → show up
→ pay → rebook → review. Reserve NI's risk is **breadth without a closed loop**. The roadmap
prioritises **loop completion** over new booking models. Specifically, Reserve NI does **not** pursue
a consumer marketplace — venue-led growth channels (Google, reviews, referral links, collectives)
replace that strategy.

---

## 6. Gap analysis

Gaps grouped by tier. Ordered by revenue impact × frequency in sales conversations.

### Tier 1 — Reception desk parity — **CLOSED IN ENGINEERING (May 2026)**

| Item | Status | Evidence |
|------|--------|----------|
| Guest self-reschedule | Done (flagged) | `guest_self_reschedule` |
| Appointment waitlist | Done (flagged) | `waitlist_v2` |
| Any-available practitioner | Done (flagged) | `any_available_practitioner` |
| Calendar blocks UI | Done | Practitioner calendar |
| Unified booking detail | Done | `BookingDetailSurface` |

**Remaining Tier 1 risk is rollout, not code.** Most flags default off (guest self-reschedule already
defaults on), so pilots must enable the rest, run the demo script, and measure §9 before claiming
parity in GTM.

### Tier 2 — Compliance & retention (current sales blockers)

| Gap | Why it hurts |
|-----|--------------|
| **Patch test tracking + expiry** | UK/Ireland legal & insurance gate for colour, tint, lash, brow — a *segment gate*, not just retention |
| **Digital consultation / intake forms** | Phorest wins clinics and massage therapists on compliance and health intake |
| **End-of-visit checkout** | "Close the ticket" without a second system — see §7 |
| **Appointment packages / prepaid bundles** | Retention + cash flow (class packs ≠ a course of 6 massages) |
| **Automated review requests** | Cheap, compounding marketing; every competitor bundles it |
| **Salon loyalty (points / tiers)** | Treatcard-class retention; current ledger is manual-adjustment only |

### Tier 3 — Growth & distribution

| Gap | Why it hurts |
|-----|--------------|
| **Reserve with Google** | Discovery channel the PRD already names |
| **WhatsApp notifications** | High UK/Ireland demand; channel abstraction is ready |
| **Meta booking links** | Booksy strength for barbers/beauty |
| **Two-way messaging inbox** | Fresha-style client chat |
| **Referral / share booking link** | Venue-led growth substitute for a marketplace |

### Tier 4 — Segment depth

| Gap | Why it hurts |
|-----|--------------|
| **Pet / animal profiles** | Dog groomers need breed, coat, size, temperament, vaccination — not just a client card |
| **Before/after photo gallery** | Beauty and grooming visual records on the contact profile |
| **Gift cards / vouchers** | Cash-flow product (Stripe + ledger); not a POS feature |

### Tier 5 — Scale & enterprise

| Gap | Why it hurts |
|-----|--------------|
| **Native staff app + push** | Daily stylist/groomer workflow; no-marketplace strategy raises mobile's priority |
| **Shift roster** | Rotating part-time teams |
| **Advanced analytics (cohort, LTV)** | Multi-site owners |
| **Granular permissions** | Manager vs front-desk separation in larger venues / collectives |

### Tier 6 — UX debt (mostly retired)

Unified booking detail, calmer calendar cards, and Dialog/Sheet primitives on operational paths are
**done**. Remaining: ~30 legacy hand-rolled modals in settings/timetable/import (Wave E), `FormField`
rollout, and mobile calendar polish at reception. Treat as **ongoing**, not a pilot gate.

---

## 7. Open strategic question — checkout & POS

Earlier planning treated chair-side payment as **permanently out of scope**. This document
**re-opens it** as a deliberate decision to make before Phase 1b payment work begins.

### 7.1 The question

When a client finishes a haircut, massage, or groom, the venue takes a final payment — usually the
service balance, often a **tip**, sometimes a retail product. Today Reserve NI handles **deposits and
full pre-payment at booking** but has **no end-of-visit payment surface**. Staff complete the visit
on an external terminal (SumUp, Zettle, bank machine) and the booking's payment state in Reserve NI
goes stale.

### 7.2 Three options

| Option | What it is | Pros | Cons |
|--------|------------|------|------|
| **A. No checkout** (status quo) | Booking tool only; external terminal handles end-of-visit | Simplest; preserves Connect-only architecture; fits chair-rental collectives | Booking payment state stays inaccurate; no tip capture; reporting incomplete; weak vs every competitor |
| **B. Checkout-lite** *(recommended to evaluate first)* | Inside the booking detail: charge outstanding **balance** via Stripe, add a **tip**, record an external/cash payment, mark paid, email a **receipt**. No retail catalogue, no inventory, no terminal hardware. | Closes the booking loop; accurate revenue + tip reporting; reuses Stripe Connect; modest build | Some overlap with external terminals; needs saved cards or a pay-link to charge balance cleanly |
| **C. Full POS** | Retail catalogue, basket, inventory decrement, Stripe Terminal / Tap-to-Pay, commission/payroll | Full Fresha/Phorest parity | Large build; competes with hardware customers already own; complicates collective setups; off-strategy |

### 7.3 Recommendation

Adopt **Option B (checkout-lite)** as a Phase 1b work item, and keep **Option C (full POS)
explicitly out of scope**. Rationale:

- Checkout-lite is mostly an extension of payment paths Reserve NI already owns (Stripe Connect,
  webhooks, the unified booking detail) — it does **not** require holding non-deposit retail funds in
  a new way, so the Connect architecture and collective compatibility are preserved.
- **Tips and accurate paid/unpaid state** are the parts customers actually miss; a retail till is not.
- It directly improves reporting (revenue, no-show recovery, tips) — today's reports under-count
  because end-of-visit payment is invisible to the platform.
- For venues that genuinely prefer their external terminal, checkout-lite still adds value via a
  **"record external payment"** action that marks the booking paid without processing the card.

**Decision needed before Phase 1b:** confirm B vs A, and confirm that retail catalogue / inventory /
terminal hardware (C) remain out of scope. The roadmap below assumes **B is approved**; if A is
chosen instead, drop P1b.4 and accept the competitive scoring in §4.

---

## 8. Roadmap

Horizon: **May 2026 → mid-2027**. Phases overlap. Legend: **Done** · **Shipped** (delivered since this
plan was drafted) · **Flagged** (shipped, default off) · **Planned** · **Open** (needs a decision).

### Phase 0 — Foundation — **substantially done**

| ID | Work | Status |
|----|------|--------|
| P0.1 | Radix Dialog/Sheet + shared primitives on operational paths | Done (Wave E legacy modals ongoing) |
| P0.2 | Unified `BookingDetailSurface` across all booking surfaces | Done |
| P0.3 | Feature flags: `waitlist_v2`, `guest_self_reschedule`, `any_available_practitioner`, `class_commerce_enabled`, `compliance_records_enabled` | Done |
| P0.4 | Playwright smoke: book → pay → confirm → guest reschedule | Done (CI gated by `RUN_E2E_SMOKE`) |
| P0.5 | Baseline metrics instrumentation + cron | Done (migration must be applied in prod) |

### Phase 1a — Reception parity — **done in engineering, pending rollout**

| ID | Work | Status |
|----|------|--------|
| P1a.1 | Any-available practitioner (public + staff) | Flagged |
| P1a.2 | Guest self-reschedule (manage link, min-notice policy) | Flagged |
| P1a.3 | Appointment waitlist v2 (join, offer, auto-offer on cancel) | Flagged |
| P1a.4 | Calendar blocks UI | Done |
| P1a.5 | Calendar card simplification (reception layout) | Done |
| P1a.6 | Deferred guest-notify on drag (Notify now / Skip / Undo) | Done |

**Rollout checklist (the real Phase 1a exit):**

1. Apply the baseline-metrics Supabase migration in production.
2. Deploy so `vercel.json` cron runs `baseline-metrics-snapshot` (Sun 03:00 UTC).
3. Enable `any_available_practitioner`, `guest_self_reschedule`, `waitlist_v2` on pilot venues.
4. Set `RUN_E2E_SMOKE=true` + E2E secrets for CI smoke on PRs.
5. Run the sales demo: any-stylist book → guest reschedule on manage link → waitlist offer on cancel.
6. Measure §9 metrics after ~30 days of flagged pilot usage.

### Phase 1b — Payment surface & checkout (Weeks 12–20, Aug–Oct 2026)

| ID | Work | Priority | Depends on |
|----|------|----------|-----------|
| P1b.1 | **Saved cards (guest account)** — SetupIntent + off-session | P1 | — |
| P1b.2 | **Late-reschedule / cancellation fee enforcement** | P1 | P1b.1 |
| P1b.3 | **Pay-balance link** (email/SMS pre-visit balance pay) | P1 | — |
| P1b.4 | **Checkout-lite** — balance + tip + record-external-payment + receipt in booking detail | P0 | §7 decision; P1b.1 |
| P1b.5 | **Appointment packages** (prepaid bundles; reuse class commerce patterns) | P1 | — |
| P1b.6 | Refund flow UX polish in the detail sheet | P2 | — |

**Exit:** the booking → pay → rebook loop is closed; reporting reflects real revenue and tips.
Retail catalogue / inventory / terminal hardware remain out of scope.

### Phase 2 — Compliance & retention (Weeks 16–30, Sep 2026–Jan 2027)

**Update (4 July 2026):** P2.1 and P2.2 shipped ahead of this roadmap. Compliance is now a delivered
module (`src/lib/compliance/`, records dashboard at `/dashboard/compliance`, expiry cron, booking-block
enforcement, and a template library covering patch tests, intake, and consent), gated by
`compliance_records_enabled`. The remaining Phase 2 items (P2.3–P2.5) are still planned.

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P2.1 | **Patch test registry** (expiry date, booking-block hook, staff alert) | **Shipped** | Delivered: compliance records + expiry cron (`src/app/api/cron/compliance-expiry`), booking-block enforcement; templates `eyebrow-patch-test.ts`, `eyelash-patch-test.ts`, `ppd-patch-test.ts` |
| P2.2 | **Consultation / intake form builder** | **Shipped** | Delivered: form-schema builder + template library (intake, consent) in `src/lib/compliance/`; GDPR capture, tablet-friendly guest fill via public form links |
| P2.3 | **Automated review requests** | P1 | Trigger on `Completed`; Google review link template |
| P2.4 | **Salon loyalty programme** | P2 | Automated earn/redeem on visit/spend; builds on the existing ledger |
| P2.5 | Before/after photo gallery on contact | P3 | Beauty + grooming visual records |

**Exit:** credible Phorest alternative for non-medical beauty; massage therapists can run health
intake; colour-focused salons are sellable.

### Phase 3 — Growth & distribution (Weeks 26–40, Nov 2026–Mar 2027)

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P3.1 | **Reserve with Google** | P1 | Completion depends on Google approval timeline |
| P3.2 | **WhatsApp notifications** | P1 | New channel in `lib/communications/`; abstraction ready |
| P3.3 | **Referral / share booking link** | **Shipped** | Delivered: referral engine (`src/lib/referrals/`), dashboard (`/dashboard/referrals`), and APIs (`src/app/api/referrals/*`); venue-led growth substitute for a marketplace |
| P3.4 | **Meta booking links** (Instagram/Facebook) | P2 | Booksy strength for barbers/beauty |
| P3.5 | **Two-way messaging inbox** | P3 | Thread per guest; opt-in SMS replies |

### Phase 4 — Segment depth & ecosystem (Weeks 32–46, Jan–Apr 2027)

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P4.1 | **Pet / animal profiles** | P1 | Breed, size, coat, temperament, vaccination — unlocks dog groomers as a first-class segment |
| P4.2 | **Gift cards / vouchers** | P2 | Stripe + ledger; redeemable against deposits/balance |
| P4.3 | **External terminal mark-paid webhook** | P3 | SumUp/Zettle — let external sales mark a booking paid |

### Phase 5 — Staff experience & scale (Weeks 40–60, Mar–Jul 2027)

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P5.1 | **Staff PWA / native app MVP** | P0 | Push: new booking, cancel, waitlist offer |
| P5.2 | **Shift roster** | P1 | Recurring shifts visible on the calendar |
| P5.3 | **Advanced analytics** | P1 | Retention, utilisation, cohort/LTV, forecasting |
| P5.4 | **Granular permissions** | P2 | Manager vs front-desk separation |
| P5.5 | **Calendar sync (Google/Outlook, read-only)** | P3 | Complements import |

### Phase 6 — Preserve & extend differentiators (ongoing)

Class commerce iteration · Linked accounts v2 (permissions matrix, network billing) · Collectives
GTM assets · Booking-engine consolidation · Partial ticket refunds (after whole-booking refund is
stable).

### 8.1 Prioritisation summary (next 6 months)

```
Impact ↑
  │  Phase 1a rollout      P1b.4 Checkout-lite     P2.1 Patch tests
  │  P1b.1 Saved cards     P1b.3 Pay-balance link  P2.2 Consultation forms
  │  P1b.5 Packages        P2.3 Review requests
  │  P3.1 Google           P3.2 WhatsApp           P4.1 Pet profiles
  └──────────────────────────────────────────────────→ Effort
```

**Ship first:** Phase 1a rollout, P1b.1, P1b.3, P1b.4, P2.1.
**Ship second:** P1b.5, P2.2, P2.3, P3.1, P3.2.
**Defer / never:** consumer marketplace, full retail POS, inventory, commission/payroll.

### 8.2 Engineering principles

- Extend Stripe/webhook paths — do not fork payment flows per model.
- Webhook idempotency on all new commerce features.
- Communications only via `lib/communications/`.
- RLS-respecting APIs for all guest data.
- Whole-booking refund default until a partial-refund spec exists.
- No payment flow that requires Reserve NI to hold non-deposit funds — preserves Stripe Connect
  architecture and collective compatibility. (Checkout-lite charges via the venue's connected
  account; it does not change this.)

---

## 9. Success metrics

### 9.1 Pilot / founding venue (qualitative)

- Owner completes first paid online booking within 48 hours of onboarding.
- Staff report phone booking is faster than paper.
- ≥ 1 venue runs two non-appointment models (class/event/resource) in production.

### 9.2 Product metrics (measure after ~30 days of flagged pilot usage)

| Metric | Target |
|--------|--------|
| Guest self-reschedule rate | ≥ 15% of eligible moves done without staff |
| Waitlist conversion | ≥ 25% of offered slots accepted |
| Any-available booking rate | Measurable share of public bookings |
| No-show rate vs baseline | Measurable ↓ for deposit-enabled venues |
| Time-to-book (staff, returning client) | Median < 45s |
| Import completion rate | ≥ 80% of migrations finish the wizard |
| Checkout-lite adoption (post P1b.4) | ≥ 50% of completed visits marked paid in-app |

### 9.3 Competitive win/loss (track loss reasons in CRM)

- "Need checkout/tips" → Phase 1b P1b.4.
- "Need patch tests" → Phase 2 P2.1 (pull-forward gate at week 12).
- "Need Fresha discovery" → Phase 3 + collective/referral story.
- "Need classes + appointments together" → **win** — lead with the differentiator.

---

## 10. Risks & dependencies

| Risk | Mitigation |
|------|------------|
| Phase 1a stuck in "done but not rolled out" | Treat the §8 rollout checklist as the real exit; assign an owner |
| Checkout/POS scope creep into full retail POS | Lock the §7 decision (Option B only) before P1b.4 starts |
| Saved-card / off-session Stripe complexity | P1b.1 first; checkout-lite can use a pay-link before saved cards land |
| Google Reserve approval timeline | Continue widget + SEO; do not block other Phase 3 work on Google |
| Patch tests treated as "nice to have" | They are a *segment gate* — without them, colour/lash/brow venues are unsellable |
| Multi-model breadth confuses salon-only buyers | Venue presets in onboarding ("Salon", "Barber", "Studio", "Groomer") |
| Stale planning docs | This document supersedes both prior versions; review again Aug 2026 |

---

## 11. Related documents

| Document | Relevance |
|----------|-----------|
| `Docs/PRD.md` | MVP scope, roadmap, architecture rules |
| `Docs/UI_EXCELLENCE_REVIEW_AND_PLAN.md` | UX/design system — parallel track |
| `Docs/Resneo_Unified_Booking_Functionality.md` | Multi-model parity, refund rules, staff booking |
| `Docs/CLASS_COMMERCE_PRODUCT_RULES.md` | Class packages — template for appointment packages |
| `Docs/reserveni-linked-accounts-spec.md` | Linked venue feature spec |
| `Docs/Appointments_Light_Plan_Information.md` | Light tier GTM |
| `Docs/FEATURE_FLAGS.md` | Phase 1a rollout flags |
| `Docs/BASELINE_METRICS.md` | Baseline metrics instrumentation |
| `Docs/E2E_SMOKE.md` | Playwright smoke setup |
| `src/lib/feature-flags/` | Flag definitions and resolution |

---

## 12. Appendix — feature parity checklist

| Feature | Reserve NI (May 2026) | Target (mid-2027) |
|---------|-----------------------|-------------------|
| Day/week/month calendar | Yes | Yes + mobile-optimised |
| Drag-reschedule | Yes | Yes |
| Guest self-reschedule | Yes (flagged) | Yes (rolled out) |
| Service variants & buffers | Yes | Yes |
| Multi-service appointment | Yes | Yes |
| Any-available practitioner | Yes (flagged) | Yes (rolled out) |
| Walk-in booking | Yes | Yes |
| Appointment waitlist | Yes (flagged) | Yes (rolled out) |
| Class timetable + roster | Yes | Yes |
| Event tickets + tiers | Yes | Yes |
| Resource booking | Yes | Yes |
| Deposits / online pay | Yes | Yes |
| End-of-visit checkout + tips | No | Checkout-lite (Phase 1b) |
| Appointment packages | No | Yes |
| Gift cards | No | Yes |
| Class credits/memberships | Yes | Yes |
| Consultation forms | No | Yes |
| Patch test tracking | No | Yes |
| Pet / animal profiles | No | Yes |
| CRM + tags + documents | Yes | Yes + photos |
| Salon loyalty (automated) | Manual ledger | Yes |
| Bulk SMS/email | Yes | Yes |
| Review requests | No | Yes |
| Guest account portal | Yes | Yes |
| iFrame widget | Yes | Yes |
| Reserve with Google | No | Yes (if approved) |
| WhatsApp | No | Yes |
| Two-way messaging inbox | No | Yes |
| Native staff app | No | PWA / native MVP |
| Reports | Yes | Yes + advanced analytics |
| CSV import | Yes | Yes |
| Linked venues / collectives | Yes | Yes v2 |
| Multi-model on one calendar | Yes | Yes — **market harder** |
| Retail POS / inventory | No | Not planned (out of scope) |
| Consumer marketplace | No | Not planned (out of scope) |

---

## Summary

Reserve NI's appointments functionality is **deep and unusually broad**, and the Tier 1 reception
gaps are now **closed in code**. The path to world-class is:

1. **Roll out Phase 1a** — turn the flags on for pilot venues and measure.
2. **Close the payment loop** — resolve the checkout question (§7), then ship saved cards, pay-balance,
   checkout-lite, and packages.
3. **Win compliance-led beauty** — patch tests and consultation forms.
4. **Ship venue-led growth** — Google, reviews, WhatsApp, referrals — without building a marketplace.
5. **Deepen target segments** — pet profiles for groomers, photo galleries for beauty.
6. **Keep winning the multi-model and NI-specific story** competitors cannot copy quickly.

*Document owner: Product. Next review: August 2026 or upon Phase 1a rollout completion.*
