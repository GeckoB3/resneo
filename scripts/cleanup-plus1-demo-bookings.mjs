/**
 * Reversal for seed-plus1-demo-bookings.mjs: deletes every booking and guest
 * tagged source='seed_demo' for the Plus 1 venue.
 *   ALLOW_SEED=1 node scripts/cleanup-plus1-demo-bookings.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const rootDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(rootDir, '..', '.env.local') });
if (process.env.ALLOW_SEED !== '1') { console.error('Set ALLOW_SEED=1 to run.'); process.exit(1); }

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const VENUE_ID = 'c6eb0e01-ae6b-4842-80f7-002619b1f4b5';

const { data: guests } = await admin.from('guests').select('id').eq('venue_id', VENUE_ID).eq('source', 'seed_demo');
const ids = (guests ?? []).map((g) => g.id);
console.log(`Found ${ids.length} seed_demo guests.`);
if (ids.length === 0) process.exit(0);

const { count: bCount } = await admin.from('bookings').select('id', { count: 'exact', head: true }).eq('venue_id', VENUE_ID).in('guest_id', ids);
console.log(`Deleting ${bCount} bookings for those guests...`);

// delete in chunks to stay under URL length limits
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
for (const part of chunk(ids, 50)) {
  const { error: be } = await admin.from('bookings').delete().eq('venue_id', VENUE_ID).in('guest_id', part);
  if (be) { console.error('booking delete error', be); process.exit(1); }
}
for (const part of chunk(ids, 50)) {
  const { error: ge } = await admin.from('guests').delete().eq('venue_id', VENUE_ID).in('id', part);
  if (ge) { console.error('guest delete error', ge); process.exit(1); }
}
console.log('Cleanup complete.');
