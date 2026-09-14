import { describe, expect, it } from 'vitest';
import { resolveCollectiveServiceAttribution } from './collective-booking-override';

/**
 * A tiny chainable Supabase stub: each .from(table) returns a builder whose
 * terminal `.maybeSingle()` / awaited result yields the queued row(s) for that
 * table. Enough to exercise the resolver's branch logic without a database.
 */
function makeAdmin(tables: Record<string, unknown>) {
  return {
    from(table: string) {
      const result = tables[table];
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ['select', 'eq', 'in', 'order', 'neq']) builder[m] = chain;
      builder.maybeSingle = async () => ({ data: Array.isArray(result) ? (result[0] ?? null) : result ?? null });
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: Array.isArray(result) ? result : result == null ? [] : [result] });
      return builder;
    },
  } as never;
}

const baseParams = {
  collectiveId: 'col-1',
  collectiveServiceItemId: 'item-1',
  venueId: 'venue-1',
  sourceServiceId: 'svc-1',
  practitionerId: null as string | null,
};

describe('resolveCollectiveServiceAttribution', () => {
  it('returns null when no collective/item id is supplied', async () => {
    const admin = makeAdmin({});
    await expect(
      resolveCollectiveServiceAttribution(admin, { ...baseParams, collectiveServiceItemId: null }),
    ).resolves.toBeNull();
  });

  it('returns null when the item is not part of a live unified collective', async () => {
    const admin = makeAdmin({ collective_service_items: null });
    await expect(resolveCollectiveServiceAttribution(admin, baseParams)).resolves.toBeNull();
  });

  it('returns null when the venue is not an active member', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', default_price_pence: null, default_duration_minutes: null, status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: null,
    });
    await expect(resolveCollectiveServiceAttribution(admin, baseParams)).resolves.toBeNull();
  });

  it('returns null when there is no active provider for the service', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', default_price_pence: null, default_duration_minutes: null, status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      collective_service_providers: [],
    });
    await expect(resolveCollectiveServiceAttribution(admin, baseParams)).resolves.toBeNull();
  });

  it('attributes a booking to the offering and returns nothing about price or length (CB-02)', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      // Legacy override columns and the source service's base terms must not leak out:
      // the create routes charge and reserve the calendar's own terms.
      collective_service_providers: [
        { id: 'prov-1', practitioner_id: null, price_pence_override: 4500, duration_minutes_override: 60 },
      ],
      service_items: { price_pence: 7000, duration_minutes: 45 },
    });
    await expect(resolveCollectiveServiceAttribution(admin, baseParams)).resolves.toEqual({
      collectiveServiceItemId: 'item-1',
    });
  });

  it('resolves a legacy pending-approval provider (consent model removed, attribution must not be lost)', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      collective_service_providers: [{ id: 'prov-1', practitioner_id: null, approval_status: 'pending' }],
    });
    await expect(resolveCollectiveServiceAttribution(admin, baseParams)).resolves.toEqual({
      collectiveServiceItemId: 'item-1',
    });
  });

  it('accepts a provider pinned to the chosen calendar', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      collective_service_providers: [{ id: 'pinned', practitioner_id: 'pr-9' }],
    });
    await expect(
      resolveCollectiveServiceAttribution(admin, { ...baseParams, practitionerId: 'pr-9' }),
    ).resolves.toEqual({ collectiveServiceItemId: 'item-1' });
  });
});
