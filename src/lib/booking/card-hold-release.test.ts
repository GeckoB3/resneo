import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import {
  deleteCardHoldCustomersForBookings,
  deleteCardHoldCustomersForVenue,
  releaseCardHoldsForBookings,
} from './card-hold-release';

vi.mock('@/lib/stripe', () => ({
  stripe: { customers: { del: vi.fn() } },
}));

const customerDelMock = stripe.customers.del as unknown as Mock;

type HoldRow = {
  id: string;
  booking_id: string;
  venue_id: string;
  stripe_connected_account_id: string;
  stripe_customer_id: string | null;
  fee_pence: number;
  released_at: string | null;
  release_reason?: string | null;
  updated_at?: string;
};

type State = { holds: HoldRow[]; events: Array<Record<string, unknown>> };

function hold(overrides: Partial<HoldRow>): HoldRow {
  return {
    id: 'h1',
    booking_id: 'b1',
    venue_id: 'venue-1',
    stripe_connected_account_id: 'acct_1',
    stripe_customer_id: 'cus_1',
    fee_pence: 2500,
    released_at: null,
    ...overrides,
  };
}

/**
 * In-memory `booking_card_holds` + `events` double. Filters (`in`/`is`/`eq`/
 * `not`) are applied for real so idempotency and the shared-customer check are
 * exercised, not simulated.
 */
function makeAdmin(
  state: State,
  opts: { failSelect?: boolean; failUpdate?: boolean; failEvents?: boolean } = {},
): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'events') {
        return {
          insert: async (rows: Array<Record<string, unknown>>) => {
            if (opts.failEvents) return { error: { message: 'events insert failed' } };
            state.events.push(...rows);
            return { error: null };
          },
        };
      }
      if (table !== 'booking_card_holds') throw new Error(`unexpected table ${table}`);

      const filters: Array<(r: HoldRow) => boolean> = [];
      let limitN: number | null = null;
      let updatePatch: Record<string, unknown> | null = null;
      const builder = {
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          updatePatch = patch;
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push((r) => vals.includes(r[col as keyof HoldRow]));
          return builder;
        },
        is: (col: string, val: unknown) => {
          filters.push((r) => (val === null ? r[col as keyof HoldRow] == null : r[col as keyof HoldRow] === val));
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col as keyof HoldRow] === val);
          return builder;
        },
        not: (col: string, op: string, val: unknown) => {
          if (op === 'is' && val === null) {
            filters.push((r) => r[col as keyof HoldRow] != null);
          } else if (op === 'in') {
            const excluded = String(val).replace(/[()]/g, '').split(',').filter(Boolean);
            filters.push((r) => !excluded.includes(String(r[col as keyof HoldRow])));
          } else {
            throw new Error(`unsupported not(${op})`);
          }
          return builder;
        },
        limit: (n: number) => {
          limitN = n;
          return builder;
        },
        then: (
          resolve: (v: { data: HoldRow[] | null; error: { message: string } | null }) => unknown,
          reject?: (e: unknown) => unknown,
        ) => {
          const run = () => {
            if (updatePatch) {
              if (opts.failUpdate) return { data: null, error: { message: 'update failed' } };
              const matched = state.holds.filter((r) => filters.every((f) => f(r)));
              for (const row of matched) Object.assign(row, updatePatch);
              return { data: matched.map((r) => ({ ...r })), error: null };
            }
            if (opts.failSelect) return { data: null, error: { message: 'select failed' } };
            let rows = state.holds.filter((r) => filters.every((f) => f(r)));
            if (limitN !== null) rows = rows.slice(0, limitN);
            return { data: rows.map((r) => ({ ...r })), error: null };
          };
          return Promise.resolve()
            .then(run)
            .then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  customerDelMock.mockResolvedValue({});
});

