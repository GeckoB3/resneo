/**
 * Verifies the table/view grants that customer-portal security depends on,
 * against the LIVE database (P0-6). Sibling of check-client-executable-functions.mjs,
 * which covers functions; before this script, the "verify hosted grants" ritual
 * had no tool for tables and views at all.
 *
 * Why live and not the migrations: hosted Supabase grants anon and authenticated
 * outside the migration history (project-level default privileges), so what a
 * migration file says proves nothing about what a role can reach. Probed
 * 2026-08-27 on staging: anon held SELECT on all of bookings, guests and
 * guests_account_safe despite no migration granting any of it. RLS keeps those
 * empty, so it is not a live leak, but it is exactly the drift class this
 * script exists to see.
 *
 * What it enforces (CONTRACT - any mismatch fails):
 *   - bookings_account_safe: authenticated holds SELECT and nothing else;
 *     anon holds NOTHING (the migration revokes it explicitly). A view that
 *     exists with no authenticated grant fails closed and silently empties
 *     every portal read, which is the failure this check is written to catch.
 *   - guests_account_safe: authenticated holds SELECT. (anon's hosted default
 *     grant predates this work and is reported, not failed; see below.)
 *   - portal_events: neither anon nor authenticated holds anything (P0-10).
 *   - user_devices: authenticated holds relation-wide SELECT/INSERT/UPDATE/DELETE,
 *     which is what makes P0-13's new `audience` column writable. A column-level
 *     grant set would not cover a newly added column.
 *   - bookings: authenticated has NO relation-wide SELECT, and its column-only
 *     SELECT is exactly the nine operational columns from 20270112120000.
 *     Widening that set reopens C5/N5 over PostgREST and Realtime.
 *
 * What it reports without failing (PRE-EXISTING): anon's hosted default grants
 * on the base tables above. Closing those is a real decision with its own blast
 * radius, not something this check should force by turning CI red. If one of
 * them disappears, the report simply goes quiet.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, from the
 * environment or .env.local, plus migration 20270118120000 applied (it creates
 * the audit_client_table_grants RPC this calls).
 *
 * Usage:
 *   npm run check:table-grants
 *   node scripts/check-table-grants.mjs
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

/** The nine columns 20270112120000 grants authenticated on bookings, sorted. */
const BOOKINGS_GRANTED_COLUMNS = [
  'booking_date',
  'booking_end_time',
  'booking_time',
  'calendar_id',
  'id',
  'practitioner_id',
  'status',
  'updated_at',
  'venue_id',
];

function fmt(row) {
  if (!row) return 'no privileges';
  const parts = [];
  if (row.table_privileges?.length) parts.push(`table: ${row.table_privileges.join(',')}`);
  if (row.column_select_columns?.length) {
    parts.push(`column SELECT: ${row.column_select_columns.length} column(s)`);
  }
  return parts.join('; ') || 'no privileges';
}

function sameSet(a, b) {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) {
    console.error('FAIL  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
    return 1;
  }

  const db = createClient(url, secret, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('audit_client_table_grants');
  if (error) {
    console.error(`FAIL  Could not run the audit: ${error.code ?? ''} ${error.message}`);
    if (error.code === 'PGRST202' || /does not exist|schema cache/i.test(error.message)) {
      console.error('      Apply supabase/migrations/20270118120000_bookings_account_safe.sql');
    }
    return 1;
  }

  const project = new URL(url).hostname.split('.')[0];
  const grant = (rel, role) =>
    (data ?? []).find((r) => r.relation_name === rel && r.role_name === role) ?? null;

  const failures = [];
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${ok ? '' : ` -- ${detail}`}`);
    if (!ok) failures.push(label);
  };

  console.log(`project ${project}: customer-portal table grant contract\n`);

  // -- bookings_account_safe -------------------------------------------------
  const basAuth = grant('bookings_account_safe', 'authenticated');
  check(
    'bookings_account_safe: authenticated holds SELECT and only SELECT',
    sameSet(basAuth?.table_privileges, ['SELECT']),
    `live: ${fmt(basAuth)}. Without SELECT every portal read fails closed and empty.`,
  );
  const basAnon = grant('bookings_account_safe', 'anon');
  check(
    'bookings_account_safe: anon holds nothing',
    basAnon === null,
    `live: ${fmt(basAnon)}. The migration REVOKEs anon; hosted defaults may have re-granted.`,
  );

  // -- guests_account_safe ---------------------------------------------------
  const gasAuth = grant('guests_account_safe', 'authenticated');
  check(
    'guests_account_safe: authenticated holds SELECT',
    (gasAuth?.table_privileges ?? []).includes('SELECT'),
    `live: ${fmt(gasAuth)}. Portal guest resolution fails closed without it.`,
  );

  // -- portal_events (P0-10) -------------------------------------------------
  // Service role only. RLS is enabled with no policies, but grants are checked
  // BEFORE RLS, and hosted defaults grant client roles on new tables: exactly
  // how bookings_account_safe became writable (20270119120000).
  for (const role of ['anon', 'authenticated']) {
    const row = grant('portal_events', role);
    check(
      `portal_events: ${role} holds nothing`,
      row === null,
      `live: ${fmt(row)}. Portal metrics are service-role only.`,
    );
  }

  // -- user_devices (P0-13) --------------------------------------------------
  // The audience column is added by migration 20270121120000, and the client
  // writes it through the session client under RLS. A relation-wide grant
  // covers every column including new ones; a COLUMN-level grant would not, and
  // the new column would be silently unwritable. Device registration would then
  // start failing on a table whose failure mode is "push notifications quietly
  // stop", which is close to undetectable in production.
  const devAuth = grant('user_devices', 'authenticated');
  check(
    'user_devices: authenticated holds relation-wide SELECT, INSERT, UPDATE, DELETE',
    ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].every((p) =>
      (devAuth?.table_privileges ?? []).includes(p),
    ),
    `live: ${fmt(devAuth)}. Relation-wide grants are what make the new audience ` +
      'column writable; column-level grants would not cover it.',
  );

  // -- bookings base table ---------------------------------------------------
  const bAuth = grant('bookings', 'authenticated');
  check(
    'bookings: authenticated has NO relation-wide SELECT',
    !(bAuth?.table_privileges ?? []).includes('SELECT'),
    'a relation-wide SELECT re-exposes every column 20270112120000 revoked, over Realtime too.',
  );
  check(
    'bookings: authenticated column-only SELECT is exactly the nine operational columns',
    sameSet(bAuth?.column_select_columns, BOOKINGS_GRANTED_COLUMNS),
    `live: [${(bAuth?.column_select_columns ?? []).join(', ')}]`,
  );

  // -- Pre-existing hosted defaults: report, do not fail ---------------------
  const preExisting = ['bookings', 'guests', 'guests_account_safe']
    .map((rel) => ({ rel, row: grant(rel, 'anon') }))
    .filter(({ row }) => row !== null);
  if (preExisting.length) {
    console.log('\nPRE-EXISTING (reported, not failed): anon hosted-default grants remain on:');
    for (const { rel, row } of preExisting) console.log(`  ${rel}: ${fmt(row)}`);
    console.log('  RLS returns empty for all of these today. Closing them is a separate decision.');
  }

  if (failures.length) {
    console.error(`\nFAIL  ${failures.length} grant contract violation(s). See lines above.`);
    return 1;
  }
  console.log('\nOK    All customer-portal grant contracts hold.');
  return 0;
}

process.exitCode = await main();
