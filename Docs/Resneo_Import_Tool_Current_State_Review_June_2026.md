# Resneo Data Import Tool — Current-State Review (June 2026)

*Reviewed 23 June 2026 against the live `staging` working tree. Covers the user-facing flow at `/dashboard/import` (entered from **Settings → Profile tab → Data import**), `src/lib/import/*`, `src/app/api/import/*`, and the `import_*` DB schema. Worktree copies under `.claude/worktrees/` were excluded — they are stale agent branches.*

> **Relationship to the existing doc.** `Docs/Resneo_Import_Tool_Review_And_AI_Rework_Plan.md` is a forward-looking rework *plan* whose header now claims "all phases implemented." This document **verifies that claim against the actual code** and records the current state, remaining bugs, and gaps. Where the two disagree, this document is authoritative as of the review date. The plan remains useful for its design rationale and phasing.

---

## 0. Implementation status (build pass — 23 Jun 2026)

A build pass implemented the prioritised fixes below. **Verification:** production build passes; `tsc --noEmit` clean; full vitest suite **1569 tests / 223 files pass** (incl. new engine integration tests + helper tests); ESLint + `lint-no-raw-modals` clean. Not yet verified by a live end-to-end browser run (the flow is admin-auth-gated behind upload/session steps) — recommend a manual run-through after applying migrations.

**New migrations to apply:** `20261226120000_bookings_total_price_pence_guard.sql`, `20261226120100_import_guest_tx.sql`, `20261226120200_import_session_execute_lease.sql`, `20261226120300_import_column_mappings_value_map.sql`.

