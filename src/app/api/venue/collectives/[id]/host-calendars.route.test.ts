/**
 * The host's calendar routes (plan §6.7, Appendix E contract 12; W5).
 *
 * Choosing which calendars offer a service is the only path that writes another venue's assignment
 * rows, and taking one off answers the bookings it would leave behind before it writes anything.
 * Setting a calendar's own values goes through the engine, which allows a value only while the
 * service's staff permission for that field is on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClientFromHeaders: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/venue-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/venue-auth')>();
  return { ...actual, getVenueStaff: vi.fn() };
});

import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { POST as setCalendar } from './calendars/route';
import { PUT as setValues } from './calendar-values/route';

const HOST = 'venue-host';
const COLLECTIVE = '11111111-1111-4111-8111-111111111111';
const ITEM = '33333333-3333-4333-8333-333333333333';
const CALENDAR = '66666666-6666-4666-8666-666666666666';
const SERVICE = '22222222-2222-4222-8222-222222222222';
const MEMBER = '77777777-7777-4777-8777-777777777777';

function world(rpc: Responder) {
  const responder: Responder = (call) => {
    if (call.table === 'venues') return { data: { id: HOST, name: 'Host Venue', slug: 'host' } };
    if (call.table === 'venue_collectives') {
      return { data: { id: COLLECTIVE, name: 'Northside', status: 'active', service_model: 'replicas', host_venue_id: HOST } };
    }
    return rpc(call);
  };
  const rec = makeRecordingDb(responder);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as unknown as SupabaseClient);
  return rec;
}

const admin = (venueId = HOST): VenueStaff =>
  ({ id: 'staff-1', venue_id: venueId, email: 'a@b.test', role: 'admin', db: {} as SupabaseClient }) as VenueStaff;
const request = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = { params: Promise.resolve({ id: COLLECTIVE }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue(admin());
});

describe('POST calendars', () => {
  it('adds a member calendar to a service on the page', async () => {
    const rec = world((call) =>
      call.table === 'rpc:collective_set_calendar_offering' ? { data: { assignment_id: 'a1', written: true, affected_bookings: [] } } : undefined,
    );
    const res = await setCalendar(
      request('POST', { item_id: ITEM, venue_id: MEMBER, calendar_id: CALENDAR, action: 'assign' }),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ assignment_id: 'a1', written: true });
    expect(rec.calls.find((c) => c.table === 'rpc:collective_set_calendar_offering')?.payload).toMatchObject({
      p_item_id: ITEM, p_venue_id: MEMBER, p_calendar_id: CALENDAR, p_action: 'assign', p_actor_venue_id: HOST,
      p_acknowledge_affected: false,
    });
  });

  it('shows the bookings a removal would leave behind, and writes nothing yet', async () => {
    world((call) =>
      call.table === 'rpc:collective_set_calendar_offering'
        ? { data: { assignment_id: 'a1', written: false, affected_bookings: [{ booking_date: '2026-10-01', booking_time: '10:00', calendar_id: CALENDAR }] } }
        : undefined,
    );
    const res = await setCalendar(
      request('POST', { item_id: ITEM, venue_id: MEMBER, calendar_id: CALENDAR, action: 'unassign' }),
      params,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.requires_confirmation).toBe(true);
    expect(body.affected_bookings).toHaveLength(1);
    // No client details ever leave the engine for this answer.
    expect(JSON.stringify(body)).not.toMatch(/guest|email|phone|name/i);
  });

  it('goes through once the host has seen them', async () => {
    const rec = world((call) =>
      call.table === 'rpc:collective_set_calendar_offering' ? { data: { assignment_id: 'a1', written: true, affected_bookings: [] } } : undefined,
    );
    const res = await setCalendar(
      request('POST', { item_id: ITEM, venue_id: MEMBER, calendar_id: CALENDAR, action: 'unassign', acknowledge_affected: true }),
      params,
    );
    expect(res.status).toBe(200);
    expect(rec.calls.find((c) => c.table === 'rpc:collective_set_calendar_offering')?.payload).toMatchObject({
      p_acknowledge_affected: true,
    });
  });

  it('answers the engine refusals in plain words', async () => {
    world((call) =>
      call.table === 'rpc:collective_set_calendar_offering'
        ? { error: { code: 'P0001', message: 'COLLECTIVE_REPLICA_NOT_READY: the service is not ready at that venue yet' } }
        : undefined,
    );
    const res = await setCalendar(
      request('POST', { item_id: ITEM, venue_id: MEMBER, calendar_id: CALENDAR, action: 'assign' }),
      params,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('COLLECTIVE_REPLICA_NOT_READY');
  });
});

describe('PUT calendar-values', () => {
  it('sends only the values given, and reports before and after', async () => {
    const rec = world((call) =>
      call.table === 'rpc:collective_set_calendar_values'
        ? { data: { assignment_id: 'a1', before: { custom_price_pence: null }, after: { custom_price_pence: 4500 } } }
        : undefined,
    );
    const res = await setValues(
      request('PUT', { calendar_id: CALENDAR, service_id: SERVICE, values: { custom_price_pence: 4500 } }),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ after: { custom_price_pence: 4500 } });
    expect(rec.calls.find((c) => c.table === 'rpc:collective_set_calendar_values')?.payload).toMatchObject({
      p_calendar_id: CALENDAR, p_service_item_id: SERVICE, p_values: { custom_price_pence: 4500 }, p_actor_venue_id: HOST,
    });
  });

  it('refuses an empty change and an unknown value', async () => {
    world(() => undefined);
    expect((await setValues(request('PUT', { calendar_id: CALENDAR, service_id: SERVICE, values: {} }), params)).status).toBe(400);
    expect(
      (await setValues(request('PUT', { calendar_id: CALENDAR, service_id: SERVICE, values: { custom_price_pence: -1 } }), params)).status,
    ).toBe(400);
  });

  it('passes the engine refusal through when the service does not allow that value', async () => {
    world((call) =>
      call.table === 'rpc:collective_set_calendar_values'
        ? { error: { code: 'P0001', message: 'collective_set_calendar_values: custom_name is not allowed on this service' } }
        : undefined,
    );
    const res = await setValues(
      request('PUT', { calendar_id: CALENDAR, service_id: SERVICE, values: { custom_name: 'Mine' } }),
      params,
    );
    // Not one of the coded refusals: the route checked the friendly conditions, so this is a bug to page on.
    expect(res.status).toBe(500);
  });

  it('refuses a venue that does not host the collective', async () => {
    world(() => undefined);
    vi.mocked(getVenueStaff).mockResolvedValue(admin(MEMBER));
    const res = await setValues(
      request('PUT', { calendar_id: CALENDAR, service_id: SERVICE, values: { custom_price_pence: 1000 } }),
      params,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('COLLECTIVE_NOT_HOST');
  });
});
