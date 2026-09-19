/**
 * The collective that rides on a link request, and the host's setup needs
 * (Docs/link-and-collective-setup-wizard-plan.md, L7, L8, L11).
 */
import { describe, expect, it } from 'vitest';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';
import { closeInvitationForLink, loadCollectiveSetupNeeds, loadInvitationsByHost } from './proposed-collectives';

const HOST = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const COLLECTIVE = '44444444-4444-4444-8444-444444444444';

const filterValue = (call: RecordedCall, column: string) =>
  call.filters.find((f) => (f[0] === 'eq' || f[0] === 'in' || f[0] === 'neq') && f[1] === column)?.[2];

describe('loadInvitationsByHost', () => {
  it('keys the open invitations by the host that sent them', async () => {
    const recording = makeRecordingDb((call) => {
      if (call.table === 'venue_collective_members') return { data: [{ id: 'm-1', collective_id: COLLECTIVE }] };
      if (call.table === 'venue_collectives') {
        return { data: [{ id: COLLECTIVE, name: 'Northside', slug: 'northside', host_venue_id: HOST, status: 'active', service_model: 'replicas' }] };
      }
      return undefined;
    });
    const byHost = await loadInvitationsByHost(recording.db, ME);
    expect(byHost.get(HOST)).toEqual({
      id: COLLECTIVE,
      name: 'Northside',
      slug: 'northside',
      hostVenueId: HOST,
      memberId: 'm-1',
      serviceModel: 'replicas',
    });
  });

  it('is empty, with one query, when nothing is open', async () => {
    const recording = makeRecordingDb(() => ({ data: [] }));
    expect((await loadInvitationsByHost(recording.db, ME)).size).toBe(0);
    expect(recording.queryCount({ table: 'venue_collectives' })).toBe(0);
  });
});

describe('loadCollectiveSetupNeeds', () => {
  function db(state: { members: string[]; items: string[]; assignments: number }) {
    return makeRecordingDb((call) => {
      if (call.table === 'venue_collectives') return { data: [{ id: COLLECTIVE, name: 'Northside', slug: 'northside' }] };
      if (call.table === 'venue_collective_members') return { data: state.members.map((venue_id) => ({ venue_id })) };
      if (call.table === 'collective_service_items') return { data: state.items.map((id) => ({ id: `item-${id}`, master_service_id: id })) };
      if (call.table === 'collective_service_replicas') return { data: [{ replica_service_id: 'replica-1' }] };
      if (call.table === 'calendar_service_assignments') return { data: state.assignments > 0 ? [{ id: 'a-1' }] : [] };
      if (call.table === 'venues') return { data: [{ id: OTHER, name: 'Bloom' }] };
      return undefined;
    });
  }

  it('says nothing while the host is alone', async () => {
    expect(await loadCollectiveSetupNeeds(db({ members: [HOST], items: [], assignments: 0 }).db, HOST)).toEqual([]);
  });

  it('asks for services when two venues are in and nothing is on the page', async () => {
    const needs = await loadCollectiveSetupNeeds(db({ members: [HOST, OTHER], items: [], assignments: 0 }).db, HOST);
    expect(needs).toEqual([{ collectiveId: COLLECTIVE, name: 'Northside', slug: 'northside', memberNames: ['Bloom'], reason: 'no_services' }]);
  });

  it('asks for calendars when services are on the page but none is offered', async () => {
    const recording = db({ members: [HOST, OTHER], items: ['svc-1'], assignments: 0 });
    const needs = await loadCollectiveSetupNeeds(recording.db, HOST);
    expect(needs[0]?.reason).toBe('no_calendars');
    const assignmentsCall = recording.calls.find((c) => c.table === 'calendar_service_assignments')!;
    expect(filterValue(assignmentsCall, 'service_item_id')).toEqual(['svc-1', 'replica-1']);
  });

  it('is quiet once one calendar offers one service', async () => {
    expect(await loadCollectiveSetupNeeds(db({ members: [HOST, OTHER], items: ['svc-1'], assignments: 1 }).db, HOST)).toEqual([]);
  });
});

