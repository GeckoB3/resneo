/**
 * APP-01 (W12): the ResNeo app's service saves against a collective's services.
 *
 * The payloads are the app's own (Resneo-app cbc0975, 1.0.0: `app/(app)/manage/services.tsx`
 * `handleSave`, `lib/queries/useServicesManage.ts`). An admin save sends the whole service back,
 * including every option and add-on link, so a member saving a copy of the host's service without
 * changing it must go through; a real edit gets a readable 409; deletes the engine refuses say why.
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
  replaceServiceVariants: vi.fn(async () => ({ ok: true, variants: [] })),
}));
vi.mock('@/lib/venue/addon-groups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/venue/addon-groups')>()),
  replaceServiceAddonGroupLinks: vi.fn(async () => ({ ok: true, links: [] })),
}));
vi.mock('@/lib/addons/addon-resolution', () => ({ loadAddonGroupsForServices: vi.fn(async () => new Map()) }));
vi.mock('@/lib/linked-accounts/replicas/master-save', () => ({
  loadMasterSaveContext: vi.fn(async () => null),
  captureMasterProjection: vi.fn(async () => null),
  recordMasterChangeAndApply: vi.fn(async () => null),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { replaceServiceVariants } from '@/lib/venue/service-variants';
import { replaceServiceAddonGroupLinks } from '@/lib/venue/addon-groups';
import { DELETE, PATCH } from '../venue/appointment-services/route';

const MEMBER = 'venue-member';
const SERVICE = '33333333-3333-4333-8333-333333333333';
const VARIANT = '44444444-4444-4444-8444-444444444444';
const GROUP = '55555555-5555-4555-8555-555555555555';
const CAL = '11111111-1111-4111-8111-11111111111a';

/** The member's copy as the database holds it. */
const replicaRow = {
  id: SERVICE,
  venue_id: MEMBER,
  name: 'Cut',
  description: null,
  duration_minutes: 30,
  buffer_minutes: 0,
  price_pence: 2500,
  deposit_pence: null,
  payment_requirement: 'none',
  colour: '#3B82F6',
  is_active: true,
  category_id: null,
  max_advance_booking_days: 90,
  min_booking_notice_hours: 1,
  cancellation_notice_hours: 48,
  allow_same_day_booking: true,
  staff_may_customize_name: false,
  staff_may_customize_description: false,
  staff_may_customize_duration: false,
  staff_may_customize_buffer: false,
  staff_may_customize_price: false,
  staff_may_customize_deposit: false,
  staff_may_customize_colour: false,
  location_type: 'business_venue',
  online_meeting_url: null,
  online_meeting_info: null,
  processing_time_blocks: [],
  updated_at: '2026-09-16T10:00:00+00:00',
};

/** `handleSave` for an admin, editing: `{ id, ...shared, ...adminExtras }` (services.tsx 1224-1320). */
function appSave(over: Record<string, unknown> = {}) {
  return {
    id: SERVICE,
    name: 'Cut',
    description: null,
    duration_minutes: 30,
    buffer_minutes: 0,
    price_pence: 2500,
    deposit_pence: 0,
    payment_requirement: 'none',
    colour: '#3B82F6',
    is_active: true,
    max_advance_booking_days: 90,
    min_booking_notice_hours: 1,
    cancellation_notice_hours: 48,
    allow_same_day_booking: true,
    category_id: null,
    staff_may_customize_name: false,
    staff_may_customize_description: false,
    staff_may_customize_duration: false,
    staff_may_customize_buffer: false,
    staff_may_customize_price: false,
    staff_may_customize_deposit: false,
    staff_may_customize_colour: false,
    location_type: 'business_venue',
    online_meeting_url: null,
    online_meeting_info: null,
    variants: [
      {
        id: VARIANT,
        name: 'Short',
        description: null,
        duration_minutes: 30,
        buffer_minutes: 0,
        price_pence: 2500,
        deposit_pence: null,
        is_active: true,
        sort_order: 0,
        processing_time_blocks: [],
      },
    ],
    addon_group_links: [{ addon_group_id: GROUP, sort_order: 0 }],
    ...over,
  };
}

