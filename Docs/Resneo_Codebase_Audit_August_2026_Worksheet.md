# ResNeo codebase audit worksheet — August 2026

**Date started:** 2026-08-21
**Branch:** `claude/resneo-codebase-audit-lu4gbf` from `main` at `491832c`
**Purpose:** working state for the forensic multi-agent adversarial audit. The finished report is `Docs/Resneo_Codebase_Audit_August_2026.md`. This worksheet records the plan, the agent assignments, raw finding counts, and verification outcomes so the audit is reproducible.

**Scope and priorities (operator instruction):**
1. Appointments features (highest priority)
2. Classes, events, resources
3. Restaurant/table/floor-plan features are explicitly out of scope
4. Goals: (a) understand how everything works, (b) judge whether the code is sensible, disciplined and efficient, (c) flag over-complex or excessive code where simpler would be better, (d) find bugs and implementation gaps

**Relationship to prior audits (do not rehash):**
- `Docs/Resneo_Forensic_Audit_August_2026.md` (2026-08-13): security/RLS findings C0–C13, D1, H43, N1. All Criticals closed except C3 (deferred by decision).
- `Docs/Resneo_Scheduling_Availability_Audit_August_2026.md` (2026-08-15): scheduling-layer findings SA-C1..SA-M28. Criticals/Highs closed or deferred; Phase 1 (single resolver) in scoping.
- `Docs/Resneo_Remediation_Register.md`: customer-portal findings, mostly gated behind disabled features.
This audit therefore concentrates on logic correctness, architecture, complexity and gaps rather than RLS/grants.

## Method

Two-stage pipeline per domain: a finder agent audits the domain in depth, then an adversarial verifier re-reads every cited bug/gap and attempts to refute it. Only findings that survive verification (CONFIRMED or ADJUSTED) are eligible for the report; refuted claims are recorded here and excluded.

## Domain assignments

| # | Domain | Key surfaces |
|---|--------|--------------|
| D1 | Appointment availability engine | `src/lib/availability/*` (appointment-engine 1,860 ln), `src/lib/appointments/*`, availability API routes |
| D2 | Public appointment booking flow | `AppointmentBookingFlow.tsx` (5,903 ln), `UnifiedBookingForm.tsx`, `api/booking/create` (2,185 ln), create-multi-service, visit planning libs |
| D3 | Staff appointment surfaces | `PractitionerCalendarView.tsx` (8,903 ln), bookings dashboards, `api/venue/bookings*` (3,151 + 2,046 ln), modify/cancel libs, day sheet, services admin |
| D4 | Payments, deposits, card holds | `api/confirm` (2,014 ln), card-hold-* libs, stripe webhooks, payment crons, self-heal |
| D5 | Classes | `src/lib/class-commerce/*`, class-session-engine, timetable + products UIs, class APIs, class crons |
| D6 | Events | `src/lib/experience-events/*`, event-ticket-engine, `EventManagerView.tsx` (2,235 ln), event APIs, materialize cron |
| D7 | Resources | resource-booking-engine, `ResourceTimelineView.tsx` (2,166 ln), resource APIs, resource booking libs |
| D8 | Waitlist + communications | waitlist libs/APIs/crons, communications, emails, notifications, push |
| D9 | Cross-cutting architecture | duplication across the five engines, api/v1 mobile API, hooks, supabase client patterns, dead code, test posture, file-size discipline |

## Status log

- 2026-08-21: worksheet created; workflow launched (find → adversarial verify per domain).
- 2026-08-21 ~19:00 UTC: round 1 hit the session usage limit. Completed: D1–D5 finder audits (5/9). Failed on limit: D6–D9 finders and all 9 verifiers. Workflow resumed 23:12 UTC from cache (run wf_d4aa0b97-5cf); completed audits replay, the rest run live.
- Orchestrator first-hand reading so far (for adjudication): full read of `src/lib/availability/appointment-engine.ts` (1,861 ln); structural maps of `PractitionerCalendarView.tsx` (14 useState, 12 useEffect, 95 useCallback/useMemo, 32 fetch call sites, local re-implementations of `timeToMinutes`/`minutesToTime`/busy-interval helpers that exist in libs), `AppointmentBookingFlow.tsx` (14 useState, 19 useEffect, 49 useCallback/useMemo), `api/booking/create/route.ts` dispatch (one zod schema, model dispatch to `handleNonTableBooking` at :782). Independently confirmed: 20+ local re-implementations of `timeToMinutes` across components/routes/libs despite a canonical export in `src/lib/availability`.

- 2026-08-22 08:05 UTC: all 9 finder audits complete: 141 findings (D1:13, D2:10, D3:14, D4:14, D5:26, D6:13, D7:15, D8:21, D9:15). Verifiers complete for D1 (8 confirmed / 2 adjusted / 3 refuted-as-duplicates), D2 (8/2/0), D4 (12/2/0). Remaining 6 verifiers re-launched after the second usage-limit window. Raw output in `Resneo_Codebase_Audit_August_2026_Worksheet_RawResults.md`.
- 2026-08-22: orchestrator independently re-verified EV-1 (critical): `parent_event_id uuid REFERENCES experience_events(id) ON DELETE CASCADE` (migration 20260327000001:100, never altered by any later migration); `countBookingsBlockingEventDelete` counts only `.eq('experience_event_id', id)` with no sibling/parent check; neither DELETE route considers series children. Confirmed.

## Raw results

See `Docs/Resneo_Codebase_Audit_August_2026_Worksheet_RawResults.md` (per-domain architecture summaries, quality assessments, all findings, and adversarial verdicts).
