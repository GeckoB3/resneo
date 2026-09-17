# Venue collectives as one venue: testing plan

Status: PLAN, not implemented. Companion to `Docs/collective-one-venue-plan.md`, which defines the
requirements (R1 to R14), the decisions (D1 to D54) and the red-team findings (RT1-1 to RT1-17,
RT2-1 to RT2-28) this document refers to; read that first. Written 2026-09-13 against `staging` at
`c6020eb6`; line numbers are anchors at that commit plus the two commits the plan's header names (`818ed5a`, `973bd3e`), and the plan's "Reading the citations" note applies here too. Reviewed 2026-09-14 at `c0b5eb0`, then brought into line with the decisions settled that day (D37 to D54, Decisions A and C) by the consistency pass. It is the safety net for the redesign: what exists today and where it is blind, the strategy, every test, the invariants, the rollout gates and the acceptance checklist for the owner.

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
14. **No cron or alert coverage at all.** `withCronRunLogging` (`src/lib/platform/cron-log.ts`) and `finalizeCronRun` (`src/lib/cron/finalize-cron-run.ts`) are untested, `cron_runs` is asserted nowhere, and no test proves a cron route refuses an unauthorised caller. This design adds two crons (`collective-replicate` every 5 minutes and `collective-verify` daily) that write into other venues' accounts behind `CRON_SECRET`, a single static token on routes the middleware does not cover (`src/middleware.ts:352`), so the wrapper they depend on needs tests before they ship (OPS-01).
15. **The only platform-console coverage is auth shape.** Nothing tests what a superuser can see or do, and this design adds a surface that reads every collective's state across venues (OPS-03).
16. **Nothing stops an em-dash reaching a help article.** The existing copy tests cover booking copy and the assistant's answers, not `src/lib/help/articles/**`, and this project rewrites roughly twenty articles under a rule that forbids them (HLP-01).

## 2. Strategy

### Design under test

Model R with the red-team amendments: revision-based replica links (`desired_revision`, `applied_revision`, `behind_since`, `lease_until`) bumped by one SECURITY DEFINER trigger per event per table inside the writer's transaction; `collective_apply_replica` locks the link row and records the revision it read; engine functions VOLATILE with a function-level `SET resneo.collective_engine = 'on'`; locks only for replicas of active memberships in active replicas collectives, released by status triggers; offered-master delete and `host_venue_id` changes refused in the database; transfer re-keys every `replica_of_*`; revisions in `collective_catalogue_revisions`; every replicated column classified; snapshots backfilled for all appointment bookings, filled by a BEFORE INSERT fallback and read first by settling paths; compliance served from the owning venue's managed type; D3: every venue's own page, the host's included, hands over to the collective page only while the page is live and the venue is listed (and, for a member, converged), a rule derived from state with no column to write (`solo_page_behavior` is dropped in C2); D41 (revised 2026-09-14): a collective sits on top of full-access account links and never writes them, so leave, removal and dissolve change only the collective (its page, staff form, contact search scope and report view) and every account link carries on; D49: every member sees every venue's figures, named and subtotalled, never blended; D50: a host save that reached members can be put back for 60 seconds from the before-image in `collective_audit_events`; D52: a released service that shares a name with one the member kept stays a separate, active service, with no merge; D54: existing collectives move by the host's values applying to every service at the switch, with every existing booking protected, before-images recorded for rollback (D30) and nothing sent to or shown to members; replicas mode for new collectives behind a platform flag. D29 (one name and description everywhere) and D54 (the host's values at migration, every booking protected) were decided on 2026-09-14 and are tested as decided.

### Layers

| Layer | Where | Proves |
|---|---|---|
| unit and sweeps | Vitest `test` job | terms resolver, guard normaliser, redirect decision; filesystem sweeps (guarded writers, snapshot writers, status writers, registered codes, no em-dash) |
| route | Vitest + `recording-supabase` + `columnsMissingFromMigrations` + `makeAfterStub()` | status, code, prose, guard before any write, zero writes on refusal, projections, deferred notices |
| component | Vitest happy-dom | copy, locked controls, ConfirmContext dialogs, no names across venues |
| pgtap | CI `rls-pgtap` | schema, grants, locks, convergence per child type, unique-key safety, lifecycle transactions, snapshot backfill, invariant function with positive controls |
| engine-invariant | CI step, several `psql` sessions on one local database | lost updates, sibling propagation, leases, lock order, assignment and booking races |
| migration | local plus staging rehearsal | expand inert, idempotent backfills, honest dry run, convergence, rollback |
| app-contract | Vitest golden replays; live Bearer replay on staging fixtures | old builds get 200, a readable coded 409, or 412 `STALE_RESOURCE` on a stale set |
| e2e | Playwright on staging collective fixtures | guest and staff journeys across venues, member Stripe, forms, redirects |
| live-staging | service-role scripts on fixtures; read-only probes on plus-1 | hosted grants, pooler, timings |
| performance | Vitest query counts (blocking); local and staging timing (deploy gates) | no N+1, trigger overhead, apply and drain, staff form, public availability |
| security | pgTAP, PostgREST contract, live grant checks | no client path into engine tables, sequences, functions or the flag; no guest PII in audit rows, notices or anonymous reads |
| manual | owner, device with app 1.1.0 | acceptance R1 to R14, legal text as reviewed (D9), help accuracy |

### Risk codes

RT1 (engine-data-deploy): 1 queue loses changes; 2 transfer orphans mappings; 3 managed form slug collision; 4 locks outlive membership; 5 offered master delete; 6 PATCH writes replicas and guard misfires; 7 trigger and flag mechanics; 8 snapshot scope; 9 production migration state; 10 denylist copies future columns; 11 unapplied replicas published; 12 CSA races; 13 member services borrow managed items; 14 revision hot row; 15 photo URLs; 16 option churn and headings; 17 grants, actor, cross-venue dialog.
RT2 (product-lifecycle-engine): 1 snapshot not read when settling; 2 member-calendar form capture; 3 redirect liveness; 4 transfer re-key; 5 flag gating; 6 forms off at members; 7 slug collision; 8 app joins without consent; 9 no-Stripe leaver; 10 member-only services; 11 cross-venue groups; 12 D17 audit and rights; 13 staff form copies clients; 14 legal identity; 15 Stripe readiness; 16 columns not to copy; 17 per-calendar values; 18 public freshness; 19 app stale PUT and false 409s; 20 adoption; 21 future data migrations and import undo; 22 deep links and dissolve; 23 notice and re-consent; 24 member venue-wide forms; 25 venue settings; 26 engine details; 27 withdraw and re-join; 28 replicas mode before soak.
H: PROJ projection-blind fakes; AFTER no-op `after()`; C0 hosted grants; RECUR policy recursion; SEAM backfill and dual-write; MAXROWS PostgREST cap; RESIDUE undeletable staging rows; VACUOUS suites that skip green.

### Fixtures

- **Vitest**: `src/lib/testing/collective-world.ts`: host H (Stripe, forms on), member A (Stripe, forms on), member B (no Stripe, forms off, archived same-slug PPD type), outsider O; calendars H1 H2 A1 A2 B1; masters S1 plain, S2 variants plus two add-on groups plus processing, S3 deposit, S4 card hold, S5 inline PPD form with file field, S6 under a host venue-wide form, S7 inactive; member-only services (one sharing a master name, kept separate at join, so a release produces the same-name pair LIFE-11 checks); A1 custom price and duration; past, future, variant, add-on and cancelled bookings; replica links in every revision state and every provenance (`created`, `adopted`, `migrated`, `reconnected`), plus one released row (`released_at` set). Added for the later tests: guests and bookings at all three live venues (H, A and B are the three-venue live collective LIFE-09 and I47 need), with full-access `account_links` rows between every pair, one of them with a narrower revenue grant so REP-06 can tell link access from collective access; a person P holding staff rows at A and O (MV-01); a class-only venue K with no active appointments model (BM-01); a venue E trading in EUR (BM-04, TERMS-15); a calendar at A and one at B whose normalised name and email match (DIARY-02); and an audited host save under 60 seconds old with its before-image (OFF-05). Every emitted row must pass the column guard.
- **Golden app payloads**: `src/app/api/__app-contract__/fixtures/` generated from `C:/Resneo-app` d90dece and stamped with the commit.
- **SQL**: the same world at fixed UUIDs in `supabase/test-fixtures/collective_world.sql` (psql include support on CLI 2.114.0 UNVERIFIED; fallback generates files), including the two account links, the three-venue release shape and the same-name pair; a legacy-shape variant with staging drift and dissolved residue, extended for MIG-01, MIG-05 and MIG-06 with a member value that differs from the host's where a per-calendar home exists (price, length) and where none exists (payment rule, location, a staff flag, heading, name, description, an add-on link, a form), an offering whose page copy differs from its master, member-only services, an inactive copy, a member with forms off holding a form-bearing copy, and full-access pairwise account links, one of them narrowed below full access so the mesh check has something to report; and `pg_temp.collective_scale(50, 10)` for nightly runs.
- **Staging**: `scripts/seed-e2e-collective.mjs` creates `e2e-coll-host`, `e2e-coll-member-a` (second Stripe test account), `e2e-coll-member-b` (no Stripe), accepted account links and staff users on `@resneo-e2e.invalid` (run by the owner because it creates auth users). It refuses non-`e2e-coll-` venues and any project but staging. plus-1 and Light 3 are never fixtures.

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
2. `compliance_audit_events` refuses UPDATE and DELETE including FK actions, so engine-created forms, and guests, records, account links and staff they touch, cannot be deleted: archive types instead. This is how H-RESIDUE happened.
3. Dissolve frees the slug (`dissolved-<id>`, `src/app/api/venue/collectives/[id]/route.ts:254-258`) but holds the name 30 days for other hosts (`src/app/api/venue/collectives/route.ts:107-122`): use run-unique names.
4. Fixture guests stay unless deleted; bookings need Cancelled then DELETE; Stripe test objects cannot be removed; copied photos must be deleted from storage.
5. Deleting fixture account links cascades `account_link_audit_log`: export evidence first. Archived offerings accumulate (plus-1 holds 91): count, never delete, on plus-1.

## 3. Test inventory

170 tests. By layer: route 58, unit 36, pgtap 30, component 10, e2e 5, live-staging 6, migration 8, security 4, engine-invariant 4, performance 4, app-contract 3, manual 2.

The first 113 came from the first pass. The 34 added by the second pass (OPS-01 to OPS-04, MV-01, MV-02, LIFE-09, LIFE-10, REP-01 to REP-05, BM-01 to BM-06, PLAN-01 to PLAN-03, SEO-01, SEO-02, WAIT-01, FAIR-01, DIARY-01, HLP-01, TERMS-16, CSA-04, DB-10 and SEC-03 to SEC-05) cover the areas it reached that the first did not: operations and alerting, people who work at more than one venue, what a collective's end does and does not change, reporting and attribution, booking models other than appointments, plan tiers and caps, the public page's metadata and waitlist, diary truth, and the help centre's own copy rules. The 6 added by the UI review (UI-C-01 to UI-C-06) and the 4 added by the verification pass (CSA-05 to CSA-08) follow them. The 13 added by the consistency pass of 2026-09-14 (OFF-05, OFF-06, LIFE-11 to LIFE-14, REP-06, DIARY-02, DIARY-03, PUB-05, MIG-05, MIG-06 and NOT-01) cover the decisions settled that day: the D50 undo, host-initiated adoption, the same-name pair after leave, invitation withdrawal and expiry, the paused state and the transfer window, account links left untouched on today's model, reports after the end, the D47 clash warning and the D46 move dialog, other booking models under D3, the non-destructive migration, and the N32 to N37 notices. The second-pass tests are detailed in §3.28; the later ones sit with the group they belong to, and §3.28 ends with a list of them.

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
| INF-16 | unit | Legacy tests are removed deliberately, not patched to green | W14 Contract |
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
| CSA-02 | route | Stale full-set saves cannot erase the host's assignment | W2 Calendar assignments |
| CSA-03 | route | All seven per-calendar values stored, gated and writable by the right people | W8 Per-calendar fields |
| DB-01 | pgtap | Engine objects: grants, definer, search_path, volatility, flag clause | W3 Engine |
| DB-02 | pgtap | Engine flag does not leak and refusals are distinguishable | W3 Engine |
| DB-03 | pgtap | Lock predicate: replicas and managed objects of live memberships only | W3 Engine |
| DB-04 | pgtap | Status triggers release in the same transaction | W7 Lifecycle |
| DB-05 | pgtap | Offered master delete and host change are refused in the database | W3 Engine |
| DB-06 | pgtap | Dirty triggers bump every affected replica link and nothing else | W3 Engine |
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
| CON-02 | engine-invariant | Overlapping crons never apply the same replica link twice | W3 Engine |
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
| MIG-02 | migration | Apply converges per replica link, resumably, without changing any total | W9 Migration |
| MIG-03 | migration | Rollback restores the legacy page and can be re-applied | W9 Migration |
| MIG-04 | live-staging | Staging rehearsal then plus-1 migration | W9 Migration |
| PUB-01 | unit | Own pages, the host's included, hand over only when the venue is really bookable there | W10 Booking pages and links |
| PUB-02 | route | Redirects keep the guest's place; links to parked services do not dead-end | W10 Booking pages and links |
| PUB-03 | component | Guests see who they are booking with | W10 Booking pages and links |
| MGR-01 | route | Old catalogue actions are shimmed with coded answers | W11 Manager fold |
| VEN-01 | unit | Venue-level settings are inventoried and differences are visible | W7 Lifecycle |
| APP-01 | app-contract | App 1.1.0 service saves against replicas and masters | W12 Mobile contract |
| APP-02 | app-contract | App toggles, overrides, add-ons, forms and membership actions | W12 Mobile contract |
| APP-03 | app-contract | Additive reads and diary routing for old builds | W12 Mobile contract |
| APP-04 | live-staging | Live Bearer replay and device check | W12 Mobile contract |
| SEC-01 | security | PostgREST gives clients no way into the engine | W15 Grants |
| SEC-02 | security | No guest PII in audit rows, notices, the history route or anonymous reads | W15 Grants |
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
| OPS-02 | route | The verifier repairs I3b and I5, files I3 as unexplained drift with an alert, and alerts on the rest | W18 Operations |
| OPS-03 | route | Platform collective panel is superuser-only, read-only apart from Retry, audited, and shows no guest contact details | W18 Operations |
| OPS-04 | unit | Every cron route directory has a `vercel.json` entry, and every entry has a route | WT Test harness |
| MV-01 | unit | A person with staff rows at two venues gets an explanation, never a silent redirect into signup | W16 Multi-venue people |
| MV-02 | route | Staff invite refuses an email that already works at another venue, with the plain reason | W16 Multi-venue people |
| LIFE-09 | pgtap | Leaving, removal and dissolve end the collective's own access and leave every account link untouched | W7 Lifecycle |
| LIFE-10 | route | Contact search reaches every live member venue, names the owner, and refuses outside the collective | W7 Lifecycle |
| REP-01 | unit | `bookings.collective_id` is read by every report, filter and export (no collective `source` value, D55) | W17 Reporting |
| REP-02 | route | Booked revenue breaks down by venue and never blends without naming the venues | W17 Reporting |
| REP-03 | route | Every member's figures are named and subtotalled, and the mutual visibility was consented at join | W17 Reporting |
| REP-04 | unit | `buildPriceSummary` reads the snapshot first and agrees with `loadRowTotalResolver` | W1 Booking correctness |
| REP-05 | route | Narrowing an account link does not silently remove a revenue column while membership continues | W17 Reporting |
| BM-01 | route | Invite and accept refuse a venue with no active appointments model, with the reason | W20 Booking models |
| BM-02 | route | Removing `unified_scheduling` while in a collective is refused with a coded 409 | W20 Booking models |
| BM-03 | unit | The redirect leaves a route through for a member's classes, events and resources | W20 Booking models |
| BM-04 | route | Currency is gated at create, invite and accept, as timezone already is | W7 Lifecycle |
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
| CSA-05 | route | The cross-venue assignment writer refuses everything it must, and I13 is a constraint | W5 Host Services page |
| CSA-06 | route | One function behind three host surfaces, with a per-operation envelope | W5 Host Services page |
| CSA-07 | component | "Last changed by" is true on both sides and survives an unrelated save | W5 Host Services page |
| CSA-08 | component | Per-calendar values are reachable from the calendar page | W8 Per-calendar fields |
| DB-10 | pgtap | Every classified column's entry matches what an apply actually writes | W3 Engine |
| SEC-03 | route | A pre-booking form files at the venue that will hold the booking | W4 Catalogue and booking switch |
| SEC-04 | pgtap | Drift the engine cannot explain is audited and alerted, not quietly repaired | W3 Engine |
| SEC-05 | security | New per-calendar and attribution columns are not readable by `anon` | W15 Grants |
| UI-C-01 | component | The create wizard surfaces every server refusal inside the step that caused it | W7 Lifecycle |
| UI-C-02 | component | The collective row's pill describes the page, not the membership row | W5 Host Services page |
| UI-C-03 | component | A member's service view renders values, never disabled inputs | W6 Member locks and UI |
| UI-C-04 | route | The services grid chunks bulk operations and reports a result per venue | W5 Host Services page |
| UI-C-05 | component | The join disclosure names the member's own address and records consent | W7 Lifecycle |
| UI-C-06 | route | D3 is derived: every venue's own page hands over while live, listed and converged, and the nav follows it | W10 Booking pages and links |
| OFF-05 | route | Put it back: the 60-second undo restores the before-image and re-applies | W5 Host Services page |
| OFF-06 | route | Add from another venue: host-initiated adoption, the member's answer and the 14-day default | W5 Host Services page |
| LIFE-11 | route | Two same-named services after leave both stay active, marked, and are never merged | W7 Lifecycle |
| LIFE-12 | route | Invitations are withdrawn, expire after 30 days, and are closed by dissolve | W7 Lifecycle |
| LIFE-13 | route | The paused page and the transfer window: leave, take over, cancel, decline, retry, expiry | W7 Lifecycle |
| LIFE-14 | route | Today's leave, removal and dissolve routes leave every account link untouched | W7 Lifecycle |
| REP-06 | route | Reports after the end show own rows only, with the "via {collective}" filter kept | W17 Reporting |
| DIARY-02 | route | Two calendars that look like one person warn whoever books second | W21 Diary truth |
| DIARY-03 | component | A booking moves to another venue's calendar in one step when nothing is attached, and is refused with the reason otherwise | W21 Diary truth |
| PUB-05 | route | A member with another booking model keeps its own page for those tabs | W10 Booking pages and links |
| MIG-05 | migration | Existing bookings are protected through apply and rollback | W9 Migration |
| MIG-06 | migration | The host's values apply at the switch, the before-image is recorded, nothing is sent or shown | W9 Migration |
| NOT-01 | unit | N32 carries no contact details, N36 and N37 fire once | W5 Host Services page |

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
- **Scenario:** Build the world (host, members A and B, outsider, masters S1 to S7, replica links in every revision state and provenance, the two account links, the same-name pair, bookings) and validate it.
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
- **Scenario:** After local_baseline_grants.sql runs, query has_table_privilege and has_sequence_privilege for anon and authenticated on the five engine tables (`collective_service_replicas`, `collective_catalogue_revisions`, `collective_audit_events`, `collective_operations`, `collective_column_classes`) and collective sequences.
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
- **Expected:** Deletes bookings, replica links, account links, services, calendars in reverse order; archives compliance types; lists residue (collective_audit_events, compliance_audit_events rows) by id; exit 0.
- **Location:** `scripts/coll-test-cleanup.mjs`

#### INF-15: Migration lint catches the known bad shapes

- **Layer:** migration. **Workstream:** WT Test harness. **Requirements:** R12.
- **Pins:** RT1-7; RT1-9; RT2-21; H-RECUR; H-C0
- **Scenario:** Feed fixture migrations: multi-event trigger with transition tables, table without REVOKE, sequence without REVOKE, STABLE writer, policy subquerying venue_collective_members, DEFINER without search_path, UPDATE service_items without bypass preamble, DROP without IF EXISTS.
- **Expected:** Each is reported with file and line; the real migrations folder passes.
- **Location:** `scripts/check-migrations.test.mjs`

#### INF-16: Legacy tests are removed deliberately, not patched to green

- **Layer:** unit. **Workstream:** W14 Contract. **Requirements:** R6,R11.
- **Pins:** Blind spot 5
- **Scenario:** Register lists collective-booking-override.test.ts, service-sync.test.ts, catalogue route.sync tests, CombinedPageManager.inline set_providers case and app service-sync-view.test.ts with the pass that removes each.
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
- **Scenario:** Calendar custom deposit and buffer on A1; a staff name and description change on A1 for a service that is on the collective page, and the same change for a service that is not, with the name and description flags on.
- **Expected:** Catalogue, create, confirmation email and service_name_snapshot agree. Under D29 (decided 2026-09-14) the offered service refuses the name and description with the coded 409 and the page keeps the master's name; the service that is not offered accepts them where the flag is on and shows the calendar's name everywhere.
- **Location:** `src/lib/linked-accounts/replicas/catalogue-display.test.ts`

#### TERMS-14: Services GET returns effective gated values

- **Layer:** route. **Workstream:** W8 Per-calendar fields. **Requirements:** R8.
- **Pins:** RT2-5
- **Scenario:** GET /api/venue/appointment-services for a staff member whose flag is off but a value is stored.
- **Expected:** practitioner_services show effective values; no client-side merge needed; five new fields no longer hard-coded null.
- **Location:** `src/app/api/venue/appointment-services/route.get.test.ts`

#### TERMS-15: Currency and timezone gates

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R1,R2.
- **Pins:** graft 4; T29 (the currency gate and the booking-model lock live in W7, so BM-04 and this test share a workstream)
- **Scenario:** Create, invite and accept with a EUR member; PATCH /api/venue timezone while in a live collective.
- **Expected:** Refused with coded 409 (`COLLECTIVE_CURRENCY_MISMATCH`, `COLLECTIVE_TIMEZONE_LOCKED`) and plain prose; timezone unchanged.
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
- **Layer:** route. **Workstream:** W2 Calendar assignments. **Risk:** RT1-12; PB-03; PB-08. **Requirements:** R10.
- **Pins:** Both writers delete every row and re-insert today, so ids churn and per-calendar values vanish on every save
- **Scenario:** PUT practitioner-services with `expected_service_ids` equal to the current set, adding one, removing one, keeping one; the same PATCH appointment-services with `expected_calendar_ids`; foreign service ids on the PUT and foreign calendar ids on the PATCH; a retired replica id in the add set; injected delete error.
- **Expected:** Only the removed row deleted and only the added row inserted; the kept row keeps its id, all seven custom values and its `updated_*` columns; the added row carries the caller's venue and user; foreign ids 403 on both routes; retired replica 409 `COLLECTIVE_SERVICE_RETIRED`; injected error 500 with no partial write on either route.
- **Location:** `src/app/api/venue/practitioner-services/route.test.ts; src/app/api/venue/appointment-services/route.assignments.test.ts`

#### CSA-02: Stale full-set saves cannot erase the host's assignment
- **Layer:** route. **Workstream:** W2 Calendar assignments. **Risk:** RT1-12; RT2-19. **Requirements:** R10, R11.
- **Pins:** PB-04; a diff alone does not fix the race, expected ids do
- **Scenario:** `expected_service_ids` mismatch on the PUT; `expected_calendar_ids` mismatch on the PATCH; old-app PUT and old-app PATCH without expected ids that remove a row the host function wrote 2 h ago, and again for a row written 25 h ago; a rename-only save from the Edit calendar dialog while the host adds a row.
- **Expected:** 412 `STALE_RESOURCE` "Someone else changed this calendar's services. Refresh and try again." on both routes; the 2 h row survives the old-app saves and the 25 h row does not, and the loss is audited; own removals and requires_confirmation still work; the rename-only save sends no services PUT and meets no 412.
- **Location:** `src/app/api/venue/practitioner-services/route.stale.test.ts; src/app/api/venue/appointment-services/route.stale-calendars.test.ts; src/app/dashboard/availability/AppointmentAvailabilitySettings.collective.test.tsx`

#### CSA-03: All seven per-calendar values stored, gated and writable by the right people

- **Layer:** route. **Workstream:** W8 Per-calendar fields. **Requirements:** R8.
- **Pins:** RT2-17
- **Scenario:** Override PATCH with name, description, buffer, deposit, colour, price, duration as staff (flags), venue admin (D4), host admin via `collective_set_calendar_values`; out-of-range values; the name and description once for a replica of an offered service and once for a service that is not on the collective page.
- **Expected:** Stored within CHECK ranges; refused when flag off or caller lacks authority; host RPC audited with actor; card-hold deposit floor applied; name and description on the offered service refused with the coded 409 under D29's default (TERMS-13 carries the owner's marker), and accepted on the service that is not offered where the flag is on.
- **Location:** `src/app/api/venue/practitioner-service-overrides/route.seven-fields.test.ts; supabase/tests/collective_calendar_values_test.sql`

