import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateSalesCode } from '@/lib/sales/lookup';
import { SALES_SIGNUP_TRIAL_DAYS, MAX_SALES_TRIAL_DAYS } from '@/lib/sales/constants';

/** Minimal fake admin: maybeSingle resolves per table for the sales_codes → salespeople lookups. */
function makeAdmin(opts: { codeRow?: unknown; salespersonRow?: unknown }) {
  const admin = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        maybeSingle: () => {
          if (table === 'sales_codes') return Promise.resolve({ data: opts.codeRow ?? null, error: null });
          if (table === 'salespeople') return Promise.resolve({ data: opts.salespersonRow ?? null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return admin as unknown as SupabaseClient;
}

const SP = { id: 'sp1', name: 'Greenway', email: 'rep@example.com', user_id: 'u1', active: true, revoked_at: null };

describe('validateSalesCode', () => {
  it("returns the code's configured trial_days", async () => {
    const admin = makeAdmin({
      codeRow: { code: 'GREENWAY-2MO', active: true, salesperson_id: 'sp1', trial_days: 60 },
      salespersonRow: SP,
    });
    const res = await validateSalesCode(admin, 'greenway-2mo');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.code).toBe('GREENWAY-2MO');
      expect(res.value.trial_days).toBe(60);
    }
  });

  it('falls back to the default trial when trial_days is missing (legacy rows)', async () => {
    const admin = makeAdmin({
      codeRow: { code: 'OLD-CODE', active: true, salesperson_id: 'sp1' },
      salespersonRow: SP,
    });
    const res = await validateSalesCode(admin, 'OLD-CODE');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.trial_days).toBe(SALES_SIGNUP_TRIAL_DAYS);
  });

  it('clamps an out-of-range trial length', async () => {
    const admin = makeAdmin({
      codeRow: { code: 'BIGTRIAL', active: true, salesperson_id: 'sp1', trial_days: 99999 },
      salespersonRow: SP,
    });
    const res = await validateSalesCode(admin, 'BIGTRIAL');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.trial_days).toBe(MAX_SALES_TRIAL_DAYS);
  });

  it('rejects an inactive code before reaching the salesperson lookup', async () => {
    const admin = makeAdmin({
      codeRow: { code: 'INACTIVE-1', active: false, salesperson_id: 'sp1', trial_days: 30 },
      salespersonRow: SP,
    });
    const res = await validateSalesCode(admin, 'INACTIVE-1');
    expect(res).toEqual({ ok: false, reason: 'inactive' });
  });

  it('rejects a revoked salesperson', async () => {
    const admin = makeAdmin({
      codeRow: { code: 'REVOKED-1', active: true, salesperson_id: 'sp1', trial_days: 30 },
      salespersonRow: { ...SP, revoked_at: '2026-01-01T00:00:00Z' },
    });
    const res = await validateSalesCode(admin, 'REVOKED-1');
    expect(res).toEqual({ ok: false, reason: 'salesperson_inactive' });
  });
});
