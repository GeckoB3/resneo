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

The Section 0 build pass has now **substantially closed the gap to its own headline goal** ("a non-technical owner drags in whatever files their old system gave them and gets an accurate, low-decision import, mapping services to existing ones or creating new ones"). The items that previously stood in the way have landed:

1. **Historical bookings now reach the service-mapping UI.** Extraction stages *all* parseable booking rows, not just future-dated ones, so past bookings get the same map-or-create treatment and reference-resolved execution (H1, resolved).
2. **Bulk-create and "build my catalogue from the bookings" now exist.** "Create all unmatched", a catalogue-from-bookings proposal, a searchable map-to-existing combobox, and a lightweight inline create all shipped (H3, resolved).
3. **Imported booking prices are written to the structured `booking_total_price_pence` column**, so revenue and reporting on imported bookings work (H4, resolved).
4. **Event imports now get an app-level pre-insert capacity check**, and capacity rejections map to a clear "fully booked" skip reason (H2, resolved).
5. **The plan is now an explicit "Review & approve" gate** shown before the import starts, and developer jargon (DB field keys, job IDs) was stripped from the user-facing screens (M10, M12, resolved).

The original plan's previously **overstated** "fixed" claims have also been reconciled: phone normalisation is now venue-aware (H5), `value_map` is implemented and user-reviewable (H6), and "defect #11" (orphans) is now fully closed for guests as well as bookings (M1). **Two follow-ups remain genuinely open:** undo is still a non-atomic sequence of deletes (status flip last, so re-runnable, but not a single transaction), and the `extract` / `concat` transform verbs were deferred by design (only `value_map` shipped). Details and severities below.

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
- **References / "Services & staff"** ([ReferencesStepClient.tsx](src/app/dashboard/import/[sessionId]/references/ReferencesStepClient.tsx)) — extracts service/staff/event/class/resource names from **all** bookings (historical rows included, per the H1 fix), fuzzy auto-resolves exact matches (≥0.95), AI-suggests the rest, and lets the user **Map to existing**, **Add as new** (services open the full service modal pre-seeded with suggested duration/price), or **Skip**, with "Accept all *N* suggestions".
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
- Three phases: **clients, then staged bookings (all rows needing reference resolution, historical included), then remaining CSV bookings**, in 300-row batches, checkpointed in `session_settings`, paused via an `ImportBatchPaused` exception and resumed; verified not to re-insert completed rows.
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
| #6 Phone hardcoded GB | ✅ Fixed | `normalisePhone(raw, defaultCountry)` is venue-aware (default country from venue currency); GB is only a backward-compatible fallback ([normalize.ts:39-42](src/lib/import/normalize.ts)) |
| #7 No Windows-1252 fallback | ✅ Fixed | [ingest-file.ts:56-72](src/lib/import/ingest-file.ts); tested |
| #8 Header assumed row 1 | ✅ Fixed | `detectHeaderRow` ([ingest-file.ts:86-107](src/lib/import/ingest-file.ts)); tested |
| XLSX/multi-sheet/size cap, structured outputs, retries, mapping cache | ✅ Fixed | ingest-file / openai-client / mapping-cache |
| Transform DSL `datetime_split`/`value_map`/`extract`/`concat` | ⚠️ **`value_map` shipped; `extract`/`concat` deferred** | `value_map` (reviewed raw→canonical for status/deposit enums) is implemented and applied deterministically ([value-map.ts](src/lib/import/value-map.ts); AI field [ai-map-columns.ts:107,118-121](src/lib/import/ai-map-columns.ts)); datetime is recovered implicitly; `extract`/`concat` verbs not built (still `map`/`ignore`/`split` only, [ai-map-columns.ts:111](src/lib/import/ai-map-columns.ts)) |
| #11 Atomic inserts / no orphans | ✅ Fixed | Bookings atomic via RPC; **guest insert + its audit are now atomic** via `import_insert_guest_with_audit` ([run-execute.ts:737,880](src/lib/import/run-execute.ts)) |
| #12 References: one giant prompt, 300-cap truncation | ⚠️ Partial | Prompt now batched/shortlisted; a silent **300-row candidate DB cap** remains for event/class ([ai-map-references/route.ts](src/app/api/import/sessions/[sessionId]/ai-map-references/route.ts)) |
| #13 Internal skip codes leak to users | ✅ Fixed (UI) | Codes live in `column_name`; UI renders English `message`/labels |
| `external_record_refs` dedupe | ✅ Generalised | Dedupe now keys on the **detected provider** (unknown exports namespaced by header hash), scoped to prior imports (M2, resolved in Section 0) |
| Fuzzy auto-resolve + AI shortlist batching + guest ladder + resumable executor + 24 h undo | ✅ Implemented | As described in §2 |
| "Accept all suggestions" | ✅ (map-only) | Exists, loops per-item PATCHes; accepts AI *map* suggestions only — **does not create** ([ReferencesStepClient.tsx:594-608](src/app/dashboard/import/[sessionId]/references/ReferencesStepClient.tsx)) |
| "Create what's missing" bulk-create + catalogue-from-bookings | ✅ Implemented | "Create all unmatched" + catalogue-from-bookings proposal + inline create shipped (H3, resolved in Section 0) |
| Post-import QA spot-check (~50 records vs source) | ⚠️ Partial | Samples **15**, **guests only**, never bookings or updated guests ([qa-spot-check.ts:34,56](src/lib/import/qa-spot-check.ts)) |

