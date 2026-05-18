/**
 * Hard-delete a venue with linked-account partner notifications (§6.6).
 *
 * Usage:
 *   npx tsx scripts/hard-delete-venue.ts --venue-id=<uuid> --dry-run
 *   npx tsx scripts/hard-delete-venue.ts --venue-id=<uuid> --confirm
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { hardDeleteVenueWithLinkedAccountNotifications } from '../src/lib/linked-accounts/venue-deletion';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config();

const args = process.argv.slice(2);
const venueId = args.find((a) => a.startsWith('--venue-id='))?.split('=')[1]?.trim();
const dryRun = args.includes('--dry-run');
const confirm = args.includes('--confirm');

async function main() {
  if (!venueId) {
    console.error('Usage: npx tsx scripts/hard-delete-venue.ts --venue-id=<uuid> --dry-run|--confirm');
    process.exit(1);
  }
  if (!dryRun && !confirm) {
    console.error('Refusing to run without --dry-run or --confirm.');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: venue } = await admin.from('venues').select('id, name, slug').eq('id', venueId).maybeSingle();
  if (!venue) {
    console.error('Venue not found:', venueId);
    process.exit(1);
  }

  console.log(`Venue: ${venue.name} (${venue.slug}) [${venueId}]`);

  if (dryRun) {
    const { data: links } = await admin
      .from('account_links')
      .select('id, status')
      .or(`venue_low_id.eq.${venueId},venue_high_id.eq.${venueId}`)
      .in('status', ['pending', 'accepted', 'suspended']);
    console.log(`[DRY RUN] Would terminate ${links?.length ?? 0} live link(s), notify partners, then hard-delete.`);
    return;
  }

  const { partners } = await hardDeleteVenueWithLinkedAccountNotifications(admin, venueId);
  console.log(`Deleted. Terminated ${partners.length} link(s); notified ${new Set(partners.map((p) => p.survivor_venue_id)).size} survivor venue(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
