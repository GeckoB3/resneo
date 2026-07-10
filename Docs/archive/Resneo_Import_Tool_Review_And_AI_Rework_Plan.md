> **ARCHIVED (2026-07-04).** This work has shipped. Kept for historical and architecture reference only; it does not describe pending work. Any "not yet built" / "proposed" / "no code written" status noted below is obsolete. See `Docs/archive/README.md`.

# Resneo Data Import Tool — Code Review & AI-First Rework Plan

*Reviewed June 2026. Covers `/dashboard/import` (entry from Settings → Data import), `src/lib/import/*`, `src/app/api/import/*`, and the import DB schema.*

> **Implementation status (June 2026): all phases implemented.**
> Phases 1–2: defects #1–#8 fixed; XLSX/multi-sheet/encoding/size-cap ingestion with
> header-row detection; full-file column profiler feeding AI mapping; automatic DD/MM vs
> MM/DD inference; auto-run AI mapping; structured outputs + retries on all AI calls.
> Phase 3: fuzzy auto-resolve + AI shortlist batching + "Accept all suggestions" for
> references; AI value-repair batching for unparseable dates/times (deterministic-validated,
> applied at validation and execute); the Import Plan summary (deterministic stats + AI
> narrative) on the Validate step.
> Phase 4: atomic booking+audit inserts via RPC (`import_insert_booking_with_audit`);
> cross-venue AI mapping cache keyed by header hash; post-import QA spot-check (sampled
> guests compared field-by-field against their source rows, AI-summarised) on the
> completion screen; eval corpus (`src/lib/import/__fixtures__/corpus.ts` +
> `import-corpus.test.ts` in CI) and offline AI accuracy eval (`npm run eval:import-ai`).
> Migrations required: `20261217120000_import_ingestion_v2.sql`,
> `20261218120000_import_booking_tx.sql`, `20261218120100_import_ai_mapping_cache.sql`.

The goal stated for this tool: take CSV or spreadsheet data of whatever client and booking data a subscriber can provide — messy, incomplete, in any provider's format — and import it seamlessly and accurately, usable by non-technical people, with the user only authorising rather than operating.

