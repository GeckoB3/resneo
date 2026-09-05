import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCollectiveViewsForVenue } from './collectives';

vi.mock('./queries', () => ({ getAcceptedLinkBetween: vi.fn() }));
vi.mock('./notifications', () => ({
  notifyCollectiveDissolved: vi.fn(),
  notifyCollectiveHostTransferred: vi.fn(),
  notifyCollectiveRemoval: vi.fn(),
}));

type Row = Record<string, unknown>;

/** The same in-memory query-builder stand-in the reconcile tests use. */
function fakeAdmin(tables: Record<string, Row[]>) {
  function from(table: string) {
    const rows = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    const exec = () => rows.filter((r) => filters.every((f) => f(r)));
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.order = chain;
    builder.eq = (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    };
    builder.in = (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: exec()[0] ?? null, error: null });
    builder.then = (
      onFulfilled: (v: { data: Row[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: exec(), error: null }).then(onFulfilled, onRejected);
    return builder;
  }
  return { from } as unknown as SupabaseClient;
}

const HOST = 'venue-host';
const OTHER = 'venue-other';
const COL = 'col-1';

const HOST_PAGE = {
  show_services_tab: true,
  show_team_tab: true,
  show_about_tab: true,
  about: 'Welcome to the salon',
  brand_primary: '#ff0000',
};

function tables(collectiveConfig: Row | null): Record<string, Row[]> {
  return {
    venue_collectives: [
      {
        id: COL,
        slug: 'plus-1',
        name: 'Plus 1',
        host_venue_id: HOST,
        branding: {},
        service_grouping: 'by_practitioner',
        status: 'active',
        page_mode: 'unified_catalog',
        slug_strategy: 'dedicated',
        adopted_venue_id: null,
        timezone: null,
        booking_page_config: collectiveConfig,
      },
    ],
    venue_collective_members: [
      { collective_id: COL, venue_id: HOST, status: 'active', display_order: 0 },
      { collective_id: COL, venue_id: OTHER, status: 'active', display_order: 1 },
    ],
    venues: [
      { id: HOST, name: 'Host', feature_flags: null, booking_page_config: HOST_PAGE },
      { id: OTHER, name: 'Other', feature_flags: null, booking_page_config: { show_about_tab: false } },
    ],
  };
}

/**
 * The editors (web and app) seed their tab toggles from this view and write all
 * three booleans back on every save. The live page fills a combined page's tabs
 * from the host venue until the host saves its own there, so the view must
 * serve that same effective config: served raw, an unrelated save (a colour
 * change) wrote the inherited tabs back as off.
 */
describe('loadCollectiveViewsForVenue bookingPageConfig', () => {
  it('fills in the host venue tabs and About when the combined page has none of its own', async () => {
    const [view] = await loadCollectiveViewsForVenue(fakeAdmin(tables({ brand_primary: '#00ff00' })), HOST);
    expect(view.bookingPageConfig).toMatchObject({
      brand_primary: '#00ff00',
      show_services_tab: true,
      show_team_tab: true,
      show_about_tab: true,
      about: 'Welcome to the salon',
    });
  });

  it('borrows from the host even for a member that is not the host', async () => {
    const [view] = await loadCollectiveViewsForVenue(fakeAdmin(tables({})), OTHER);
    expect(view.isHost).toBe(false);
    expect(view.bookingPageConfig).toMatchObject({ show_team_tab: true, show_about_tab: true });
  });

  it('keeps the combined page tabs once the host has saved any of its own', async () => {
    const own = { show_services_tab: true, show_about_tab: false };
    const [view] = await loadCollectiveViewsForVenue(fakeAdmin(tables(own)), HOST);
    expect(view.bookingPageConfig).toEqual(own);
  });

  it('serves the stored config untouched when the host venue has no page config', async () => {
    const t = tables({ brand_primary: '#00ff00' });
    t.venues[0] = { ...t.venues[0], booking_page_config: null };
    const [view] = await loadCollectiveViewsForVenue(fakeAdmin(t), HOST);
    expect(view.bookingPageConfig).toEqual({ brand_primary: '#00ff00' });
  });
});
