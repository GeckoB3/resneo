# Reserve NI — Appointments Functionality Review & Plan

**Version:** 1.0  
**Date:** 19 May 2026  
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

Against those competitors on **salon-native daily operations**, Reserve NI is **strong on scheduling mechanics and back-office depth** but **behind on the closed-loop commerce and growth stack**: chair-side POS/checkout, appointment waitlist automation, guest self-reschedule, consultation compliance (patch tests/forms), marketing/reviews/discovery, native staff mobile, and packaged retail/loyalty.

**Verdict:** Reserve NI can become **best-in-class for NI and UK independents who need multi-model booking with direct Stripe payouts** — but only if the next 12–18 months deliberately close **Tier 1 operational gaps** (self-service, waitlist, checkout) while **preserving differentiators** (classes commerce, linked accounts, import, GDPR CRM). Competing head-on with Fresha’s marketplace or Phorest’s full POS without a focused wedge is the wrong strategy.

**Recommended strategic posture:**

| Do | Do not (yet) |
|----|----------------|
| Win “one platform for appointments + classes + events + rooms” | Try to replicate Fresha Marketplace acquisition |
| Close reception-desk parity gaps first | Build full retail inventory POS before appointment checkout works |
| Lead with Stripe Connect + NI support story | Fork payments into a platform-hold model prematurely |
| Ship guest self-reschedule + smart waitlist in Q3–Q4 2026 | Spend 6 months on design-system-only work with zero workflow wins |

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

### 2.3 Comparison dimensions

1. **Schedule** — calendar, availability, drag-reschedule, resources, buffers  
2. **Book** — online, staff, walk-in, multi-service, any-stylist  
3. **Operate** — status workflow, rosters, attendance, waitlist  
4. **Get paid** — deposits, checkout, tips, packages, refunds  
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
- Value **migration** (CSV import, manual onboarding) over marketplace lock-in  

### 3.2 Pricing context (Appointments SKUs)

From product docs and help (`Appointments_Light_Plan_Information.md`, `appointments.ts` help):

| Tier | Positioning |
|------|-------------|
| **Appointments Light** | Sole trader, 1 calendar, all non-restaurant models, email reminders, pay-as-you-go SMS |
| **Appointments (Plus/Pro)** | Multi-calendar, higher limits, full feature surface |
| **Restaurant** | Out of scope for this document |

Competitors often use **per-bookable-staff-member** pricing (Fresha Team) or tiered salon plans (Phorest Starter/Ultimate/Elite). Reserve NI’s **multi-model inclusion on Light** is a competitive **acquisition wedge** if onboarding is fast.

### 3.3 Strategic wedge (honest)

**Reserve NI wins when the buyer says:**

> “We do appointments and classes” / “We hire rooms and run workshops” / “We’re a salon that also hosts events” — and Fresha/Booksy/Phorest would need 2–3 products or awkward workarounds.

**Reserve NI loses when the buyer says:**

> “We need a card machine at the chair, Google Bookings, and Fresha’s client discovery” — or “We’re a regulated beauty clinic and patch tests are non-negotiable.”

The plan below optimises for the first buyer while closing blockers for the second over time.

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
| Calendar blocks (manual) | ◐ | API exists; **blocks UI called out in backlog** |
| Any-available practitioner (“book any stylist”) | ◐ | **Backlog** — public flow often column-locked |
| Guest self-reschedule | ◐ | Cancel/manage token exists; **reschedule backlog** |
| Appointment waitlist | ◐ | **Restaurant waitlist only** — not schedule waitlist |
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

### 4.7 Payments & commerce

| Capability | Status | Evidence / notes |
|------------|--------|------------------|
| Stripe Connect onboarding | ● | Settings → Payments |
| Deposits + cancellation refunds | ● | Policy snapshot on booking |
| Deposit reminders (cron) | ● | `deposit-reminder-2h` |
| **Checkout at appointment** (balance, tips, retail) | ○ | Competitor core — **missing** |
| Gift cards / vouchers | ○ | Fresha/Phorest |
| Appointment packages (prepaid bundles) | ◐ | Class packs exist; **not general appointment packages** |
| Saved cards (guest) | ◐ | Account portal partial; Connect per-venue complexity |
| Commission / payroll | ○ | Fresha POS feature |

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
| Consumer marketplace | ○ | Fresha/Booksy discovery |

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

