/**
 * PUB-01: own pages, the host's included, hand over only when the venue is really bookable on the
 * collective page. The decision is derived from state and reads no `solo_page_behavior`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/catalogue', () => ({ loadPublicCombinedCatalogue: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-venue-locks', () => ({ findCollectiveLockForVenue: vi.fn() }));

import { loadPublicCombinedCatalogue } from '@/lib/linked-accounts/catalogue';
import { findCollectiveLockForVenue } from '@/lib/linked-accounts/collective-venue-locks';
import { handoverUrl, resolveOwnPageHandover } from './page-handover';

const COLLECTIVE = 'col-1';
const HOST = 'host';
const MEMBER = 'member';

interface World {
  model?: string;
  pausedAt?: string | null;
  pageMode?: string;
  /** Venues with at least one calendar listed for guests. */
  listed?: string[];
  eligible?: string[];
  noItems?: boolean;
  catalogueGone?: boolean;
  memberBehind?: boolean;
  memberModels?: string[];
  adoptedVenueId?: string | null;
}

function setUp(venueId: string, w: World = {}) {
  const {
    model = 'replicas',
    pausedAt = null,
    pageMode = 'unified_catalog',
    listed = [HOST, MEMBER],
    eligible = [HOST, MEMBER],
    noItems = false,
    catalogueGone = false,
    memberBehind = false,
    memberModels = ['unified_scheduling'],
    adoptedVenueId = null,
  } = w;
  vi.mocked(findCollectiveLockForVenue).mockResolvedValue({ collectiveId: COLLECTIVE, collectiveName: 'Northside', hostVenueId: HOST });
  vi.mocked(loadPublicCombinedCatalogue).mockResolvedValue(
    catalogueGone
      ? null
      : ({
          venueData: Object.fromEntries(eligible.map((v) => [v, {}])),
          items: noItems
            ? []
            : [
                { id: 'offer-cut', providers: listed.map((v) => ({ venueId: v })) },
                { id: 'offer-colour', providers: [] },
              ],
        } as never),
  );
  const recording = makeRecordingDb((call) => {
    if (call.table === 'venue_collectives') {
      return {
        data: {
          id: COLLECTIVE,
          name: 'Northside',
          slug: 'northside',
          host_venue_id: HOST,
          service_model: model,
          page_mode: pageMode,
          paused_at: pausedAt,
          slug_strategy: adoptedVenueId ? 'adopt_member' : 'dedicated',
          adopted_venue_id: adoptedVenueId,
          solo_page_behavior: 'keep_live',
        },
      };
    }
    if (call.table === 'venues') {
      return {
        data: [
          { id: HOST, name: 'Host Venue', slug: 'host-venue', booking_model: 'unified_scheduling', active_booking_models: ['unified_scheduling'] },
          { id: MEMBER, name: 'Zen Studio', slug: 'zen', booking_model: 'unified_scheduling', active_booking_models: memberModels },
        ],
      };
    }
    if (call.table === 'collective_service_replicas') {
      return { data: [{ applied_revision: memberBehind ? 2 : 3, desired_revision: 3 }] };
    }
    return undefined;
  });
  return { db: recording.db as unknown as SupabaseClient, calls: recording.calls, venueId };
}

const decide = async (venueId: string, w: World = {}) => {
  const { db, calls } = setUp(venueId, w);
  return { handover: await resolveOwnPageHandover(db, venueId), calls };
};

beforeEach(() => {
  vi.mocked(findCollectiveLockForVenue).mockReset();
  vi.mocked(loadPublicCombinedCatalogue).mockReset();
});

