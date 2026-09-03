import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcileCollective, loadCollectiveBookingLinksForVenue } from './collectives';
import { getAcceptedLinkBetween } from './queries';

vi.mock('./queries', () => ({ getAcceptedLinkBetween: vi.fn() }));
vi.mock('./notifications', () => ({
  notifyCollectiveDissolved: vi.fn(),
  notifyCollectiveHostTransferred: vi.fn(),
  notifyCollectiveRemoval: vi.fn(),
}));
const mockGetLink = vi.mocked(getAcceptedLinkBetween);

type Row = Record<string, unknown>;

/**
 * A tiny in-memory stand-in for the Supabase query builder: enough of
 * select/eq/in/neq/order/maybeSingle/update to drive `reconcileCollective`
 * against a table state and inspect the rows afterwards.
 */
function fakeAdmin(tables: Record<string, Row[]>) {
  function from(table: string) {
    const rows = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const exec = () => {
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of matched) Object.assign(r, patch);
      return matched;
    };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.order = chain;
    builder.update = (p: Row) => {
      patch = p;
      return builder;
    };
    builder.eq = (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    };
    builder.neq = (col: string, v: unknown) => {
      filters.push((r) => r[col] !== v);
      return builder;
    };
    builder.in = (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: exec()[0] ?? null, error: null });
    // Awaiting the builder itself resolves the query (PostgREST builders are thenables).
    builder.then = (
      onFulfilled: (v: { data: Row[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: exec(), error: null }).then(onFulfilled, onRejected);
    return builder;
  }
  return { from } as unknown as SupabaseClient;
}

const fullLink = {
  low_grants_calendar: 'full_details',
  high_grants_calendar: 'full_details',
  low_grants_act: 'create_edit_cancel',
  high_grants_act: 'create_edit_cancel',
  low_grants_calendar_ids: null,
  high_grants_calendar_ids: null,
};

const HOST = 'venue-host';
const OTHER = 'venue-other';
const THIRD = 'venue-third';
const COL = 'col-1';

function collectiveTables(members: Row[]) {
  return {
    venue_collectives: [
      {
        id: COL,
        status: 'active',
        host_venue_id: HOST,
        page_mode: 'unified_catalog',
        slug: 'combo',
      },
    ],
    venue_collective_members: members,
    collective_service_items: [],
    collective_service_providers: [],
  };
}

describe('reconcileCollective', () => {
  beforeEach(() => {
    mockGetLink.mockReset();
    mockGetLink.mockResolvedValue(fullLink as never);
  });

  it('keeps a freshly created collective alive while its invitation is still open', async () => {
    // Host active + invitee not yet accepted: the state every new collective is in.
    const tables = collectiveTables([
      {
        id: 'm1',
        collective_id: COL,
        venue_id: HOST,
        status: 'active',
        joined_at: '2026-09-01T00:00:00Z',
      },
      {
        id: 'm2',
        collective_id: COL,
        venue_id: OTHER,
        status: 'invited',
        joined_at: null,
      },
    ]);
    const result = await reconcileCollective(fakeAdmin(tables), COL);
    expect(result).toEqual({
      removedVenueIds: [],
      dissolved: false,
      hostTransferredTo: null,
    });
    expect(tables.venue_collectives[0].status).toBe('active');
    expect(tables.venue_collectives[0].slug).toBe('combo');
    expect(tables.venue_collective_members[1].status).toBe('invited');
  });

  it('still dissolves when a member leaves and nobody else can join', async () => {
    // Two actives, one has left: one survivor, no invitation → dissolve.
    const tables = collectiveTables([
      {
        id: 'm1',
        collective_id: COL,
        venue_id: HOST,
        status: 'active',
        joined_at: '2026-09-01T00:00:00Z',
      },
      {
        id: 'm2',
        collective_id: COL,
        venue_id: OTHER,
        status: 'left',
        joined_at: '2026-09-01T00:00:00Z',
      },
    ]);
    const result = await reconcileCollective(fakeAdmin(tables), COL);
    expect(result.dissolved).toBe(true);
    expect(tables.venue_collectives[0].status).toBe('dissolved');
    expect(tables.venue_collectives[0].slug).toBe(`dissolved-${COL}`);
  });

  it('dissolves and closes open invitations when the last active members lose their link', async () => {
    // Two actives whose pairwise link is gone: both removed, zero survivors. An
    // open invitation cannot rescue a collective with no active member left.
    mockGetLink.mockResolvedValue(null as never);
    const tables = collectiveTables([
      {
        id: 'm1',
        collective_id: COL,
        venue_id: HOST,
        status: 'active',
        joined_at: '2026-09-01T00:00:00Z',
      },
      {
        id: 'm2',
        collective_id: COL,
        venue_id: OTHER,
        status: 'active',
        joined_at: '2026-09-02T00:00:00Z',
      },
      {
        id: 'm3',
        collective_id: COL,
        venue_id: THIRD,
        status: 'invited',
        joined_at: null,
      },
    ]);
    const result = await reconcileCollective(fakeAdmin(tables), COL);
    expect(result.dissolved).toBe(true);
    expect(result.removedVenueIds.sort()).toEqual([HOST, OTHER].sort());
    expect(tables.venue_collective_members[2].status).toBe('removed');
  });

  it('does not touch a healthy two-member collective', async () => {
    const tables = collectiveTables([
      {
        id: 'm1',
        collective_id: COL,
        venue_id: HOST,
        status: 'active',
        joined_at: '2026-09-01T00:00:00Z',
      },
      {
        id: 'm2',
        collective_id: COL,
        venue_id: OTHER,
        status: 'active',
        joined_at: '2026-09-02T00:00:00Z',
      },
    ]);
    const result = await reconcileCollective(fakeAdmin(tables), COL);
    expect(result).toEqual({
      removedVenueIds: [],
      dissolved: false,
      hostTransferredTo: null,
    });
    expect(tables.venue_collectives[0].status).toBe('active');
  });
});

describe('loadCollectiveBookingLinksForVenue', () => {
  it('omits a combined page that cannot render yet (fewer than two active members)', async () => {
    const tables = collectiveTables([
      {
        id: 'm1',
        collective_id: COL,
        venue_id: HOST,
        status: 'active',
        joined_at: '2026-09-01T00:00:00Z',
      },
      {
        id: 'm2',
        collective_id: COL,
        venue_id: OTHER,
        status: 'invited',
        joined_at: null,
      },
    ]);
    (tables.venue_collectives[0] as Row).name = 'Combo';
    (tables.venue_collectives[0] as Row).slug_strategy = 'dedicated';
    expect(await loadCollectiveBookingLinksForVenue(fakeAdmin(tables), HOST)).toEqual([]);
    tables.venue_collective_members[1].status = 'active';
    expect(await loadCollectiveBookingLinksForVenue(fakeAdmin(tables), HOST)).toEqual([
      { id: COL, name: 'Combo', url: '/book/c/combo' },
    ]);
  });
});