### 3.7 Engine objects and locks

#### DB-01: Engine objects: grants, definer, search_path, volatility, flag clause

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R12.
- **Pins:** RT1-7; RT1-17; H-C0
- **Scenario:** Inspect pg_proc and pg_class for engine functions, trigger functions, the five engine tables and their sequences.
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
- **Scenario:** Directly UPDATE venue_collective_members to left, and venue_collectives to dissolved while the members update fails (two statements, as the dissolve route does today); a third run through `collective_dissolve`, the one path the host's DELETE and both crons use.
- **Expected:** The status trigger calls `collective_release_member`, so in the status statement's own transaction the member's replica links are released (`released_at` set, rows kept), locks lifted, managed objects unmanaged, adoption cleared, and no `account_links` row written; I5 = 0 and I47 = 0 even when the second statement fails; `collective_dissolve` produces the same rows as the two statements.
- **Location:** `supabase/tests/collective_lifecycle_test.sql`

#### DB-05: Offered master delete and host change are refused in the database

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R11,R12.
- **Pins:** RT1-5; RT1-2
- **Scenario:** DELETE master of an active offering (service role, authenticated host admin, import-undo style multi-id delete); UPDATE host_venue_id outside the engine.
- **Expected:** Dedicated SQLSTATEs; multi-id delete fails atomically; archived offering's master deletable; host change only through collective_transfer_host.
- **Location:** `supabase/tests/collective_locks_test.sql`

#### DB-06: Dirty triggers bump every affected replica link and nothing else

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1; RT1-7
- **Scenario:** Master column update, variant insert, option change, host venue-wide requirement change, version publish, heading rename, sort_order-only reorder, write at a venue outside any collective, CSA write.
- **Expected:** desired_revision bumped on every replica link of affected offerings; no bump for sort_order-only; zero engine writes for the outside venue; one trigger per event per table exists.
- **Location:** `supabase/tests/collective_dirty_triggers_test.sql`

#### DB-07: Every replicated-table column is classified; not-copied columns never copy

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4,R9.
- **Pins:** RT1-10; RT2-16
- **Scenario:** Compare pg_attribute of service_items, service_variants, addon_groups, addons, compliance_types, compliance_type_versions, requirements, service_categories with collective_column_classes; add a scratch column; apply a master with meeting link, arrival text, option cost.
- **Expected:** Unclassified column fails; `pre_appointment_instructions` is a venue column (D53), seeded from the master when the replica is created and never overwritten by an apply, as is `capacity_per_session` (D40); the meeting link and joining information are `not_copied` (D11), so a member never receives the host's meeting room; `online_unmet_message` is a host column (D53); `cost_to_business_pence` follows its registry class (RT2-16).
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
- **Expected:** No duplicate heading and no 23505; member delete marks replica links dirty and the next apply re-files.
- **Location:** `supabase/tests/collective_apply_children_test.sql`

#### ENG-05: Compliance adoption, requirement merge and version no-churn

