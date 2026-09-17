/**
 * CSA-01, CSA-02 and PB-05 for the service-side writer (collective plan W2).
 * The PATCH used to delete every assignment for the service and re-insert, and it did so before
 * the payment and processing checks further down, so a save refused with 400 had already
 * rewritten the calendars. It also had nothing to detect a concurrent edit with.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
vi.mock('@/lib/linked-accounts/service-sync', () => ({
  isMissingSyncColumnError: () => false,
  patchTouchesSyncedShape: () => false,
  syncCopiesOfService: vi.fn(),
}));
vi.mock('@/lib/venue/service-variants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/venue/service-variants')>()),
  loadVariantsForServices: vi.fn(async () => new Map()),
  replaceServiceVariants: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/addons/addon-resolution', () => ({ loadAddonGroupsForServices: vi.fn(async () => new Map()) }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { PATCH } from './route';

const VENUE = 'venue-1';
const SERVICE = '33333333-3333-4333-8333-333333333333';
const CAL_A = '11111111-1111-4111-8111-11111111111a';
const CAL_B = '11111111-1111-4111-8111-11111111111b';
const UPDATED_AT = '2026-09-14T10:00:00.123456+00:00';

function world(opts: {
  storedCalendars: string[];
  serviceRow?: Record<string, unknown>;
  rpc?: { data?: unknown; error?: unknown };
  updateReturnsNoRow?: boolean;
}) {
  const row = {
    id: SERVICE,
    venue_id: VENUE,
    name: 'Haircut',
    duration_minutes: 30,
    processing_time_blocks: [],
    payment_requirement: 'none',
    deposit_pence: null,
    updated_at: UPDATED_AT,
    ...opts.serviceRow,
  };
  const responder: Responder = (call) => {
    if (call.table === 'service_items' && call.op === 'select') return { data: row };
    if (call.table === 'service_items' && call.op === 'update') {
      return opts.updateReturnsNoRow ? { data: null } : { data: { ...row, updated_at: '2026-09-14T10:05:00+00:00' } };
    }
    if (call.table === 'unified_calendars') {
      const inFilter = call.filters.find((f) => f[0] === 'in');
      if (inFilter) return { data: (inFilter[2] as string[]).map((id) => ({ id })) };
      const idFilter = call.filters.find((f) => f[0] === 'eq' && f[1] === 'id');
      return { data: idFilter ? { id: idFilter[2] } : null };
    }
    if (call.table === 'calendar_service_assignments' && call.op === 'select') {
      return { data: opts.storedCalendars.map((calendar_id) => ({ calendar_id, service_item_id: SERVICE })) };
    }
    if (call.table === 'rpc:set_service_calendar_assignments') {
      return opts.rpc ?? { data: { status: 'ok', added: [], removed: [] } };
    }
    return undefined;
  };
  const rec = makeRecordingDb(responder);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as SupabaseClient);
  const staff: VenueStaff = { id: 'admin-1', venue_id: VENUE, email: 'owner@example.test', role: 'admin', db: rec.db };
  vi.mocked(getVenueStaff).mockResolvedValue(staff);
  return rec;
}

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest('http://localhost/api/venue/appointment-services', {
      method: 'PATCH',
      body: JSON.stringify({ id: SERVICE, ...body }),
    }),
  );
}

const writes = (rec: ReturnType<typeof makeRecordingDb>) => rec.calls.filter((c) => c.op !== 'select');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/venue/appointment-services: calendar assignments', () => {
  it('sets calendars through the atomic diff, never a delete-all and re-insert', async () => {
    const rec = world({ storedCalendars: [CAL_A], rpc: { data: { status: 'ok', added: [CAL_B], removed: [] } } });

    const res = await patch({
      name: 'Haircut',
      practitioner_ids: [CAL_A, CAL_B],
      expected_calendar_ids: [CAL_A],
      expected_updated_at: UPDATED_AT,
    });

    expect(res.status).toBe(200);
    expect(rec.calls.filter((c) => c.table === 'calendar_service_assignments' && c.op !== 'select')).toEqual([]);
    const rpc = rec.calls.filter((c) => c.table === 'rpc:set_service_calendar_assignments');
    expect(rpc).toHaveLength(1);
    expect(rpc[0].payload).toEqual({
      p_venue_id: VENUE,
      p_service_item_id: SERVICE,
      p_calendar_ids: [CAL_A, CAL_B],
      p_scope_calendar_ids: null,
      p_expected_calendar_ids: [CAL_A],
    });
    // The row write carries the exact timestamp guard in the same statement.
    const update = rec.calls.find((c) => c.table === 'service_items' && c.op === 'update');
    expect(update?.filters).toContainEqual(['eq', 'updated_at', UPDATED_AT]);
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('answers 412 with nothing written when the calendars changed since the form loaded', async () => {
    const rec = world({ storedCalendars: [CAL_A, CAL_B] });

    const res = await patch({ name: 'Haircut', practitioner_ids: [CAL_A], expected_calendar_ids: [CAL_A] });

    expect(res.status).toBe(412);
    expect((await res.json()).code).toBe('STALE_RESOURCE');
    expect(writes(rec)).toEqual([]);
  });

  it('answers 412 with nothing written when the service was saved by someone else', async () => {
    const rec = world({ storedCalendars: [CAL_A] });

    const res = await patch({
      name: 'Haircut, renamed',
      practitioner_ids: [CAL_A],
      expected_updated_at: '2026-09-14T09:59:00+00:00',
    });

    expect(res.status).toBe(412);
    expect(writes(rec)).toEqual([]);
  });

  it('answers 412 when the row changed between the check and the write', async () => {
    const rec = world({ storedCalendars: [CAL_A], updateReturnsNoRow: true });

    const res = await patch({ name: 'Haircut, renamed', practitioner_ids: [CAL_A], expected_updated_at: UPDATED_AT });

    expect(res.status).toBe(412);
    expect(rec.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('writes no calendars when a later check refuses the save (PB-05)', async () => {
    // A deposit-only patch on a card-hold service below the 1.00 floor is refused after the
    // calendar block; the calendars used to have been rewritten by then.
    const rec = world({ storedCalendars: [CAL_A], serviceRow: { payment_requirement: 'card_hold', deposit_pence: 500 } });

    const res = await patch({ practitioner_ids: [CAL_A, CAL_B], deposit_pence: 50 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Set a no-show fee of at least £1 for card holds');
    expect(writes(rec)).toEqual([]);
  });

  it('still saves for a client that sends neither expected value, as older app builds do', async () => {
    const rec = world({ storedCalendars: [CAL_A] });

    const res = await patch({ name: 'Haircut', practitioner_ids: [CAL_A, CAL_B] });

    expect(res.status).toBe(200);
    const rpc = rec.calls.find((c) => c.table === 'rpc:set_service_calendar_assignments');
    expect((rpc?.payload as { p_expected_calendar_ids: unknown }).p_expected_calendar_ids).toBeNull();
    const update = rec.calls.find((c) => c.table === 'service_items' && c.op === 'update');
    expect(update?.filters.some((f) => f[1] === 'updated_at')).toBe(false);
  });
});
