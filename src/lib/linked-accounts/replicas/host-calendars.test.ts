/**
 * Every calendar in the collective, for the host (plan Appendix E contract 5 `collective_calendars`).
 *
 * The host chooses which calendars offer a service, at its own venue and at members, so it is
 * handed all of them in one read: host group first, members A to Z, each calendar carrying the
 * services it offers, that calendar's own values for them (gated by the service's permissions) and
 * who last changed it.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { loadHostCollectiveCalendars } from '@/lib/linked-accounts/replicas/host-calendars';

const HOST = 'venue-host';
const MEMBER = 'venue-member';
const COLLECTIVE = 'collective-1';
const ITEM = 'item-1';
const MASTER = 'service-master';
const REPLICA = 'service-replica';

const baseWorld: Responder = (call) => {
  switch (call.table) {
    case 'rpc:collective_venue_live_state':
      return { data: { collective_id: COLLECTIVE, role: 'host', paused: false } };
    case 'venue_collective_members':
      return {
        data: [
          { venue_id: MEMBER, venues: { name: 'Zed Studio' } },
          { venue_id: HOST, venues: { name: 'Host Venue' } },
        ],
      };
    case 'collective_service_items':
      return { data: [{ id: ITEM, master_service_id: MASTER }] };
    case 'collective_service_replicas':
      return {
        data: [
          {
            id: 'link-1',
            collective_service_item_id: ITEM,
            venue_id: MEMBER,
            replica_service_id: REPLICA,
            applied_revision: 4,
            desired_revision: 5,
            attempts: 0,
            last_error_code: null,
            last_error: null,
          },
        ],
      };
    case 'unified_calendars':
      return {
        data: [
          { id: 'cal-host', venue_id: HOST, name: 'Room 1', is_active: true },
          { id: 'cal-member', venue_id: MEMBER, name: 'Chair 2', is_active: true },
          { id: 'cal-member-2', venue_id: MEMBER, name: 'Away chair', is_active: false },
        ],
      };
    case 'calendar_service_assignments':
      return {
        data: [
          { id: 'a1', calendar_id: 'cal-host', service_item_id: MASTER, custom_price_pence: 7000, custom_duration_minutes: 45, updated_by_venue_id: HOST, updated_at: '2026-09-10T09:00:00Z' },
          { id: 'a2', calendar_id: 'cal-member', service_item_id: REPLICA, custom_price_pence: 8000, custom_name: 'Their name', updated_by_venue_id: HOST, updated_at: '2026-09-11T09:00:00Z' },
        ],
      };
    case 'service_items':
      return {
        data: [
          { id: MASTER, staff_may_customize_price: true, staff_may_customize_duration: true, staff_may_customize_name: false },
          { id: REPLICA, staff_may_customize_price: true, staff_may_customize_duration: true, staff_may_customize_name: false },
        ],
      };
    default:
      return undefined;
  }
};

const load = (responder: Responder = baseWorld) => {
  const recording = makeRecordingDb(responder);
  return loadHostCollectiveCalendars(recording.db as unknown as SupabaseClient, HOST);
};

describe('loadHostCollectiveCalendars', () => {
  it('puts the host group first and its members after it', async () => {
    const groups = await load();
    expect(groups?.map((g) => [g.venue_name, g.is_host])).toEqual([
      ['Host Venue', true],
      ['Zed Studio', false],
    ]);
  });

  it('says which services each calendar offers, at the host and at a member', async () => {
    const groups = await load();
    const hostCalendar = groups?.[0].calendars[0];
    expect(hostCalendar?.assigned).toEqual([
      expect.objectContaining({ item_id: ITEM, service_id: MASTER }),
    ]);
    const memberCalendar = groups?.[1].calendars.find((c) => c.id === 'cal-member');
    expect(memberCalendar?.assigned[0]).toMatchObject({ item_id: ITEM, service_id: REPLICA });
    expect(memberCalendar?.assigned[0].last_changed).toEqual({ venue_name: 'Host Venue', at: '2026-09-11T09:00:00Z' });
  });

  it('gives a calendar only the values its service allows it to hold', async () => {
    const groups = await load();
    const memberValues = groups?.[1].calendars.find((c) => c.id === 'cal-member')?.assigned[0].values;
    expect(memberValues?.custom_price_pence).toBe(8000);
    // Name is never a calendar's own on a shared service (D29), whatever is stored.
    expect(memberValues?.custom_name).toBeNull();
  });

  it('carries a calendar the collective has never touched, with nothing assigned', async () => {
    const groups = await load();
    const spare = groups?.[1].calendars.find((c) => c.id === 'cal-member-2');
    expect(spare).toMatchObject({ name: 'Away chair', is_active: false, assigned: [] });
  });

  it('reports a member that is still updating in the same shape a save answers in', async () => {
    const groups = await load();
    expect(groups?.[1].sync).toEqual({
      venues: 1,
      applied: 0,
      pending: [{ venue_id: MEMBER, venue_name: 'Zed Studio' }],
      failed: [],
    });
    expect(groups?.[0].sync).toEqual({ venues: 1, applied: 0, pending: [], failed: [] });
  });

  it('names the failure when an update did not go through', async () => {
    const groups = await load((call) =>
      call.table === 'collective_service_replicas'
        ? {
            data: [
              {
                id: 'link-1',
                collective_service_item_id: ITEM,
                venue_id: MEMBER,
                replica_service_id: REPLICA,
                applied_revision: 5,
                desired_revision: 5,
                attempts: 2,
                last_error_code: 'slug_collision',
                last_error: 'name already taken',
              },
            ],
          }
        : baseWorld(call),
    );
    expect(groups?.[1].sync.failed).toEqual([
      { venue_id: MEMBER, venue_name: 'Zed Studio', message: 'name already taken', code: 'slug_collision' },
    ]);
  });

  it('is nothing at a member, so the route leaves the key off', async () => {
    const groups = await load((call) =>
      call.table === 'rpc:collective_venue_live_state'
        ? { data: { collective_id: COLLECTIVE, role: 'member' } }
        : baseWorld(call),
    );
    expect(groups).toBeNull();
  });

  it('is nothing at a venue in no collective at all, which is every venue today', async () => {
    expect(await load(() => undefined)).toBeNull();
  });

  it('still lists the venues and their calendars before any service is on the page', async () => {
    const groups = await load((call) =>
      call.table === 'collective_service_items'
        ? { data: [] }
        : call.table === 'collective_service_replicas'
          ? { data: [] }
          : baseWorld(call),
    );
    expect(groups?.map((g) => g.calendars.map((c) => c.name))).toEqual([['Room 1'], ['Away chair', 'Chair 2']]);
    expect(groups?.every((g) => g.calendars.every((c) => c.assigned.length === 0))).toBe(true);
  });
});
