import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveExperienceEventPatch } from './experience-event-guards';

/**
 * EV-9+ / EV-1: both PATCH schemas accept an arbitrary `parent_event_id` uuid.
 * Nothing checked it belonged to the same venue, so a venue could re-point its
 * event at another venue's, coupling the two series in the catalogue and (while
 * the FK was ON DELETE CASCADE) reaching the delete cascade across the boundary.
 * Both PATCH routes funnel through this resolver.
 */

const VENUE = 'venue-1';
const EVENT = 'ev-1';

function makeDb(parentLookup: { data: unknown; error: { message: string } | null }) {
  const seen: Array<{ id?: string; venue_id?: string }> = [];
  const db = {
    from: () => {
      const filters: { id?: string; venue_id?: string } = {};
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === 'id') filters.id = val;
          if (col === 'venue_id') filters.venue_id = val;
          return chain;
        },
        maybeSingle: async () => {
          seen.push({ ...filters });
          return parentLookup;
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, seen };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('resolveExperienceEventPatch parent_event_id scoping', () => {
  it('accepts a parent that belongs to the same venue, and scopes the lookup by venue', async () => {
    const { db, seen } = makeDb({ data: { id: 'ev-parent' }, error: null });

    const result = await resolveExperienceEventPatch(db, VENUE, EVENT, {
      parent_event_id: 'ev-parent',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toMatchObject({ parent_event_id: 'ev-parent' });
    expect(seen[0]).toEqual({ id: 'ev-parent', venue_id: VENUE });
  });

  it("refuses a parent from another venue", async () => {
    // The venue-scoped lookup finds nothing, which is the cross-venue case.
    const { db } = makeDb({ data: null, error: null });

    const result = await resolveExperienceEventPatch(db, VENUE, EVENT, {
      parent_event_id: 'ev-other-venue',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('That series does not belong to this venue.');
  });

  it('refuses an event pointed at itself', async () => {
    const { db, seen } = makeDb({ data: { id: EVENT }, error: null });

    const result = await resolveExperienceEventPatch(db, VENUE, EVENT, {
      parent_event_id: EVENT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('An event cannot be its own series parent.');
    // Rejected before spending a query.
    expect(seen).toHaveLength(0);
  });

  it('refuses rather than guessing when the parent lookup errors', async () => {
    const { db } = makeDb({ data: null, error: { message: 'db down' } });

    const result = await resolveExperienceEventPatch(db, VENUE, EVENT, {
      parent_event_id: 'ev-parent',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Could not verify/);
  });

  it('leaves patches without parent_event_id untouched and runs no lookup', async () => {
    const { db, seen } = makeDb({ data: null, error: null });

    const result = await resolveExperienceEventPatch(db, VENUE, EVENT, { capacity: 40 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual({ capacity: 40 });
    expect(seen).toHaveLength(0);
  });

  it('allows clearing the parent with null without a lookup', async () => {
    const { db, seen } = makeDb({ data: null, error: null });

    const result = await resolveExperienceEventPatch(db, VENUE, EVENT, { parent_event_id: null });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual({ parent_event_id: null });
    expect(seen).toHaveLength(0);
  });
});
