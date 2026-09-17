/**
 * APP-02 (W12): the ResNeo app's calendar toggles and its add-on group and form edits, against a
 * collective. The payloads are the app's own (Resneo-app cbc0975, 1.0.0):
 *   - `useToggleCalendarService`: PUT practitioner-services `{ practitioner_id, service_ids }`, the
 *     whole set, never `expected_service_ids`;
 *   - `AddonGroupEditorSheet`: PATCH addon-groups/{id} `{ group }`;
 *   - `ComplianceTypeEditorSheet`: PATCH compliance/types/{id}.
 * The one-tap accept (409 COLLECTIVE_CONSENT_REQUIRED) and leave are pinned in
 * `collectives/[id]/members/route.test.ts`; the seven per-calendar values in
 * `practitioner-service-overrides/route.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/venue-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/venue-auth')>()),
  getVenueStaff: vi.fn(),
}));
vi.mock('@/lib/booking/uses-unified-appointment-data', () => ({
  venueUsesUnifiedAppointmentServiceData: vi.fn(async () => true),
}));
vi.mock('@/lib/venue/service-calendar-removal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/venue/service-calendar-removal')>()),
  findBookingsAffectedByRemovingServicesUnified: vi.fn(async () => ({ total: 0, error: null })),
}));
vi.mock('@/lib/venue/calendar-service-assignment-writes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/venue/calendar-service-assignment-writes')>()),
  setCalendarServiceAssignments: vi.fn(async () => ({ ok: true, added: [], removed: ['svc-host-gave'] })),
}));
vi.mock('@/lib/compliance/auth', () => ({ requireCompliancePlan: vi.fn(async () => ({ ok: true })) }));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { setCalendarServiceAssignments } from '@/lib/venue/calendar-service-assignment-writes';
import { PUT as putCalendarServices } from '../venue/practitioner-services/route';
import { PATCH as patchAddonGroup } from '../venue/addon-groups/[id]/route';
import { PATCH as patchComplianceType } from '../venue/compliance/types/[id]/route';

const MEMBER = 'venue-member';
const HOST = 'venue-host';
const CAL = '11111111-1111-4111-8111-11111111111a';
const KEPT = '22222222-2222-4222-8222-22222222222a';
const GAVE = '22222222-2222-4222-8222-22222222222b';

function signIn(responder: Responder) {
  const rec = makeRecordingDb((call) => {
    const injected = responder(call);
    if (injected) return injected;
    if (call.table === 'venue_collectives') return { data: { name: 'Northside', host_venue_id: HOST, status: 'active' } };
    if (call.table === 'venues') return { data: { name: 'Host Venue' } };
    return undefined;
  });
  vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as unknown as SupabaseClient);
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 'admin-1', venue_id: MEMBER, email: 'a@b.c', role: 'admin', db: rec.db } as never);
  return rec;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('APP-02: the app toggling a service on a calendar', () => {
  const stored = (gaveAt: string, by: string) => (call: { table: string }) => {
    if (call.table === 'unified_calendars') return { data: { id: CAL } };
    if (call.table === 'calendar_service_assignments') {
      return {
        data: [
          { service_item_id: KEPT, updated_at: '2026-01-01T00:00:00Z', updated_by_venue_id: MEMBER },
          { service_item_id: GAVE, updated_at: gaveAt, updated_by_venue_id: by },
        ],
      };
    }
    return undefined;
  };
  const toggle = () =>
    putCalendarServices(
      new NextRequest('http://localhost/api/venue/practitioner-services', {
        method: 'PUT',
        body: JSON.stringify({ practitioner_id: CAL, service_ids: [KEPT] }),
      }),
    );

  it('answers 412 when the whole set would drop a service the host gave this calendar today', async () => {
    signIn(stored(new Date(Date.now() - 60 * 60 * 1000).toISOString(), HOST));
    const res = await toggle();
    expect(res.status).toBe(412);
    expect((await res.json()).code).toBe('STALE_RESOURCE');
    expect(vi.mocked(setCalendarServiceAssignments)).not.toHaveBeenCalled();
  });

  it('saves when the dropped service was the venue own choice, or long ago', async () => {
    signIn(stored(new Date(Date.now() - 60 * 60 * 1000).toISOString(), MEMBER));
    expect((await toggle()).status).toBe(200);
    signIn(stored('2026-01-01T00:00:00Z', HOST));
    expect((await toggle()).status).toBe(200);
  });
});

describe("APP-02: the app editing a host's add-on group or form, as a member", () => {
  const managed = (table: string) => (call: { table: string; columns?: string }) => {
    if (call.table === table && call.columns === 'managed_by_collective_id') return { data: { managed_by_collective_id: 'col-1' } };
    if (call.table === table) return { data: { id: 'g-1', venue_id: MEMBER, is_active: true } };
    return undefined;
  };

  it('refuses the add-on group edit with a readable 409, writing nothing', async () => {
    const rec = signIn(managed('addon_groups'));
    const res = await patchAddonGroup(
      new NextRequest('http://localhost/api/venue/addon-groups/g-1', {
        method: 'PATCH',
        body: JSON.stringify({
          group: {
            name: 'Extras',
            prompt_to_client: null,
            description: null,
            selection_type: 'single',
            min_select: 0,
            max_select: 1,
            hidden_from_online: false,
            is_active: true,
            sort_order: 0,
            addons: [
              {
                name: 'Toner',
                description: null,
                additional_price_pence: 500,
                additional_duration_minutes: 10,
                cost_to_business_pence: null,
                is_active: true,
                sort_order: 0,
              },
            ],
          },
        }),
      }),
      { params: Promise.resolve({ id: 'g-1' }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('COLLECTIVE_MANAGED_ADDON_GROUP');
    expect(body.error).toBe('This add-on group is managed by Host Venue for Northside. Ask Host Venue to change it.');
    expect(rec.calls.some((c) => c.op !== 'select')).toBe(false);
  });

  it('refuses the form edit with a readable 409, writing nothing', async () => {
    const rec = signIn(managed('compliance_types'));
    const res = await patchComplianceType(
      new NextRequest('http://localhost/api/venue/compliance/types/t-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Patch test', description: null }),
      }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('COLLECTIVE_MANAGED_COMPLIANCE_TYPE');
    expect(body.error).toMatch(/managed by Host Venue for Northside/);
    expect(rec.calls.some((c) => c.op !== 'select')).toBe(false);
  });

  it('lets the venue edit its own group', async () => {
    signIn((call) => {
      if (call.table === 'addon_groups') return { data: { id: 'g-1', venue_id: MEMBER, managed_by_collective_id: null } };
      return undefined;
    });
    const res = await patchAddonGroup(
      new NextRequest('http://localhost/api/venue/addon-groups/g-1', {
        method: 'PATCH',
        body: JSON.stringify({ group: { name: 'Mine', selection_type: 'single', min_select: 0, max_select: 1, addons: [] } }),
      }),
      { params: Promise.resolve({ id: 'g-1' }) },
    );
    expect(res.status).not.toBe(409);
  });
});
