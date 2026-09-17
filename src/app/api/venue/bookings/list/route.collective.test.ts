import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * W17 (REP-01): a booking made through a collective's page says so in the bookings list. The
 * route rebuilds each row through an allowlist, so selecting `collective_id` is not enough on
 * its own; this pins that the id and the collective's name reach the response in both views.
 */

const VENUE_ID = '00000000-0000-4000-8000-00000000cafe';
const COLLECTIVE_ID = '00000000-0000-4000-8000-0000000000c0';

const base = {
  booking_date: '2026-09-10',
  booking_time: '11:00:00',
  booking_end_time: '11:30:00',
  party_size: 1,
  status: 'Booked',
  source: 'booking_page',
  deposit_status: 'Not Required',
  deposit_amount_pence: null,
  estimated_end_time: null,
  guest_id: null,
  guest_first_name: 'Ann',
  guest_last_name: 'Lee',
  calendar_id: '00000000-0000-4000-8000-0000000000c1',
  service_item_id: null,
  service_variant_id: null,
  service_name_snapshot: 'Cut',
  service_variant_name_snapshot: null,
  appointment_service_id: null,
  service_id: null,
  practitioner_id: null,
  experience_event_id: null,
  class_instance_id: null,
  resource_id: null,
  event_session_id: null,
  booking_model: 'unified_scheduling',
};

const THROUGH = { ...base, id: '00000000-0000-4000-8000-0000000000b1', collective_id: COLLECTIVE_ID };
const OWN = { ...base, id: '00000000-0000-4000-8000-0000000000b2', collective_id: null };

function stubDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const result = { data: rowsByTable[table] ?? [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      for (const method of ['select', 'eq', 'neq', 'in', 'or', 'gte', 'lte', 'order', 'limit', 'not', 'is']) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => ({ data: null, error: null });
      return builder as never;
    },
  };
}

const db = stubDb({
  bookings: [THROUGH, OWN],
  venue_collectives: [{ id: COLLECTIVE_ID, name: 'High Street' }],
});

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: async () => ({}) as never }));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: async () => ({ id: 'staff-1', venue_id: VENUE_ID, email: 'staff@example.com', role: 'owner', db }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => db }));

const { GET } = await import('./route');

async function rows(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/venue/bookings/list?${qs}`));
  const json = (await res.json()) as { bookings?: Array<Record<string, unknown>> };
  return json.bookings ?? [];
}

describe('GET /api/venue/bookings/list: bookings made through a collective', () => {
  it.each(['date=2026-09-10', 'date=2026-09-10&view=calendar'])('carries the collective id and name (%s)', async (qs) => {
    const list = await rows(qs);
    const through = list.find((b) => b.id === THROUGH.id);
    const own = list.find((b) => b.id === OWN.id);
    expect(through).toBeDefined();
    expect(own).toBeDefined();
    expect(through).toMatchObject({ collective_id: COLLECTIVE_ID, collective_name: 'High Street' });
    expect(own).toMatchObject({ collective_id: null, collective_name: null });
  });
});
