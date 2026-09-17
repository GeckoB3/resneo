/** D32: guest sign-in on the collective page follows the host on shared services. */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import { bookingRequiresSignIn, hostSignInRequirement } from './collective-sign-in';

function db(serviceModel: string, hostRequires: boolean) {
  return makeRecordingDb((call) => {
    if (call.table === 'venue_collectives') return { data: { host_venue_id: 'host', service_model: serviceModel } };
    if (call.table === 'venues') return { data: { require_account_login_for_bookings: hostRequires } };
    return undefined;
  }).db as unknown as SupabaseClient;
}

describe('guest sign-in on a collective page', () => {
  it('follows the host alone on shared services, whatever the owning venue says', async () => {
    expect(await bookingRequiresSignIn(db('replicas', false), 'col-1', true)).toBe(false);
    expect(await bookingRequiresSignIn(db('replicas', true), 'col-1', false)).toBe(true);
    expect(await hostSignInRequirement(db('replicas', true), 'col-1')).toBe(true);
  });

  it('keeps the owning venue rule on the older model and outside a collective', async () => {
    expect(await hostSignInRequirement(db('legacy_copies', true), 'col-1')).toBeNull();
    expect(await bookingRequiresSignIn(db('legacy_copies', false), 'col-1', true)).toBe(true);
    expect(await bookingRequiresSignIn(db('replicas', true), null, false)).toBe(false);
  });
});
