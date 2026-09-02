# ResNeo docs index

**Created 26 August 2026.** There are 42 documents here and about 25,000 lines. This
page exists so you can tell which one owns your question, and how far to trust it.

Three rules that save time:

1. **Nothing here is the source of truth for the schema.** The ordered migration set
   in `supabase/migrations/` is. `schema.sql` is a curated inventory and says so.
2. **A "Verified" date means somebody checked the claims against the code on that
   date.** Documents without one have not been checked recently and should be read
   with that in mind.
3. **Where two documents disagree, the one that owns the question wins.** The Owns
   column below is the tiebreak.

---

## Start here

| Your question | Read |
|---|---|
| What is the current state of the code, and what is wrong with it? | `Resneo_Codebase_Audit_August_2026.md` |
| What defects are known, open, or already closed? | `Resneo_Remediation_Register.md` |
| What does a booking model mean, and which flow runs? | `Resneo_Booking_Models_Reference.md` |
| What tables and enums exist? | `schema.sql`, then the migration that creates the table |
| How do accounts, auth and the customer API work? | `Resneo_User_Accounts_Reference.md` |
| How do I run, test or deploy this? | `DEVELOPMENT.md`, `E2E_SMOKE.md`, `ResNeo-testing.md` |
| What is the product roadmap? | `Resneo-Appointments-Review-And-Roadmap.md` |

---

## Reference: the current answer to a question

These are the documents to trust first in their area.

| Document | Owns | Verified |
|---|---|---|
| `Resneo_Booking_Models_Reference.md` | The six `BookingModel` values, which public flow runs, signup cards | 2026-08-26 |
| `Resneo_User_Accounts_Reference.md` | Accounts, auth flows, the live `/api/v1/*` customer API, manage-link token formats (`/m/v3`), when login is required | 2026-07-10; staff identity resolution 2026-08-31 (its `staff` RLS section carried migration-era language after the migration had settled; the as-built rule, why the email fallback cannot be deleted, and its new `user_id IS NULL` bound are now recorded there) |
| `schema.sql` | Table and enum inventory. **Not** column-level detail | 2026-08-26 |
| `DESIGN_SYSTEM.md` | Component conventions, the hand-rolled-modal migration rule | 2026-07-10 |
| `FEATURE_FLAGS.md` | The closed 7-key venue flag list and defaults | 2026-08-09 |
| `MOBILE_API.md` | The Bearer contract the React Native app depends on, venue routes and, since P5-1, the customer surface | 2026-07-10; deep-link section corrected 2026-08-26 (it named the pre-rebrand `reserveniapp://` scheme, and production had been configured from it); customer surface 2026-08-31 (this row still said that surface was undocumented after P5-1 wrote it); auth contract 2026-08-31 (the app moved to the typed sign-in code and dropped password reset, so the OTP length, the `resneo://` dependency and the bare `staff/me` 401 were all restated) |
| `BASELINE_METRICS.md` | Venue metric definitions and targets | 2026-05-31 |
| `Embed_Public_Booking_URL_Contract.md` | Supported public booking page query parameters | 2026-08-09 |
| `api-venue-permissions-matrix.md` | Admin vs calendar-scoped staff on venue mutation routes | 2026-08-26 |
| `ACCOUNT_PUBLIC_VS_STAFF_ROUTES.md` | Which booking routes require a session, and silent auth signup | 2026-08-26 |
| `Multi_model_RLS_and_API_audit.md` | The application-layer tenancy checklist, and the account-safe view rule | 2026-08-26 |
| `CLASS_COMMERCE_PRODUCT_RULES.md` | Entitlement precedence, credits, courses, memberships. **Cited from source**, so errors here propagate | 2026-08-26 |
| `mobile-touch-layout-conventions.md` | Touch target and layout conventions | 2026-07-10 |
| `PERFORMANCE_BASELINE.md` | How to measure API and page timings | 2026-08-26 |

## Audits and findings registers

Three overlap by design and each states its own boundary. Read the boundary before
assuming a finding is unrecorded.

| Document | Scope | Note |
|---|---|---|
| `Resneo_Remediation_Register.md` | **The work queue.** Verified defects across portal, manage page, dashboard and database, tiered by what gates them | Last full reconcile 2026-08-06, partial 2026-08-26. Its counts predate the August security wave |
| `Resneo_Forensic_Audit_August_2026.md` | Security and RLS (C0-C13, D1). Authority on the August hardening wave | Remediation complete on both environments except C3, deferred by decision |
| `Resneo_Codebase_Audit_August_2026.md` | Code quality, correctness, architecture. **Explicitly excludes** security and scheduling semantics | Its evidence file was never merged to `staging`; the doc says so at `:128` |
| `Resneo_Scheduling_Availability_Audit_August_2026.md` | Scheduling and availability semantics (`SA-*`) | |
| `Resneo_Codebase_Audit_August_2026_Worksheet.md` | Working companion to the codebase audit | |

**Finding-ID convention:** hyphenated ids (`S-04`, `Q-13`, `C-09`) are the Remediation
Register. Unhyphenated ids (`C3`, `D1`, `N5`) are the Forensic Audit. `SA-*` is the
scheduling audit.

## Specifications for shipped features

