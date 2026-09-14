# Venue collectives as one venue: testing plan

Status: PLAN, not implemented. Companion to `Docs/collective-one-venue-plan.md`, which defines the
requirements (R1 to R14), the decisions (D1 to D36) and the red-team findings (RT1-1 to RT1-17,
RT2-1 to RT2-28) this document refers to; read that first. Written 2026-09-13 against `staging` at
`c6020eb6`; line numbers are anchors at that commit plus the two commits the plan's header names (`818ed5a`, `973bd3e`), and the plan's "Reading the citations" note applies here too. Reviewed 2026-09-14 at `c0b5eb0`. It is the safety net for the redesign: what exists today and where it is blind, the strategy, every test, the invariants, the rollout gates and the acceptance checklist for the owner.

## 1. Existing test infrastructure

### What exists (surveyed 2026-09-13, branch staging)

| Tool | Where | Notes |
|---|---|---|
| Vitest 4 | `vitest.config.ts:6-8` | node env, `e2e/**` excluded; 567 test files, 61 use `@vitest-environment happy-dom` |
| `supabase-fake` | `src/lib/testing/supabase-fake.ts` | read-only, applies real filters, throws on unsupported operators (scheduling parity harness) |
| `recording-supabase` | `src/lib/testing/recording-supabase.ts` | records table, op, payload, columns, filters; `inject()` PG errors (`:70-92`); realistic empties (`:26-33`); `makeAfterStub()` (`:121-123`); `queryCount()` budgets |
| Migration column guard | `src/lib/testing/migration-columns.ts` | `columnsMissingFromMigrations(calls)`; committed in `973bd3e` (it was uncommitted while this plan was written), used by one test (`src/app/api/venue/export/route.test.ts:50`) |
| Compliance fake | `src/lib/compliance/test-utils/fake-supabase.ts` | stateful writes for compliance services |
| Parity harness | `src/lib/availability/parity/scheduling-world.ts` | one world through every hours consumer, read and write as a pair |
| Source sweeps | `src/lib/api/customer-api-contract.test.ts`, `src/app/api/mobile-401-contract.test.ts`, `src/lib/availability/schedule-fail-closed-coverage.test.ts` | code vocabulary for account, v1 and venue routes; the app's 401 shapes; fail-closed wrappers |
| pgTAP | `supabase/tests/*.sql` (8 files, 98 assertions) | fixed-UUID fixtures, `SET LOCAL ROLE` plus JWT email claims, rolled back; collectives: `collective_policies_test.sql` (SELECT only), `collective_service_categories_test.sql` |
| CI | `.github/workflows/ci.yml` | lint, typecheck, test, build; `rls-pgtap` (CLI 2.114.0 `:103`, Postgres 17, `local_baseline_grants.sql` `:116-118`, `supabase test db` `:123`); `e2e-smoke` only if `vars.RUN_E2E_SMOKE` (`:160`), on staging |
| Grant checks | `scripts/check-client-executable-functions.mjs`, `scripts/check-table-grants.mjs` | live only, part of the migration ritual (`ci.yml:133-155`) |
| Playwright | `playwright.config.ts` (workers 1, retries 1 on CI, 120 s), 23 specs | public book, Stripe, confirm, reschedule, portal; sign-in by `generateLink` token hash (`e2e/helpers/account-session.ts`) |
| E2E fixtures | `scripts/seed-e2e-smoke-venue.mjs`, `scripts/seed-e2e-portal-customer.mjs`, `Docs/E2E_SMOKE.md` | two single-venue staging fixtures, bookings wiped at run start, teardown warns |
| Manual and live | `Docs/ResNeo-testing.md`; scratch `.mjs` probes; staggered `npx supabase db query --linked` races (`supabase/tests/appointment_slot_guard_test.sql:8-16`) | TEST-prefixed data, severity scale, two-connection proof of 2026-08-29 |
| App | `C:/Resneo-app` d90dece, 1.1.0, Jest | pins today's sync badges (`lib/linked/service-sync-view.test.ts`), not run by web CI |

### Blind spots

