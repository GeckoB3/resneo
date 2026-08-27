import { test as teardown } from '@playwright/test';
import { rmSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { AUTH_STATE_DIR } from './helpers/auth-state';
import { getPortalCustomerEmail } from './helpers/account-session';

/**
 * Run teardown (P0-1d).
 *
 * Two jobs, and it is careful about which is which.
 *
 * 1. DELETE THE SAVED SESSION. `e2e/.auth/` holds a live session cookie for a
 *    real user on the staging project. It is gitignored, but a file that only
 *    survives by being gitignored is one `git add -f` or one CI artifact upload
 *    away from being published. Removing it is the cheap half of not leaking a
 *    credential.
 *
 * 2. REPORT ACCUMULATED FIXTURE BOOKINGS, and do not delete them. The smoke
 *    specs book real slots through the UI on the fixture venues, and those rows
 *    stay. That is how 53 of them once built up and consumed every remaining
 *    August slot, which surfaced as availability specs failing for reasons that
 *    had nothing to do with availability. `scripts/seed-e2e-smoke-venue.mjs`
 *    now wipes them at the START of a run, which is the right place: deleting
 *    here would destroy the evidence for anyone debugging a failed run, and a
 *    teardown that deletes data is one bad predicate away from deleting the
 *    fixture itself.
 *
 * So this counts and warns. The number appearing in the log is what makes the
 * accumulation visible instead of silent.
 */

const WARN_ABOVE = 25;

teardown('clean up the run', async () => {
  rmSync(AUTH_STATE_DIR, { recursive: true, force: true });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  const venueSlug = process.env.E2E_VENUE_SLUG?.trim();
  if (!url || !secret || !venueSlug) return;

  try {
    const admin = createClient(url, secret, { auth: { persistSession: false } });
    const { data: venue } = await admin
      .from('venues')
      .select('id')
      .eq('slug', venueSlug)
      .maybeSingle();
    const venueId = (venue as { id?: string } | null)?.id;
    if (!venueId) return;

    const { count } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId);

    const total = count ?? 0;
    const fixtureCustomer = getPortalCustomerEmail() || '(portal customer not configured)';
    console.log(`[e2e] ${total} booking(s) remain on the fixture venue ${venueSlug}.`);
    if (total > WARN_ABOVE) {
      console.warn(
        `[e2e] That is above ${WARN_ABOVE}. The smoke specs book real slots and the rows persist, ` +
          'which eventually exhausts the venue’s availability and makes unrelated specs fail. ' +
          'Re-run node scripts/seed-e2e-smoke-venue.mjs, which wipes them. ' +
          `Portal fixture customer: ${fixtureCustomer}.`,
      );
    }
  } catch (err) {
    // Teardown must never fail a run that passed. A count that could not be
    // read is a missing warning, not a broken suite.
    console.warn('[e2e] booking count check skipped:', err);
  }
});
