/**
 * Sending the notices the engine queues (UX spec §4 N19 to N23).
 *
 * The drain must send each queued notice once, to the right venues, and never twice even when two
 * runs overlap; a notice it cannot send is retried later and eventually given up on loudly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

const notifyVenue = vi.fn(async () => ({ emailFailures: 0 }));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyVenue: (...args: unknown[]) => notifyVenue(...(args as [])),
}));

import { drainOperationNotices, noticeDate } from './collective-operation-notices';

const NOW = Date.parse('2026-10-01T09:00:00Z');

const op = (notice: string, overrides: Record<string, unknown> = {}) => ({
  id: 'op-1',
  collective_id: 'collective-1',
  venue_id: 'member',
  attempts: 0,
  progress: { notice },
  ...overrides,
});

function world(ops: Record<string, unknown>[], extra: Responder = () => undefined): Responder {
  return (call) => {
    const injected = extra(call);
    if (injected) return injected;
    if (call.table === 'collective_operations' && call.op === 'select') return { data: ops };
    if (call.table === 'collective_operations' && call.op === 'update') {
      // The claim returns the row it moved to running.
      const claiming = call.filters.some((f) => f[0] === 'eq' && f[1] === 'status' && f[2] === 'pending');
      return claiming ? { data: { id: 'op-1' } } : { data: null };
    }
    if (call.table === 'venue_collectives') {
      return {
        data: {
          id: 'collective-1',
          name: 'Northside',
          host_venue_id: 'host',
          dissolved_at: '2026-10-01T08:00:00Z',
          paused_at: '2026-10-01T08:00:00Z',
        },
      };
    }
    if (call.table === 'venues') {
      return { data: [{ id: 'host', name: 'Host Venue' }, { id: 'member', name: 'Zen Studio' }] };
    }
    if (call.table === 'venue_collective_members') {
      const leftOnly = call.filters.some((f) => f[0] === 'eq' && f[1] === 'status' && f[2] === 'left');
      if (leftOnly) {
        return {
          data: [
            { venue_id: 'host', left_at: '2026-10-01T08:00:00Z' },
            { venue_id: 'member', left_at: '2026-10-01T08:00:00Z' },
            { venue_id: 'old-leaver', left_at: '2026-01-01T08:00:00Z' },
          ],
        };
      }
      return { data: [{ venue_id: 'host' }, { venue_id: 'member' }, { venue_id: 'third' }] };
    }
    return undefined;
  };
}

const drain = (responder: Responder) => {
  const recording = makeRecordingDb(responder);
  return { recording, outcome: drainOperationNotices(recording.db as unknown as SupabaseClient, { now: () => NOW }) };
};

const told = () => notifyVenue.mock.calls.map((c) => (c as unknown as [unknown, string, string])[1]);
const subjects = () => notifyVenue.mock.calls.map((c) => (c as unknown as [unknown, string, string])[2]);

beforeEach(() => {
  notifyVenue.mockClear();
});

describe('drainOperationNotices', () => {
  it('tells the venue that was asked to host (N20)', async () => {
    const { outcome } = drain(world([op('N20', { progress: { notice: 'N20', host_venue_id: 'host' } })]));
    expect(await outcome).toEqual({ sent: 1, failed: 0 });
    expect(told()).toEqual(['member']);
    expect(subjects()).toEqual(['Host Venue asked you to host Northside']);
  });

  it('tells every live venue the day hosting moves (N21)', async () => {
    const { outcome } = drain(
      world([op('N21', { progress: { notice: 'N21', host_transfer_at: '2026-10-15T09:00:00Z' } })]),
    );
    await outcome;
    expect(told()).toEqual(['host', 'member', 'third']);
    expect(subjects()[0]).toBe('Zen Studio will host Northside from 15 October');
  });

  it('tells every live venue hosting has moved (N22)', async () => {
    await drain(world([op('N22')])).outcome;
    expect(subjects()[0]).toBe('Zen Studio now hosts Northside');
  });

  it("tells the others the page is paused, with the day it would end (N23)", async () => {
    await drain(world([op('N23', { venue_id: 'host' })])).outcome;
    expect(told()).toEqual(['member', 'third']);
    const body = (notifyVenue.mock.calls[0] as unknown as [unknown, string, string, { paragraphs: string[] }])[3]
      .paragraphs[0];
    expect(body).toContain('before 31 October');
  });

  it('tells the venues that were live when it ended, not the host or old leavers (N19)', async () => {
    await drain(world([op('N19', { venue_id: 'host' })])).outcome;
    expect(told()).toEqual(['member']);
    expect(subjects()).toEqual(['Northside has ended']);
  });

  it("emails a member that its calendars are hidden, and only rings when they are back (N36, N37)", async () => {
    await drain(world([op('N36')])).outcome;
    expect(told()).toEqual(['member']);
    expect(subjects()).toEqual(['Your calendars are hidden from the Northside page']);

    notifyVenue.mockClear();
    const back = drain(world([op('N37')]));
    await back.outcome;
    expect(notifyVenue).not.toHaveBeenCalled();
    const bell = back.recording.calls.find((c) => c.table === 'account_link_notifications');
    expect(bell?.payload).toMatchObject({
      venue_id: 'member',
      payload: { title: 'Your calendars are back on the Northside page' },
    });
  });

  it('asks a member about its service, with the way to answer (N26)', async () => {
    const { outcome } = drain(
      world([op('N26', { progress: { notice: 'N26', item_id: 'item-1', source_service_id: 'svc-1' } })], (call) =>
        call.table === 'service_items' ? { data: { name: 'Balayage' } } : undefined,
      ),
    );
    await outcome;
    expect(told()).toEqual(['member']);
    expect(subjects()).toEqual(['Host Venue wants to use your Balayage']);
    const params = (notifyVenue.mock.calls[0] as unknown as [unknown, string, string, { ctaUrl: string; ctaLabel: string }])[3];
    expect(params.ctaUrl).toMatch(/\/dashboard\/appointment-services\?adopt=item-1$/);
    expect(params.ctaLabel).toBe('Choose on your Services page');
  });

  it('skips the day-7 reminder when the member has already answered (N26)', async () => {
    const { recording, outcome } = drain(
      world(
        [op('N26', { progress: { notice: 'N26', item_id: 'item-1', source_service_id: 'svc-1', reminder: true } })],
        (call) => (call.table === 'rpc:collective_adoption_pending' ? { data: null } : undefined),
      ),
    );
    expect(await outcome).toEqual({ sent: 1, failed: 0 });
    expect(notifyVenue).not.toHaveBeenCalled();
    const updates = recording.calls.filter((c) => c.table === 'collective_operations' && c.op === 'update');
    expect((updates.at(-1)!.payload as { status: string }).status).toBe('done');
  });

  it('marks a sent notice done', async () => {
    const { recording, outcome } = drain(world([op('N22')]));
    await outcome;
    const updates = recording.calls.filter((c) => c.table === 'collective_operations' && c.op === 'update');
    expect(updates.map((u) => (u.payload as { status: string }).status)).toEqual(['running', 'done']);
  });

  it('skips a notice another run has already claimed', async () => {
    const { outcome } = drain(
      world([op('N22')], (call) =>
        call.table === 'collective_operations' && call.op === 'update' ? { data: null } : undefined,
      ),
    );
    expect(await outcome).toEqual({ sent: 0, failed: 0 });
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('retries a notice it could not send, and gives up after five tries', async () => {
    const unknown = drain(world([op('N99')]));
    expect(await unknown.outcome).toEqual({ sent: 0, failed: 1 });
    const retry = unknown.recording.calls.filter((c) => c.table === 'collective_operations' && c.op === 'update').at(-1)!;
    expect(retry.payload).toMatchObject({ status: 'pending', last_error: 'unknown notice N99' });

    const lastTry = drain(world([op('N99', { attempts: 4 })]));
    await lastTry.outcome;
    const given = lastTry.recording.calls.filter((c) => c.table === 'collective_operations' && c.op === 'update').at(-1)!;
    expect(given.payload).toMatchObject({ status: 'failed', next_attempt_at: null });
  });
});

describe('noticeDate', () => {
  it('reads as a UK venue would say it', () => {
    expect(noticeDate('2026-10-15T09:00:00Z')).toBe('15 October');
    expect(noticeDate(null)).toBe('soon');
  });
});
