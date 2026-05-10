/**
 * Deletes a Supabase Auth user by email and all data for venue(s) where that email
 * appears in `staff` (test cleanup before reusing the address as superuser).
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *
 * Uses DB function admin_hard_delete_venue (see migration) to handle append-only `events`,
 * booking FKs, and staff references — plain DELETE from the client will fail on bookings.
 *
 * Usage:
 *   node scripts/delete-user-and-venue.mjs --email=you@example.com --dry-run
 *   node scripts/delete-user-and-venue.mjs --email=you@example.com --confirm
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config();

const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1]?.trim();
const dryRun = args.includes('--dry-run');
const confirm = args.includes('--confirm');

const EMAIL = (emailArg || process.env.DELETE_USER_EMAIL || 'andrewcourtney@gmail.com').toLowerCase().trim();

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
    process.exit(1);
  }
  return { url, key };
}

/**
 * Removes a venue and all dependent rows via DB function (handles append-only `events` + booking FKs).
 * Requires migration: supabase/migrations/20260516130000_admin_hard_delete_venue.sql applied on the target DB.
 */
async function hardDeleteVenue(admin, venueId) {
  const { error } = await admin.rpc('admin_hard_delete_venue', { p_venue_id: venueId });
  if (error) {
    if (/function .* does not exist|Could not find the function/i.test(error.message)) {
      throw new Error(
        'Database function admin_hard_delete_venue is missing. In Supabase Dashboard → SQL Editor, run the SQL from:\n' +
          '  supabase/migrations/20260516130000_admin_hard_delete_venue.sql\n' +
          'Then re-run this script.',
      );
    }
    throw new Error(`admin_hard_delete_venue: ${error.message}`);
  }
}

async function findAuthUserId(admin, email) {
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const u = data?.users?.find((x) => (x.email ?? '').toLowerCase() === email);
    if (u?.id) return u.id;
    if (!data?.users?.length || data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function main() {
  if (!dryRun && !confirm) {
    console.error('Refusing to run without --dry-run or --confirm.');
    console.error('  node scripts/delete-user-and-venue.mjs --email=... --dry-run');
    console.error('  node scripts/delete-user-and-venue.mjs --email=... --confirm');
    process.exit(1);
  }

  const { url, key } = requireEnv();
  const admin = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Target email: ${EMAIL}`);
  console.log(`Supabase URL: ${url}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE DELETE'}`);

  const { data: staffRows, error: staffErr } = await admin
    .from('staff')
    .select('id, venue_id, role, name')
    .ilike('email', EMAIL);

  if (staffErr) {
    console.error('staff query failed:', staffErr);
    process.exit(1);
  }

  const venueIds = [...new Set((staffRows ?? []).map((s) => s.venue_id).filter(Boolean))];

  if (venueIds.length === 0) {
    console.log('No staff rows for this email — no venue data to remove.');
  } else {
    console.log(`Found ${staffRows?.length ?? 0} staff row(s) across ${venueIds.length} venue(s): ${venueIds.join(', ')}`);

    for (const venueId of venueIds) {
      const { data: venue, error: vErr } = await admin.from('venues').select('id, name, slug').eq('id', venueId).single();
      if (vErr) {
        console.error('venue lookup failed:', vErr);
        continue;
      }
      console.log(`\n--- Venue: ${venue?.name} (${venue?.slug}) [${venueId}] ---`);

      const staffIdsForVenue = (staffRows ?? []).filter((s) => s.venue_id === venueId).map((s) => s.id);
      console.log(`  Staff rows to clear FKs for: ${staffIdsForVenue.length}`);

      if (dryRun) {
        const { count: bookingCount } = await admin
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', venueId);
        console.log(`  Would call admin_hard_delete_venue() (~${bookingCount ?? '?'} bookings + events + venue).`);
        continue;
      }

      await hardDeleteVenue(admin, venueId);
      console.log('  Venue and related data deleted.');
    }
  }

  if (dryRun) {
    const authId = await findAuthUserId(admin, EMAIL);
    if (authId) console.log(`\n[DRY RUN] Would delete Auth user ${authId}`);
    else console.log('\n[DRY RUN] No Auth user with this email.');
    console.log('\nDry run complete. Re-run with --confirm to execute.');
    return;
  }

  const authUserId = await findAuthUserId(admin, EMAIL);
  if (!authUserId) {
    console.log('\nNo Supabase Auth user found for this email (already removed?).');
    return;
  }

  const { error: delAuthErr } = await admin.auth.admin.deleteUser(authUserId);
  if (delAuthErr) {
    console.error('Failed to delete Auth user:', delAuthErr);
    process.exit(1);
  }
  console.log(`\nDeleted Supabase Auth user ${authUserId}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
