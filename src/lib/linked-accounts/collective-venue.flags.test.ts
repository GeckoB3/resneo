/**
 * WAIT-01 and D32/D43: the collective page publishes the host's full resolved flag set, so its
 * waitlist, self-reschedule and "Any available" order work as they do on the host's own page.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/catalogue', () => ({
  loadPublicCombinedCatalogue: vi.fn(async () => null),
}));

import { loadCollectiveVenuePublic } from './collective-venue';

describe('loadCollectiveVenuePublic feature flags', () => {
  it("carries the host's waitlist, self-reschedule, any-available and order", async () => {
    const db = makeRecordingDb((call) => {
      if (call.table === 'venue_collectives') {
        return {
          data: {
            id: 'col-1',
            name: 'Northside',
            slug: 'northside',
            status: 'active',
            timezone: 'Europe/London',
            branding: {},
            booking_page_config: {},
            host_venue_id: 'host',
          },
        };
      }
      if (call.table === 'venues') {
        return {
          data: {
            name: 'Host Venue',
            currency: 'GBP',
            feature_flags: {
              waitlist_v2: true,
              guest_self_reschedule: true,
              any_available_practitioner: true,
              any_available_practitioner_config: { mode: 'random', calendar_order: ['aaaaaaaa-0000-4000-8000-000000000001'] },
            },
          },
        };
      }
      return undefined;
    }).db as unknown as SupabaseClient;

    const venue = await loadCollectiveVenuePublic(db, 'col-1', { audience: 'staff' });
    expect(venue?.feature_flags?.resolved).toMatchObject({
      waitlist_v2: true,
      guest_self_reschedule: true,
      any_available_practitioner: true,
    });
    expect(venue?.feature_flags?.any_available_practitioner_config).toEqual({
      mode: 'random',
      calendar_order: ['aaaaaaaa-0000-4000-8000-000000000001'],
    });
  });
});
