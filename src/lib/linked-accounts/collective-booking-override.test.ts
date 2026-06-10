import { describe, expect, it } from 'vitest';
import { resolveCollectiveServiceOverride } from './collective-booking-override';

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

describe('resolveCollectiveServiceOverride', () => {
  it('returns null when no collective/item id is supplied', async () => {
    const admin = makeAdmin({});
    await expect(
      resolveCollectiveServiceOverride(admin, { ...baseParams, collectiveServiceItemId: null }),
    ).resolves.toBeNull();
  });

  it('returns null when the item is not part of a live unified collective', async () => {
    const admin = makeAdmin({ collective_service_items: null });
    await expect(resolveCollectiveServiceOverride(admin, baseParams)).resolves.toBeNull();
  });

  it('returns null when the venue is not an active member', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', default_price_pence: null, default_duration_minutes: null, status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: null,
    });
    await expect(resolveCollectiveServiceOverride(admin, baseParams)).resolves.toBeNull();
  });

  it('returns null when there is no active provider for the service', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', default_price_pence: null, default_duration_minutes: null, status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      collective_service_providers: [],
    });
    await expect(resolveCollectiveServiceOverride(admin, baseParams)).resolves.toBeNull();
  });

  it('uses the source service price/duration — ignoring any provider override', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      // Legacy override columns are present but MUST be ignored — each venue owns its terms.
      collective_service_providers: [
        { id: 'prov-1', practitioner_id: null, price_pence_override: 4500, duration_minutes_override: 60 },
      ],
      appointment_services: { price_pence: 7000, duration_minutes: 45 },
    });
    await expect(resolveCollectiveServiceOverride(admin, baseParams)).resolves.toEqual({
      collectiveServiceItemId: 'item-1',
      pricePence: 7000, // the venue's own service price
      durationMinutes: 45,
    });
  });

  it('uses the source service even if a stale item default exists', async () => {
    const admin = makeAdmin({
      // A legacy default_price_pence is present but no longer consulted.
      collective_service_items: { id: 'item-1', collective_id: 'col-1', default_price_pence: 6000, status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      collective_service_providers: [
        { id: 'prov-1', practitioner_id: null },
      ],
      appointment_services: { price_pence: 7000, duration_minutes: 45 },
    });
    await expect(resolveCollectiveServiceOverride(admin, baseParams)).resolves.toEqual({
      collectiveServiceItemId: 'item-1',
      pricePence: 7000, // source, not the 6000 item default
      durationMinutes: 45,
    });
  });

  it('resolves a legacy pending-approval provider (consent model removed — attribution must not be lost)', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      // approval_status is deliberately not consulted: rows created before the
      // consent removal may still say 'pending' but are bookable.
      collective_service_providers: [
        { id: 'prov-1', practitioner_id: null, approval_status: 'pending' },
      ],
      appointment_services: { price_pence: 7000, duration_minutes: 45 },
    });
    await expect(resolveCollectiveServiceOverride(admin, baseParams)).resolves.toEqual({
      collectiveServiceItemId: 'item-1',
      pricePence: 7000,
      durationMinutes: 45,
    });
  });

  it('still prefers a practitioner-pinned provider, charged at the source price', async () => {
    const admin = makeAdmin({
      collective_service_items: { id: 'item-1', collective_id: 'col-1', status: 'active' },
      venue_collectives: { id: 'col-1', status: 'active', page_mode: 'unified_catalog' },
      venue_collective_members: { id: 'mem-1' },
      collective_service_providers: [
        { id: 'all', practitioner_id: null },
        { id: 'pinned', practitioner_id: 'pr-9' },
      ],
      appointment_services: { price_pence: 9000, duration_minutes: 90 },
    });
    const out = await resolveCollectiveServiceOverride(admin, { ...baseParams, practitionerId: 'pr-9' });
    expect(out?.pricePence).toBe(9000);
    expect(out?.durationMinutes).toBe(90);
  });
});
