/**
 * WAIT-01 (D43): which venue a collective waitlist entry belongs to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/collective-venue', () => ({ loadCollectiveAppointmentCatalog: vi.fn() }));

import { loadCollectiveAppointmentCatalog } from '@/lib/linked-accounts/collective-venue';
import { resolveCollectiveWaitlistTarget } from './collective-waitlist';

const cal = (id: string, venue: string, source: string) => ({
  id,
  name: id,
  owning_venue_id: venue,
  owning_venue_name: venue,
  owning_venue_address: '',
  services: [{ id: 'offer-cut', source_service_id: source }],
});

const db = (waitlist: Record<string, boolean>) =>
  makeRecordingDb((call) =>
    call.table === 'venues'
      ? {
          data: Object.entries(waitlist).map(([id, on]) => ({
            id,
            name: id === 'host' ? 'Host Venue' : 'Zen Studio',
            feature_flags: { waitlist_v2: on },
          })),
        }
      : undefined,
  ).db as unknown as SupabaseClient;

beforeEach(() => {
  vi.mocked(loadCollectiveAppointmentCatalog).mockResolvedValue({
    practitioners: [cal('host-1', 'host', 'master-cut'), cal('zen-1', 'zen', 'zen-cut'), cal('zen-2', 'zen', 'zen-cut')],
  } as never);
});

const resolve = (waitlist: Record<string, boolean>, calendarId: string | null) =>
  resolveCollectiveWaitlistTarget(db(waitlist), { collectiveId: 'col-1', offeringId: 'offer-cut', calendarId });

describe('resolveCollectiveWaitlistTarget', () => {
  it("files a chosen person's wait at that person's venue", async () => {
    expect(await resolve({ host: true, zen: true }, 'host-1')).toEqual({
      ok: true,
      venueId: 'host',
      serviceId: 'master-cut',
      calendarId: 'host-1',
    });
  });

  it('files "no preference" at the venue with the most calendars offering it', async () => {
    expect(await resolve({ host: true, zen: true }, null)).toEqual({
      ok: true,
      venueId: 'zen',
      serviceId: 'zen-cut',
      calendarId: null,
    });
  });

  it('skips venues without a waitlist, and says so when none has one', async () => {
    expect(await resolve({ host: true, zen: false }, null)).toMatchObject({ ok: true, venueId: 'host' });
    expect(await resolve({ host: true, zen: false }, 'zen-1')).toMatchObject({ ok: false, status: 409 });
    expect(await resolve({ host: false, zen: false }, null)).toMatchObject({ ok: false, status: 409 });
  });

  it('refuses a service or person not on the page', async () => {
    expect(await resolve({ host: true, zen: true }, 'nobody')).toMatchObject({ ok: false, status: 400 });
    vi.mocked(loadCollectiveAppointmentCatalog).mockResolvedValue({ practitioners: [] } as never);
    expect(await resolve({ host: true }, null)).toMatchObject({ ok: false, status: 400 });
  });
});