Summary scoring (1 = far behind · 5 = parity or ahead):

| Dimension | Reserve NI | Fresha | Booksy | Phorest |
|-----------|:----------:|:------:|:------:|:-------:|
| Multi-model (appt+class+event+resource) | **5** | 2 | 2 | 2 |
| Scheduling engine depth | **4** | 4 | 4 | 4 |
| Calendar UX polish | 3 | **5** | 4 | 4 |
| Bookings list / ops | **4** | 4 | 4 | 4 |
| Online booking | 4 | **5** | **5** | 4 |
| Deposits / no-show protection | **4** | 4 | 4 | 4 |
| POS / chair checkout | 1 | **5** | 4 | **5** |
| CRM depth (salon) | 3 | 4 | 3 | **5** |
| Compliance (forms/patch tests) | 1 | 3 | 2 | **5** |
| Class/membership commerce | **5** | 3 | 2 | 3 |
| Waitlist (appointments) | 1 | **5** | **5** | 4 |
| Guest self-service | 2 | **5** | **5** | 4 |
| Marketing / reviews / discovery | 1 | **5** | 4 | 3 |
| Native staff mobile | 1 | **5** | **5** | **5** |
| Linked multi-venue | **5** | 2 | 1 | 2 |
| Import / migration | **5** | 3 | 3 | 3 |
| Direct Stripe Connect payouts | **5** | 3 | 3 | 3 |

---

## 6. Strengths and differentiators

### 6.1 Platform strengths (defend and market)

1. **Single platform for four bookable models** — One calendar grid, one bookings list, one CRM, one comms layer. Competitors require Mindbody + something else, or ignore events/resources entirely.

2. **Class commerce depth** — Credits, course bundles, memberships, recurring materialization, entitlement precedence (`CLASS_COMMERCE_PRODUCT_RULES.md`). This exceeds typical “class list” in salon software.

3. **Linked accounts & venue collectives** — Cross-venue calendar visibility and collective booking pages are rare in SMB scheduling and suit NI networks (salon groups, shared studios, tourism collectives).

4. **Stripe Connect architecture** — Funds land in the venue account; Reserve NI never holds deposits in MVP. Strong trust story for independent owners vs opaque marketplace payouts.

5. **Operational scheduling mechanics** — Drag-reschedule with validation, duration resize, processing buffers, group appointment stacks, undo — engineering depth many competitors hide behind simpler UI.

6. **CRM + GDPR + documents** — Merge, erase, household, signed documents — closer to clinic-grade record-keeping than Booksy’s client card.

7. **Import tooling** — AI-assisted mapping lowers switching cost from spreadsheets, Fresha exports, or legacy systems.

8. **Immutable events log** — Foundation for trustworthy reporting and future analytics (PRD §5.3).

### 6.2 Where “more features” is the wrong goal

Competitors win deals with **fewer visible features** that are **perfectly integrated**:

- Book → remind → show up → checkout → rebook → review  

Reserve NI’s risk is **breadth without a closed loop**. The plan prioritises **loop completion** over new models.

---

## 7. Gap analysis

Gaps ordered by **revenue impact × competitive frequency in sales conversations**.

### Tier 1 — Blockers for “salon-ready” (must ship)

| Gap | Why it hurts | Current state |
|-----|--------------|---------------|
| **Guest self-reschedule** | #1 reception time saver; Fresha/Booksy default | Cancel token yes; reschedule in `phase3-backlog.ts` |
| **Appointment waitlist + auto-fill** | Revenue recovery on cancellations | Waitlist is table-only |
| **Checkout / payment completion in booking** | “Close the ticket” at chair without second system | Deposits only; no balance/tip/receipt flow |
| **Any-available practitioner** | “First available stylist” booking | Column-locked public flows; backlog item |
| **Calendar blocks UI** | Staff block time without support ticket | API exists, UI backlog |

