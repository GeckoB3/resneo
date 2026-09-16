/**
 * WAIT-01 (D43, SB-33): a guest joins the waitlist from the collective page, and the entry is
 * filed at the member venue that can offer the time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/booking/light-plan-public-block', () => ({
  nextResponseIfPublicBookingBlockedForVenue: vi.fn(async () => null),
}));
vi.mock('@/lib/linked-accounts/collective-booking-bridge', () => ({ isCollectiveId: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-waitlist', () => ({ resolveCollectiveWaitlistTarget: vi.fn() }));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { isCollectiveId } from '@/lib/linked-accounts/collective-booking-bridge';
import { resolveCollectiveWaitlistTarget } from '@/lib/linked-accounts/collective-waitlist';
import { POST } from './route';

const COLLECTIVE = '11111111-1111-4111-8111-111111111111';
const OFFERING = '22222222-2222-4222-8222-222222222222';
const CALENDAR = '33333333-3333-4333-8333-333333333333';

let calls: RecordedCall[] = [];
beforeEach(() => {
  vi.mocked(resolveCollectiveWaitlistTarget).mockReset();
  const recording = makeRecordingDb((call) => {
    if (call.table === 'venues') return { data: { feature_flags: { waitlist_v2: true } } };
    if (call.table === 'service_items') return { data: { id: 'zen-cut' } };
    if (call.table === 'waitlist_entries' && call.op === 'insert') return { data: { id: 'w-1', status: 'waiting' } };
    if (call.table === 'waitlist_entries') return { data: null, count: 0 };
    return undefined;
  });
  calls = recording.calls;
  vi.mocked(getSupabaseAdminClient).mockReturnValue(recording.db as unknown as SupabaseClient);
  vi.mocked(isCollectiveId).mockResolvedValue(true);
});

const join = (extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest('http://test/api/booking/appointment-waitlist', {
      method: 'POST',
      body: JSON.stringify({
        venue_id: COLLECTIVE,
        service_id: OFFERING,
        desired_date: '2031-03-04',
        preferred_window: 'all_day',
        first_name: 'Sam',
        last_name: 'Guest',
        guest_email: 'sam@x.test',
        guest_phone: '02071234567',
        ...extra,
      }),
    }),
  );

const inserted = () => calls.find((c) => c.table === 'waitlist_entries' && c.op === 'insert');

describe('POST /api/booking/appointment-waitlist on the collective page', () => {
  it("files the entry at the chosen person's venue, on its own service", async () => {
    vi.mocked(resolveCollectiveWaitlistTarget).mockResolvedValue({
      ok: true,
      venueId: 'zen',
      serviceId: 'zen-cut',
      calendarId: CALENDAR,
    });
    const response = await join({ practitioner_id: CALENDAR });
    expect(response.status).toBeLessThan(300);
    expect(vi.mocked(resolveCollectiveWaitlistTarget).mock.calls[0]![1]).toEqual({
      collectiveId: COLLECTIVE,
      offeringId: OFFERING,
      calendarId: CALENDAR,
    });
    expect(inserted()?.payload).toMatchObject({ venue_id: 'zen', service_item_id: 'zen-cut', practitioner_id: CALENDAR });
  });

  it('passes on why the waitlist is not open, writing nothing', async () => {
    vi.mocked(resolveCollectiveWaitlistTarget).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'The waitlist is not open for this service.',
    });
    const response = await join();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('The waitlist is not open for this service.');
    expect(inserted()).toBeUndefined();
  });

  it('leaves a venue page unchanged', async () => {
    vi.mocked(isCollectiveId).mockResolvedValue(false);
    await join();
    expect(resolveCollectiveWaitlistTarget).not.toHaveBeenCalled();
    expect(inserted()?.payload).toMatchObject({ venue_id: COLLECTIVE, service_item_id: OFFERING });
  });
});
