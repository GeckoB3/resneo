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

function makeAdmin() {
  return {
    from(table: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => {
          if (table === 'service_items') return { data: serviceRow, error: null };
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
    expect(assignmentUpdates).toEqual([{ custom_price_pence: 1000 }]);
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
