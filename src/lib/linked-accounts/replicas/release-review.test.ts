/**
 * "Review your services" after a release (plan contract 7; UX spec J7 to J9).
 *
 * The panel is read from the release's own audit row: what came from the host, what needs the
 * venue's attention now, and how the photos went. It disappears once dismissed, until a later
 * release.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { dismissReleaseReview, loadReleaseReview } from './release-review';

const RELEASED_AT = '2026-10-01T08:00:00Z';
const NOW = Date.parse('2026-10-02T08:00:00Z');

interface WorldOptions {
  mark?: string | null;
  stripe?: boolean;
  opStatus?: string;
  photoEvents?: string[];
  side?: string;
}

function world({ mark = null, stripe = true, opStatus = 'done', photoEvents = [], side = 'member' }: WorldOptions = {}): Responder {
  return (call) => {
    if (call.table === 'collective_audit_events') {
      const photos = call.filters.some((f) => f[0] === 'in' && f[1] === 'event_type');
      if (photos) return { data: photoEvents.map((event_type) => ({ event_type })) };
      return {
        data: [
          {
            id: 'audit-1',
            collective_id: 'collective-1',
            collective_name: 'Northside',
            created_at: RELEASED_AT,
            changes: {
              after: {
                side,
                reason: 'removed',
                services: ['svc-cut', 'svc-online', 'svc-old'],
                downgraded: [],
                unparked: ['own-1', 'own-2'],
              },
            },
          },
        ],
      };
    }
    if (call.table === 'collective_notice_marks') return { data: mark ? { sent_through: mark } : null };
    if (call.table === 'venue_collectives') return { data: { host_venue_id: 'host' } };
    if (call.table === 'venues') {
      const byHost = call.filters.some((f) => f[0] === 'eq' && f[1] === 'id' && f[2] === 'host');
      return { data: byHost ? { name: 'Host Venue' } : { stripe_charges_enabled: stripe } };
    }
    if (call.table === 'service_items') {
      const released = call.filters.some((f) => f[0] === 'in' && f[1] === 'id');
      if (released) {
        return {
          data: [
            { id: 'svc-cut', name: 'Haircut', is_active: true, location_type: 'business_venue', payment_requirement: 'deposit' },
            { id: 'svc-online', name: 'Consultation', is_active: true, location_type: 'online', online_meeting_url: null },
            { id: 'svc-old', name: 'Old', is_active: false, location_type: 'online', online_meeting_url: null },
          ],
        };
      }
      return { data: [{ id: 'svc-cut', name: 'Haircut' }, { id: 'mine', name: ' haircut ' }, { id: 'svc-online', name: 'Consultation' }] };
    }
    if (call.table === 'collective_operations') return { data: [{ status: opStatus, created_at: RELEASED_AT }] };
    return undefined;
  };
}

const load = (options?: WorldOptions) =>
  loadReleaseReview(makeRecordingDb(world(options)).db as unknown as SupabaseClient, 'member', { now: () => NOW });

describe('loadReleaseReview', () => {
  it('lists what to check after the release', async () => {
    expect(await load()).toEqual({
      collective_id: 'collective-1',
      collective_name: 'Northside',
      host_name: 'Host Venue',
      reason: 'removed',
      released_at: RELEASED_AT,
      prices: 3,
      link: 1,
      stripe: false,
      library: true,
      photos: null,
      sameName: ['Haircut'],
      unparked: 2,
    });
  });

  it('asks for Stripe when a service takes a payment the venue cannot take', async () => {
    expect((await load({ stripe: false }))?.stripe).toBe(true);
  });

  it('says how the photos went', async () => {
    expect((await load({ opStatus: 'pending' }))?.photos).toBe('copying');
    expect((await load({ photoEvents: ['photo_copied'] }))?.photos).toBe('done');
    expect((await load({ photoEvents: ['photo_copied', 'photo_copy_failed'] }))?.photos).toBe('failed');
  });

  it('is gone once dismissed, and ignores the host-side row', async () => {
    expect(await load({ mark: RELEASED_AT })).toBeNull();
    expect(await load({ mark: '2026-09-01T00:00:00Z' })).not.toBeNull();
    expect(await load({ side: 'host' })).toBeNull();
  });

  it('only looks back 30 days', async () => {
    const recording = makeRecordingDb(world());
    await loadReleaseReview(recording.db as unknown as SupabaseClient, 'member', { now: () => NOW });
    const read = recording.calls.find((c) => c.table === 'collective_audit_events')!;
    expect(read.filters).toContainEqual(['gte', 'created_at', '2026-09-02T08:00:00.000Z']);
    expect(read.filters).toContainEqual(['eq', 'target_venue_id', 'member']);
  });
});

describe('dismissReleaseReview', () => {
  it('marks the release as reviewed', async () => {
    const recording = makeRecordingDb();
    await dismissReleaseReview(recording.db as unknown as SupabaseClient, 'member', 'collective-1', RELEASED_AT);
    expect(recording.calls[0]).toMatchObject({
      table: 'collective_notice_marks',
      op: 'upsert',
      payload: { collective_id: 'collective-1', venue_id: 'member', kind: 'review', sent_through: RELEASED_AT },
    });
  });
});
