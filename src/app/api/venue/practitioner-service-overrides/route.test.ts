import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * The unified branch of this route allow-listed COLUMN NAMES only and never
 * loaded the `staff_may_customize_*` flags, so any staff account could rewrite a
 * service's price or duration on its calendar even where the admin had turned
 * customisation off. The dashboard hides those inputs, but the route is
 * reachable directly and runs on the service-role client, so nothing else
 * stopped it. Every venue is on unified scheduling, which made the branch that
 * DID enforce the flags the dead one.
 */

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireManagedCalendarAccess: vi.fn(async () => ({ ok: true })),
  requireManagedCalendarIds: vi.fn(async () => ({ ok: true, managedCalendarIds: ['cal-1'] })),
}));

vi.mock('@/lib/booking/uses-unified-appointment-data', () => ({
  venueUsesUnifiedAppointmentServiceData: vi.fn(async () => true),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { PATCH } from './route';

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';

/** Service row the route loads; flags default to false in the schema. */
let serviceRow: Record<string, unknown>;
let assignmentUpdates: Record<string, unknown>[];
/** Whether the admin's chosen calendar belongs to their venue. */
let calendarAtVenue: boolean;

function makeAdmin() {
  return {
    from(table: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => {
          if (table === 'service_items') return { data: serviceRow, error: null };
          if (table === 'unified_calendars') return { data: calendarAtVenue ? { id: 'cal-9' } : null, error: null };
          if (table === 'calendar_service_assignments') return { data: { id: 'link-1' }, error: null };
          return { data: null, error: null };
        },
        update(payload: Record<string, unknown>) {
          assignmentUpdates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
        insert: async (payload: Record<string, unknown>) => {
          assignmentUpdates.push(payload);
          return { error: null };
        },
        in: () => api,
        limit: async () => ({ data: [{ service_item_id: SERVICE_ID }], error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: [{ service_item_id: SERVICE_ID }], error: null }),
      };
      return api;
    },
  };
}

function request(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  assignmentUpdates = [];
  calendarAtVenue = true;
  serviceRow = {
    id: SERVICE_ID,
    venue_id: 'v1',
    staff_may_customize_duration: false,
    staff_may_customize_price: false,
  };
  vi.mocked(getVenueStaff).mockResolvedValue({
    id: 'staff-1',
    venue_id: 'v1',
    role: 'staff',
  } as never);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(makeAdmin() as never);
});

describe('PATCH /api/venue/practitioner-service-overrides (unified)', () => {
  it('refuses a duration override when the admin disallowed it', async () => {
    const res = await PATCH(
      request({ service_id: SERVICE_ID, custom_duration_minutes: 30 }),
    );
    expect(res.status).toBe(403);
    expect(assignmentUpdates).toHaveLength(0);
  });

  it('refuses a price override when the admin disallowed it', async () => {
    const res = await PATCH(
      request({ service_id: SERVICE_ID, custom_price_pence: 1000 }),
    );
    expect(res.status).toBe(403);
    expect(assignmentUpdates).toHaveLength(0);
  });

  it('allows the field the admin did enable', async () => {
    serviceRow.staff_may_customize_price = true;
    const res = await PATCH(
      request({ service_id: SERVICE_ID, custom_price_pence: 1000 }),
    );
    expect(res.status).toBe(200);
    expect(assignmentUpdates).toEqual([
      { custom_price_pence: 1000, updated_by_venue_id: 'v1', updated_by_user_id: null },
    ]);
  });

  it('still refuses a second field the admin did not enable', async () => {
    serviceRow.staff_may_customize_price = true;
    const res = await PATCH(
      request({
        service_id: SERVICE_ID,
        custom_price_pence: 1000,
        custom_duration_minutes: 30,
      }),
    );
    expect(res.status).toBe(403);
    expect(assignmentUpdates).toHaveLength(0);
  });
});

/** W8 (CSA-03, PB-01): all seven values are stored, within the flags for staff, by any admin (D4). */
describe('PATCH /api/venue/practitioner-service-overrides: the seven per-calendar values', () => {
  const seven = {
    custom_name: '  Senior cut  ',
    custom_description: 'With Sam',
    custom_duration_minutes: 50,
    custom_buffer_minutes: 10,
    custom_price_pence: 2200,
    custom_deposit_pence: 500,
    custom_colour: '#123456',
  };
  const allFlags = {
    staff_may_customize_name: true,
    staff_may_customize_description: true,
    staff_may_customize_duration: true,
    staff_may_customize_buffer: true,
    staff_may_customize_price: true,
    staff_may_customize_deposit: true,
    staff_may_customize_colour: true,
  };

  it('stores name, description, buffer, deposit and colour as well as length and price, for staff with the flags', async () => {
    Object.assign(serviceRow, allFlags);
    const res = await PATCH(request({ service_id: SERVICE_ID, ...seven }));
    expect(res.status).toBe(200);
    expect(assignmentUpdates).toEqual([
      { ...seven, custom_name: 'Senior cut', updated_by_venue_id: 'v1', updated_by_user_id: null },
    ]);
  });

  it('refuses staff a buffer when the buffer flag is off', async () => {
    const res = await PATCH(request({ service_id: SERVICE_ID, custom_buffer_minutes: 10 }));
    expect(res.status).toBe(403);
    expect(assignmentUpdates).toHaveLength(0);
  });

  it('lets a venue admin set values on a calendar at their venue whatever the flags say (D4)', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue({ id: 'admin-1', venue_id: 'v1', role: 'admin' } as never);
    const res = await PATCH(request({ service_id: SERVICE_ID, calendar_id: '22222222-2222-4222-8222-222222222222', custom_deposit_pence: 700 }));
    expect(res.status).toBe(200);
    expect(assignmentUpdates[0]).toMatchObject({ custom_deposit_pence: 700, updated_by_venue_id: 'v1' });
  });

  it('refuses an admin a calendar that is not at their venue, or no calendar at all', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue({ id: 'admin-1', venue_id: 'v1', role: 'admin' } as never);
    calendarAtVenue = false;
    const other = await PATCH(request({ service_id: SERVICE_ID, calendar_id: '22222222-2222-4222-8222-222222222222', custom_price_pence: 1 }));
    expect(other.status).toBe(403);
    const none = await PATCH(request({ service_id: SERVICE_ID, custom_price_pence: 1 }));
    expect(none.status).toBe(400);
    expect(assignmentUpdates).toHaveLength(0);
  });

  it('keeps the 1.00 floor on a card-hold no-show fee, and still allows clearing it', async () => {
    Object.assign(serviceRow, allFlags, { payment_requirement: 'card_hold' });
    const low = await PATCH(request({ service_id: SERVICE_ID, custom_deposit_pence: 50 }));
    expect(low.status).toBe(400);
    const cleared = await PATCH(request({ service_id: SERVICE_ID, custom_deposit_pence: null }));
    expect(cleared.status).toBe(200);
    expect(assignmentUpdates).toEqual([{ custom_deposit_pence: null, updated_by_venue_id: 'v1', updated_by_user_id: null }]);
  });

  it('refuses out-of-range values before reaching the database', async () => {
    Object.assign(serviceRow, allFlags);
    for (const bad of [{ custom_buffer_minutes: 121 }, { custom_duration_minutes: 4 }, { custom_name: '' }, { custom_name: '   ' }, { custom_colour: 'x'.repeat(21) }]) {
      const res = await PATCH(request({ service_id: SERVICE_ID, ...bad }));
      expect(res.status).toBe(400);
    }
    expect(assignmentUpdates).toHaveLength(0);
  });
});