### Tier 2 — Win regulated beauty & retention

| Gap | Why it hurts |
|-----|--------------|
| **Digital consultation forms** | Phorest wins clinics/med-spa on compliance |
| **Patch test tracking + expiry** | UK/Ireland beauty legal expectation |
| **Appointment packages / prepaid bundles** | Retention + cash flow (class packs ≠ haircut packages) |
| **Automated review requests** | Cheap marketing; competitors bundle it |
| **Salon loyalty (points/tiers)** | Treatcard-class retention |

### Tier 3 — Growth & distribution

| Gap | Why it hurts |
|-----|--------------|
| **Reserve with Google / Book with Google** | Discovery channel PRD already names |
| **Social booking links (Meta)** | Booksy strength |
| **Two-way client messaging inbox** | Fresha client wallet + chat |
| **WhatsApp** | PRD Phase 2; high UK/Ireland demand |

### Tier 4 — Scale & enterprise salon

| Gap | Why it hurts |
|-----|--------------|
| **Native staff iOS/Android + push** | PRD Phase 2; daily stylist workflow |
| **Integrated POS + retail inventory** | Full Fresha/Phorest parity |
| **Commission / payroll** | Larger salons |
| **Shift roster vs availability templates** | Rotating part-time teams |
| **Advanced analytics (cohorts, LTV)** | Multi-site owners |

### Tier 5 — UX debt (enables Tier 1 adoption)

From `UI_EXCELLENCE_REVIEW_AND_PLAN.md` — not repeated in full, but functionally relevant:

- Unified booking detail sheet (calendar + list + contacts)  
- Calmer calendar card hierarchy (status/actions noise)  
- Mobile calendar usability at reception  
- Design system primitives (Dialog/Sheet) to ship Tier 1 features faster  

**Recommendation:** Run **Tier 1 features** and **UI Phase 1 minimal (Dialog/Sheet)** in parallel — not UI-only for a quarter.

---

## 8. World-class north star

Reserve NI is **best-in-class** for appointment businesses when:

### 8.1 The reception test (60 seconds)

A receptionist on a busy Saturday can, without training:

1. Find any client by name/phone  
2. Book or move an appointment on the calendar  
3. Take payment or confirm deposit status  
4. Message the client  
5. See the day’s capacity at a glance  

**Pass criteria:** ≤ 3 taps for common actions; no dead-end modals; realtime sync visible.

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

### 8.4 The differentiated test (Reserve NI only)

A studio that runs **appointments + weekly classes + monthly ticketed events + room hire** manages all four from **one calendar and one CRM** without Zapier.

---

## 9. Implementation plan

Horizon: **May 2026 → May 2027** (adjust quarterly). Phases overlap; dependencies noted.

### Phase 0 — Foundation (Weeks 1–4, May–Jun 2026)

**Goal:** Unblock fast delivery of Tier 1 without rework.

| ID | Work | Outcome |
|----|------|---------|
| P0.1 | Adopt Radix Dialog/Sheet + shared `Button`/`FormField` (UI plan first sprint) | New features use one modal pattern |
| P0.2 | Unified `BookingDetailSurface` component used by calendar, list, contacts | One detail UX |
| P0.3 | Feature flags for waitlist-v2, guest-reschedule, checkout-lite | Safe rollout |
| P0.4 | Playwright smoke tests: public book → pay → confirm link | Regression safety |
| P0.5 | Update PRD §4 — mark Linked Accounts as shipped | Sales/docs accuracy |

**Exit:** Tier 1 epics can start without new hand-rolled modals.

### Phase 1 — Reception parity (Weeks 5–16, Jun–Sep 2026)

