/**
 * Telling venues when an update will not go through (UX spec §4 N5).
 *
 * The notice has to arrive once per incident and once a day while it lasts, and never every five
 * minutes: a cron that emails the host each run would train it to ignore the one that matters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

const notifyVenue = vi.fn(async () => ({ emailFailures: 0 }));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyVenue: (...args: unknown[]) => notifyVenue(...(args as [])),
}));

import {
  failureNoticeDue,
  notifyFailingLinks,
  RENOTIFY_AFTER_MS,
  STUCK_AFTER_MS,
  type StuckLinkRow,
} from './collective-failure-notices';

const NOW = Date.parse('2026-09-16T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const link = (overrides: Partial<StuckLinkRow> = {}): StuckLinkRow => ({
  id: 'link-1',
  collective_id: 'collective-1',
  collective_service_item_id: 'item-1',
  venue_id: 'member',
  behind_since: ago(STUCK_AFTER_MS + 1),
  attempts: 0,
  last_error_code: null,
  failure_notified_at: null,
  ...overrides,
});

describe('failureNoticeDue', () => {
  it('is due once a link has been behind for 15 minutes', () => {
    expect(failureNoticeDue(link(), NOW)).toBe(true);
    expect(failureNoticeDue(link({ behind_since: ago(STUCK_AFTER_MS - 1000) }), NOW)).toBe(false);
  });

  it('is due after three failures, however recent', () => {
    expect(failureNoticeDue(link({ behind_since: ago(60_000), attempts: 3 }), NOW)).toBe(true);
    expect(failureNoticeDue(link({ behind_since: ago(60_000), attempts: 2 }), NOW)).toBe(false);
  });

  it('is not due again the same day for the same incident', () => {
    // Behind for two hours, told an hour ago: the same incident, already reported today.
    expect(
      failureNoticeDue(
        link({ behind_since: ago(2 * 60 * 60 * 1000), failure_notified_at: ago(60 * 60 * 1000) }),
        NOW,
      ),
    ).toBe(false);
  });

  it('is due again a day later while the incident is still open', () => {
    expect(
      failureNoticeDue(link({ behind_since: ago(RENOTIFY_AFTER_MS * 2), failure_notified_at: ago(RENOTIFY_AFTER_MS) }), NOW),
    ).toBe(true);
  });

  it('treats a new incident as new, even an hour after the last notice', () => {
    expect(
      failureNoticeDue(
        link({ behind_since: ago(STUCK_AFTER_MS + 1000), failure_notified_at: ago(60 * 60 * 1000) }),
        NOW,
      ),
    ).toBe(true);
  });
});

const world = (extra: Responder = () => undefined): Responder => (call) => {
  const injected = extra(call);
  if (injected) return injected;
  if (call.table === 'collective_service_replicas' && call.op === 'select') {
    return {
      data: [
        { ...link(), applied_revision: 1, desired_revision: 2, last_error_code: 'lock_timeout' },
        { ...link({ id: 'link-2', collective_service_item_id: 'item-2' }), applied_revision: 1, desired_revision: 2 },
        // Caught up since it failed: no longer an incident.
        { ...link({ id: 'link-3' }), applied_revision: 2, desired_revision: 2 },
      ],
    };
  }
  if (call.table === 'venue_collectives') {
    return { data: [{ id: 'collective-1', name: 'Northside', host_venue_id: 'host', status: 'active' }] };
  }
  if (call.table === 'collective_service_items') {
    return {
      data: [
        { id: 'item-1', service_items: { name: 'Facial' } },
        { id: 'item-2', service_items: { name: 'Massage' } },
      ],
    };
  }
  if (call.table === 'venues') {
    return { data: [{ id: 'member', name: 'Zen Studio' }, { id: 'host', name: 'Host Venue' }] };
  }
  return undefined;
};

const run = (responder: Responder) => {
  const recording = makeRecordingDb(responder);
  return { recording, outcome: notifyFailingLinks(recording.db as unknown as SupabaseClient, { now: () => NOW }) };
};

beforeEach(() => {
  notifyVenue.mockClear();
});

describe('notifyFailingLinks', () => {
  it('emails the host once for the venue, naming every service stuck there and why', async () => {
    const { outcome } = run(world());
    expect(await outcome).toEqual({ links: 2, hostNotices: 1, memberNotices: 1 });
    const [, venueId, subject, params] = notifyVenue.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      { paragraphs: string[] },
    ];
    expect(venueId).toBe('host');
    expect(subject).toBe('Facial and Massage could not be updated at Zen Studio');
    expect(params.paragraphs[0]).toContain('Zen Studio was busy');
  });

  it('rings the member without emailing it', async () => {
    const { recording, outcome } = run(world());
    await outcome;
    // The only email is the host's.
    expect(notifyVenue.mock.calls.map((call) => (call as unknown as [unknown, string])[1])).toEqual(['host']);
    const bells = recording.calls.filter((c) => c.table === 'account_link_notifications');
    expect(bells.map((c) => (c.payload as { venue_id: string }).venue_id)).toEqual(['member']);
    expect((bells[0]!.payload as { payload: { title: string } }).payload.title).toBe(
      'Facial and Massage from Host Venue are not up to date',
    );
  });

  it('records that the venues were told, so the next run is quiet', async () => {
    const { recording, outcome } = run(world());
    await outcome;
    const stamp = recording.calls.find((c) => c.table === 'collective_service_replicas' && c.op === 'update');
    expect(stamp?.payload).toEqual({ failure_notified_at: new Date(NOW).toISOString() });
    expect(stamp?.filters).toContainEqual(['in', 'id', ['link-1', 'link-2']]);
    const bell = recording.calls.find((c) => c.table === 'account_link_notifications');
    expect((bell?.payload as { venue_id: string }).venue_id).toBe('member');
  });

  it('says nothing about a collective that has ended', async () => {
    const { outcome } = run(
      world((call) =>
        call.table === 'venue_collectives'
          ? { data: [{ id: 'collective-1', name: 'Northside', host_venue_id: 'host', status: 'dissolved' }] }
          : undefined,
      ),
    );
    expect(await outcome).toEqual({ links: 0, hostNotices: 0, memberNotices: 0 });
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('does nothing when nothing is stuck, which is every collective today', async () => {
    const { recording, outcome } = run((call) =>
      call.table === 'collective_service_replicas' ? { data: [] } : undefined,
    );
    expect(await outcome).toEqual({ links: 0, hostNotices: 0, memberNotices: 0 });
    expect(recording.calls).toHaveLength(1);
  });
});
