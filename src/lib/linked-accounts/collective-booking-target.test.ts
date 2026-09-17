/**
 * D33 and §6.6: who may book a calendar on the collective, and in what words a refusal comes.
 * Staff book every calendar their form lists except a venue still catching up with the host;
 * guests book only what the page shows, and are asked to choose again when a copy falls behind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./collective-venue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./collective-venue')>()),
  loadCollectiveAppointmentCatalog: vi.fn(),
}));

import { loadCollectiveAppointmentCatalog } from './collective-venue';
import { resolveCollectiveBookingTarget } from './collective-booking-bridge';

const admin = {} as SupabaseClient;
const params = { collectiveId: 'col-1', offeringId: 'offer-cut', calendarId: 'cal-1' };

function catalogueWith(exclusion?: 'behind' | 'payments' | 'staff_only') {
  vi.mocked(loadCollectiveAppointmentCatalog).mockResolvedValue({
    categories: [],
    practitioners: [
      {
        id: 'cal-1',
        name: 'Ada',
        owning_venue_id: 'member',
        owning_venue_name: 'Zen Studio',
        owning_venue_address: '',
        services: [
          {
            id: 'offer-cut',
            source_service_id: 'replica-cut',
            price_pence: 2500,
            duration_minutes: 60,
            ...(exclusion ? { staff_exclusion: exclusion, staff_note: 'note' } : {}),
          },
        ],
      },
    ],
  } as never);
}

beforeEach(() => vi.clearAllMocks());

describe('resolveCollectiveBookingTarget', () => {
  it('books a listed calendar for anyone', async () => {
    catalogueWith();
    for (const audience of ['public', 'staff'] as const) {
      expect(await resolveCollectiveBookingTarget(admin, params, audience)).toEqual({
        ok: true,
        target: { venueId: 'member', sourceServiceId: 'replica-cut', pricePence: 2500, durationMinutes: 60 },
      });
    }
  });

  it('lets staff book what guests cannot, and not guests', async () => {
    for (const reason of ['payments', 'staff_only'] as const) {
      catalogueWith(reason);
      expect((await resolveCollectiveBookingTarget(admin, params, 'staff')).ok).toBe(true);
      expect(await resolveCollectiveBookingTarget(admin, params, 'public')).toEqual({
        ok: false,
        code: null,
        error: 'This booking option is no longer available.',
      });
    }
  });

  it('refuses a venue still catching up, in the decided words for each audience', async () => {
    catalogueWith('behind');
    expect(await resolveCollectiveBookingTarget(admin, params, 'staff')).toEqual({
      ok: false,
      code: 'COLLECTIVE_SERVICE_UPDATING',
      error: 'This service is being updated at Zen Studio. Please try again in a moment.',
    });
    expect(await resolveCollectiveBookingTarget(admin, params, 'public')).toEqual({
      ok: false,
      code: 'COLLECTIVE_SERVICE_UPDATING',
      error: 'This service has just been updated. Please choose your time again.',
    });
  });

  it('refuses a calendar or service that is not on the page', async () => {
    catalogueWith();
    const missing = await resolveCollectiveBookingTarget(admin, { ...params, calendarId: 'cal-9' }, 'staff');
    expect(missing).toMatchObject({ ok: false, code: null });
  });
});