- **Layer:** pgtap. **Workstream:** W3 Engine. **Requirements:** R4,R9.
- **Pins:** RT1-3; RT2-7
- **Scenario:** Member holds an archived ppd-patch-test with the same template (staging shape); host requires the type venue-wide and on the service; host publishes an identical then a changed form.
- **Expected:** Archived type unarchived and adopted as the managed form (the staging shape's answer), records still count; one requirement with strictest enforcement; new version only on schema change; no 23505.
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
- **Expected:** Fingerprint differs for every replicated column and is stable under reorder; a converged replica link equals its master.
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
- **Expected:** The replica link stays due at 4; B remains due and ensureReplicaFresh reports lag; new and adopted replica links start behind and are excluded from the catalogue.
- **Location:** `supabase/tests/collective_revisions_test.sql`

#### REV-02: Replication cron claims with leases and backs off

- **Layer:** route. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1
- **Scenario:** GET /api/cron/collective-replicate (every 5 minutes) without and with CRON_SECRET; three due replica links, one failing, budget hit mid-run.
- **Expected:** 401 without secret; one `collective_apply_replica` call per replica link with `p_job = 'collective-replicate'`; the failing replica link's attempts and next_attempt_at set; unfinished replica links left due; re-run idempotent.
- **Location:** `src/app/api/cron/collective-replicate/route.test.ts`

#### REV-03: Daily verifier repairs and alerts

- **Layer:** route. **Workstream:** W3 Engine. **Requirements:** R7,R13.
- **Pins:** RT1-4; RT1-1
- **Scenario:** GET /api/cron/collective-verify (daily): the report returns an I3b replica link behind for 16 minutes, an I3 replica link (marked current, fingerprint differs from the expected fingerprint), an I5 replica link after a missed release, and an I15 violation.
- **Expected:** The behind replica link is applied with `p_job = 'collective-verify'` and files only `replica_applied`; the drifted replica link is re-applied and filed as `unexplained_drift_repaired` carrying the before-image, with an alert (ordinary lag is I3b and is never filed that way); the I5 replica link is released; I15 alerts only; a clean report writes nothing.
- **Location:** `src/app/api/cron/collective-verify/route.test.ts`

#### REV-04: Freshness before pricing, per audience

- **Layer:** unit. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R7,R9.
- **Pins:** RT1-1; RT2-18
- **Scenario:** ensureReplicaFresh with the replica link fresh, behind but applied within 1.5 s, behind past budget, next_attempt_at in future; public and staff audiences.
- **Expected:** Fresh proceeds; staff past budget gets 409 COLLECTIVE_SERVICE_UPDATING 'This service is being updated. Please try again in a moment.'; public hides the calendar and create returns SLOT_TAKEN; no anonymous request writes.
- **Location:** `src/lib/linked-accounts/replicas/freshness.test.ts`

#### REV-05: Host saves drain inline and report per venue

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R7,R11.
- **Pins:** RT1-1
- **Scenario:** appointment-services PATCH, addon-groups PATCH, compliance type version, service-categories rename with two members, one failing.
- **Expected:** Additive `collective_sync` in its one shape, `{ venues, applied, pending: [{ venue_id, venue_name }], failed: [{ venue_id, venue_name, message, code }], audit_event_id }`, within 4 s; the `audit_event_id` is what OFF-05's undo sends back; plain prose without em-dashes.
- **Location:** `src/app/api/venue/appointment-services/route.collective-sync.test.ts`

### 3.10 Concurrency

#### CON-01: Host save during an apply and sibling members lose nothing

- **Layer:** engine-invariant. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1
- **Scenario:** Session A applies replica link A paused after_master_read; session B commits a price change; session C applies replica link B concurrently; resume and drain.
- **Expected:** B's dirty bump waits or leaves A behind; final replicas at A and B carry the new price; I3 = 0.
- **Location:** `supabase/concurrency/host_save_during_apply.sql`

#### CON-02: Overlapping crons never apply the same replica link twice

- **Layer:** engine-invariant. **Workstream:** W3 Engine. **Requirements:** R7.
- **Pins:** RT1-1
- **Scenario:** Two claim RPC transactions 100 ms apart over 20 due replica links, each applying what it claimed.
- **Expected:** Disjoint claims; one replica_applied audit per replica link per revision.
- **Location:** `supabase/concurrency/overlapping_claims.sql`

#### CON-03: Lock order: release, offer, join, transfer and apply never deadlock or leak

- **Layer:** engine-invariant. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT1-4; RT1-2
- **Scenario:** Offer paused after membership check while release commits; release versus apply 50 random staggers; transfer versus apply; join versus withdraw.
- **Expected:** No live replica link at the former member; no 40P01; transfer waits or refuses while behind; never an active replica of an archived offering.
- **Location:** `supabase/concurrency/lifecycle_races.sql`

#### CON-04: Assignment and booking races

- **Layer:** engine-invariant. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R5,R9,R10.
- **Pins:** RT1-12; RT1-1; double booking
- **Scenario:** Member diff PUT versus host engine insert on the same row; booking create during an apply; combined page and own page booking the same member calendar slot.
- **Expected:** No 23505 surfaced; the host's row survives in both interleavings; when the member's write lands first both rows exist, and when the engine lands first the member's save answers 412 `STALE_RESOURCE` and nothing is written; booking priced on new terms or 409 COLLECTIVE_SERVICE_UPDATING, never stale after fresh; exactly one slot claim wins.
- **Location:** `supabase/concurrency/assignment_and_booking_races.sql`

### 3.11 Derived catalogue

#### CAT-01: Derived catalogue: assignments are the only truth, with exclusions

- **Layer:** unit. **Workstream:** W4 Catalogue and booking switch. **Requirements:** R1,R5,R10.
- **Pins:** RT1-11; RT2-15; verification finding 1
- **Scenario:** Member ticks and unticks calendars; member suspended; replica link behind 16 min; member B without charges-capable Stripe on deposit service; staff audience. Added 2026-09-14 (D2 revised): a host service that is not on the page, a withdrawn master at the host, and a member-only service at A with calendars ticked, each while live, then with the page paused, A suspended and A released; an offered service with `is_bookable_online = false`; the same column set false at a venue in no collective.
- **Expected:** Providers exist only where CSA exists and appear after the revision bump; suspended, lagging and unconverged excluded; B hidden publicly, shown to staff with 'Card payments are not set up at {venue}, so take payment in person.' Parked services (the host's service not on the page, the withdrawn master, A's member-only service) are listed nowhere, for guests or staff, while live, and are bookable again the moment the page pauses, A is suspended or A is released, with no write to any service row (parking is derived); the staff-only offering is listed in the collective staff form and absent from the public catalogue, public availability and the public create routes; the single venue's staff-only service behaves the same on its own page.
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
- **Scenario:** Host withdraws S2; a guest with a future S2 booking at member A self-reschedules; staff modifies. Added 2026-09-14 (D2 revised): A holds a future booking on a member-only service that is parked once A joins; the guest self-reschedules it, staff modify it within the same service and cancel a second one, and a payment request and a reminder go out; then a new booking on that service is attempted through every public and staff create route and the walk-in flow.
- **Expected:** Both allowed on the retired replica; host sees the affected bookings at other venues without guest names. On the parked service the reschedule, the modify, the cancel, the payment request and the reminder all work exactly as before and the booking stays in reports; every attempt at a new booking is refused.
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
- **Expected:** Accept switches nothing on: the join dialog says forms must be on for form-bearing offerings to be bookable at B, and until B switches them on its calendars are hidden for those offerings with the host warned (D54 applies the same rule at migration); switch-off while live refused with coded 409; existing record satisfies the managed form; B's venue-wide form still asked and host sees 'Also asked at {venue}'.
- **Location:** `src/lib/compliance/enforce-booking.collective.test.ts`

### 3.13 Offerings and host routes

#### OFF-01: Offerings routes: offer, withdraw, member calendars

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R3,R5,R6.
- **Pins:** RT1-17; RT1-11
- **Scenario:** POST offerings as host admin, member admin and in a legacy collective; DELETE offering; PUT calendars add and remove with bookings at another venue.
- **Expected:** Host only (403 member, 409 legacy); replica links created dirty; withdraw retires; affected bookings for other venues carry date, time, calendar, venue, guest_name null and no move action; audit rows carry the actor.
- **Location:** `src/app/api/venue/collectives/[id]/offerings/route.test.ts`

#### OFF-02: Services PATCH and GET for hosts

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R5,R7,R11.
- **Pins:** graft 2; RT2-19
- **Scenario:** PATCH with collective_calendars as host admin and as member admin; stale expected_updated_at; GET as host admin and staff.
- **Expected:** Engine assigns member calendars in one save; member gets 403; stale gets 412 `STALE_RESOURCE`; GET adds collective and top-level collective_calendars (host admin only) and never merges member calendars into practitioner_services.
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

#### OFF-05: Put it back: the 60-second undo restores the before-image and re-applies

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R7,R11.
- **Pins:** D50; T11
- **Scenario:** A host admin saves a price change on S1 that reaches A and B (the save summary carries `collective_sync.audit_event_id`); within 60 seconds `POST /api/venue/collectives/[id]/undo { audit_event_id }` as that host admin; the same call at 61 seconds; the same call as a member admin; the call with an `audit_event_id` whose row is `calendar_assigned`, not `master_changed`; a second undo of an event already undone.
- **Expected:** Inside the window `collective_undo_master_change` restores `changes.before` on the master and its children from `collective_audit_events`, bumps every affected replica link's `desired_revision` like any master write, writes `master_change_undone`, and sends N6 again with the "put back" wording; the response is the same `collective_sync` shape and the summary shows `ov.undo.done`; at 61 seconds 410 `COLLECTIVE_UNDO_EXPIRED` with `ov.undo.expired` and nothing written; the member admin 403; the wrong event type 400; the second undo 410; every path ends with a second apply that writes nothing.
- **Location:** `src/app/api/venue/collectives/[id]/undo/route.test.ts; supabase/tests/collective_undo_test.sql`

#### OFF-06: Add from another venue: host-initiated adoption, the member's answer and the 14-day default

- **Layer:** route. **Workstream:** W5 Host Services page. **Requirements:** R3,R6,R11.
- **Pins:** T28; D2; RT2-20
- **Scenario:** The host picks member A's own service through `POST .../offerings { source_venue_id, source_service_id }`; A answers `POST .../adoptions/[itemId] { choice, option_map }` with "Use mine"; in a second run A answers "Keep mine separate"; in a third run A does not answer, with the clock advanced past day 7 and day 14.
- **Expected:** The offer copies A's service into a new host master (registry host columns only), offers it, and records a pending adoption for A with `adoption_requested` and N26 (`svc.member.adopt.*`). "Use mine" maps A's options to the master's by name and sort order, makes A's own service the replica (`provenance = 'adopted'`) with its calendars, bookings and snapshots kept (PRICE-10), and writes `adoption_answered`. "Keep mine separate" creates a new replica at A and leaves A's own service as A's own, parked while A is live (D2 as revised 2026-09-14), and A is told so. No answer: a reminder at day 7, and at day 14 the default is "Keep mine separate", audited with both actor ids NULL (the system). Every path ends with I8 = 0 and a second apply that writes nothing.
- **Location:** `src/app/api/venue/collectives/[id]/offerings/route.adopt.test.ts; src/app/api/venue/collectives/[id]/adoptions/route.test.ts`

### 3.14 Host interface

#### UI-H-01: Host Services page shows reach and never uses window.confirm

- **Layer:** component. **Workstream:** W5 Host Services page. **Requirements:** R5,R7,R8,R11.
- **Pins:** window.confirm blocked; RT1-17
- **Scenario:** Render AppointmentServicesView and the service page (`/dashboard/appointment-services/[serviceId]`) for a host with two members: banner, Collective pill, the collective strip, CollectiveCalendarsSection, staff flag note, save feedback variants including the 60-second `ov.undo.offer`, take-off, switch-off and blocked delete dialogs, cross-venue removal dialog.
- **Expected:** Copy as designed without em-dashes; dialogs through ConfirmContext; other venues' bookings show no client names; the strip owns the only Retry and it calls replicas/retry; the save summary and the undo render under the page header in a `role="status"` region, never in the error slot.
- **Location:** `src/app/dashboard/appointment-services/AppointmentServicesView.collective-host.test.tsx`

### 3.15 Guards

#### GRD-01: Replica calendar-only and unchanged saves write nothing to the service

- **Layer:** route. **Workstream:** W6 Member locks and UI. **Requirements:** R10,R12.
- **Pins:** RT1-6; RT2-19
- **Scenario:** PATCH a non-canonical replica with a calendar change only, in both shapes the route accepts: the web view's `expected_calendar_ids` with `calendars { add, remove }`, and an older build's full `practitioner_ids` set, diffed against the stored set; the venue-controlled columns alone (`online_meeting_url`, `online_meeting_info`, `capacity_per_session`); replay the app 1.1.0 admin save (deposit_pence 0 against stored null, re-indexed variant and add-on sort_order, parent duration from primary option).
- **Expected:** 200; zero writes to service_items (apart from the venue-controlled columns when they are the only change), service_variants and service_addon_groups; only the caller venue's CSA diff applied; a `capacity_per_session` taken from the master at creation is never overwritten by an apply (D40).
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
- **Expected:** Override uses replica flags; reorder and heading delete allowed (replica links dirty); import attaches read-only and reports ambiguity; no legacy sync or customised detach.
- **Location:** `src/app/api/venue/practitioner-service-overrides/route.replica.test.ts; src/lib/import/run-execute.replicas.test.ts`

### 3.16 Member interface

#### UI-M-01: Member Services and Calendar Availability pages

- **Layer:** component. **Workstream:** W6 Member locks and UI. **Requirements:** R9,R10,R11,R12.
- **Pins:** RT1-11; RT2-10
- **Scenario:** Render for a member: From {host} and "Parked while you are part of {collective}" sections, locked replica card and the values-only `MemberServiceView` (values, not inputs), retired group, setting-up state, a parked card with `ParkedPill` and `reach.member.parked`, Calendar Availability grouping (`cal.card.group.fromHost`, `cal.card.group.parked`) and collective confirmation line; a member setting that the host controls (guest sign-in) with `reach.settings.setByHost`.
- **Expected:** No delete, switch or drag on replicas; no disabled input for a host-managed field (UI-C-03 holds the rule); calendar ticks enabled and saved as diffs; parked cards stay editable and say they cannot be booked; no "Only at" wording and no promise that the team can still book a parked service; copy exact and em-dash free.
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
- **Scenario:** collective_join_member with one adoption whose member options partly match host options by name; one member-only service answered `park`, one `ask` and one left out; a payload carrying the withdrawn `keep` or `pause`.
- **Expected:** Membership active, replica links dirty, adopted service's bookings snapshotted, options mapped, unmapped member options kept for existing bookings only; exclusivity rechecked under lock; `park` and the omitted service write nothing to any service row and nothing to `progress` (parking is derived), `ask` writes `suggestion_made` and queues N28; `keep` and `pause` are refused by the schema.
- **Location:** `supabase/tests/collective_lifecycle_test.sql`

#### LIFE-03: Leaving is lossless and unlocks everything

- **Layer:** pgtap. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT2-9; RT1-15
- **Scenario:** Checksum member services, variants, options, CSA, bookings, guests, payments and compliance records; release member B (no Stripe) holding deposit and card-hold replicas.
- **Expected:** Checksums identical except intended changes; replica links released (`released_at` set, rows kept for a reconnect at re-join), locks lifted, managed objects unmanaged, adoption cleared inside the release transaction, `replica_of_*` and `managed_by_collective_id` cleared with `accepts_records_from_type_id` kept, audit member_released; every released service stays exactly as it is (D52): active ones active, retired ones inactive (DL2), and a member-only service that was parked while live bookable again with no write to it, because parking is derived, and named in the review panel (DL3); B's paid services set to no online payment inside the same transaction with the before values in a `payment_rule_downgraded` row; photo copy queued in collective_operations after commit.
- **Location:** `supabase/tests/collective_lifecycle_test.sql`

#### LIFE-04: Leave, remove and dissolve routes, with notices and photos

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT2-9; RT1-15; RT2-22
- **Scenario:** Member leaves while replica links are behind; host removes a member; host dissolves; photo copy job runs, is retried, and in one run fails its last retry.
- **Expected:** Leave succeeds any time and returns `{ review: { prices, sameName, stripe, library, photos, unparked } }`; notices to live members only with collective_id, and N16, N17 and N19 each say that account links, and the access they give, are unchanged; photo objects copied to the member folder idempotently, the released service keeping the host's photo URL until the copy lands, and after the last retry the photo cleared with `review.photos.failed` naming it; dissolved address serves a neutral page listing the own pages of the venues that chose `configure { list_on_old_page }`, and redirects instead once the same host has reclaimed the address for a re-formed collective.
- **Location:** `src/app/api/venue/collectives/[id]/members/route.leave.test.ts; src/app/book/c/[slug]/dissolved.test.tsx`

#### LIFE-05: Host transfer re-keys mappings and then applies nothing

- **Layer:** pgtap. **Workstream:** W7 Lifecycle. **Requirements:** R2,R4.
- **Pins:** RT1-2; RT2-4
- **Scenario:** Transfer from H to A with member B holding replicas with variants, groups, forms and future variant bookings; attempt while a replica link is behind; attempt by direct host_venue_id update.
- **Expected:** Refused while behind or outside the engine; after transfer I10 = 0, next apply at B and H writes zero variant, group, type and requirement rows; bookings keep active variants; forks set accepts_records_from_type_id.
- **Location:** `supabase/tests/collective_transfer_test.sql`

#### LIFE-06: Transfer is a request with consent; reconcile no longer transfers silently

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R2,R11.
- **Pins:** RT1-2; RT2-23
- **Scenario:** offer_host then accept_host with and without consent_version; old app transfer_host; an account-link cascade removes the host.
- **Expected:** Pending request until accepted with consent, then `pending_host_venue_id` and `host_transfer_at` 14 days out; members notified; the cascade sets `paused_at` on the still-active collective and raises a hosting request instead of transferring (LIFE-13 covers the paused state and the window).
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
- **Scenario:** Host staff books a member calendar with a host contact picked; member staff searches host contacts while the collective is live; the same search from a venue outside the collective, and again after the member has left (LIFE-10 covers the search route itself).
- **Expected:** Collective audit row with acting venue and user, owning venue notified; the picked contact is kept and the booking is written against the host's existing guest record, with `staff.contact.ownerLine` naming the owner and no second guest row at the member; the search succeeds while live; nothing is downgraded at migration or at leave (D41: the sharing belongs to the account links); the collective search scope is refused outside a live collective or after leaving, while per-guest access through the account link carries on.
- **Location:** `src/app/api/venue/bookings/route.collective-authority.test.ts`

#### LIFE-11: Two same-named services after leave both stay active, marked, and are never merged

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** D52; T27; D1's default at join
- **Scenario:** Member A kept its own "Haircut" separate at join (D1) while taking the host's; A leaves; open A's Services page and its `leave` response the same day, at day 29 and at day 31; look for any merge action.
- **Expected:** Both services are active after the release, each with its own calendars, bookings and options, and the released one keeps every value it had (D52); the released one carries `svc.member.card.cameFrom` ("Came from {host}") for 30 days and not on day 31; the `leave` response's `review.sameName` lists the pair with no merge action, and the review panel says a merge is not offered (Tier 3); no route merges, deletes or deactivates either; both are bookable on A's own page.
- **Location:** `src/app/api/venue/collectives/[id]/members/route.leave.test.ts; src/app/dashboard/appointment-services/AppointmentServicesView.collective-member.test.tsx`

#### LIFE-12: Invitations are withdrawn, expire after 30 days, and are closed by dissolve

- **Layer:** route and cron. **Workstream:** W7 Lifecycle. **Requirements:** R2,R11.
- **Pins:** T22; N34; N35
- **Scenario:** The host withdraws an invitation from the Collective area's Venues tab; an invitation is left unanswered for 7 days, then 30 days (clock advanced, the daily cron run each day); the host dissolves with an open invitation; the invitee opens the invitation link after each.
- **Expected:** Withdrawal sets the row to `removed`, writes `invitation_withdrawn` and `history.inviteWithdrawn`, and files N34 without sending an email; the invitation link shows `invite.closed`. Expiry: N1 is re-sent as the reminder at day 7; at day 30 the row is `removed` with `invitation_expired`, `history.inviteExpired` and N35, and the link shows `invite.closed`; the cron writes nothing on a day with no due row. Dissolve sets every open invitation to `removed` inside the `collective_dissolve` transaction. No path creates a second row for the same venue, and a withdrawn or expired venue can be invited again.
- **Location:** `src/app/api/venue/collectives/[id]/members/route.invitations.test.ts; src/app/api/cron/collective-verify/route.invitations.test.ts`

#### LIFE-13: The paused page and the transfer window: leave, take over, cancel, decline, retry, expiry

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R2,R13,R14.
- **Pins:** T22; D12; RT2-23; the transfer write at `src/lib/linked-accounts/collectives.ts:566-570` moves `host_venue_id` silently today
- **Scenario:** The host lapses, or an account-link cascade removes it, so the collective is `active` with `paused_at` set; while paused a member leaves, and another calls `take_over_hosting`; separately `offer_host` to A and `accept_host`, then: the host calls `cancel_host_transfer` before the day; A declines; A leaves while the request is pending; a second `offer_host` to B while A's is pending; on the day one replica link is behind, and it stays behind for 8 days.
- **Expected:** Paused is not a status: `paused_at` on `active`, the page paused, `collective_paused` audited, N23 sent, the host's own page showing its own services again (PUB-01); while paused, leave works as in LIFE-04 and take-over runs `collective_transfer_host` (re-keying as LIFE-05), clears `paused_at`, and audits `host_transferred` and `collective_resumed`; the host may cancel until the day (`host_transfer_cancelled`); the candidate may decline; a candidate that leaves cancels it; the second request is refused with 409 `COLLECTIVE_TRANSFER_PENDING`; on the day a replica link behind makes the move wait (409 `COLLECTIVE_LINKS_BEHIND` on any manual attempt), the daily cron retries for 7 days, and on the eighth day the request is cancelled with N22 saying so; after a successful move every venue gets N22 and `host_transferred` is written once.
- **Location:** `src/app/api/venue/collectives/[id]/members/route.transfer.test.ts; src/app/api/cron/collective-verify/route.transfer.test.ts`

#### LIFE-14: Today's leave, removal and dissolve routes leave every account link untouched

- **Layer:** route. **Workstream:** W7 Lifecycle. **Requirements:** R1,R13.
- **Pins:** D41 as revised 2026-09-14; SB-42 and DL7 withdrawn. The three status writes at `src/app/api/venue/collectives/[id]/members/route.ts:189,256,280` (remove, decline, leave) and the dissolve at `src/app/api/venue/collectives/[id]/route.ts:255-263` touch no `account_links` row today, which is the owner's rule. This test pins that behaviour now, so no later change (the engine's release included) can start ending links. It replaces the withdrawn W7a test, which expected the opposite.
- **Scenario:** On today's legacy model: a member leaves; the host removes a member; the host dissolves; a member declines an invitation. Recorded `recording-supabase` calls for each route.
- **Expected:** No insert, update, upsert or delete on `account_links` or `account_link_audit_log` from any of the four routes; after each, `linked-calendar/guests` and a linked booking create, edit and cancel for the pair still succeed; the departing venue's legacy provider rows take the status today's leave already gives them (`src/lib/linked-accounts/collectives.ts:616-644`); the engine's `collective_release_member` later replaces this code path (LIFE-09) with the same result for account links.
- **Location:** `src/app/api/venue/collectives/[id]/members/route.links-untouched.test.ts; src/app/api/venue/collectives/[id]/route.dissolve-links-untouched.test.ts`

