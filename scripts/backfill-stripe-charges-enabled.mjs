/**
 * Fill `venues.stripe_charges_enabled` from Stripe for every venue with a connected account
 * (migration 20270213120000; Docs/collective-one-venue-plan.md W1a, RT2-15).
 *
 * The `account.updated` webhook and the Settings status read keep the column current from now
 * on, but existing venues start NULL (unknown). Run this once per environment after the
 * migration is applied, and before any rule that hides a venue's paid services ships (Pass A
 * go condition).
 *
 * Dry run by default: prints what it would write. Pass --apply to write.
 * Re-runnable: it asks Stripe again for every venue each time.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and STRIPE_SECRET_KEY, from the
 * environment or .env.local. Runs against whichever project and Stripe account those point at.
 *
 * Usage:
 *   node scripts/backfill-stripe-charges-enabled.mjs
 *   node scripts/backfill-stripe-charges-enabled.mjs --apply
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

const apply = process.argv.includes('--apply');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!url || !serviceKey || !stripeKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY or STRIPE_SECRET_KEY.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const stripe = new Stripe(stripeKey);

const { data: venues, error } = await admin
  .from('venues')
  .select('id, name, stripe_connected_account_id, stripe_charges_enabled')
  .not('stripe_connected_account_id', 'is', null)
  .order('name');
if (error) {
  console.error('Could not read venues:', error.message);
  process.exit(1);
}

const project = new URL(url).hostname.split('.')[0];
console.log(`${apply ? 'APPLY' : 'DRY RUN'} on project ${project}: ${venues.length} venue(s) with a connected account\n`);

let changed = 0;
let failed = 0;
for (const v of venues) {
  let next;
  try {
    const account = await stripe.accounts.retrieve(v.stripe_connected_account_id);
    next = account.charges_enabled === true;
  } catch (err) {
    failed += 1;
    console.log(`  ?  ${v.name} (${v.id}): Stripe read failed, left as ${v.stripe_charges_enabled}: ${err.message}`);
    continue;
  }
  if (next === v.stripe_charges_enabled) {
    console.log(`  =  ${v.name}: ${next}`);
    continue;
  }
  changed += 1;
  console.log(`  ${apply ? '✓' : '→'}  ${v.name}: ${v.stripe_charges_enabled} -> ${next}`);
  if (apply) {
    const { error: upErr } = await admin
      .from('venues')
      .update({ stripe_charges_enabled: next })
      .eq('id', v.id)
      .eq('stripe_connected_account_id', v.stripe_connected_account_id);
    if (upErr) {
      failed += 1;
      console.log(`     write failed: ${upErr.message}`);
    }
  }
}

console.log(`\n${changed} to change${apply ? ' (written)' : ''}, ${failed} failed.`);
if (!apply && changed > 0) console.log('Re-run with --apply to write.');
process.exit(failed > 0 ? 1 : 0);