---

## 4. Findings — High

All High findings from the original audit were addressed in the Section 0 build pass. They are retained here as a resolution record; the only High-level item still open is the `extract` / `concat` carve-out under H6.

| # | Area | Original finding | Resolution (see Section 0) |
|---|---|---|---|
| H1 | Product gap | Historical (past-dated) bookings never reached the References/service-mapping step; only `is_future_booking` rows were staged. | **Resolved.** Extraction now stages *all* parseable booking rows, so past bookings get the same map-or-create UI and reference-resolved execution. [extract-booking-references.ts:350-360](src/lib/import/extract-booking-references.ts) |
| H2 | Capacity / money | Event imports bypassed the capacity guard; class/resource over-capacity rows were dropped under a generic reason. | **Resolved.** Event-session imports get an app-level pre-insert capacity check; `capacity_used` is set on imported CDE rows; capacity rejections (`23P01` / `CDE_CAPACITY`) are classified to a clear "fully booked" skip reason via `classifyBookingInsertSkip`. [run-execute.ts:145-148,1169,1195,1614](src/lib/import/run-execute.ts) |
| H3 | Product gap | No bulk-create of missing services/staff, and no catalogue-from-bookings proposal. | **Resolved.** "Create all unmatched", a catalogue-from-bookings proposal, a searchable map-to-existing combobox, and a lightweight inline create all shipped. |
| H4 | Money / data fidelity | Imported booking price was appended to `special_requests` as free text, not written to a price column. | **Resolved.** Price is written to the structured `booking_total_price_pence` column. [run-execute.ts:1158,1605](src/lib/import/run-execute.ts) |
| H5 | Correctness (non-UK) | Phone normalisation was GB-anchored, so non-UK national formats fell out of E.164 dedupe. | **Resolved.** `normalisePhone(raw, defaultCountry)` is venue-aware (default country from venue currency); GB is only a backward-compatible fallback. [normalize.ts:39-42](src/lib/import/normalize.ts) |
| H6 | Capability vs goal | Transform vocabulary was `map`/`ignore`/`split` only; provider status codes (`CXL`/`NS`/`DNA`) were keyword-guessed. | **Mostly resolved.** `value_map` (a reviewed raw→canonical map for status/deposit enums) is implemented and applied deterministically before normalisation ([value-map.ts](src/lib/import/value-map.ts); [ai-map-columns.ts:107,118-121](src/lib/import/ai-map-columns.ts)). **Still open:** the `extract` / `concat` verbs were deferred by design (fragile AI regex, rare cell shapes), so embedded multi-value cells like `"Jane Smith (07700 900900)"` still cannot be split into name + phone. |

---

## 5. Findings — Medium

The Section 0 build pass addressed the Medium findings below. They are retained as a resolution record; the only Medium-level item still open is the transactional-undo follow-up (M7).

