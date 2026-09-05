import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findStaffCollectiveForVenue,
  loadStaffCollectiveSummary,
  resolveStaffCollectiveScope,
} from './collective-staff-scope';

type Row = Record<string, unknown>;

/** The same in-memory query-builder stand-in the collective tests use. */
function fakeAdmin(tables: Record<string, Row[]>) {
  function from(table: string) {
    const rows = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    const exec = () => rows.filter((r) => filters.every((f) => f(r)));
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    };
    builder.in = (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return builder;
    };
    // PostgREST `or('col.eq.v,col.is.null')`, enough for the calendar-type filter.
    builder.or = (expr: string) => {
      const clauses = expr.split(',').map((c) => c.split('.'));
      filters.push((r) =>
        clauses.some(([col, op, val]) => (op === 'is' ? (val === 'null' ? r[col!] == null : false) : r[col!] === val)),
      );
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: exec()[0] ?? null, error: null });
    builder.then = (onFulfilled: (v: { data: Row[]; error: null }) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: exec(), error: null }).then(onFulfilled, onRejected);
    return builder;
  }
  return { from } as unknown as SupabaseClient;
}

const COL = 'col-1';
const A = 'venue-a';
const B = 'venue-b';
const C = 'venue-c';

const eligible = (id: string): Row => ({
  id,
  pricing_tier: 'plus',
  plan_status: 'active',
  booking_model: 'unified_scheduling',
  subscription_current_period_end: null,
  billing_access_source: null,
});

function tables(over: { status?: string; page_mode?: string; members?: Row[]; venues?: Row[] } = {}) {
  return {
    venue_collectives: [
      { id: COL, name: 'Plus Light', status: over.status ?? 'active', page_mode: over.page_mode ?? 'unified_catalog', host_venue_id: A },
    ],
    venue_collective_members: over.members ?? [
      { collective_id: COL, venue_id: A, status: 'active' },
      { collective_id: COL, venue_id: B, status: 'active' },
    ],
    venues: over.venues ?? [eligible(A), eligible(B)],
  };
}

describe('resolveStaffCollectiveScope', () => {
  it('answers for an active member of a live combined collective', async () => {
    const scope = await resolveStaffCollectiveScope(fakeAdmin(tables()), B, COL);
    expect(scope).toEqual({ collectiveId: COL, name: 'Plus Light', hostVenueId: A, memberVenueIds: [A, B] });
  });

  it('refuses a venue that is not an active member', async () => {
    expect(await resolveStaffCollectiveScope(fakeAdmin(tables()), C, COL)).toBeNull();
    const invited = tables({ members: [{ collective_id: COL, venue_id: A, status: 'active' }, { collective_id: COL, venue_id: B, status: 'invited' }] });
    expect(await resolveStaffCollectiveScope(fakeAdmin(invited), B, COL)).toBeNull();
  });

  it('refuses a dissolved collective, a directory-mode one, and a plain venue id', async () => {
    expect(await resolveStaffCollectiveScope(fakeAdmin(tables({ status: 'dissolved' })), A, COL)).toBeNull();
    expect(await resolveStaffCollectiveScope(fakeAdmin(tables({ page_mode: 'directory' })), A, COL)).toBeNull();
    expect(await resolveStaffCollectiveScope(fakeAdmin(tables()), A, B)).toBeNull();
  });

  /** The public page needs two eligible members to render; the staff form follows it. */
  it('refuses when fewer than two members are currently eligible', async () => {
    const lapsed = tables({ venues: [eligible(A), { ...eligible(B), plan_status: 'cancelled' }] });
    expect(await resolveStaffCollectiveScope(fakeAdmin(lapsed), A, COL)).toBeNull();
  });
});

describe('findStaffCollectiveForVenue', () => {
  it('finds the live collective a venue is in, and nothing for a venue with links only', async () => {
    expect((await findStaffCollectiveForVenue(fakeAdmin(tables()), A))?.collectiveId).toBe(COL);
    expect(await findStaffCollectiveForVenue(fakeAdmin(tables()), C)).toBeNull();
  });
});

describe('loadStaffCollectiveSummary', () => {
  it("lists the members' active people calendars for the diary, resources and inactive ones left out", async () => {
    const t: Record<string, Row[]> = tables();
    t.unified_calendars = [
      { id: 'cal-a', venue_id: A, is_active: true, calendar_type: 'practitioner' },
      { id: 'cal-b', venue_id: B, is_active: true, calendar_type: null },
      { id: 'room', venue_id: A, is_active: true, calendar_type: 'resource' },
      { id: 'old', venue_id: B, is_active: false, calendar_type: 'practitioner' },
      { id: 'elsewhere', venue_id: C, is_active: true, calendar_type: 'practitioner' },
    ];
    await expect(loadStaffCollectiveSummary(fakeAdmin(t), A)).resolves.toEqual({
      id: COL,
      name: 'Plus Light',
      hostVenueId: A,
      memberVenueIds: [A, B],
      calendarIds: ['cal-a', 'cal-b'],
    });
  });

  it('is null for a venue with no live collective', async () => {
    await expect(loadStaffCollectiveSummary(fakeAdmin(tables()), C)).resolves.toBeNull();
  });
});
