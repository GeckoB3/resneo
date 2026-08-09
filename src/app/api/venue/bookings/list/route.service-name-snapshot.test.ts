import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The list route rebuilds every booking through an explicit allowlist before
 * resolving its display label. Selecting a column is therefore not enough: a
 * field missing from that projection is invisible to the label resolution, and
 * the unit tests around the label helper still pass while the route returns
 * nothing. That is exactly how a deleted service's name went missing from the
 * calendar despite the snapshot being present on the row.
 */

const VENUE_ID = '00000000-0000-4000-8000-00000000cafe';

/** A booking whose service has been deleted: ids nulled, snapshot intact. */
const ORPHANED_BOOKING = {
  id: '00000000-0000-4000-8000-0000000000b1',
  booking_date: '2026-08-09',
  booking_time: '11:00:00',
  booking_end_time: '11:30:00',
  party_size: 1,
  status: 'Completed',
  source: 'staff',
  deposit_status: 'none',
  deposit_amount_pence: null,
  estimated_end_time: null,
  guest_id: null,
  guest_first_name: 'Andrew',
  guest_last_name: null,
  calendar_id: '00000000-0000-4000-8000-0000000000c1',
  service_item_id: null,
  service_variant_id: null,
  service_name_snapshot: 'Test 3',
  service_variant_name_snapshot: 'Long',
  appointment_service_id: null,
  service_id: null,
  practitioner_id: null,
  experience_event_id: null,
  class_instance_id: null,
  resource_id: null,
  event_session_id: null,
  booking_model: 'unified_scheduling',
};

/** Chainable stub: every filter returns itself, awaiting yields the table's rows. */
function stubDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const result = { data: rowsByTable[table] ?? [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      for (const method of [
        'select', 'eq', 'neq', 'in', 'or', 'gte', 'lte', 'order', 'limit', 'not', 'is',
      ]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => ({ data: null, error: null });
      return builder as never;
    },
  };
}

const db = stubDb({ bookings: [ORPHANED_BOOKING] });

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: async () => ({}) as never,
}));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: async () => ({
    id: 'staff-1',
    venue_id: VENUE_ID,
    email: 'staff@example.com',
    role: 'owner',
    db,
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => db }));

const { GET } = await import('./route');

async function fetchRow(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/venue/bookings/list?${qs}`));
  const json = (await res.json()) as { bookings?: Array<Record<string, unknown>> };
  return (json.bookings ?? []).find((b) => b.id === ORPHANED_BOOKING.id);
}

describe('GET /api/venue/bookings/list — a booking whose service was deleted', () => {
  it('labels the calendar view from the snapshot', async () => {
    expect((await fetchRow('date=2026-08-09&view=calendar'))?.booking_item_name).toBe('Test 3');
  });

  it('labels the full list view from the snapshot', async () => {
    expect((await fetchRow('date=2026-08-09'))?.booking_item_name).toBe('Test 3');
  });

  it('passes the raw snapshots through for the calendar bar to render the option', async () => {
    // The bar composes "service – option" itself from these two fields, so the
    // projection has to forward them, not just consume them internally.
    const row = await fetchRow('date=2026-08-09&view=calendar');
    expect(row?.service_name_snapshot).toBe('Test 3');
    expect(row?.service_variant_name_snapshot).toBe('Long');
  });

  it('still reports the recorded option name', async () => {
    expect((await fetchRow('date=2026-08-09'))?.service_variant_name).toBe('Long');
  });
});