describe('releaseCardHoldsForBookings', () => {
  it('releases open holds, inserts events, and deletes the shared customer once', async () => {
    const state: State = {
      holds: [
        hold({ id: 'h1', booking_id: 'b1' }),
        hold({ id: 'h2', booking_id: 'b2', fee_pence: 1000 }),
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await releaseCardHoldsForBookings(admin, ['b1', 'b2'], 'cancelled');

    expect(result.releasedBookingIds.sort()).toEqual(['b1', 'b2']);
    expect(state.holds.every((h) => h.released_at !== null)).toBe(true);
    expect(state.holds.every((h) => h.release_reason === 'cancelled')).toBe(true);

    expect(state.events).toHaveLength(2);
    expect(state.events[0]).toMatchObject({
      venue_id: 'venue-1',
      booking_id: 'b1',
      event_type: 'card_hold_released',
      payload: { booking_id: 'b1', fee_pence: 2500, release_reason: 'cancelled' },
    });

    // One shared customer across the unit: deleted exactly once, on the snapshot account.
    expect(customerDelMock).toHaveBeenCalledTimes(1);
    expect(customerDelMock).toHaveBeenCalledWith('cus_1', { stripeAccount: 'acct_1' });
    expect(result.deletedCustomerIds).toEqual(['cus_1']);
  });

  it('is idempotent: a second call finds no open holds and no-ops', async () => {
    const state: State = { holds: [hold({})], events: [] };
    const admin = makeAdmin(state);

    await releaseCardHoldsForBookings(admin, ['b1'], 'cancelled');
    expect(customerDelMock).toHaveBeenCalledTimes(1);

    const second = await releaseCardHoldsForBookings(admin, ['b1'], 'admin');
    expect(second.releasedBookingIds).toEqual([]);
    expect(second.deletedCustomerIds).toEqual([]);
    expect(customerDelMock).toHaveBeenCalledTimes(1); // unchanged
    expect(state.events).toHaveLength(1); // unchanged
    expect(state.holds[0]!.release_reason).toBe('cancelled'); // first reason kept
  });

  it('skips customer deletion while an open sibling hold shares it, then deletes on the last release', async () => {
    const state: State = {
      holds: [
        hold({ id: 'h1', booking_id: 'b1' }),
        hold({ id: 'h2', booking_id: 'b2' }), // same cus_1, still open
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const first = await releaseCardHoldsForBookings(admin, ['b1'], 'cancelled');
    expect(first.releasedBookingIds).toEqual(['b1']);
    expect(customerDelMock).not.toHaveBeenCalled();
    expect(first.deletedCustomerIds).toEqual([]);

    const second = await releaseCardHoldsForBookings(admin, ['b2'], 'cancelled');
    expect(second.releasedBookingIds).toEqual(['b2']);
    expect(customerDelMock).toHaveBeenCalledTimes(1);
    expect(customerDelMock).toHaveBeenCalledWith('cus_1', { stripeAccount: 'acct_1' });
    expect(second.deletedCustomerIds).toEqual(['cus_1']);
  });

  it('swallows a Stripe customer-deletion failure: the release still succeeds', async () => {
    customerDelMock.mockRejectedValueOnce(new Error('stripe down'));
    const state: State = { holds: [hold({})], events: [] };
    const admin = makeAdmin(state);

    const result = await releaseCardHoldsForBookings(admin, ['b1'], 'expired');

    expect(result.releasedBookingIds).toEqual(['b1']);
    expect(result.deletedCustomerIds).toEqual([]);
    expect(state.holds[0]!.released_at).not.toBeNull();
    expect(state.events).toHaveLength(1);
  });

  it('no-ops on bookings without holds and on empty input', async () => {
    const state: State = { holds: [], events: [] };
    const admin = makeAdmin(state);

    expect(await releaseCardHoldsForBookings(admin, ['b-none'], 'cancelled')).toEqual({
      releasedBookingIds: [],
      deletedCustomerIds: [],
    });
    expect(await releaseCardHoldsForBookings(admin, [], 'cancelled')).toEqual({
      releasedBookingIds: [],
      deletedCustomerIds: [],
    });
    expect(customerDelMock).not.toHaveBeenCalled();
  });

  it('throws when the hold load fails', async () => {
    const state: State = { holds: [hold({})], events: [] };
    const admin = makeAdmin(state, { failSelect: true });

    await expect(releaseCardHoldsForBookings(admin, ['b1'], 'cancelled')).rejects.toThrow(
      /Failed to load card holds/,
    );
  });

  it('releases a hold with no customer id (awaiting-card unit not yet vaulted)', async () => {
    const state: State = { holds: [hold({ stripe_customer_id: null })], events: [] };
    const admin = makeAdmin(state);

    const result = await releaseCardHoldsForBookings(admin, ['b1'], 'cancelled');

    expect(result.releasedBookingIds).toEqual(['b1']);
    expect(customerDelMock).not.toHaveBeenCalled();
  });
});

describe('deleteCardHoldCustomersForBookings', () => {
  it('deletes the customer of an already-released hold (release-time deletion had failed)', async () => {
    const state: State = {
      holds: [hold({ released_at: '2026-06-01T00:00:00.000Z', release_reason: 'cancelled' })],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await deleteCardHoldCustomersForBookings(admin, ['b1']);

    expect(customerDelMock).toHaveBeenCalledTimes(1);
    expect(customerDelMock).toHaveBeenCalledWith('cus_1', { stripeAccount: 'acct_1' });
    expect(result.deletedCustomerIds).toEqual(['cus_1']);
    // Pure cleanup: no release stamping, no events.
    expect(state.events).toHaveLength(0);
    expect(state.holds[0]!.release_reason).toBe('cancelled');
  });

  it('keeps the customer while an open hold outside the deleted set shares it', async () => {
    const state: State = {
      holds: [
        hold({ id: 'h1', booking_id: 'b1', released_at: '2026-06-01T00:00:00.000Z' }),
        hold({ id: 'h2', booking_id: 'b-other' }), // open, shares cus_1, not being deleted
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await deleteCardHoldCustomersForBookings(admin, ['b1']);

    expect(customerDelMock).not.toHaveBeenCalled();
    expect(result.deletedCustomerIds).toEqual([]);
  });

  it('ignores open holds inside the deleted set for the sibling check', async () => {
    const state: State = {
      holds: [
        hold({ id: 'h1', booking_id: 'b1' }),
        hold({ id: 'h2', booking_id: 'b2' }),
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await deleteCardHoldCustomersForBookings(admin, ['b1', 'b2']);

    expect(customerDelMock).toHaveBeenCalledTimes(1);
    expect(result.deletedCustomerIds).toEqual(['cus_1']);
  });

  it('ignores a released sibling outside the set (it no longer needs the card)', async () => {
    const state: State = {
      holds: [
        hold({ id: 'h1', booking_id: 'b1' }),
        hold({ id: 'h2', booking_id: 'b-other', released_at: '2026-06-01T00:00:00.000Z' }),
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await deleteCardHoldCustomersForBookings(admin, ['b1']);

    expect(customerDelMock).toHaveBeenCalledTimes(1);
    expect(result.deletedCustomerIds).toEqual(['cus_1']);
  });

  it('swallows Stripe failures and a failed load (best-effort, never blocks the delete)', async () => {
    customerDelMock.mockRejectedValueOnce(new Error('stripe down'));
    const state: State = { holds: [hold({})], events: [] };

    const failed = await deleteCardHoldCustomersForBookings(makeAdmin(state), ['b1']);
    expect(failed.deletedCustomerIds).toEqual([]);

    const loadFail = await deleteCardHoldCustomersForBookings(
      makeAdmin(state, { failSelect: true }),
      ['b1'],
    );
    expect(loadFail.deletedCustomerIds).toEqual([]);
  });

  it('no-ops on empty input and on holds without a customer id', async () => {
    const state: State = { holds: [hold({ stripe_customer_id: null })], events: [] };
    const admin = makeAdmin(state);

    expect(await deleteCardHoldCustomersForBookings(admin, [])).toEqual({
      deletedCustomerIds: [],
    });
    expect(await deleteCardHoldCustomersForBookings(admin, ['b1'])).toEqual({
      deletedCustomerIds: [],
    });
    expect(customerDelMock).not.toHaveBeenCalled();
  });
});

describe('deleteCardHoldCustomersForVenue', () => {
  it('deletes every customer of the venue, released holds included, with no sibling check', async () => {
    const state: State = {
      holds: [
        hold({ id: 'h1', booking_id: 'b1' }), // open
        hold({
          id: 'h2',
          booking_id: 'b2',
          stripe_customer_id: 'cus_2',
          released_at: '2026-06-01T00:00:00.000Z',
          release_reason: 'cancelled',
        }), // released: still cleaned up (venue delete is the last chance)
        hold({ id: 'h3', booking_id: 'b3', stripe_customer_id: 'cus_1' }), // shares cus_1: dedupe
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await deleteCardHoldCustomersForVenue(admin, 'venue-1');

    expect(customerDelMock).toHaveBeenCalledTimes(2);
    expect(customerDelMock).toHaveBeenCalledWith('cus_1', { stripeAccount: 'acct_1' });
    expect(customerDelMock).toHaveBeenCalledWith('cus_2', { stripeAccount: 'acct_1' });
    expect(result.deletedCustomerIds.sort()).toEqual(['cus_1', 'cus_2']);
    // Pure cleanup: no release stamping, no events.
    expect(state.events).toHaveLength(0);
    expect(state.holds[0]!.released_at).toBeNull();
  });

  it('only touches the given venue\'s holds', async () => {
    const state: State = {
      holds: [
        hold({ id: 'h1', booking_id: 'b1', venue_id: 'venue-other', stripe_customer_id: 'cus_other' }),
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await deleteCardHoldCustomersForVenue(admin, 'venue-1');

    expect(customerDelMock).not.toHaveBeenCalled();
    expect(result.deletedCustomerIds).toEqual([]);
  });

  it('swallows Stripe failures and a failed load (best-effort, never blocks the venue delete)', async () => {
    customerDelMock.mockRejectedValueOnce(new Error('stripe down'));
    const state: State = { holds: [hold({})], events: [] };

    const failed = await deleteCardHoldCustomersForVenue(makeAdmin(state), 'venue-1');
    expect(failed.deletedCustomerIds).toEqual([]);

    const loadFail = await deleteCardHoldCustomersForVenue(
      makeAdmin(state, { failSelect: true }),
      'venue-1',
    );
    expect(loadFail.deletedCustomerIds).toEqual([]);
  });

  it('no-ops on an empty venue id and on holds without a customer id', async () => {
    const state: State = { holds: [hold({ stripe_customer_id: null })], events: [] };
    const admin = makeAdmin(state);

    expect(await deleteCardHoldCustomersForVenue(admin, '')).toEqual({ deletedCustomerIds: [] });
    expect(await deleteCardHoldCustomersForVenue(admin, 'venue-1')).toEqual({
      deletedCustomerIds: [],
    });
    expect(customerDelMock).not.toHaveBeenCalled();
  });
});
