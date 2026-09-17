/**
 * Move an existing collective from the older model (service copies) to shared services
 * (Docs/collective-one-venue-plan.md §7 and Appendix G, W9; migration 20270218220000).
 *
 * One collective at a time. Nothing is sent to the venues (D54): the owner tells them in person.
 *
 *   --survey                              every collective still on the older model, with its P1 to P5
 *   --collective <id> [--dry-run]         the report to sign (JSON on stdout, summary and hash on stderr)
 *   --collective <id> --apply --approved-report <sha256> --env staging|production
 *                                         start, drain every link, switch, then check the invariants.
 *                                         Re-run the same command to resume after a stop.
 *   --collective <id> --rollback --env staging|production [--restore-stale <service id,...>]
 *                                         put the collective back as it was recorded
 *   --choices <file.json>                 the owner's choices, the same file for dry run and apply:
 *                                         { "needs_master": [{ "item_id", "choice": "create"|"skip" }],
 *                                           "member_only": [{ "service_id", "choice": "add_to_page"|"park" }] }
 *   --actor-user <uuid>                   the person running it, for the history (optional)
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, from the environment or .env.local.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { canonicalJson, fenceError, parseArgs, planBlocker, reportHash, summarisePlan } from './collective-replicas-migrate-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.');
  process.exit(1);
}
const projectRef = new URL(url).hostname.split('.')[0];
const admin = createClient(url, key, { auth: { persistSession: false } });
const log = (...m) => console.error(...m);

async function rpc(fn, params) {
  const { data, error } = await admin.rpc(fn, params);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

const choices = args.choices ? JSON.parse(readFileSync(args.choices, 'utf8')) : {};
const actor = args.actorUser ?? null;

async function plan(collectiveId) {
  return rpc('collective_migration_plan', { p_collective_id: collectiveId, p_choices: choices });
}

async function pendingLinks(collectiveId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('collective_service_replicas')
      .select('id, applied_revision, desired_revision, replica_service_id')
      .eq('collective_id', collectiveId)
      .is('released_at', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`reading links: ${error.message}`);
    out.push(...data.filter((l) => l.applied_revision < l.desired_revision || !l.replica_service_id));
    if (data.length < 1000) return out;
  }
}

async function drain(collectiveId) {
  for (let pass = 1; pass <= 5; pass += 1) {
    const links = await pendingLinks(collectiveId);
    if (links.length === 0) return;
    log(`Drain pass ${pass}: ${links.length} link(s)`);
    let done = 0;
    for (const link of links) {
      try {
        await rpc('collective_apply_replica', {
          p_link_id: link.id, p_actor_venue_id: null, p_actor_user_id: actor, p_job: 'collective-migrate',
        });
      } catch (e) {
        log(`  link ${link.id}: ${e.message}`);
      }
      done += 1;
      if (done % 25 === 0 || done === links.length) log(`  ${done}/${links.length}`);
    }
  }
  const left = await pendingLinks(collectiveId);
  if (left.length) throw new Error(`${left.length} link(s) still behind after 5 passes: ${left.slice(0, 5).map((l) => l.id).join(', ')}`);
}

async function invariants(since, collectiveId) {
  const rows = await rpc('collective_invariant_report', { p_since: since, p_collective_id: collectiveId });
  const bad = (rows ?? []).filter((r) => Number(r.violations) > 0);
  for (const r of bad) log(`  ${r.invariant}: ${r.violations} (${(r.sample_ids ?? []).slice(0, 5).join(', ')})`);
  return bad;
}

async function bookingTotals(collectiveId) {
  const { data: members, error } = await admin
    .from('venue_collective_members').select('venue_id').eq('collective_id', collectiveId);
  if (error) throw new Error(`reading members: ${error.message}`);
  const venueIds = [...new Set(members.map((m) => m.venue_id))];
  let count = 0;
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await admin
      .from('bookings').select('id, booking_total_price_pence').in('venue_id', venueIds).order('id').range(from, from + 999);
    if (e) throw new Error(`reading bookings: ${e.message}`);
    count += data.length;
    total += data.reduce((n, b) => n + (b.booking_total_price_pence ?? 0), 0);
    if (data.length < 1000) return { count, total };
  }
}

async function collectiveRow(collectiveId) {
  const { data, error } = await admin
    .from('venue_collectives').select('id, name, service_model, status').eq('id', collectiveId).maybeSingle();
  if (error || !data) throw new Error(`collective ${collectiveId} not found`);
  return data;
}

try {
  if (args.mode === 'survey') {
    const { data, error } = await admin
      .from('venue_collectives').select('id, name, status').eq('service_model', 'legacy_copies').order('name');
    if (error) throw new Error(error.message);
    log(`${data.length} collective(s) on the older model in ${projectRef}`);
    const out = [];
    for (const c of data) {
      const p = await plan(c.id);
      out.push({ id: c.id, name: c.name, status: c.status, p1: p.p1.count, p2: p.p2.count, p3: p.p3.count, p4: p.p4.count, p5: p.p5.count, links: p.links.length, member_only: p.member_only.length });
    }
    console.log(JSON.stringify(out, null, 2));
  } else if (args.mode === 'dry-run') {
    const p = await plan(args.collective);
    console.log(canonicalJson(p));
    log(summarisePlan(p));
    log(`\nProject ${projectRef}. Report sha256 (sign this): ${reportHash(p)}`);
  } else {
    const fence = fenceError(args.env, projectRef);
    if (fence) throw new Error(fence);
    const row = await collectiveRow(args.collective);

    if (args.mode === 'rollback') {
      const before = await bookingTotals(args.collective);
      const r = await rpc('collective_migration_rollback', {
        p_collective_id: args.collective, p_restore_stale: args.restoreStale.length ? args.restoreStale : null, p_actor_user_id: actor,
      });
      const after = await bookingTotals(args.collective);
      log(`Rolled back ${row.name}: ${r.restored} service(s) restored.`);
      for (const s of r.skipped ?? []) log(`  not restored, ${s.reason}: ${s.service_id} (pass --restore-stale to restore it anyway)`);
      if (before.count !== after.count || before.total !== after.total) throw new Error('Booking totals changed during the rollback');
      console.log(JSON.stringify(r, null, 2));
    } else {
      const started = new Date().toISOString();
      const before = await bookingTotals(args.collective);
      if (row.service_model === 'legacy_copies') {
        const p = await plan(args.collective);
        const blocker = planBlocker(p, args.approvedReport);
        if (blocker) throw new Error(`Not applied: ${blocker}`);
        const begun = await rpc('collective_migration_begin', {
          p_collective_id: args.collective, p_choices: choices, p_actor_user_id: actor,
        });
        log(`Started ${row.name}: ${begun.links.length} link(s), ${begun.bookings_snapshotted} booking(s) snapshotted, ${begun.created_masters.length} master(s) created`);
      } else if (row.service_model === 'migrating') {
        log(`${row.name} is already migrating: resuming the drain.`);
      } else {
        throw new Error(`${row.name} is already on ${row.service_model}`);
      }
      await drain(args.collective);
      const finished = await rpc('collective_migration_finish', { p_collective_id: args.collective, p_actor_user_id: actor });
      log(`Switched to shared services; ${finished.added_to_page.length} member service(s) added to the page.`);
      await drain(args.collective);
      const after = await bookingTotals(args.collective);
      if (before.count !== after.count || before.total !== after.total) {
        throw new Error(`Booking totals changed: ${before.count}/${before.total} to ${after.count}/${after.total}`);
      }
      const bad = await invariants(started, args.collective);
      if (bad.length) throw new Error(`${bad.length} invariant(s) failing; consider --rollback`);
      log('Invariants clean and booking totals unchanged.');
    }
  }
} catch (e) {
  log(e.message);
  process.exit(1);
}
