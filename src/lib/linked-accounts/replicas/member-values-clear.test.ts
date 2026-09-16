/**
 * Switching a calendar permission off, across the collective (D6, D56, N15).
 *
 * The host's own calendars were already cleared; the members' were not, so an old price could come
 * back at a member the day the host ticks the box again. These pin that every member's calendar is
 * cleared through the engine, and that each member is told once, in its own terms.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

const notifyVenue = vi.fn(async () => ({ emailFailures: 0 }));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyVenue: (...args: unknown[]) => notifyVenue(...(args as [])),
}));

import { clearMemberCalendarValues } from './member-values-clear';

const context = {
  collectiveId: 'collective-1',
  collectiveName: 'Northside',
  hostVenueName: 'Host Venue',
  itemId: 'item-1',
  linkIds: ['link-1'],
  probeLinkId: 'link-1',
};

const before = { staff_may_customize_price: true, staff_may_customize_buffer: true, price_pence: 6000 };
const after = { staff_may_customize_price: false, staff_may_customize_buffer: true, price_pence: 6000 };

const world = (extra: Responder = () => undefined): Responder => (call) => {
  const injected = extra(call);
  if (injected) return injected;
  if (call.table === 'collective_service_replicas') {
    return { data: [{ venue_id: 'member', replica_service_id: 'svc-copy', venues: { name: 'Zen Studio' } }] };
  }
  if (call.table === 'calendar_service_assignments') {
    return {
      data: [
        { calendar_id: 'cal-1', service_item_id: 'svc-copy', custom_price_pence: 7000, unified_calendars: { name: 'Chair 2' } },
        { calendar_id: 'cal-2', service_item_id: 'svc-copy', custom_price_pence: null, unified_calendars: { name: 'Chair 3' } },
      ],
    };
  }
  if (call.table === 'venues') return { data: { currency: 'GBP' } };
  return undefined;
};

const run = (responder: Responder, overrides: Partial<Parameters<typeof clearMemberCalendarValues>[1]> = {}) => {
  const recording = makeRecordingDb(responder);
  return {
    recording,
    result: clearMemberCalendarValues(recording.db as unknown as SupabaseClient, {
      context,
      serviceName: 'Facial',
      before,
      after,
      actorVenueId: 'host',
      actorUserId: null,
      ...overrides,
    }),
  };
};

beforeEach(() => {
  notifyVenue.mockClear();
});

describe('clearMemberCalendarValues', () => {
  it("clears only the member calendars that held a value, through the engine", async () => {
    const { recording, result } = run(world());
    expect(await result).toEqual([
      { venue_id: 'member', venue_name: 'Zen Studio', calendars: ['Chair 2'], fields: ['price'] },
    ]);
    const clears = recording.calls.filter((c) => c.table === 'rpc:collective_set_calendar_values');
    expect(clears).toHaveLength(1);
    expect(clears[0]!.payload).toMatchObject({
      p_calendar_id: 'cal-1',
      p_service_item_id: 'svc-copy',
      p_values: { custom_price_pence: null },
      p_actor_venue_id: 'host',
    });
  });

  it('tells the member once, naming its calendar and the price it now uses', async () => {
    await run(world()).result;
    expect(notifyVenue).toHaveBeenCalledTimes(1);
    const [, venueId, subject, params] = notifyVenue.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      { paragraphs: string[] },
    ];
    expect(venueId).toBe('member');
    expect(subject).toBe('Custom values for Facial were cleared');
    expect(params.paragraphs[0]).toBe(
      'Host Venue no longer lets calendars set their own price for Facial. Chair 2 now uses the standard value, £60.00.',
    );
  });

  it('does nothing when the save switched nothing off', async () => {
    const { recording, result } = run(world(), { after: before });
    expect(await result).toEqual([]);
    expect(recording.calls).toHaveLength(0);
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('does nothing outside a collective, which is every venue today', async () => {
    const { recording, result } = run(world(), { context: null });
    expect(await result).toEqual([]);
    expect(recording.calls).toHaveLength(0);
  });

  it('tells nobody when no member calendar held a value', async () => {
    const { result } = run(
      world((call) =>
        call.table === 'calendar_service_assignments'
          ? { data: [{ calendar_id: 'cal-2', service_item_id: 'svc-copy', custom_price_pence: null }] }
          : undefined,
      ),
    );
    expect(await result).toEqual([]);
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('keeps going past a clear the engine refused, and does not claim it', async () => {
    const { result } = run(
      world((call) =>
        call.table === 'rpc:collective_set_calendar_values'
          ? { data: null, error: { code: 'XX000', message: 'boom' } }
          : undefined,
      ),
    );
    expect(await result).toEqual([]);
    expect(notifyVenue).not.toHaveBeenCalled();
  });
});
