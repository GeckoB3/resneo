/**
 * The work after a release (plan §6.7, RT1-15; UX spec N16 to N18).
 *
 * Each release is followed up once: its photos are copied into the venue's own storage and shown on
 * its own page, the right venues are told why the membership ended, and a copy that fails is tried
 * again before the service is left without a photo. A retry never repeats a notice or a copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type RecordedCall, type Responder } from '@/lib/testing/recording-supabase';

const notifyVenue = vi.fn(async () => ({ emailFailures: 0 }));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyVenue: (...args: unknown[]) => notifyVenue(...(args as [])),
}));
const recordBell = vi.fn(async () => undefined);
vi.mock('@/lib/linked-accounts/replicas/collective-notices', () => ({
  recordBell: (...args: unknown[]) => recordBell(...(args as [])),
}));

import { drainReleaseFollowups, RELEASE_FOLLOWUP_MAX_ATTEMPTS } from './release-followups';

const NOW = Date.parse('2026-10-01T09:00:00Z');
const STORAGE = 'https://project.supabase.co/storage/v1/object/public/venue-service-photos';

const op = (progress: Record<string, unknown>, attempts = 0) => ({
  id: 'op-1',
  collective_id: 'collective-1',
  venue_id: 'member',
  attempts,
  progress,
});

interface WorldOptions {
  itemImage?: string | null;
  hostPhotos?: Record<string, string>;
  memberPhotos?: Record<string, string>;
  copyFails?: boolean;
  claimedElsewhere?: boolean;
}

function setup(ops: Record<string, unknown>[], options: WorldOptions = {}) {
  const {
    itemImage = `${STORAGE}/c/collective-1/cut.png`,
    hostPhotos = {},
    memberPhotos = {},
    copyFails = false,
    claimedElsewhere = false,
  } = options;
  const responder: Responder = (call) => {
    if (call.table === 'collective_operations' && call.op === 'select') return { data: ops };
    if (call.table === 'collective_operations' && call.op === 'update') {
      const claiming = call.filters.some((f) => f[0] === 'eq' && f[1] === 'status' && f[2] === 'pending');
      return { data: claiming && !claimedElsewhere ? { id: 'op-1' } : null };
    }
    if (call.table === 'collective_service_replicas') {
      return {
        data: [
          { replica_service_id: 'svc-cut', collective_service_item_id: 'item-cut' },
          { replica_service_id: 'svc-dye', collective_service_item_id: 'item-dye' },
        ],
      };
    }
    if (call.table === 'collective_service_items') {
      return {
        data: [
          { id: 'item-cut', image_url: itemImage, master_service_id: 'master-cut' },
          { id: 'item-dye', image_url: null, master_service_id: 'master-dye' },
        ],
      };
    }
    if (call.table === 'venue_collectives') {
      return { data: { name: 'Northside', host_venue_id: 'host' } };
    }
    if (call.table === 'venues' && call.op === 'select') {
      const byId = call.filters.find((f) => f[0] === 'eq' && f[1] === 'id');
      if (byId?.[2] === 'host') return { data: { booking_page_config: { service_photos: hostPhotos } } };
      if (byId?.[2] === 'member') return { data: { booking_page_config: { theme: 'x', service_photos: memberPhotos } } };
      return { data: [{ id: 'host', name: 'Host Venue' }, { id: 'member', name: 'Zen Studio' }] };
    }
    if (call.table === 'venue_collective_members') {
      return { data: [{ venue_id: 'host' }, { venue_id: 'third' }] };
    }
    return undefined;
  };
  const recording = makeRecordingDb(responder);
  const copy = vi.fn(async (from: string, to: string) =>
    copyFails ? { data: null, error: { message: 'object not found' } } : { data: { path: to }, error: null, from },
  );
  (recording.db as unknown as { storage: unknown }).storage = {
    from: () => ({
      copy,
      getPublicUrl: (path: string) => ({ data: { publicUrl: `${STORAGE}/${path}` } }),
    }),
  };
  const run = () => drainReleaseFollowups(recording.db as unknown as SupabaseClient, { now: () => NOW });
  return { recording, copy, run };
}

const updates = (calls: RecordedCall[], table: string) => calls.filter((c) => c.table === table && c.op === 'update');
const photoRecords = (calls: RecordedCall[]) =>
  calls.filter((c) => c.table === 'rpc:collective_record_release_photo').map((c) => c.payload as Record<string, unknown>);
const emailed = () =>
  notifyVenue.mock.calls.map((c) => {
    const [, venueId, subject, params] = c as unknown as [unknown, string, string, { ctaLabel?: string }];
    return { venueId, subject, cta: params.ctaLabel ?? null };
  });

beforeEach(() => {
  notifyVenue.mockClear();
  recordBell.mockClear();
});

describe('drainReleaseFollowups: photos', () => {
  it("copies the page's photo into the venue's folder and puts it on the venue's own page", async () => {
    const { recording, copy, run } = setup([op({ reason: 'left', services: ['svc-cut', 'svc-dye'] })]);
    const outcome = await run();
    expect(outcome).toMatchObject({ done: 1, photos_copied: 1, photos_failed: 0 });
    expect(copy).toHaveBeenCalledWith('c/collective-1/cut.png', expect.stringMatching(/^member\/.+\.png$/));

    const venueWrite = updates(recording.calls, 'venues')[0]!.payload as { booking_page_config: Record<string, unknown> };
    expect(venueWrite.booking_page_config.theme).toBe('x');
    expect(venueWrite.booking_page_config.service_photos).toEqual({
      'svc-cut': expect.stringMatching(new RegExp(`^${STORAGE}/member/.+\\.png$`)),
    });
    expect(photoRecords(recording.calls)).toEqual([
      expect.objectContaining({ p_operation_id: 'op-1', p_service_id: 'svc-cut', p_copied: true }),
    ]);
  });

  it("uses the host's own photo for the service when the offering has none", async () => {
    const { copy, run } = setup([op({ reason: 'left', services: ['svc-cut'] })], {
      itemImage: null,
      hostPhotos: { 'master-cut': `${STORAGE}/host/cut.jpg` },
    });
    await run();
    expect(copy).toHaveBeenCalledWith('host/cut.jpg', expect.stringMatching(/^member\/.+\.jpg$/));
  });

  it('never replaces a photo the venue chose itself', async () => {
    const { recording, run } = setup([op({ reason: 'left', services: ['svc-cut'] })], {
      memberPhotos: { 'svc-cut': 'https://example.com/mine.png' },
    });
    await run();
    const venueWrite = updates(recording.calls, 'venues')[0]!.payload as { booking_page_config: Record<string, unknown> };
    expect(venueWrite.booking_page_config.service_photos).toEqual({ 'svc-cut': 'https://example.com/mine.png' });
  });

  it('tries a failed copy again later, telling nobody twice', async () => {
    const { recording, run } = setup([op({ reason: 'left', services: ['svc-cut'] })], { copyFails: true });
    const outcome = await run();
    expect(outcome).toMatchObject({ done: 0, retrying: 1 });
    const last = updates(recording.calls, 'collective_operations').at(-1)!.payload as Record<string, unknown>;
    expect(last).toMatchObject({ status: 'pending', progress: { notified: true, photos_done: [] } });
    expect(photoRecords(recording.calls)).toEqual([]);

    notifyVenue.mockClear();
    const again = setup([op({ reason: 'left', services: ['svc-cut'], notified: true })], { copyFails: true });
    await again.run();
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('gives up on the last try and records the failure, leaving no photo', async () => {
    const { recording, run } = setup(
      [op({ reason: 'left', services: ['svc-cut'], notified: true }, RELEASE_FOLLOWUP_MAX_ATTEMPTS - 1)],
      { copyFails: true },
    );
    const outcome = await run();
    expect(outcome).toMatchObject({ done: 1, photos_failed: 1 });
    expect(photoRecords(recording.calls)).toEqual([
      expect.objectContaining({ p_service_id: 'svc-cut', p_copied: false, p_detail: 'object not found' }),
    ]);
    expect(updates(recording.calls, 'venues')).toHaveLength(0);
  });

  it('does not copy again what an earlier try already copied', async () => {
    const { copy, run } = setup([op({ reason: 'left', services: ['svc-cut'], photos_done: ['svc-cut'], notified: true })]);
    await run();
    expect(copy).not.toHaveBeenCalled();
  });
});

describe('drainReleaseFollowups: notices', () => {
  it('N16: emails the host and rings the other venues when a venue leaves', async () => {
    await setup([op({ reason: 'left', services: [] })]).run();
    expect(emailed()).toEqual([{ venueId: 'host', subject: 'Zen Studio left Northside', cta: null }]);
    expect(recordBell.mock.calls.map((c) => (c as unknown as [unknown, string])[1])).toEqual(['third']);
  });

  it('N17: tells a removed venue, with the way to its review', async () => {
    await setup([op({ reason: 'removed', services: [] })]).run();
    expect(emailed()).toEqual([
      { venueId: 'member', subject: 'You are no longer part of Northside', cta: 'Review your services' },
    ]);
    expect(recordBell).not.toHaveBeenCalled();
  });

  it('N18: tells the venue and the host when a link ended', async () => {
    await setup([op({ reason: 'link_ended', services: [] })]).run();
    expect(emailed().map((e) => e.venueId)).toEqual(['member', 'host']);
    expect(emailed()[0]!.subject).toBe('Zen Studio left Northside because a link ended');
  });

  it("names a deleted venue in the host's notice, and copies no photos for it", async () => {
    const deleted = { ...op({ reason: 'venue_deleted', services: ['svc-cut'], venue_name: 'Gone Studio' }), venue_id: 'deleted' };
    const { copy, run } = setup([deleted], {});
    await run();
    expect(copy).not.toHaveBeenCalled();
    expect(emailed()[0]).toEqual({ venueId: 'host', subject: 'Gone Studio left Northside', cta: null });
  });

  it('sends nothing for a collective that ended, which has its own notice (N19)', async () => {
    const { run } = setup([op({ reason: 'dissolved', services: [] })]);
    expect(await run()).toMatchObject({ done: 1 });
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('skips a follow-up another run has claimed', async () => {
    const { copy, run } = setup([op({ reason: 'left', services: ['svc-cut'] })], { claimedElsewhere: true });
    expect(await run()).toMatchObject({ done: 0, retrying: 0 });
    expect(copy).not.toHaveBeenCalled();
    expect(notifyVenue).not.toHaveBeenCalled();
  });
});

describe('drainReleaseFollowups: scope', () => {
  it('runs only the jobs it was given, straight after an action', async () => {
    const { recording } = setup([]);
    const outcome = await drainReleaseFollowups(recording.db as unknown as SupabaseClient, { operationIds: [] });
    expect(outcome.done).toBe(0);
    expect(recording.calls).toHaveLength(0);
  });
});
