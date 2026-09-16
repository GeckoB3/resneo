/**
 * Following each venue's subscription in its collective (N36, N37).
 *
 * The rule is the account links' rule, and the guard is that it only ever acts on a change: a venue
 * that lapsed is suspended once, one that came back is resumed once, and a venue that cannot be
 * read is left alone rather than hidden.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { syncMemberSuspensions } from './collective-suspension';

const NOW = Date.parse('2026-10-01T06:00:00Z');

const activeVenue = (id: string) => ({
  id,
  name: id,
  pricing_tier: 'appointments',
  plan_status: 'active',
  booking_model: 'unified_scheduling',
  subscription_current_period_end: null,
  billing_access_source: null,
});

function world(members: Record<string, unknown>[], venues: Record<string, unknown>[], extra: Responder = () => undefined): Responder {
  return (call) => {
    const injected = extra(call);
    if (injected) return injected;
    if (call.table === 'venue_collectives') return { data: [{ id: 'collective-1' }] };
    if (call.table === 'venue_collective_members') return { data: members };
    if (call.table === 'venues') return { data: venues };
    if (call.table === 'rpc:collective_set_member_suspended') return { data: { changed: true } };
    return undefined;
  };
}

const run = (responder: Responder) => {
  const recording = makeRecordingDb(responder);
  return { recording, outcome: syncMemberSuspensions(recording.db as unknown as SupabaseClient, { now: () => NOW }) };
};

const calls = (recording: ReturnType<typeof makeRecordingDb>) =>
  recording.calls.filter((c) => c.table === 'rpc:collective_set_member_suspended').map((c) => c.payload);

describe('syncMemberSuspensions', () => {
  it('suspends a venue whose payment failed', async () => {
    const { recording, outcome } = run(
      world(
        [{ id: 'm1', venue_id: 'lapsed', suspended_at: null }],
        [{ ...activeVenue('lapsed'), plan_status: 'past_due' }],
      ),
    );
    expect(await outcome).toEqual({ suspended: 1, resumed: 0, errors: 0 });
    expect(calls(recording)).toEqual([{ p_member_id: 'm1', p_suspended: true }]);
  });

  it('resumes a venue whose subscription is active again', async () => {
    const { recording, outcome } = run(
      world([{ id: 'm1', venue_id: 'back', suspended_at: '2026-09-20T06:00:00Z' }], [activeVenue('back')]),
    );
    expect(await outcome).toEqual({ suspended: 0, resumed: 1, errors: 0 });
    expect(calls(recording)).toEqual([{ p_member_id: 'm1', p_suspended: false }]);
  });

  it('leaves alone a venue whose state already matches', async () => {
    const { recording, outcome } = run(
      world(
        [
          { id: 'm1', venue_id: 'fine', suspended_at: null },
          { id: 'm2', venue_id: 'still-lapsed', suspended_at: '2026-09-20T06:00:00Z' },
        ],
        [activeVenue('fine'), { ...activeVenue('still-lapsed'), plan_status: 'past_due' }],
      ),
    );
    expect(await outcome).toEqual({ suspended: 0, resumed: 0, errors: 0 });
    expect(calls(recording)).toEqual([]);
  });

  it('does not hide a venue it could not read', async () => {
    const { recording, outcome } = run(world([{ id: 'm1', venue_id: 'missing', suspended_at: null }], []));
    expect(await outcome).toEqual({ suspended: 0, resumed: 0, errors: 0 });
    expect(calls(recording)).toEqual([]);
  });

  it('keeps going past a refusal, and counts it', async () => {
    const { outcome } = run(
      world(
        [
          { id: 'm1', venue_id: 'a', suspended_at: null },
          { id: 'm2', venue_id: 'b', suspended_at: null },
        ],
        [{ ...activeVenue('a'), plan_status: 'past_due' }, { ...activeVenue('b'), plan_status: 'past_due' }],
        (call) =>
          call.table === 'rpc:collective_set_member_suspended' && (call.payload as { p_member_id: string }).p_member_id === 'm1'
            ? { data: null, error: { message: 'lock timeout' } }
            : undefined,
      ),
    );
    expect(await outcome).toEqual({ suspended: 1, resumed: 0, errors: 1 });
  });

  it('does nothing when no collective is on the new model', async () => {
    const recording = makeRecordingDb((call) => (call.table === 'venue_collectives' ? { data: [] } : undefined));
    expect(await syncMemberSuspensions(recording.db as unknown as SupabaseClient)).toEqual({ suspended: 0, resumed: 0, errors: 0 });
    expect(recording.calls).toHaveLength(1);
  });
});
