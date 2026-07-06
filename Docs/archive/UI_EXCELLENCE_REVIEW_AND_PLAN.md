> **ARCHIVED (2026-07-04).** This work has shipped. Kept for historical and architecture reference only; it does not describe pending work. Any "not yet built" / "proposed" / "no code written" status noted below is obsolete. See `Docs/archive/README.md`.

# Resneo UI Excellence Review & Improvement Plan

**Version:** 1.0  
**Date:** 18 May 2026  
**Scope:** Full product UI — marketing site, venue staff dashboard, public booking flows, customer account portal, onboarding/signup, help centre, platform super-admin, and embed widget.  
**Goal:** Bring Resneo to the polish, professionalism, and ease of use of the best booking-management software in market (SevenRooms, Resy, Toast Tables, Fresha, Square Appointments, Mindbody, Calendly-class experiences).

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Review methodology](#2-review-methodology)
3. [Competitive benchmark framework](#3-competitive-benchmark-framework)
4. [What is working well](#4-what-is-working-well)
5. [Critical gaps vs best-in-class](#5-critical-gaps-vs-best-in-class)
6. [Surface-by-surface assessment](#6-surface-by-surface-assessment)
7. [Design system maturity](#7-design-system-maturity)
8. [Phased roadmap](#8-phased-roadmap)
9. [Detailed implementation plan](#9-detailed-implementation-plan)
10. [Governance, metrics & maintenance](#10-governance-metrics--maintenance)
11. [Appendix: file & pattern inventory](#11-appendix-file--pattern-inventory)

---

## 1. Executive summary

Resneo has grown from a restaurant-focused MVP into a **multi-model booking platform** (table reservations, appointments, classes, events, resources) with genuinely sophisticated operational surfaces: practitioner calendar, table grid, floor plan editor, day sheet, CRM contacts, import tooling, and Stripe-native billing. The product already demonstrates **strong domain thinking** and several emerging UI foundations (CSS design tokens, dashboard layout primitives, skeleton loaders, mobile safe-area handling).

However, the front end today reflects **rapid feature velocity more than a unified product design language**. There is no shared component library for buttons, inputs, modals, or menus; styling is applied ad hoc across ~375 TSX files; settings and legacy sections still use divergent colour scales (`neutral-*` vs `slate-*`); and complex workflows (multi-model nav, calendar cards, long settings scroll) create **cognitive load** that best-in-class competitors avoid through ruthless information architecture and repeatable patterns.

**Verdict:** The UI is **functional and increasingly cohesive in newer dashboard areas**, but not yet at the tier of premium hospitality or appointments software. Closing the gap is primarily a **design-system + IA + interaction consistency** programme—not a full rewrite.

**Recommended north star:** *“Calm confidence at service speed.”* Staff should read critical information in under two seconds at arm’s length on a tablet; guests should complete a booking in under 60 seconds with zero ambiguity about deposits and cancellation; owners should configure the venue without reading internal documentation.

**Estimated programme:** 4 phases over ~6–9 months (can overlap with feature work). Phase 1 (foundation) is the highest leverage and should precede major new surfaces.

---

## 2. Review methodology

This review combined:

| Method | What was examined |
|--------|-------------------|
| **Codebase audit** | `src/app/**`, `src/components/**`, `globals.css`, `.cursor/rules/frontend.mdc`, existing mobile audits |
| **Live UI inspection** | Local dev server: marketing home, dashboard home, appointments list/calendar, settings (authenticated appointments venue) |
| **Pattern inventory** | Modals/dialogs (`role="dialog"`), button class fragmentation, aria usage, form libraries |
| **Architecture** | Next.js App Router, Tailwind v4 CSS-first tokens, no Radix/shadcn/MUI |
| **Prior art** | `Docs/mobile-touch-layout-conventions.md`, `Docs/mobile-touch-layout-conventions.md` |

**Not in scope for this document:** Backend API design, RLS, or payment correctness (covered elsewhere). Visual regression baselines and formal WCAG audit should follow Phase 1.

---

## 3. Competitive benchmark framework

Best-in-class booking software excels on six dimensions. Resneo should score itself against each (current rough scores: **3 = adequate**, **4 = good**, **5 = best-in-class**).

| Dimension | What “5” looks like | Resneo today (est.) | Primary gap |
|-----------|---------------------|------------------------|-------------|
| **Clarity** | One obvious primary action per screen; terminology matches the venue’s business | 3.5 | Multi-model nav; dense toolbars; mixed labels (Appointments vs Bookings) |
| **Speed** | Sub-100ms perceived interactions; optimistic UI; minimal full-page reloads | 3.5 | Many API round-trips; some loading states; calendar/toolbar complexity |
| **Consistency** | Same button, field, modal, and empty state everywhere | 2.5 | No shared primitives; 50+ bespoke modals |
| **Operational safety** | Allergies, deposits, and no-shows impossible to miss; undo for destructive actions | 4.0 | Strong domain rules; visual hierarchy can still improve on calendar cards |
| **Guest trust** | Policy, price, and refund rules visible before pay; branded, fast mobile funnel | 3.5 | Good Stripe Elements usage; funnel polish and perf targets need verification |
| **Configurability without complexity** | Progressive settings; sensible defaults; guided setup | 3.0 | Settings page is long; booking models add surface area |

**Reference products by segment:**

- **Restaurant ops:** SevenRooms, Resy OS, Toast Tables — timeline-first, floor-aware, service-mode UI.
- **Appointments:** Fresha, Vagaro, Square Appointments — calendar-centric, card-based booking detail, minimal chrome.
- **Classes / resources:** Mindbody — timetable clarity, roster actions, capacity at a glance.
- **Guest booking:** Calendly, Acuity — ruthless step reduction, instant availability feedback.

Resneo’s **strategic advantage** is serving **NI hospitality + multi-model** in one product. The UI programme must **simplify the multi-model story** rather than expose every model equally in navigation.

---

## 4. What is working well

### 4.1 Brand and visual identity

- **Distinctive brand palette** anchored at `#4E6B78` with a full `brand-50`–`brand-900` scale in `src/app/globals.css`.
- **Sora** as the primary typeface gives a modern, approachable feel distinct from generic Inter-only SaaS.
- **Dashboard “Phase 1” tokens** (`--surface-raised`, `--ds-shadow-card`, `--radius-card`) show intentional elevation hierarchy.
- Marketing site (`src/app/page.tsx`) is clean: sticky nav, gradient hero, structured pricing, FAQ accordion, contact form.

### 4.2 Emerging dashboard design language

Newer dashboard code consistently uses shared layout primitives under `src/components/ui/dashboard/`:

| Component | Role |
|-----------|------|
| `PageFrame` | Consistent max-width and responsive padding |
| `PageHeader` | Eyebrow + title + subtitle + actions |
| `SectionCard` | Grouped content with card chrome |
| `EmptyState` | Compact / default / hero variants |
| `Pill`, `TabBar`, `ToolbarRow` | Status and filter affordances |
| `Skeleton` | Composable loading (preferred over spinners per team rules) |
| `BookingStatusPill` | Status semantics tied to domain |

`DashboardHomeClient.tsx` demonstrates good information design: greeting, KPI stat cards, 7-day chart, today’s diary with deep links.

### 4.3 Mobile and touch awareness

Documented and partially implemented (see `Docs/mobile-touch-layout-conventions.md`):

- Viewport meta with `interactiveWidget: resizes-content`
- Safe-area utilities (`pt-safe`, `pb-safe`, …)
- `100dvh` shell, `dashboard-coarse-inputs` (16px inputs to prevent iOS zoom)
- `HorizontalScrollHint` for overflowing tables
- Booking funnel touch targets (`min-h-[44px]`)

This is **ahead of many early-stage B2B products** and should be preserved and extended.

### 4.4 Operational domain UX

- **Allergy and dietary emphasis** is codified in frontend rules (colour + non-colour indicators).
- **Booking status system** (`lib/table-management/booking-status*`) drives consistent actions, undo, and destructive guards.
- **Realtime connection banner** requirement (WebSocket drop + polling fallback) matches ops reliability expectations.
- **Complex surfaces are implemented** (Konva floor plan, dnd-kit import mapping, practitioner calendar, table grid timeline) — the hard product work exists; polish is the remaining layer.

### 4.5 Accessibility foundations

- Semantic HTML encouraged in rules; many controls use `<button>` correctly.
- `:focus-visible` brand ring globally in `globals.css`.
- `prefers-reduced-motion` respected for custom animations.
- `aria-live` on toasts; `aria-current` on sidebar links; dialog roles on modals.

### 4.6 Developer experience

- `.cursor/rules/frontend.mdc` documents loading/error expectations and surface-specific rules (day sheet, booking pages, embed).
- TypeScript strict mode and interface-driven models reduce UI/data mismatches.

---

## 5. Critical gaps vs best-in-class

### 5.1 No unified component layer (highest impact)

**Observation:** There is no `Button`, `Input`, `Select`, `Dialog`, `DropdownMenu`, or `FormField` primitive. Instead:

- ~50 files implement `fixed inset-0` modal/sheet patterns independently.
- Primary actions use inconsistent class strings (`rounded-lg bg-brand-600`, `rounded-xl`, `bg-neutral-900`, shared `btnPrimary` only in linked-accounts).
- `ProfileSection.tsx` and parts of settings use **`neutral-*`** while the rest of the app uses **`slate-*`**.

**Impact:** Every new feature reimplements focus traps, escape handling, z-index stacking, and disabled states differently. Visual drift is inevitable.

**Best-in-class approach:** A thin design-system layer (recommend **Radix UI primitives + Tailwind**, e.g. shadcn-style ownership) with Resneo tokens applied once.

---

### 5.2 Information architecture and multi-model complexity

**Observation:** `DashboardSidebar.tsx` encodes a large visibility matrix (tier, booking model, table management, admin vs staff). Staff see “Account” instead of “Settings”; model-specific links (Services, Events, Classes, Resources) inject dynamically.

**Impact:** Venues with multiple enabled models face **long sidebars** and ambiguous naming (“Appointments” vs “Appointment Calendar” vs “Calendar Availability”). New staff face a steep learning curve.

**Best-in-class approach:**

- **Mode switcher** at the top of nav: *Operations* | *Schedule* | *Guests* | *Configure* — not a flat list of 15 links.
- **Contextual nav** — only show table grid/floor plan when restaurant table mode is active.
- **Terminology layer** — venue `terminology` JSONB should drive all labels (partially started; needs UI-wide enforcement).

---

### 5.3 Settings and configuration UX

**Observation:** `SettingsView.tsx` is a **single scroll with many sections** (profile, hours, billing, Stripe, import, linked accounts, communications). Auto-save vs explicit-save rules are explained in subtitle text but still easy to miss.

**Impact:** Owners configuring Stripe or booking models may feel overwhelmed compared to Fresha/Square’s stepped setup wizards.

**Best-in-class approach:** Settings as **guided hubs** with completion progress, search, and “recommended next step” cards tied to `SetupChecklist`.

---

### 5.4 Calendar and operations density

**Observation (live review):** Practitioner calendar shows useful data (staff columns, booking cards, Complete/Start actions) but cards are **visually busy** (multiple badges + buttons + time pill). Date in toolbar truncates on mobile. “+ New” and “Walk-in” use different emphasis colours.

**Impact:** During service, staff scan time — extra chrome slows recognition. SevenRooms/Resy optimise for **glanceable rows** with actions on hover/long-press or a single overflow menu.

**Best-in-class approach:**

- **Density modes:** Compact / Comfortable for calendar and day sheet.
- **Progressive disclosure:** Primary line = time + name + status colour; secondary line = service/deposit; actions in kebab menu unless “next action” is unambiguous.
- **Sticky “now” line** and keyboard shortcuts for power users.

---

### 5.5 Guest-facing booking funnel

**Observation:** `BookingFlow.tsx` and related steps are well-structured (date → details → payment → confirmation) with embed resize support. Public pages must load in &lt;2s on mobile (per rules).

**Gaps to verify and close:**

- Per-venue **branding** (logo, accent, photography) should feel as polished as Calendly’s hosted pages.
- **Step indicator** and back navigation consistency across appointment vs table flows.
- **Error recovery** copy when slots sell out mid-flow.
- **Manage / confirm SMS links** (`/confirm/[token]`) must remain ultra-minimal and thumb-friendly.

---

### 5.6 Marketing site and product gap

**Observation:** Marketing site is strong on content but uses a **different interaction vocabulary** than the dashboard (e.g. FAQ accordion vs dashboard `TabBar`). No product screenshots or interactive demo embedded.

**Best-in-class approach:** Marketing components should consume the same `Button`/`Card` primitives (styled for marketing weight) so the product never feels like a different company after signup.

---

### 5.7 Metadata, polish, and production details

| Issue | Example |
|-------|---------|
| Generic document title on all routes | Root `metadata.title` only in `layout.tsx` |
| Font variable naming | `--font-geist-sans` maps to Sora (confusing for contributors) |
| Global `transition: all` on all inputs | `globals.css` — can cause jank and hurt reduced-motion users |
| Inline styles | Login page radial gradient uses `style={{}}` (exceptions to “no inline styles” rule) |
| Dev-only overlays | Next.js issue badge visible in dev — ensure zero leakage in prod |

---

### 5.8 Accessibility and internationalisation

**Gaps:**

- No documented **WCAG 2.2 AA** test matrix; colour contrast on pastel KPI cards and yellow booking blocks should be verified.
- **Dialog focus management** is hand-rolled per modal — high risk of focus traps or inert background failures.
- **No i18n** — acceptable for NI MVP, but typography and layout should not hard-code English string widths.
- **No dark mode** — not required for MVP, but ops surfaces used in dim dining rooms may benefit from a dim/med contrast theme later.

---

## 6. Surface-by-surface assessment

### 6.1 Marketing (`/`, `/appointments-plan`, `/restaurant`)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Visual design | 4/5 | Clean, trustworthy, on-brand |
| Content hierarchy | 4/5 | Clear value props, pricing, FAQ |
| Conversion UX | 3.5/5 | Multiple “Get started” paths; plan picker on home is good |
| Performance | TBD | Measure LCP on mobile; optimize images (`Logo.png`, hero assets) |
| Trust signals | 3.5/5 | Add customer logos, product UI screenshots, security badges |

**Improvements:** Product tour section; consistent CTA component; link to live demo booking page; reduce duplicate “Get started” without context.

---

### 6.2 Auth (`/login`, `/signup`, magic links)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Visual design | 4/5 | Login card is polished |
| Error handling | 4/5 | Session expired banner, callback errors |
| Signup funnel | 3/5 | Multi-step; long forms flagged in mobile audit |

**Improvements:** Shared `AuthLayout`; progress stepper; field-level validation summary; password strength meter; social proof sidebar on desktop.

---

### 6.3 Venue dashboard — Home

| Aspect | Rating | Notes |
|--------|--------|-------|
| Visual design | 4/5 | KPI cards, chart, diary |
| Actionability | 4/5 | Links to calendar and full list |
| Scanability | 3.5/5 | Four pastel KPI cards compete for attention |

**Improvements:** Single “hero metric” for today; mute secondary KPIs; surface **one** recommended action from setup status.

---

### 6.4 Venue dashboard — Bookings & calendar

| Aspect | Rating | Notes |
|--------|--------|-------|
| Feature depth | 5/5 | Day/week/month, filters, walk-in, linked accounts |
| Toolbar UX | 3.5/5 | Many icon buttons; date truncation |
| Booking cards | 3.5/5 | Busy; mixed action patterns |
| Mobile | 3.5/5 | Hamburger nav; calendar usable but cramped |

**Improvements:** See §9.4; unify with `OperationsWorkspaceToolbar` patterns across day sheet and table grid.

---

### 6.5 Venue dashboard — Day sheet & table ops

| Aspect | Rating | Notes |
|--------|--------|-------|
| Domain fit | 5/5 | Allergies, deposits, check-in, no-show rules |
| Readability at distance | 3.5/5 | Typography scale should be configurable |
| Offline | N/A | Service worker noted as optional in rules |

**Improvements:** “Service mode” full-screen day sheet; larger type toggle; high-contrast allergy row pattern (icon + text + border, not colour alone).

---

### 6.6 Venue dashboard — Settings

| Aspect | Rating | Notes |
|--------|--------|-------|
| Completeness | 5/5 | Billing, Stripe, models, widget, import |
| Usability | 2.5/5 | Very long; mixed save semantics |
| Visual consistency | 3/5 | `neutral-*` legacy sections |

**Improvements:** Tabbed settings with URL hash sync (partially exists); settings search; “simple vs advanced” collapsible sections; relocate import to onboarding hub.

---

### 6.7 Public booking (`/book/[slug]`, embed, collective)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Flow logic | 4/5 | Step machine, deposit skip path |
| Branding | 3.5/5 | Accent param for embed |
| Speed | TBD | Enforce perf budget |
| Accessibility | 3.5/5 | Guest-facing labels in `DetailsStep` |

**Improvements:** Venue header with photo; sticky summary sidebar on desktop; clearer deposit policy block; skeleton for slot grid.

---

### 6.8 Customer account (`/account/*`)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Visual design | 4/5 | Cohesive portal header |
| Parity with staff UI | 3/5 | Different nav pattern than dashboard |

**Improvements:** Reuse `PageFrame`/`PageHeader`; align booking cards with guest manage page.

---

### 6.9 Onboarding & import

| Aspect | Rating | Notes |
|--------|--------|-------|
| Guided setup | 3.5/5 | `SetupChecklist` on home helps |
| Import UX | 4/5 | DnD mapping is strong |

**Improvements:** First-run wizard should block dashboard until **minimum viable config** (hours + 1 service OR table config + Stripe if deposits on).

---

### 6.10 Help centre (`/help/*`)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Content | 4/5 | Structured articles |
| Typography | 3.5/5 | Custom `.help-prose` — consider official typography plugin |

**Improvements:** In-app help drawer from dashboard; contextual links from settings sections.

---

### 6.11 Super-admin (`/super/*`)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Function | 4/5 | Venues table, users, audit |
| Polish | 3/5 | Admin aesthetic can lag main product |

**Improvements:** After design system Phase 1, restyle super surfaces for parity (internal users deserve quality too).

---

## 7. Design system maturity

Current maturity (Brad Frost / Design System Maturity Model adapted):

| Stage | Description | Resneo |
|-------|-------------|-----------|
| 1. Informal | Ad hoc styles | **Most of codebase** |
| 2. Structured | Tokens + documentation | **`globals.css`, dashboard primitives** |
| 3. Standardized | Component library | **Not started** |
| 4. Optimized | Metrics, versioning, a11y CI | **Not started** |

### 7.1 Token audit (keep / extend / add)

**Keep (already in `globals.css`):** brand scale, semantic success/warning/danger, surfaces, shadows, radii, chart colours.

**Extend:**

```css
/* Recommended additions */
--font-size-xs through --font-size-3xl (type scale)
--line-height-tight, --line-height-normal
--space-page-x, --space-section-y
--duration-fast, --duration-normal
--z-dropdown, --z-modal, --z-toast
--focus-ring (already partially present)
```

**Add semantic tokens:**

- `--status-confirmed`, `--status-seated`, `--status-no-show`, etc. (map to booking status visual system)
- `--allergy-severe`, `--allergy-moderate` (never rely on red alone)

### 7.2 Required primitives (Phase 1 deliverable)

| Primitive | Variants | Notes |
|-----------|----------|-------|
| `Button` | primary, secondary, ghost, danger, link | Sizes: sm, md, lg; icon slots |
| `IconButton` | with mandatory `aria-label` | Toolbar standard |
| `Input`, `Textarea`, `Select` | error, disabled, hint | 16px min on touch |
| `Checkbox`, `Radio`, `Switch` | | |
| `Label`, `FormField` | error text, description | |
| `Dialog` | sm, md, lg, full-screen mobile | Radix Dialog |
| `Sheet` | right, bottom (mobile) | For booking detail |
| `DropdownMenu` | | Replace bespoke popovers |
| `Tabs` | underline, pills | Settings, reports |
| `Badge` / `Pill` | merge with `Pill.tsx` | |
| `Toast` | extend existing | Add action button variant |
| `Table` | sticky header, row actions | Reports, admin |
| `Tooltip` | | Help tooltips |
| `Spinner` | rare use | Only for button inline |

### 7.3 Layout templates

| Template | Use |
|----------|-----|
| `MarketingLayout` | `/`, plan pages |
| `AuthLayout` | login, signup |
| `DashboardLayout` | already `DashboardShell` — align spacing tokens |
| `GuestBookingLayout` | narrow column, venue header |
| `AccountLayout` | customer portal |

---

## 8. Phased roadmap

```
Phase 0 ─ Governance & metrics (2 weeks, parallel)
Phase 1 ─ Design system foundation (6–8 weeks) ★ BLOCKING
Phase 2 ─ IA & navigation simplification (4–6 weeks)
Phase 3 ─ Core ops surfaces polish (6–8 weeks)
Phase 4 ─ Guest funnel & conversion (4 weeks)
Phase 5 ─ Advanced & delight (ongoing)
```

Phases 2–4 can overlap once Phase 1 primitives exist for each stream.

---

## 9. Detailed implementation plan

### Phase 0 — Governance & metrics (Weeks 1–2)

**Objectives:** Make UI quality measurable and prevent regression.

| Task | Detail | Owner |
|------|--------|-------|
| Create `Docs/DESIGN_SYSTEM.md` | Token reference, component usage, do/don’t | Design + eng |
| Add Storybook or Ladle | Isolated development for primitives in `src/components/ui/` | Eng |
| Visual regression | Playwright screenshots for 10 critical routes | Eng |
| Perf budgets | LCP &lt; 2.5s marketing; &lt; 2s `/book/*` mobile | Eng |
| Accessibility CI | `axe-core` in Playwright on login, book, dashboard, settings | Eng |
| Lint rules | ESLint: ban raw `neutral-*` in new code; ban new `fixed inset-0` outside `Dialog` | Eng |

**Exit criteria:** CI fails on a11y violations in golden paths; Storybook documents all Phase 1 primitives.

---

### Phase 1 — Design system foundation (Weeks 3–10)

#### 1.1 Adopt headless primitives

**Recommendation:** Add `@radix-ui/react-dialog`, `dropdown-menu`, `popover`, `tabs`, `tooltip`, `switch`, `select` (or full shadcn init with Tailwind v4).

**Why not continue custom-only:** Resneo already has 50+ hand-rolled overlays. Radix provides focus trap, `aria-*`, and pointer-outside behaviour that would take months to replicate reliably.

**Migration rule:** No new bespoke modals. Existing modals migrate when touched or by directory (booking → settings → dashboard).

#### 1.2 Implement token extensions

- Extend `globals.css` `@theme inline` with type scale and z-index.
- Rename `--font-geist-sans` → `--font-sans` (alias old name for one release).

#### 1.3 Build primitives in `src/components/ui/primitives/`

Order of implementation:

1. `Button` / `IconButton`
2. `Input` / `FormField`
3. `Dialog` / `Sheet`
4. `DropdownMenu` / `Popover`
5. `Tabs`
6. `Select` / `Switch`
7. `Table` primitives

#### 1.4 Migrate high-traffic surfaces first

| Priority | Files / areas |
|----------|----------------|
| P0 | `WalkInModal`, `BookingDetailPanel`, `StaffSurfaceBookingModal`, `RequireAuthModal` |
| P1 | `SettingsView` sections (fix `neutral-*` → tokens) |
| P2 | `MergeContactsModal`, `BulkGuestMessageModal`, area modals |
| P3 | Super-admin tables |

#### 1.5 Standardize feedback patterns

| Pattern | Standard |
|---------|----------|
| Success | Toast (existing) |
| Inline field error | `FormField` + `aria-describedby` |
| Page load | `Skeleton.*` |
| Page error | `EmptyState` with retry action |
| Destructive confirm | `Dialog` variant=danger, verb in button (“Delete area”) |

**Exit criteria:** 80% of new UI uses primitives; zero new duplicate modal shells; settings profile section on slate tokens.

---

### Phase 2 — Information architecture & navigation (Weeks 8–14)

#### 2.1 Navigation model redesign

Replace flat sidebar list with **grouped navigation**:

```
OPERATIONS
  Home
  Today (context-aware: Day Sheet OR Appointments list)
  Calendar (single entry — practitioner OR table timeline)
  Floor / Tables (conditional)

GUESTS
  Contacts
  Waitlist (restaurant only)

CONFIGURE
  Services / Events / Classes / Resources (only enabled models)
  Availability (merge Dining + Calendar availability UI behind one hub with tabs)
  Settings

ACCOUNT
  Support
  Booking page (external)
  Sign out
```

**Implementation:**

- Refactor `DashboardSidebar.tsx` to render groups with `aria-labelledby`.
- Collapse “Appointment Calendar” and “Appointments” into one **Today** entry when unified scheduling.
- Staff “Account” → keep but use same iconography as admin Settings hub (restricted tabs).

#### 2.2 Terminology enforcement

- Create `useVenueTerminology()` hook returning labels for booking, guest, party, practitioner, etc.
- Replace hard-coded strings in `PageHeader` titles and nav labels.
- Add settings preview: “Staff will see: Appointments” vs “Bookings”.

#### 2.3 Command palette (power users)

- `Cmd+K` / `Ctrl+K` palette: jump to page, create booking, search guest.
- Libraries: `cmdk` pattern or lightweight custom.
- Positions Resneo alongside Fresha/Square for keyboard-heavy front-desk staff.

**Exit criteria:** Sidebar items ≤ 9 visible for typical appointments venue; usability test with 2 non-technical staff users completing 5 tasks in &lt; 3 minutes each.

---

### Phase 3 — Core operations surfaces polish (Weeks 12–20)

#### 3.1 Calendar & booking cards

**Design spec — booking card hierarchy:**

```
Line 1: 09:30 – 10:15  ·  Maeve Walsh          [Confirmed ▾]
Line 2: Cut & blowdry · Deposit paid · Andrew
Actions (overflow): Start · Message · Edit · Cancel
```

- Implement `BookingCard` component with `density` prop.
- Move “Start” / “Complete” to primary only when state machine says it’s the **single** expected action.
- Truncate-proof date control: `Mon 18 May` + full date in tooltip.

#### 3.2 Unified operations toolbar

- Extend `OperationsWorkspaceToolbar` + `ViewToolbar` as the **only** toolbar for: appointments list, calendar, day sheet, table grid.
- Shared date picker component (`CalendarDateTimePicker` already exists — wrap in consistent trigger UI).

#### 3.3 Day sheet service mode

- Full-screen toggle hiding sidebar.
- Row height + font scale presets (S / M / L).
- Allergy rows: left stripe + icon + bold label (test with protanopia simulation).

#### 3.4 Floor plan & table grid

- Align FAB placement with calendar (bottom-right, one primary action).
- Undo toast pattern (`UndoToast`) documented as standard for reversible ops.
- Touch: 44px min targets on table shapes (Konva hit areas).

#### 3.5 Reports & data tables

- Introduce `DataTable` with: sticky header, column visibility, CSV export, empty state, skeleton rows.
- Default sort indicators and numeric alignment.

**Exit criteria:** Calendar SUS score ≥ 80 (System Usability Scale) with 5 venue staff; day sheet allergy row identified in &lt; 1s in moderated test.

---

### Phase 4 — Guest funnel & conversion (Weeks 16–20)

#### 4.1 Booking page template

```
┌─────────────────────────────────────┐
│ [Logo]  Venue Name                  │
│         Address · ★ optional        │
├─────────────────────────────────────┤
│ Step indicator (1 of 4)             │
│ ┌─────────────────────────────────┐ │
│ │ Step content                    │ │
│ └─────────────────────────────────┘ │
│ Summary card (sticky desktop)       │
└─────────────────────────────────────┘
│ Powered by Resneo (subtle)       │
└─────────────────────────────────────┘
```

- Extract `GuestBookingLayout` from `BookingFlow` / `AppointmentBookingFlow`.
- Show deposit policy + cancellation in summary before payment step.
- Slot grid: optimistic refresh; sold-out slot disabled with explanation.

#### 4.2 Embed widget

- Loading skeleton inside iframe.
- `postMessage` height transitions smoothed (CSS `transition` on container, not `all`).
- Document accent colour contrast requirements (WCAG AA on button).

#### 4.3 Confirm / manage / pay success

- Single-column mobile layout; 48px button height.
- Destructive cancel uses two-step with deposit implication (already in rules — audit visually).

#### 4.4 Performance

- Route-level code splitting for payment step (Stripe already lazy).
- Preload venue public payload on book page SSR.
- Image optimization for venue logo (`next/image`).

**Exit criteria:** Mobile Lighthouse performance ≥ 90 on `/book/[slug]` test venue; booking completion rate baseline established.

---

### Phase 5 — Advanced & delight (Ongoing)

| Initiative | Value |
|------------|-------|
| **Setup wizard 2.0** | Reduces time-to-value; gamified checklist |
| **In-app onboarding tips** | Tooltips tied to first visit per route (`localStorage`) |
| **Dim / high-contrast theme** | Evening service in low light |
| **Haptic feedback (PWA)** | Optional check-in confirm on supported devices |
| **Empty state illustrations** | Humanize zero states without clutter |
| **Animated transitions** | Subtle page transitions in dashboard only; respect reduced motion |
| **Localization prep** | Extract strings to message catalog |
| **Venue white-label** | Custom CSS variables per venue on public pages |

---

### Cross-cutting workstreams

#### A. Page titles & metadata

Per-route `metadata` in App Router:

```typescript
export const metadata = { title: 'Bookings · Plus 1 · Resneo' };
```

Template in root: `%s · Resneo`.

#### B. Icon system

- Standardize on **one** icon set (Lucide recommended — tree-shakeable, consistent stroke).
- Replace inline SVG duplicates in sidebar and steps.

#### C. Motion

- Remove global `transition: all` on `button, a, input…` in `globals.css`.
- Replace with `transition-colors`, `transition-opacity` on primitives only.

#### D. Forms

- Standardize on `react-hook-form` + `zod` for complex forms (settings, booking modify).
- Simple fields: controlled inputs via `FormField`.

#### E. Realtime UX

- Connection banner: use `Banner` primitive (warning → success on reconnect).
- Optimistic updates for check-in / status change with rollback toast on failure.

---

## 10. Governance, metrics & maintenance

### 10.1 Roles

| Role | Responsibility |
|------|----------------|
| **Product design** | Figma library synced to tokens; review IA changes |
| **Engineering** | Primitive API stability; codemods for migrations |
| **QA** | Visual + a11y regression on release |

### 10.2 KPIs (track monthly)

| Metric | Target |
|--------|--------|
| Time to first booking (new venue) | −30% vs baseline |
| Support tickets tagged “can’t find” / “confusing UI” | −40% |
| Guest booking funnel completion | +5–10% relative |
| Dashboard task time (moderated: check-in guest) | &lt; 10 seconds |
| WCAG AA violations (axe on golden paths) | 0 critical |
| Primitive adoption (% PRs touching UI using `Button`) | &gt; 90% |

### 10.3 PR checklist (add to `.github/pull_request_template` or `frontend.mdc`)

- [ ] Uses design system primitives
- [ ] Loading / error / empty states
- [ ] Keyboard and screen reader spot-check
- [ ] Mobile 375px screenshot for UI changes
- [ ] No new `neutral-*` or bespoke modal shells

### 10.4 When to say no

Avoid UI scope creep that does not serve operators or guests:

- Dark mode before Phase 1 complete
- Custom themes per venue before public page template is solid
- Animation-heavy marketing gimmicks on dashboard

---

## 11. Appendix: file & pattern inventory

### 11.1 Key design files

| File | Purpose |
|------|---------|
| `src/app/globals.css` | Tokens, utilities, motion, help prose |
| `src/app/layout.tsx` | Fonts, root metadata |
| `src/app/dashboard/DashboardShell.tsx` | App chrome |
| `src/app/dashboard/DashboardSidebar.tsx` | Navigation matrix |
| `src/components/ui/dashboard/*` | Layout primitives |
| `src/components/ui/Skeleton.tsx` | Loading |
| `src/components/ui/Toast.tsx` | Feedback |
| `.cursor/rules/frontend.mdc` | Team conventions |

### 11.2 Modal / dialog hotspots (migration backlog)

Non-exhaustive list of bespoke overlays to migrate to `Dialog`/`Sheet`:

- `src/components/booking/*Modal*.tsx`, `*Sheet*.tsx`
- `src/components/areas/*Modal*.tsx`
- `src/components/dashboard/contacts/MergeContactsModal.tsx`
- `src/app/dashboard/bookings/WalkInModal.tsx`
- `src/app/dashboard/class-timetable/ClassScheduleModal.tsx`
- `src/app/dashboard/settings/floor-plan/FloorPlanEditor.tsx` (toolbars + modals)

### 11.3 Related internal docs

- `Docs/mobile-touch-layout-conventions.md`
- `Docs/mobile-touch-layout-conventions.md`
- `Docs/PRD.md` (product priorities)
- `.cursor/rules/frontend.mdc`

### 11.4 Suggested first sprint (2 weeks)

1. Add Radix + implement `Button`, `Input`, `Dialog`.
2. Migrate `WalkInModal` + `RequireAuthModal` as reference implementations.
3. Fix `ProfileSection` neutral palette.
4. Add per-route dashboard titles.
5. Remove global `transition: all` from `globals.css`.
6. Storybook with 6 primitive stories.

---

## Summary

Resneo’s UI strength is **deep operational functionality** with an emerging dashboard visual language and thoughtful mobile conventions. The path to best-in-class is not more features—it is **consistency, simplification, and obsessive clarity under pressure**.

**The single most important investment is Phase 1: a real component layer** built on accessible primitives, fed by the existing CSS tokens, and enforced through CI and PR discipline. Everything else—navigation, calendar density, guest funnel polish—compounds from that foundation.

---

*This document should be reviewed quarterly and updated as phases complete.*
