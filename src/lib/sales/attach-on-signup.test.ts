import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { attachSalesAttributionOnSignup } from '@/lib/sales/attach-on-signup';

/**
 * Minimal fake admin client: chainable select/eq/ilike → maybeSingle resolves by table,
 * and insert records the row. Enough to exercise the existence check, code validation,
 * the self-attribution guard, and the insert.
 */
function makeAdmin(opts: {
  existingAttribution?: unknown;
  codeRow?: unknown;
  salespersonRow?: unknown;
}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const admin = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        maybeSingle: () => {
          if (table === 'sales_attributions') return Promise.resolve({ data: opts.existingAttribution ?? null, error: null });
          if (table === 'sales_codes') return Promise.resolve({ data: opts.codeRow ?? null, error: null });
          if (table === 'salespeople') return Promise.resolve({ data: opts.salespersonRow ?? null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };
  return { admin: admin as unknown as SupabaseClient, inserts };
}

const ACTIVE_CODE = { code: 'GREENWAY-X4F2', active: true, salesperson_id: 'sp1' };
const ACTIVE_SP = {
  id: 'sp1',
  name: 'Greenway',
  email: 'rep@example.com',
  user_id: 'user-sp1',
  active: true,
  revoked_at: null,
};

describe('attachSalesAttributionOnSignup', () => {
  it('attributes a normal signup to the salesperson', async () => {
    const { admin, inserts } = makeAdmin({ codeRow: ACTIVE_CODE, salespersonRow: ACTIVE_SP });
    await attachSalesAttributionOnSignup({
      admin,
      salesCode: 'GREENWAY-X4F2',
      referredVenueId: 'venue-1',
      refereeEmail: 'owner@venue.com',
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.row).toMatchObject({
      salesperson_id: 'sp1',
      code: 'GREENWAY-X4F2',
      venue_id: 'venue-1',
      status: 'pending',
    });
  });

  it('blocks self-attribution when the referee email matches the salesperson (case-insensitive)', async () => {
    const { admin, inserts } = makeAdmin({ codeRow: ACTIVE_CODE, salespersonRow: ACTIVE_SP });
    await attachSalesAttributionOnSignup({
      admin,
      salesCode: 'GREENWAY-X4F2',
      referredVenueId: 'venue-1',
      refereeEmail: 'REP@example.com',
    });
    expect(inserts).toHaveLength(0);
  });

  it('blocks self-attribution by auth user id even with a different email (the +alias dodge)', async () => {
    const { admin, inserts } = makeAdmin({ codeRow: ACTIVE_CODE, salespersonRow: ACTIVE_SP });
    await attachSalesAttributionOnSignup({
      admin,
      salesCode: 'GREENWAY-X4F2',
      referredVenueId: 'venue-1',
      refereeEmail: 'rep+burner@gmail.com',
      refereeUserId: 'user-sp1',
    });
    expect(inserts).toHaveLength(0);
  });

  it('is idempotent — does not insert when an attribution already exists for the venue', async () => {
    const { admin, inserts } = makeAdmin({
      existingAttribution: { id: 'a1', status: 'active' },
      codeRow: ACTIVE_CODE,
      salespersonRow: ACTIVE_SP,
    });
    await attachSalesAttributionOnSignup({
      admin,
      salesCode: 'GREENWAY-X4F2',
      referredVenueId: 'venue-1',
      refereeEmail: 'owner@venue.com',
    });
    expect(inserts).toHaveLength(0);
  });

  it('does nothing when no code is supplied', async () => {
    const { admin, inserts } = makeAdmin({ codeRow: ACTIVE_CODE, salespersonRow: ACTIVE_SP });
    await attachSalesAttributionOnSignup({ admin, salesCode: null, referredVenueId: 'venue-1' });
    expect(inserts).toHaveLength(0);
  });
});
