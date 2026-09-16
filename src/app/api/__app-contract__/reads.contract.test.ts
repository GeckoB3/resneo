/**
 * APP-03 (W12): the reads the ResNeo app relies on, and its diary routing, for old builds.
 *
 * The app (Resneo-app cbc0975, 1.0.0) opens the collective booking form from a diary column when
 * `GET /api/venue/staff-collective` names the column's venue and calendar
 * (`lib/linked/collective-booking-target.ts:21-30`, copied below verbatim). Since D2's revision every
 * column opens the collective form, own ones included, so `calendar_ids` must carry the caller's own
 * calendars. The app sends no `X-ResNeo-Client` header, and a missing header is permitted for good.
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import { API_ERROR_CODES } from '@/lib/api/error-codes';
import { COLLECTIVE_PREFIXED_CODES, COLLECTIVE_SQLSTATE_CODES } from '@/lib/linked-accounts/replicas/db-errors';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { GET } from '../venue/staff-collective/route';

const HOST = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const COLLECTIVE = '33333333-3333-4333-8333-333333333333';

/** The app's `collectiveBookingTargetFor`, as shipped. */
type AppStaffCollective = { id: string; name: string; member_venue_ids: string[]; calendar_ids: string[] } | null;
function collectiveBookingTargetFor(
  collective: AppStaffCollective,
  columnVenueId: string | null,
  calendarId: string | null,
): { id: string; name: string } | null {
  if (!collective || !columnVenueId) return null;
  if (!collective.member_venue_ids.includes(columnVenueId)) return null;
  if (calendarId && !collective.calendar_ids.includes(calendarId)) return null;
  return { id: collective.id, name: collective.name };
}

function signIn(venueId: string) {
  const db = makeRecordingDb((call) => {
    if (call.table === 'venue_collective_members' && call.columns === 'collective_id') {
      return { data: [{ collective_id: COLLECTIVE }] };
    }
    if (call.table === 'venue_collective_members') return { data: [{ venue_id: HOST }, { venue_id: MEMBER }] };
    if (call.table === 'venue_collectives') {
      return { data: { id: COLLECTIVE, name: 'Northside', status: 'active', page_mode: 'unified_catalog', host_venue_id: HOST } };
    }
    if (call.table === 'venues') {
      return {
        data: [HOST, MEMBER].map((id) => ({
          id,
          pricing_tier: 'appointments',
          plan_status: 'active',
          booking_model: 'unified_scheduling',
          subscription_current_period_end: null,
          billing_access_source: null,
        })),
      };
    }
    if (call.table === 'unified_calendars') {
      return { data: [{ id: 'host-cal' }, { id: 'member-cal' }] };
    }
    return undefined;
  });
  vi.mocked(getSupabaseAdminClient).mockReturnValue(db.db as unknown as SupabaseClient);
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: venueId, email: 'a@b.c', role: 'staff', db: db.db } as never);
  return db;
}

describe('APP-03: diary routing for old app builds', () => {
  it('opens the collective form from every column, own ones included, with no client header', async () => {
    const db = signIn(MEMBER);
    // The app's request: Bearer auth, JSON accept, no X-ResNeo-Client.
    const res = await GET(
      new NextRequest('https://resneo.test/api/venue/staff-collective', {
        headers: { Accept: 'application/json', Authorization: 'Bearer token' },
      }),
    );
    expect(res.status).toBe(200);
    const { collective } = (await res.json()) as { collective: AppStaffCollective & { host_venue_id: string } };
    expect(collective).toMatchObject({ id: COLLECTIVE, name: 'Northside', member_venue_ids: [HOST, MEMBER] });

    // The calendars are every member's, the caller's own included.
    const calendarRead = db.calls.find((c) => c.table === 'unified_calendars')!;
    expect(calendarRead.filters).toContainEqual(['in', 'venue_id', [HOST, MEMBER]]);
    expect(collectiveBookingTargetFor(collective, MEMBER, 'member-cal')).toEqual({ id: COLLECTIVE, name: 'Northside' });
    expect(collectiveBookingTargetFor(collective, HOST, 'host-cal')).toEqual({ id: COLLECTIVE, name: 'Northside' });
    expect(collectiveBookingTargetFor(collective, 'outsider', 'x')).toBeNull();
  });
});

describe('APP-03: error codes the app may meet', () => {
  it('registers every collective code in the shared list', () => {
    const codes = new Set<string>(API_ERROR_CODES);
    for (const code of [...Object.values(COLLECTIVE_SQLSTATE_CODES), ...COLLECTIVE_PREFIXED_CODES]) {
      expect(codes.has(code), code).toBe(true);
    }
    for (const code of [
      'COLLECTIVE_REPLICAS_ALWAYS_FOLLOW',
      'COLLECTIVE_HEADINGS_FOLLOW_SERVICES',
      'COLLECTIVE_CONSENT_REQUIRED',
      'STALE_RESOURCE',
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });
});
