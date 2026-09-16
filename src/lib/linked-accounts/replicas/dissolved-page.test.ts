/**
 * The old address after a collective ends (D25, DL4; contract 9).
 *
 * For 90 days the page lists the venues that were part of the collective when it ended, except any
 * that opted out, and never a venue that had left before. Each such venue can change its choice;
 * nobody else can. After 90 days the address is let go.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import {
  loadDissolvedPage,
  loadEndedCollectivesForVenue,
  releaseExpiredDissolvedAddresses,
  setListOnOldPage,
} from './dissolved-page';

const ENDED = '2026-10-01T09:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const inWindow = () => Date.parse(ENDED) + 10 * DAY;
const afterWindow = () => Date.parse(ENDED) + 91 * DAY;

const collective = {
  id: 'collective-1',
  name: 'Northside',
  branding: { logo_url: null, primary_colour: '#112233' },
  booking_page_config: { brand_primary: '#445566' },
  status: 'dissolved',
  dissolved_at: ENDED,
};

// left_at is written by the engine as the same instant, though Postgres may print it differently.
const members = [
  { id: 'm-host', venue_id: 'host', list_on_old_page: true, left_at: '2026-10-01T09:00:00+00:00' },
  { id: 'm-zen', venue_id: 'zen', list_on_old_page: true, left_at: ENDED },
  { id: 'm-quiet', venue_id: 'quiet', list_on_old_page: false, left_at: ENDED },
  { id: 'm-earlier', venue_id: 'earlier', list_on_old_page: true, left_at: '2026-09-01T09:00:00Z' },
];

function world(overrides: Record<string, unknown> = {}): Responder {
  return (call) => {
    if (call.table === 'venue_collectives' && call.op === 'select') {
      const row = { ...collective, ...overrides };
      const many = call.filters.some((f) => f[0] === 'in' || f[0] === 'lt');
      return { data: many ? [row] : row };
    }
    if (call.table === 'venue_collective_members' && call.op === 'select') {
      const venue = call.filters.find((f) => f[0] === 'eq' && f[1] === 'venue_id')?.[2];
      const rows = venue
        ? members.filter((m) => m.venue_id === venue).map((m) => ({ ...m, collective_id: 'collective-1' }))
        : members;
      return { data: rows };
    }
    if (call.table === 'venues') {
      const ids = (call.filters.find((f) => f[0] === 'in')?.[2] as string[]) ?? [];
      const all = [
        { id: 'host', name: 'Host Venue', slug: 'host-venue' },
        { id: 'zen', name: 'Zen Studio', slug: null },
        { id: 'quiet', name: 'Quiet', slug: 'quiet' },
        { id: 'earlier', name: 'Earlier', slug: 'earlier' },
      ];
      return { data: all.filter((v) => ids.includes(v.id)) };
    }
    return undefined;
  };
}

const db = (responder: Responder) => {
  const recording = makeRecordingDb(responder);
  return { recording, admin: recording.db as unknown as SupabaseClient };
};

describe('loadDissolvedPage', () => {
  it('lists the venues that were part of it at the end and did not opt out', async () => {
    const { admin } = db(world());
    expect(await loadDissolvedPage(admin, 'Northside', { now: inWindow })).toEqual({
      name: 'Northside',
      branding: { logo_url: null, primary_colour: '#445566' },
      venues: [
        { name: 'Host Venue', slug: 'host-venue' },
        { name: 'Zen Studio', slug: null },
      ],
    });
  });

  it('shows nothing after 90 days, or for a collective that has not ended', async () => {
    expect(await loadDissolvedPage(db(world()).admin, 'northside', { now: afterWindow })).toBeNull();
    expect(await loadDissolvedPage(db(world({ status: 'active' })).admin, 'northside', { now: inWindow })).toBeNull();
  });
});

describe('loadEndedCollectivesForVenue', () => {
  it("gives a venue that was part of it at the end its choice", async () => {
    const { admin } = db(world());
    expect(await loadEndedCollectivesForVenue(admin, 'quiet', { now: inWindow })).toEqual([
      { collective_id: 'collective-1', name: 'Northside', dissolved_at: ENDED, list_on_old_page: false },
    ]);
  });

  it('leaves out a venue that left before the end, and every venue after 90 days', async () => {
    expect(await loadEndedCollectivesForVenue(db(world()).admin, 'earlier', { now: inWindow })).toEqual([]);
    expect(await loadEndedCollectivesForVenue(db(world()).admin, 'zen', { now: afterWindow })).toEqual([]);
  });
});

describe('setListOnOldPage', () => {
  it("changes only the venue's own row from the end", async () => {
    const { admin, recording } = db(world());
    expect(await setListOnOldPage(admin, 'collective-1', 'zen', false, { now: inWindow })).toBe(true);
    const write = recording.calls.find((c) => c.op === 'update')!;
    expect(write.payload).toEqual({ list_on_old_page: false });
    expect(write.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'venue_id', 'zen'],
        ['eq', 'status', 'left'],
        ['eq', 'left_at', ENDED],
      ]),
    );
  });

  it('refuses a venue that was not part of it at the end', async () => {
    const { admin, recording } = db(world());
    expect(await setListOnOldPage(admin, 'collective-1', 'earlier', false, { now: inWindow })).toBe(false);
    expect(recording.calls.some((c) => c.op === 'update')).toBe(false);
  });
});

describe('releaseExpiredDissolvedAddresses', () => {
  it('lets the address go after 90 days, once', async () => {
    const { admin, recording } = db(world({ slug: 'northside' }));
    expect(await releaseExpiredDissolvedAddresses(admin, { now: afterWindow })).toEqual({ released: 1, errors: 0 });
    const write = recording.calls.find((c) => c.op === 'update')!;
    expect(write.payload).toEqual({ slug: 'dissolved-collective-1' });
    const read = recording.calls.find((c) => c.table === 'venue_collectives' && c.op === 'select')!;
    expect(read.filters).toContainEqual(['lt', 'dissolved_at', new Date(afterWindow() - 90 * DAY).toISOString()]);

    const done = db(world({ slug: 'dissolved-collective-1' }));
    expect(await releaseExpiredDissolvedAddresses(done.admin, { now: afterWindow })).toEqual({ released: 0, errors: 0 });
  });
});
