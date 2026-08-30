/**
 * P4-4: seeing and leaving a waitlist, and whose entry is whose.
 *
 * `waitlist_entries` keeps exactly one RLS policy, for staff, and a migration
 * deliberately dropped the public ones. So nothing in the database stops one
 * customer cancelling another's place: the only thing that does is this
 * module scoping every statement by the account's own verified address.
 *
 * Ownership is by EMAIL because the table forces it. A waitlist entry is made
 * before any booking exists, often by somebody with no account, so the address
 * typed at the time is the only identity it carries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadAccountWaitlist,
  cancelAccountWaitlistEntry,
  ACCOUNT_WAITLIST_COLUMNS,
} from './account-waitlist';
import type { SupabaseClient } from '@supabase/supabase-js';

type Filters = Record<string, unknown>;

const state = {
  /** Rows the fake table holds. */
  rows: [] as Array<Record<string, unknown>>,
  /** Filters the last query applied, so the tests can assert scoping. */
  lastFilters: {} as Filters,
  lastSelect: '' as string,
  lastUpdate: null as Record<string, unknown> | null,
  failWith: null as string | null,
};

/**
 * Enough of PostgREST to record what was asked and answer from `rows`.
 *
 * `from()` returns a FRESH chain each time, because the real client does and
 * because cancelling issues two queries: sharing one chain leaked the first
 * query's status filter into the second and made an already-cancelled entry
 * look missing. The double was wrong, not the code, which is worth saying
 * because the failure looked exactly like a real ownership bug.
 */
function admin(): SupabaseClient {
  return {
    from: () => {
      const filters: Filters = {};
      let statusIn: string[] | null = null;
      let update: Record<string, unknown> | null = null;
      const matching = () =>
        state.rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      const chain: Record<string, unknown> = {
        select: (cols: string) => {
          state.lastSelect = cols;
          return chain;
        },
        update: (patch: Record<string, unknown>) => {
          update = patch;
          state.lastUpdate = patch;
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          state.lastFilters[col] = val;
          return chain;
        },
        in: (_col: string, vals: string[]) => {
          statusIn = vals;
          return chain;
        },
        order: () => chain,
        limit: () =>
          Promise.resolve(
            state.failWith
              ? { data: null, error: { message: state.failWith } }
              : { data: matching(), error: null },
          ),
        maybeSingle: () => {
          if (state.failWith) {
            return Promise.resolve({ data: null, error: { message: state.failWith } });
          }
          let hits = matching();
          if (statusIn) hits = hits.filter((r) => statusIn!.includes(String(r.status)));
          const row = hits[0] ?? null;
          if (row && update) Object.assign(row, update);
          return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 'w-1',
    venue_id: 'v-1',
    waitlist_kind: 'appointment',
    status: 'waiting',
    desired_date: '2026-09-20',
    guest_email: 'ada@example.test',
    ...over,
  };
}

beforeEach(() => {
  state.rows = [entry()];
  state.lastFilters = {};
  state.lastSelect = '';
  state.lastUpdate = null;
  state.failWith = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('listing', () => {
  it('scopes to the account’s own address, lowercased', async () => {
    // The join routes store it trimmed and lowercased, so the match is exact
    // rather than fuzzy. An account whose auth email is capitalised must still
    // find its own entries.
    await loadAccountWaitlist(admin(), '  Ada@Example.TEST ');
    expect(state.lastFilters.guest_email).toBe('ada@example.test');
  });

  it('returns nothing at all when the account has no email', async () => {
    // No address means no way to prove ownership, so the answer is nothing
    // rather than an unfiltered read of every customer's waitlist.
    expect(await loadAccountWaitlist(admin(), null)).toEqual([]);
    expect(state.lastFilters.guest_email, 'the table was queried anyway').toBeUndefined();
  });

  it('asks for an explicit column list, never a wildcard', async () => {
    await loadAccountWaitlist(admin(), 'ada@example.test');
    expect(state.lastSelect).toBe(ACCOUNT_WAITLIST_COLUMNS);
    expect(state.lastSelect).not.toContain('*');
  });

  it('does not return the phone, email or notes back to the customer', async () => {
    await loadAccountWaitlist(admin(), 'ada@example.test');
    for (const field of ['guest_phone', 'guest_email', 'notes']) {
      expect(state.lastSelect).not.toContain(field);
    }
  });

  it('throws rather than returning [] when the read fails', async () => {
    // An empty list would tell the customer they are on no waitlists, which is
    // a claim (P4-1's rule).
    state.failWith = 'connection lost';
    await expect(loadAccountWaitlist(admin(), 'ada@example.test')).rejects.toThrow();
  });
});

describe('cancelling', () => {
  it('cancels the caller’s own waiting entry', async () => {
    const res = await cancelAccountWaitlistEntry(admin(), 'ada@example.test', 'w-1');
    expect(res).toEqual({ ok: true });
    expect(state.lastUpdate).toEqual({ status: 'cancelled' });
  });

  it('filters by id AND email in the SAME statement', async () => {
    /*
      The heart of it. Reading the row and then updating by id alone would put
      the ownership rule in two places and leave a window between them.
    */
    await cancelAccountWaitlistEntry(admin(), 'ada@example.test', 'w-1');
    expect(state.lastFilters.id).toBe('w-1');
    expect(state.lastFilters.guest_email).toBe('ada@example.test');
  });

  it('lowercases the address here TOO, not just when listing', async () => {
    /*
      Found by a mutation sweep, which is the only reason it is here: the
      listing test covered the trimming and this path did not, so an account
      whose auth email is capitalised could SEE its waitlist places and then
      fail to leave them, with the cancel reporting "not found" about a row
      sitting in front of the customer.
    */
    const res = await cancelAccountWaitlistEntry(admin(), '  Ada@Example.TEST ', 'w-1');
    expect(res).toEqual({ ok: true });
    expect(state.lastFilters.guest_email).toBe('ada@example.test');
  });

  it('returns not_found for ANOTHER customer’s entry', async () => {
    // The acceptance. The row exists; it is simply not theirs, and they learn
    // nothing that distinguishes it from an id that never existed.
    const res = await cancelAccountWaitlistEntry(admin(), 'someone-else@example.test', 'w-1');
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('never modifies another customer’s row', async () => {
    await cancelAccountWaitlistEntry(admin(), 'someone-else@example.test', 'w-1');
    expect(state.rows[0].status, 'a stranger changed the row').toBe('waiting');
  });

  it('tells an already-cancelled entry apart from a missing one', async () => {
    // Different sentences for the customer: "you already left that" is not
    // "we cannot find it". The extra read is scoped to their own rows.
    state.rows = [entry({ status: 'cancelled' })];
    const res = await cancelAccountWaitlistEntry(admin(), 'ada@example.test', 'w-1');
    expect(res).toEqual({ ok: false, reason: 'not_cancellable' });
  });

  it('refuses to cancel a confirmed place, which is now a booking', async () => {
    state.rows = [entry({ status: 'confirmed' })];
    const res = await cancelAccountWaitlistEntry(admin(), 'ada@example.test', 'w-1');
    expect(res.ok).toBe(false);
  });

  it('cancels an OFFERED place, which is exactly when someone wants to', async () => {
    state.rows = [entry({ status: 'offered' })];
    expect(await cancelAccountWaitlistEntry(admin(), 'ada@example.test', 'w-1')).toEqual({
      ok: true,
    });
  });

  it('refuses when the account has no email', async () => {
    const res = await cancelAccountWaitlistEntry(admin(), null, 'w-1');
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    expect(state.lastUpdate, 'an unscoped update was attempted').toBeNull();
  });
});