### 3.18 Migration of existing collectives

The migration follows D54, decided 2026-09-14: the host's values apply to every service on the collective at the point of migration, every existing booking is protected, and nothing is sent to or shown to members (the owner tells the venues in person). Before-images are recorded for rollback (D30) and the dry-run report is signed (D21). "Copy" in this section means the legacy `linked` or `customised` service copy, which is what these tests migrate.

#### MIG-01: Dry run tells the whole truth

- **Layer:** migration. **Workstream:** W9 Migration. **Requirements:** R6,R11.
- **Pins:** RT1-3; RT1-11; D21
- **Scenario:** Legacy-shape fixture: drifted copies, needs_master, ambiguous_master, member service on two offerings, archived same-slug form, copy variants with bookings, missing CSA rows.
- **Expected:** Report lists each with counts and column-level before and after; P1 to P5 populated; for the host, every offering whose page copy (name, description, photo, heading, order) differs from its master, stating that the master's wording applies from the switch (D54); for each member, per copy and column the value now and after, marked kept as your calendar's value, changed by {host} or unchanged, the calendars that leave the page and why, each member-only service with the owner's `choice` (`add_to_page` or `park`, D2 as revised 2026-09-14), whether compliance records would be needed and that the migration will not switch them on, and the switch date; any member pair whose account link has fallen below full access, reported only, with no account link classified or written (D41); nothing written (row checksums unchanged).
- **Location:** `supabase/tests/collective_migration_test.sql; scripts/collective-replicas-migrate.test.mjs`

#### MIG-02: Apply converges per replica link, resumably, without changing any total

- **Layer:** migration. **Workstream:** W9 Migration. **Requirements:** R3,R6,R9.
- **Pins:** RT1-11; RT1-8; H-MAXROWS
- **Scenario:** Apply with --approved-report hash on the fixture and on 50 by 10 scale; kill the script mid-run and restart; more than 1,000 rows to page.
- **Expected:** Variants mapped by name and sort order before the first apply; snapshots before applies; per-replica-link RPCs with progress in collective_operations; replica links created with `provenance = 'migrated'`; restart resumes; invariants 0; every payment total identical before and after.
- **Location:** `scripts/collective-replicas-migrate.test.mjs`

#### MIG-03: Rollback restores the legacy page and can be re-applied

- **Layer:** migration. **Workstream:** W9 Migration. **Requirements:** R13,R14.
- **Pins:** RT1 rollback assumption
- **Scenario:** After apply, run --rollback, compare the legacy combined page to the pre-migration snapshot, then apply again.
- **Expected:** Rollback restores what the migration recorded, not what the database holds now: the provider snapshot, the three sync columns, add-on links, option states and compliance type states exactly; before-images applied only where the member has not edited the value since (`updated_at` unchanged) and refused with a per-service prompt otherwise; per-calendar values written at the switch left in place, since they were the member's; providers rebuilt from CSA, I4 = 0, page equal to snapshot; compliance types archived not deleted; residue exported to `collective_audit_events` before any archive; bookings and their snapshots untouched; re-apply converges.
- **Location:** `scripts/collective-replicas-migrate.test.mjs`

#### MIG-04: Staging rehearsal then plus-1 migration

- **Layer:** live-staging. **Workstream:** W9 Migration. **Requirements:** R1,R3,R6,R9.
- **Pins:** H-RESIDUE; RT1-3; RT2-6
- **Scenario:** Scratch legacy collective on e2e-coll fixtures copying plus-1's shape: dry run, apply, rollback, re-apply; then plus-1 with owner review and the dedicated [coll-test] price check.
- **Expected:** All gates in the rollout section pass; Light 3's form decision applied; public catalogue diff shows only intended changes.
- **Location:** `scripts/collective-replicas-migrate.mjs (staging run log in release notes)`

#### MIG-05: Existing bookings are protected through apply and rollback