describe('closeInvitationForLink', () => {
  function db(opts: { model: string; othersRemain: boolean }) {
    return makeRecordingDb((call) => {
      if (call.table === 'venue_collective_members' && call.op === 'select') {
        // The invitation lookup, then the "who is left" count.
        if (call.filters.some((f) => f[0] === 'neq')) return { data: opts.othersRemain ? [{ venue_id: 'someone' }] : [] };
        return { data: [{ id: 'm-1', collective_id: COLLECTIVE }] };
      }
      if (call.table === 'venue_collectives' && call.op === 'select') {
        return { data: [{ id: COLLECTIVE, name: 'Northside', slug: 'northside', host_venue_id: HOST, status: 'active', service_model: opts.model }] };
      }
      return undefined;
    });
  }

  it('does nothing when no invitation rides on the request', async () => {
    const recording = makeRecordingDb(() => ({ data: [] }));
    expect(await closeInvitationForLink(recording.db, { hostVenueId: HOST, inviteeVenueId: ME, reason: 'declined', actorVenueId: ME, actorUserId: 'u' })).toEqual({
      closed: false,
      dissolved: false,
      collectiveName: null,
    });
    expect(recording.queryCount({ op: 'update' })).toBe(0);
  });

  it('declining removes the invitation and dissolves a collective left with the host alone', async () => {
    const recording = db({ model: 'replicas', othersRemain: false });
    const result = await closeInvitationForLink(recording.db, { hostVenueId: HOST, inviteeVenueId: ME, reason: 'declined', actorVenueId: ME, actorUserId: 'u' });
    expect(result).toEqual({ closed: true, dissolved: true, collectiveName: 'Northside' });
    const update = recording.calls.find((c) => c.table === 'venue_collective_members' && c.op === 'update')!;
    expect((update.payload as { status: string }).status).toBe('removed');
    const dissolve = recording.calls.find((c) => c.table === 'rpc:collective_dissolve')!;
    expect((dissolve.payload as { p_reason: string }).p_reason).toBe('below_two');
  });

  it('a withdrawn request closes the invitation through the engine and keeps a collective with other venues', async () => {
    const recording = db({ model: 'replicas', othersRemain: true });
    const result = await closeInvitationForLink(recording.db, { hostVenueId: HOST, inviteeVenueId: ME, reason: 'cancelled', actorVenueId: HOST, actorUserId: 'u' });
    expect(result).toEqual({ closed: true, dissolved: false, collectiveName: 'Northside' });
    const close = recording.calls.find((c) => c.table === 'rpc:collective_close_invitation')!;
    expect((close.payload as { p_reason: string }).p_reason).toBe('withdrawn');
    expect(recording.queryCount({ table: 'rpc:collective_dissolve' })).toBe(0);
  });

  it('an expired request closes the invitation as expired', async () => {
    const recording = db({ model: 'replicas', othersRemain: true });
    await closeInvitationForLink(recording.db, { hostVenueId: HOST, inviteeVenueId: ME, reason: 'expired', actorVenueId: null, actorUserId: null });
    const close = recording.calls.find((c) => c.table === 'rpc:collective_close_invitation')!;
    expect((close.payload as { p_reason: string }).p_reason).toBe('expired');
  });
});

import { loadInvitationsSentByHost, loadMemberWaiting } from './proposed-collectives';

describe('loadInvitationsSentByHost', () => {
  it('keys the host\u2019s open invitations by invitee', async () => {
    const recording = makeRecordingDb((call) => {
      if (call.table === 'venue_collectives') return { data: [{ id: COLLECTIVE, name: 'Northside', slug: 'northside' }] };
      if (call.table === 'venue_collective_members') return { data: [{ venue_id: OTHER, collective_id: COLLECTIVE }] };
      return undefined;
    });
    const sent = await loadInvitationsSentByHost(recording.db, HOST);
    expect(sent.get(OTHER)).toEqual({ id: COLLECTIVE, name: 'Northside', slug: 'northside' });
  });
});

describe('loadMemberWaiting', () => {
  function db(assignments: number) {
    return makeRecordingDb((call) => {
      if (call.table === 'venue_collective_members') return { data: [{ collective_id: COLLECTIVE }] };
      if (call.table === 'venue_collectives') return { data: [{ id: COLLECTIVE, name: 'Northside', host_venue_id: HOST, status: 'active', service_model: 'replicas' }] };
      if (call.table === 'collective_service_items') return { data: [{ id: 'i-1', master_service_id: 'svc-1' }] };
      if (call.table === 'collective_service_replicas') return { data: [] };
      if (call.table === 'calendar_service_assignments') return { data: assignments > 0 ? [{ id: 'a-1' }] : [] };
      if (call.table === 'venues') return { data: { name: 'Zen Studio' } };
      return undefined;
    });
  }

  it('names the host while nothing on the page is bookable', async () => {
    expect(await loadMemberWaiting(db(0).db, ME)).toEqual([{ collectiveId: COLLECTIVE, name: 'Northside', hostName: 'Zen Studio' }]);
  });

  it('is quiet once the page is live', async () => {
    expect(await loadMemberWaiting(db(1).db, ME)).toEqual([]);
  });
});