**Done & verified**
- **H1** — past/historical bookings now flow through the references step and the resolved-id staged executor (extraction stages *all* rows; the `is_future_booking`-only filters were removed in extraction + executor). Integration-tested.
- **H2** — capacity-rejection errors (SQLSTATE 23P01 / `CDE_CAPACITY`) are classified to a clear "fully booked" skip reason (`classifyBookingInsertSkip`); class/resource imports are trigger-enforced; and **event-session imports now get an app-level pre-insert capacity check** (events use `event_session_id`, which no DB trigger guards — it's enforced in app code in the live booking flow, so the importer mirrors it) so they can't oversell a session. `capacity_used` is now set on imported event bookings. Unit-tested.
- **H4** — imported booking price written to the structured `booking_total_price_pence` column (+ idempotent guard migration).
- **H5** — phone normalisation is venue-aware (`normalisePhone(raw, country)` from venue currency) instead of GB-only.
- **M5** — ambiguous service/staff name matches are refused at execute (no silent first-match), mirroring the guest ladder.
- **M6** — practitioner + CDE CSV-fallback rows are guarded (never inserted with unset catalogue links).
- **H3** — world-class service/staff mapping: bulk "create all unmatched", catalogue-from-bookings proposal, searchable map-to-existing combobox, lightweight inline create (full modal behind "Advanced"), catalog-fetch dead-end fixed. Backed by a new shared resolver + bulk endpoint.
- **M1** — guest insert + undo-audit now atomic via `import_insert_guest_with_audit` RPC. **M3** — a self-healing execute lease (`execute_lease_until`) stops two concurrent batches processing the same session: claimed on batch start, released in `finally`, auto-expires (>maxDuration) if a batch is killed.
- **M2** — cross-import dedupe generalised beyond Phorest: the source's own appointment/client IDs are matched per **detected provider** (unknown exports namespaced by a header hash so two different systems' overlapping IDs can't collide), scoped to **prior imports only** (`external_record_refs` is import-written), skipping a re-imported row with a clear **report** entry. Source-IDs-only → no cross-source false-positives. Integration-tested.
- **M7** — undo deletes imported `communication_logs`. **M8** — `record-created-entity` accepts calendars/practitioners (reversed by undo).
- **M10** — the Import Plan is now an explicit **Review & approve** gate (plan headline + narrative + counts + 24-hour-undo reassurance) shown before the import starts, instead of a bare "Proceed" link.
- **M4** — issue-decision routes scoped to the session's venue. **M14** — PII masked in AI prompts. **L3** — dead `ai-map-columns` route deleted.
- **Engine tests** — in-memory Supabase stub + integration tests (extraction stages past rows; staged executor honours resolved ids / refuses unresolved).
- **P2 UI** — working drag-and-drop drop zone; downloadable sample CSV templates; accessible row-preview modal + `role=progressbar`/`aria-live`; DB field-keys & job-id jargon removed; completion screen uses venue terminology.
- **H6 value_map** — the AI proposes a per-provider raw→canonical map for enum columns (booking/deposit status); the user **reviews and edits it on the Review step** (editable raw→canonical table); it's applied deterministically before normalisation (`applyValueMap` in `applyMappingsToDataRow`), replacing brittle keyword guessing for provider status codes. `mapBookingStatus` also recognises common codes (CXL/NS/DNA) as a fallback for unmapped values. Migration + AI-cache version bump + unit-tested.

**Remaining (tracked follow-ups, with rationale)**
- **M7 (transactional undo)** — undo is still a sequence of deletes (status flip last → re-runnable, not atomic); a single-RPC undo is a larger change.
- **H6 `extract` / `concat`** — regex-capture and column-concat transforms. Deferred by design: AI-generated regex is fragile and these cell shapes are rare; `value_map` (the high-value piece) is done.

---

## 1. Executive verdict

The import tool is **substantially more capable than a typical CSV importer** and most of the June rework genuinely landed: real spreadsheet/encoding/header ingestion, a full-file column profiler, AI column-mapping with structured outputs and caching, deterministic + AI value repair, a resumable timeout-proof executor, atomic booking inserts, a working 24-hour undo, and a conservative guest-matching ladder that avoids false merges. The deterministic helpers are well unit-tested.

**But it does not yet meet its own headline goal** — "a non-technical owner drags in whatever files their old system gave them and gets an accurate, low-decision import, mapping services to existing ones or creating new ones." Five things stand between the current build and that goal:

1. **Historical bookings — the common case — never reach the service-mapping UI.** Only *future-dated* bookings are staged as references; past bookings resolve service/staff names silently at execute time and are skipped when they don't match. The polished "map or create" step only applies to future bookings.
2. **There is no bulk-create and no "build my catalogue from the bookings" path.** Creating missing services is one-at-a-time through the full service modal, and a fresh venue importing history is *blocked* rather than offered a catalogue.
3. **Imported booking prices are stored as free-text notes, not money** — so revenue/reporting on imported bookings is blank.
4. **Event imports bypass the capacity guard** (column mismatch), and class/resource over-capacity rows are silently dropped under a generic reason.
5. **The single "review one plan → approve" screen doesn't exist** — the plan banner is buried mid-validation, and developer jargon (DB field keys, job IDs) leaks onto the two screens a non-technical owner reads most.

Several of the original plan's "fixed" claims are **overstated**: phone normalisation is still GB-anchored; the `value_map`/`extract`/`concat` transforms were never implemented; the QA spot-check is smaller and narrower than described; and "defect #11" (orphans) is only half-closed (bookings are atomic, guests are not). Details and severities below.

---

## 2. What the tool can do today

### 2.1 Entry & session management
- Reached from **Settings → Profile → "Data import"** card → `/dashboard/import` ([SettingsView.tsx:1507](src/app/dashboard/settings/SettingsView.tsx), [import/page.tsx](src/app/dashboard/import/page.tsx)). **Admin-only** (non-admins redirected).
- Import **Hub** ([ImportHub.tsx](src/app/dashboard/import/ImportHub.tsx)) lists sessions with status, and Continue / Resume / Report CSV / Undo / Delete actions; shows the 24-hour undo window. Every API route is admin-guarded via `requireImportAdmin` ([auth.ts](src/lib/import/auth.ts)).

### 2.2 Six-step wizard
**Upload → Map → Review → References (Services & staff) → Validate → Importing.**

- **Upload** ([UploadStepClient.tsx](src/app/dashboard/import/[sessionId]/upload/UploadStepClient.tsx)) — accepts `.xlsx/.xls/.csv/.tsv/.txt` (20 MB cap); auto-detects each file's kind (clients / bookings / staff) and asks the user to confirm; report-style exports are AI-"reshaped" into a table with a preview and undo-to-original.
- **Map** ([MapStepClient.tsx](src/app/dashboard/import/[sessionId]/map/MapStepClient.tsx), [ImportMapDndView.tsx](src/components/import/ImportMapDndView.tsx)) — **auto-runs AI column mapping on arrival**; drag-and-drop (with tap-select fallback) of "Your columns" → "ResNeo fields"; supports column splitting, custom fields, and free-text AI instructions; a per-file requirement checklist gates Continue.
- **Review** ([ReviewStepClient.tsx](src/app/dashboard/import/[sessionId]/review/ReviewStepClient.tsx)) — a read-only confirmation table of every column → action; only custom-field/split rules are editable here.
- **References / "Services & staff"** ([ReferencesStepClient.tsx](src/app/dashboard/import/[sessionId]/references/ReferencesStepClient.tsx)) — extracts service/staff/event/class/resource names from **future** bookings, fuzzy auto-resolves exact matches (≥0.95), AI-suggests the rest, and lets the user **Map to existing**, **Add as new** (services open the full service modal pre-seeded with suggested duration/price), or **Skip**, with "Accept all *N* suggestions".
- **Validate** ([ValidateStepClient.tsx](src/app/dashboard/import/[sessionId]/validate/ValidateStepClient.tsx)) — server-side background row scan with progress polling; issues grouped by type with per-row and bulk decisions; AI value-repair for unparseable dates/times; renders the plain-English Import-Plan banner.
- **Importing** ([ImportingStepClient.tsx](src/app/dashboard/import/[sessionId]/importing/ImportingStepClient.tsx)) — drives the batched executor with live progress, then shows a completion summary, post-import QA note, and report-CSV download.

### 2.3 Ingestion & normalisation (`src/lib/import/`)
- **Formats/encoding/structure:** XLSX multi-sheet (SheetJS, ≤10 sheets), BOM + UTF-8 + Windows-1252 fallback, header-row detection (skips title/metadata rows), duplicate-header disambiguation *with a user warning*, 20 MB cap ([ingest-file.ts](src/lib/import/ingest-file.ts)).
- **Column profiler** over up to 5,000 rows (fill rate, distinct count, top values, type histogram, date-component evidence) feeds the AI and yields **deterministic DD/MM-vs-MM/DD inference** ([column-profile.ts](src/lib/import/column-profile.ts)).
- **Normalisers:** dates (12 formats + ambiguity flag), **times incl. AM/PM**, **currency incl. European decimals**, names ("Last, First", compound), booleans/ints, booking-status/deposit enums ([normalize.ts](src/lib/import/normalize.ts)).
- **Platform templates** for Fresha/Booksy/Vagaro/ResDiary/Timely/Phorest ([constants.ts](src/lib/import/constants.ts)).

### 2.4 AI usage
- **Column mapping** ([ai-map-columns.ts](src/lib/import/ai-map-columns.ts)) — alias-map first, then header-hash **cache** ([mapping-cache.ts](src/lib/import/mapping-cache.ts)), then AI with profiles + samples; **structured outputs (`json_schema`, strict)**, 45 s timeout, 2 retries, **no `temperature`** ([openai-client.ts](src/lib/import/openai-client.ts)).
- **Reference matching** ([ai-map-references.ts](src/lib/import/ai-map-references.ts)) — 50-ref batches, each with its own 12-candidate fuzzy shortlist (not a whole-catalogue dump).
- **Value repair** ([value-repair.ts](src/lib/import/value-repair.ts)) — batches unparseable date/time strings to AI, **re-validates deterministically** before accepting.
- **Reshape** ([ai-reshape-dataset.ts](src/lib/import/ai-reshape-dataset.ts)) — turns paginated/report-style sheets into tabular rows with forward-fill.
- **Plan narrative** ([import-plan.ts](src/lib/import/import-plan.ts)) and **post-import QA spot-check** ([qa-spot-check.ts](src/lib/import/qa-spot-check.ts)).

### 2.5 Execution & safety (`run-execute.ts`, 1,690 lines)
- Three phases — **clients → staged future bookings → remaining CSV bookings** — in 300-row batches, checkpointed in `session_settings`, paused via an `ImportBatchPaused` exception and resumed; verified not to re-insert completed rows.
- Per-model booking dispatch (table / unified / practitioner / event / class / resource).
- **Atomic booking + audit insert** via RPC `import_insert_booking_with_audit` ([20261218120000_import_booking_tx.sql](supabase/migrations/20261218120000_import_booking_tx.sql)).
- **Guest matching ladder:** external-ID (Phorest) → email (ci) → E.164 phone → unique exact name → synthetic guest; ambiguous names never merge.
- **24-hour undo** with a `previous_data` journal and reverse pass ([run-undo.ts](src/lib/import/run-undo.ts)); **Phorest external-ref dedupe** ([external-refs.ts](src/lib/import/external-refs.ts)).

---

## 3. Verification of the existing plan's "implemented" claims

| Plan claim | Status | Evidence |
|---|---|---|
| #1 `temperature:0` breaks GPT-5 AI silently | ✅ Fixed | No temperature sent; error body logged ([openai-client.ts:69-106](src/lib/import/openai-client.ts)) |
| #2 AI-map deletes mappings before the AI call | ✅ Fixed | Delete only after a non-empty result; "mappings unchanged" guard ([files/[fileId]/ai-map/route.ts:122-130](src/app/api/import/sessions/[sessionId]/files/[fileId]/ai-map/route.ts)) |
| #3 No AM/PM time parsing | ✅ Fixed | [normalize.ts:113-144](src/lib/import/normalize.ts); tested |
| #4 Combined datetime → no `booking_time` | ✅ Fixed (implicit) | Auto date+time recovery ([apply-mappings.ts:150-158](src/lib/import/apply-mappings.ts)); no named `datetime_split` verb, but functional |
| #5 European decimals → wrong money | ✅ Fixed (one edge) | [normalize.ts:146-182](src/lib/import/normalize.ts); single-decimal `"50,5"` still 10× wrong (§6) |
| #6 Phone hardcoded GB | ⚠️ **Still GB-anchored** | `normalizeToE164(t,'GB')` ([normalize.ts:40-42](src/lib/import/normalize.ts)); non-UK national formats fail → raw + excluded from dedupe |
| #7 No Windows-1252 fallback | ✅ Fixed | [ingest-file.ts:56-72](src/lib/import/ingest-file.ts); tested |
| #8 Header assumed row 1 | ✅ Fixed | `detectHeaderRow` ([ingest-file.ts:86-107](src/lib/import/ingest-file.ts)); tested |
| XLSX/multi-sheet/size cap, structured outputs, retries, mapping cache | ✅ Fixed | ingest-file / openai-client / mapping-cache |
| Transform DSL `datetime_split`/`value_map`/`extract`/`concat` | ⚠️ **Mostly not implemented** | Only `map`/`ignore`/`split` + implicit datetime exist; status enums still keyword-guessed (§5, §6) |
| #11 Atomic inserts / no orphans | ⚠️ **Half-closed** | Bookings atomic via RPC; **guest insert + its audit are NOT atomic** ([run-execute.ts:605/637, 753/774](src/lib/import/run-execute.ts)) |
| #12 References: one giant prompt, 300-cap truncation | ⚠️ Partial | Prompt now batched/shortlisted; a silent **300-row candidate DB cap** remains for event/class ([ai-map-references/route.ts](src/app/api/import/sessions/[sessionId]/ai-map-references/route.ts)) |
| #13 Internal skip codes leak to users | ✅ Fixed (UI) | Codes live in `column_name`; UI renders English `message`/labels |
| `external_record_refs` dedupe | ⚠️ Phorest-only | `refProvider` set only for Phorest ([run-execute.ts:218-221](src/lib/import/run-execute.ts)) |
| Fuzzy auto-resolve + AI shortlist batching + guest ladder + resumable executor + 24 h undo | ✅ Implemented | As described in §2 |
| "Accept all suggestions" | ✅ (map-only) | Exists, loops per-item PATCHes; accepts AI *map* suggestions only — **does not create** ([ReferencesStepClient.tsx:594-608](src/app/dashboard/import/[sessionId]/references/ReferencesStepClient.tsx)) |
| "Create what's missing" bulk-create + catalogue-from-bookings | ❌ Not implemented | Single-entity create only; mode-based duration/price only for already-extracted future refs (§5) |
| Post-import QA spot-check (~50 records vs source) | ⚠️ Partial | Samples **15**, **guests only**, never bookings or updated guests ([qa-spot-check.ts:34,56](src/lib/import/qa-spot-check.ts)) |

---

## 4. Findings — High

| # | Area | Finding | Where |
|---|---|---|---|
| H1 | Product gap | **Historical (past-dated) bookings never reach the References/service-mapping step.** Only `is_future_booking` rows are staged; past rows resolve service/staff names at execute time via first-match → default → skip, with **no user review**. A service that appears only in past bookings can never be mapped or created, so those rows are silently skipped (or attached to a default). Since most migrations are historical, the headline "map to existing or create new" feature covers the minority of real data. | [extract-booking-references.ts:307,350-357](src/lib/import/extract-booking-references.ts); [name-match.ts:33-70](src/lib/import/name-match.ts); [run-execute.ts:1320-1354](src/lib/import/run-execute.ts) |
| H2 | Capacity / money | **Event imports bypass the capacity guard.** The trigger `enforce_cde_capacity` enforces on `experience_event_id`, but the importer writes `event_session_id` for `event_ticket` → the trigger never fires → an event session can be **oversold via import**. Class/resource imports *are* guarded, but over-capacity rows raise `23P01`, are caught as a generic `booking_insert_failed`, and **silently dropped** with an unhelpful reason. Imports also never set `capacity_used` for CDE rows and do no pre-insert check. (Confirm the canonical event column for the venue's event model.) | [run-execute.ts:1057-1062,1085-1096](src/lib/import/run-execute.ts); [20261225120000_cde_capacity_guards.sql:72,133-139](supabase/migrations/20261225120000_cde_capacity_guards.sql) |
| H3 | Product gap | **No bulk-create of missing services/staff, and no catalogue-from-bookings proposal.** "Add as new" opens the full service modal **one reference at a time**; "Accept all" only accepts existing AI map-suggestions. A fresh venue importing history is **blocked** by `booking_defaults_missing` instead of being offered a catalogue built from the data. This is exactly the decision-load the rework set out to remove and the user's core request. | [ReferencesStepClient.tsx:594-608,737-758](src/app/dashboard/import/[sessionId]/references/ReferencesStepClient.tsx); [booking-import-defaults.ts:181-228](src/lib/import/booking-import-defaults.ts); [reference-defaults/route.ts:83-105](src/app/api/import/sessions/[sessionId]/reference-defaults/route.ts) |
| H4 | Money / data fidelity | **Imported booking price is stored as a free-text note, not a structured amount.** Parsed `pricePence` is appended to `special_requests` ("Imported price £X.XX") and never written to a price column (deposits, by contrast, are structured). Revenue/reporting on imported bookings is blind. | [run-execute.ts:969-981](src/lib/import/run-execute.ts) |
| H5 | Correctness (non-UK) | **Phone normalisation is still GB-anchored** despite the plan marking #6 fixed. There are `00`-prefix and bare-international fallbacks, but a non-UK **national** format (leading-0 / local) fails → stored raw with a warning → **excluded from E.164 dedupe** → duplicate clients for any non-UK venue. No venue/default country is threaded into the import path even though `lib/phone/e164.ts` supports it. | [normalize.ts:31-55](src/lib/import/normalize.ts); callers in run-validation/run-execute/guest-lookup |
| H6 | Capability vs goal | **Transform vocabulary is `map`/`ignore`/`split` only** (+ implicit datetime recovery). `value_map`, `extract`, `concat` were never built. Provider status vocabularies (`CXL`/`NS`/`DNA`) fall back to brittle keyword guessing in `mapBookingStatus`, and embedded data like `"Jane Smith (07700 900900)"` cannot be split into name + phone. | AI schema [ai-map-columns.ts:21-62](src/lib/import/ai-map-columns.ts); [apply-mappings.ts](src/lib/import/apply-mappings.ts); [normalize.ts:205-214](src/lib/import/normalize.ts) |

---

## 5. Findings — Medium

| # | Area | Finding | Where |
|---|---|---|---|
| M1 | Data integrity | **Guest insert + its audit row are not atomic** (residual half of "defect #11"). If the `import_records` insert fails after the guest insert, the guest is invisible to undo (orphan). The RPC pattern that fixed bookings was not extended to guests. | [run-execute.ts:605-644,753-781](src/lib/import/run-execute.ts) |
| M2 | Data integrity | **No external-ref dedupe for non-Phorest sources.** Re-running a completed non-Phorest import (or two sessions over the same file) re-inserts guests/bookings; idempotency relies only on the per-session checkpoint. | [run-execute.ts:218-221](src/lib/import/run-execute.ts) |
| M3 | Concurrency | **No lock on the execute resume path.** Concurrent POSTs on an `importing` session (double-click, retrying client, overlapping polls) both read the same checkpoint and process the same 300 rows → duplicate inserts. The optimistic `status='ready'` guard only protects the *first* transition; no advisory lock / compare-and-swap per batch. | [execute/route.ts:92-121](src/app/api/import/sessions/[sessionId]/execute/route.ts); run-execute.ts |
| M4 | Security (authz) | **Cross-tenant write gap on issue-decision routes.** `issues/[issueId]` and `issues/bulk-decide` use the **service-role client** (RLS bypassed) and update `import_validation_issues` filtered only by `session_id`/`id` — **no venue-ownership check**. An admin of venue A could alter venue B's import decisions if they know the UUIDs. Write-only and UUID-gated (low practical risk), but a missing object-level authorization check; other routes do scope by venue. | [issues/[issueId]/route.ts:24-28](src/app/api/import/sessions/[sessionId]/issues/[issueId]/route.ts), [issues/bulk-decide/route.ts:25-29](src/app/api/import/sessions/[sessionId]/issues/bulk-decide/route.ts); RLS in [20260621120000_data_import_tool.sql:166-174](supabase/migrations/20260621120000_data_import_tool.sql) |
| M5 | Correctness / money | **Ambiguous service/staff names silently attach to the first candidate** at execute (unlike the guest ladder, which refuses ambiguous matches) → a booking can attach to the wrong (and wrongly-priced) service. | [name-match.ts:51-66](src/lib/import/name-match.ts); [run-execute.ts:1328-1353](src/lib/import/run-execute.ts) |
| M6 | Data integrity | **Practitioner CSV (past) booking path lacks the unresolved-skip guard** that the unified path has, so a practitioner row missing its default service/practitioner can insert with those fields unset. | [run-execute.ts:1464-1486](src/lib/import/run-execute.ts) |
| M7 | Undo completeness | **Undo doesn't clean imported `communication_logs`** and isn't transactional. Orphaned logs, or (if the FK blocks the booking delete) a mid-undo failure that leaves a half-undone import still marked `complete`. | [run-undo.ts](src/lib/import/run-undo.ts); [booking-import-comms.ts:130-146](src/lib/import/booking-import-comms.ts) |
| M8 | Undo completeness | **`record-created-entity` can't log `unified_calendar`/`practitioner`** (schema accepts only `service_item`/`appointment_service`), yet undo reverses those types and the inline path logs them. A calendar/practitioner created via the full modal leaks after undo. | [record-created-entity/route.ts:16-18](src/app/api/import/sessions/[sessionId]/record-created-entity/route.ts) vs [run-undo.ts:58-64,81-87](src/lib/import/run-undo.ts) |
| M9 | UX dead-end | **Reference catalog fetch failure hides the entire Map/Add/Skip UI** with no error, while Continue stays gated → the user is stranded with no controls and no explanation. | [ReferencesStepClient.tsx:199-200,567](src/app/dashboard/import/[sessionId]/references/ReferencesStepClient.tsx) |
| M10 | UX / goal | **No single "Import Plan → Approve" screen.** The plain-English plan banner sits mid-Validate (step 5/6), after reference and validation decisions, not as the approval gate. The aspirational "upload → review one plan → approve" is unmet. | [ValidateStepClient.tsx:417-423](src/app/dashboard/import/[sessionId]/validate/ValidateStepClient.tsx) |
| M11 | UX bug | **The "Drop CSV or Excel files here" zone has no drag-and-drop handler** — only the click/`<label>` path works. A user who actually drags a file onto it drops it on the page, navigating away and losing the session. | [UploadStepClient.tsx:209-224](src/app/dashboard/import/[sessionId]/upload/UploadStepClient.tsx) |
| M12 | Jargon | **DB field keys and internal IDs leak onto the screens non-technical users read most.** Review shows e.g. "Email Address (client_email)"; field labels include "External client ID"; Validate shows "Job id: &lt;uuid&gt;" and tells users to "use the job id if you resume later" (there's nowhere to use it). | [ReviewStepClient.tsx:239](src/app/dashboard/import/[sessionId]/review/ReviewStepClient.tsx); [constants.ts:30,37](src/lib/import/constants.ts); [ValidateStepClient.tsx:413-414,464](src/app/dashboard/import/[sessionId]/validate/ValidateStepClient.tsx) |
| M13 | Accessibility | **Row-preview modal is not accessible** — no `role="dialog"`, no `aria-modal`, no focus trap, no Escape, no focus restore. Progress bars lack `role="progressbar"`/`aria-live`; drag-and-drop has no keyboard sensor. | [ImportRowPreviewDialog.tsx:54-96](src/components/import/ImportRowPreviewDialog.tsx) |
| M14 | Privacy | **Unmasked PII (names/emails/phones) is sent to OpenAI** in sample rows and profile `top_values`, despite the plan recommending masking. Note OpenAI as a subprocessor and mask values the model doesn't need. | [ai-map-columns.ts:119](src/lib/import/ai-map-columns.ts); [files/[fileId]/ai-map/route.ts:77](src/app/api/import/sessions/[sessionId]/files/[fileId]/ai-map/route.ts) |
| M15 | UX / goal | **Reference mapping friction:** no search/filter on the "Map to existing" dropdown (a plain `<select>` of every service); **resource/event/class references have no create path** (only Map/Skip), so a booking for a not-yet-existing class is forced to Skip. | [ReferencesStepClient.tsx:637-653](src/app/dashboard/import/[sessionId]/references/ReferencesStepClient.tsx); `createButtonLabel` returns null for those types |
| M16 | UX / goal | **No downloadable sample/template file or column-name guidance.** The "What can I import?" panel describes sources but gives a non-technical user nothing to pattern-match a messy file against. | [UploadStepClient.tsx:389-399](src/app/dashboard/import/[sessionId]/upload/UploadStepClient.tsx) |

---

## 6. Findings — Low / edge

- **L1** — Single-decimal European amounts (`"50,5"`) parse 10× wrong (treated as thousands), silently. [normalize.ts:167-173](src/lib/import/normalize.ts)
- **L2** — AI column mapping runs on **Map-step mount**, not at upload; if the user never opens Map, nothing is mapped. [MapStepClient.tsx:94-131](src/app/dashboard/import/[sessionId]/map/MapStepClient.tsx)
- **L3** — Dead/divergent **legacy `ai-map-columns/route.ts`** (no profiles/cache/aliases/instructions) is unused but will rot and would regress quality if ever wired. [ai-map-columns/route.ts](src/app/api/import/ai-map-columns/route.ts)
- **L4** — **QA spot-check samples 15 (not ~50), guests only**, and skips updated guests — the highest-risk records (bookings: dates/money/status) get no fidelity check. [qa-spot-check.ts:34,56](src/lib/import/qa-spot-check.ts)
- **L5** — Executor **re-downloads and re-parses the whole CSV on every 300-row batch** — O(files × batches) work and a per-invocation memory spike on large files. [run-execute.ts:376,1213](src/lib/import/run-execute.ts), [parse-storage-csv.ts:58](src/lib/import/parse-storage-csv.ts)
- **L6** — Column profiling caps at **5,000 rows**, so DD/MM inference can miss the one disambiguating row beyond that. [column-profile.ts:83](src/lib/import/column-profile.ts)
- **L7** — Client-file rows with a name but no email/phone are **silently dropped** (no synthetic fallback), unlike booking rows — an undocumented asymmetry. [run-validation.ts:175-200](src/lib/import/run-validation.ts)
- **L8** — UX polish: native `window.confirm`/`alert` for destructive actions and errors; full-page reloads on every step transition (re-running auto effects); step nav has no completed/locked states; some controls at `text-[10px]`; completion screen hardcodes "View clients →" ignoring venue terminology. [ImportHub.tsx:185-216](src/app/dashboard/import/ImportHub.tsx), [ImportingStepClient.tsx:346](src/app/dashboard/import/[sessionId]/importing/ImportingStepClient.tsx)

---

## 7. Missing / weak vs the stated goal

The goal: *"take any client/service/booking data a subscriber can provide — messy, any format — and import it accurately, with services mapped to existing or created new, usable by non-technical people who only authorise."*

- **Services are the weakest leg.** Map-to-existing and single create exist, but there is **no bulk-create, no catalogue-from-bookings, and no service mapping at all for historical bookings** (H1, H3). A salon importing 18 months of history with 25 services gets none of the mapping UI for that data and must pre-build the catalogue by hand or watch rows skip.
- **"Any format" has real holes:** non-UK phones (H5), provider-specific status vocabularies (H6), and embedded multi-value cells (H6) aren't handled.
- **"Only authorise" isn't true yet:** the flow is still six decision-heavy steps with no single approve-the-plan gate (M10), and it leaks jargon (M12) and lacks search/bulk affordances (M15) that non-technical users need.
- **Accuracy gaps that won't surface to the user:** prices vanish into notes (H4), ambiguous services attach to the wrong entity (M5), events can oversell (H2).

---

## 8. Strengths (keep / build on)

- **Ingestion rework is genuinely strong** — XLSX/multi-sheet, encoding fallback, header detection, profiler, deterministic date inference, duplicate-header warnings.
- **AI plumbing is done correctly now** — structured outputs, retries/timeout, the temperature bug fixed, header-hash cache, value-repair that re-validates deterministically, report-style reshape.
- **Resumable, timeout-proof executor** with a verified-correct checkpoint/resume (no re-insert of completed rows), atomic booking+audit inserts, and a real 24-hour undo.
- **Conservative guest matching** with correct false-merge protection.
- **Good validation UX primitives** — issue grouping, bulk decisions, plain-English messages, downloadable report CSV — plus a per-file requirement checklist with actionable hints and a reshape preview with undo.
- **Strong unit/corpus tests on deterministic helpers.**

---

## 9. Test coverage

Deterministic leaf functions are well covered (normalise, currency/AM-PM, header disambiguation, name-splitting, fuzzy-match, value-repair, progress-flush math, the provider corpus eval). **The stateful, money/capacity/identity-critical core is essentially untested:** no test exercises `runImportExecuteBatch`, the pause/resume round-trip, `runImportUndo`, the atomic RPC, the guest ladder's ambiguity guard, reference resolution, or capacity handling — which is exactly where every High/Medium bug above lives. A harness (stub/in-memory Supabase or seeded test DB) covering a forced mid-file pause→resume, a re-run, and an undo would close the biggest gap. Add regression tests for the temperature/`json_schema` contract, non-UK phone, and the `event_session_id` capacity column.

---

## 10. Prioritised recommendations

**P0 — correctness & money (do first):**
1. **Stage past bookings as references too** (or add an execute-time "unmatched services" review), so historical imports get the same map-or-create UI (H1).
2. **Fix the event capacity column** so imports go through `enforce_cde_capacity`; map `23P01`/`CDE_CAPACITY` to a clear "fully booked" skip reason for class/resource (H2).
3. **Store imported booking price in a structured column**, not `special_requests` (H4).
4. **Thread venue/default country into phone normalisation** (rename `normalisePhoneUk` → `normalisePhone(raw, country)`) (H5).
5. **Refuse ambiguous service/staff matches** at execute (mirror the guest ladder) (M5); add the practitioner-path skip guard (M6).

**P1 — the service experience & trust:**
6. **Bulk "create all unmatched" + catalogue-from-bookings proposal**, and a lightweight inline service create instead of the full modal; add search to the map dropdown and create paths for class/event/resource refs (H3, M15).
7. **Implement `value_map` (and ideally `extract`)** so provider status vocabularies and embedded cells are handled and reviewable (H6).
8. **Wrap guest create + audit in an RPC** (M1); add per-row idempotency / non-Phorest dedupe (M2); add an advisory lock on resume (M3).
9. **Clean `communication_logs` and make undo transactional**; extend `record-created-entity` to calendars/practitioners (M7, M8).

**P2 — UX & polish:**
10. **Promote the plan to a real "Review & approve" step** (M10); strip DB keys/job IDs from user-facing copy (M12); fix the references dead-end (M9) and the non-functional drop zone (M11); accessible modal + progress (M13); sample template + better guidance (M16).
11. **Close the M4 authz gap** (scope issue routes to the session's venue); mask PII to OpenAI (M14); delete the dead legacy route (L3); broaden QA to bookings (L4).

---

*Prepared from a four-area code audit (UI/UX; ingestion & AI mapping; references/guest-matching/validation; execution/undo/API/DB). High-impact findings (H1–H6, M4) were re-verified directly against source.*