| # | Area | Original finding | Resolution (see Section 0) |
|---|---|---|---|
| M1 | Data integrity | Guest insert + its audit row were not atomic (residual half of "defect #11"). | **Resolved.** Atomic via the `import_insert_guest_with_audit` RPC. [run-execute.ts:737,880](src/lib/import/run-execute.ts) |
| M2 | Data integrity | No external-ref dedupe for non-Phorest sources. | **Resolved.** Dedupe generalised to the detected provider (unknown exports namespaced by header hash), scoped to prior imports. |
| M3 | Concurrency | No lock on the execute resume path; concurrent POSTs could process the same batch. | **Resolved.** A self-healing execute lease (`execute_lease_until`) is claimed on batch start, released in `finally`, and auto-expires if a batch is killed. |
| M4 | Security (authz) | Cross-tenant write gap: issue-decision routes were not scoped to the session's venue. | **Resolved.** Issue-decision routes are scoped to the session's venue. |
| M5 | Correctness / money | Ambiguous service/staff names silently attached to the first candidate at execute. | **Resolved.** Execute refuses ambiguous matches (mirrors the guest ladder), raising `ambiguous_service_match` / `ambiguous_calendar_match` instead of guessing. [run-execute.ts:1466-1492](src/lib/import/run-execute.ts) |
| M6 | Data integrity | Practitioner CSV (past) booking path lacked the unresolved-skip guard. | **Resolved.** Practitioner + CDE CSV-fallback rows are guarded against inserting with unset catalogue links. |
| M7 | Undo completeness | Undo didn't clean imported `communication_logs` and isn't transactional. | **Partly resolved.** Undo now deletes imported `communication_logs` ([run-undo.ts:50-57](src/lib/import/run-undo.ts)). **Still open:** undo remains a non-atomic sequence of deletes (status flip last, so re-runnable, but not a single transaction); a single-RPC undo is a larger change. |
| M8 | Undo completeness | `record-created-entity` couldn't log `unified_calendar`/`practitioner`, so those leaked after undo. | **Resolved.** It now accepts calendars/practitioners, reversed by undo. |
| M9 | UX dead-end | A reference catalog fetch failure hid the entire Map/Add/Skip UI with no error. | **Resolved.** The catalog-fetch dead-end is fixed (P2 UI). |
| M10 | UX / goal | No single "Import Plan → Approve" screen; the plan banner sat mid-Validate. | **Resolved.** The plan is now an explicit Review & approve gate shown before the import starts. |
| M11 | UX bug | The drop zone had no drag-and-drop handler; a dragged file navigated away. | **Resolved.** Working drag-and-drop drop zone (P2 UI). |
| M12 | Jargon | DB field keys and internal IDs (job IDs) leaked onto user-facing screens. | **Resolved.** Field-key and job-id jargon removed from the wizard screens (P2 UI). |
| M13 | Accessibility | Row-preview modal was not accessible; progress bars lacked ARIA. | **Resolved.** Accessible row-preview modal + `role=progressbar`/`aria-live` (P2 UI). |
| M14 | Privacy | Unmasked PII was sent to OpenAI in sample rows and profile top values. | **Resolved.** PII is masked before it reaches the prompt (`maskPiiForPrompt`). [ai-map-columns.ts:33-64](src/lib/import/ai-map-columns.ts) |
| M15 | UX / goal | No search on the "Map to existing" dropdown; class/event/resource refs had no create path. | **Resolved.** Searchable map-to-existing combobox plus create paths added (H3 / P2 UI). |
| M16 | UX / goal | No downloadable sample/template file or column-name guidance. | **Resolved.** Downloadable sample CSV templates added (P2 UI). |

---

## 6. Findings — Low / edge

