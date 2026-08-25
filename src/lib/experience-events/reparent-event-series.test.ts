import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reparentEventSeriesBeforeDelete } from './reparent-event-series';

/**
 * EV-1: deleting a series parent used to cascade-delete every occurrence in the
 * series and orphan their sold bookings. The FK is now ON DELETE SET NULL
 * (20270117120000); this helper is what stops SET NULL fragmenting the series
 * into one-off cards instead.
 */

const VENUE = 'venue-1';
const PARENT = 'ev-parent';

type Row = { id: string; event_date: string };

interface Recorded {
  payload: Record<string, unknown>;
  eqIds: string[];
  inIds: string[][];
}

function makeDb(opts: {
  siblings?: Row[];
  selectError?: { message: string } | null;
  /** Fail the UPDATE whose payload matches this predicate. */
  failUpdate?: (payload: Record<string, unknown>) => boolean;
}) {
  const updates: Recorded[] = [];

  const db = {
    from: () => {
      const rec: Recorded = { payload: {}, eqIds: [], inIds: [] };
      const selectChain = {
        select: () => selectChain,
        eq: () => selectChain,
        order: () => selectChain,
        then: undefined as unknown,
      };
      // The helper awaits the builder after two .order() calls, so make the
      // chain thenable at that point.
      const thenable = {
        ...selectChain,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: opts.siblings ?? [], error: opts.selectError ?? null }),
      };
      Object.assign(selectChain, thenable);

      const updateChain = {
        eq: (col: string, val: string) => {
          if (col === 'id') rec.eqIds.push(val);
          return updateChain;
        },
        in: (_col: string, vals: string[]) => {
          rec.inIds.push(vals);
          return updateChain;
        },
        then: (resolve: (v: unknown) => void) => {
          const shouldFail = opts.failUpdate?.(rec.payload) ?? false;
          resolve({ error: shouldFail ? { message: 'update boom' } : null });
        },
      };

      return {
        select: selectChain.select,
        eq: selectChain.eq,
        order: selectChain.order,
        update: (payload: Record<string, unknown>) => {
          rec.payload = payload;
          updates.push(rec);
          return updateChain;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reparentEventSeriesBeforeDelete', () => {
  it('is a no-op for an event with no series children', async () => {
    const { db, updates } = makeDb({ siblings: [] });

    const result = await reparentEventSeriesBeforeDelete(db, { venueId: VENUE, eventId: PARENT });

    expect(result).toEqual({ ok: true, promotedEventId: null });
    expect(updates).toHaveLength(0);
  });

  it('promotes the earliest sibling and re-points the rest at it', async () => {
    const { db, updates } = makeDb({
      siblings: [
        { id: 'ev-2', event_date: '2026-09-08' },
        { id: 'ev-3', event_date: '2026-09-15' },
        { id: 'ev-4', event_date: '2026-09-22' },
      ],
    });

    const result = await reparentEventSeriesBeforeDelete(db, { venueId: VENUE, eventId: PARENT });

    expect(result).toEqual({ ok: true, promotedEventId: 'ev-2' });
    expect(updates).toHaveLength(2);
    // The new parent's own parent is cleared.
    expect(updates[0].payload).toEqual({ parent_event_id: null });
    expect(updates[0].eqIds).toContain('ev-2');
    // Everyone else points at it, so the series stays one series.
    expect(updates[1].payload).toEqual({ parent_event_id: 'ev-2' });
    expect(updates[1].inIds[0]).toEqual(['ev-3', 'ev-4']);
  });

  it('promotes without a second update when only one sibling remains', async () => {
    const { db, updates } = makeDb({ siblings: [{ id: 'ev-2', event_date: '2026-09-08' }] });

    const result = await reparentEventSeriesBeforeDelete(db, { venueId: VENUE, eventId: PARENT });

    expect(result).toEqual({ ok: true, promotedEventId: 'ev-2' });
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ parent_event_id: null });
  });

  it('blocks the delete when the sibling lookup fails', async () => {
    // Proceeding blind would let the FK SET NULL scatter a series we never read.
    const { db, updates } = makeDb({ selectError: { message: 'db down' } });

    const result = await reparentEventSeriesBeforeDelete(db, { venueId: VENUE, eventId: PARENT });

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('blocks the delete when the promotion fails', async () => {
    const { db } = makeDb({
      siblings: [
        { id: 'ev-2', event_date: '2026-09-08' },
        { id: 'ev-3', event_date: '2026-09-15' },
      ],
      failUpdate: (payload) => payload.parent_event_id === null,
    });

    const result = await reparentEventSeriesBeforeDelete(db, { venueId: VENUE, eventId: PARENT });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Nothing was deleted/);
  });

  it('rolls the promotion back and blocks the delete when the re-point fails', async () => {
    // Otherwise the series is left with two parents AND the row still present.
    const { db, updates } = makeDb({
      siblings: [
        { id: 'ev-2', event_date: '2026-09-08' },
        { id: 'ev-3', event_date: '2026-09-15' },
      ],
      failUpdate: (payload) => payload.parent_event_id === 'ev-2',
    });

    const result = await reparentEventSeriesBeforeDelete(db, { venueId: VENUE, eventId: PARENT });

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(3);
    // Third update puts ev-2 back under the original parent.
    expect(updates[2].payload).toEqual({ parent_event_id: PARENT });
    expect(updates[2].eqIds).toContain('ev-2');
  });
});
