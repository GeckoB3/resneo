/**
 * `GET /api/account/venues` (aliased as `GET /api/v1/me/venues`), and the one
 * property that makes its marketing consent writable.
 *
 * The route published `marketing_consent` per venue and no way to identify the
 * relationship it belonged to. `PATCH /api/account/marketing-preferences`
 * takes a `guest_id`, so a native client could show a customer which venues
 * may email them and could not let them change it: the resneo-app customer
 * profile shipped that section read-only, pointing at the website. The web
 * page never hit this because it loads the guest rows server-side and already
 * holds their ids.
 *
 * So the test that matters is not "the field is present". It is that the id
 * this route hands out is the id the OTHER route accepts. Asserted by feeding
 * one into the other, because two separate assertions about a uuid would both
 * pass while the pair stayed broken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  /** As `guests_account_safe` returns them: the caller's own rows, one per venue. */
  guestRows: [] as Array<Record<string, unknown>>,
  /** What the PATCH actually wrote, and what it filtered by. */
  updatePayload: null as Record<string, unknown> | null,
  updateFilters: [] as Array<[string, string]>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: hoisted.user } }) },
    from: (table: string) => {
      if (table !== 'guests_account_safe') throw new Error(`session client read ${table}`);
      const chain = {
        select: () => chain,
        order: () => Promise.resolve({ data: hoisted.guestRows, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'venues') {
        const chain = {
          select: () => chain,
          in: () => Promise.resolve({ data: [{ id: 'venue-1', name: 'The Wharf' }], error: null }),
        };
        return chain;
      }
      if (table === 'guests') {
        // The PATCH loads the row to prove it is the caller's, then updates it.
        const load = {
          select: () => load,
          eq: (col: string, val: string) => {
            hoisted.updateFilters.push([col, val]);
            return load;
          },
          maybeSingle: () => {
            const [, id] = hoisted.updateFilters[0] ?? [];
            const row = hoisted.guestRows.find((g) => g.id === id);
            return Promise.resolve({ data: row ? { id, user_id: 'user-1' } : null, error: null });
          },
          single: () =>
            Promise.resolve({
              data: { id: hoisted.updateFilters[0]?.[1], marketing_consent: true },
              error: null,
            }),
          update: (payload: Record<string, unknown>) => {
            hoisted.updatePayload = payload;
            return load;
          },
        };
        return load;
      }
      throw new Error(`admin client read ${table}`);
    },
  }),
}));

async function getVenues() {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest('http://localhost:3000/api/account/venues'));
  return { status: res.status, body: await res.json() };
}

async function patchMarketing(body: unknown) {
  const { PATCH } = await import('../marketing-preferences/route');
  const res = await PATCH(
    new NextRequest('http://localhost:3000/api/account/marketing-preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.resetModules();
  hoisted.user = { id: 'user-1' };
  hoisted.updatePayload = null;
  hoisted.updateFilters = [];
  hoisted.guestRows = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      venue_id: 'venue-1',
      email: 'c@example.com',
      phone: null,
      first_name: 'Cass',
      last_name: 'Reed',
      marketing_consent: false,
      marketing_consent_at: null,
      marketing_opt_out: false,
      first_booked_at: '2026-01-02',
      last_booked_at: '2026-08-01',
      total_bookings_count: 3,
      total_spent_minor: 9000,
    },
  ];
});

describe('GET /api/account/venues', () => {
  it('hands out the relationship id, so consent is writable and not only readable', async () => {
    const { status, body } = await getVenues();
    expect(status).toBe(200);
    expect(body.venues[0].guest_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('and the id it hands out is the one the consent route accepts', async () => {
    // The loop the app could not close. Neither route changes here; what is
    // asserted is that they agree about what identifies a venue relationship.
    const { body } = await getVenues();
    const res = await patchMarketing({
      guest_id: body.venues[0].guest_id,
      marketing_consent: true,
    });

    expect(res.status, 'the consent route rejected the id this route published').toBe(200);
    expect(hoisted.updateFilters).toContainEqual(['id', body.venues[0].guest_id]);
    expect(hoisted.updatePayload).toMatchObject({ marketing_consent: true, marketing_opt_out: false });
  });

  it('publishes exactly the relationship, and none of the contact details beside it', async () => {
    // `guests_account_safe` also carries email, phone and both names, which
    // this route reads and does not return. Pinned as a whole key set rather
    // than field by field: that is what catches a widening, and it is what
    // catches `guest_id` being dropped again by a later edit.
    const { body } = await getVenues();
    expect(Object.keys(body.venues[0]).sort()).toEqual([
      'first_booked_at',
      'guest_id',
      'last_booked_at',
      'marketing_consent',
      'marketing_consent_at',
      'marketing_opt_out',
      'total_bookings_count',
      'venue_id',
      'venue_name',
    ]);
  });

  it('refuses an anonymous caller rather than answering with an empty list', async () => {
    hoisted.user = null;
    const { status, body } = await getVenues();
    expect(status).toBe(401);
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});