- **L1** — Single-decimal European amounts (`"50,5"`) parse 10× wrong (treated as thousands), silently. [normalize.ts:167-173](src/lib/import/normalize.ts)
- **L2** — AI column mapping runs on **Map-step mount**, not at upload; if the user never opens Map, nothing is mapped. [MapStepClient.tsx:94-131](src/app/dashboard/import/[sessionId]/map/MapStepClient.tsx)
- **L3** — *Resolved.* The dead/divergent **legacy `ai-map-columns/route.ts`** has been deleted (the directory no longer exists).
- **L4** — **QA spot-check samples 15 (not ~50), guests only**, and skips updated guests — the highest-risk records (bookings: dates/money/status) get no fidelity check. [qa-spot-check.ts:34,56](src/lib/import/qa-spot-check.ts)
- **L5** — Executor **re-downloads and re-parses the whole CSV on every 300-row batch** — O(files × batches) work and a per-invocation memory spike on large files. [run-execute.ts:376,1213](src/lib/import/run-execute.ts), [parse-storage-csv.ts:58](src/lib/import/parse-storage-csv.ts)
- **L6** — Column profiling caps at **5,000 rows**, so DD/MM inference can miss the one disambiguating row beyond that. [column-profile.ts:83](src/lib/import/column-profile.ts)
- **L7** — Client-file rows with a name but no email/phone are **silently dropped** (no synthetic fallback), unlike booking rows — an undocumented asymmetry. [run-validation.ts:175-200](src/lib/import/run-validation.ts)
- **L8** — UX polish: native `window.confirm`/`alert` for destructive actions and errors; full-page reloads on every step transition (re-running auto effects); step nav has no completed/locked states; some controls at `text-[10px]`; completion screen hardcodes "View clients →" ignoring venue terminology. [ImportHub.tsx:185-216](src/app/dashboard/import/ImportHub.tsx), [ImportingStepClient.tsx:346](src/app/dashboard/import/[sessionId]/importing/ImportingStepClient.tsx)

---

## 7. Missing / weak vs the stated goal

The goal: *"take any client/service/booking data a subscriber can provide — messy, any format — and import it accurately, with services mapped to existing or created new, usable by non-technical people who only authorise."*

The Section 0 build pass closed the gaps that previously stood between the tool and this goal:

- **Services are no longer the weakest leg.** Map-to-existing, bulk "create all unmatched", and a catalogue-from-bookings proposal all exist, and **historical bookings now get the same service-mapping UI** as future ones (H1, H3). A salon importing 18 months of history gets the mapping UI for that data.
- **"Any format" holes are largely closed:** phone normalisation is venue-aware (H5) and provider-specific status vocabularies are handled via a reviewed `value_map` (H6). The one remaining format gap is embedded multi-value cells (name + phone in one column), deferred with the `extract` / `concat` verbs.
- **"Only authorise" is much closer:** the flow now has an explicit Review & approve plan gate (M10), DB-key/job-id jargon was removed (M12), and search/bulk affordances were added (M15).
- **Accuracy gaps are closed:** prices are written to a structured column (H4), ambiguous services are refused rather than mis-attached (M5), and event imports get a pre-insert capacity check (H2).

**Genuinely still open:**
- **Undo is not transactional.** It is a re-runnable sequence of deletes (status flip last), not a single RPC, so a mid-undo failure can leave a partially undone import.
- **The `extract` / `concat` transform verbs are not implemented.** Only `value_map` shipped, so embedded multi-value cells still cannot be split.

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

Deterministic leaf functions are well covered (normalise, currency/AM-PM, header disambiguation, name-splitting, fuzzy-match, value-repair, progress-flush math, the provider corpus eval). The stateful, money/capacity/identity-critical core now has integration coverage as well: `run-execute.staged-bookings.integration.test.ts`, `run-execute.dedup.integration.test.ts`, `extract-booking-references.integration.test.ts`, and `import-execute-progress.test.ts` exercise the executor, the staged-booking pass, dedupe, and progress math, and `p0-correctness-helpers.test.ts` covers the P0 correctness fixes. Remaining thinner areas: a full mid-file pause to resume round-trip and `runImportUndo` are not yet exercised end to end, so an undo/resume harness (seeded test DB) is the biggest remaining gap.

---

## 10. Prioritised recommendations

> **Status (4 July 2026):** the P0 block and most of P1/P2 have been delivered (see Section 0 and the resolution tables in §4 and §5). This list is retained as the original prioritisation. The only substantive items still open are transactional (atomic) undo and the `extract` / `concat` / `datetime_split` transform verbs; the remaining unticked entries are lower-value UX polish.

**P0 — correctness & money (delivered):**
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
