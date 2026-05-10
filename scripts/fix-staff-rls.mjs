/**
 * Fix the circular RLS policy on the staff table.
 *
 * Migration 20260302000002 dropped staff_select_own and replaced it with
 * staff_select_venue_staff which subqueries itself - creating a circular
 * dependency that blocks ALL queries. This script restores staff_select_own
 * so staff can see their own rows by email, breaking the cycle.
 *
 * Usage:  node scripts/fix-staff-rls.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually (no dotenv dependency)
const envPath = resolve(process.cwd(), '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.error('Could not read .env.local - make sure it exists in the project root.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function run() {
  console.log('Checking current staff RLS policies...\n');

  const { data: policies, error: polErr } = await supabase
    .rpc('exec_sql', {
      query: `SELECT policyname, qual FROM pg_policies WHERE tablename = 'staff' AND schemaname = 'public'`
    });

  // If exec_sql doesn't exist, fall back to direct SQL via REST
  if (polErr) {
    console.log('(Could not list policies via RPC - proceeding with fix anyway)\n');
  } else {
    console.log('Current policies on staff table:');
    for (const p of policies ?? []) {
      console.log(`  - ${p.policyname}`);
    }
    const hasOwn = (policies ?? []).some(p => p.policyname === 'staff_select_own');
    if (hasOwn) {
      console.log('\n✓ staff_select_own already exists. No fix needed.');
      await verifyAccess();
      return;
    }
    console.log('\n✗ staff_select_own is MISSING - this causes the circular RLS issue.');
  }

  console.log('\nApplying fix: CREATE POLICY staff_select_own ...');

  const fixSql = `
    CREATE POLICY IF NOT EXISTS "staff_select_own"
      ON staff FOR SELECT
      USING (email = (auth.jwt() ->> 'email'));
  `;

  // Use the Supabase SQL endpoint via fetch since the JS client doesn't expose raw SQL
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ query: fixSql }),
  });

  if (!res.ok) {
    // exec_sql RPC may not exist; try the management API approach
    console.log('RPC not available. Trying direct pg_query approach...');

    // Fall back: use the Supabase management SQL endpoint
    await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });

    console.error('\n═══════════════════════════════════════════════════════════════');
    console.error('  COULD NOT AUTO-APPLY THE FIX.');
    console.error('  Please run this SQL manually in your Supabase SQL Editor:');
    console.error('═══════════════════════════════════════════════════════════════\n');
    console.error(`  CREATE POLICY "staff_select_own"`);
    console.error(`    ON staff FOR SELECT`);
    console.error(`    USING (email = (auth.jwt() ->> 'email'));`);
    console.error('\n═══════════════════════════════════════════════════════════════');
    console.error('  Go to: Supabase Dashboard → SQL Editor → New query → paste → Run');
    console.error('═══════════════════════════════════════════════════════════════\n');
    process.exit(1);
  }

  console.log('✓ Policy created successfully!\n');
  await verifyAccess();
}

async function verifyAccess() {
  console.log('Verifying staff data is accessible...');
  const { data, error } = await supabase.from('staff').select('id, email, venue_id, role').limit(5);
  if (error) {
    console.error('  ✗ Staff query failed:', error.message);
  } else {
    console.log(`  ✓ Found ${data?.length ?? 0} staff row(s):`);
    for (const row of data ?? []) {
      console.log(`    - ${row.email} → venue ${row.venue_id} (${row.role})`);
    }
  }

  const { data: venues, error: vErr } = await supabase.from('venues').select('id, name, slug').limit(5);
  if (vErr) {
    console.error('  ✗ Venues query failed:', vErr.message);
  } else {
    console.log(`  ✓ Found ${venues?.length ?? 0} venue(s):`);
    for (const v of venues ?? []) {
      console.log(`    - ${v.name} (${v.slug}) → ${v.id}`);
    }
  }
  console.log('\nDone.');
}

run().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