**Verdict in one paragraph:** the foundation is genuinely good — resumable batched execution, a real undo with audit trail, validation issues with user decisions, platform templates, and external-ID dedupe. But the current flow is a *mapping tool*, not an *import service*: a typical two-file import demands roughly **60–125 manual decisions across six wizard steps** (file labelling, per-column mapping, custom-field naming, per-reference dropdown matching, per-issue decisions), rejects the file formats non-technical users actually have (no Excel), and quietly fails on common real-world data (AM/PM times, European decimals, non-UK phones, header rows that aren't row 1). AI is used in only two narrow, opt-in places, with a parameter bug that likely means it frequently doesn't run at all. The right move is to invert the architecture: **AI plans, deterministic code executes, the user authorises one plan** — turning six decision-heavy steps into upload → review one summary → approve.

---

## 1. How it works today (summary)

Six-step wizard: **Upload** (CSV only, user labels each file clients/bookings/staff) → **Map** (drag-and-drop column mapping; platform templates pre-fill for Fresha/Booksy/Vagaro/ResDiary/Timely/Phorest; optional "Run AI mapping" button) → **Review** (custom fields, split rules) → **References** (match service/staff names in bookings to the venue catalogue, per-item dropdowns; AI suggestions shown but non-binding) → **Validate** (issues grouped by type; per-issue or bulk decisions; ambiguous-date format choice) → **Import** (300-row batches, checkpointed in `import_sessions.session_settings`, resumable, live progress, 24-hour undo).

Execution (`run-execute.ts`, 1,691 lines) runs three phases: clients, staged future bookings (pre-resolved references), then remaining CSV bookings with execute-time name resolution and per-model dispatch (table/unified/practitioner/event/class/resource). Guest matching: external ID → email (ci) → E.164 phone → unique exact name → synthetic guest. Every created/updated record is journalled in `import_records` with `previous_data` for undo.

## 2. What is already good (keep all of this)

- **Resumable batch executor** with checkpoint state, progress flushing, and an exception-driven pause (`ImportBatchPaused`) — survives serverless timeouts.
- **Undo** journal (`import_records` incl. `previous_data` for updates) and a working reverse pass.
- **`external_record_refs`** unique-keyed dedupe against the source system's own IDs — the single best protection against double imports.
- **Validation issue model** with severity, per-row decisions, bulk decide, and a downloadable report CSV.
- **Future-booking staging** (`import_booking_rows` + `import_booking_references`) separating reference resolution from raw rows.
- **Guest matching ladder** is sensible and conservatively avoids false merges (ambiguous names don't match).
- Good unit-test discipline on the deterministic helpers (normalize, apply-mappings, name-match, guest-lookup...).

## 3. Defects found (fix regardless of any rework)

| # | Severity | Defect | Where |
|---|----------|--------|-------|
| 1 | **Critical — verify first** | `temperature: 0` is sent to `gpt-5.4-nano`. GPT-5-family reasoning models reject non-default temperature with a 400 error; the catch block swallows it and returns null → "AI mapping unavailable". **AI mapping may have been silently broken the whole time.** The error is logged but only generically. Remove `temperature` (or set via env), and log the OpenAI error body. | `ai-map-columns.ts:90`, `ai-map-references.ts:69` |
| 2 | **Critical** | The AI-map route **deletes all existing column mappings before calling the AI**. If the AI call fails (see #1), the user is left with *zero* mappings — including the platform-template prefills they had. Delete-after-success, or write to a draft and swap. | `files/[fileId]/ai-map/route.ts:54-65` |
| 3 | **High** | `parseTimeString` accepts only `HH:mm[:ss]` and ISO `T` formats. **No AM/PM support** — "2:30 PM" returns null → required `booking_time` missing → every such row fails. Very common in salon exports. | `normalize.ts:92-104` |
| 4 | **High** | The Timely platform template maps `Appointment start` → `booking_date` only; the time component is discarded and nothing maps `booking_time` → **every Timely booking errors on a required field** unless the user invents a space-split themselves. There is no combined datetime → date+time transform anywhere. | `constants.ts:287-292`, `apply-mappings.ts` |
| 5 | **High** | `parseCurrencyPence("1.234,56")` strips commas → parses as 1.23456 → **123 pence instead of €1,234.56**. European decimal formats produce silently *wrong* monetary values, not nulls. | `normalize.ts:106-113` |
| 6 | **High** | Phone normalisation is hardcoded GB. Any non-UK import stores raw strings with a warning flag, excluded from dedupe matching. | `normalize.ts:26-34` |
| 7 | Medium | Upload assumes UTF-8 (`file.text()`). Windows Excel "CSV" is frequently Windows-1252 → `O'Neill`, `Siân`, `£` arrive corrupted with no warning. | `files/route.ts:39` |
| 8 | Medium | Headers are assumed on row 1; files with a title/metadata row (very common from PMS "report" exports) map garbage. No header-row detection. | `files/route.ts:40-45`, `parse-storage-csv.ts:57-58` |
| 9 | Medium | No upload size cap; whole file is read into memory twice (route + each execute batch re-downloads and re-parses the full CSV). | `files/route.ts`, `run-execute.ts` |
| 10 | Medium | Duplicate headers are silently suffixed (`Notes_2`) — correct behaviour, but the user is never told, and the mapping UI shows names that don't match their file. | `parse-storage-csv.ts:16-39` |
| 11 | Medium | No DB transactions per row/chunk: guest insert can succeed while the booking fails (guest orphaned); booking + `import_records` is manually compensated but partial states remain possible. | `run-execute.ts` (throughout) |
| 12 | Low | `ai-map-references` arbitrarily truncates event/class candidates at 300 with no note; one giant prompt for all references × all candidates (accuracy degrades, token waste). | `ai-map-references/route.ts:62,80` |
| 13 | Low | Skip reasons surface as internal codes (`unified_resolution_failed`, `booking_defaults_missing`) in places users see. | `run-execute.ts`, `ValidateStepClient.tsx` |

## 4. Structural gaps vs. the stated goal

**Input formats.** "CSV or spreadsheet data" — but `.xlsx`/`.xls` are rejected outright (`files/route.ts:35`). Non-technical users overwhelmingly have Excel files; telling them to "save as CSV" is exactly the kind of technical step the tool is meant to remove. No multi-sheet handling, no encoding detection, no header-row detection, no file-level junk handling (total rows, page footers, repeated headers from paginated exports).

**Decision load.** Counting a typical 500-client + 2,000-booking import: 2 file labels + ~35 column decisions + ~5–10 custom/split decisions + 11–35 reference dropdowns + 8–26 validation decisions ≈ **60–125 decisions, 15–45 minutes**, full of jargon ("external_client_id" vs "external_system_id", "resolve reference", "booking defaults"). Every one of these is a place a non-technical user can stall or guess wrong.

**The references step is the worst offender.** AI suggestions exist but are non-binding; there is no fuzzy auto-accept, no "accept all high-confidence", no search in the dropdowns, and no "create the missing services for me" bulk path (single-entity creation exists in `create-reference-entity.ts` but isn't leveraged).

**AI is opt-in and starved of context.** It runs only when the user presses a button, sees just headers + 5 sample rows, gets no column statistics, uses the legacy `json_object` response format with no schema enforcement, has no retry/timeout, and its two call sites cover perhaps 15% of the manual work in the wizard.

## 5. Recommended redesign: the AI-first import pipeline

**Core principle: the model proposes, deterministic code executes, the user authorises.** Never let the model transform rows directly — it plans (mappings, transforms, matches, vocabulary tables) as structured JSON; audited TypeScript applies the plan to every row. This keeps cost flat regardless of row count, keeps results reproducible and testable, and keeps the model's error surface reviewable.

### Stage 0 — Ingestion (deterministic)
- Accept `.xlsx`, `.xls`, `.csv`, `.tsv`, `.txt`; parse workbooks with SheetJS, each sheet a candidate dataset. Size cap (e.g. 20 MB) with a clear message.
- Encoding sniffing: BOM detection, then UTF-8 → Windows-1252 fallback heuristics.
- Build a **column profile** over *all* rows (not 5): fill rate, distinct count, top-10 values, detected type distribution, date-component evidence (any value with day > 12 disambiguates DD/MM vs MM/DD deterministically), min/max, regex shape. Cheap, and it becomes the model's primary input.

### Stage 1 — File understanding (one AI call per file/sheet)
Input: filename, sheet name, first ~30 raw rows *as a grid* (not header-keyed), and the column profile. Output (strict JSON schema): header row index, data start row, `file_type` (clients/bookings/sales/staff/other), platform guess, junk rows/columns to drop, combined datetime columns, date-format verdict with evidence, multi-entity sheets flagged.
This single stage eliminates: manual file labelling, the header-row-1 assumption, the ambiguous-date prompt (almost always decidable from data), and brittle signature-based platform detection.

### Stage 2 — Column mapping (upgrade the existing call)
- Run **automatically on upload**, not behind a button. Platform template (if any) is included as a prior the model can confirm or correct.
- Feed the column profiles, not just 5 rows. Use **structured outputs** (`json_schema`, strict) so the response always validates.
- Extend the transform vocabulary beyond `split`: `datetime_split` (date+time), `extract` (regex capture, e.g. "Jane Smith (07700…)"), `concat`, and **`value_map`** — for enum-ish columns the model returns an explicit raw→canonical table (booking statuses, deposit states, yes/no variants) which code applies and the user can see. This turns `mapBookingStatus`'s keyword guessing into a reviewed, provider-specific table.
- Confidence policy: high → auto-accepted (shown, not asked); medium → pre-selected, one-click confirm; low → asked. Today everything is asked.

### Stage 3 — Value repair (AI only for the residue)
First fix the deterministic normalisers (AM/PM, European decimals, more date formats, country-aware phones via libphonenumber inference). Whatever still fails to parse — typically a fraction of a percent of cells — gets **batched into one AI call per type** ("here are 38 date strings that didn't parse; return ISO or null for each"). Bounded cost, and rows that today silently skip get rescued. Every repaired value is journalled (`raw → repaired, source: ai`) for the review screen.

### Stage 4 — Entity resolution with auto-accept
- Deterministic first: normalised-exact, then fuzzy (trigram/Levenshtein) against the catalogue.
- AI for the remainder, batched ~50 references per call with **per-type candidate shortlists** (top-N fuzzy candidates each), not the whole catalogue dump.
- High-confidence matches auto-accepted; the rest in one list with "accept all suggestions" and per-item override.
- **"Create what's missing"**: offer to bulk-create unmatched services/staff. Better still, for a fresh venue, *propose the whole service catalogue from the bookings file* — median duration and price per distinct service name are sitting in the data. This converts the import tool into an onboarding accelerator.

### Stage 5 — One review screen: the Import Plan
Replace Map/Review/References/Validate as user-facing steps with a single AI-written plain-English plan:

> "From **clients.xlsx** we'll import **1,243 clients** (12 update existing records — matched by email). From **bookings.csv** we'll import **5,876 bookings** across 24 services and 6 staff. We mapped 'Stylist' to your team members — 2 names need your confirmation below. 7 rows have dates we couldn't read (shown below; they'll be skipped unless corrected). Statuses 'CXL'/'NS' were read as Cancelled/No-Show."

Counts, expandable evidence (sample mapped rows side-by-side with source), the handful of genuinely-undecidable items inline, and one primary action: **Approve import**. Wizard steps remain as an "advanced" escape hatch.

### Stage 6 — Execution hardening
- Chunked **batch upserts** inside per-chunk transactions (Postgres RPC), idempotency keyed by `(session, file, row)` — removes per-row N+1 inserts and orphaned partial states; should cut import wall-time by an order of magnitude.
- Keep the checkpoint/resume design — it's good.
- Post-import **AI QA spot-check**: sample ~50 imported records, compare against source rows, surface a fidelity note in the completion screen and report.
- Plain-English skip reasons everywhere; the report CSV already exists — surface it more prominently.

## 6. Model & API engineering notes

- **Fix the temperature bug first** (likely making all current AI silently no-op). Omit `temperature` for GPT-5-family models.
- Move to **structured outputs** (`response_format: { type: 'json_schema', strict: true }`) for every call; today's `json_object` + prompt-described shape is the source of the defensive parsing.
- Add timeout (~30s), 2–3 retries with backoff, `max_output_tokens`, and a per-session token budget log.
- **Cache by input hash** (headers + profile hash): the same provider's export format recurs across customers — most column-mapping calls can become cache hits, and the cache doubles as a growing provider-template library (AI results promoted to deterministic templates over time).
- Model tiering: nano-class is fine for Stages 2–4 (classification against short candidate lists); consider one tier up for Stage 1 file understanding, where an error cascades into everything downstream. Measure with evals before deciding.
- **Build an eval corpus**: a fixtures directory of real anonymised exports (Fresha, Phorest, Booksy, Square, Treatwell, Mindbody, plus deliberately messy Excel files) with golden expected outputs per stage. Deterministic stages run in vitest; AI stages run in an offline eval script reporting accuracy per provider. This is the single highest-leverage investment for "works seamlessly in all situations" — you cannot claim it without a corpus to prove it.
- **PII**: sample rows and reference values (names, emails, phones) are sent to OpenAI. API data isn't used for training by default, but: mask emails/phones in samples where the profile already establishes the type (the model rarely needs real values), and note OpenAI as a subprocessor in your DPA/privacy policy.

## 7. Suggested phasing

**Phase 1 — Fix what's broken (days):** defects #1–#6 above; auto-run AI mapping on upload; stop deleting mappings pre-AI; plain-English skip reasons.

**Phase 2 — Input formats + profiling (1–2 weeks):** XLSX/multi-sheet, encoding detection, size caps, full-file column profiler, deterministic date-format inference, header-row detection (Stage 1 AI call).

**Phase 3 — Decision collapse (2–3 weeks):** structured outputs + transform DSL (`datetime_split`, `value_map`, `extract`), confidence-tiered auto-accept, references auto-accept + bulk create, value-repair batching, the single Import Plan screen.

**Phase 4 — Scale + trust (1–2 weeks):** batch upserts in transactions, eval corpus + CI evals, AI QA spot-check, mapping cache/template library, catalogue-from-bookings proposal for new venues.

The end state: a venue owner drags in whatever files their old system gave them, waits ~30 seconds, reads one plain-English plan, clicks Approve, and gets an accurate, undoable import — with the wizard still there underneath for the rare case that needs a human override.