describe('resolveOwnPageHandover for a member', () => {
  it('hands over when the page is live, the member is listed and its replicas have converged', async () => {
    const { handover, calls } = await decide(MEMBER);
    expect(handover).toMatchObject({ redirect: true, reason: null, publicPath: '/book/c/northside', ownPath: '/book/zen', isHost: false });
    // Derived, never the stored choice: the row said keep_live and the page still hands over.
    expect(calls.some((c) => c.table === 'venue_collective_members')).toBe(false);
  });

  it('shows the own page, with the reason, in every other case', async () => {
    expect((await decide(MEMBER, { noItems: true })).handover).toMatchObject({ redirect: false, reason: 'notLive' });
    expect((await decide(MEMBER, { eligible: [MEMBER] })).handover).toMatchObject({ redirect: false, reason: 'notLive' });
    expect((await decide(MEMBER, { catalogueGone: true })).handover).toMatchObject({ redirect: false, reason: 'notLive' });
    expect((await decide(MEMBER, { pausedAt: '2026-10-01T00:00:00Z' })).handover).toMatchObject({ redirect: false, reason: 'paused' });
    expect((await decide(MEMBER, { listed: [HOST] })).handover).toMatchObject({ redirect: false, reason: 'noCalendars' });
    expect((await decide(MEMBER, { memberBehind: true })).handover).toMatchObject({ redirect: false, reason: 'settingUp' });
  });

  it('has no view after leaving, or on the older model', async () => {
    vi.mocked(findCollectiveLockForVenue).mockResolvedValue(null);
    expect(await resolveOwnPageHandover(makeRecordingDb(() => undefined).db as unknown as SupabaseClient, MEMBER)).toBeNull();
    expect((await decide(MEMBER, { model: 'legacy_copies' })).handover).toBeNull();
  });

  it('names the other booking types that stay on the own page', async () => {
    const { handover } = await decide(MEMBER, { memberModels: ['unified_scheduling', 'class_session', 'resource_booking'] });
    expect(handover).toMatchObject({ redirect: true, otherModels: 'classes and bookable rooms' });
  });
});

describe('resolveOwnPageHandover for the host', () => {
  it('hands over while live with a host calendar listed, with no convergence condition', async () => {
    const { handover, calls } = await decide(HOST, { memberBehind: true });
    expect(handover).toMatchObject({ redirect: true, isHost: true });
    expect(calls.some((c) => c.table === 'collective_service_replicas')).toBe(false);
  });

  it('shows its own services again while the page is paused, or when none of its calendars is listed', async () => {
    expect((await decide(HOST, { pausedAt: '2026-10-01T00:00:00Z' })).handover).toMatchObject({ redirect: false, reason: 'paused' });
    expect((await decide(HOST, { listed: [MEMBER] })).handover).toMatchObject({ redirect: false, reason: 'noCalendars' });
  });

  it('points at an adopted address when there is one', async () => {
    const { handover } = await decide(HOST, { adoptedVenueId: MEMBER });
    expect(handover?.publicPath).toBe('/book/zen');
  });
});

describe('handoverUrl (PUB-02)', () => {
  const query = (params: Record<string, string>) => ({ get: (k: string) => params[k] ?? null });

  it('keeps the date, time and step, the calendar, and the offering a replica stands for', async () => {
    const { db } = setUp(MEMBER);
    const handover = (await resolveOwnPageHandover(db, MEMBER))!;
    const recording = makeRecordingDb((call) => {
      if (call.table === 'collective_service_replicas') return { data: [{ collective_service_item_id: 'offer-cut' }] };
      return { data: [] };
    });
    const url = await handoverUrl(
      recording.db as unknown as SupabaseClient,
      handover,
      MEMBER,
      query({ service_id: 'replica-cut', start: 'time', date: '2026-10-12', time: '10:00', ignored: 'x' }),
      'cal-zen-1',
    );
    expect(url).toBe('/book/c/northside?service_id=offer-cut&date=2026-10-12&time=10%3A00&start=time&calendar=cal-zen-1');
  });

  it('lands a parked or unlisted service on the service list, dropping the time step', async () => {
    const { db } = setUp(MEMBER);
    const handover = (await resolveOwnPageHandover(db, MEMBER))!;
    // A master whose offering has no providers on the page (staff only, or nobody listed).
    const recording = makeRecordingDb((call) => {
      if (call.table === 'collective_service_items') return { data: [{ id: 'offer-colour' }] };
      return { data: [] };
    });
    const url = await handoverUrl(
      recording.db as unknown as SupabaseClient,
      handover,
      MEMBER,
      query({ service_id: 'parked', start: 'time', date: '2026-10-12' }),
    );
    expect(url).toBe('/book/c/northside?date=2026-10-12');
  });
});
