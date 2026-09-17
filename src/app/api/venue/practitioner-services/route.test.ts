/**
 * CSA-01 and CSA-02 for the calendar-side writer (collective plan W2; PB-03, PB-04, PB-08).
 * The route used to delete every assignment for the calendar and re-insert the posted set, so a
 * dialog opened before someone else's change undid it, and ids and custom values churned.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireManagedCalendarAccess: vi.fn(async () => ({ ok: true, managedCalendarIds: [] })),
  requireManagedCalendarIds: vi.fn(async () => ({ ok: true, managedCalendarIds: [] })),
}));
vi.mock('@/lib/booking/uses-unified-appointment-data', () => ({
  venueUsesUnifiedAppointmentServiceData: vi.fn(async () => true),
}));
vi.mock('@/lib/venue/service-calendar-removal', () => ({
  findBookingsAffectedByRemovingServicesUnified: vi.fn(async () => ({ total: 0, error: null })),
  findBookingsAffectedByRemovingServicesLegacy: vi.fn(async () => ({ total: 0, error: null })),
  serviceRemovalConfirmationPayload: vi.fn(() => ({ error: 'has bookings' })),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { findBookingsAffectedByRemovingServicesUnified } from '@/lib/venue/service-calendar-removal';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { PUT } from './route';

const VENUE = 'venue-1';
const CAL = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222221';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '22222222-2222-4222-8222-222222222223';

function world(stored: string[], rpc?: { data?: unknown; error?: unknown }) {
  const responder: Responder = (call) => {
    if (call.table === 'unified_calendars') return { data: { id: CAL } };
    if (call.table === 'calendar_service_assignments' && call.op === 'select') {
      return { data: stored.map((service_item_id) => ({ service_item_id })) };
    }
    if (call.table === 'rpc:set_calendar_service_assignments') {
      return rpc ?? { data: { status: 'ok', added: [], removed: [] } };
    }
    return undefined;
  };
  const rec = makeRecordingDb(responder);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as SupabaseClient);
  const staff: VenueStaff = { id: 'admin-1', venue_id: VENUE, email: 'owner@example.test', role: 'admin', db: rec.db };
  vi.mocked(getVenueStaff).mockResolvedValue(staff);
  return rec;
}

function put(body: Record<string, unknown>) {
  return PUT(
    new NextRequest('http://localhost/api/venue/practitioner-services', { method: 'PUT', body: JSON.stringify(body) }),
  );
}

const writesToAssignments = (rec: ReturnType<typeof makeRecordingDb>) =>
  rec.calls.filter((c) => c.table === 'calendar_service_assignments' && c.op !== 'select');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/venue/practitioner-services', () => {
  it('writes through the atomic diff, never a delete-all and re-insert', async () => {
    const rec = world([S1, S2], { data: { status: 'ok', added: [S3], removed: [S2] } });

    const res = await put({ practitioner_id: CAL, service_ids: [S1, S3], expected_service_ids: [S2, S1] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, added: [S3], removed: [S2] });
    expect(writesToAssignments(rec)).toEqual([]);
    const rpc = rec.calls.filter((c) => c.table === 'rpc:set_calendar_service_assignments');
    expect(rpc).toHaveLength(1);
    expect(rpc[0].payload).toEqual({
      p_venue_id: VENUE,
      p_calendar_id: CAL,
      p_service_item_ids: [S1, S3],
      p_expected_service_item_ids: [S2, S1],
    });
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('answers 412 before any write when the calendar changed since the dialog loaded it', async () => {
    const rec = world([S1, S2]);

    const res = await put({ practitioner_id: CAL, service_ids: [S1], expected_service_ids: [S1] });

    expect(res.status).toBe(412);
    expect(await res.json()).toEqual({
      error: "Someone else changed this calendar's services. Refresh and try again.",
      code: 'STALE_RESOURCE',
    });
    expect(rec.calls.some((c) => c.op === 'rpc')).toBe(false);
    expect(findBookingsAffectedByRemovingServicesUnified).not.toHaveBeenCalled();
  });

  it('answers 412 when the change lands between the check and the write', async () => {
    world([S1], { data: { status: 'stale', added: [], removed: [] } });

    const res = await put({ practitioner_id: CAL, service_ids: [S1, S2], expected_service_ids: [S1] });

    expect(res.status).toBe(412);
  });

  it('still saves for a client that sends no expected set, as older app builds do', async () => {
    const rec = world([S1]);

    const res = await put({ practitioner_id: CAL, service_ids: [S1, S2] });

    expect(res.status).toBe(200);
    const rpc = rec.calls.find((c) => c.table === 'rpc:set_calendar_service_assignments');
    expect((rpc?.payload as { p_expected_service_item_ids: unknown }).p_expected_service_item_ids).toBeNull();
  });

  it("refuses another venue's service ids with 403 (PB-08)", async () => {
    world([], { data: null, error: { code: '22023', message: 'ASSIGNMENT_NOT_AT_VENUE: a service is not at venue venue-1' } });

    const res = await put({ practitioner_id: CAL, service_ids: [S1] });

    expect(res.status).toBe(403);
  });

  it('reports a database failure as 500 rather than a partial save', async () => {
    world([S1], { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });

    const res = await put({ practitioner_id: CAL, service_ids: [] });

    expect(res.status).toBe(500);
  });
});
