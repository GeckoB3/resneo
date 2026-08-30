/**
 * P4-2: what a customer may see of the payment ledger, and whose.
 *
 * `booking_payments` has RLS enabled with NO policies, so it is service-role
 * only and there is no customer-safe view to read it through. Everything that
 * keeps one customer out of another's payments is therefore application code,
 * which is exactly the kind of boundary that should be asserted rather than
 * reasoned about.
 *
 * The projection test reads the REAL RESPONSE BODY rather than the select
 * string. A select list is a claim about what was asked for; the body is what
 * actually left the building, and it is the thing an attacker sees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  ACCOUNT_PAYMENT_COLUMNS,
  ACCOUNT_PAYMENT_FORBIDDEN_FIELDS,
} from '@/lib/account/account-payments';

const hoisted = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  /** Booking ids `bookings_account_safe` will admit to owning. */
  ownedIds: ['bk-1', 'bk-2'] as string[],
  /** Rows the ledger returns, as the DB would: every column present. */
  ledgerRows: [] as Array<Record<string, unknown>>,
  /** What the admin ledger query was actually filtered by. */
  ledgerFilteredIds: null as string[] | null,
  ledgerSelect: null as string | null,
  ownershipFilter: null as string | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: hoisted.user } }) },
    from: (table: string) => {
      if (table !== 'bookings_account_safe') throw new Error(`session client read ${table}`);
      const rows = () => hoisted.ownedIds.map((id) => ({ id }));
      const chain = {
        select: () => chain,
        eq: (_col: string, val: string) => {
          hoisted.ownershipFilter = val;
          // The ownership predicate lives in the view, so a booking that is
          // not the caller's simply is not returned.
          return Promise.resolve({
            data: hoisted.ownedIds.includes(val) ? [{ id: val }] : [],
            error: null,
          });
        },
        then: (res: (v: unknown) => unknown) => res({ data: rows(), error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'booking_payments') throw new Error(`admin client read ${table}`);
      const chain = {
        select: (cols: string) => {
          hoisted.ledgerSelect = cols;
          return chain;
        },
        in: (_col: string, ids: string[]) => {
          hoisted.ledgerFilteredIds = ids;
          return chain;
        },
        order: () => chain,
        limit: () => Promise.resolve({ data: hoisted.ledgerRows, error: null }),
      };
      return chain;
    },
  }),
}));

async function get(query = '') {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`http://localhost:3000/api/account/payments${query}`));
  return { res, body: (await res.json()) as Record<string, unknown> };
}

/** A ledger row exactly as the table holds it, secrets and all. */
function ledgerRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    booking_id: 'bk-1',
    venue_id: 'v-1',
    method: 'card_present',
    status: 'succeeded',
    amount_pence: 4500,
    currency: 'gbp',
    purpose: 'balance',
    created_at: '2026-08-30T10:00:00Z',
    stripe_payment_intent_id: 'pi_secret',
    stripe_connected_account_id: 'acct_secret',
    staff_id: 'staff-9',
    note: 'customer argued about the price',
    metadata: { internal: true },
    ...over,
  };
}

beforeEach(() => {
  hoisted.user = { id: 'user-1' };
  hoisted.ownedIds = ['bk-1', 'bk-2'];
  hoisted.ledgerRows = [ledgerRow()];
  hoisted.ledgerFilteredIds = null;
  hoisted.ledgerSelect = null;
  hoisted.ownershipFilter = null;
});

describe('the projection', () => {
  it('returns what a customer should see', async () => {
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.payments).toEqual([
      {
        id: 'pay-1',
        booking_id: 'bk-1',
        venue_id: 'v-1',
        method: 'card_present',
        status: 'succeeded',
        amount_pence: 4500,
        currency: 'gbp',
        purpose: 'balance',
        created_at: '2026-08-30T10:00:00Z',
      },
    ]);
  });

  it('leaks NONE of the forbidden fields into the response body', async () => {
    /*
      Asserted on the serialised body, not the select string. The ledger row in
      this test carries every secret the real table can hold, including a note
      a member of staff wrote about the customer, so anything that passed a row
      through unfiltered would show up here.
    */
    const { body } = await get();
    const serialised = JSON.stringify(body);
    for (const field of ACCOUNT_PAYMENT_FORBIDDEN_FIELDS) {
      expect(serialised, `${field} reached the customer`).not.toContain(field);
    }
    expect(serialised).not.toContain('pi_secret');
    expect(serialised).not.toContain('acct_secret');
    expect(serialised).not.toContain('argued about the price');
  });

  it('asks the database for an EXPLICIT column list, never a wildcard', async () => {
    /*
      Belt and braces: filtering after the fact still puts the secrets on the
      wire between the database and the server.

      Asserted as an allowlist rather than as "the forbidden names are absent",
      and a mutation sweep is why. `select('*')` contains none of those names
      and returns every one of them, so the absence check passed while the
      wildcard shipped. An allowlist cannot be fooled that way.
    */
    await get();
    expect(hoisted.ledgerSelect).toBe(ACCOUNT_PAYMENT_COLUMNS);
    expect(hoisted.ledgerSelect ?? '').not.toContain('*');
  });

  it('omits the tip, which is reserved and always zero today', async () => {
    const { body } = await get();
    expect(JSON.stringify(body)).not.toContain('tip_amount_pence');
  });
});

describe('ownership', () => {
  it('reads the ledger ONLY for bookings the session client admitted to', async () => {
    /*
      The heart of AD8 applied to this table. The admin client bypasses RLS
      entirely, so the only thing keeping it honest is that its filter comes
      from a query the session client answered.
    */
    await get();
    expect(hoisted.ledgerFilteredIds).toEqual(['bk-1', 'bk-2']);
  });

  it("returns 404 for another customer's booking id", async () => {
    // The acceptance. An empty list would confirm the booking exists.
    const { res, body } = await get('?booking_id=someone-elses');
    expect(res.status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('never queries the ledger at all for a booking that is not the caller’s', async () => {
    await get('?booking_id=someone-elses');
    expect(hoisted.ledgerFilteredIds, 'the admin client was asked anyway').toBeNull();
  });

  it('scopes to one booking when asked for one the caller owns', async () => {
    await get('?booking_id=bk-2');
    expect(hoisted.ownershipFilter).toBe('bk-2');
    expect(hoisted.ledgerFilteredIds).toEqual(['bk-2']);
  });

  it('returns an empty list, not an error, when the caller owns nothing', async () => {
    hoisted.ownedIds = [];
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.payments).toEqual([]);
    expect(hoisted.ledgerFilteredIds, 'an unbounded ledger query').toBeNull();
  });

  it('refuses an anonymous caller', async () => {
    hoisted.user = null;
    const { res, body } = await get();
    expect(res.status).toBe(401);
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});

describe('caching', () => {
  it('never caches, so a payment taken at the counter shows on the next refresh', async () => {
    const { res } = await get();
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
  });
});
