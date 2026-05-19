# Reserve NI — Appointments Functionality Review & Plan

**Version:** 2.1
**Date:** 19 May 2026 (status refresh)
**Scope:** Appointment-style businesses using **appointments**, **classes**, **ticketed events**, and **bookable resources** — plus shared capabilities (CRM, payments, comms, online booking, staff tools) where they apply to both appointments and restaurants.
**Restaurant-only surfaces** (floor plan, table grid, dining waitlist, covers mode) are out of scope except where noted as shared infrastructure.
**Audience:** Product, engineering, and founding-venue GTM.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Methodology and competitor set](#2-methodology-and-competitor-set)
3. [Reserve NI positioning](#3-reserve-ni-positioning)
4. [Current state — feature inventory](#4-current-state--feature-inventory)
5. [Competitive benchmark](#5-competitive-benchmark)
6. [Strengths and differentiators](#6-strengths-and-differentiators)
7. [Gap analysis](#7-gap-analysis)
8. [World-class north star](#8-world-class-north-star)
9. [Implementation plan](#9-implementation-plan)
10. [Success metrics](#10-success-metrics)
11. [Dependencies and risks](#11-dependencies-and-risks)
12. [Related documents](#12-related-documents)
13. [Appendix — feature parity checklist](#13-appendix--feature-parity-checklist)

---

## 1. Executive summary

Reserve NI is **not a thin appointment scheduler**. It is a **multi-model booking platform** with a mature scheduling engine, unified calendar, deep service catalogue, class/event/resource managers, Stripe Connect payments, communications abstraction, CRM, import tooling, customer account portal, and rare **linked-venue** capabilities. For hybrid and multi-offering independents (salon + classes + pop-up events + room hire), Reserve NI is **already more capable in breadth** than Booksy, Fresha, or Phorest.

Against those competitors on **salon-native daily operations**, Reserve NI is **strong on scheduling mechanics and back-office depth** but **behind on reception-desk workflows and growth distribution**: appointment waitlist automation, guest self-reschedule, consultation compliance (patch tests/forms), marketing/reviews/discovery, and native staff mobile.

**Verdict:** Reserve NI can become **best-in-class for NI and UK independents who need multi-model booking with direct Stripe payouts** — but only if the next 12–18 months deliberately close **Tier 1 operational gaps** (self-service, waitlist, any-stylist) while **preserving differentiators** (classes commerce, linked accounts, import, GDPR CRM, collectives). Competing head-on with Fresha's marketplace, Phorest's full retail POS, or Booksy's marketplace acquisition without a focused wedge is the wrong strategy.

**Strategic posture — POS deliberately out of scope.** Reserve NI's target customers are independents, sole traders, and collectives. They already have working payment hardware (SumUp, Zettle, bank terminals). Many operate as chair-rental collectives where each renter handles their own payments to their own bank — integrated POS would actively complicate, not simplify, their setup. Reserve NI already collects deposits and full pre-payments via Stripe Connect on booking, which covers the no-show-protection and revenue-critical scenarios. **Chair-side retail POS is not on the roadmap.** The pitch is: *"We integrate with your existing terminal rather than replacing it — most of our customers prefer keeping retail payments separate, especially in collective setups."* See §6.2.

**Recommended strategic posture:**

| Do | Do not |
|----|--------|
| Win "one platform for appointments + classes + events + rooms" | Try to replicate Fresha Marketplace acquisition |
| Close reception-desk parity gaps first (reschedule, waitlist, any-stylist) | Build integrated retail POS / inventory / terminal |
| Lead with Stripe Connect + NI support story | Fork payments into a platform-hold model prematurely |
| Ship guest self-reschedule + smart waitlist in Q3 2026 | Spend 6 months on design-system-only work with zero workflow wins |
| Integrate with existing card terminals (SumUp/Zettle) where useful | Become a till replacement |

---

## 2. Methodology and competitor set

### 2.1 How this review was produced

| Source | Use |
|--------|-----|
| **Codebase audit** | `src/app/dashboard/`, `src/app/api/`, `src/lib/`, `src/components/booking/`, help articles |
| **Normative docs** | `Docs/PRD.md`, `ReserveNI_Unified_Booking_Functionality.md`, `CLASS_COMMERCE_PRODUCT_RULES.md`, `reserveni-linked-accounts-spec.md`, `phase3-backlog.ts` |
| **Prior analysis** | `Docs/UI_EXCELLENCE_REVIEW_AND_PLAN.md` (UX layer — referenced where it blocks adoption) |
| **Competitor public materials** | Fresha, Booksy, Phorest feature pages and pricing (May 2026) |

This document focuses on **functionality and product completeness**, not visual polish. UX improvements are noted only where they block task completion or sales demos.

### 2.2 Primary competitors

| Product | Typical buyer | Strengths Reserve NI must respect |
|---------|---------------|-----------------------------------|
| **Fresha** | Hair, beauty, wellness | Marketplace discovery, integrated POS, loyalty, shift scheduling, polished mobile, social/Google booking |
| **Booksy** | Barbers, beauty, wellness | Simple UX, strong mobile app, waitlist, deposits, social booking integrations |
| **Phorest** | Salons, clinics, med-spa | Consultation forms, patch tests, Treatcard loyalty, chair-side POS, compliance |
| **Square Appointments** | SMB services | POS + appointments unified, hardware ecosystem |
| **Vagaro / Mindbody** | Fitness + wellness | Classes + memberships at scale (Mindbody); Vagaro salon POS overlap |

**Note on POS-led competitors:** Fresha, Phorest, Square, and Vagaro lead with integrated POS. Reserve NI does not compete on this dimension by design (see §3.3, §6.2). Where this document benchmarks against those products, POS is excluded from parity targets.

### 2.3 Comparison dimensions

1. **Schedule** — calendar, availability, drag-reschedule, resources, buffers
2. **Book** — online, staff, walk-in, multi-service, any-stylist
3. **Operate** — status workflow, rosters, attendance, waitlist
4. **Get paid** — deposits, pre-payment, refunds (payment-at-time-of-booking only; retail POS excluded)
5. **Keep clients** — CRM, forms, loyalty, reviews, messaging
6. **Grow** — discovery, integrations, marketing automation
7. **Run the business** — reports, import, staff/RBAC, multi-location

---

## 3. Reserve NI positioning

### 3.1 Target customer (appointments focus)

Independent and small multi-site operators in **Northern Ireland and UK** who:

- Take **appointments** as core revenue **and/or** run **classes, ticketed events, or room/resource hire** from the same brand
- Want **direct Stripe payouts** (venue owns the customer payment relationship)
- Need **staff-usable web tools** today (tablet at reception), not necessarily a native app on day one
- Already have **working payment hardware** they don't want to replace (SumUp, Zettle, bank terminal)
- Often operate as **collectives or chair-rental arrangements** where independent payment flows are a feature, not a problem
- Value **migration** (CSV import, manual onboarding) over marketplace lock-in

### 3.2 Pricing context (Appointments SKUs)

From product docs and help (`Appointments_Light_Plan_Information.md`, `appointments.ts` help):

| Tier | Positioning |
|------|-------------|
| **Appointments Light** | Sole trader, 1 calendar, all non-restaurant models, email reminders, pay-as-you-go SMS |
| **Appointments (Plus/Pro)** | Multi-calendar, higher limits, full feature surface |
| **Restaurant** | Out of scope for this document |

Competitors often use **per-bookable-staff-member** pricing (Fresha Team) or tiered salon plans (Phorest Starter/Ultimate/Elite). Reserve NI's **multi-model inclusion on Light** is a competitive **acquisition wedge** if onboarding is fast.

### 3.3 Strategic wedge (honest)

**Reserve NI wins when the buyer says:**

> "We do appointments and classes" / "We hire rooms and run workshops" / "We're a salon that also hosts events" / "We're a collective and each renter manages their own bookings" — and Fresha/Booksy/Phorest would need 2–3 products or awkward workarounds.

**Reserve NI loses when the buyer says:**

> "We need integrated retail POS with stock control" — or "We're a regulated beauty clinic and patch tests are non-negotiable."

The first loss is **strategic and accepted** — POS-led salons are not the target customer. The plan below optimises for the wedge buyer while closing blockers for compliance-led beauty over time.

### 3.4 What "feature parity" means in this document

Where this plan refers to parity with Fresha, Booksy, or Phorest, it refers to **booking, scheduling, CRM, communications, distribution, and reception workflows** — not retail POS, inventory, terminal hardware, or commission/payroll. Reserve NI's target parity surface is the booking platform, not the till.

---

## 4. Current state — feature inventory

Maturity key: **● Complete** · **◐ Partial** · **○ Missing**

### 4.1 Appointments & unified scheduling (Model B)

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Bookable calendars (columns) | ● | `calendar-availability`, plan limits, drag reorder |
| Service catalogue (variants, buffers, colours) | ● | `appointment-services`, custom availability, staff overrides |
| Three-layer availability (venue / calendar / service) | ● | `appointment-engine.ts`, help `working-hours` |
| Public appointment booking | ● | `AppointmentBookingFlow`, practitioner slug routes |
| Staff booking + walk-in | ● | `DashboardStaffBookingModal`, walk-in API |
| Day / week / month calendar | ● | `PractitionerCalendarView` |
| Drag-reschedule + duration resize | ● | Calendar grid with undo + guest notify defer |
| Processing time blocks | ● | Per-service and per-booking layout |
| Multi-service / group appointments | ● | `group_booking_id` clustering on calendar |
| Status workflow (Booked → Confirmed → Started → Completed) | ● | Shared status system + attendance confirm |
| Deposits / full pay online (Stripe Connect) | ● | Service payment requirements, webhooks |
| Practitioner leave / days off | ● | Availability tabs, `practitioner-leave` |
| Calendar blocks (manual) | ● | Day/week grid: create, edit, delete, drag-resize via `practitioner-calendar-blocks` |
| Any-available practitioner ("book any stylist") | ● | Pooled availability + public/staff `AppointmentBookingFlow`; flag `any_available_practitioner` |
| Guest self-reschedule | ● | Manage link + `/api/confirm` modify; min-notice policy; flag `guest_self_reschedule`. **Fees on late move → P1b.1** |
| Appointment waitlist | ● | Schedule waitlist (`waitlist_v2`); separate from restaurant table waitlist |
| Native staff mobile app | ○ | Responsive web only (PRD Phase 2) |

**Primary routes:** `/dashboard/calendar`, `/dashboard/bookings`, `/dashboard/appointment-services`, `/dashboard/calendar-availability`

### 4.2 Classes (Model D)

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Class types + weekly timetable | ● | `class-timetable`, generate instances |
| Instance lifecycle (cancel, capacity override) | ● | Venue APIs + calendar blocks |
| Public class booking | ● | `ClassBookingFlow` |
| Roster / attendance / CSV export | ● | Class instance detail sheets |
| **Class commerce** (credits, courses, memberships) | ● | `CLASS_COMMERCE_PRODUCT_RULES.md`, account + venue product APIs |
| Recurring reservations (materialized) | ● | Cron + `class_recurring_reservations` |
| PDF roster | ○ | CSV acceptable per unified booking doc; PDF Phase 2 |

**Primary routes:** `/dashboard/class-timetable`, `/dashboard/class-timetable/products`

### 4.3 Events / ticketed experiences (Model C)

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Event CRUD + sessions | ● | `event-manager`, cron materialization |
| Multi-tier tickets | ● | Ticket lines at create |
| Attendee management + cancel | ● | Event APIs |
| Public event booking | ● | `EventBookingFlow` |
| Partial ticket refunds | ○ | **Locked: whole-booking refund only v1** |
| Staff alerts on new event bookings | ○ | Explicitly out of scope per unified booking doc |

**Primary route:** `/dashboard/event-manager`

### 4.4 Resources (Model E)

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Resource CRUD | ● | Venue `resources` APIs |
| Timeline + exceptions calendar | ● | `resource-timeline` |
| Public month/slot booking | ● | `ResourceBookingFlow` |
| Multi-resource single booking | ◐ | Unclear as first-class; occupancy engine exists |
| Equipment bundles | ○ | Competitor feature — not evident |

**Primary route:** `/dashboard/resource-timeline`

### 4.5 Shared operations spine

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Unified bookings list (all models) | ● | `AppointmentBookingsDashboard` + filters |
| Expandable booking detail / modify | ● | `ExpandedBookingContent`, `BookingDetailPanel` |
| Bulk SMS/email | ● | `BulkGuestMessageModal` |
| CSV export (filtered) | ● | Bookings + reports |
| Realtime + polling fallback | ● | Supabase + connection banner |
| Guest search from toolbar | ● | `OperationsToolbarGuestSearchPanel` |
| Linked venue calendars & bookings | ● | **Differentiator** — PRD §4 stale; code live |
| Venue collectives (`/book/c/{slug}`) | ● | Multi-venue public booking |

### 4.6 CRM & compliance

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Contacts list + detail | ● | `ContactsDashboard`, `ContactDetailPanel` |
| Tags, notes, custom fields | ● | Guest APIs |
| Documents (upload/sign) | ● | `ContactDocumentsSection` |
| GDPR export / erase | ● | Venue GDPR routes |
| Merge contacts | ● | Admin merge modal |
| Household linking | ● | `ContactHouseholdSection` |
| Consultation forms builder | ○ | Phorest-class gap |
| Patch test registry + expiry alerts | ○ | Phorest-class gap |
| Before/after photo gallery | ○ | Phorest-class gap |
| Loyalty points programme | ◐ | Class membership rules; **not salon-wide loyalty** |

### 4.7 Payments (booking only — POS out of scope)

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Stripe Connect onboarding | ● | Settings → Payments |
| Deposits + cancellation refunds | ● | Policy snapshot on booking |
| Full pre-payment online | ● | Service payment requirements |
| Deposit reminders (cron) | ● | `deposit-reminder-2h` |
| Appointment packages (prepaid bundles) | ◐ | Class packs exist; **not general appointment packages** |
| Saved cards (guest) | ◐ | Account portal partial; Connect per-venue complexity |
| Gift cards / vouchers | ○ | Cash-flow product (Stripe + ledger); planned Phase 4 |
| External terminal integration (SumUp / Zettle) | ○ | Optional Phase 4 — mark-paid webhook only |
| **Integrated retail POS** | **OUT OF SCOPE** | **Not on roadmap — see §6.2** |
| **Retail inventory / stock control** | **OUT OF SCOPE** | **Not on roadmap** |
| **Tap-to-Pay / Stripe Terminal hardware** | **OUT OF SCOPE** | **Not on roadmap** |
| **Commission / payroll** | **OUT OF SCOPE** | **Not on roadmap** |

### 4.8 Communications

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Email + SMS templates | ● | Communications abstraction |
| Confirmation + reminders (cron) | ● | `send-communications` |
| Per-booking staff message | ● | Booking message API |
| Confirm/cancel SMS link | ● | `/confirm/[token]` |
| Reschedule notification | ◐ | Staff drag triggers notify; guest-initiated reschedule weak |
| WhatsApp | ○ | PRD Phase 2 |
| Two-way SMS inbox | ○ | Fresha-style messaging hub |
| Review requests post-visit | ○ | All three competitors |

### 4.9 Online booking & distribution

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Hosted booking page | ● | `/book/[venue-slug]` |
| iFrame widget + postMessage | ● | `/embed/[venue-slug]` |
| Multi-tab public page (enabled models) | ● | `BookingFlowRouter` |
| Require-account-login toggle | ● | Settings |
| Customer account portal | ● | `/account/*`, v1 APIs, magic link |
| Reserve with Google | ○ | PRD — application phase |
| Facebook / Instagram booking | ○ | Booksy/Fresha |
| Consumer marketplace | ○ | Fresha/Booksy discovery — **not planned** |

### 4.10 Reports & analytics

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Booking summary by status/source | ● | `ReportsView` |
| Practitioner + service breakdown | ● | Appointment insights payload |
| Deposit collected / refunded | ● | Report 4 |
| No-show / cancellation rates | ● | Report 2/3 |
| Class commerce reports | ● | Dedicated API |
| Cohort / retention / LTV | ○ | Advanced analytics Phase 2 |
| Marketing campaign analytics | ○ | Competitor marketing suites |

### 4.11 Onboarding & migration

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Assisted onboarding (founder-led) | ● | PRD assumption |
| CSV import with AI column mapping | ● | `/dashboard/import/*` |
| 24-hour import undo | ● | Documented in help |
| Calendar sync (Google/Outlook) | ○ | Not observed — batch import only |

### 4.12 Staff & access control

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Admin vs Staff roles | ● | Venue auth |
| Staff scoped to managed calendars | ● | `getStaffManagedCalendarIds` |
| Shift roster (recurring team shifts) | ○ | Fresha shift product — RN uses availability templates |
| Granular permissions (manager, front desk) | ○ | Enterprise competitor feature |

---

## 5. Competitive benchmark

Summary scoring (1 = far behind · 5 = parity or ahead). **POS row included for context only — Reserve NI does not target parity here by design.**

| Dimension | Reserve NI | Fresha | Booksy | Phorest |
|-----------|:----------:|:------:|:------:|:-------:|
| Multi-model (appt+class+event+resource) | **5** | 2 | 2 | 2 |
| Scheduling engine depth | **4** | 4 | 4 | 4 |
| Calendar UX polish | 3 | **5** | 4 | 4 |
| Bookings list / ops | **4** | 4 | 4 | 4 |
| Online booking | 4 | **5** | **5** | 4 |
| Deposits / pre-payment / no-show protection | **4** | 4 | 4 | 4 |
| POS / chair checkout *(deliberately not targeted)* | 1 | **5** | 4 | **5** |
| CRM depth (salon) | 3 | 4 | 3 | **5** |
| Compliance (forms/patch tests) | 1 | 3 | 2 | **5** |
| Class/membership commerce | **5** | 3 | 2 | 3 |
| Waitlist (appointments) | 1 | **5** | **5** | 4 |
| Guest self-service | 2 | **5** | **5** | 4 |
| Marketing / reviews / discovery | 1 | **5** | 4 | 3 |
| Native staff mobile | 1 | **5** | **5** | **5** |
| Linked multi-venue / collectives | **5** | 2 | 1 | 2 |
| Import / migration | **5** | 3 | 3 | 3 |
| Direct Stripe Connect payouts | **5** | 3 | 3 | 3 |

**Parity target by May 2027:** All dimensions ≥ 4 except POS (remains 1 by design) and marketplace discovery (not pursued).

---

## 6. Strengths and differentiators

### 6.1 Platform strengths (defend and market)

1. **Single platform for four bookable models** — One calendar grid, one bookings list, one CRM, one comms layer. Competitors require Mindbody + something else, or ignore events/resources entirely.

2. **Class commerce depth** — Credits, course bundles, memberships, recurring materialization, entitlement precedence (`CLASS_COMMERCE_PRODUCT_RULES.md`). This exceeds typical "class list" in salon software.

3. **Linked accounts & venue collectives** — Cross-venue calendar visibility and collective booking pages are rare in SMB scheduling and suit NI networks (salon groups, shared studios, tourism collectives).

4. **Stripe Connect architecture** — Funds land in the venue account; Reserve NI never holds deposits in MVP. Strong trust story for independent owners vs opaque marketplace payouts. **Critically: this architecture works with any external card terminal**, because retail payments never need to flow through Reserve NI.

5. **Operational scheduling mechanics** — Drag-reschedule with validation, duration resize, processing buffers, group appointment stacks, undo — engineering depth many competitors hide behind simpler UI.

6. **CRM + GDPR + documents** — Merge, erase, household, signed documents — closer to clinic-grade record-keeping than Booksy's client card.

7. **Import tooling** — AI-assisted mapping lowers switching cost from spreadsheets, Fresha exports, or legacy systems.

### 6.2 Strategic non-feature: no integrated POS

Reserve NI deliberately does **not** build integrated retail POS, inventory, terminal hardware, or commission/payroll. This is a positioning choice, not a gap. Reasons:

- **Target customers already have working terminals.** Independents, sole traders, and collectives use SumUp, Zettle, or bank-supplied hardware at £15–30/month with 1.5–1.7% fees. Replacing this is a friction sale, not a value sale.
- **Collectives require independent payment flows.** Chair-rental arrangements in salons (a core NI segment) need each renter to handle payments to their own bank — integrated POS would create accounting, VAT, and money-flow complications.
- **Deposits + pre-payment already cover revenue-critical cases.** No-show protection, deposit collection, and full pre-payment for high-value services (colour, lash, classes, events) are already handled via Stripe Connect.
- **POS is a different product, not a feature.** Retail POS has its own competitors (Square, SumUp, Shopify POS, Lightspeed), hardware ecosystem, and compliance surface. Building it would require engineering capacity that strengthens Fresha's terrain, not Reserve NI's wedge.
- **The data model stays open.** No architectural decision being made in 2026–2027 closes off POS as a future option. If demand materially shifts, POS can be added in 2028+ with materially lower build cost as Stripe Terminal and Tap-to-Pay mature.

**Sales line:** *"We integrate with your existing terminal rather than replacing it — most of our customers prefer keeping retail payments separate, especially in collective setups."*

### 6.3 Brand strengths

- **NI-local support** — In-region onboarding and migration help vs offshore competitor support.
- **Founder-led** — Direct access during pilot.
- **GDPR-native** — UK/EU data handling baked in, not retrofitted.

---

## 7. Gap analysis

Gaps grouped by tier. POS removed from all tiers (see §6.2). Patch tests reframed — see Tier 2 notes.

### Tier 1 — Reception desk parity (blocks sales demos)

| Gap | Why it hurts |
|-----|--------------|
| ~~Guest self-reschedule~~ | **Addressed (P1a.2)** — flag `guest_self_reschedule`; E2E smoke on manage link |
| ~~Appointment waitlist~~ | **Addressed (P1a.3)** — flag `waitlist_v2`; rollout per venue |
| ~~Any-available practitioner~~ | **Addressed (P1a.1)** — flag `any_available_practitioner`; public + staff |
| ~~Calendar blocks UI~~ | **Addressed (P1a.4)** — practitioner calendar day/week |
| ~~Unified booking detail surface~~ | **Addressed (P0.2)** — `BookingDetailSurface` + `BookingDetailContent` |

### Tier 2 — Retention & compliance

| Gap | Why it hurts |
|-----|--------------|
| **Digital consultation forms** | Phorest wins clinics/med-spa on compliance |
| **Patch test tracking + expiry** | UK/Ireland beauty legal/insurance gate for colour, tint, lash, brow — strategic decision required (see note below) |
| **Appointment packages / prepaid bundles** | Retention + cash flow (class packs ≠ haircut packages) |
| **Automated review requests** | Cheap marketing; competitors bundle it |
| **Salon loyalty (points/tiers)** | Treatcard-class retention |

**Note on patch tests:** Patch test tracking is arguably a *segment gate*, not a retention feature — without it, Reserve NI cannot credibly sell to colour-focused salons, lash bars, or brow studios. Two options:

- **(a) Pull forward** — small build (date field, expiry calc, booking-block hook); unlocks segment in Phase 1b
- **(b) Defer** — accept that compliance-led beauty is not a launch segment; revisit in 2027

This document recommends **(a)** if Phase 1a tracks on schedule, **(b)** if it slips. Decision gate at end of Phase 1a (week 12).

### Tier 3 — Growth & distribution

| Gap | Why it hurts |
|-----|--------------|
| **Reserve with Google / Book with Google** | Discovery channel PRD already names |
| **Social booking links (Meta)** | Booksy strength |
| **Two-way client messaging inbox** | Fresha client wallet + chat |
| **WhatsApp** | PRD Phase 2; high UK/Ireland demand |
| **Review request automation** | Reputation flywheel |

### Tier 4 — Payment ecosystem (non-POS)

| Gap | Why it hurts |
|-----|--------------|
| **Gift cards / vouchers** | Cash-flow product; Stripe + ledger; not a POS feature |
| **Appointment packages** | Prepaid bundles for series treatments |
| **External terminal mark-paid webhook** | SumUp / Zettle integration so external sales can mark booking paid in Reserve NI |
| **Saved cards (guest)** | Faster repeat booking on account portal |

### Tier 5 — Scale & enterprise

| Gap | Why it hurts |
|-----|--------------|
| **Native staff iOS/Android + push** | PRD Phase 2; daily stylist workflow |
| **Shift roster vs availability templates** | Rotating part-time teams |
| **Advanced analytics (cohorts, LTV)** | Multi-site owners |
| **Granular permissions** | Manager vs front desk separation |

### Tier 6 — UX debt (enables Tier 1 adoption)

From `UI_EXCELLENCE_REVIEW_AND_PLAN.md` — not repeated in full, but functionally relevant:

- ~~Unified booking detail sheet (calendar + list + contacts)~~ — **Done (P0.2)**
- ~~Calmer calendar card hierarchy (status/actions noise)~~ — **Done (P1a.5)**
- Mobile calendar usability at reception — **ongoing** (not a Phase 0/1a exit item)
- ~~Design system primitives (Dialog/Sheet) on operational paths~~ — **Done (P0.1 Waves A–D)**; settings/legacy modals remain (Wave E)

**Recommendation (May 2026):** Tier 1 + UI Phase 0 minimal path **delivered**. Continue P0.1 Wave E opportunistically; do not block Phase 1b or pilot rollout on full modal migration.

---

## 8. World-class north star

Reserve NI is **best-in-class** for appointment businesses when:

### 8.1 The reception test (60 seconds)

A receptionist on a busy Saturday can, without training:

1. Find any client by name/phone
2. Book or move an appointment on the calendar
3. Confirm deposit status / mark appointment paid (via Stripe or external terminal)
4. Message the client
5. See the day's capacity at a glance

**Pass criteria:** ≤ 3 taps for common actions; no dead-end modals; realtime sync visible.

**Explicitly not in scope:** retail product checkout, basket, inventory decrement.

### 8.2 The guest test (under 3 minutes)

A guest on mobile can:

1. Book the service they want (any stylist if offered)
2. Pay deposit or full amount with clear policy
3. Reschedule within policy without calling
4. Receive confirmation + reminder
5. Manage booking from SMS link or account

### 8.3 The owner test (first week)

An owner migrating from Fresha can:

1. Import clients and future appointments
2. Recreate services with variants and buffers
3. Connect Stripe and take a paid booking
4. Run classes or an event from the same dashboard
5. See no-show rate and revenue in reports
6. Continue using their existing card terminal without disruption

### 8.4 The differentiated test (Reserve NI only)

A studio that runs **appointments + weekly classes + monthly ticketed events + room hire** manages all four from **one calendar and one CRM** without Zapier.

A salon collective with **independent chair-renters** each taking their own payments to their own bank uses **one booking platform** without forcing shared retail infrastructure.

---

## 9. Implementation plan

Horizon: **May 2026 → May 2027** (adjust quarterly). Phases overlap; dependencies noted.

**Implementation status (May 2026):** `Status` = engineering completeness for plan exit. `Production` = ready to enable for founding venues (code + ops). Legend: **Done** · **Partial** · **Not started** · **Flagged** (shipped behind feature flag, default off).

**Snapshot (19 May 2026):** Phase **1a engineering is complete in-repo**. Phase **0** is **5/6 items Done**; **P0.1 remains Partial** (operational modal migration complete; settings/legacy Wave E + `FormField` rollout outstanding). See [§9.5](#95-phase-0--1a--remaining-work-may-2026) for the full remaining checklist.

### Phase 0 — Foundation (Weeks 1–6, May–Jun 2026)

**Goal:** Unblock fast delivery of Tier 1 without rework. **Extended from 4 to 6 weeks** to give P0.2 realistic runway.

| ID | Work | Status | Production | Outcome / notes |
|----|------|--------|------------|-----------------|
| P0.1 | Adopt Radix Dialog/Sheet + shared `Button`/`FormField` (UI plan first sprint) | **Partial** | Yes (critical paths) | **Waves A–D done (May 2026)** — see delivery log. Operational surfaces migrated: practitioner calendar (block/resource/staff booking), appointment services + availability, class/event instance sheets, day sheet, table grid, floor plan, contacts, bookings change-table, shared `DashboardStaffBookingModal`. **Wave E remaining (~30 files):** settings (floor plan editor, tables, staff, comms templates), class timetable/schedule, event manager, import preview, areas modals, `ModifyTableBookingModal`, `AppointmentDetailSheet`, resource timeline, onboarding, super-admin, legacy booking forms. **Not migrated (intentional):** transparent dismiss layers (table-grid cell menu, booking detail backdrop, class popover dismiss). Primitives exist; **`FormField` not yet rolled out** beyond component + stories. ESLint warns on new hand-rolled `fixed inset-0` ([`eslint.config.mjs`](../eslint.config.mjs)). |
| P0.2 | Unified `BookingDetailSurface` used by calendar, list, contacts | **Done** | Yes | `BookingDetailSurface` (chrome) + `BookingDetailContent` (body) via `BookingDetailPanel` on calendar, list, contacts, floor plan |
| P0.3 | Feature flags for waitlist-v2, guest-reschedule, any-stylist | **Done** | **Flagged** | [FEATURE_FLAGS.md](./FEATURE_FLAGS.md); per-venue + env overrides |
| P0.4 | Playwright smoke: book → pay → confirm; guest self-reschedule | **Done** | Conditional | [E2E_SMOKE.md](./E2E_SMOKE.md); tests in-repo; **CI smoke requires GitHub E2E secrets** |
| P0.5 | Update PRD §4 — Linked Accounts shipped; remove POS roadmap | **Done** | Yes | PRD §3.10, §4, glossary |
| P0.6 | Baseline metrics instrumentation | **Done** | Yes (after migration) | Code + Reports UI + cron in `vercel.json` (Sun 03:00 UTC); **apply** `20260519120000_venue_baseline_metrics_snapshots.sql` on Supabase before first snapshot |

**Exit (revised May 2026):** Tier 1 reception features are **unblocked** — Waves A–D removed hand-rolled modals from daily operational paths. Full P0.1 exit (no new hand-rolled modals anywhere) awaits Wave E + `FormField` adoption; treat as **ongoing UX debt**, not a gate for Phase 1a pilots (see Summary).

**Decision rule (met):** P0.2 completed before Phase 1a feature work; no refactor-debt fallback required.

### Phase 1a — Reception parity, core (Weeks 5–12, Jun–Aug 2026)

**Goal:** Match Booksy/Fresha on daily desk workflows. **Split from original Phase 1** to isolate reception-parity work from payment surface changes.

| ID | Work | Priority | Status | Production | Notes |
|----|------|----------|--------|------------|-------|
| P1a.1 | **Any-available practitioner** | P0 | **Done** | **Flagged** | Public + staff `AppointmentBookingFlow`; pooled availability APIs; flag `any_available_practitioner` |
| P1a.2 | **Guest self-reschedule** | P0 | **Done** | **Flagged** | Min-notice + manage-link `/api/confirm` modify; flag `guest_self_reschedule`. **Fees → P1b.1** |
| P1a.3 | **Appointment waitlist** | P0 | **Done** | **Flagged** | `waitlist_v2`: join, offer/notify, auto-offer on cancel |
| P1a.4 | **Calendar blocks UI** | P1 | **Done** | Yes | Create/edit/delete on practitioner calendar (day/week); month view via availability settings |
| P1a.5 | Calendar card simplification | P1 | **Done** | Yes | `reception` default layout; compact bars prioritise time · name · status (phone dropped on short bars) |
| P1a.6 | Guest modification notify polish | P2 | **Done** | Yes | Deferred notify on calendar drag with **Notify now**, **Skip notify**, **Undo**; dismiss on detail close |

**Engineering exit (May 2026):** All P1a.1–P1a.6 items are **Done in-repo**. Tier 1 gaps in §7 are addressed in code; flags default off until pilot rollout.

**Production exit (remaining):** Enable flags on pilot venues, run pilot checklist below, validate sales demo script, refresh help articles (§9.3). Measure §10.2 metrics after baseline migration + first month of flagged usage.

**Exit:** Sales can demo "full reception day" without apologising for missing reschedule, waitlist, or any-stylist. Public conversion improves measurably.

**P1a.2 scope (locked):** Phase 1a is **done** when guests can move their appointment on the manage link within venue min-notice rules (same window as cancellation policy). Charging a fee or forfeiting a deposit on late reschedule is **not** a Phase 1a exit criterion — it ships with **P1b.1** (saved cards + off-session Stripe) so venues are not asked to collect card details twice. The §10.2 guest self-reschedule rate (≥ 15%) measures **staff-free moves**, not fee collection.

**Phase 1a pilot launch checklist**

1. Apply Supabase migration `20260519120000_venue_baseline_metrics_snapshots.sql` (if not already).
2. Deploy so `vercel.json` cron runs `baseline-metrics-snapshot` (Sundays 03:00 UTC).
3. Enable beta flags on pilot venues: `any_available_practitioner`, `guest_self_reschedule`, `waitlist_v2`.
4. Configure GitHub E2E secrets (`E2E_VENUE_SLUG`, `E2E_STRIPE_CONNECTED_ACCOUNT_ID`, …) for CI smoke on PRs.
5. Sales demo script: any-stylist book → guest reschedule on manage link → waitlist offer on cancel.
6. Re-run `node scripts/seed-e2e-smoke-venue.mjs` after pulling (enables flags + `booking_rules.cancellation_notice_hours: 1` for E2E reschedule).

**Phase 1a decision gate (week 12):** Patch tests pull-forward decision. If 1a tracks on schedule, add P2.2 (patch test registry) into Phase 1b. If 1a slipped, keep P2.2 in Phase 2.

### 9.4 May 2026 delivery log (Phase 0 + Phase 1a)

Engineering completed in-repo; production still requires migration, deploy, and per-venue flag rollout (see pilot checklist above).

| Date / sprint | ID | Deliverable |
|---------------|-----|-------------|
| May 2026 | P0.3 | Feature flags: `waitlist_v2`, `guest_self_reschedule`, `any_available_practitioner` — [FEATURE_FLAGS.md](./FEATURE_FLAGS.md) |
| May 2026 | P0.4 | Playwright: book/pay/confirm + guest self-reschedule on manage link; shared helpers; CI when secrets set; seed enables Phase 1a flags + 1h cancellation notice |
| May 2026 | P0.5 | PRD §3.10 Linked Accounts; POS removed from roadmap |
| May 2026 | P0.6 | `venue_baseline_metrics_snapshots` migration; compute/capture lib; Reports card; cron `baseline-metrics-snapshot` in `vercel.json` (Sun 03:00 UTC) — [BASELINE_METRICS.md](./BASELINE_METRICS.md) |
| May 2026 | P0.1 Wave A | Radix `Dialog` / `ConfirmDialog` on staff booking modal, walk-in, bookings confirm, calendar block/resource modals |
| May 2026 | P0.1 Wave B | `Dialog`/`Sheet` on appointment services, staff service override, availability team + upgrade, bookable-calendars delete, class/event instance detail sheets; ESLint guardrail for hand-rolled overlays |
| May 2026 | P0.1 Wave C | Day sheet + table grid operational modals; shared `DashboardStaffBookingModal` shell; `TimelineGrid` confirm |
| May 2026 | P0.1 Wave D | Contacts merge/erase/toolbar detail; `BookingsDashboard` change table; floor plan confirm + reschedule + unassigned sheet + block table modal |
| May 2026 | P0.2 | `BookingDetailSurface` + `BookingDetailContent` unified detail on all booking surfaces |
| May 2026 | P1a.1 | Any-available practitioner pooling (`appointment-any-practitioner.ts`); public + staff flow; create resolves real `practitioner_id` |
| May 2026 | P1a.2 | Guest self-reschedule on manage link; min-notice via `guest-appointment-modify-policy.ts`; fees deferred to P1b.1 |
| May 2026 | P1a.3 | Appointment waitlist v2: join, staff offer/notify, auto-offer on cancel, `waitlist_converted` events |
| May 2026 | P1a.4 | Calendar blocks UI on practitioner calendar (day/week) |
| May 2026 | P1a.5 | `BookingCard` reception layout; compact bars drop phone on short bars |
| May 2026 | P1a.6 | Calendar drag: deferred guest notify with Notify now / Skip notify / Undo; dismiss when detail closes |

**Code map (quick reference):**

| Area | Path |
|------|------|
| UI primitives | `src/components/ui/primitives/` (`Dialog`, `Sheet`, `ConfirmDialog`, `Button`, `FormField`) |
| Flags | `src/lib/feature-flags/` |
| Any-available | `src/lib/availability/appointment-any-practitioner.ts`, `AppointmentBookingFlow.tsx` |
| Guest modify | `src/lib/booking/guest-appointment-modify-policy.ts`, `src/app/api/confirm/route.ts`, `ManageBookingView.tsx` |
| Waitlist v2 | `src/lib/booking/offer-appointment-waitlist-on-cancel.ts`, `src/app/api/booking/appointment-waitlist/` |
| Baselines | `src/lib/metrics/`, `src/app/api/cron/baseline-metrics-snapshot/` |
| E2E | `e2e/`, `Docs/E2E_SMOKE.md` |
| P0.1 Wave C/D | `DaySheetView`, `TableGridView`, `TimelineGrid`, `DashboardStaffBookingModal`, `FloorPlanLiveView`, `MergeContactsModal`, `EraseGuestDataModal`, `ToolbarContactDetailModal`, `BookingsDashboard` |

### 9.5 Phase 0 & 1a — remaining work (May 2026)

#### Phase 0 — what is still to do

| ID | Remaining | Owner | Blocks pilots? |
|----|-----------|-------|----------------|
| **P0.1** | **Wave E:** migrate ~30 remaining hand-rolled overlays (settings, class timetable, import, areas, legacy booking modals, super-admin, onboarding). Roll out **`FormField`** on high-traffic forms. | Eng | **No** — operational paths (Waves A–D) are migrated |
| **P0.4** | Configure GitHub **E2E secrets** so Playwright smoke runs on PRs | Eng / DevOps | **No** — tests runnable locally; CI optional for pilots |
| **P0.6** | **Apply** baseline metrics migration on production Supabase; verify Sunday cron captures first snapshot | Eng / Ops | **Yes** for §10.2 baseline comparison — not for feature demos |

**Phase 0 items with no engineering work left:** P0.2, P0.3, P0.5.

#### Phase 1a — what is still to do

| Category | Action | Owner | Notes |
|----------|--------|-------|-------|
| **Database** | Apply `20260519120000_venue_baseline_metrics_snapshots.sql` if not already | Eng / Ops | Shared with P0.6 |
| **Deploy** | Deploy app so `vercel.json` cron runs `baseline-metrics-snapshot` (Sun 03:00 UTC) | Eng / Ops | |
| **Feature flags** | Enable on pilot venues: `any_available_practitioner`, `guest_self_reschedule`, `waitlist_v2` | Product / CS | Per [FEATURE_FLAGS.md](./FEATURE_FLAGS.md) |
| **E2E** | Configure `E2E_VENUE_SLUG`, `E2E_STRIPE_CONNECTED_ACCOUNT_ID`, etc. | Eng | See [E2E_SMOKE.md](./E2E_SMOKE.md) |
| **Seed** | Re-run `node scripts/seed-e2e-smoke-venue.mjs` after pull (flags + 1h cancellation notice for reschedule E2E) | Eng | |
| **GTM** | Run sales demo: any-stylist book → guest reschedule on manage link → waitlist offer on cancel | GTM | Pilot checklist §Phase 1a |
| **Docs** | Refresh help articles when flags go live (§9.3) | Product + eng | |
| **Metrics** | Start measuring §10.2 targets after ~30 days of flagged pilot usage | Product | Reschedule rate, waitlist conversion, any-stylist rate |

**Phase 1a items with no engineering work left:** P1a.1–P1a.6 (all **Done** in-repo).

**Explicitly not Phase 1a:** late reschedule **fees** (P1b.1), pay-balance link, appointment packages, patch tests (week-12 gate → P1b.5 or P2.2).

### Phase 1b — Payment surface polish (Weeks 12–18, Aug–Oct 2026)

**Goal:** Tighten payment-at-booking experience without expanding into POS.

| ID | Work | Priority | Status | Production | Notes |
|----|------|----------|--------|------------|-------|
| P1b.1 | **Saved cards (guest account)** | P1 | **Not started** | No | SetupIntent + off-session for cancellation / late reschedule fees (extends P1a.2) |
| P1b.2 | **Pay-balance link on booking** | P1 | **Not started** | No | Email/SMS pre-visit balance pay |
| P1b.3 | **Appointment packages (prepaid bundles)** | P1 | **Not started** | No | Reuse class commerce patterns |
| P1b.4 | Refund flow UX polish | P2 | **Not started** | No | Whole-booking refund clarity in detail sheet |
| P1b.5 | **(Conditional) Patch test registry** | P1 | **Not started** | No | Week-12 gate: pull from Phase 2 if 1a on track |

**Exit:** Payment-at-booking story is complete. No chair-side terminal or retail catalogue work — those remain out of scope.

### Phase 2 — Compliance & retention (Weeks 16–28, Sep–Dec 2026)

**Goal:** Win compliance-led beauty segments (lash, brow, colour-focused) — unless patch tests were already pulled into Phase 1b.

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P2.1 | **Consultation form builder** | P1 | GDPR capture, link to service, tablet-friendly guest fill |
| P2.2 | **Patch test registry** | P1 | If not already shipped in Phase 1b — expiry date, block booking if expired, staff alert |
| P2.3 | **Review request automation** | P1 | Trigger on Completed; Google review link template |
| P2.4 | **Salon loyalty programme** | P2 | Points on visit; separate from class membership |
| P2.5 | Treatment photo gallery on contact | P3 | Before/after on guest profile |

**Exit:** Credible Phorest alternative for **non-med** beauty; clinic pitch with forms + patch tests.

### Phase 3 — Growth & distribution (Weeks 24–36, Nov 2026–Feb 2027)

**Goal:** Reduce dependency on venue's own marketing only.

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P3.1 | **Reserve with Google** | P1 | PRD already scoped; completion depends on Google approval |
| P3.2 | **WhatsApp notifications** | P1 | PRD Phase 2; abstraction layer ready; high UK/Ireland demand |
| P3.3 | **Meta booking integration** | P2 | Instagram/Facebook appointment links |
| P3.4 | **Two-way messaging inbox** | P2 | Thread per guest; opt-in SMS replies |
| P3.5 | **Referral / share booking link** | P2 | Venue-led growth substitute for marketplace |

**Exit:** GTM can answer "how do clients find us?" without Fresha Marketplace.

### Phase 4 — Payment ecosystem (Weeks 28–36, Dec 2026–Feb 2027)

**Goal:** Make Reserve NI work alongside existing payment hardware rather than replace it. **Explicitly not POS.**

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P4.1 | **Gift cards / vouchers** | P1 | Stripe + ledger; cash-flow product; redeemable against deposits/balance |
| P4.2 | **External terminal mark-paid webhook** | P2 | SumUp / Zettle integrations so external retail/balance sales can mark booking paid |
| P4.3 | **Receipt/payment notes on booking detail** | P3 | Free-text "paid £45 in salon via terminal" |

**Explicitly out of scope:** retail inventory, integrated terminal hardware, basket UI, stock decrement, commission/payroll, end-of-day reconciliation, Stripe Terminal / Tap-to-Pay. See §6.2.

**Exit:** Reserve NI cleanly complements an external till without trying to be one.

### Phase 5 — Staff experience & scale (Weeks 32–52, Feb–May 2027)

**Goal:** Bring forward from original Phase 5 — engineering capacity reallocated from cancelled POS phase.

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P5.1 | **Staff PWA or native app MVP** | P0 | Push: new booking, cancel, waitlist offer — **promoted from P1** with capacity freed by no-POS decision |
| P5.2 | **Shift roster** | P1 | Recurring shifts visible on calendar |
| P5.3 | **Advanced analytics** | P1 | Retention, practitioner utilisation, forecast, cohort/LTV |
| P5.4 | **Granular permissions (manager, front desk)** | P2 | Larger venue / collective admin needs |
| P5.5 | **Multi-venue admin dashboard** | P2 | PRD Phase 3 theme |
| P5.6 | **Calendar sync (Google/Outlook read-only)** | P3 | Complement import |

### Phase 6 — Preserve & extend differentiators (ongoing)

| ID | Work | Notes |
|----|------|-------|
| P6.1 | Class commerce iteration | Membership rules, recurring UX polish |
| P6.2 | Linked accounts v2 | Permissions matrix, billing for networks |
| P6.3 | Collectives marketing | `/book/c/{slug}` GTM assets |
| P6.4 | Unified booking engine consolidation | Reduce `BookingFlowRouter` split per primary model |
| P6.5 | Partial ticket refunds (events) | Separate spec — only after whole-booking stable |

### 9.1 Prioritisation matrix (first 6 months)

```
Impact ↑
  │  P1a.1 Any-stylist   P1a.2 Reschedule   P1a.3 Waitlist
  │  P0.2 Unified detail  P0.6 Baselines
  │  P1b.3 Packages       P2.1 Forms        P2.2 Patch tests
  │  P3.1 Google          P3.2 WhatsApp     P5.1 Staff PWA
  │                       P4.1 Gift cards
  └────────────────────────────────────────→ Effort
```

**Ship first:** P0.2, P1a.1, P1a.2, P1a.3, P1a.4
**Ship second:** P1b.1–P1b.3, P2.1, P2.2, P2.3
**Defer:** marketplace, anything POS-shaped (permanent)

### 9.2 Engineering principles (carry forward)

From `.cursor/rules` and unified booking doc:

- Extend Stripe/webhook paths — do not fork payment flows per model
- Webhook idempotency on all new commerce features
- Communications only via `lib/communications/`
- RLS-respecting APIs for all guest data
- Whole-booking refund default until partial spec exists
- **No payment flow that requires Reserve NI to hold non-deposit retail funds** — preserves Stripe Connect architecture and collective compatibility

### 9.3 Documentation & GTM sync

| Action | Owner |
|--------|-------|
| Refresh PRD Phase 2 list with this plan's Tier 1/2 | Product |
| Remove POS references from PRD and help articles | Product |
| Update help articles when P1a ships | Product + eng |
| Competitive battlecard: Reserve NI vs Fresha vs Phorest — lead with multi-model + collective-friendly payments | GTM |
| Appointments Light landing — emphasise multi-model + import + "works with your terminal" | Marketing |
| Sales objection handler: "no integrated POS" — script the §6.2 pitch | GTM |

---

## 10. Success metrics

### 10.1 Pilot / founding venue (qualitative)

- Owner completes first paid online booking within 48 hours of onboarding
- Staff report phone booking is **faster than paper** (PRD §2.2)
- ≥ 1 venue runs **two non-appointment models** (class/event/resource) in production
- ≥ 1 collective venue operates with **independent chair-renter payment flows** using Reserve NI for booking only

### 10.2 Product metrics (6 months post Phase 1a)

Baseline captured in P0.6.

| Metric | Target | Baseline source |
|--------|--------|-----------------|
| Guest self-reschedule rate | ≥ 15% of eligible moves without staff (fee collection not required) | P0.6 baseline: current email-rescheduling rate |
| Waitlist conversion | ≥ 25% of offered slots accepted | New metric — measured from launch |
| Any-stylist selection rate (public booking) | ≥ 30% of new bookings | New metric — measured from launch |
| No-show rate vs baseline | Measurable ↓ for deposit-enabled venues | P0.6 baseline |
| Time-to-book (staff) | Median < 45s for returning client | P0.6 baseline |
| Import completion rate | ≥ 80% of migrations finish wizard | Current funnel |

### 10.3 Competitive win/loss tracking (sales)

Track loss reasons in CRM:

- "Need integrated retail POS" → **document as expected loss, do not chase**
- "Need patch tests" → Phase 1b or Phase 2.2 timeline depending on week-12 gate
- "Need Fresha discovery" → Phase 3 + collective/referral story
- "Need classes + appointments" → **win** — lead with differentiator
- "Need collective-friendly payments" → **win** — lead with §6.2 pitch

If "Need POS" exceeds **20% of losses for two consecutive quarters**, revisit §6.2 in 2027 strategic review. Until then, treat as deliberate non-target.

---

## 11. Dependencies and risks

| Risk | Mitigation |
|------|------------|
| ~~Phase 1a delayed by P0.2~~ | **Resolved (May 2026)** — `BookingDetailSurface` shipped before 1a features |
| Stripe Connect saved-card complexity (P1b.1) | Use SetupIntent off-session pattern; isolated to Phase 1b, doesn't block 1a |
| Late reschedule fees deferred from P1a.2 | P1a.2 ships notice + self-serve only; fee/forfeit logic bundled with P1b.1 saved cards |
| Google Reserve approval timeline | Continue widget + SEO; don't block P3 on Google |
| Scope creep into POS | §6.2 is a hard line — Phase 4 has explicit out-of-scope list; product review gates any "small" POS addition |
| Multi-model complexity confuses salon-only buyers | **Venue presets** in onboarding: "Salon", "Studio", "Collective", "Hybrid" nav |
| PRD stale vs code (Linked Accounts) | Addressed in P0.5 (PRD §3.10) |
| Patch test pull-forward overcommits Phase 1b | Week-12 decision gate — explicit go/no-go, not optional |
| "No POS" pitch fails in market | Track in 10.3; revisit only if losses exceed 20% threshold |

---

## 12. Related documents

| Document | Relevance |
|----------|-----------|
| `Docs/PRD.md` | MVP scope, Phase 2/3 roadmap, architecture rules — **P0.5: Linked Accounts shipped (§3.10); POS roadmap removed** |
| `Docs/UI_EXCELLENCE_REVIEW_AND_PLAN.md` | UX/design system — parallel track to this plan |
| `Docs/ReserveNI_Unified_Booking_Functionality.md` | Multi-model parity, refund rules, staff booking |
| `Docs/CLASS_COMMERCE_PRODUCT_RULES.md` | Class packages — template for appointment packages |
| `Docs/reserveni-linked-accounts-spec.md` | Linked venue feature spec |
| `Docs/Appointments_Light_Plan_Information.md` | Light tier GTM |
| `Docs/ACCOUNT_MVP_GAP_REPORT.md` | Customer portal status |
| `src/lib/planning/phase3-backlog.ts` | Engineering backlog seed |
| `src/lib/help/articles/appointments.ts` | User-facing capability reference |

---

## 13. Appendix — feature parity checklist

Use for quarterly reviews. **Target column:** May 2027 world-class goal.

| Feature | Reserve NI May 2026 | Target May 2027 |
|---------|---------------------|-----------------|
| Day/week/month calendar | Yes | Yes + mobile-optimised |
| Drag-reschedule | Yes | Yes + guest self-serve |
| Service variants & buffers | Yes | Yes |
| Multi-service appointment | Yes | Yes |
| Any-available stylist | No | Yes |
| Walk-in booking | Yes | Yes |
| Class timetable + roster | Yes | Yes + PDF roster optional |
| Event tickets + tiers | Yes | Yes |
| Resource booking | Yes | Yes |
| Deposits / online pay | Yes | Yes |
| Full pre-payment | Yes | Yes |
| Pay-balance link (pre-visit) | No | Yes |
| **Chair-side retail POS** | **No** | **No — strategic non-feature** |
| **Retail inventory** | **No** | **No — strategic non-feature** |
| **Integrated terminal hardware** | **No** | **No — strategic non-feature** |
| **Commission / payroll** | **No** | **No — strategic non-feature** |
| External terminal mark-paid webhook | No | Yes (SumUp / Zettle) |
| Tips on online payment | No | Yes |
| Gift cards | No | Yes |
| Appointment packages | No | Yes |
| Class credits/memberships | Yes | Yes |
| Appointment waitlist | No | Yes |
| Table waitlist | Yes (restaurant) | Unchanged |
| Consultation forms | No | Yes |
| Patch tests | No | Yes |
| CRM + tags + documents | Yes | Yes + photos |
| Loyalty points | No | Yes |
| Bulk SMS/email | Yes | Yes |
| Review requests | No | Yes |
| Guest account portal | Yes | Yes + reschedule + saved cards |
| iFrame widget | Yes | Yes |
| Google booking | No | Yes (if approved) |
| Social booking | No | Partial |
| WhatsApp | No | Yes |
| Native staff app | No | PWA or native MVP |
| Reports | Yes | Yes + advanced (cohort/LTV) |
| CSV import | Yes | Yes |
| Linked venues / collectives | Yes | Yes v2 |
| Multi-model one calendar | Yes | Yes — **market harder** |
| Collective-friendly payment architecture | Yes | Yes — **market explicitly** |

---

## Summary

Reserve NI's appointments functionality is **already deep and unusually broad**. The path to **world-class** is not "add what Fresha has, feature by feature" — it is:

1. **Close the reception loop** (any-stylist, reschedule, waitlist) — Phase 1a
2. **Tighten the payment-at-booking experience** without expanding into POS — Phase 1b
3. **Win compliance-led beauty** (forms, patch tests) — Phase 2 (or Phase 1b conditionally)
4. **Ship growth channels** (Google, WhatsApp, reviews) without building a marketplace — Phase 3
5. **Complement existing card terminals** rather than replace them — Phase 4
6. **Free engineering capacity from the no-POS decision** for staff app, analytics, and roster — Phase 5
7. **Keep winning multi-model, collective, and NI-specific stories** competitors cannot copy quickly — Phase 6

**POS is deliberately not on this roadmap.** Reserve NI's target customers (independents, sole traders, collectives) have working payment hardware and structural reasons to keep retail flows separate from booking. The data model stays open for POS in 2028+ if demand materially shifts; until then, integrate, don't replace.

**Phase 0 (May 2026):** **5/6 Done** — P0.2–P0.6 complete; **P0.1 Partial** (Waves A–D on operational surfaces; Wave E + `FormField` rollout remain). Ops: apply baseline migration; optional E2E CI secrets.

**Phase 1a (May 2026):** **6/6 Done in engineering** — any-stylist, guest reschedule, waitlist v2, calendar blocks, card simplification, modification notify. **Production rollout** remains: pilot checklist (flags, deploy, demo, help articles, metrics).

**Next product slice:** **Phase 1b** (saved cards, pay-balance, packages). Treat P0.1 Wave E as **ongoing UX debt**, not a gate for pilots. Revisit in **August 2026** for the week-12 patch-test gate (P1b.5 vs P2.2).

---

*Document owner: Product. Last updated: 19 May 2026 (v2.1 — Phase 0/1a status refresh). Next review: August 2026.*
