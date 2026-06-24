import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncEventTicketTypes } from './sync-event-ticket-types';

interface TierRow {
  id: string;
  name: string;
}

/**
 * Stateful mock of just the two tables `syncEventTicketTypes` touches.
 * Records insert/update/delete calls so tests can assert booking_ticket_lines
 * never get orphaned (the C3 guarantee).
 */
function makeAdmin(opts: {
  existingTiers: TierRow[];
  /** ticket_type_ids that have at least one booking_ticket_lines row. */
  soldTierIds?: string[];
}) {
  const soldTierIds = new Set(opts.soldTierIds ?? []);
  const calls = {
    updatedIds: [] as string[],
    inserted: [] as Array<Record<string, unknown>>,
    deletedIds: [] as string[],
  };

  const admin = {
    from(table: string) {
      if (table === 'event_ticket_types') {
        return {
          select() {
            return {
              eq: async () => ({ data: opts.existingTiers, error: null }),
            };
          },
          update(row: Record<string, unknown>) {
            return {
              eq(_c1: string, idVal: string) {
                // .eq('id', id).eq('event_id', eventId)
                return {
                  eq: async () => {
                    calls.updatedIds.push(idVal);
                    void row;
                    return { error: null };
                  },
                };
              },
            };
          },
          insert: async (rows: Array<Record<string, unknown>>) => {
            calls.inserted.push(...rows);
            return { error: null };
          },
          delete() {
            return {
              in(_col: string, ids: string[]) {
                return {
                  eq: async () => {
                    calls.deletedIds.push(...ids);
                    return { error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'booking_ticket_lines') {
        return {
          select() {
            return {
              in: async (_col: string, ids: string[]) => ({
                data: ids.filter((id) => soldTierIds.has(id)).map((id) => ({ ticket_type_id: id })),
                error: null,
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  return { admin, calls };
}

describe('syncEventTicketTypes', () => {
  it('updates an existing tier in place when matched by id (no delete/insert)', async () => {
    const { admin, calls } = makeAdmin({ existingTiers: [{ id: 'adult', name: 'Adult' }] });
    const res = await syncEventTicketTypes(admin, 'evt-1', [
      { id: 'adult', name: 'Adult', price_pence: 2500 },
    ]);
    expect(res.ok).toBe(true);
    expect(calls.updatedIds).toEqual(['adult']);
    expect(calls.inserted).toEqual([]);
    expect(calls.deletedIds).toEqual([]);
  });

  it('matches an id-less tier by unique name (current client) instead of orphaning it', async () => {
    const { admin, calls } = makeAdmin({ existingTiers: [{ id: 'adult', name: 'Adult' }] });
    // EventManagerView re-sends existing tiers WITHOUT ids, only the (stable) name.
    const res = await syncEventTicketTypes(admin, 'evt-1', [{ name: 'Adult', price_pence: 3000 }]);
    expect(res.ok).toBe(true);
    expect(calls.updatedIds).toEqual(['adult']);
    expect(calls.inserted).toEqual([]);
    expect(calls.deletedIds).toEqual([]);
  });

  it('inserts a genuinely new tier', async () => {
    const { admin, calls } = makeAdmin({ existingTiers: [{ id: 'adult', name: 'Adult' }] });
    const res = await syncEventTicketTypes(admin, 'evt-1', [
      { id: 'adult', name: 'Adult', price_pence: 2000 },
      { name: 'Child', price_pence: 1000 },
    ]);
    expect(res.ok).toBe(true);
    expect(calls.updatedIds).toEqual(['adult']);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0]).toMatchObject({ name: 'Child', price_pence: 1000, event_id: 'evt-1' });
    expect(calls.deletedIds).toEqual([]);
  });

  it('deletes a removed tier that has NO sales', async () => {
    const { admin, calls } = makeAdmin({
      existingTiers: [
        { id: 'adult', name: 'Adult' },
        { id: 'vip', name: 'VIP' },
      ],
    });
    // Edit keeps only Adult; VIP removed and has no sales -> safe to delete.
    const res = await syncEventTicketTypes(admin, 'evt-1', [{ id: 'adult', name: 'Adult', price_pence: 2000 }]);
    expect(res.ok).toBe(true);
    expect(calls.deletedIds).toEqual(['vip']);
    expect(res.retainedWithSales).toEqual([]);
  });

  it('KEEPS a removed tier that has sales (never orphans booking_ticket_lines)', async () => {
    const { admin, calls } = makeAdmin({
      existingTiers: [
        { id: 'adult', name: 'Adult' },
        { id: 'vip', name: 'VIP' },
      ],
      soldTierIds: ['vip'],
    });
    // VIP removed by the edit but has bookings -> must NOT be deleted.
    const res = await syncEventTicketTypes(admin, 'evt-1', [{ id: 'adult', name: 'Adult', price_pence: 2000 }]);
    expect(res.ok).toBe(true);
    expect(calls.deletedIds).toEqual([]);
    expect(res.retainedWithSales).toEqual(['vip']);
  });

  it('deletes unsold removed tiers but keeps sold ones in the same edit', async () => {
    const { admin, calls } = makeAdmin({
      existingTiers: [
        { id: 'adult', name: 'Adult' },
        { id: 'vip', name: 'VIP' },
        { id: 'early', name: 'Early Bird' },
      ],
      soldTierIds: ['vip'],
    });
    // Keep Adult; remove VIP (sold -> keep) and Early Bird (unsold -> delete).
    const res = await syncEventTicketTypes(admin, 'evt-1', [{ id: 'adult', name: 'Adult', price_pence: 2000 }]);
    expect(res.ok).toBe(true);
    expect(calls.updatedIds).toEqual(['adult']);
    expect(calls.deletedIds).toEqual(['early']);
    expect(res.retainedWithSales).toEqual(['vip']);
  });

  it('does not name-match an ambiguous duplicate name (falls through to insert)', async () => {
    const { admin, calls } = makeAdmin({
      existingTiers: [
        { id: 'g1', name: 'General' },
        { id: 'g2', name: 'General' },
      ],
      soldTierIds: ['g1', 'g2'],
    });
    // One id-less "General" cannot be safely mapped to either duplicate -> insert new;
    // both originals are unmatched but sold, so both are retained (not deleted).
    const res = await syncEventTicketTypes(admin, 'evt-1', [{ name: 'General', price_pence: 1500 }]);
    expect(res.ok).toBe(true);
    expect(calls.updatedIds).toEqual([]);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.deletedIds).toEqual([]);
    expect(res.retainedWithSales.sort()).toEqual(['g1', 'g2']);
  });
});