**Goal:** Match Booksy/Fresha on daily desk workflows.

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P1.1 | **Guest self-reschedule** | P0 | Policy-aware (min notice, fees); extend `/api/confirm` or account APIs; public + SMS link |
| P1.2 | **Appointment waitlist** | P0 | New model or extend waitlist for schedule slots; offer on cancel; staff accept flow |
| P1.3 | **Any-available practitioner** | P1 | Catalog + availability API pooling (`phase3-backlog.ts`); public + staff booking |
| P1.4 | **Calendar blocks UI** | P1 | Wire `practitioner-calendar-blocks` to calendar grid |
| P1.5 | **Checkout-lite in booking detail** | P0 | Mark paid, charge balance via Stripe, tip field, email receipt — not full POS |
| P1.6 | Calendar card simplification | P1 | `BookingCard` density (UI plan §3.1) |
| P1.7 | Guest modification notify polish | P2 | After drag-reschedule — already partial |

**Exit:** Sales can demo “full reception day” without apologising for missing reschedule/waitlist.

### Phase 2 — Salon retention & compliance (Weeks 12–24, Aug–Nov 2026)

**Goal:** Win beauty/clinic segments Phorest owns.

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P2.1 | **Consultation form builder** | P1 | GDPR capture, link to service, tablet-friendly guest fill |
| P2.2 | **Patch test registry** | P1 | Expiry date, block booking if expired, staff alert |
| P2.3 | **Appointment packages** | P1 | Prepaid session bundles (reuse class commerce patterns) |
| P2.4 | **Review request automation** | P2 | Trigger on Completed; Google review link template |
| P2.5 | **Salon loyalty programme** | P2 | Points on visit; separate from class membership |
| P2.6 | Treatment photo gallery on contact | P3 | Before/after on guest profile |

**Exit:** Credible Phorest alternative for **non-med** beauty; clinic pitch with forms + patch tests.

### Phase 3 — Growth & distribution (Weeks 20–32, Oct 2026–Feb 2027)

**Goal:** Reduce dependency on venue’s own marketing only.

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P3.1 | **Reserve with Google** | P1 | PRD already scoped; completion depends on Google approval |
| P3.2 | **Meta booking integration** | P2 | Instagram/Facebook appointment links |
| P3.3 | **WhatsApp notifications** | P2 | PRD Phase 2; abstraction layer ready |
| P3.4 | **Two-way messaging inbox** | P3 | Thread per guest; opt-in SMS replies |
| P3.5 | **Referral / share booking link** | P2 | Venue-led growth substitute for marketplace |

**Exit:** GTM can answer “how do clients find us?” without Fresha Marketplace.

### Phase 4 — Commerce depth (Weeks 24–40, Nov 2026–May 2027)

**Goal:** Optional POS path for salons that retail.

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P4.1 | **Retail catalog + basket at checkout** | P2 | Products on booking detail |
| P4.2 | **Gift cards / vouchers** | P2 | Stripe + ledger |
| P4.3 | **Inventory tracking (basic)** | P3 | Stock decrement on sale |
| P4.4 | **Card terminal / Tap to Pay** | P3 | Stripe Terminal or partner |
| P4.5 | **Commission reporting** | P3 | Per-staff revenue split |

**Exit:** “We don’t need a separate till” for mid-size salons.

### Phase 5 — Staff experience & scale (Weeks 32–52, Feb–May 2027)

| ID | Work | Priority | Notes |
|----|------|----------|-------|
| P5.1 | **Staff PWA or native app MVP** | P1 | Push: new booking, cancel, waitlist offer |
| P5.2 | **Shift roster** | P2 | Recurring shifts visible on calendar |
| P5.3 | **Advanced analytics** | P2 | Retention, practitioner utilisation, forecast |
| P5.4 | **Multi-venue admin dashboard** | P3 | PRD Phase 3 theme |
| P5.5 | **Calendar sync (Google/Outlook read-only)** | P3 | Complement import |

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
  │  P1.1 Reschedule    P1.2 Waitlist    P1.5 Checkout-lite
  │  P1.3 Any stylist  P0.2 Unified detail
  │  P2.1 Forms        P2.2 Patch tests
  │  P3.1 Google       P4.1 Retail
  └────────────────────────────────────────→ Effort