function world(opts: { deleteError?: { code: string; message: string } } = {}) {
  const responder: Responder = (call) => {
    if (call.table === 'service_items' && call.op === 'select') return { data: replicaRow };
    if (call.table === 'service_items' && call.op === 'update') return { data: replicaRow };
    if (call.table === 'service_items' && call.op === 'delete') {
      return opts.deleteError ? { data: null, error: opts.deleteError } : { data: null };
    }
    if (call.table === 'appointment_services') return { data: null };
    if (call.table === 'collective_service_replicas') {
      return { data: { id: 'link-1', collective_id: 'col-1', collective_service_item_id: 'item-1', venue_id: MEMBER } };
    }
    if (call.table === 'venue_collectives') {
      return {
        data: { id: 'col-1', name: 'Northside', status: 'active', service_model: 'replicas', host_venue_id: 'host', venues: { name: 'Host Venue' } },
      };
    }
    if (call.table === 'collective_service_items') return { data: { status: 'active' } };
    if (call.table === 'service_variants') {
      return {
        data: [
          {
            id: VARIANT,
            name: 'Short',
            description: null,
            duration_minutes: 30,
            buffer_minutes: 0,
            price_pence: 2500,
            deposit_pence: null,
            is_active: true,
            sort_order: 0,
            processing_time_blocks: null,
          },
        ],
      };
    }
    if (call.table === 'service_addon_groups') return { data: [{ addon_group_id: GROUP, sort_order: 0 }] };
    if (call.table === 'unified_calendars') {
      const inFilter = call.filters.find((f) => f[0] === 'in');
      return { data: inFilter ? (inFilter[2] as string[]).map((id) => ({ id })) : { id: CAL } };
    }
    if (call.table === 'calendar_service_assignments' && call.op === 'select') {
      return { data: [{ calendar_id: CAL, service_item_id: SERVICE }] };
    }
    if (call.table === 'rpc:set_service_calendar_assignments') {
      return { data: { status: 'ok', added: [], removed: [] } };
    }
    return undefined;
  };
  const rec = makeRecordingDb(responder);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as SupabaseClient);
  const staff: VenueStaff = { id: 'admin-1', venue_id: MEMBER, email: 'owner@example.test', role: 'admin', db: rec.db };
  vi.mocked(getVenueStaff).mockResolvedValue(staff);
  return rec;
}

const patch = (body: Record<string, unknown>, query = '') =>
  PATCH(
    new NextRequest(`http://localhost/api/venue/appointment-services${query}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  );

const del = (id: string) =>
  DELETE(new NextRequest('http://localhost/api/venue/appointment-services', { method: 'DELETE', body: JSON.stringify({ id }) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('APP-01: the app saving a copy of the host service, as a member', () => {
  it('goes through unchanged, and writes nothing of the host', async () => {
    const rec = world();
    const res = await patch(appSave());
    expect(res.status).toBe(200);
    expect(vi.mocked(replaceServiceVariants)).not.toHaveBeenCalled();
    expect(vi.mocked(replaceServiceAddonGroupLinks)).not.toHaveBeenCalled();
    const updates = rec.calls.filter((c) => c.table === 'service_items' && c.op === 'update');
    for (const u of updates) {
      expect(Object.keys(u.payload as object).every((k) => ['online_meeting_url', 'online_meeting_info'].includes(k))).toBe(true);
    }
  });

  it('changes which calendars offer it, with and without the acknowledgement', async () => {
    world();
    expect((await patch(appSave({ practitioner_ids: [CAL] }))).status).toBe(200);
    world();
    expect((await patch(appSave({ practitioner_ids: [CAL] }), '?acknowledge_affected_bookings=true')).status).toBe(200);
  });

  it('refuses a price edit with a readable 409', async () => {
    world();
    const res = await patch(appSave({ price_pence: 3000 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('COLLECTIVE_MANAGED_SERVICE');
    expect(body.error).toBe(
      'Host Venue manages this service for Northside, so only Host Venue can change it. You choose which of your calendars offer it.',
    );
  });

  it('refuses a changed option or add-on link the same way', async () => {
    world();
    const renamed = appSave();
    (renamed.variants as Array<Record<string, unknown>>)[0]!.name = 'Long';
    expect((await patch(renamed)).status).toBe(409);
    world();
    expect((await patch(appSave({ addon_group_links: [] }))).status).toBe(409);
    expect(vi.mocked(replaceServiceVariants)).not.toHaveBeenCalled();
  });
});

describe('APP-01: deleting a service the collective holds', () => {
  it("answers a member's copy with a readable 409", async () => {
    world({ deleteError: { code: 'RN001', message: 'managed' } });
    const res = await del(SERVICE);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('COLLECTIVE_MANAGED_SERVICE');
    expect(body.error).toMatch(/managed by/);
  });

  it("answers the host's offered service with a readable 409", async () => {
    world({ deleteError: { code: 'RN002', message: 'offered' } });
    const res = await del(SERVICE);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('COLLECTIVE_OFFERED_SERVICE');
    expect(body.error).toMatch(/Take this service off/);
  });
});