| Document | Feature | Status |
|---|---|---|
| `reserveni-linked-accounts-spec.md` | Linked accounts and collectives | Shipped |
| `reserveni-compliance-spec.md` | Compliance records, forms, patch tests | Shipped |
| `CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION.md` | Card-hold deposits and no-show fees | Shipped, flag `card_hold_deposits` (default off) |
| `TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md` | In-person payments, Tap to Pay, receipts | Shipped both sides. Tips not built |
| `Resneo_Lean_Onboarding_Plan.md` | Lean onboarding | All phases shipped. As-built record |

## Plans not yet built

| Document | Status |
|---|---|
| `Resneo_Customer_Portal_World_Class_Plan.md` | Re-verified 2026-08-26, no portal phase implemented. Its pre-flight (§0A) is partly done and **§5D.4 records the email-link and mobile auth constraints proven by the 2026-08-26 outage repair**, which is the section to read before touching any auth or transactional email. Read its §0 first: it names its own authorities |
| `Resneo_Scheduling_Resolver_Plan_August_2026.md` | Partly implemented; the document tracks stage by stage |
| `staff-first-booking-flow-plan.md` | Not implemented. Flag `staff_first_booking_flow` |
| `rotating-schedule-plan.md` | Implemented on staging 2026-09-02: a timeline of schedule periods per calendar (hours from a future date, rotas of 1 to 6 weeks, non-overlapping, trimmed on insert) with a planning calendar on the Availability tab; resolved in `calendarHours`. Migrations `20270203120000` (applied to staging) and `20270204120000_calendar_schedule_periods.sql` (owed; backfills the first) |
| `service-categories-plan.md` | Implemented on staging 2026-09-02 (categories on the Services page, grouped booking pages with a category menu or collapsible headings; combined pages inherit headings from member venues). Migrations `20270202120000_service_categories.sql`, `20270202130000_collective_service_categories.sql` and `20270202140000_collective_policies_no_recursion.sql` (the last ends a pre-existing RLS recursion across the collective tables) are owed to both environments; the code tolerates their absence |
| `multi-service-picker-plan.md` | Implemented on staging 2026-09-02: guests and staff tick up to four services first, options are asked per service, availability is computed for the whole back-to-back chain (`services` parameter on `GET /api/booking/availability`), and `create-multi-service` now resolves combined pages. No migration |
| `compliance-booking-flow-plan.md` | Not implemented. Written 2026-09-01: inline forms below the details fields, identity-aware requirements, venue-wide ("All bookings") requirements, staff never blocked. Its §7 records the four decisions taken, including why phone stays out of the public identity check |
| `deposit-payment-robustness-plan.md` | Implemented on staging |
| `multi-service-visit-plan.md`, `disabled-booking-models-plan.md` | Scoped |

## Product and strategy

| Document | Note |
|---|---|
| `PRD.md` | The founding thesis, pricing rationale and risk register. **Read §0 first**: it fences the sections that no longer describe the product |
| `Resneo-Appointments-Review-And-Roadmap.md` | Competitive benchmark, positioning, roadmap. Corrected 2026-08-26; §8's phase plan still schedules shipped work and should be re-cut |
| `Resneo_Bookable_Services_Landscape_Plan.md` | The five-model taxonomy and the NI trade mapping. **Schema sections superseded**; see its header |
| `Resneo_Unified_Booking_Functionality.md` | Multi-model delivery record, the public `?tab=` slug contract (Appendix A), locked policy decisions. Four decisions corrected 2026-08-26 |
| `Unified_booking_verification_matrix.md` | Manual verification matrix for multi-model venues. All nine rows still hold |

## Testing and operations

| Document | Note |
|---|---|
| `DEVELOPMENT.md` | Cron jobs, Stripe webhook setup, environment notes |
| `E2E_SMOKE.md` | Playwright smoke specs. The CI job is gated on `vars.RUN_E2E_SMOKE` |
| `ResNeo-testing.md` | Manual QA plan and one executed pass. §14 describes live dev-database state and is stale |
| `Resneo_Import_Tool_Current_State_Review_June_2026.md` | The **only** assessment of `src/lib/import` (~9,000 lines). Ten items still open |

## Cross-repo correspondence

`R20-1_WEB_RESPONSE.md`, `R20-1_WEB_RESPONSE_2.md`, `R20-1_WEB_RESPONSE_3.md` and
`R20-1_WEB_RESPONSE_4.md` are four rounds of a concluded exchange with the
`resneo-app` team about fail-closed scheduling reads. **`R20-1_WEB_RESPONSE_4.md`
closes it.** Rounds 1 and 3 each contain a claim that round 4 corrects and carry
banners saying so. The rationale has been migrated into code, chiefly
`src/lib/availability/schedule-fail-closed-coverage.test.ts`. The app-side halves of
the exchange live in the `resneo-app` repo, which is why several `R20-1_APP_REPLY*.md`
references here do not resolve locally.

## Archive

`archive/` holds 21 historical documents: delivered plans, completed prompts and
superseded reviews. They are kept for audit trail and architecture rationale and are
**not** a source of truth. See `archive/README.md`.

---

## Keeping this honest

- When you archive something, add a row to `archive/README.md` saying why, and move
  any finding that lives only in that document into the Remediation Register first.
- When you verify a document against the code, put the date in it and update the
  Verified column here.
- A document that tells you to do something already done is worse than one that is
  merely old. Strike the instruction rather than leaving it to be discovered.