```

**Ship first:** P1.1, P1.2, P1.5, P0.2, P1.6  
**Ship second:** P1.3, P1.4, P2.1, P2.2, P3.1  
**Defer:** Full POS, marketplace, native app (until P1 complete)

### 9.2 Engineering principles (carry forward)

From `.cursor/rules` and unified booking doc:

- Extend Stripe/webhook paths — do not fork payment flows per model  
- Webhook idempotency on all new commerce features  
- Communications only via `lib/communications/`  
- RLS-respecting APIs for all guest data  
- Whole-booking refund default until partial spec exists  

### 9.3 Documentation & GTM sync

| Action | Owner |
|--------|-------|
| Refresh PRD Phase 2 list with this plan’s Tier 1/2 | Product |
| Update help articles when P1 ships | Product + eng |
| Competitive battlecard: Reserve NI vs Fresha vs Phorest | GTM |
| Appointments Light landing — emphasise multi-model + import | Marketing |

---

## 10. Success metrics

### 10.1 Pilot / founding venue (qualitative)

- Owner completes first paid online booking within 48 hours of onboarding  
- Staff report phone booking is **faster than paper** (PRD §2.2)  
- ≥ 1 venue runs **two non-appointment models** (class/event/resource) in production  

### 10.2 Product metrics (6 months post Phase 1)

| Metric | Target |
|--------|--------|
| Guest self-reschedule rate | ≥ 15% of eligible moves without staff |
| Waitlist conversion | ≥ 25% of offered slots accepted |
| No-show rate vs baseline | Measurable ↓ for deposit-enabled venues |
| Time-to-book (staff) | Median < 45s for returning client |
| Import completion rate | ≥ 80% of migrations finish wizard |

### 10.3 Competitive win rate (sales)

Track loss reasons in CRM:

- “Need POS” → Phase 4 roadmap / checkout-lite interim  
- “Need patch tests” → Phase 2.2 timeline  
- “Need Fresha discovery” → Phase 3 + collective/referral story  
- “Need classes + appointments” → **win** — lead with differentiator  

---

## 11. Dependencies and risks

| Risk | Mitigation |
|------|------------|
| Tier 1 delayed by UI refactor only | Cap Phase 0 at 2–4 weeks; ship P1 in parallel |
| Stripe Connect saved-card complexity | Checkout-lite uses Payment Links or on-session PI first |
| Google Reserve approval timeline | Continue widget + SEO; don’t block P1 on Google |
| Scope creep into full POS | Checkout-lite ≠ inventory POS; gate Phase 4 |
| Multi-model complexity confuses salon-only buyers | **Venue presets** in onboarding: “Salon”, “Studio”, “Hybrid” nav |
| PRD stale vs code (Linked Accounts) | P0.5 doc sync |

---

## 12. Related documents

| Document | Relevance |
|----------|-----------|
| `Docs/PRD.md` | MVP scope, Phase 2/3 roadmap, architecture rules |
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
| Checkout at appointment | No | Checkout-lite → POS path |
| Tips | No | Yes |
| Gift cards | No | Optional |
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
| Guest account portal | Yes | Yes + reschedule |
| iFrame widget | Yes | Yes |
| Google booking | No | Yes (if approved) |
| Social booking | No | Partial |
| WhatsApp | No | Yes |
| Native staff app | No | PWA or native MVP |
| Reports | Yes | Yes + advanced |
| CSV import | Yes | Yes |
| Linked venues / collectives | Yes | Yes v2 |
| Multi-model one calendar | Yes | Yes — **market harder** |

---

## Summary

Reserve NI’s appointments functionality is **already deep and unusually broad**. The path to **world-class** is not “add what Fresha has, feature by feature” — it is:

1. **Close the reception loop** (reschedule, waitlist, checkout-lite)  
2. **Win compliance-led beauty** (forms, patch tests)  
3. **Ship growth channels** (Google, reviews, WhatsApp) without building a marketplace  
4. **Keep winning multi-model and NI-specific stories** competitors cannot copy quickly  

Execute **Phase 0 + Phase 1 first**; treat UI excellence as **accelerator**, not **gate**. Revisit this document in **August 2026** after Phase 1 exit criteria.

---

*Document owner: Product. Next review: August 2026 or upon Phase 1 completion.*
