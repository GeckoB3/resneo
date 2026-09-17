/**
 * Who can be invited to a new collective (UX spec J1 step 2): every linked venue, with its
 * standing and the reason it cannot join.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/queries', () => ({ loadLinkViewsForVenue: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-venue-locks', () => ({
  findCollectiveLockForVenue: vi.fn(async (_admin: unknown, venueId: string) =>
    venueId === 'taken' ? { collectiveId: 'other', collectiveName: 'Southside', hostVenueId: 'x' } : null,
  ),
}));

import { loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';
import { loadCollectiveCandidates } from './collective-candidates';

const full = { calendar: 'full_details', pii: true, act: 'create_edit_cancel', calendarIds: null };
const link = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id: `link-${id}`,
  status: 'accepted',
  otherVenue: { id, name, slug: id },
  iCan: full,
  theyCan: full,
  ...overrides,
});

const venue = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  slug: id,
  timezone: 'Europe/London',
  currency: 'GBP',
  stripe_charges_enabled: true,
  pricing_tier: 'appointments',
  plan_status: 'active',
  booking_model: 'unified_scheduling',
  enabled_models: [],
  active_booking_models: ['unified_scheduling'],
  subscription_current_period_end: null,
  billing_access_source: null,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(loadLinkViewsForVenue).mockResolvedValue([
    link('ok', 'Bloom'),
    link('nopay', 'Cedar'),
    link('taken', 'Elm'),
    link('eur', 'Dublin Spa'),
    link('tz', 'Lisbon'),
    link('classes', 'Studio K'),
    link('narrow', 'Fern', { theyCan: { ...full, calendarIds: ['cal-1'] } }),
    link('ended', 'Gone', { status: 'revoked' }),
  ] as never);
});

describe('loadCollectiveCandidates', () => {
  it('gives every linked venue its standing, ready to join first', async () => {
    const { db } = makeRecordingDb((call) =>
      call.table === 'venues'
        ? {
            data: [
              venue('host', 'Zen Studio'),
              venue('ok', 'Bloom'),
              venue('nopay', 'Cedar', { stripe_charges_enabled: false }),
              venue('taken', 'Elm'),
              venue('eur', 'Dublin Spa', { currency: 'EUR' }),
              venue('tz', 'Lisbon', { timezone: 'Europe/Lisbon' }),
              venue('classes', 'Studio K', { active_booking_models: ['class_session'], booking_model: 'class_session' }),
              venue('narrow', 'Fern'),
            ],
          }
        : undefined,
    );
    const result = await loadCollectiveCandidates(db as unknown as SupabaseClient, 'host');
    expect(result.map((c) => [c.venue_name, c.standing, c.reason])).toEqual([
      ['Bloom', 'ok', null],
      ['Cedar', 'no_payments', expect.stringContaining('Cedar has not connected Stripe')],
      ['Dublin Spa', 'blocked', 'Uses EUR, not GBP'],
      ['Elm', 'blocked', 'Already part of another collective'],
      ['Lisbon', 'blocked', 'In Europe/Lisbon, not Europe/London'],
      ['Studio K', 'blocked', expect.stringContaining('does not offer appointments')],
      ['Fern', 'permissions', 'Your link with Fern does not share full calendar details yet.'],
    ]);
    expect(result.find((c) => c.venue_name === 'Dublin Spa')?.detail).toContain('takes payment in EUR');
    expect(result.find((c) => c.venue_name === 'Bloom')?.venue_slug).toBe('ok');
  });
});