1. **Projection-blind doubles** (`supabase-fake.ts:15-16`, compliance fake `:71-75`): a dropped column passes and fails live with 42703, as `guests.name` did in the Compliance dashboard and CSV export until 2026-09-13 (`Docs/reserveni-compliance-spec.md:209`). The guard is untracked and used once.
2. **No double models the database**: no unique keys, FKs, cascades, triggers, RLS, grants or transactions. The compliance fake also uses strict `===` (`:151-152`), returns `data: null` without error from `single()` on zero rows (`:247-251`) and ignores `not()` operators other than IS NULL (`:133-137`). The recording double applies no filters, so wrong filters and unchecked delete errors pass.
3. **`after()` as a no-op** (`src/app/api/venue/bookings/route.card-hold.test.ts:6`, `src/app/api/venue/linked-calendar/booking/route.card-hold.test.ts:7`) hides deferred audit and notices.
4. **No route tests** for `appointment-services`, `practitioner-services`, `addon-groups`, `compliance/requirements` and `types`, collectives create, members and dissolve, `booking/create`, `create-group`, `create-multi-service`, `availability`, `validate-appointment-slot`, `appointment-catalog`, `public/compliance/booking-requirements`, venue hard-delete cron.
5. **Existing collective tests pin the behaviour this redesign reverses** and mock service modules (`collective-booking-override.test.ts`, `service-sync.test.ts`, catalogue `route.sync*.test.ts`, `CombinedPageManager.inline.test.tsx`, the app's `service-sync-view.test.ts`).
6. **pgTAP**: one connection, one rolled-back transaction, frozen `now()`, superuser fixtures, none of PostgREST's rules (STABLE runs read-only, `max_rows = 1000` at `supabase/config.toml:18`).
7. **CI re-grants what migrations revoke**: `local_baseline_grants.sql:44-67` grants DML and SELECT on every public table outside an exclusion list and on all sequences, so an engine table's REVOKE is undone in CI unless the list changes.
8. **Grant audits are partial**: table audit relkinds r, v, m, p only, so no sequences (`20270118120000_bookings_account_safe.sql:97`); function audit skips trigger and invoker functions (`20270109120000_audit_client_executable_functions.sql:53-54`); table contracts cover 6 relations. CLI skew: `package.json` `test:db` pins 2.98.2.
9. **E2E can pass by skipping** (`e2e/global-setup.ts:12-17`); one Stripe account, no collective fixture, no email coverage, Stripe iframe not drivable from the preview browser.
10. **App contract** covers only 401 shapes and code names, not payloads, although the app resends variants, add-on links with re-indexed `sort_order` and `deposit_pence: 0` on every admin save (`C:/Resneo-app/app/(app)/manage/services.tsx:1221-1314`).
11. **Memos are per process and per route bundle** (`src/lib/linked-accounts/catalogue.ts:740-757`); no performance net beyond a few `queryCount` checks and the 2026-09-05 numbers (collective host form 6.6 s before the fix, catalogue 1.3 s cold and 0.2 s warm after).
12. **Staging residue changes results**: the archived PPD Patch Test at Light 3 (d1a15afc, created and archived by a live check on 2026-09-06) cannot be deleted because `compliance_audit_events` refuses UPDATE and DELETE, FK actions included (`20261203120000_compliance_records.sql:198-217`); it is the row that makes the staging migration collide. `admin_hard_delete_venue` disables `events_append_only` but not this trigger (`20260518120000_venue_delete_terminate_account_links.sql:103`): deleting a venue with compliance audit events is UNVERIFIED.
13. **Flag probes are not proof**: environment variables override every appointments flag (`src/lib/feature-flags/resolve.ts:9-16`); Vercel env values are UNVERIFIED.
14. **No cron or alert coverage at all.** `withCronRunLogging` (`src/lib/platform/cron-log.ts`) and `finalizeCronRun` (`src/lib/cron/finalize-cron-run.ts`) are untested, `cron_runs` is asserted nowhere, and no test proves a cron route refuses an unauthorised caller. This design adds two crons that write into other venues' accounts behind `CRON_SECRET`, a single static token on routes the middleware does not cover (`src/middleware.ts:352`), so the wrapper they depend on needs tests before they ship (OPS-01).
15. **The only platform-console coverage is auth shape.** Nothing tests what a superuser can see or do, and this design adds a surface that reads every collective's state across venues (OPS-03).
16. **Nothing stops an em-dash reaching a help article.** The existing copy tests cover booking copy and the assistant's answers, not `src/lib/help/articles/**`, and this project rewrites roughly twenty articles under a rule that forbids them (HLP-01).

## 2. Strategy

### Design under test

Model R with the red-team amendments: revision-based links (`desired_revision`, `applied_revision`, `behind_since`, `lease_until`) bumped by one SECURITY DEFINER trigger per event per table inside the writer's transaction; `collective_apply_replica` locks the link row and records the revision it read; engine functions VOLATILE with a function-level `SET resneo.collective_engine = 'on'`; locks only for replicas of active memberships in active replicas collectives, released by status triggers; offered-master delete and `host_venue_id` changes refused in the database; transfer re-keys every `replica_of_*`; revisions in `collective_catalogue_revisions`; every replicated column classified; snapshots backfilled for all appointment bookings, filled by a BEFORE INSERT fallback and read first by settling paths; compliance served from the owning venue's managed type; D3 redirects only when live and listed; replicas mode for new collectives behind a platform flag. Where the owner still has to choose, the test names the decision so it cannot pass while the choice is open.

### Layers

| Layer | Where | Proves |
|---|---|---|
| unit and sweeps | Vitest `test` job | terms resolver, guard normaliser, redirect decision; filesystem sweeps (guarded writers, snapshot writers, status writers, registered codes, no em-dash) |
| route | Vitest + `recording-supabase` + `columnsMissingFromMigrations` + `makeAfterStub()` | status, code, prose, guard before any write, zero writes on refusal, projections, deferred notices |
| component | Vitest happy-dom | copy, locked controls, ConfirmContext dialogs, no names across venues |
| pgtap | CI `rls-pgtap` | schema, grants, locks, convergence per child type, unique-key safety, lifecycle transactions, snapshot backfill, invariant function with positive controls |
| engine-invariant | CI step, several `psql` sessions on one local database | lost updates, sibling propagation, leases, lock order, assignment and booking races |
| migration | local plus staging rehearsal | expand inert, idempotent backfills, honest dry run, convergence, rollback |
| app-contract | Vitest golden replays; live Bearer replay on staging fixtures | old builds get 200 or readable coded 409s |
| e2e | Playwright on staging collective fixtures | guest and staff journeys across venues, member Stripe, forms, redirects |
| live-staging | service-role scripts on fixtures; read-only probes on plus-1 | hosted grants, pooler, timings |
| performance | Vitest query counts (blocking); local and staging timing (deploy gates) | no N+1, trigger overhead, apply and drain, staff form, public availability |
| security | pgTAP, PostgREST contract, live grant checks | no client path into engine tables, sequences, functions or the flag; no PII across venues |
| manual | owner, device with app 1.1.0, solicitor | acceptance R1 to R14, legal text, help accuracy |

### Risk codes

RT1 (engine-data-deploy): 1 queue loses changes; 2 transfer orphans mappings; 3 managed form slug collision; 4 locks outlive membership; 5 offered master delete; 6 PATCH writes replicas and guard misfires; 7 trigger and flag mechanics; 8 snapshot scope; 9 production migration state; 10 denylist copies future columns; 11 unapplied replicas published; 12 CSA races; 13 member services borrow managed items; 14 revision hot row; 15 photo URLs; 16 option churn and headings; 17 grants, actor, cross-venue dialog.
RT2 (product-lifecycle-engine): 1 snapshot not read when settling; 2 member-calendar form capture; 3 redirect liveness; 4 transfer re-key; 5 flag gating; 6 forms off at members; 7 slug collision; 8 app joins without consent; 9 no-Stripe leaver; 10 member-only services; 11 cross-venue groups; 12 D17 audit and rights; 13 staff form copies clients; 14 legal identity; 15 Stripe readiness; 16 columns not to copy; 17 per-calendar values; 18 public freshness; 19 app stale PUT and false 409s; 20 adoption; 21 future data migrations and import undo; 22 deep links and dissolve; 23 notice and re-consent; 24 member venue-wide forms; 25 venue settings; 26 engine details; 27 withdraw and re-join; 28 replicas mode before soak.
H: PROJ projection-blind fakes; AFTER no-op `after()`; C0 hosted grants; RECUR policy recursion; SEAM backfill and dual-write; MAXROWS PostgREST cap; RESIDUE undeletable staging rows; VACUOUS suites that skip green.

### Fixtures

- **Vitest**: `src/lib/testing/collective-world.ts`: host H (Stripe, forms on), member A (Stripe, forms on), member B (no Stripe, forms off, archived same-slug PPD type), outsider O; calendars H1 H2 A1 A2 B1; masters S1 plain, S2 variants plus two add-on groups plus processing, S3 deposit, S4 card hold, S5 inline PPD form with file field, S6 under a host venue-wide form, S7 inactive; member-only services (one sharing a master name); A1 custom price and duration; past, future, variant, add-on and cancelled bookings; links in every revision state. Every emitted row must pass the column guard.
- **Golden app payloads**: `src/app/api/__app-contract__/fixtures/` generated from `C:/Resneo-app` d90dece and stamped with the commit.
- **SQL**: the same world at fixed UUIDs in `supabase/test-fixtures/collective_world.sql` (psql include support on CLI 2.114.0 UNVERIFIED; fallback generates files), a legacy-shape variant with staging drift and dissolved residue, and `pg_temp.collective_scale(50, 10)` for nightly runs.
- **Staging**: `scripts/seed-e2e-collective.mjs` creates `e2e-coll-host`, `e2e-coll-member-a` (second Stripe test account), `e2e-coll-member-b` (no Stripe), accepted links and staff users on `@resneo-e2e.invalid` (run by the owner because it creates auth users). It refuses non-`e2e-coll-` venues and any project but staging. plus-1 and Light 3 are never fixtures.

### Testing the engine inside Postgres

1. One scenario file per concern, each ending with `collective_invariant_report()` all zero.
2. Apply returns write counts per table: a second apply must be all zeros with no audit row (idempotency oracle).
3. `collective_replica_projection(link)` returns master and replica sides as `jsonb` with identities mapped, so failures print the differing keys.
4. Enumerate rather than list: columns from `pg_attribute`, unique indexes from `pg_index`; anything new fails until classified or covered.
5. Every lock tested refusing (service role outside the engine, authenticated member admin) and allowing (engine, FK cascade, sort_order only); every invariant has a seeded violation counting exactly 1.
6. Engine functions take `p_now`, so leases, backoff and the 15-minute lag work in a frozen transaction.
7. Deterministic races: engine functions call `collective_engine_test_point(text)`, a revoked no-op in migrations that the local harness replaces with an advisory-lock wait; a conductor pauses session A after the master read. Needs the lead's approval before Pass A.
8. `setseed()` fuzz of master mutations and apply orders (50 rounds in CI, 1,000 nightly).
9. PostgREST contract script against the local API with anon, service and minted authenticated JWTs (local HS256 secret UNVERIFIED on CLI 2.114.0).

### Live checks on shared staging data

- Write only to `e2e-coll-*` fixtures. plus-1 gets read-only snapshots before and after each pass; its only writes are the owner-approved Pass B apply and a dedicated `[coll-test]` service that is created, checked, withdrawn and archived with the owner's agreement.
- Keep a ledger of created ids per run; clean up in reverse; archive what cannot be deleted; print the residue.
- Never run `supabase/scripts/truncate_app_data.sql` or the smoke seed against venues holding replicas (`scripts/seed-e2e-smoke-venue.mjs:173` updates `service_items`). Book inside the 365-day guest window, wipe fixture bookings at run start, never in parallel with `e2e-smoke`. Fixture mail goes to `.invalid`; assert queued rows, not delivery.

### Cleanup traps

1. `collective_audit_events` is append-only without FK: rows outlive the collective.
2. `compliance_audit_events` refuses UPDATE and DELETE including FK actions, so engine-created forms, and guests, records, links and staff they touch, cannot be deleted: archive types instead. This is how H-RESIDUE happened.
3. Dissolve frees the slug (`dissolved-<id>`, `src/app/api/venue/collectives/[id]/route.ts:254-258`) but holds the name 30 days for other hosts (`src/app/api/venue/collectives/route.ts:107-122`): use run-unique names.
4. Fixture guests stay unless deleted; bookings need Cancelled then DELETE; Stripe test objects cannot be removed; copied photos must be deleted from storage.
5. Deleting fixture links cascades `account_link_audit_log`: export evidence first. Archived offerings accumulate (plus-1 holds 91): count, never delete, on plus-1.

## 3. Test inventory

147 tests. By layer: route 45, unit 35, pgtap 29, e2e 6, live-staging 6, migration 6, security 4, engine-invariant 4, performance 4, component 3, app-contract 3, manual 2.

The first 113 came from the first pass. The 34 added by the second pass (OPS, MV, REP, BM, PLAN, SEO, WAIT, FAIR, DIARY, HLP, TERMS-16, CSA-04, DB-10 and SEC-03 to SEC-05) cover the areas it reached that the first did not: operations and alerting, people who work at more than one venue, reporting and attribution, booking models other than appointments, plan tiers and caps, the public page's metadata and waitlist, diary truth, and the help centre's own copy rules. They are detailed in §3.28.

### 3.1 Index

| id | layer | title | workstream |
|---|---|---|---|
| INF-01 | unit | Projection guard committed and extended to write payloads | WT Test harness |
| INF-03 | unit | Collective world builder is internally consistent | WT Test harness |
| INF-05 | pgtap | Shared SQL fixture include works on the pinned CLI | WT Test harness |
| INF-08 | security | CI baseline grants do not re-grant engine tables or sequences | W15 Grants |
| INF-09 | unit | Route tests for collective, service and booking routes run after() callbacks | WT Test harness |
| INF-11 | live-staging | Collective fixture seed is idempotent and fenced | WT Test harness |
| INF-12 | e2e | Collective suite cannot pass by skipping | WT Test harness |
| INF-13 | live-staging | Cleanup ledger removes what it can and reports the rest | WT Test harness |
| INF-15 | migration | Migration lint catches the known bad shapes | WT Test harness |
| INF-16 | unit | Legacy tests are retired deliberately, not patched to green | W14 Contract |
| MIG0-01 | migration | Production migration state is known before any push | W0 Owed migrations and probes |
| MIG0-02 | migration | Owed migrations ship alone with their invariants | W0 Owed migrations and probes |
| TERMS-01 | unit | One terms resolver: precedence table | W1 Booking correctness |
| TERMS-02 | unit | Flag off never charges a stored custom value | W8 Per-calendar fields |
| TERMS-03 | unit | Parity world: every path prices and sizes a calendar identically | W1 Booking correctness |
| TERMS-04 | unit | No custom value reads outside the resolver | W1 Booking correctness |
| TERMS-05 | route | Collective creates charge and reserve the calendar's own terms on every create route | W1 Booking correctness |
| TERMS-09 | unit | Collective day slots equal the member's own page slots | W4 Catalogue and booking switch |
| TERMS-12 | unit | Combined catalogue lists each calendar with its own values | W4 Catalogue and booking switch |
| TERMS-13 | unit | Displayed deposit, buffer and name equal what is charged and emailed | W8 Per-calendar fields |
| TERMS-14 | route | Services GET returns effective gated values | W8 Per-calendar fields |
| TERMS-15 | route | Currency and timezone gates | W7 Lifecycle |
| PRICE-01 | pgtap | Snapshot column and BEFORE INSERT fallback | W1 Booking correctness |
| PRICE-02 | pgtap | Backfill covers past and future and is re-runnable | W1 Booking correctness |
| PRICE-03 | unit | Every appointment bookings insert writes the snapshot | W1 Booking correctness |
| PRICE-04 | unit | Settling readers use stored total, then snapshot, then live | W1 Booking correctness |
| PRICE-05 | route | Charge route collects the agreed amount after a host price change | W1 Booking correctness |
| PRICE-06 | pgtap | New staff booking detail bundle returns the snapshot | W1 Booking correctness |
| PRICE-07 | unit | Past revenue does not move when the host edits a price | W1 Booking correctness |
| PRICE-09 | route | Staff modify rewrites the snapshot only when service or option changes | W1 Booking correctness |
| PRICE-10 | pgtap | Adoption, transfer and re-join snapshot first | W7 Lifecycle |
| PRICE-11 | route | Staff visits and groups require a staff session and stamp the actor | W1 Booking correctness |
| CSA-01 | route | Calendar assignment saves are diffs with ownership and error checks | W2 Calendar assignments |
| CSA-02 | route | Stale full-set PUT cannot erase the host's assignment | W2 Calendar assignments |
| CSA-03 | route | All seven per-calendar values stored, gated and writable by the right people | W8 Per-calendar fields |
| DB-01 | pgtap | Engine objects: grants, definer, search_path, volatility, flag clause | W3 Engine |
| DB-02 | pgtap | Engine flag does not leak and refusals are distinguishable | W3 Engine |
| DB-03 | pgtap | Lock predicate: replicas and managed objects of live memberships only | W3 Engine |
| DB-04 | pgtap | Status triggers release in the same transaction | W7 Lifecycle |
| DB-05 | pgtap | Offered master delete and host change are refused in the database | W3 Engine |
| DB-06 | pgtap | Dirty triggers bump every affected link and nothing else | W3 Engine |
| DB-07 | pgtap | Every replicated-table column is classified; not-copied columns never copy | W3 Engine |
| DB-08 | pgtap | Revision table bumps from every source; name hold untouched | W3 Engine |
| DB-09 | pgtap | Venue hard delete with replicas, managed forms and audit rows | W7 Lifecycle |
| ENG-01 | pgtap | Service row converges and a second apply writes nothing | W3 Engine |
| ENG-02 | pgtap | Variants keyed by mapping, deactivated never deleted | W3 Engine |
| ENG-03 | pgtap | Add-on groups managed per member; options updated in place | W3 Engine |
| ENG-04 | pgtap | Headings mapped by id, renamed in place | W3 Engine |
| ENG-05 | pgtap | Compliance adoption, requirement merge and version no-churn | W3 Engine |
| ENG-06 | pgtap | No unique index can break an apply | W3 Engine |
| ENG-07 | pgtap | Fingerprints map identities and detect any replicated change | W3 Engine |
| ENG-08 | pgtap | Randomised convergence | W3 Engine |
| REV-01 | pgtap | Revision bookkeeping cannot skip a change or a sibling | W3 Engine |
| REV-02 | route | Replication cron claims with leases and backs off | W3 Engine |
| REV-03 | route | Daily verifier repairs and alerts | W3 Engine |
| REV-04 | unit | Freshness before pricing, per audience | W4 Catalogue and booking switch |
| REV-05 | route | Host saves drain inline and report per venue | W5 Host Services page |
| CON-01 | engine-invariant | Host save during an apply and sibling members lose nothing | W3 Engine |
| CON-02 | engine-invariant | Overlapping crons never apply the same link twice | W3 Engine |
| CON-03 | engine-invariant | Lock order: release, offer, join, transfer and apply never deadlock or leak | W7 Lifecycle |
| CON-04 | engine-invariant | Assignment and booking races | W4 Catalogue and booking switch |
| CAT-01 | unit | Derived catalogue: assignments are the only truth, with exclusions | W4 Catalogue and booking switch |
| CAT-02 | route | Server re-evaluates exclusions and Stripe readiness | W4 Catalogue and booking switch |
| CAT-03 | unit | Presentation, attribution and read-only renders | W4 Catalogue and booking switch |
| CMP-01 | route | Forms on a member calendar are served and captured at the owning venue | W4 Catalogue and booking switch |
| CMP-02 | route | Compliance enablement, record acceptance and member venue-wide forms | W4 Catalogue and booking switch |
| CAT-04 | unit | Retired offerings keep existing bookings manageable | W4 Catalogue and booking switch |
| OFF-01 | route | Offerings routes: offer, withdraw, member calendars | W5 Host Services page |
| OFF-02 | route | Services PATCH and GET for hosts | W5 Host Services page |
| OFF-03 | route | Deleting or switching off an offered master | W5 Host Services page |
| OFF-04 | route | Notices go to the right people, promptly and without guest data | W5 Host Services page |
| UI-H-01 | component | Host Services page shows reach and never uses window.confirm | W5 Host Services page |
| GRD-01 | route | Replica calendar-only and unchanged saves write nothing to the service | W6 Member locks and UI |
| GRD-02 | route | Any real change to a replica is refused before any write | W6 Member locks and UI |
| GRD-03 | route | Add-on and compliance guards, including members borrowing managed items | W6 Member locks and UI |
| GRD-04 | unit | Every service-table writer is guarded, and database refusals map to 409 | W6 Member locks and UI |
| GRD-05 | route | Member-side allowed paths and import behaviour | W6 Member locks and UI |
| UI-M-01 | component | Member Services and Calendar Availability pages | W6 Member locks and UI |
| LIFE-01 | route | Create, invite and accept: exclusivity, eligibility and consent | W7 Lifecycle |
| LIFE-02 | pgtap | Join and D1 adoption are reviewed, mapped and snapshotted | W7 Lifecycle |
| LIFE-03 | pgtap | Leaving is lossless and unlocks everything | W7 Lifecycle |
| LIFE-04 | route | Leave, remove and dissolve routes, with notices and photos | W7 Lifecycle |
| LIFE-05 | pgtap | Host transfer re-keys mappings and then applies nothing | W7 Lifecycle |
| LIFE-06 | route | Transfer is a request with consent; reconcile no longer transfers silently | W7 Lifecycle |
| LIFE-07 | unit | All membership and status writers go through lifecycle code | W7 Lifecycle |
| LIFE-08 | route | Staff authority, audit and contacts across venues | W7 Lifecycle |
| MIG-01 | migration | Dry run tells the whole truth | W9 Migration |
| MIG-02 | migration | Apply converges per link, resumably, without changing any total | W9 Migration |
| MIG-03 | migration | Rollback restores the legacy page and can be re-applied | W9 Migration |
| MIG-04 | live-staging | Staging rehearsal then plus-1 migration | W9 Migration |
| PUB-01 | unit | Own pages redirect only when the member is really bookable there | W10 Booking pages and links |
| PUB-02 | route | Redirects keep the guest's place; member-only links do not dead-end | W10 Booking pages and links |
| PUB-03 | component | Guests see who they are booking with | W10 Booking pages and links |
| MGR-01 | route | Old catalogue actions are shimmed with coded answers | W11 Manager fold |
| VEN-01 | unit | Venue-level settings are inventoried and differences are visible | W7 Lifecycle |
| APP-01 | app-contract | App 1.1.0 service saves against replicas and masters | W12 Mobile contract |
| APP-02 | app-contract | App toggles, overrides, add-ons, forms and membership actions | W12 Mobile contract |
| APP-03 | app-contract | Additive reads and diary routing for old builds | W12 Mobile contract |
| APP-04 | live-staging | Live Bearer replay and device check | W12 Mobile contract |
| SEC-01 | security | PostgREST gives clients no way into the engine | W15 Grants |
| SEC-02 | security | No client data crosses venues through new surfaces | W15 Grants |
| PERF-01 | performance | Baseline and staff form open budget | W4 Catalogue and booking switch |
| PERF-02 | performance | Public availability budget | W4 Catalogue and booking switch |
| PERF-03 | performance | Engine and trigger budgets | W3 Engine |
| PERF-04 | performance | Query counts do not grow with offerings or members | W4 Catalogue and booking switch |
| E2E-01 | e2e | Guest books a member calendar with deposit and a patch test form | W4 Catalogue and booking switch |
| E2E-02 | e2e | Host edit reaches the member, which cannot edit but can choose calendars | W5 Host Services page |
| E2E-03 | e2e | Leave and dissolve journeys | W7 Lifecycle |
| E2E-04 | e2e | Staff diary, cross-venue groups and the 375px layout | W7 Lifecycle |
| LIVE-01 | live-staging | Engine smoke and a real two-connection race on staging fixtures | W3 Engine |
| LIVE-02 | live-staging | Soak on staging and 48 h production watch | W9 Migration |
| MAN-01 | manual | Owner acceptance and legal sign-off | W0 Owed migrations and probes |
| MAN-02 | manual | Help centre, docs and app handover | W13 Help and docs |
| OPS-01 | route | Replication and verifier crons authorise, log to `cron_runs` and report errors to Sentry | W18 Operations |
| OPS-02 | route | The verifier repairs only I3 and I5, audits every repair as its own event type, and alerts on the rest | W18 Operations |
| OPS-03 | route | Platform collective panel is superuser-only, read-only apart from Retry, audited, and shows no guest contact details | W18 Operations |
| OPS-04 | unit | Every cron route directory has a `vercel.json` entry, and every entry has a route | WT Test harness |
| MV-01 | unit | A person with staff rows at two venues resolves to a chooser, never to null | W16 Multi-venue people |
| MV-02 | route | Staff invite refuses an email that already works at another venue, with the plain reason | W16 Multi-venue people |
| MV-03 | route | The acting venue is validated against the caller's own staff rows on every venue route | W16 Multi-venue people |
| MV-04 | e2e | An owner of two venues in one collective signs in once and moves between them | W16 Multi-venue people |
| REP-01 | unit | `bookings.collective_id` and the collective `source` value are read by every report, filter and export | W17 Reporting |
| REP-02 | route | Booked revenue breaks down by venue and never blends without naming the venues | W17 Reporting |
| REP-03 | route | A member sees its own venue only; a host sees no member's guest contact details | W17 Reporting |
| REP-04 | unit | `buildPriceSummary` reads the snapshot first and agrees with `loadRowTotalResolver` | W1 Booking correctness |
| REP-05 | route | Narrowing a link does not silently remove a revenue column while membership continues | W17 Reporting |
| BM-01 | route | Invite and accept refuse a venue with no active appointments model, with the reason | W20 Booking models |
| BM-02 | route | Removing `unified_scheduling` while in a collective is refused with a coded 409 | W20 Booking models |
| BM-03 | unit | The redirect leaves a route through for a member's classes, events, tables and resources | W20 Booking models |
| BM-04 | route | Currency is gated at create, invite and accept, as timezone already is | W20 Booking models |
| BM-05 | unit | Two venues cannot be told a shared resource is safe: the product says it is unsupported | W20 Booking models |
| BM-06 | route | A multi-service visit that would span venues is refused with the explanation, before the details step | W20 Booking models |
| PLAN-01 | unit | Collective eligibility matches `evaluateLinkEligibility`: trials, cancellation windows and comped venues stay in; failed payments and expired plans do not | W7 Lifecycle |
| PLAN-02 | route | Invite and accept refuse an ineligible venue and say why (CB-31) | W7 Lifecycle |
| PLAN-03 | unit | A member at its plan's calendar cap shows the cap on both sides, and a host cannot exceed it by assigning calendars | W5 Host Services page |
| SEO-01 | unit | Every `/book` route has metadata; `/book/c/{slug}` carries a canonical, an Open Graph image and a robots directive | W19 Public identity |
| SEO-02 | unit | An adopted address and the collective address do not serve two uncanonicalised copies of one page | W19 Public identity |
| WAIT-01 | route | The synthetic venue publishes the full resolved flag set, and the waitlist works on the collective page | W19 Public identity |
| FAIR-01 | unit | "Any available" on the collective applies the configured order and does not favour the host | W19 Public identity |
| DIARY-01 | route | Partner columns are drawn from the resolved schedule, not the weekly template | W21 Diary truth |
| HLP-01 | unit | No help article contains an em-dash, and no rewritten article still describes sync, Link, Unlink or member-owned prices | W13 Help and docs |
| TERMS-16 | unit | The month loader applies a per-calendar length once, not twice | W1 Booking correctness |
| CSA-04 | pgtap | Deleting a calendar that held a live replica's assignment writes an audit row and bumps the revision | W3 Engine |
| DB-10 | pgtap | Every classified column's entry matches what an apply actually writes | W3 Engine |
| SEC-03 | route | A pre-booking form files at the venue that will hold the booking | W4 Catalogue and booking switch |
| SEC-04 | pgtap | Drift the engine cannot explain is audited and alerted, not quietly repaired | W3 Engine |
| SEC-05 | security | New per-calendar and attribution columns are not readable by `anon` | W15 Grants |

### 3.2 Test infrastructure

#### INF-01: Projection guard committed and extended to write payloads

- **Layer:** unit. **Workstream:** WT Test harness. **Requirements:** R4,R11.
- **Pins:** H-PROJ
- **Scenario:** Recorded calls include a select of a dropped column, an insert with service_price_snapshot_pence on a table lacking it, and an upsert onConflict naming a missing column.
- **Expected:** columnsMissingFromMigrations reports all three; the file is tracked in git.
- **Location:** `src/lib/testing/migration-columns.test.ts`

#### INF-03: Collective world builder is internally consistent

- **Layer:** unit. **Workstream:** WT Test harness. **Requirements:** R1,R2.
- **Pins:** H-PROJ
- **Scenario:** Build the world (host, members A and B, outsider, masters S1 to S7, replicas in every revision state, bookings) and validate it.
- **Expected:** Every row passes the migration column check; venue ids of children match their parents; no cross-venue CSA.
- **Location:** `src/lib/testing/collective-world.test.ts`

#### INF-05: Shared SQL fixture include works on the pinned CLI

- **Layer:** pgtap. **Workstream:** WT Test harness. **Requirements:** R1.
- **Pins:** Harness mechanics (UNVERIFIED include support)
- **Scenario:** A pgTAP file includes supabase/test-fixtures/collective_world.sql with a psql ir include under supabase test db 2.114.0.
- **Expected:** Fixture rows exist and plan passes; if includes fail, the generator fallback writes supabase/tests/generated files and this test switches to them.
- **Location:** `supabase/tests/collective_fixture_smoke_test.sql`

#### INF-08: CI baseline grants do not re-grant engine tables or sequences

- **Layer:** security. **Workstream:** W15 Grants. **Requirements:** R12.
- **Pins:** H-C0; RT1-17; blind spot 7
- **Scenario:** After local_baseline_grants.sql runs, query has_table_privilege and has_sequence_privilege for anon and authenticated on the four engine tables and collective sequences.
- **Expected:** All false; adding a new engine table without updating the exclusion list fails this test.
- **Location:** `supabase/tests/collective_grants_test.sql`

#### INF-09: Route tests for collective, service and booking routes run after() callbacks

- **Layer:** unit. **Workstream:** WT Test harness. **Requirements:** R7,R13.
- **Pins:** H-AFTER
- **Scenario:** Sweep test files under the listed route folders for after: vi.fn() without an implementation.
- **Expected:** Zero offenders; the two known card-hold files are converted to makeAfterStub().
- **Location:** `src/lib/testing/after-stub-sweep.test.ts`

#### INF-11: Collective fixture seed is idempotent and fenced

- **Layer:** live-staging. **Workstream:** WT Test harness. **Requirements:** R1.
- **Pins:** H-RESIDUE; shared staging
- **Scenario:** Run scripts/seed-e2e-collective.mjs twice; then run it with a venue slug not prefixed e2e-coll- and with a production URL.
- **Expected:** Second run changes no ids and wipes only fixture bookings; the fenced runs exit non-zero before any write.
- **Location:** `scripts/seed-e2e-collective.mjs (self-check mode)`

#### INF-12: Collective suite cannot pass by skipping

- **Layer:** e2e. **Workstream:** WT Test harness. **Requirements:** R1.
- **Pins:** H-VACUOUS
- **Scenario:** Run Playwright on CI with RUN_E2E_SMOKE true but E2E_COLLECTIVE_HOST_SLUG unset.
- **Expected:** globalSetup throws with the missing variable names; the job fails.
- **Location:** `e2e/global-setup.ts`

#### INF-13: Cleanup ledger removes what it can and reports the rest

- **Layer:** live-staging. **Workstream:** WT Test harness. **Requirements:** R13,R14.
- **Pins:** H-RESIDUE; append-only tables
- **Scenario:** After LIVE-01 run cleanup from the ledger in dry-run then real mode.
- **Expected:** Deletes bookings, links, services, calendars in reverse order; archives compliance types; lists residue (collective_audit_events, compliance_audit_events rows) by id; exit 0.
- **Location:** `scripts/coll-test-cleanup.mjs`

#### INF-15: Migration lint catches the known bad shapes

- **Layer:** migration. **Workstream:** WT Test harness. **Requirements:** R12.
- **Pins:** RT1-7; RT1-9; RT2-21; H-RECUR; H-C0
- **Scenario:** Feed fixture migrations: multi-event trigger with transition tables, table without REVOKE, sequence without REVOKE, STABLE writer, policy subquerying venue_collective_members, DEFINER without search_path, UPDATE service_items without bypass preamble, DROP without IF EXISTS.
- **Expected:** Each is reported with file and line; the real migrations folder passes.
- **Location:** `scripts/check-migrations.test.mjs`

#### INF-16: Legacy tests are retired deliberately, not patched to green

- **Layer:** unit. **Workstream:** W14 Contract. **Requirements:** R6,R11.
- **Pins:** Blind spot 5
- **Scenario:** Register lists collective-booking-override.test.ts, service-sync.test.ts, catalogue route.sync tests, CombinedPageManager.inline set_providers case and app service-sync-view.test.ts with the pass that retires each.
- **Expected:** Fails if a legacy module is deleted while its test remains, or a listed test changes expectations without a register note.
- **Location:** `src/lib/testing/legacy-test-register.test.ts`

### 3.3 Pass 0: owed migrations

#### MIG0-01: Production migration state is known before any push

- **Layer:** migration. **Workstream:** W0 Owed migrations and probes. **Requirements:** R12.
- **Pins:** RT1-9
- **Scenario:** Run supabase migration list against production and staging before Pass 0 and Pass A.
- **Expected:** Pending sets recorded; Pass A proceeds only when the pending set is exactly its two files.
- **Location:** `Docs/release-notes/collective-replicas.md (ritual record)`

#### MIG0-02: Owed migrations ship alone with their invariants

- **Layer:** migration. **Workstream:** W0 Owed migrations and probes. **Requirements:** R4,R9.
- **Pins:** RT1-9; RT1-6 (non-canonical rows)
- **Scenario:** Push 20270202120000 to 20270209120000 on production as Pass 0.
- **Expected:** Non-canonical shapes 0, rota calendars without schedule_periods 0, sync columns present, staff read of venue_collectives without recursion; grant checks pass.
- **Location:** `scripts/pass0-invariants.mjs`

### 3.4 One terms resolver

#### TERMS-01: One terms resolver: precedence table

- **Layer:** unit. **Workstream:** W1 Booking correctness. **Requirements:** R8,R9.
- **Pins:** RT2-5; verification finding 3
- **Scenario:** resolveCalendarServiceTerms over variant or none, CSA custom price, duration, buffer, deposit set or null, each flag on or off, add-ons.
- **Expected:** Price variant then calendar (flag on) then service; duration likewise then add-on minutes; buffer and deposit only with flag on; card-hold deposit floor 100p.
- **Location:** `src/lib/booking/calendar-service-terms.test.ts`

#### TERMS-02: Flag off never charges a stored custom value

- **Layer:** unit. **Workstream:** W8 Per-calendar fields. **Requirements:** R8.
- **Pins:** RT2-5
- **Scenario:** Flags turned off after values were stored; decision D6 money fields cleared with audit, cosmetic ignored.
- **Expected:** Resolver returns base values; turning the flag back on does not resurrect a cleared price or deposit.
- **Location:** `src/lib/booking/calendar-service-terms.test.ts`

#### TERMS-03: Parity world: every path prices and sizes a calendar identically

- **Layer:** unit. **Workstream:** W1 Booking correctness. **Requirements:** R1,R8,R9.
- **Pins:** RT2-5; RT2-17; verification finding 3
- **Scenario:** One collective world through venue catalogue, combined catalogue, day, month, chain availability, validate-slot, create, create-multi-service, create-group, staff create, staff modify, guest reschedule, email enrichment, payment summary, visits services route, import defaults, any-practitioner.
- **Expected:** Identical price, duration, buffer and deposit per calendar and variant on every probe; a path with local precedence code fails.
- **Location:** `src/lib/linked-accounts/replicas/parity/terms-parity.test.ts`

#### TERMS-04: No custom value reads outside the resolver

- **Layer:** unit. **Workstream:** W1 Booking correctness. **Requirements:** R8.
- **Pins:** RT2-5
- **Scenario:** Sweep src for custom_price_pence, custom_duration_minutes, custom_buffer_minutes, custom_deposit_pence reads.
- **Expected:** Only the resolver, its loaders and the override and CSA write routes appear.
- **Location:** `src/lib/booking/calendar-terms-sweep.test.ts`

#### TERMS-05: Collective creates charge and reserve the calendar's own terms on every create route

- **Layer:** route. **Workstream:** W1 Booking correctness. **Requirements:** R8,R9.
- **Pins:** verification finding 3 (base-price override, dropped custom duration)
- **Scenario:** POST booking/create, venue/bookings (staff), create-group and create-multi-service via the combined page on member calendar A1 (custom price 2200, duration 50, deposit service).
- **Expected:** Every route bases deposit and snapshot on 2200 and ends the booking at start plus 50 plus buffer; no base-price substitution and no collective_duration_override.
- **Location:** `src/app/api/booking/create/route.collective.test.ts (plus sibling route.collective tests)`

#### TERMS-09: Collective day slots equal the member's own page slots

- **Layer:** unit. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R9.
- **Pins:** RT2-18
- **Scenario:** Same calendar, service and variant (with buffer and processing) through loadCollectiveDayAvailability and the owning venue's own day engine; repeat for month dates and a chain with a 4 h notice window.
- **Expected:** Identical ordered start lists and dates; chain respects each service's window.
- **Location:** `src/lib/linked-accounts/collective-booking-bridge.parity.test.ts`

#### TERMS-12: Combined catalogue lists each calendar with its own values

- **Layer:** unit. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R5,R8.
- **Pins:** verification finding 3 (first-calendar dedupe)
- **Scenario:** A1 custom 2200 and A2 base 2500 for the same replica.
- **Expected:** Two providers with 2200 and 2500; offering shows a from price label.
- **Location:** `src/lib/linked-accounts/replicas/catalogue.test.ts`

#### TERMS-13: Displayed deposit, buffer and name equal what is charged and emailed

- **Layer:** unit. **Workstream:** W8 Per-calendar fields. **Requirements:** R9,R11.
- **Pins:** RT2-17
- **Scenario:** Calendar custom deposit and buffer on A1; name delegation per decision.
- **Expected:** Catalogue, create, confirmation email and service_name_snapshot agree.
- **Location:** `src/lib/linked-accounts/replicas/catalogue-display.test.ts`

#### TERMS-14: Services GET returns effective gated values

- **Layer:** route. **Workstream:** W8 Per-calendar fields. **Requirements:** R8.
- **Pins:** RT2-5
- **Scenario:** GET /api/venue/appointment-services for a staff member whose flag is off but a value is stored.
- **Expected:** practitioner_services show effective values; no client-side merge needed; five new fields no longer hard-coded null.
- **Location:** `src/app/api/venue/appointment-services/route.get.test.ts`

#### TERMS-15: Currency and timezone gates

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R1,R2.
- **Pins:** graft 4
- **Scenario:** Create, invite and accept with a EUR member; PATCH /api/venue timezone while in a live collective.
- **Expected:** Refused with coded 409 and plain prose; timezone unchanged.
- **Location:** `src/app/api/venue/collectives/route.gates.test.ts`

### 3.5 Price snapshot

#### PRICE-01: Snapshot column and BEFORE INSERT fallback

- **Layer:** pgtap. **Workstream:** W1 Booking correctness. **Requirements:** R9.
- **Pins:** RT1-8
- **Scenario:** Insert appointment bookings without a snapshot for a variant, a CSA custom price with flag on and off, and a plain service; insert a negative snapshot.
- **Expected:** Fallback fills variant, calendar or service price; CHECK refuses negatives; non-appointment rows untouched.
- **Location:** `supabase/tests/booking_price_snapshot_test.sql`

#### PRICE-02: Backfill covers past and future and is re-runnable

- **Layer:** pgtap. **Workstream:** W1 Booking correctness. **Requirements:** R9,R13.
- **Pins:** RT1-8; RT2-1; H-SEAM
- **Scenario:** Run the backfill on past, future and cancelled appointment bookings, then again.
- **Expected:** I6 = 0; second run updates 0 rows.
- **Location:** `supabase/tests/booking_price_snapshot_test.sql`

#### PRICE-03: Every appointment bookings insert writes the snapshot

- **Layer:** unit. **Workstream:** W1 Booking correctness. **Requirements:** R9.
- **Pins:** RT2-1; RT1-8
- **Scenario:** Sweep insert sites with service_item_id: create, create-multi-service, create-group, venue bookings, walk-in, visits services add, waitlist conversion, venue waitlist, linked-calendar booking, import runner, reschedule to another service.
- **Expected:** Each sets service_price_snapshot_pence or is on an explicit allowlist relying on the fallback.
- **Location:** `src/lib/booking/price-snapshot-sweep.test.ts`

#### PRICE-04: Settling readers use stored total, then snapshot, then live

- **Layer:** unit. **Workstream:** W1 Booking correctness. **Requirements:** R9.
- **Pins:** RT2-1
- **Scenario:** Booking with snapshot 2000; live variant price changed to 2600; run resolveBookingTotalPence, resolveBookingTotalPenceFromRow, loadRowTotalResolver, loadVisitPaymentPicture, recomputeBookingPaymentSummary and email enrichment.
- **Expected:** All return 2000 plus add-ons counted once; payment_state unchanged.
- **Location:** `src/lib/booking/payment-summary.snapshot.test.ts`

#### PRICE-05: Charge route collects the agreed amount after a host price change

- **Layer:** route. **Workstream:** W1 Booking correctness. **Requirements:** R13.
- **Pins:** RT2-1
- **Scenario:** Member booking at 2500; host lowers master to 1800 and it replicates; staff charges balance.
- **Expected:** Balance and prefill use 2500; no amount_exceeds_balance; raising the master price does not raise the prefill.
- **Location:** `src/app/api/venue/bookings/[id]/charge/route.snapshot.test.ts`

#### PRICE-06: New staff booking detail bundle returns the snapshot

- **Layer:** pgtap. **Workstream:** W1 Booking correctness. **Requirements:** R9.
- **Pins:** RT2-1
- **Scenario:** Call the new staff_booking_detail_bundle version for a booking whose live variant price changed; call the old version.
- **Expected:** New version returns snapshot pricing; old version still exists for rolling deploy.
- **Location:** `supabase/tests/booking_price_snapshot_test.sql`

#### PRICE-07: Past revenue does not move when the host edits a price

- **Layer:** unit. **Workstream:** W1 Booking correctness. **Requirements:** R1,R13.
- **Pins:** RT1-8; RT2-1
- **Scenario:** Booked revenue for member B last month before and after a replicated price change.
- **Expected:** Identical totals per day and calendar.
- **Location:** `src/lib/reports/booked-revenue.snapshot.test.ts`

#### PRICE-09: Staff modify rewrites the snapshot only when service or option changes

- **Layer:** route. **Workstream:** W1 Booking correctness. **Requirements:** R9.
- **Pins:** RT2-1
- **Scenario:** PATCH /api/venue/bookings/[id] changing time only, then variant.
- **Expected:** Time change keeps snapshot; variant change writes the new resolved price.
- **Location:** `src/app/api/venue/bookings/[id]/route.snapshot.test.ts`

#### PRICE-10: Adoption, transfer and re-join snapshot first

- **Layer:** pgtap. **Workstream:** W7 Lifecycle. **Requirements:** R13.
- **Pins:** RT2-1; RT2-20
- **Scenario:** Bookings with null snapshots on services adopted at join, swapped at transfer and reconnected at re-join.
- **Expected:** After each operation, null snapshots on those services = 0, set before the first apply in the same transaction.
- **Location:** `supabase/tests/collective_lifecycle_test.sql`

#### PRICE-11: Staff visits and groups require a staff session and stamp the actor

- **Layer:** route. **Workstream:** W1 Booking correctness. **Requirements:** R12.
- **Pins:** verification finding 14
- **Scenario:** Staff-source create-multi-service and create-group without a staff session, then with one.
- **Expected:** Without: refused or treated as online with deposits; with: created_by_staff_id and created_by_linked_venue_id stamped.
- **Location:** `src/app/api/booking/create-multi-service/route.staff-actor.test.ts`

### 3.6 Calendar assignments

#### CSA-01: Calendar assignment saves are diffs with ownership and error checks

- **Layer:** route. **Workstream:** W2 Calendar assignments. **Requirements:** R5,R10.
- **Pins:** RT1-12
- **Scenario:** PUT practitioner-services adding one, removing one, keeping one; foreign service_ids; injected delete error.
- **Expected:** Only the removed row deleted, kept rows keep id and all seven custom values; foreign ids 403; injected error 500 with no partial write.
- **Location:** `src/app/api/venue/practitioner-services/route.test.ts`

#### CSA-02: Stale full-set PUT cannot erase the host's assignment

- **Layer:** route. **Workstream:** W2 Calendar assignments. **Requirements:** R5,R10.
- **Pins:** RT1-12; RT2-19
- **Scenario:** expected_service_ids mismatch; old-app PUT without expected ids that removes a row the host engine wrote 2 h ago.
- **Expected:** 409 STALE_RESOURCE 'Someone else changed this calendar's services. Refresh and try again.'; own removals and requires_confirmation still work.
- **Location:** `src/app/api/venue/practitioner-services/route.stale.test.ts`

#### CSA-03: All seven per-calendar values stored, gated and writable by the right people

- **Layer:** route. **Workstream:** W8 Per-calendar fields. **Requirements:** R8.
- **Pins:** RT2-17
- **Scenario:** Override PATCH with name, description, buffer, deposit, colour, price, duration as staff (flags), venue admin (D4), host admin via collective_set_calendar_values; out-of-range values.
- **Expected:** Stored within CHECK ranges; refused when flag off or caller lacks authority; host RPC audited with actor; card-hold deposit floor applied.
- **Location:** `src/app/api/venue/practitioner-service-overrides/route.seven-fields.test.ts; supabase/tests/collective_calendar_values_test.sql`

### 3.7 Engine objects and locks

#### DB-01: Engine objects: grants, definer, search_path, volatility, flag clause

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R12.
- **Pins:** RT1-7; RT1-17; H-C0
- **Scenario:** Inspect pg_proc and pg_class for engine functions, trigger functions, four tables and sequences.
- **Expected:** prosecdef true with search_path; engine functions VOLATILE with SET resneo.collective_engine; no EXECUTE for PUBLIC, anon, authenticated; RLS on, no client policies, no client table or sequence privileges.
- **Location:** `supabase/tests/collective_grants_test.sql`

#### DB-02: Engine flag does not leak and refusals are distinguishable

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R12.
- **Pins:** RT1-7; RT1-6
- **Scenario:** In one transaction call collective_apply_replica then UPDATE the replica directly; also SET LOCAL resneo.collective_engine as authenticated (sanctioned bypass needs raw SQL).
- **Expected:** Flag is off after the call and the UPDATE raises the dedicated SQLSTATE, not P0001; raw-SQL bypass recorded as reachable only without PostgREST.
- **Location:** `supabase/tests/collective_locks_test.sql`

#### DB-03: Lock predicate: replicas and managed objects of live memberships only

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4,R12,R13.
- **Pins:** RT1-4; RT1-7
- **Scenario:** UPDATE and DELETE replica row, variants, add-on links, requirements, managed groups, options, types, versions as service role and as authenticated member admin; sort_order-only update; FK cascade from venue delete; same writes after membership left.
- **Expected:** Refused while live; sort_order and cascades allowed; all allowed after leave.
- **Location:** `supabase/tests/collective_locks_test.sql`

#### DB-04: Status triggers release in the same transaction

- **Layer:** pgtap. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT1-4
- **Scenario:** Directly UPDATE venue_collective_members to left, and venue_collectives to dissolved while the members update fails (two statements, as the dissolve route does).
- **Expected:** Links deleted and managed objects unmanaged in the status statement's transaction; I5 = 0 even when the second statement fails.
- **Location:** `supabase/tests/collective_lifecycle_test.sql`

#### DB-05: Offered master delete and host change are refused in the database

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R11,R12.
- **Pins:** RT1-5; RT1-2
- **Scenario:** DELETE master of an active offering (service role, authenticated host admin, import-undo style multi-id delete); UPDATE host_venue_id outside the engine.
- **Expected:** Dedicated SQLSTATEs; multi-id delete fails atomically; archived offering's master deletable; host change only through collective_transfer_host.
- **Location:** `supabase/tests/collective_locks_test.sql`

#### DB-06: Dirty triggers bump every affected link and nothing else

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1; RT1-7
- **Scenario:** Master column update, variant insert, option change, host venue-wide requirement change, version publish, heading rename, sort_order-only reorder, write at a venue outside any collective, CSA write.
- **Expected:** desired_revision bumped on every link of affected offerings; no bump for sort_order-only; zero engine writes for the outside venue; one trigger per event per table exists.
- **Location:** `supabase/tests/collective_dirty_triggers_test.sql`

#### DB-07: Every replicated-table column is classified; not-copied columns never copy

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4,R9.
- **Pins:** RT1-10; RT2-16
- **Scenario:** Compare pg_attribute of service_items, service_variants, addon_groups, addons, compliance_types, compliance_type_versions, requirements, service_categories with collective_column_classes; add a scratch column; apply a master with meeting link, arrival text, option cost.
- **Expected:** Unclassified column fails; meeting link, arrival instructions, cost_to_business_pence and online_unmet_message follow the owner's class decision.
- **Location:** `supabase/tests/collective_column_classes_test.sql`

#### DB-08: Revision table bumps from every source; name hold untouched

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R7,R10.
- **Pins:** RT1-14
- **Scenario:** CSA insert, delete, cascade from calendar and service delete; calendar deactivate and rename; venue Stripe, currency, timezone change; membership change; engine apply.
- **Expected:** collective_catalogue_revisions increments each time; venue_collectives.updated_at unchanged by applies and CSA writes.
- **Location:** `supabase/tests/collective_revisions_test.sql`

#### DB-09: Venue hard delete with replicas, managed forms and audit rows

- **Layer:** pgtap. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT1 NO ACTION assumption; H-RESIDUE (compliance audit trigger)
- **Scenario:** admin_hard_delete_venue for a host of a live collective and for a member holding engine-created managed types with compliance audit events and an adopted address.
- **Expected:** Host: dissolve first, members keep services; member: release first; both deletes succeed or the compliance audit gap is surfaced as a defect before Pass A.
- **Location:** `supabase/tests/collective_venue_deletion_test.sql`

### 3.8 Engine convergence

#### ENG-01: Service row converges and a second apply writes nothing

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4,R6,R7.
- **Pins:** RT1-10
- **Scenario:** Apply a master with every replicated column set, then apply again; withdraw the offering; switch the master off.
- **Expected:** Replicated columns equal, identity columns untouched; second apply counts all zero with no audit row; is_active follows master and offering.
- **Location:** `supabase/tests/collective_apply_service_test.sql`

#### ENG-02: Variants keyed by mapping, deactivated never deleted

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4.
- **Pins:** RT1-11; RT1-2
- **Scenario:** Add, edit, reorder, rename and remove master variants with future bookings on replica variants.
- **Expected:** Replica variant ids stable across edits and renames; removed ones inactive; bookings keep variant ids; I11 = 0.
- **Location:** `supabase/tests/collective_apply_children_test.sql`

#### ENG-03: Add-on groups managed per member; options updated in place

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4.
- **Pins:** RT1-16
- **Scenario:** Link, unlink and reorder groups; edit one option price; add an option; member owns a group with the same name.
- **Expected:** One managed group per member and master group; unrelated option ids unchanged and booking_addons.addon_id not nulled; member's own group untouched; unlinked managed group inactive.
- **Location:** `supabase/tests/collective_apply_children_test.sql`

#### ENG-04: Headings mapped by id, renamed in place

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4,R11.
- **Pins:** RT1-16; RT2-27
- **Scenario:** Host renames a heading; member already has a heading of the new name; member deletes a heading holding replicas.
- **Expected:** No duplicate heading and no 23505; member delete marks links dirty and the next apply re-files.
- **Location:** `supabase/tests/collective_apply_children_test.sql`

#### ENG-05: Compliance adoption, requirement merge and version no-churn

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4,R9.
- **Pins:** RT1-3; RT2-7
- **Scenario:** Member holds an archived ppd-patch-test with the same template (staging shape); host requires the type venue-wide and on the service; host publishes an identical then a changed form.
- **Expected:** Archived type unarchived and managed (or derived slug per decision), records still count; one requirement with strictest enforcement; new version only on schema change; no 23505.
- **Location:** `supabase/tests/collective_apply_compliance_test.sql`

#### ENG-06: No unique index can break an apply

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R6,R7.
- **Pins:** RT2-7; RT1-3
- **Scenario:** Enumerate unique indexes from pg_index on every table the apply writes; for each, seed a colliding member row and apply.
- **Expected:** Apply adopts or suffixes and converges; an index without a scenario fails the test; failures carry an enumerated last_error_code and host-readable message.
- **Location:** `supabase/tests/collective_unique_keys_test.sql`

#### ENG-07: Fingerprints map identities and detect any replicated change

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1; RT2-18
- **Scenario:** For each replicated column class, change the replica side through the sanctioned bypass; reorder unrelated rows.
- **Expected:** Fingerprint differs for every replicated column and is stable under reorder; converged link equals master.
- **Location:** `supabase/tests/collective_fingerprint_test.sql`

#### ENG-08: Randomised convergence

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4,R7.
- **Pins:** RT1-1; RT1-16
- **Scenario:** setseed-driven random master mutations and apply orders: 50 rounds in CI, 1,000 nightly on 50 offerings by 10 members.
- **Expected:** After drain I3 = 0, no 23505, no booked variant or option deleted or deactivated while its master counterpart is active.
- **Location:** `supabase/tests/collective_engine_fuzz_test.sql`

### 3.9 Revisions and freshness

#### REV-01: Revision bookkeeping cannot skip a change or a sibling

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1
- **Scenario:** Apply reads desired 3 then a host write bumps to 4 before commit; master change with members A and B, apply only A.
- **Expected:** Link stays due at 4; B remains due and ensureReplicaFresh reports lag; new and adopted links start behind and are excluded from the catalogue.
- **Location:** `supabase/tests/collective_revisions_test.sql`

#### REV-02: Replication cron claims with leases and backs off

- **Layer:** route. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1
- **Scenario:** GET /api/cron/collective-replication without and with CRON_SECRET; three due links, one failing, budget hit mid-run.
- **Expected:** 401 without secret; one RPC per link; failed link attempts and next_attempt_at set; unfinished links left due; re-run idempotent.
- **Location:** `src/app/api/cron/collective-replication/route.test.ts`

#### REV-03: Daily verifier repairs and alerts

- **Layer:** route. **Workstream:** W3 Engine. **Requirements:** R7,R13.
- **Pins:** RT1-4; RT1-1
- **Scenario:** Report returns I3 drift, an I5 link after a missed release, and an I15 violation.
- **Expected:** Drift bumps desired and is audited drift_detected; I5 links released; I15 alerts only; clean report writes nothing.
- **Location:** `src/app/api/cron/collective-replica-verify/route.test.ts`

#### REV-04: Freshness before pricing, per audience

- **Layer:** unit. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R7,R9.
- **Pins:** RT1-1; RT2-18
- **Scenario:** ensureReplicaFresh with link fresh, behind but applied within 1.5 s, behind past budget, next_attempt_at in future; public and staff audiences.
- **Expected:** Fresh proceeds; staff past budget gets 409 COLLECTIVE_SERVICE_UPDATING 'This service is being updated. Please try again in a moment.'; public hides the calendar and create returns SLOT_TAKEN; no anonymous request writes.
- **Location:** `src/lib/linked-accounts/replicas/freshness.test.ts`

#### REV-05: Host saves drain inline and report per venue

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R7,R11.
- **Pins:** RT1-1
- **Scenario:** appointment-services PATCH, addon-groups PATCH, compliance type version, service-categories rename with two members, one failing.
- **Expected:** Additive collective_sync with applied, pending and failed[{venue_name, message}] within 4 s; plain prose without em-dashes.
- **Location:** `src/app/api/venue/appointment-services/route.collective-sync.test.ts`

### 3.10 Concurrency

#### CON-01: Host save during an apply and sibling members lose nothing

- **Layer:** engine-invariant. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1
- **Scenario:** Session A applies link A paused after_master_read; session B commits a price change; session C applies link B concurrently; resume and drain.
- **Expected:** B's dirty bump waits or leaves A behind; final replicas at A and B carry the new price; I3 = 0.
- **Location:** `supabase/concurrency/host_save_during_apply.sql`

#### CON-02: Overlapping crons never apply the same link twice

- **Layer:** engine-invariant. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1
- **Scenario:** Two claim RPC transactions 100 ms apart over 20 due links, each applying what it claimed.
- **Expected:** Disjoint claims; one replica_applied audit per link per revision.
- **Location:** `supabase/concurrency/overlapping_claims.sql`

#### CON-03: Lock order: release, offer, join, transfer and apply never deadlock or leak

- **Layer:** engine-invariant. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT1-4; RT1-2
- **Scenario:** Offer paused after membership check while release commits; release versus apply 50 random staggers; transfer versus apply; join versus withdraw.
- **Expected:** No link at the former member; no 40P01; transfer waits or refuses while behind; never an active replica of an archived offering.
- **Location:** `supabase/concurrency/lifecycle_races.sql`

#### CON-04: Assignment and booking races

- **Layer:** engine-invariant. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R5,R9,R10.
- **Pins:** RT1-12; RT1-1; double booking
- **Scenario:** Member diff PUT versus host engine insert on the same row; booking create during an apply; combined page and own page booking the same member calendar slot.
- **Expected:** No 23505 surfaced, both intents kept; booking priced on new terms or 409 COLLECTIVE_SERVICE_UPDATING, never stale after fresh; exactly one slot claim wins.
- **Location:** `supabase/concurrency/assignment_and_booking_races.sql`

### 3.11 Derived catalogue

#### CAT-01: Derived catalogue: assignments are the only truth, with exclusions

- **Layer:** unit. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R1,R5,R10.
- **Pins:** RT1-11; RT2-15; verification finding 1
- **Scenario:** Member ticks and unticks calendars; member suspended; link behind 16 min; member B without charges-capable Stripe on deposit service; staff audience.
- **Expected:** Providers exist only where CSA exists and appear after the revision bump; suspended, lagging and unconverged excluded; B hidden publicly, shown to staff with 'Card payments are not set up at {venue}, so take payment in person.'
- **Location:** `src/lib/linked-accounts/replicas/catalogue.test.ts`

#### CAT-02: Server re-evaluates exclusions and Stripe readiness

- **Layer:** route. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R9.
- **Pins:** RT2-15; RT2-18
- **Scenario:** Stripe account.updated with charges_enabled false; guest posts a hidden calendar directly to create.
- **Expected:** stripe_charges_enabled stored; create refuses with SLOT_TAKEN or 'This booking option is no longer available.'
- **Location:** `src/app/api/webhooks/stripe/route.charges-enabled.test.ts; src/app/api/booking/create/route.collective.test.ts`

#### CAT-03: Presentation, attribution and read-only renders

- **Layer:** unit. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R9,R11.
- **Pins:** verification findings 11, 13
- **Scenario:** Build the combined page; render /book/c while reconcile would remove a member; create after the collective dissolved mid-flow.
- **Expected:** Master name, description, photo, host heading order; render issues zero writes; collective_id stamped only while active.
- **Location:** `src/lib/linked-accounts/replicas/catalogue-presentation.test.ts`

#### CAT-04: Retired offerings keep existing bookings manageable

- **Layer:** unit. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R9,R13.
- **Pins:** RT2-27
- **Scenario:** Host withdraws S2; a guest with a future S2 booking at member A self-reschedules; staff modifies.
- **Expected:** Both allowed on the retired replica; host sees the affected bookings at other venues without guest names.
- **Location:** `src/lib/booking/guest-actions/reschedule.retired-replica.test.ts`

### 3.12 Compliance

#### CMP-01: Forms on a member calendar are served and captured at the owning venue

- **Layer:** route. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R1,R4,R9.
- **Pins:** RT2-2
- **Scenario:** booking-requirements for concrete calendar A1 on S5; submit version shown and a file uploaded under the returned venue prefix; Any available and group without a concrete calendar.
- **Expected:** Owning venue's managed type and version and venue_id returned; capture accepted; no 'form was updated' 409 when schemas match; forms deferred until the calendar is fixed.
- **Location:** `src/app/api/public/compliance/booking-requirements/route.collective.test.ts; src/lib/compliance/booking-capture.collective.test.ts`

#### CMP-02: Compliance enablement, record acceptance and member venue-wide forms

- **Layer:** route. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R4,R9,R11.
- **Pins:** RT2-6; RT2-24; D10
- **Scenario:** Accept by member B with compliance off; B switches compliance off while live; guest holds a record of B's own same-template form; B has a venue-wide consultation form.
- **Expected:** Per decision: accept turns it on with consent or calendars hidden with host warning; switch-off refused with coded 409; existing record satisfies the managed form; B's venue-wide form still asked and host sees 'Also asked at {venue}'.
- **Location:** `src/lib/compliance/enforce-booking.collective.test.ts`

### 3.13 Offerings and host routes

#### OFF-01: Offerings routes: offer, withdraw, member calendars

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R3,R5,R6.
- **Pins:** RT1-17; RT1-11
- **Scenario:** POST offerings as host admin, member admin and in a legacy collective; DELETE offering; PUT calendars add and remove with bookings at another venue.
- **Expected:** Host only (403 member, 409 legacy); links created dirty; withdraw retires; affected bookings for other venues carry date, time, calendar, venue, guest_name null and no move action; audit rows carry the actor.
- **Location:** `src/app/api/venue/collectives/[id]/offerings/route.test.ts`

#### OFF-02: Services PATCH and GET for hosts

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R5,R7,R11.
- **Pins:** graft 2; RT2-19
- **Scenario:** PATCH with collective_calendars as host admin and as member admin; stale expected_updated_at; GET as host admin and staff.
- **Expected:** Engine assigns member calendars in one save; member gets 403; stale gets 409 STALE_RESOURCE; GET adds collective and top-level collective_calendars (host admin only) and never merges member calendars into practitioner_services.
- **Location:** `src/app/api/venue/appointment-services/route.host.test.ts`

#### OFF-03: Deleting or switching off an offered master

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R7,R11.
- **Pins:** RT1-5
- **Scenario:** DELETE offered master; PATCH is_active false on it; import undo including an offered master and a replica.
- **Expected:** 409 COLLECTIVE_OFFERED_SERVICE 'Take this service off the {collective} page before deleting it.'; switch-off propagates with 'This also turns it off at {venues}.'; undo checks every error, skips both and reports them.
- **Location:** `src/app/api/venue/appointment-services/route.delete.test.ts; src/lib/import/run-undo.test.ts`

#### OFF-04: Notices go to the right people, promptly and without guest data

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R7,R11.
- **Pins:** RT2-23; RT1-17
- **Scenario:** Host changes price, payment rule, refund window and a form, then a description; member removes a calendar.
- **Expected:** Immediate notice to member admins for commercial and form changes with collective_id set, digest for cosmetic edits; host notified of member calendar changes; no guest names in any payload.
- **Location:** `src/lib/linked-accounts/replicas/notices.test.ts`

### 3.14 Host interface

#### UI-H-01: Host Services page shows reach and never uses window.confirm

- **Layer:** component. **Workstream:** W5 Host Services page. **Requirements:** R5,R7,R8,R11.
- **Pins:** window.confirm blocked; RT1-17
- **Scenario:** Render AppointmentServicesView for a host with two members: banner, Collective pill, CollectiveCalendarsSection, staff flag note, save feedback variants, take-off, switch-off and blocked delete dialogs, cross-venue removal dialog.
- **Expected:** Copy as designed without em-dashes; dialogs through ConfirmContext; other venues' bookings show no client names; Retry calls replicas/retry.
- **Location:** `src/app/dashboard/appointment-services/AppointmentServicesView.collective-host.test.tsx`

### 3.15 Guards

#### GRD-01: Replica calendar-only and unchanged saves write nothing to the service

- **Layer:** route. **Workstream:** W6 Member locks and UI. **Requirements:** R10,R12.
- **Pins:** RT1-6; RT2-19
- **Scenario:** PATCH a non-canonical replica with practitioner_ids only; replay the app 1.1.0 admin save (deposit_pence 0 against stored null, re-indexed variant and add-on sort_order, parent duration from primary option).
- **Expected:** 200; zero writes to service_items, service_variants and service_addon_groups; only the caller venue's CSA diff applied.
- **Location:** `src/app/api/venue/appointment-services/route.replica-guard.test.ts`

#### GRD-02: Any real change to a replica is refused before any write

- **Layer:** route. **Workstream:** W6 Member locks and UI. **Requirements:** R4,R12.
- **Pins:** RT1-6
- **Scenario:** Parameterised over every editable field (name to booking start fields, variants, add-on links, processing blocks), each changed alone together with a practitioner_ids change.
- **Expected:** 409 COLLECTIVE_MANAGED_SERVICE 'This service is managed by {host} for {collective}. Ask {host} to change it.'; zero writes including CSA; DELETE replica also 409.
- **Location:** `src/app/api/venue/appointment-services/route.replica-guard.test.ts`

#### GRD-03: Add-on and compliance guards, including members borrowing managed items

- **Layer:** route. **Workstream:** W6 Member locks and UI. **Requirements:** R4,R12.
- **Pins:** RT1-13; RT1 writer inventory
- **Scenario:** addon-groups POST with service_links to a replica, PUT links on a replica, PATCH and DELETE managed group; compliance requirement on a replica, managed type edit, archive, restore, version, duplicate; member links own service to a managed group or form.
- **Expected:** Coded 409s (COLLECTIVE_MANAGED_ADDON_GROUP, COLLECTIVE_MANAGED_SERVICE, COLLECTIVE_MANAGED_COMPLIANCE_TYPE) before any write; no swallowed 201; ownership checks on PUT; managed items hidden from member-only pickers.
- **Location:** `src/app/api/venue/addon-groups/route.guard.test.ts; src/app/api/venue/compliance/requirements/route.guard.test.ts`

#### GRD-04: Every service-table writer is guarded, and database refusals map to 409

- **Layer:** unit. **Workstream:** W6 Member locks and UI. **Requirements:** R11,R12.
- **Pins:** RT1-4; RT1-6; forgotten route guard
- **Scenario:** Sweep src for insert, update, upsert and delete on the ten service tables; feed the shared error helper each dedicated SQLSTATE and a plain P0001.
- **Expected:** Every call site is allowlisted with its guard; a new unguarded writer fails; SQLSTATEs map to coded 409s, P0001 stays 500.
- **Location:** `src/lib/linked-accounts/replicas/writer-sweep.test.ts; src/lib/linked-accounts/replicas/db-errors.test.ts`

#### GRD-05: Member-side allowed paths and import behaviour

- **Layer:** route. **Workstream:** W6 Member locks and UI. **Requirements:** R8,R10,R12.
- **Pins:** RT2-10; RT2-21
- **Scenario:** Member staff override on a replica; reorder; heading delete; bookings import matching a replica name; legacy after() sync scheduled in replicas mode.
- **Expected:** Override uses replica flags; reorder and heading delete allowed (links dirty); import attaches read-only and reports ambiguity; no legacy sync or customised detach.
- **Location:** `src/app/api/venue/practitioner-service-overrides/route.replica.test.ts; src/lib/import/run-execute.replicas.test.ts`

### 3.16 Member interface

#### UI-M-01: Member Services and Calendar Availability pages

- **Layer:** component. **Workstream:** W6 Member locks and UI. **Requirements:** R9,R10,R11,R12.
- **Pins:** RT1-11; RT2-10
- **Scenario:** Render for a member: From {host} and Your services sections, locked replica card and disabled form, retired group, setting-up state, member-only note, Calendar Availability grouping and collective confirmation line.
- **Expected:** No delete, switch or drag on replicas; calendar ticks enabled and saved as diffs; copy exact and em-dash free.
- **Location:** `src/app/dashboard/appointment-services/AppointmentServicesView.collective-member.test.tsx; src/app/dashboard/availability/AppointmentAvailabilitySettings.collective.test.tsx`

### 3.17 Lifecycle

#### LIFE-01: Create, invite and accept: exclusivity, eligibility and consent

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R2,R6.
- **Pins:** RT2-8; RT2-28; verification finding 8
- **Scenario:** Invite a venue in another live collective; accept in replicas mode without consent_version (app 1.1.0 payload) and with it; decline an active membership; create with the platform flag off and on.
- **Expected:** Coded refusals with plain prose; 409 COLLECTIVE_CONSENT_REQUIRED 'Please open ResNeo on the web to read what joining means, then accept there.'; consent version, user and time stored; decline only from invited; replicas mode only when flagged.
- **Location:** `src/app/api/venue/collectives/[id]/members/route.test.ts`

#### LIFE-02: Join and D1 adoption are reviewed, mapped and snapshotted

- **Layer:** pgtap. **Workstream:** W7 Lifecycle. **Requirements:** R3,R6.
- **Pins:** RT2-20; RT1-11
- **Scenario:** collective_join_member with one adoption whose member options partly match host options by name.
- **Expected:** Membership active, links dirty, adopted service's bookings snapshotted, options mapped, unmapped member options kept for existing bookings only; exclusivity rechecked under lock.
- **Location:** `supabase/tests/collective_lifecycle_test.sql`

#### LIFE-03: Leaving is lossless and unlocks everything

- **Layer:** pgtap. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT2-9; RT1-15
- **Scenario:** Checksum member services, variants, options, CSA, bookings, guests, payments and compliance records; release member B (no Stripe) holding deposit and card-hold replicas.
- **Expected:** Checksums identical except intended changes; links gone, locks lifted, managed objects unmanaged, adoption cleared, audit member_released; paid services set to no online payment with audited before values (per decision); photo copy queued in collective_operations.
- **Location:** `supabase/tests/collective_lifecycle_test.sql`

#### LIFE-04: Leave, remove and dissolve routes, with notices and photos

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT2-9; RT1-15; RT2-22
- **Scenario:** Member leaves while links are behind; host removes a member; host dissolves; photo copy job runs and is retried.
- **Expected:** Leave succeeds any time and returns a review checklist; notices to live members only with collective_id; photo objects copied to the member folder idempotently; dissolved address serves a neutral page listing members' own pages (per decision).
- **Location:** `src/app/api/venue/collectives/[id]/members/route.leave.test.ts; src/app/book/c/[slug]/dissolved.test.tsx`

#### LIFE-05: Host transfer re-keys mappings and then applies nothing

- **Layer:** pgtap. **Workstream:** W7 Lifecycle. **Requirements:** R2,R4.
- **Pins:** RT1-2; RT2-4
- **Scenario:** Transfer from H to A with member B holding replicas with variants, groups, forms and future variant bookings; attempt while a link is behind; attempt by direct host_venue_id update.
- **Expected:** Refused while behind or outside the engine; after transfer I10 = 0, next apply at B and H writes zero variant, group, type and requirement rows; bookings keep active variants; forks set accepts_records_from_type_id.
- **Location:** `supabase/tests/collective_transfer_test.sql`

#### LIFE-06: Transfer is a request with consent; reconcile no longer transfers silently

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R2,R11.
- **Pins:** RT1-2; RT2-23
- **Scenario:** offer_host then accept_host with and without consent_version; old app transfer_host; link cascade removes the host.
- **Expected:** Pending request until accepted with consent; members notified; cascade pauses the page and raises a hosting request (per decision) instead of transferring.
- **Location:** `src/lib/linked-accounts/collectives.reconcile.replicas.test.ts`

#### LIFE-07: All membership and status writers go through lifecycle code

- **Layer:** unit. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT1-4
- **Scenario:** Sweep src for updates of status or host_venue_id on venue_collective_members and venue_collectives (the eleven known writers).
- **Expected:** Only the lifecycle module writes them; each path sends notices; the DB triggers remain the backstop (DB-04).
- **Location:** `src/lib/linked-accounts/replicas/status-writer-sweep.test.ts`

#### LIFE-08: Staff authority, audit and contacts across venues

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R1,R12.
- **Pins:** RT2-12; RT2-13
- **Scenario:** Host staff books member calendar with a host contact picked; member staff searches host contacts; mesh links downgraded at migration.
- **Expected:** Collective audit row with acting venue and user, owning venue notified; picked contact cleared with note 'This client will be added to {venue}'s contacts.'; cross-venue search refused unless granted; linked-calendar/guests 403 after downgrade.
- **Location:** `src/app/api/venue/bookings/route.collective-authority.test.ts`

### 3.18 Migration of existing collectives

#### MIG-01: Dry run tells the whole truth

- **Layer:** migration. **Workstream:** W9 Migration. **Requirements:** R6,R11.
- **Pins:** RT1-3; RT1-11; D21
- **Scenario:** Legacy-shape fixture: drifted copies, needs_master, ambiguous_master, member service on two offerings, archived same-slug form, copy variants with bookings, missing CSA rows.
- **Expected:** Report lists each with counts and column-level before and after; P1 to P5 populated; nothing written (row checksums unchanged).
- **Location:** `supabase/tests/collective_migration_test.sql; scripts/collective-replicas-migrate.test.mjs`

#### MIG-02: Apply converges per link, resumably, without changing any total

- **Layer:** migration. **Workstream:** W9 Migration. **Requirements:** R3,R6,R9.
- **Pins:** RT1-11; RT1-8; H-MAXROWS
- **Scenario:** Apply with --approved-report hash on the fixture and on 50 by 10 scale; kill the script mid-run and restart; more than 1,000 rows to page.
- **Expected:** Variants mapped by name and sort order before the first apply; snapshots before applies; per-link RPCs with progress in collective_operations; restart resumes; invariants 0; every payment total identical before and after.
- **Location:** `scripts/collective-replicas-migrate.test.mjs`

#### MIG-03: Rollback restores the legacy page and can be re-applied

- **Layer:** migration. **Workstream:** W9 Migration. **Requirements:** R13,R14.
- **Pins:** RT1 rollback assumption
- **Scenario:** After apply, run --rollback, compare the legacy combined page to the pre-migration snapshot, then apply again.
- **Expected:** Providers rebuilt from CSA at rollback, I4 = 0, page equal to snapshot, before-images restored if chosen; compliance types archived not deleted; re-apply converges.
- **Location:** `scripts/collective-replicas-migrate.test.mjs`

#### MIG-04: Staging rehearsal then plus-1 migration

- **Layer:** live-staging. **Workstream:** W9 Migration. **Requirements:** R1,R3,R6,R9.
- **Pins:** H-RESIDUE; RT1-3; RT2-6
- **Scenario:** Scratch legacy collective on e2e-coll fixtures copying plus-1's shape: dry run, apply, rollback, re-apply; then plus-1 with owner review and the dedicated [coll-test] price check.
- **Expected:** All gates in the rollout section pass; Light 3's form decision applied; public catalogue diff shows only intended changes.
- **Location:** `scripts/collective-replicas-migrate.mjs (staging run log in release notes)`

### 3.19 Public pages

#### PUB-01: Own pages redirect only when the member is really bookable there

- **Layer:** unit. **Workstream:** W10 Booking pages and links. **Requirements:** R9,R11,R14.
- **Pins:** RT2-3; RT1-11
- **Scenario:** Redirect decision for: page live and member listed; no offerings; booking paused; host lapsed; member hidden for Stripe or lag; links unconverged; after leave.
- **Expected:** Redirect only in the first case; otherwise own page with a reason; Booking Page tab shows 'Guests who visit your page are sent to {collective}.' or 'Your own page is showing because {reason}.'
- **Location:** `src/lib/linked-accounts/replicas/redirect-decision.test.ts`

#### PUB-02: Redirects keep the guest's place; member-only links do not dead-end

- **Layer:** route. **Workstream:** W10 Booking pages and links. **Requirements:** R9,R14.
- **Pins:** RT2-22; RT2-10
- **Scenario:** /book/{member}?service_id={replica}&start=... ; /book/{venue}/{calendar}; /embed/{venue}; a member-only service_id; email and portal Book again and waitlist offer links.
- **Expected:** 307 with offering id, calendar id, date and start kept; unknown ids fall back to the service list; member-only ids reach an interstitial with the venue's phone; comms use a call-us action.
- **Location:** `src/app/book/[venue-slug]/page.redirect.test.ts; src/lib/emails/venue-booking-page-link.replicas.test.ts`

#### PUB-03: Guests see who they are booking with

- **Layer:** component. **Workstream:** W10 Booking pages and links. **Requirements:** R1,R9.
- **Pins:** RT2-14
- **Scenario:** Combined page on a member calendar: calendar step, payment step, confirmation; marketing consent control.
- **Expected:** 'You are booking with {member business name}, {member address}' on all three; consent unticked and names the member (per legal decision).
- **Location:** `src/components/booking/DetailsStep.collective-identity.test.tsx`

### 3.20 Combined-page manager compatibility

#### MGR-01: Old catalogue actions are shimmed with coded answers

- **Layer:** route. **Workstream:** W11 Manager fold. **Requirements:** R5,R6,R12.
- **Pins:** RT2-19; app builder
- **Scenario:** PATCH catalogue with every legacy action; GET catalogue.
- **Expected:** set_providers, add and remove go through the engine; archive withdraws; create with host services offers; member or custom sources 409 COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE; update_item imageUrl ok, others 409; sync and link actions 200 no-op; detach 409 COLLECTIVE_REPLICAS_ALWAYS_FOLLOW; headings 409; GET keeps CatalogueItemView with sync.state none.
- **Location:** `src/app/api/venue/collectives/[id]/catalogue/route.shims.test.ts`

### 3.21 Venue-level settings

#### VEN-01: Venue-level settings are inventoried and differences are visible

- **Layer:** unit. **Workstream:** W7 Lifecycle. **Requirements:** R11,R12.
- **Pins:** RT2-25
- **Scenario:** Sweep APPOINTMENTS_FEATURE_FLAG_KEYS, communication templates, deposit config, booking rules, in-person payments; render the host panel where waitlist_v2 differs.
- **Expected:** Every setting has a class (host-controlled, venue-controlled, must match at accept); an unclassified key fails; host sees 'Different at {venue}'.
- **Location:** `src/lib/linked-accounts/replicas/venue-settings-inventory.test.ts`

### 3.22 Mobile app contract

#### APP-01: App 1.1.0 service saves against replicas and masters

- **Layer:** app-contract. **Workstream:** W12 Mobile contract. **Requirements:** R4,R10,R12.
- **Pins:** RT1-6; RT2-19
- **Scenario:** Replay golden handleSave payloads (fixtures stamped d90dece and parsed by the route schema): unchanged save, calendar change with and without acknowledge, price edit, delete replica, delete offered master.
- **Expected:** 200, 200 or 409 requires_confirmation then 200, 409 COLLECTIVE_MANAGED_SERVICE, 409, 409 COLLECTIVE_OFFERED_SERVICE; every 409 has readable prose in error; response shapes unchanged.
- **Location:** `src/app/api/__app-contract__/services.contract.test.ts`

#### APP-02: App toggles, overrides, add-ons, forms and membership actions

- **Layer:** app-contract. **Workstream:** W12 Mobile contract. **Requirements:** R8,R10,R13.
- **Pins:** RT2-8; RT2-19
- **Scenario:** Replay useToggleCalendarService with a stale set, override sheet with all seven fields and custom_deposit_pence 0, managed add-on group edit, managed form edit, one-tap accept, leave.
- **Expected:** 409 STALE_RESOURCE; stored and gated; 409 COLLECTIVE_MANAGED_ADDON_GROUP; 409 COLLECTIVE_MANAGED_COMPLIANCE_TYPE; 409 COLLECTIVE_CONSENT_REQUIRED; leave 200 with unchanged shape.
- **Location:** `src/app/api/__app-contract__/membership-and-toggles.contract.test.ts`

#### APP-03: Additive reads and diary routing for old builds

- **Layer:** app-contract. **Workstream:** W12 Mobile contract. **Requirements:** R9,R11.
- **Pins:** RT2-19 (graft 5); verification finding 14
- **Scenario:** GET appointment-services, collectives and catalogue; GET staff-collective for a member; run the app's collectiveBookingTargetFor logic on the response.
- **Expected:** Only additive fields; sync.state none so no badge; calendar_ids excludes the caller venue's own calendars so own columns open the own form; no X-Resneo-Client header required; new codes registered in API_ERROR_CODES.
- **Location:** `src/app/api/__app-contract__/reads.contract.test.ts; src/lib/api/customer-api-contract.test.ts`

#### APP-04: Live Bearer replay and device check

- **Layer:** live-staging. **Workstream:** W12 Mobile contract. **Requirements:** R12,R13.
- **Pins:** RT2-8; RT2-19
- **Scenario:** Mint fixture staff sessions with generateLink, replay APP-01 to APP-03 against staging e2e-coll fixtures; then the owner uses app 1.1.0 on a phone for edit, toggle, accept, leave and diary taps.
- **Expected:** Same statuses and codes as the Vitest replay; the app shows each message instead of a crash or silent failure.
- **Location:** `scripts/app-contract-live.mjs; manual record in release notes`

### 3.23 Security

#### SEC-01: PostgREST gives clients no way into the engine

- **Layer:** security. **Workstream:** W15 Grants. **Requirements:** R12.
- **Pins:** RT1-7; H-C0; H-MAXROWS
- **Scenario:** Against the local API with anon, authenticated host and member JWTs: call engine RPCs, rpc/set_config, exec_sql, select and update engine tables, update a replica, delete an offered master; claim twice across transactions with the service key.
- **Expected:** RPCs 404 or 42501; engine tables unreadable; replica update and master delete refused with the dedicated SQLSTATEs; second claim excludes leased links; paginated reads return all rows beyond 1,000.
- **Location:** `scripts/db-contract/postgrest-contract.mjs`

#### SEC-02: No client data crosses venues through new surfaces

- **Layer:** security. **Workstream:** W15 Grants. **Requirements:** R1.
- **Pins:** RT1-17; RT2-12
- **Scenario:** History route as member A and outsider; audit changes jsonb; anon read of CSA custom_name, custom_description, custom_deposit_pence; host removal dialog payload; notices.
- **Expected:** Member sees own-venue and collective-wide rows only, outsider 403; no guest PII in audit or notices; anon CSA columns narrowed or explicitly accepted by the owner; live check:table-grants passes on both environments.
- **Location:** `src/app/api/venue/collectives/[id]/history/route.test.ts; scripts/check-table-grants.mjs`

### 3.24 Performance

#### PERF-01: Baseline and staff form open budget

- **Layer:** performance. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R9.
- **Pins:** Staff form open path (2026-09-05)
- **Scenario:** Before Pass A and after each pass, time profile, staff-collective and appointment-catalog from the diary for the plus-1 host and for a single venue, cold and warm, 20 runs, via scripts/measure-collective-perf.mjs.
- **Expected:** Collective host cold p50 at most 1.5 s and p95 at most 2.5 s, warm at most 0.3 s, single venue at most 0.7 s, and never more than 15 percent above the recorded baseline.
- **Location:** `scripts/measure-collective-perf.mjs; Docs/PERFORMANCE_BASELINE.md`

#### PERF-02: Public availability budget

- **Layer:** performance. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R1,R9.
- **Pins:** RT2-18 (freshness cost)
- **Scenario:** GET /api/booking/availability day and month for the combined page and a member's own page, 20 runs each, before and after Pass A and Pass B.
- **Expected:** p95 no more than 20 percent above baseline; absolute targets day 1.5 s and month 3 s (UNVERIFIED until the baseline exists); fresh-link check adds under 50 ms.
- **Location:** `scripts/measure-collective-perf.mjs`

#### PERF-03: Engine and trigger budgets

- **Layer:** performance. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** Design risk: trigger overhead; RT1-14
- **Scenario:** Local: 1,000 service_items updates at a venue outside collectives with triggers on and off; one apply of S2; verifier over 1,000 links; cron drain of 200 links. Staging: host save with inline drain for 1 and 10 members.
- **Expected:** Added mean at most 1 ms and p95 at most 3 ms; apply at most 150 ms local and 500 ms staging; verifier at most 20 s; drain at most 60 s; host save p95 at most 2 s for 1 member and returns within the 4 s budget for 10; plans use indexes.
- **Location:** `scripts/db-contract/trigger-overhead.mjs; .github/workflows/nightly-engine.yml`

#### PERF-04: Query counts do not grow with offerings or members

- **Layer:** performance. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R7,R9.
- **Pins:** N+1 in catalogue and Services GET
- **Scenario:** recording-supabase queryCount for loadReplicaCombinedCatalogue, host Services GET and guard role lookup with 1 versus 50 offerings and 2 versus 10 members.
- **Expected:** Identical query counts across sizes; guard uses one select for all service ids.
- **Location:** `src/lib/linked-accounts/replicas/query-budget.test.ts`

### 3.25 End to end

#### E2E-01: Guest books a member calendar with deposit and a patch test form

- **Layer:** e2e. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R1,R8,R9.
- **Pins:** RT2-2; RT2-14; RT2-1
- **Scenario:** Combined page on e2e-coll fixtures: S5 on member A1 with a custom price, upload a file, pay the deposit with 4242 on member A's Stripe test account; try member B for a deposit service.
- **Expected:** Booking at member A with snapshot equal to A1's price and record captured at A; B not offered publicly; trader identity shown; confirmation name matches the page.
- **Location:** `e2e/collective-guest-booking.spec.ts`

#### E2E-02: Host edit reaches the member, which cannot edit but can choose calendars

- **Layer:** e2e. **Workstream:** W5 Host Services page. **Requirements:** R3,R4,R5,R7,R10,R12.
- **Pins:** RT1-1; RT1-6
- **Scenario:** Host changes S1 price and ticks a member calendar; member opens S1 (locked) and unticks its other calendar; guest reloads the combined page; earlier booking detail opened.
- **Expected:** New price on page and at member within the drain; member form disabled with banner; calendar changes visible immediately; earlier booking keeps its agreed price.
- **Location:** `e2e/collective-host-member.spec.ts`

#### E2E-03: Leave and dissolve journeys

- **Layer:** e2e. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT2-3; RT2-9; RT2-22
- **Scenario:** Member A leaves; open its own page with a pre-join deep link; edit a former replica; host dissolves a run-scoped collective; open the old collective address.
- **Expected:** Own page bookable with the deep link resolved; service editable; bookings intact; dissolved address shows each venue's own page.
- **Location:** `e2e/collective-lifecycle.spec.ts`

#### E2E-04: Staff diary, cross-venue groups and the 375px layout

- **Layer:** e2e. **Workstream:** W7 Lifecycle. **Requirements:** R1,R9,R11.
- **Pins:** RT2-11; RT2-13; graft 5
- **Scenario:** Member staff clicks own column (member-only service) and partner column; host staff picks a host client then a member calendar; group of two across venues; mobile project renders the member Services page.
- **Expected:** Own column opens own form; partner column the collective form; contact cleared with note; group handled per decision (message before details step or split booking); no sideways scroll at 375px.
- **Location:** `e2e/collective-staff.spec.ts; e2e/collective-services.mobile.spec.ts`

### 3.26 Live staging

#### LIVE-01: Engine smoke and a real two-connection race on staging fixtures

- **Layer:** live-staging. **Workstream:** W3 Engine. **Requirements:** R3,R4,R7,R13.
- **Pins:** RT1-1; hosted grants and pooler
- **Scenario:** Service-role script: offer, apply, edit master, fingerprint check, withdraw, re-offer, release, cleanup ledger; then host save versus apply with staggered npx supabase db query --linked sessions on the fixture only.
- **Expected:** Fingerprints equal after each step; race leaves the replica on the new value; ledger cleanup leaves only append-only residue.
- **Location:** `scripts/coll-live-engine-smoke.mjs; supabase/concurrency/staging_race.sql`

#### LIVE-02: Soak on staging and 48 h production watch

- **Layer:** live-staging. **Workstream:** W9 Migration. **Requirements:** R7,R12.
- **Pins:** RT1-6 (guard misfire); RT1-1
- **Scenario:** Daily verifier results, lag, stale hides, COLLECTIVE_SERVICE_UPDATING rate on staging for 7 days; Sentry and Vercel logs on production for 48 h after each deploy; plus-1 read-only snapshot diffs.
- **Expected:** Drift 0, I3b 0, stale hides 0, UPDATING under 1 per 100 bookings; 0 lock SQLSTATEs or COLLECTIVE 409s at non-collective venues; no new 5xx on service and booking routes.
- **Location:** `scripts/collective-invariants.mjs; scripts/collective-catalogue-snapshot.mjs`

### 3.27 Manual

#### MAN-01: Owner acceptance and legal sign-off

- **Layer:** manual. **Workstream:** W0 Owed migrations and probes. **Requirements:** R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,R14.
- **Pins:** RT2-14; D9; D21
- **Scenario:** Owner walks the acceptance checklist on staging after Pass B; solicitor reviews consent text, price control, trader identity and data roles before build.
- **Expected:** Every box ticked and signed with date; consent version recorded; any failed box blocks production Pass B.
- **Location:** `Docs/release-notes/collective-replicas.md`

#### MAN-02: Help centre, docs and app handover

- **Layer:** manual. **Workstream:** W13 Help and docs. **Requirements:** R11.
- **Pins:** Copy drift; CLAUDE.md copy rules
- **Scenario:** Rewrite linked-venues, services, calendar-setup and app articles plus a new article; run npm run help:label-audit; update assistant golden 21, Docs/MOBILE_API.md and the app handover note.
- **Expected:** No zero-hit labels for new controls, no em-dashes, figures match the screens, golden eval passes, app team acknowledges handover.
- **Location:** `src/lib/help/articles/getting-started/linked-venues.ts; scripts/help-label-audit.ts; Docs/MOBILE_API.md`

### 3.28 Added by the second pass

Same format as the sections above. Each of these covers an area the first pass did not reach.

#### OPS-01 Replication and verifier crons authorise, log and report
- **Layer:** route. **Workstream:** W18 Operations. **Risk:** none named before; **Requirements:** R6, R11.
- **Pins:** The engine writes into other venues on a schedule and nothing watched it.
- **Scenario:** Call both cron routes with no `Authorization`, with a wrong secret, and with the right one. Force an apply failure and a read failure. Assert `cron_runs` rows, the Sentry capture with `tags: { cron_job }`, and the ops email.
- **Expected:** 401 without the secret and no `cron_runs` row; with it, a row carrying duration and the response detail; `{ ok: false }` with a reason and HTTP 200 when the check cannot read what it needs, so the platform does not retry a check that is reporting correctly; `errors > 0` reaches Sentry once.
- **Location:** `src/app/api/cron/collective-replicate/route.ts; src/app/api/cron/collective-verify/route.ts; src/lib/cron/finalize-cron-run.ts; src/lib/platform/cron-log.ts`

#### OPS-02 The verifier repairs only what it may, and never repairs over evidence
- **Layer:** route. **Workstream:** W18 Operations. **Risk:** R4 (flag without actor binding).
- **Pins:** A repair that hides its own cause. The house precedent (`schedule-health`) is read-only on purpose.
- **Scenario:** Seed one link behind (I3) and one outside an active membership (I5), plus one whose fingerprint differs with `applied_revision = desired_revision` and no audit row (the raw-SQL write shape). Run the verifier.
- **Expected:** I3 bumped, I5 released, both audited; the third is **not** silently re-applied but written as `unexplained_drift_repaired` carrying the before-image, and alerted. Every other non-zero invariant alerts without repairing.
- **Location:** `supabase/migrations/<engine>.sql; src/app/api/cron/collective-verify/route.ts`

#### OPS-03 Platform collective panel
- **Layer:** route. **Workstream:** W18 Operations. **Risk:** R13 (support session indistinguishable from an admin).
- **Scenario:** Call the panel as anon, as a venue admin, and as a superuser. Use Retry. Read the audit.
- **Expected:** Refused except for superusers; read-only apart from Retry; the retry writes a platform audit event and a `collective_audit_events` row carrying `actor_support_session_id` and `actor_is_platform_superuser`; no guest contact details in any response.
- **Location:** `src/app/api/platform/collectives/route.ts; src/lib/platform/audit.ts`

#### OPS-04 Cron registration is complete in both directions
- **Layer:** unit. **Workstream:** WT Test harness.
- **Scenario:** Read `vercel.json` and `src/app/api/cron/`; compare the two sets.
- **Expected:** Equal. Worth having regardless of this project: the two agree only by hand today (25 and 25 at the time of writing).
- **Location:** `vercel.json; src/app/api/cron/`

#### MV-01 to MV-04 People who work at more than one venue
- **Layer:** unit (MV-01), route (MV-02, MV-03), e2e (MV-04). **Workstream:** W16. **Requirements:** R9. **Split-brain:** SB-28; **bug:** PB-16.
- **Pins:** Today a second staff row makes `resolveUniqueStaffRow` return null, `getDashboardStaff` return no venue, and the layout redirect the person into `/signup/business-type`. They are locked out of both dashboards with no message.
- **Scenarios:** MV-01 resolves a two-venue person to a chooser rather than null. MV-02 invites an email that already works elsewhere. MV-03 sends a request with an acting venue the caller does not work at. MV-04 signs in once as the owner of two venues in one collective and moves between them.
- **Expected:** MV-01 a chooser with both venues and the person's role at each. MV-02 refused with `staff.invite.otherVenue`, no row created. MV-03 refused: the acting venue is a preference, never an authority, and is validated against the caller's own staff rows on every request. MV-04 no sign-out, and each venue's data is correct and separate.
- **Location:** `src/lib/venue-auth.ts; src/app/dashboard/layout.tsx; src/app/api/venue/staff/invite/route.ts`

#### REP-01 to REP-05 Reporting and attribution
- **Layer:** unit (REP-01, REP-04), route (REP-02, REP-03, REP-05). **Workstream:** W17, and W1 for REP-04. **Split-brain:** SB-30, SB-31. **Decision:** D49.
- **Pins:** `bookings.collective_id` is written by three create paths and read by nothing; Booked revenue already blends every member's takings in both directions with no subtotal; `buildPriceSummary` disagrees with `loadRowTotalResolver` today.
- **Scenarios:** REP-01 sweeps every report, filter and export for a collective read. REP-02 loads Booked revenue for a host and asserts the per-venue breakdown. REP-03 loads it as a member. REP-04 compares the two price paths on a booking whose service price later changed. REP-05 narrows a link and reloads.
- **Expected:** REP-01 collective bookings are identifiable everywhere money is counted, and `source` distinguishes a collective-page booking from the venue's own. REP-02 one row per venue, named, plus a total. REP-03 own venue only, collective bookings identified, no other member's figures and no other venue's guest contact details. REP-04 both read the snapshot and agree. REP-05 the column does not silently vanish while membership continues.
- **Location:** `src/lib/reports/booked-revenue.ts; src/lib/booking/payment-display.ts; src/app/api/venue/export/route.ts`

#### BM-01 to BM-06 Booking models and the appointments-only boundary
- **Layer:** route (BM-01, BM-02, BM-04, BM-06), unit (BM-03, BM-05). **Workstream:** W20. **Split-brain:** SB-35, SB-36. **Decisions:** D44, D45.
- **Pins:** The synthetic venue declares one booking model, so a member's classes, events, tables and rooms leave the web when its page redirects, and nothing says so. Currency is gated nowhere.
- **Scenarios:** BM-01 invites a class-only venue. BM-02 removes `unified_scheduling` from a member in a live collective. BM-03 follows a redirect for a member that also runs classes. BM-04 invites a venue trading in another currency. BM-05 asserts the product's own words about shared resources. BM-06 books a multi-service visit whose segments live at two venues.
- **Expected:** BM-01 and BM-04 refused with plain reasons. BM-02 coded 409. BM-03 the member's other models keep a route through, and the member was warned before accepting. BM-05 the product states shared resources are unsupported rather than implying they work. BM-06 refused with the explanation shown before the details step, as D28 already does for groups.
- **Location:** `src/lib/linked-accounts/collective-venue.ts; src/lib/linked-accounts/eligibility.ts; src/app/api/venue/route.ts; src/app/book/[venue-slug]/page.tsx`

#### PLAN-01 to PLAN-03 Plan tiers, eligibility and caps
- **Layer:** unit (PLAN-01, PLAN-03), route (PLAN-02). **Workstream:** W7, and W5 for PLAN-03. **Decision:** D39. **Bug:** CB-31.
- **Scenarios:** PLAN-01 evaluates eligibility for a trial, a cancellation window, a comped venue, a failed payment and an expired plan. PLAN-02 invites and accepts an ineligible venue. PLAN-03 assigns calendars at a member that is at its cap (Light 1, Plus 5).
- **Expected:** PLAN-01 matches `evaluateLinkEligibility` exactly. PLAN-02 refused, with the reason shown. PLAN-03 the cap is visible to both host and member, and a host assigning calendars cannot push a member past it.
- **Location:** `src/lib/linked-accounts/eligibility.ts; src/lib/plan-limits.ts; src/lib/light-plan.ts`

#### SEO-01, SEO-02, WAIT-01, FAIR-01, DIARY-01 The public page and the diary
- **Layer:** unit, except WAIT-01 and DIARY-01 (route). **Workstream:** W19, and W21 for DIARY-01. **Split-brain:** SB-33, SB-37, SB-39, SB-40. **Bug:** PB-17. **Decisions:** D43, D48.
- **Scenarios:** SEO-01 renders every `/book` route and reads its metadata. SEO-02 renders an adopted address and the collective address. WAIT-01 opens the waitlist form on a collective page. FAIR-01 runs "any available" many times across venues. DIARY-01 loads a partner column on a day the partner venue is closed.
- **Expected:** SEO-01 every route has its own title and description, and `/book/c/{slug}` also has a canonical, an Open Graph image and a robots directive. SEO-02 one canonical, not two copies. WAIT-01 the form renders and the route accepts it. FAIR-01 the configured order applies and the host does not take every contested slot. DIARY-01 the column shows the member closed.
- **Location:** `src/app/book/**; src/lib/linked-accounts/collective-venue.ts; src/app/api/booking/availability/route.ts; src/app/api/venue/linked-calendar/route.ts`

#### HLP-01 Help copy cannot regress
- **Layer:** unit. **Workstream:** W13.
- **Pins:** Nothing stops an em-dash reaching a help article today; the existing copy tests cover booking copy and the assistant's answers only. This project rewrites twenty-odd articles under a rule that forbids them.
- **Expected:** No article contains U+2014, and no rewritten article still describes sync, Link, Unlink, Re-sync, "in step", "customised", or prices and durations coming from the member venue.
- **Location:** `src/lib/help/articles/**`

#### TERMS-16, CSA-04, DB-10, SEC-03 to SEC-05
- **TERMS-16** (unit, W1): the month loader both bakes a per-calendar length into the service and carries it on the link, which is the double-application the day loader fixed and documented at `appointment-engine.ts:1710-1721`. Expect one application. **Location:** `src/lib/availability/appointment-month-availability.ts:805-818`
- **CSA-04** (pgtap, W3): deleting a calendar that held a live replica's assignment writes a `collective_audit_events` row and bumps the catalogue revision, and invariant I33 returns 0 afterwards.
- **DB-10** (pgtap, W3): every classified column's registry entry matches what an apply actually writes. DB-07 proves a column is classified; this proves the classification is true of the engine's behaviour, which is the claim that matters. Enumerate from `pg_attribute`; `service_items` has 46 columns today.
- **SEC-03** (route, W4): a pre-booking form files at the venue that will hold the booking. On "any available", complete an inline form and then let the booking land on a calendar at a different venue. Expect the record at the booking's own venue, not at whichever venue happened to be first in the merge. Not a privacy test: the merged answer is deliberately less precise than each member's own page already is, and the single-venue exposure is an accepted platform decision (see plan §6.6, "What this is not").
- **SEC-04** (pgtap, W3): drift the engine cannot explain is kept, not tidied away. Change a replica by hand behind the engine flag, the way an engineer fixing something in the SQL editor would, then run the verifier. Expect an `unexplained_drift_repaired` audit row carrying the before-image, and an alert, rather than an ordinary apply row. I41 returns 0 afterwards. This is not a test that the flag keeps anyone out: it does not, and §6.4 says why it should not try.
- **SEC-05** (security, W15): `anon` cannot read the new per-calendar and attribution columns. `updated_by_user_id` is an `auth.users` identifier and `public_read_calendar_service_assignments` is `USING (true)` today, so this fails until that policy is dropped and the public catalogue is served through the admin client.

## 4. Invariants

All queries live in one service-role-only function `collective_invariant_report(p_since)` (REVOKEd from PUBLIC, anon, authenticated) so pgTAP, the verifier cron, the migration script and deploy gates run identical SQL. Names follow the amended design; rename if the build differs. `:since` = Pass A deploy time.

| Invariants | When | Gate |
|---|---|---|
| I1 I2 I3 I5 I8 I10 I13 I14 I15 I23 I32 | CI after every pgTAP scenario; Pass B after drain; daily cron; every deploy step | 0 (cron auto-repairs I3 by bumping, I5 by releasing, then alerts) |
| I3b I11 I12 I22 I30 | daily cron; deploy steps | 0, alert |
| I6 I16 | after the Pass A backfill; Pass B; daily cron | 0 |
| I7 | before the Pass A production push (unique indexes); before C2 | 0 |
| I24 | after every `db push`, each environment | 0 |
| I4 | Pass B until C1; inside `--rollback` | 0 |
| I21 | daily cron, once the compliance decision is taken | 0 if forms must be on at members |
| P1 to P5 | `--dry-run` | 0 or owner-resolved before `--apply` |

```sql
-- I1 active offering with missing master or master not at host
SELECT count(*) FROM collective_service_items i JOIN venue_collectives c ON c.id=i.collective_id
LEFT JOIN service_items s ON s.id=i.master_service_id
WHERE c.status='active' AND c.service_model='replicas' AND i.status='active' AND (s.id IS NULL OR s.venue_id<>c.host_venue_id);
-- I2 active offering x active member without link or replica (15 min grace)
SELECT count(*) FROM collective_service_items i
JOIN venue_collectives c ON c.id=i.collective_id AND c.status='active' AND c.service_model='replicas'
JOIN venue_collective_members m ON m.collective_id=c.id AND m.status='active' AND m.venue_id<>c.host_venue_id
LEFT JOIN collective_service_replicas r ON r.item_id=i.id AND r.venue_id=m.venue_id
WHERE i.status='active' AND (r.id IS NULL OR (r.replica_service_id IS NULL AND r.created_at<now()-interval '15 minutes'));
-- I3 link marked current whose fingerprint differs from the master's
SELECT count(*) FROM collective_service_replicas r
JOIN venue_collectives c ON c.id=r.collective_id AND c.status='active' AND c.service_model='replicas'
WHERE r.replica_service_id IS NOT NULL AND r.applied_revision=r.desired_revision
  AND collective_replica_fingerprint(r.id) IS DISTINCT FROM collective_expected_fingerprint(r.id);
-- I3b behind for more than 15 minutes
SELECT count(*) FROM collective_service_replicas WHERE applied_revision<desired_revision AND behind_since<now()-interval '15 minutes';
-- I4 active legacy provider without its CSA row (Pass B to C1, rollback)
SELECT count(*) FROM collective_service_providers p JOIN collective_service_items i ON i.id=p.item_id
JOIN venue_collectives c ON c.id=i.collective_id AND c.status='active'
LEFT JOIN calendar_service_assignments a ON a.calendar_id=p.practitioner_id AND a.service_item_id=p.source_service_id
WHERE p.status='active' AND p.practitioner_id IS NOT NULL AND a.id IS NULL;
-- I5 link outside an active membership of an active replicas collective
SELECT count(*) FROM collective_service_replicas r JOIN venue_collectives c ON c.id=r.collective_id
LEFT JOIN venue_collective_members m ON m.id=r.member_id
WHERE c.status<>'active' OR c.service_model<>'replicas' OR m.id IS NULL OR m.status<>'active'
   OR m.venue_id<>r.venue_id OR r.venue_id=c.host_venue_id;
-- I6 appointment booking without a price snapshot
SELECT count(*) FROM bookings WHERE service_item_id IS NOT NULL AND service_price_snapshot_pence IS NULL
  AND (status<>'Cancelled' OR created_at>=:since);
-- I7 venue with two live memberships or two live hostings
SELECT (SELECT count(*) FROM (SELECT venue_id FROM venue_collective_members WHERE status='active' GROUP BY venue_id HAVING count(*)>1) a)
     + (SELECT count(*) FROM (SELECT host_venue_id FROM venue_collectives WHERE status='active' GROUP BY host_venue_id HAVING count(*)>1) b);
-- I8 replica at the wrong venue, or also an active master
SELECT count(*) FROM collective_service_replicas r JOIN service_items s ON s.id=r.replica_service_id
WHERE s.venue_id<>r.venue_id OR EXISTS (SELECT 1 FROM collective_service_items i WHERE i.master_service_id=s.id AND i.status='active');
-- I10 replica mapping not pointing at the current master's children (repeat for requirements, managed groups, managed types)
SELECT count(*) FROM service_variants rv JOIN collective_service_replicas r ON r.replica_service_id=rv.service_item_id
JOIN collective_service_items i ON i.id=r.item_id LEFT JOIN service_variants mv ON mv.id=rv.replica_of_variant_id
WHERE rv.replica_of_variant_id IS NOT NULL AND rv.is_active AND (mv.id IS NULL OR mv.service_item_id IS DISTINCT FROM i.master_service_id);
-- I11 future booking on an inactive replica variant whose master variant is active
SELECT count(*) FROM bookings b JOIN service_variants v ON v.id=b.service_variant_id AND NOT v.is_active
JOIN service_variants mv ON mv.id=v.replica_of_variant_id AND mv.is_active
WHERE b.booking_date>=current_date AND b.status IN ('Pending','Booked','Confirmed');
-- I12 duplicate managed forms per template, or a managed form ignoring the member's own records
SELECT (SELECT count(*) FROM (SELECT 1 FROM compliance_types WHERE managed_by_collective_id IS NOT NULL AND archived_at IS NULL
          AND library_template_slug IS NOT NULL GROUP BY venue_id, managed_by_collective_id, library_template_slug HAVING count(*)>1) d)
     + (SELECT count(*) FROM compliance_types mt JOIN compliance_types ot ON ot.venue_id=mt.venue_id AND ot.id<>mt.id
          AND ot.managed_by_collective_id IS NULL AND ot.library_template_slug=mt.library_template_slug
        WHERE mt.managed_by_collective_id IS NOT NULL AND mt.archived_at IS NULL AND mt.accepts_records_from_type_id IS DISTINCT FROM ot.id);
-- I13 calendar offering another venue's service
SELECT count(*) FROM calendar_service_assignments a JOIN unified_calendars uc ON uc.id=a.calendar_id
JOIN service_items s ON s.id=a.service_item_id WHERE uc.venue_id<>s.venue_id;
-- I14 cross-venue children
SELECT (SELECT count(*) FROM service_addon_groups x JOIN service_items s ON s.id=x.service_item_id JOIN addon_groups g ON g.id=x.addon_group_id WHERE s.venue_id<>g.venue_id)
     + (SELECT count(*) FROM service_compliance_requirements q JOIN compliance_types t ON t.id=q.compliance_type_id WHERE q.venue_id<>t.venue_id)
     + (SELECT count(*) FROM service_variants v JOIN service_items s ON s.id=v.service_item_id WHERE v.venue_id<>s.venue_id);
-- I15 member's own service or venue-wide form using a host-managed group or form
SELECT (SELECT count(*) FROM service_addon_groups x JOIN addon_groups g ON g.id=x.addon_group_id WHERE g.managed_by_collective_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM collective_service_replicas r WHERE r.replica_service_id=x.service_item_id AND r.collective_id=g.managed_by_collective_id))
     + (SELECT count(*) FROM service_compliance_requirements q JOIN compliance_types t ON t.id=q.compliance_type_id WHERE t.managed_by_collective_id IS NOT NULL
          AND (q.scope='venue' OR NOT EXISTS (SELECT 1 FROM collective_service_replicas r WHERE r.replica_service_id=q.service_item_id AND r.collective_id=t.managed_by_collective_id)));
-- I16 booking owned by a venue other than its calendar's or service's
SELECT count(*) FROM bookings b JOIN unified_calendars uc ON uc.id=b.calendar_id LEFT JOIN service_items s ON s.id=b.service_item_id
WHERE b.created_at>=:since AND (uc.venue_id<>b.venue_id OR s.venue_id<>b.venue_id);
-- I21 (decision) replica with forms at a member whose forms are off (env FEATURE_FLAG_COMPLIANCE_RECORDS_ENABLED overrides; check it too)
SELECT count(*) FROM collective_service_replicas r JOIN venues v ON v.id=r.venue_id
WHERE EXISTS (SELECT 1 FROM service_compliance_requirements q WHERE q.service_item_id=r.replica_service_id)
  AND coalesce((v.feature_flags->>'compliance_records_enabled')::boolean,false)=false;
-- I22 lifecycle job stuck
SELECT count(*) FROM collective_operations WHERE status IN ('pending','running') AND coalesce(lease_until,updated_at)<now()-interval '1 hour';
-- I23 replica still carrying legacy sync state
SELECT count(*) FROM collective_service_replicas r JOIN service_items s ON s.id=r.replica_service_id
WHERE s.sync_state='linked' OR s.synced_from_service_id IS NOT NULL;
-- I24 client privileges on engine tables or sequences
SELECT (SELECT count(*) FROM audit_client_table_grants() WHERE relation_name IN
          ('collective_service_replicas','collective_audit_events','collective_operations','collective_catalogue_revisions'))
     + (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES ('anon'),('authenticated')) r(role)
        WHERE n.nspname='public' AND c.relkind='S' AND c.relname LIKE 'collective\_%' AND has_sequence_privilege(r.role,c.oid,'USAGE,SELECT,UPDATE'));
-- I30 member left or removed since deploy without a release audit row
SELECT count(*) FROM venue_collective_members m JOIN venue_collectives c ON c.id=m.collective_id AND c.service_model='replicas'
WHERE m.status IN ('left','removed') AND m.updated_at>=:since AND NOT EXISTS (SELECT 1 FROM collective_audit_events e
  WHERE e.collective_id=m.collective_id AND e.target_venue_id=m.venue_id AND e.event_type='member_released');
-- I32 active replica variant without mapping on a current link
SELECT count(*) FROM service_variants rv JOIN collective_service_replicas r ON r.replica_service_id=rv.service_item_id
 AND r.applied_revision=r.desired_revision WHERE rv.is_active AND rv.replica_of_variant_id IS NULL;
-- P1 offering with more than one active host source (ambiguous master)
SELECT count(*) FROM (SELECT p.item_id FROM collective_service_providers p JOIN collective_service_items i ON i.id=p.item_id AND i.status='active'
  JOIN venue_collectives c ON c.id=i.collective_id AND c.id=:collective AND p.venue_id=c.host_venue_id
  WHERE p.status='active' GROUP BY p.item_id HAVING count(DISTINCT p.source_service_id)>1) x;
-- P2 member service backing two offerings
SELECT count(*) FROM (SELECT p.source_service_id FROM collective_service_providers p JOIN collective_service_items i ON i.id=p.item_id
  AND i.status='active' AND i.collective_id=:collective WHERE p.status='active' GROUP BY p.source_service_id HAVING count(DISTINCT p.item_id)>1) x;
-- P3 managed form would collide on (venue_id, slug) with a member type from another template
SELECT count(*) FROM service_compliance_requirements q JOIN compliance_types ht ON ht.id=q.compliance_type_id
JOIN venue_collective_members m ON m.collective_id=:collective AND m.status='active' AND m.venue_id<>ht.venue_id
JOIN compliance_types mt ON mt.venue_id=m.venue_id AND mt.slug=ht.slug WHERE mt.library_template_slug IS DISTINCT FROM ht.library_template_slug;
```
P4: copy variants with future bookings and no master variant of the same name and sort order. P5: offerings with no active host source (needs_master), each with the owner's active-or-skip choice.

### Added by the second pass: I33 to I46

Each was checked against I1 to I32 for overlap before being added. I13 covers wrong-venue assignments, I14 covers three cross-venue child cases, I5 covers link scoping and I7 covers duplicate live memberships; none of the following is reachable from those.

| Id | Intent | Why it is needed |
|---|---|---|
| I33 | Live replica with no assignment on any calendar of its own venue, while the offering is active | A member can delete its calendar and cascade the assignment away (`calendar_service_assignments.calendar_id ... ON DELETE CASCADE`, `20260430120000:117`), silently withdrawing itself. Nothing else detects an absent assignment |
| I34 | Service filed under a heading belonging to another venue (`service_items` joined to `service_categories` on differing `venue_id`) | The `ON DELETE SET NULL` FK (`20270202120000:52-54`) has no venue check and I14 does not include this pair |
| I35 | Add-on option in a different venue from its group | I14 covers `service_addon_groups` and `service_variants`, not `addons` |
| I36 | Form version in a different venue from its type, and a requirement pointing at a version of another type | Neither is covered |
| I37 | Legacy provider row whose `member_id` disagrees with its `venue_id`, or with its item's collective | No FK ties them. Must be 0 from Pass B until C2 |
| I38 | Legacy provider pointing at a service or calendar belonging to another venue | `source_service_id` and `practitioner_id` carry no FK at all |
| I39 | Booking attributed to a collective its owning venue was never an active member of | `bookings.collective_id` and `collective_service_item_id` carry no FK by design (`20261210120000:163-168`), and §6.15 makes `collective_id` load-bearing for reporting |
| I40 | Booking whose guest belongs to a different venue | I16 checks the calendar and the service, not the guest, and the collective create rewrites `venue_id` after the guest is resolved |
| I41 | A replica applied since `:since` with no matching audit row in the same transaction window | Catches an engine-flagged raw SQL write, and a verifier repair filed as an ordinary apply, which is how the flag's lack of actor binding would otherwise erase its own evidence |
| I42 | Client privileges on the **legacy** collective and service tables, not only the four engine tables: `venue_collectives`, `venue_collective_members`, `collective_service_items`, `collective_service_providers`, `collective_service_categories`, `service_items`, `service_variants`, `addon_groups`, `addons`, `service_addon_groups`, `service_categories`, `calendar_service_assignments`, `compliance_types`, `compliance_type_versions`, `service_compliance_requirements`. Fail on any privilege other than SELECT, and assert that `public_read_calendar_service_assignments` and `public_read_practitioner_services` no longer exist | I24 passes while `anon` holds full DML on every table the engine's correctness actually depends on during Pass B and until C2 |
| I43 | A venue live in one collective while holding an `invited` row in another | I7 counts `status = 'active'` only, and the live unique index is per `(collective_id, venue_id)`, so it does not prevent this |
| I44 | Per-calendar terms written by a venue that is neither the calendar's owner nor the collective's host | Guards the new `updated_by_venue_id` and `updated_by_user_id` attribution columns |
| I45 | A copy still following an origin outside a live shared collective, during the Pass B window | Catches the legacy sync columns' "resumes syncing" behaviour and the member-to-member write path in SB-15 |
| I46 | A member venue in an active replicas collective whose subscription entitlement is neither active-like nor free-access and which is not marked `catalogue_suspended_at` | Ties member suspension to the canonical entitlement resolver, so a venue on a trial or inside a cancellation window is not suspended and a lapsed one does not keep selling |

**Gate placement.** I33, I34, I35, I36, I39, I40 and I44 join the CI-after-every-scenario set (expect 0). I37, I38 and I45 run from Pass B until C2. I41 and I43 run daily and alert. I42 replaces I24's narrower clause at every `db push`, on each environment. I46 runs daily.

## 5. Rollout verification

Follows the ritual (staging push, staging code, test, production push, merge, reset staging). "Invariants" = `node scripts/collective-invariants.mjs --env <env>` (new). Production runs override `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`. No Playwright and no fixture writes on production, ever.

### Pass 0: owed migrations first (RT1-9)
1. `npx supabase migration list --db-url` for staging and production; record both. Expected pending on production: 20270202120000, 20270202130000, 20270202140000, 20270204120000, 20270208120000, 20270209120000 (UNVERIFIED).
2. Each environment: push, `npm run check:function-grants`, `npm run check:table-grants`, then: non-canonical processing shapes 0, rota calendars without `schedule_periods` 0, sync columns present, staff Bearer read of `venue_collectives` without recursion.
- **Go**: identical lists afterwards, all checks 0, no new 5xx for 24 h. **No-go**: any surprise pending file.
- **Rollback drill**: data backfills cannot be undone; record the PITR point and prove a staging PITR restore boots.

### Pass A: expand (booking correctness, snapshot, CSA columns, engine dark, unique indexes)
Pre-flight: CI green (including engine races, PostgREST contract, migration lint); `supabase db push --dry-run` (flag UNVERIFIED on 2.114.0, else `migration list`) shows only 20270214120000 and 20270215120000; I7 = 0 on production; PERF-01 and PERF-02 baselines; read-only plus-1 catalogue snapshot (`scripts/collective-catalogue-snapshot.mjs`).

Staging:
1. Push; grant checks (four engine tables and sequences hold no client privileges, function allowlist unchanged); I6 and I24 = 0.
2. Deploy code A with `COLLECTIVE_REPLICAS_FOR_NEW_COLLECTIVES=false`.
3. plus-1 snapshot diff shows only the listed booking-correctness fixes; smoke e2e green; payment totals of every existing booking unchanged; a fixture walk-in gets a snapshot from the fallback.
4. Fixture collective switched to replicas: LIVE-01, E2E-01 to E2E-04, APP-04, perf budgets.
5. Owner signs the Pass A items.

Production: push; grant checks; I6, I7, I24 = 0; merge and deploy with the flag off; read-only catalogue diffs; 48 h watch (LIVE-02).
- **Go to Pass B**: 48 h clean on production, 7 days clean on staging fixtures. **No-go**: any refusal or `COLLECTIVE_*` 409 at a venue outside a replicas collective, any changed total, a breached budget.
- **Rollback drills (staging first)**: (1) redeploy the previous build over the Pass A schema, smoke green, bookings insert (fallback fills); (2) emergency SQL disables lock and dirty triggers, a fixture member edit succeeds, re-enable, verifier re-applies, I3 = 0; (3) snapshot backfill re-run writes 0 rows.

### Pass B: migrate existing collectives (per environment, after code A is live there)
Staging rehearsal on a scratch legacy collective built on `e2e-coll-*` fixtures with plus-1's shape (drift, archived same-slug form, variants, bookings):
1. `node scripts/collective-replicas-migrate.mjs --collective <id> --dry-run > report.json`; review P1 to P5.
2. `--apply --approved-report <sha256>`; I1 to I3, I5, I8, I10 to I16, I23, I32 = 0; every payment total unchanged; catalogue diff only intended.
3. `--rollback`: links released, `legacy_copies` restored, providers rebuilt from CSA now, before-images restored if chosen; legacy page equals the pre-migration snapshot; I4 = 0. 4. `--apply` again converges.

Staging plus-1: probe; dry run; owner review of the corrected D21 list (Light 3 has forms off and holds archived PPD Patch Test d1a15afc: adopt or derived slug, and whether forms are switched on); apply; invariants; `[coll-test]` price check with owner agreement; 7-day soak (verifier drift 0, I3b 0, stale hides 0, `COLLECTIVE_SERVICE_UPDATING` under 1 per 100 bookings); owner completes the checklist.

Production: read-only probes (P1 to P5, form collisions, Stripe readiness, forms flags and `FEATURE_FLAG_*` env, variants with bookings, I7); dry run; owner signs the report hash; apply per collective; invariants; totals diff 0.
- **Go**: every gate 0 with a signature. **No-go**: ambiguous masters, unresolved collisions, unmapped booked variants, any total change. **Rollback**: the drilled `--rollback`, valid until C1.

### Flag flip for new collectives (RT2-28)
After the staging soak and 7 clean days on a migrated production collective: set the flag on staging, run LIFE-01 and a fixture create-to-dissolve, then production. Rollback: flag off.

### Pass C1: code removal
Gates: no active collective outside replicas mode on either environment; legacy-reader sweep green; app contract green; legacy tests retired through INF-16. Staging 7 days, production 48 h. Rollback: previous build.

### Pass C2: contract migration
Gates: C1 on production 7 days; I7 = 0; the migration's DO block raises on any non-replicas active collective; the two collective pgTAP files updated in the same PR; drops use IF EXISTS; PITR point recorded. Staging push, CI, grant checks, production push, grant checks, invariants. Rollback: PITR only; drill a staging PITR restore that boots C1 code.

## 6. Owner acceptance checklist

Do this on staging after Pass B, signed in as the host and as a member in two browsers, using the E2E Coll fixture venues (or plus-1 and Light 3 where noted). Tick each box only when you have seen it yourself.

**R1 One venue, separate contacts and bookings**
- [ ] Open the collective page. Every practitioner calendar from both venues is listed under one set of headings. (Resource and non-practitioner calendars are filtered out by design, so do not expect them.)
- [ ] Book a member calendar as a guest. The booking appears in the member's diary and contacts, not in yours.
- [ ] As host staff, open Contacts. The member's new client is not there, and you cannot search the member's clients.
- [ ] **Open the member's diary from your own account and click one of their bookings.** This is the check that matters, and the Contacts check above passes even when it fails: the Contacts page was never where client details crossed. You should not see the member's client's name, email, phone, notes or documents unless you have deliberately agreed to share client details.
- [ ] **Open Booked revenue.** You should see the collective broken down by venue, and a member should see only their own. If either of you can see the other's total without having agreed to it, stop: that is the state the product is in today.

**R2 One host, one or more members**
- [ ] Linked accounts shows exactly one host. Try to invite a venue that already belongs to another collective: you see a clear refusal.

**R3 You choose the services, and missing ones are created**
- [ ] On your Services page, choose "Show on the {collective} page" for a service the member does not have. Within a minute it appears on the member's Services page under "From {host}".
- [ ] Take it off the page. The member's copy moves to "No longer offered", its calendars and bookings stay.

**R4 You control every detail**
- [ ] Change the name, description, price, length, a processing gap, an option and an add-on. Each change shows at the member within a minute.
- [ ] As the member, open that service. Every field is locked and the banner tells you who manages it.

**R5 You choose which calendars offer each service**
- [ ] In the service form, tick a member calendar and save. The member's Calendar Availability shows it ticked.
- [ ] Untick a member calendar that has bookings. The warning lists dates and times without client names, and those bookings stay.

**R6 Linked by default**
- [ ] Create a new collective with a fixture venue. Every offered service arrives at the member with no "link" or "sync" step and no independent copy option.

**R7 Your changes reach everyone, and you see every calendar**
- [ ] After a save you see "Saved. Updated at {venue}." (or "will update in a moment"). If a venue could not update, you see why and a Retry button.
- [ ] The service form lists the member's calendars next to yours, with add and remove.

**R8 Staff permissions and per-calendar values work the same at members**
- [ ] Allow staff to change the price. A member staff member sets a custom price on their calendar; the collective page and the booking charge use it.
- [ ] Turn the permission off. The custom price stops applying at your calendars and the member's alike.

**R9 Member calendars feel like yours**
- [ ] Book the same service on one of your calendars and one member calendar. Name, length, options, add-ons, forms and price rules match, apart from values you let calendars change.
- [ ] The confirmation email and the diary show the same service name as the page.
- [ ] **If you or one of your team works at two venues in the collective, you can sign in once and move between them without signing out.** Today that person cannot sign in at all.
- [ ] Look at a member's column in your diary on a day that venue is closed. It shows them closed, not open.
- [ ] Try to move a booking to a calendar at another venue. Whatever the answer, it is the same answer every time and the dialog explains it plainly.

**R10 Member calendar choices sync by themselves**
- [ ] As the member, untick a service on Calendar Availability and save. The collective page drops that calendar for that service straight away. Tick it again and it returns.

**R11 Nobody is misled about how far a change reaches**
- [ ] Your Services page says which services are shared and with how many venues. The member's page says which services it cannot edit.
- [ ] Settings that still differ per venue (for example waitlist or reminders) show "Different at {venue}".

**R12 Everything runs through you, apart from what you delegate**
- [ ] As the member, try to delete or switch off a shared service, change an add-on group or edit a shared form. Each is refused with a plain explanation.
- [ ] In the ResNeo app on an older build, try the same edit. You see the same explanation, not an error screen.

**R13 A member can leave at any time and take control back**
- [ ] As the member, choose Leave. Every service, calendar choice, price and booking is still there, and the services are now editable.
- [ ] The member's own booking page is back, and old links to it work. If the member has no Stripe, services that took payment online now say they do not, and you were told.

**R14 Breaking the collective returns everyone to their own page**
- [ ] Dissolve a fixture collective. The old collective address shows a page pointing to each venue's own booking page.
- [ ] Each venue's own page takes bookings, and nothing in either account was deleted.

**Money and safety, across all requirements**
- [ ] After a price change, an earlier booking still shows the price the client agreed, and your revenue report for last month is unchanged.
- [ ] A member without card payments set up is not offered to guests for a service that needs a deposit.
- [ ] A guest booking a member calendar that needs a patch test form can complete it, including the file upload.

## 7. CI changes

1. **Extend the projection guard.** `src/lib/testing/migration-columns.ts` and its test are committed (`973bd3e`); they were uncommitted while this plan was written, so the earlier instruction to commit them first is done. Extend it to check insert, update and upsert payload keys and `onConflict` columns, and make it mandatory in every new route test for collective, service, booking and compliance routes (sweep INF-09 enforces `makeAfterStub()` there too).
2. **`supabase/scripts/local_baseline_grants.sql`**: add `collective_service_replicas`, `collective_audit_events`, `collective_operations`, `collective_catalogue_revisions` to the exclusion list, and replace the blanket `GRANT USAGE, SELECT ON ALL SEQUENCES` with a loop that skips `collective_%` sequences. Without this CI re-grants what Pass A revokes and the grant assertions pass against a database that exists nowhere (INF-08).
3. **`rls-pgtap` job** (`.github/workflows/ci.yml:77-131`): add `timeout-minutes: 30`; new pgTAP files run automatically; after `supabase test db` add
   - `bash scripts/db-concurrency/run.sh` (psql sessions against `127.0.0.1:54322`, conductor-driven races CON-01 to CON-04, installs the local `collective_engine_test_point` override);
   - `node scripts/db-contract/postgrest-contract.mjs` (keys from `supabase status -o env`; SEC-01);
   - a non-blocking `node scripts/db-contract/trigger-overhead.mjs` report step (`continue-on-error: true`) for PERF-03.
4. **New `migration-lint` job** (no database, fast): `node scripts/check-migrations.mjs` (INF-15): single-event transition-table triggers, REVOKE on new tables, sequences and functions naming PUBLIC, anon, authenticated, `SET search_path` on SECURITY DEFINER, `SET resneo.collective_engine` on engine functions, no STABLE or IMMUTABLE writers, no policy subquery on `venue_collectives` or `venue_collective_members`, engine-bypass preamble on data migrations touching service tables, IF EXISTS on contract drops.
5. **Align the Supabase CLI**: change `package.json` `test:db` from 2.98.2 to 2.114.0 so the flag-restoration and trigger proofs run on the same CLI and Postgres locally and in CI.
6. **`test` job**: nothing to add; new sweeps, contract replays and query-count budgets are Vitest files. Keep the legacy-test retirement register (INF-16) in the suite so C1 cannot leave pinned legacy tests behind.
7. **`e2e-smoke` job**: add `node scripts/seed-e2e-collective.mjs` after the existing seeds, variables `E2E_COLLECTIVE_HOST_SLUG`, `E2E_COLLECTIVE_MEMBER_A_SLUG`, `E2E_COLLECTIVE_MEMBER_B_SLUG` and secret `E2E_COLLECTIVE_MEMBER_A_STRIPE_ACCOUNT_ID`; `e2e/global-setup.ts` must throw, not warn, when `CI` and `RUN_E2E_SMOKE` are set but any of these is missing (INF-12); upload the seed's ledger with the failure artifacts.
8. **New nightly workflow** `.github/workflows/nightly-engine.yml` (`schedule` plus `workflow_dispatch`): local Supabase, 1,000-round fuzz (ENG-08), 50 by 10 scale fixture for PERF-03 with EXPLAIN output as an artifact. Not a PR gate.
9. **Optional `app-contract-live` workflow** (`workflow_dispatch`, gated on `vars.RUN_APP_CONTRACT_LIVE`): APP-04 Bearer replay against staging fixtures with the staging secrets the e2e job already holds.
10. **Unchanged by design**: `check:function-grants` and `check:table-grants` stay in the migration ritual, run against each hosted environment after every push (they need the secret key and hosted defaults differ from local). Extend `check-table-grants.mjs` with the four engine tables as "no client privileges" and a sequence check, and keep the function allowlist unchanged (no engine function may appear).