- **Layer:** migration. **Workstream:** W9 Migration. **Requirements:** R8,R9,R11,R13.
- **Pins:** D54; D7; D30; RT2-17; D21 (Light 3's Haircut at 10.00)
- **Scenario:** Legacy-shape fixture with past and future bookings on the host's masters and on a member's copies, including a copy whose price and length differ from the master's (Light 3's Haircut at 10.00 against the host's 25.00), a booking on a copy option that has no master option, a booking with a deposit taken, and one with a manage link issued; dry run, apply, drain, then rollback, then apply again; price each booking through the resolver, open each manage link, and hash every booking row before and after each step.
- **Expected:** Every booking row is byte-identical before and after apply, rollback and re-apply except a NULL `service_price_snapshot_pence` filled in by the safety re-run, which reports 0 rows on a clean Pass A; the 10.00 booking still prices at 10.00 and its confirmation, reminder and manage page still show 10.00 while a new booking on the same calendar prices at 25.00; the option booking keeps its option, which is kept inactive and mapped to nothing (P4); the deposit and the manage link still resolve; `sum(coalesce(booking_total_price_pence, 0))` is unchanged at every step; no booking is deleted, moved or re-pointed.
- **Location:** `supabase/tests/collective_migration_test.sql; scripts/collective-replicas-migrate.test.mjs`

#### MIG-06: The host's values apply at the switch, the before-image is recorded, nothing is sent or shown

- **Layer:** migration. **Workstream:** W9 Migration. **Requirements:** R5,R11,R13,R14.
- **Pins:** D54 (which replaced the earlier non-destructive package); D30; D2 (revised 2026-09-14)
- **Scenario:** Legacy-shape fixture where a member's copy differs from the master in price, length, payment rule, location, a staff flag, heading, name, description, an add-on link and a form, where the member holds a stored per-calendar price on one calendar, two member-only services (one with a future booking) signed with `choice: 'add_to_page'` and `choice: 'park'`, and a compliance flag that is off; dry run, apply, drain; then rollback after the member has edited one restored value.
- **Expected:** After the drain every replica's fingerprint equals its master's and every replicated column carries the host's value (name, description, price, length, buffer, deposit, payment rule, location, flags, booking window, add-on links, forms, heading); the copy's previous row, option rows, add-on links, requirement rows, sync columns and provider rows are in exactly one `migration_applied` row per member (`changes.before`), and no `migration_value_replaced` row exists; the stored per-calendar price is untouched and applies only while the master's price permission is on; the `park` service is unchanged, still `is_active` and parked from the switch; the `add_to_page` service has a new host master copied from it, is that master's replica (`provenance = 'adopted'`) with every column, calendar and booking unchanged and its booking snapshotted, and is on the page; the compliance flag is still off and the form-bearing offering's calendars at that member are hidden (D10); no notice of any kind is queued (N29, N30 and N33 are not sent) and no panel renders on the member's Services page, which shows the services as locked replicas with one `history.migrationApplied` line; the dry run listed every replaced column before and after. Rollback restores every recorded value where `updated_at` still matches and lists, without restoring, the one the member edited.
- **Location:** `supabase/tests/collective_migration_test.sql; scripts/collective-replicas-migrate.test.mjs; src/app/dashboard/appointment-services/MemberServiceView.test.tsx`

### 3.19 Public pages

#### PUB-01: Own pages, the host's included, hand over only when the venue is really bookable there

- **Layer:** unit. **Workstream:** W10 Booking pages and links. **Requirements:** R9,R11,R14.
- **Pins:** RT2-3; RT1-11; D3; T16
- **Scenario:** Redirect decision for a member: page live and member listed; no offerings; booking paused; host lapsed; member hidden for Stripe or lag; replica links unconverged; after leave. For the host: page live with at least one host calendar listed; page live with no host calendar listed; the host lapsed, so the page is paused; after dissolve.
- **Expected:** A member's `/book/{slug}`, `/book/{slug}/{calendar}` and `/embed/{slug}` hand over only in the first case; the host's hand over while the page is live and at least one host calendar is listed, with no convergence condition because the host has no replicas; a lapsed host's page shows its own services again while the page is paused; otherwise the own page with a reason; the Booking Page tab shows `bp.status.redirecting` "Guests who visit your own booking page are sent to the {collective} page." or `bp.status.showing` "Your own page is showing because {reason}."; the decision is derived from state and reads no `solo_page_behavior`.
- **Location:** `src/lib/linked-accounts/replicas/redirect-decision.test.ts`

#### PUB-02: Redirects keep the guest's place; links to parked services do not dead-end

- **Layer:** route. **Workstream:** W10 Booking pages and links. **Requirements:** R9,R14.
- **Pins:** RT2-22; RT2-10
- **Scenario:** /book/{member}?service_id={replica}&start=... ; /book/{venue}/{calendar}; /embed/{venue}; a parked service_id at a member and at the host; a service_id for an offering with `is_bookable_online = false`; email and portal Book again for a booking on a parked service; waitlist offer links.
- **Expected:** 307 with offering id, calendar id, date and start kept; unknown ids fall back to the service list; a parked or staff-only service_id lands on the collective page's service list, and so does Book again for a parked service (the phone-number interstitial and the call-us action were withdrawn on 2026-09-14, D2).
- **Location:** `src/app/book/[venue-slug]/page.redirect.test.ts; src/lib/emails/venue-booking-page-link.replicas.test.ts`

#### PUB-03: Guests see who they are booking with

- **Layer:** component. **Workstream:** W10 Booking pages and links. **Requirements:** R1,R9.
- **Pins:** RT2-14
- **Scenario:** Combined page on a member calendar: calendar step, payment step, confirmation; marketing consent control.
- **Expected:** 'You are booking with {member business name}, {member address}' on all three; consent unticked and names the member (per legal decision).
- **Location:** `src/components/booking/DetailsStep.collective-identity.test.tsx`

#### PUB-05: A member with another booking model keeps its own page for those tabs

- **Layer:** route. **Workstream:** W10 Booking pages and links. **Requirements:** R9,R11,R14.
- **Pins:** T17; D3; SB-35; BM-03
- **Scenario:** A member that also runs classes and bookable rooms, live and listed: GET `/book/{slug}`, its classes and resources tabs, the appointments tab, `/book/{slug}/{calendar}` and `/book/{slug}?service={replica}`; the same member after leaving.
- **Expected:** The own page keeps serving the classes and resources tabs through `resolveBookingPageTabs` (`src/components/booking/BookPublicPageContent.tsx:258`); the appointments tab is replaced by a card that links to the collective page; the appointment deep links redirect with the guest's place kept (PUB-02); `{link}` in `bm.redirect.otherModels` is the venue's own page address, `/book/{slug}`; after leaving every tab is the venue's own again.
- **Location:** `src/app/book/[venue-slug]/page.other-models.test.ts; src/components/booking/BookPublicPageContent.collective.test.tsx`

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
- **Pins:** RT2-25; D32 (decided 2026-09-14)
- **Scenario:** Sweep APPOINTMENTS_FEATURE_FLAG_KEYS, `venues.require_account_login_for_bookings`, communication policies (`venues.communication_policies`), `venues.in_person_payments_enabled`, deposit config, booking rules; a member whose sign-in, self-reschedule and waitlist settings differ from the host's, before, during and after membership; a member whose communication policies differ; render the host panel and the member's settings.
- **Expected:** Every setting has exactly one class, and an unclassified key fails. Host controls: `require_account_login_for_bookings` (the collective page asks for sign-in only when the host requires it, never because a member does, replacing the OR), `guest_self_reschedule`, `waitlist_v2` (whether the page offers it; entries and offers stay with the calendar's venue), `any_available_practitioner` and `staff_first_booking_flow`; while live the host's value governs every venue's bookings, the member sees its own read-only with `reach.settings.setByHost`, nothing is written to the member's row, and its own value applies again after it leaves. Each venue: `communication_policies`, `in_person_payments_enabled`, `compliance_records_enabled` and `class_commerce_enabled`, with `reach.settings.differentAt` shown to the host where a venue differs. `deposit_config` and `booking_rules` are classed as table-reservation settings with nothing to decide for appointments. No setting is classed "must match at accept".
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
- **Expected:** 412 `STALE_RESOURCE` on the stale set; stored and gated; 409 COLLECTIVE_MANAGED_ADDON_GROUP; 409 COLLECTIVE_MANAGED_COMPLIANCE_TYPE; 409 COLLECTIVE_CONSENT_REQUIRED; leave 200 with unchanged shape.
- **Location:** `src/app/api/__app-contract__/membership-and-toggles.contract.test.ts`

#### APP-03: Additive reads and diary routing for old builds

- **Layer:** app-contract. **Workstream:** W12 Mobile contract. **Requirements:** R9,R11.
- **Pins:** RT2-19 (graft 5, revised 2026-09-14); verification finding 14
- **Scenario:** GET appointment-services, collectives and catalogue; GET staff-collective for a member; run the app's collectiveBookingTargetFor logic on the response.
- **Expected:** Only additive fields; sync.state none so no badge; calendar_ids includes the caller venue's own calendars, so every column, own ones included, opens the collective form (the earlier own-form routing is withdrawn, D2); no `X-ResNeo-Client` header required (a missing header is permitted permanently; a master edit without it sends the host N27); new codes registered in API_ERROR_CODES.
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
- **Expected:** RPCs 404 or 42501; engine tables unreadable; replica update and master delete refused with the dedicated SQLSTATEs; second claim excludes leased replica links; paginated reads return all rows beyond 1,000.
- **Location:** `scripts/db-contract/postgrest-contract.mjs`

#### SEC-02: No guest PII in audit rows, notices, the history route or anonymous reads

- **Layer:** security. **Workstream:** W15 Grants. **Requirements:** R12.
- **Pins:** RT1-17; RT2-12; D41 (client details do cross venues while the collective is live, through LIFE-10's search, by design; this test covers the surfaces that must never carry them)
- **Scenario:** History route as member A, as an outsider and as a former member; audit changes jsonb; anon read of CSA custom_name, custom_description, custom_deposit_pence; host removal dialog payload; notices.
- **Expected:** Member sees own-venue and collective-wide rows only; outsider 403, and a former member 403 from the moment its row leaves `active`; no guest PII in audit rows, in notices or in the history route's CSV; anon CSA columns narrowed or explicitly accepted by the owner; live check:table-grants passes on both environments.
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
- **Scenario:** Local: 1,000 service_items updates at a venue outside collectives with triggers on and off; one apply of S2; verifier over 1,000 replica links; cron drain of 200 replica links. Staging: host save with inline drain for 1 and 10 members.
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
- **Expected:** New price on page and at member within the drain; the member view shows values, not inputs, with the managed banner; calendar changes visible immediately; earlier booking keeps its agreed price.
- **Location:** `e2e/collective-host-member.spec.ts`

#### E2E-03: Leave and dissolve journeys

- **Layer:** e2e. **Workstream:** W7 Lifecycle. **Requirements:** R13,R14.
- **Pins:** RT2-3; RT2-9; RT2-22
- **Scenario:** Member A leaves; open its own page with a pre-join deep link; edit a former replica; host dissolves a run-scoped collective; open the old collective address.
- **Expected:** Own page bookable with the deep link resolved; service editable; bookings intact; dissolved address shows each venue's own page.
- **Location:** `e2e/collective-lifecycle.spec.ts`

#### E2E-04: Staff diary, cross-venue groups and the 375px layout

- **Layer:** e2e. **Workstream:** W7 Lifecycle. **Requirements:** R1,R9,R11.
- **Pins:** RT2-11; RT2-13; graft 5 (revised 2026-09-14, D2)
- **Scenario:** Member staff clicks an own column, a partner column, New and Walk-in, and opens an existing booking on a parked member-only service; host staff picks a host client then a member calendar; group of two across venues; mobile project renders the member Services page.
- **Expected:** Every door opens the collective form, which lists the collective's offerings (a staff-only offering included) and no parked service; the existing booking on the parked service opens with `staff.detail.parked` and can be moved within the same service; the host client is booked on the member calendar against the host's record, with `staff.contact.ownerLine` on the picked contact and no second guest row; the cross-venue group is refused with the explanation before the details step (BM-06, D28); no sideways scroll at 375px.
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
- **Scenario:** Owner walks the acceptance checklist on staging after Pass B. Counsel's review of the consent text, price control, trader identity and data roles is complete (D9, 2026-09-14), so the checklist confirms the built text matches what was reviewed.
- **Expected:** Every box ticked and signed with date; consent version recorded; any failed box blocks production Pass B.
- **Location:** `Docs/release-notes/collective-replicas.md`

#### MAN-02: Help centre, docs and app handover

- **Layer:** manual. **Workstream:** W13 Help and docs. **Requirements:** R11.
- **Pins:** Copy drift; CLAUDE.md copy rules
- **Scenario:** Rewrite the articles plan §6.12 lists: `getting-started/linked-venues`, both services articles (`getting-started/services`, `appointments/services`), `appointments/calendar-setup`, `appointments/booking-widget`, `getting-started/public-booking-page`, `appointments/deposits`, both import articles (`getting-started/importing-data`, `appointments/data-import`), `resneo-app/availability-in-the-app` and `resneo-app/venue-settings-in-the-app`, `getting-started/what-your-clients-see`, `getting-started/compliance`, `troubleshooting/availability-issues` and `getting-started/staff-first-booking`; add the article on running services as one collective and the two the 2026-09-14 decisions require (D41 in the member's own words: a collective is built on your account links, the client and booking access those links give is theirs rather than the collective's, the records stay with the venue that owns them, and leaving or ending the collective changes the booking page, not the links; D42: why the same person booking at two venues becomes two client records, and what a member sees); redraw the eleven figures; run npm run help:label-audit; update assistant golden 21 and the role-dependent goldens (3, 5, 6, 29, 31, 32 and 39), Docs/MOBILE_API.md and the app handover note.
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
- **Layer:** route. **Workstream:** W18 Operations. **Risk:** none named before; the engine flag's audit gap in plan §6.4.
- **Pins:** A repair that hides its own cause. The house precedent (`schedule-health`) is read-only on purpose.
- **Scenario:** Seed one replica link behind (I3b) and one outside an active membership (I5), plus one whose fingerprint differs with `applied_revision = desired_revision` and no audit row (the raw-SQL write shape, which is I3). Run the verifier.
- **Expected:** The behind replica link applied and filed as `replica_applied`, the I5 replica link released, both audited; the third is **not** silently re-applied but written as `unexplained_drift_repaired` carrying the before-image, and alerted (REV-03 expects the same). Every other non-zero invariant alerts without repairing.
- **Location:** `supabase/migrations/<engine>.sql; src/app/api/cron/collective-verify/route.ts`

#### OPS-03 Platform collective panel
- **Layer:** route. **Workstream:** W18 Operations. **Risk:** none named before; the support-session attribution gap in plan §6.3.
- **Scenario:** Call the panel as anon, as a venue admin, and as a superuser. Use Retry. Read the audit.
- **Expected:** Refused except for superusers; read-only apart from Retry; the retry writes a platform audit event and a `collective_audit_events` row carrying `support_session_id` and `actor_is_platform_superuser`; no guest contact details in any response.
- **Location:** `src/app/api/platform/collectives/route.ts; src/lib/platform/audit.ts`

#### OPS-04 Cron registration is complete in both directions
- **Layer:** unit. **Workstream:** WT Test harness.
- **Scenario:** Read `vercel.json` and `src/app/api/cron/`; compare the two sets, which after this project include `collective-replicate` (every 5 minutes) and `collective-verify` (daily).
- **Expected:** Equal. Worth having regardless of this project: the two agree only by hand today (25 and 25 at the time of writing).
- **Location:** `vercel.json; src/app/api/cron/`

#### MV-01, MV-02 People who work at more than one venue
- **Layer:** unit (MV-01), route (MV-02). **Workstream:** W16. **Requirements:** R9. **Split-brain:** SB-28; **bug:** PB-16. **Decision:** D38.
- **Pins:** Today a second staff row makes `resolveUniqueStaffRow` return null, `getDashboardStaff` return no venue, and the layout redirect the person into `/signup/business-type`. They are locked out of both dashboards with no message. D38 chose to refuse the invite rather than build a venue chooser, so these two tests cover the refusal and the explanation, and nothing tests a switcher.
- **Scenarios:** MV-01 signs in as a person holding staff rows at two venues. MV-02 invites an email that already works elsewhere.
- **Expected:** MV-01 a page explaining that this account is linked to more than one venue and who to contact, never the signup flow and never a blank redirect. MV-02 refused with `staff.invite.otherVenue`, no row created, so the lockout cannot be created in the first place.
- **Location:** `src/lib/venue-auth.ts; src/app/dashboard/layout.tsx; src/app/api/venue/staff/invite/route.ts`

#### LIFE-09 The collective ends, the account links do not
- **Layer:** pgtap. **Workstream:** W7. **Requirements:** R1, R13. **Split-brain:** SB-42 (withdrawn). **Decision:** D41, revised 2026-09-14.
- **Pins:** The owner's rule: a collective is extra functionality on top of full-access account links, and ending or leaving it changes only the collective. A venue that leaves keeps full access to make, edit and cancel bookings for the venues it is linked with.
- **Scenario:** Build a live collective of three venues with guests and bookings at each. Leave as one member, remove another, then dissolve. Before and after each, snapshot every `account_links` row between the venues and attempt every cross-venue action: the collective contact search scope, a guest record reached through a shared booking, booking detail, create, edit and cancel at the other venue, compliance records, linked revenue.
- **Expected:** Every `account_links` row is byte-identical before and after each step. The collective's own features stop from the moment the membership ends, in the same transaction: the collective page no longer lists the venue, the collective staff form and the `scope=collective` contact search refuse, and the collective report view goes. Everything the account link grants on its own still works exactly as before: create, edit and cancel at the linked venue, the partner diary, per-guest access through a shared booking and linked revenue within the link's grant. Every record each venue owns is untouched. A release audit row on both sides; no link choice is offered (DL12).
- **Location:** `supabase/tests/collective_release_test.sql; src/app/api/venue/collectives/[id]/members/route.ts`

#### LIFE-10 Contact search across the collective
- **Layer:** route. **Workstream:** W7. **Requirements:** R1, R9. **Decision:** D41.
- **Pins:** `/api/venue/guests` is scoped to `staff.venue_id` on every query (`route.ts:150,237,285,317`), so there is no cross-venue search today and the owner's "seamlessly" requirement is unmet.
- **Scenario:** As a member's staff, search Contacts for a guest who has only booked at another member. Repeat for a venue outside the collective, and again after leaving.
- **Expected:** Found while live, with the owning venue named on the row and on the record. Refused for any venue outside the live collective. Refused after leaving. Editing writes against the owning venue and is audited there; no second guest row is created at the searching venue.
- **Location:** `src/app/api/venue/guests/route.ts; src/lib/guests/linked-guest-access.ts`

#### REP-01 to REP-05 Reporting and attribution
- **Layer:** unit (REP-01, REP-04), route (REP-02, REP-03, REP-05). **Workstream:** W17, and W1 for REP-04. **Split-brain:** SB-30, SB-31. **Decision:** D49.
- **Pins:** `bookings.collective_id` is written by three create paths and read by nothing; Booked revenue already blends every member's takings in both directions with no subtotal; `buildPriceSummary` disagrees with `loadRowTotalResolver` today.
- **Scenarios:** REP-01 sweeps every report, filter and export for a collective read. REP-02 loads Booked revenue for a host and asserts the per-venue breakdown. REP-03 loads it as a member and checks the consent record. REP-04 compares the two price paths on a booking whose service price later changed. REP-05 narrows an account link and reloads.
- **Expected:** REP-01 collective bookings are identifiable everywhere money is counted, and `collective_id` distinguishes a collective-page booking from the venue's own (`source` keeps its values, D55). REP-02 one row per venue, named, plus a total. REP-03 the member sees every venue's figures, because D49 chose mutual visibility, but each is named and subtotalled and the join dialog recorded the agreement: an unlabelled blended total is a fail even though the access is intended. Guest contact details never cross a venue boundary in a figures view. REP-04 both read the snapshot and agree. REP-05 the column does not silently vanish while membership continues.
- **Location:** `src/lib/reports/booked-revenue.ts; src/lib/booking/payment-display.ts; src/app/api/venue/export/route.ts`

#### REP-06 Reports after the end
- **Layer:** route. **Workstream:** W17 Reporting. **Requirements:** R1, R13. **Decisions:** D41, D49.
- **Pins:** D49 gives every live member every venue's figures in a collective view; nothing said what a former member sees. Under D41 the account links, and their revenue grants, carry on after the collective.
- **Scenario:** Load Booked revenue, the bookings list, the export and the filters as a member that has left, as a removed member, and as any venue after dissolve; use the "via {collective}" filter in each.
- **Expected:** The collective view is gone and there is no frozen snapshot of it; the "via {collective}" filter is kept for the venue's own bookings so its own history stays readable, and the collective's name still labels those rows; other venues' figures appear only as the venue's account links grant them, exactly as for any linked venues (the fixture's narrower revenue grant shows the difference); a live member on the same data still sees every venue named and subtotalled (REP-03).
- **Location:** `src/lib/reports/booked-revenue.ts; src/app/api/venue/export/route.ts`

#### BM-01 to BM-06 Booking models and the appointments-only boundary
- **Layer:** route (BM-01, BM-02, BM-04, BM-06), unit (BM-03, BM-05). **Workstream:** W20, and W7 for BM-04 (the currency gate and the booking-model lock live in W7 with TERMS-15; W20 keeps BM-02's lock test as its reference). **Split-brain:** SB-35, SB-36. **Decisions:** D44 (the discriminator is `collective_service_items.entity_type`, never a provider row), D45.
- **Pins:** The synthetic venue declares one booking model, so a member's classes, events and bookable rooms leave the web when its page redirects, and nothing says so. Currency is gated nowhere.
- **Scenarios:** BM-01 invites a class-only venue. BM-02 removes `unified_scheduling` from a member in a live collective. BM-03 follows a redirect for a member that also runs classes. BM-04 invites a venue trading in another currency. BM-05 asserts the product's own words about shared resources. BM-06 books a multi-service visit whose segments live at two venues.
- **Expected:** BM-01 and BM-04 refused with plain reasons. BM-02 coded 409. BM-03 the member's other models keep a route through (`{link}` in `bm.redirect.otherModels` is `/book/{slug}`; PUB-05 proves the page itself), and the member was warned before accepting. BM-05 the product states shared resources are unsupported rather than implying they work. BM-06 refused with the explanation shown before the details step, as D28 already does for groups.
- **Location:** `src/lib/linked-accounts/collective-venue.ts; src/lib/linked-accounts/eligibility.ts; src/app/api/venue/route.ts; src/app/book/[venue-slug]/page.tsx`

#### PLAN-01 to PLAN-03 Plan tiers, eligibility and caps
- **Layer:** unit (PLAN-01, PLAN-03), route (PLAN-02). **Workstream:** W7, and W5 for PLAN-03. **Decision:** D39. **Bug:** CB-31.
- **Scenarios:** PLAN-01 evaluates eligibility for a trial, a cancellation window, a comped venue, a failed payment and an expired plan. PLAN-02 invites and accepts an ineligible venue. PLAN-03 assigns calendars at a member that is at its cap (Light 1, Plus 5).
- **Expected:** PLAN-01 matches `evaluateLinkEligibility` exactly. PLAN-02 refused, with the reason shown. PLAN-03 the cap is visible to both host and member, and a host assigning calendars cannot push a member past it.
- **Location:** `src/lib/linked-accounts/eligibility.ts; src/lib/plan-limits.ts; src/lib/light-plan.ts`

#### SEO-01, SEO-02, WAIT-01, FAIR-01, DIARY-01 The public page and the diary
- **Layer:** unit, except WAIT-01 and DIARY-01 (route). **Workstream:** W19, and W21 for DIARY-01. **Split-brain:** SB-33, SB-37, SB-39, SB-40. **Bug:** PB-17. **Decisions:** D43, D48.
- **Scenarios:** SEO-01 renders every `/book` route and reads its metadata. SEO-02 renders an adopted address and the collective address, and a host's request to adopt a member's address before and after that member's admin agrees. WAIT-01 opens the waitlist form on a collective page. FAIR-01 runs "any available" many times across venues. DIARY-01 loads a partner column on a day the partner venue is closed.
- **Expected:** SEO-01 every route has its own title and description, and `/book/c/{slug}` also has a canonical, an Open Graph image and a robots directive. SEO-02 one canonical, not two copies; an unconfirmed request changes no address and sends N38 to the member's admins, and only the admin's agreement writes `adopted_venue_id` and `address_adopted` (decided 2026-09-14). WAIT-01 the form renders and the route accepts it. FAIR-01 the configured order applies and the host does not take every contested slot. DIARY-01 the column shows the member closed.
- **Location:** `src/app/book/**; src/lib/linked-accounts/collective-venue.ts; src/app/api/booking/availability/route.ts; src/app/api/venue/linked-calendar/route.ts`

#### DIARY-02 Two calendars that look like one person warn whoever books second
- **Layer:** route. **Workstream:** W21 Diary truth. **Requirements:** R9, R11. **Decision:** D47.
- **Pins:** People are not modelled above the venue, and D47 chose to warn rather than model. The warning must reach the second booker on both staff surfaces and must never merge, link or write anything.
- **Scenario:** Calendars A1 and B1 in a live collective share a normalised name and email; A1 has a booking at 10:00; book B1 at 10:00 through the staff booking form and through the collective page's staff-side flow; repeat with the same name but a different email; repeat for two calendars at one venue; repeat after the collective has ended.
- **Expected:** The second booking shows `clash.samePerson` ("{calendar} at {venue} looks like the same person as {otherCalendar} at {otherVenue}, who already has a booking at this time.") and can still be made; no warning when the emails differ, when both calendars are at one venue, or once the collective has ended; nothing is modelled: the check writes no row, column or link, and the warning carries no guest name.
- **Location:** `src/app/api/venue/bookings/route.clash.test.ts; src/lib/linked-accounts/same-person.test.ts`

#### DIARY-03 A booking moves to another venue's calendar when nothing is attached
- **Layer:** component, route and pgTAP. **Workstream:** W21 Diary truth. **Requirements:** R9, R11. **Decision:** D46 (revised by the owner 2026-09-16).
- **Pins:** A move to another venue used to offer rebook-then-cancel, which sent a cancellation and a new confirmation and dropped any deposit or card hold.
- **Scenario:** Drag a plain booking at the host onto a member calendar; drag one with a deposit, a payment, completed forms, or in a visit; drop on a calendar that does not offer the service; the modify form's calendar list.
- **Expected:** The dialog asks `move.otherVenue.title` and moves on confirm: one new booking at the member on its service, option, add-ons and client record, same length and price, the original cancelled by staff with no message, `booking_moved_out` and `booking_moved_in` on the two venues' logs, one change message to the client from the member with `move.guest.changed`; the other cases are refused with `move.refused.*` and nothing written; no rebook-then-cancel path anywhere; the modify form still lists only the booking's own venue's calendars.
- **Location:** `src/app/dashboard/practitioner-calendar/CollectiveVenueMoveDialog.test.tsx; src/lib/linked-accounts/move-booking.test.ts; supabase/tests/collective_move_booking_test.sql; src/components/booking/StaffAppointmentModifyForm.collective-move.test.tsx`

#### HLP-01 Help copy cannot regress
- **Layer:** unit. **Workstream:** W13.
- **Pins:** Nothing stops an em-dash reaching a help article today; the existing copy tests cover booking copy and the assistant's answers only. This project rewrites twenty-odd articles under a rule that forbids them.
- **Expected:** No article contains U+2014, and no rewritten article still describes sync, Link, Unlink, Re-sync, "in step", "customised", or prices and durations coming from the member venue.
- **Location:** `src/lib/help/articles/**`

#### TERMS-16, CSA-04 to CSA-08, DB-10, SEC-03 to SEC-05
- **TERMS-16** (unit, W1): the month loader both bakes a per-calendar length into the service and carries it on the link, which is the double-application the day loader fixed and documented at `appointment-engine.ts:1710-1721`. Expect one application. **Location:** `src/lib/availability/appointment-month-availability.ts:805-818`
- **CSA-04** (pgtap, W3): deleting a calendar that held a live replica's assignment writes a `collective_audit_events` row and bumps the catalogue revision, and invariant I33 returns 0 afterwards.
- **CSA-05** (route and pgtap, W5): the cross-venue writer refuses everything it must. `collective_set_calendar_offering` called as a member admin; as the host for a calendar at a venue that has left; at a venue in a different collective; for a calendar not at the named venue; for an inactive calendar; for an offering whose replica at that venue does not exist; in a legacy-mode collective; and as the host for a valid calendar, add then remove, with an upcoming booking at the member. Expect `COLLECTIVE_NOT_HOST`, `COLLECTIVE_VENUE_NOT_MEMBER`, `COLLECTIVE_CALENDAR_NOT_AT_VENUE`, `COLLECTIVE_REPLICA_NOT_READY` and the legacy 409 with no row written; the valid add upserts the (calendar, replica) row with the host's venue and user in `updated_by_*`, an audit row with before-image, a revision bump and N11; the removal answers the affected-bookings 409 built with the member's venue id and replica id, `guest_name` null, no move action; I13 as a constraint refuses a direct insert pairing a calendar with another venue's service. **Location:** `supabase/tests/collective_set_calendar_offering_test.sql; src/app/api/venue/appointment-services/route.host.test.ts`
- **CSA-06** (route, W5 and W11): one function behind three host surfaces. The same member calendar added through `PATCH appointment-services collective_calendars`, through the offerings PUT and through the catalogue `set_providers` shim; a bulk change with one failing cell. Expect an identical row, audit and notice from all three; the shim returns a per-operation envelope and the failing cell alone is reported (CB-44, CB-45); a registry test lists every caller of `collective_set_calendar_offering` and fails on any other writer of another venue's assignment rows. **Location:** `src/app/api/venue/collectives/[id]/catalogue/route.shims.test.ts; src/lib/linked-accounts/assignment-writers.registry.test.ts`
- **CSA-07** (component and route, W5 and W6): "Last changed by" is true on both sides (D15). Host adds M1; member renames M1 and saves; member unticks and re-ticks M1; host removes M1; 31 days pass. Expect that after the rename the row still names the host and keeps its id; after the re-tick it names the member and the host gets N12; the host's `CollectiveCalendarsSection` row, the member's Edit calendar dialog and the member's service view all show `svc.cal.lastChanged` with the same venue and date; the line disappears after 30 days; no `updated_by_user_id` reaches any client payload. **Location:** `src/app/dashboard/availability/AppointmentAvailabilitySettings.collective.test.tsx; src/components/linked-accounts/collective/CollectiveCalendarsSection.test.tsx`
- **CSA-08** (component and route, W8): per-calendar values from the calendar page. An admin opens Edit calendar, ticks a service, saves, reopens and uses "Edit values"; the same for an unsaved tick; a member admin on a replica whose master has price on and length off. Expect the link only for saved ticks on services with a permission on; the dialog opens pre-selected to this calendar and service; the unsaved tick shows no link; the member sees a price input and no length input; the save lands on the existing row without changing its id; the card's Services list shows the chip. **Location:** `src/app/dashboard/availability/AppointmentAvailabilitySettings.values.test.tsx; src/app/api/venue/practitioner-service-overrides/route.admin.test.ts`
- **DB-10** (pgtap, W3): every classified column's registry entry matches what an apply actually writes. DB-07 proves a column is classified; this proves the classification is true of the engine's behaviour, which is the claim that matters. Enumerate from `pg_attribute` and never seed the count (the migration set yields 45 columns for `service_items` today; the database the test runs against is what it enumerates).
- **SEC-03** (route, W4): a pre-booking form files at the venue that will hold the booking. On "any available", complete an inline form and then let the booking land on a calendar at a different venue. Expect the record at the booking's own venue, not at whichever venue happened to be first in the merge. Not a privacy test: the merged answer is deliberately less precise than each member's own page already is, and the single-venue exposure is an accepted platform decision (see plan §6.6, "What this is not").
- **SEC-04** (pgtap, W3): drift the engine cannot explain is kept, not tidied away. Change a replica by hand behind the engine flag, the way an engineer fixing something in the SQL editor would, then run the verifier. Expect an `unexplained_drift_repaired` audit row carrying the before-image, and an alert, rather than an ordinary apply row. I41 returns 0 afterwards. This is not a test that the flag keeps anyone out: it does not, and §6.4 says why it should not try.
- **SEC-05** (security, W15): `anon` cannot read the new per-calendar and attribution columns. `updated_by_user_id` is an `auth.users` identifier and `public_read_calendar_service_assignments` is `USING (true)` today, so this fails until that policy is dropped and the public catalogue is served through the admin client.

#### UI-C-01 to UI-C-06 The collective's screens

Added by the UI review, 2026-09-14. Six screens carry the owner's requirements, and each has one test that fails today.

- **UI-C-01** (component, W7): every refusal from the create route renders inside the wizard step that caused it, with a link back where the cause belongs to an earlier step. Today the dialog's catch hands the message to the parent panel, which renders behind the still-open dialog, so all nine refusals and the 500 are invisible and the button merely stops spinning (CB-41). Assert each of the nine and the 500.
- **UI-C-02** (component, W5): the row shows "waiting for venues" while fewer than two are active, "no services yet" when two are active but nothing is on the page, and "live" only when the public page actually serves. Today it shows a green "Active" pill from the instant of creation while the page serves its unavailable state (CB-42). Also assert the member line counts and names the same set (CB-43).
- **UI-C-03** (component, W6): the member's service view contains no `disabled` form control for a host-managed field, renders each value as text with empties written out in words ("No deposit", "No forms"), and presents the member's own editable controls as ordinary live inputs. The rule under test is that a disabled form is rendered only when the artefact is itself a form, which is why the managed compliance form uses the renderer's preview mode and passes.
- **UI-C-04** (route, W5): a bulk change across 5 venues and 40 services is split into chunks under the 200-operation cap (CB-44) and returns a per-operation envelope, so a partial failure is reported per venue rather than as success. Today `set_providers` skips failures and returns `{ ok: true }` unless every one failed (CB-45). Assert that failed cells stay staged and that Retry re-sends only those.
- **UI-C-05** (component, W7): the join disclosure shows the member's real booking address and the collective's, states that client records and takings are shared through the venues' account links and that leaving the collective does not change those links, and refuses to submit without a recorded `consent_version`. Assert the invitation email no longer claims data stays separate (CB-51).
- **UI-C-06** (route, W10): the D3 hand-over is derived, never stored. Assert the rule from state alone: a venue's own page hands over when the collective page is live, the venue is listed, and (for a member) its replica links have converged; the host's page hands over on live and listed alone. Assert the dashboard nav follows the same rule, hiding "Your Booking Page" only when the page really hands over (today the sidebar hides it as though it had, CB-47, while the column defaults to `keep_live` at `src/lib/linked-accounts/collectives.ts:397` and is read at `src/lib/linked-accounts/catalogue.ts:629-634`). Nothing writes `solo_page_behavior`, no screen offers it, and C2 drops the column; a test that requires a writer is wrong.

#### Added by the consistency pass, 2026-09-14

Logged here so the record of what each pass added stays in one place. Each test's full block sits with the group it belongs to.

- **OFF-05** and **OFF-06** (route, W5): the D50 undo and host-initiated adoption, §3.13.
- **LIFE-11** to **LIFE-13** (route, W7) and **LIFE-14** (route, W7): the same-name pair after leave, invitation withdrawal and expiry, the paused state and the transfer window, and account links left untouched by today's routes, §3.17.
- **REP-06** (route, W17): reports after the end, above in this section.
- **DIARY-02** (route, W21) and **DIARY-03** (component, W21): the D47 clash warning and the D46 move dialog, above in this section.
- **PUB-05** (route, W10): other booking models under D3, §3.19.
- **MIG-05** and **MIG-06** (migration, W9): the migration's two promises under D54 (bookings protected; the host's values applied), §3.18.
- **NOT-01** (unit, W5): N32, N36 and N37, §3.29.

### 3.29 Notifications

#### NOT-01: N32 carries no contact details, N36 and N37 fire once

- **Layer:** unit. **Workstream:** W5 Host Services page (notices). **Requirements:** R1,R11.
- **Pins:** T23; D34; D54 (no migration notices); T22 (member lapse)
- **Scenario:** A guest books a member calendar on the collective page; the same booking made by member staff in the diary; a migration run to completion; the subscription cron sets `suspended_at` on a member and clears it, then runs again with nothing changed.
- **Expected:** N32 goes to host admins by bell only, is not switchable, links to the Collective area's Overview, and carries the date, time, calendar and venue but no guest name, email or phone; the staff diary booking sends no N32. The migration queues no notice at all (N29, N30 and N33 are not sent, D54). N36 fires once when `suspended_at` is set and N37 once when it is cleared, each with `collective_id` set; the idle re-run sends nothing.
- **Location:** `src/lib/linked-accounts/replicas/notices.test.ts; src/lib/cron/subscription-collective-suspension.test.ts`

## 4. Invariants

All queries live in one service-role-only function `collective_invariant_report(p_since)` (REVOKEd from PUBLIC, anon, authenticated) so pgTAP, the verifier cron, the migration script and deploy gates run identical SQL. Names follow the amended design; rename if the build differs. `:since` = Pass A deploy time. The ids are not contiguous: the SQL below defines I1 to I8, I10 to I16, I21 to I24, I30 and I32, plus I3b; the table after it defines I33 to I48. I9, I17 to I20, I25 to I29 and I31 do not exist, and nothing should cite them.

| Invariants | When | Gate |
|---|---|---|
| I1 I2 I3 I5 I8 I10 I13 I14 I15 I23 I32 | CI after every pgTAP scenario; Pass B after drain; daily cron; every deploy step | 0 (the verifier repairs I5 by releasing, and I3 only with an `unexplained_drift_repaired` row carrying the before-image and an alert; the rest alert) |
| I3b I11 I12 I22 I30 | daily cron; deploy steps | 0, alert (the verifier repairs I3b by running the apply; 15 minutes behind tells the host and member, N5; 60 minutes pages ops) |
| I6 I16 | after the Pass A backfill; Pass B; daily cron | 0 |
| I7 | before the Pass A production push (unique indexes); before C2 | 0 |
| I24 | after every `db push`, each environment | 0 |
| I4 | Pass B until C1; inside `--rollback` | 0 |
| I21 | daily cron | reported, not gated: forms off at a member is allowed (D54), and each such calendar must be hidden for form-bearing offerings (CMP-02) |
| P1 to P5 | `--dry-run` | 0 or owner-resolved before `--apply` |

```sql
-- I1 active offering with missing master or master not at host
SELECT count(*) FROM collective_service_items i JOIN venue_collectives c ON c.id=i.collective_id
LEFT JOIN service_items s ON s.id=i.master_service_id
WHERE c.status='active' AND c.service_model='replicas' AND i.status='active' AND (s.id IS NULL OR s.venue_id<>c.host_venue_id);
-- I2 active offering x active member without replica link or replica (15 min grace)
SELECT count(*) FROM collective_service_items i
JOIN venue_collectives c ON c.id=i.collective_id AND c.status='active' AND c.service_model='replicas'
JOIN venue_collective_members m ON m.collective_id=c.id AND m.status='active' AND m.venue_id<>c.host_venue_id
LEFT JOIN collective_service_replicas r ON r.collective_service_item_id=i.id AND r.venue_id=m.venue_id
WHERE i.status='active' AND (r.id IS NULL OR (r.replica_service_id IS NULL AND r.created_at<now()-interval '15 minutes'));
-- I3 unexplained drift: replica link marked current whose fingerprint differs from the expected fingerprint (never ordinary lag; that is I3b)
SELECT count(*) FROM collective_service_replicas r
JOIN venue_collectives c ON c.id=r.collective_id AND c.status='active' AND c.service_model='replicas'
WHERE r.replica_service_id IS NOT NULL AND r.applied_revision=r.desired_revision
  AND collective_replica_fingerprint(r.id) IS DISTINCT FROM collective_expected_fingerprint(r.id);
-- I3b ordinary lag: replica link behind for more than 15 minutes
SELECT count(*) FROM collective_service_replicas WHERE applied_revision<desired_revision AND behind_since<now()-interval '15 minutes';
-- I4 active legacy provider without its CSA row (Pass B to C1, rollback)
SELECT count(*) FROM collective_service_providers p JOIN collective_service_items i ON i.id=p.item_id
JOIN venue_collectives c ON c.id=i.collective_id AND c.status='active'
LEFT JOIN calendar_service_assignments a ON a.calendar_id=p.practitioner_id AND a.service_item_id=p.source_service_id
WHERE p.status='active' AND p.practitioner_id IS NOT NULL AND a.id IS NULL;
-- I5 replica link outside an active membership of an active replicas collective
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
JOIN collective_service_items i ON i.id=r.collective_service_item_id LEFT JOIN service_variants mv ON mv.id=rv.replica_of_variant_id
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
-- I21 replica with forms at a member whose forms are off: reported, not gated (env FEATURE_FLAG_COMPLIANCE_RECORDS_ENABLED overrides; check it too)
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
          ('collective_service_replicas','collective_audit_events','collective_operations','collective_catalogue_revisions','collective_column_classes'))
     + (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES ('anon'),('authenticated')) r(role)
        WHERE n.nspname='public' AND c.relkind='S' AND c.relname LIKE 'collective\_%' AND has_sequence_privilege(r.role,c.oid,'USAGE,SELECT,UPDATE'));
-- I30 member left or removed since deploy without a release audit row
SELECT count(*) FROM venue_collective_members m JOIN venue_collectives c ON c.id=m.collective_id AND c.service_model='replicas'
WHERE m.status IN ('left','removed') AND m.updated_at>=:since AND NOT EXISTS (SELECT 1 FROM collective_audit_events e
  WHERE e.collective_id=m.collective_id AND e.target_venue_id=m.venue_id AND e.event_type='member_released');
-- I32 active replica variant without mapping on a current replica link
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

### Added by the second pass and the consistency pass: I33 to I48

Each was checked against I1 to I32 for overlap before being added. I13 covers wrong-venue assignments, I14 covers three cross-venue child cases, I5 covers replica link scoping and I7 covers duplicate live memberships; none of the following is reachable from those.

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
| I42 | Client privileges on the **legacy** collective and service tables, not only the five engine tables: `venue_collectives`, `venue_collective_members`, `collective_service_items`, `collective_service_providers`, `collective_service_categories`, `service_items`, `service_variants`, `addon_groups`, `addons`, `service_addon_groups`, `service_categories`, `calendar_service_assignments`, `compliance_types`, `compliance_type_versions`, `service_compliance_requirements`. Fail on any privilege other than SELECT, and assert that `public_read_calendar_service_assignments` and `public_read_practitioner_services` no longer exist | I24 passes while `anon` holds full DML on every table the engine's correctness actually depends on during Pass B and until C2 |
| I43 | A venue live in one collective while holding an `invited` row in another | I7 counts `status = 'active'` only, and the live unique index is per `(collective_id, venue_id)`, so it does not prevent this |
| I44 | Per-calendar terms written by a venue that is neither the calendar's owner nor the collective's host | Guards the new `updated_by_venue_id` and `updated_by_user_id` attribution columns |
| I45 | A copy still following an origin outside a live shared collective, during the Pass B window | Catches the legacy sync columns' "resumes syncing" behaviour and the member-to-member write path in SB-15 |
| I46 | A member venue in an active replicas collective whose subscription entitlement is neither active-like nor free-access and which is not marked `suspended_at` | Ties member suspension to the canonical entitlement resolver, so a venue on a trial or inside a cancellation window is not suspended and a lapsed one does not keep selling |
| I47 | An `account_links` row between two venues of a collective whose `updated_at` equals the `created_at` of a `member_released`, `member_joined`, `host_transferred` or `migration_applied` audit row targeted at either venue (so it was written inside a collective lifecycle transaction) | The invariant behind D41 as revised on 2026-09-14: nothing the collective does may create, narrow or end an account link. Replaces the withdrawn version, which counted links that had not been ended |
| I48 | A legacy collective (`service_model <> 'replicas'`) reached since `:since` by a shimmed catalogue action, an own-page hand-over decision, the 24-hour `STALE_RESOURCE` rule or a consent refusal | Every shim, the manager fold, the stale rule and the accept consent gate are conditioned on `service_model = 'replicas'` (the Pass A go condition); if any of them touches a legacy collective the condition has slipped. Expected 0 from Pass A until C1, after which no legacy collective remains |

**Gate placement.** I33, I34, I35, I36, I39, I40, I44 and I47 join the CI-after-every-scenario set (expect 0). I37, I38 and I45 run from Pass B until C2. I41 and I43 run daily and alert. I42 replaces I24's narrower clause at every `db push`, on each environment. I46 runs daily. I48 runs at every deploy step and daily from Pass A until C1 (expect 0); it is the gate that proves the shims, the manager fold, the stale rule and the consent gate are conditioned on `service_model`.

## 5. Rollout verification

Follows the ritual (staging push, staging code, test, production push, merge, reset staging). "Invariants" = `node scripts/collective-invariants.mjs --env <env>` (new). Production runs override `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`. No Playwright and no fixture writes on production, ever.

### Pass 0: owed migrations first (RT1-9)
1. `npx supabase migration list --db-url` for staging and production; record both. Expected pending on production: 20270202120000, 20270202130000, 20270202140000, 20270204120000, 20270208120000, 20270209120000 (UNVERIFIED).
2. Each environment: push, `npm run check:function-grants`, `npm run check:table-grants`, then: non-canonical processing shapes 0, rota calendars without `schedule_periods` 0, sync columns present, staff Bearer read of `venue_collectives` without recursion.
- **Go**: identical lists afterwards, all checks 0, no new 5xx for 24 h. **No-go**: any surprise pending file.
- **Rollback drill**: data backfills cannot be undone; record the PITR point and prove a staging PITR restore boots.

### Pass A: expand, in two halves: A1 (booking correctness, snapshot, CSA columns, unique indexes; live) and A2 (engine dark)
Pre-flight: CI green (including engine races, PostgREST contract, migration lint); `supabase db push --dry-run` (flag UNVERIFIED on 2.114.0, else `migration list`) shows only 20270214120000 and 20270215120000; I7 = 0 on production; PERF-01 and PERF-02 baselines; read-only plus-1 catalogue snapshot (`scripts/collective-catalogue-snapshot.mjs`).

Staging:
1. Push; grant checks (the five engine tables and their sequences hold no client privileges, function allowlist unchanged); I6 and I24 = 0; `venues.stripe_charges_enabled` backfilled before the hide rule ships; I48 = 0.
2. Deploy code A with `COLLECTIVE_REPLICAS_FOR_NEW_COLLECTIVES=false`.
3. plus-1 snapshot diff shows only the listed booking-correctness fixes; smoke e2e green; payment totals of every existing booking unchanged; a fixture walk-in gets a snapshot from the fallback.
4. Fixture collective switched to replicas: LIVE-01, E2E-01 to E2E-04, APP-04, perf budgets.
5. Owner signs the Pass A items.

Production: push; grant checks; I6, I7, I24 = 0; merge and deploy with the flag off; read-only catalogue diffs; 48 h watch (LIVE-02).
- **Go to Pass B**: 48 h clean on production, 7 days clean on staging fixtures, I48 = 0 throughout. **No-go**: any refusal or `COLLECTIVE_*` 409 at a venue outside a replicas collective, any changed total, a breached budget.
- **Rollback drills (staging first)**: (1) redeploy the previous build over the Pass A schema, smoke green, bookings insert (fallback fills); (2) emergency SQL disables lock and dirty triggers, a fixture member edit succeeds, re-enable, the verifier repairs the hand edit as `unexplained_drift_repaired` with an alert (expected in the drill), I3 = 0; (3) snapshot backfill re-run writes 0 rows.

### Pass B: migrate existing collectives (per environment, after code A is live there)
Staging rehearsal on a scratch legacy collective built on `e2e-coll-*` fixtures with plus-1's shape (drift, archived same-slug form, variants, bookings):
1. `node scripts/collective-replicas-migrate.mjs --collective <id> --dry-run > report.json`; review P1 to P5.
2. `--apply --approved-report <sha256>`; I1 to I3, I5, I8, I10 to I16, I23, I32 = 0; every payment total unchanged; catalogue diff only intended.
3. `--rollback`: replica links released, `legacy_copies` restored, the provider snapshot, the three sync columns, add-on links, option states and compliance type states restored exactly as recorded, before-images applied only where `updated_at` is unchanged since the switch, per-calendar values left in place; legacy page equals the pre-migration snapshot; I4 = 0. 4. `--apply` again converges.

A migration is not runnable on production until: `stripe_charges_enabled` has been backfilled for every venue with a Stripe account; every MGR-01 shim, the W10 hand-over and the accept consent gate are proven to condition on `service_model` (I48 = 0); the rehearsal has shown every booking untouched through apply and rollback (MIG-05), the host's values on every replica with the before-image recorded and nothing sent or shown (MIG-06), a legacy leave before the switch losing nothing, a rollback restoring the provider snapshot and the sync columns (MIG-03), and the catalogue diff equal to the signed report; and no member loses every calendar from the page.

Staging plus-1: probe; dry run; owner review and signature of the corrected D21 list (Light 3 has forms off, which the migration leaves as it is, and holds the archived PPD Patch Test d1a15afc, adopted as the managed form only when Light 3 switches compliance records on; its Haircut takes the host's 25.00 for new bookings while every booking already made keeps 10.00; its 10 member-only services follow the owner's choice per service in the signed report, added to the page or parked); the owner tells both venues in person; apply; invariants; `[coll-test]` price check with owner agreement; 7-day soak (verifier drift 0, I3b 0, stale hides 0, `COLLECTIVE_SERVICE_UPDATING` under 1 per 100 bookings); owner completes the checklist.

Production: read-only probes (P1 to P5, form collisions, Stripe readiness, forms flags and `FEATURE_FLAG_*` env, variants with bookings, I7); dry run; owner signs the report hash; apply per collective; invariants; totals diff 0.
- **Go**: every gate 0 with a signature. **No-go**: ambiguous masters, unresolved collisions, unmapped booked variants, any total change. **Rollback**: the drilled `--rollback`, valid until C1.

### Flag flip for new collectives (RT2-28)
After the staging soak and 7 clean days on a migrated production collective: set the flag on staging, run LIFE-01 and a fixture create-to-dissolve, then production. Rollback: flag off.

### Pass C1: code removal
Gates: no active collective outside replicas mode on either environment; legacy-reader sweep green; app contract green; legacy tests removed through INF-16. Staging 7 days, production 48 h. Rollback: previous build.

### Pass C2: contract migration
Gates: C1 on production 7 days; I7 = 0; the migration's DO block raises on any non-replicas active collective; the two collective pgTAP files updated in the same PR; drops use IF EXISTS; PITR point recorded. Staging push, CI, grant checks, production push, grant checks, invariants. Rollback: PITR only; drill a staging PITR restore that boots C1 code.

## 6. Owner acceptance checklist

Do this on staging after Pass B, signed in as the host and as a member in two browsers, using the E2E Coll fixture venues (or plus-1 and Light 3 where noted). Tick each box only when you have seen it yourself.

**R1 One venue, built on your account links**

The owner settled this on 2026-09-14 (D41, revised the same day, and D49). A collective sits on top
of account links with full access. The links are what share client details and bookings, and they
carry on whatever happens to the collective. What must be true is that this is explicit, that the
collective makes it seamless while it runs, and that leaving or ending the collective changes only
the collective.

- [ ] Open the collective page. Every practitioner calendar from both venues is listed under one set of headings. (Resource and non-practitioner calendars are filtered out by design, so do not expect them.)
- [ ] Book a member calendar as a guest. The booking appears in the member's diary and contacts, and the client record belongs to the member, not to you.
- [ ] **As host staff, search Contacts for a client who has only ever booked at a member venue.** You should find them, and the record should say plainly which venue owns it. This is the seamless half, and it does not exist today.
- [ ] Open that client from your own account. You should see the full record, including notes, documents and compliance records. Edit something, and check the change is visible to the owning venue and recorded against them.
- [ ] **Open Booked revenue.** You should see every venue's figures, each one named, with its own subtotal and a total. A single blended number with no venues named is a fail even though the access itself is intended.
- [ ] Check that the join dialog said all of this before you agreed to it, and that your agreement was recorded. Nobody should discover shared client access or shared revenue after the fact.
- [ ] **Now leave the collective, or dissolve it, and try again.** The collective page no longer lists you, and the collective contact search and collective report view are gone. **Your account links are exactly as they were:** you can still see the other venues' bookings in the diary, and still make, edit and cancel bookings for them, and they can still do the same for you. This is the check that matters most.
- [ ] Open Settings, Linked accounts. Every link is still there with the same permissions. Joining or leaving a collective never changes a link; only you change links, here.

**R2 One host, one or more members**
- [ ] The Collective area's Venues tab shows exactly one host. Invite a venue that already belongs to another collective from that tab: you see a clear refusal.

**R3 You choose the services, and missing ones are created**
- [ ] On your Services page, choose "Show on the {collective} page" for a service the member does not have. Within a minute it appears on the member's Services page under "From {host}".
- [ ] Take it off the page. The member's replica moves to "No longer offered by {host}", and its calendars and bookings stay.
- [ ] As the member, look at a service only you have. It sits under "Parked while you are part of {collective}": you can edit it, but nobody can book it from the diary, New, Walk-in or online, and a booking already made on it can still be moved and cancelled. As the host, add it with "Add from another venue": it becomes bookable everywhere.
- [ ] Tick "Staff bookings only" on an offered service. Your team and the member's can book it from the diary; guests cannot see it on the collective page.

**R4 You control every detail**
- [ ] Change the name, description, price, length, a processing gap, an option and an add-on. Each change shows at the member within a minute.
- [ ] As the member, open that service. You see its values written out, not a greyed-out form, and the banner tells you who manages it.

**R5 You choose which calendars offer each service**
- [ ] On the service page, tick a member calendar and save. The member's Calendar Availability shows it ticked.
- [ ] Untick a member calendar that has bookings. The warning lists dates and times without client names, and those bookings stay.

**R6 Linked by default**
- [ ] Create a new collective with a fixture venue. Every offered service arrives at the member with no "link" or "sync" step and no independent copy option.

**R7 Your changes reach everyone, and you see every calendar**
- [ ] After a save you see "Saved. {service} is up to date at {venueList}." or, while a venue is still catching up, "Saved. {venue} is updating. Its calendars take new bookings for {service} again in a moment." If a venue could not update, you see why and one Retry button, in the strip at the top of the service page.
- [ ] For 60 seconds after that save you also see "Put it back". Use it once: every venue shows the old value again, and the history records both the change and the undo.
- [ ] The service page lists the member's calendars next to yours, with add and remove.

**R8 Staff permissions and per-calendar values work the same at members**
- [ ] Allow staff to change the price. A member staff member sets a custom price on their calendar; the collective page and the booking charge use it.
- [ ] Turn the permission off. The custom price stops applying at your calendars and the member's alike.

**R9 Member calendars feel like yours**
- [ ] Book the same service on one of your calendars and one member calendar. Name, length, options, add-ons, forms and price rules match, apart from values you let calendars change.
- [ ] The confirmation email and the diary show the same service name as the page.
- [ ] **If you try to invite someone who already works at another venue, you see "{email} is already linked to another ResNeo venue, so we cannot add them here. Invite them with a different email address." and nothing is created.** A person whose account is already linked to two venues sees "This account is linked to more than one venue, so we cannot tell which one to open. Please contact support and we will sort it out." instead of the signup flow. D38 chose not to build a venue chooser, so a person running two venues keeps two logins; what must be true is that the product says so rather than locking them out, which is what happens today.
- [ ] Look at a member's column in your diary on a day that venue is closed. It shows them closed, not open.
- [ ] Try to move a booking to a calendar at another venue. It is refused every time: the dialog says "This booking cannot be moved to {venue}", explains that bookings stay with the venue that holds the client's record and any payment, and does not suggest rebooking and cancelling.

**R10 Member calendar choices sync by themselves**
- [ ] As the member, untick a service on Calendar Availability and save. The collective page drops that calendar for that service straight away. Tick it again and it returns.

**R11 Nobody is misled about how far a change reaches**
- [ ] Your Services page says which services are shared and with how many venues. The member's page says which services it cannot edit.
- [ ] Settings that still differ per venue (for example reminders or in-person payments) show "Different at {venue}". Settings you control for everyone (guest sign-in, self-reschedule, the waitlist, "Any available", staff-first) show read-only at the member, saying that you set them.
- [ ] Ask to use the member's page address for the collective page. Nothing changes until the member's admin agrees, and the history records it when they do.

**R12 Everything runs through you, apart from what you delegate**
- [ ] As the member, try to delete or switch off a shared service, change an add-on group or edit a shared form. Each is refused with a plain explanation.
- [ ] In the ResNeo app on an older build, try the same edit. You see the same explanation, not an error screen.

**R13 A member can leave at any time and take control back**
- [ ] As the member, choose Leave. Every service, calendar choice, price and booking is still there, and the services are now editable. Services that were parked are bookable again straight away.
- [ ] The member's own booking page is back, and old links to it work. If the member has no Stripe, services that took payment online now say they do not, and you were told.
- [ ] A service the member kept separate at join now sits beside the one that came from you, both active; the one from you says "Came from {host}" for a month, and nothing was merged.

**R14 Breaking the collective returns everyone to their own page**
- [ ] Dissolve a fixture collective. The old collective address shows a page pointing to each venue's own booking page.
- [ ] Each venue's own page takes bookings, and nothing in either account was deleted.

**Money and safety, across all requirements**
- [ ] After a price change, an earlier booking still shows the price the client agreed, and your revenue report for last month is unchanged.
- [ ] A member without card payments set up is not offered to guests for a service that needs a deposit.
- [ ] A guest booking a member calendar that needs a patch test form can complete it, including the file upload.

**Existing bookings are protected and the host's values apply (D54)**

Do this on the migrated staging collective, signed in as Light 3, with a list of its bookings taken before the switch.

- [ ] Every booking made before the switch is still there, on the same calendar, for the same service, at the price it was booked at, and its manage link still opens. A Haircut booked at 10.00 still says 10.00 everywhere a guest or your team can see it.
- [ ] A new Haircut booking on one of your calendars is priced at the host's 25.00, and your Services page shows Haircut as a service from the host with the host's values.
- [ ] Nothing was sent to you by the product about the switch, and there is no review panel: the services from the host simply appear as locked services, with one line in History saying the host's settings now apply. Anything that looks wrong on the collective page is corrected by the host editing the service.
- [ ] Each of your member-only services is where the signed report said: added to the page with its settings, calendars and bookings unchanged, or parked and otherwise exactly as you left it. Your compliance setting is exactly as you left it: the migration switched nothing on.

## 7. CI changes

1. **Extend the projection guard.** `src/lib/testing/migration-columns.ts` and its test are committed (`973bd3e`); they were uncommitted while this plan was written, so the earlier instruction to commit them first is done. Extend it to check insert, update and upsert payload keys and `onConflict` columns, and make it mandatory in every new route test for collective, service, booking and compliance routes (sweep INF-09 enforces `makeAfterStub()` there too).
2. **`supabase/scripts/local_baseline_grants.sql`**: add `collective_service_replicas`, `collective_audit_events`, `collective_operations`, `collective_catalogue_revisions`, `collective_column_classes` to the exclusion list, and replace the blanket `GRANT USAGE, SELECT ON ALL SEQUENCES` with a loop that skips `collective_%` sequences. Without this CI re-grants what Pass A revokes and the grant assertions pass against a database that exists nowhere (INF-08).
3. **`rls-pgtap` job** (`.github/workflows/ci.yml:77-131`): add `timeout-minutes: 30`; new pgTAP files run automatically; after `supabase test db` add
   - `bash scripts/db-concurrency/run.sh` (psql sessions against `127.0.0.1:54322`, conductor-driven races CON-01 to CON-04, installs the local `collective_engine_test_point` override);
   - `node scripts/db-contract/postgrest-contract.mjs` (keys from `supabase status -o env`; SEC-01);
   - a non-blocking `node scripts/db-contract/trigger-overhead.mjs` report step (`continue-on-error: true`) for PERF-03.
4. **New `migration-lint` job** (no database, fast): `node scripts/check-migrations.mjs` (INF-15): single-event transition-table triggers, REVOKE on new tables, sequences and functions naming PUBLIC, anon, authenticated, `SET search_path` on SECURITY DEFINER, `SET resneo.collective_engine` on engine functions, no STABLE or IMMUTABLE writers, no policy subquery on `venue_collectives` or `venue_collective_members`, engine-bypass preamble on data migrations touching service tables, IF EXISTS on contract drops.
5. **Align the Supabase CLI**: change `package.json` `test:db` from 2.98.2 to 2.114.0 so the flag-restoration and trigger proofs run on the same CLI and Postgres locally and in CI.
6. **`test` job**: nothing to add; new sweeps, contract replays and query-count budgets are Vitest files. Keep the legacy-test removal register (INF-16) in the suite so C1 cannot leave pinned legacy tests behind.
7. **`e2e-smoke` job**: add `node scripts/seed-e2e-collective.mjs` after the existing seeds, variables `E2E_COLLECTIVE_HOST_SLUG`, `E2E_COLLECTIVE_MEMBER_A_SLUG`, `E2E_COLLECTIVE_MEMBER_B_SLUG` and secret `E2E_COLLECTIVE_MEMBER_A_STRIPE_ACCOUNT_ID`; `e2e/global-setup.ts` must throw, not warn, when `CI` and `RUN_E2E_SMOKE` are set but any of these is missing (INF-12); upload the seed's ledger with the failure artifacts.
8. **New nightly workflow** `.github/workflows/nightly-engine.yml` (`schedule` plus `workflow_dispatch`): local Supabase, 1,000-round fuzz (ENG-08), 50 by 10 scale fixture for PERF-03 with EXPLAIN output as an artifact. Not a PR gate.
9. **Optional `app-contract-live` workflow** (`workflow_dispatch`, gated on `vars.RUN_APP_CONTRACT_LIVE`): APP-04 Bearer replay against staging fixtures with the staging secrets the e2e job already holds.
10. **Unchanged by design**: `check:function-grants` and `check:table-grants` stay in the migration ritual, run against each hosted environment after every push (they need the secret key and hosted defaults differ from local). Extend `check-table-grants.mjs` with the five engine tables as "no client privileges" and a sequence check, and keep the function allowlist unchanged (no engine function may appear).
