import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { settleCardHoldsOnCancellation } from './card-hold-cancellation';

vi.mock('@/lib/booking/card-hold-release', () => ({
  releaseCardHoldsForBookings: vi.fn(async (_admin: unknown, ids: string[]) => ({
    releasedBookingIds: ids,
    deletedCustomerIds: [],
  })),
}));

const releaseMock = releaseCardHoldsForBookings as unknown as Mock;

const NOW = new Date('2026-07-06T12:00:00.000Z');
const PAST_DEADLINE = '2026-07-06T10:00:00.000Z'; // deadline already passed at NOW
const FUTURE_DEADLINE = '2026-07-06T14:00:00.000Z'; // still inside the free window

type HoldRow = {
  id: string;
  booking_id: string;
  venue_id: string;
  fee_pence: number;
  stripe_payment_method_id: string | null;
  late_cancellation_at: string | null;
  released_at: string | null;
  charged_at: string | null;
  terms_snapshot: { version?: number } | null;
  updated_at?: string;
};

type BookingRow = { id: string; cancellation_deadline: string | null };

type State = {
  holds: HoldRow[];
  bookings: BookingRow[];
  events: Array<Record<string, unknown>>;
};

function holdRow(overrides: Partial<HoldRow>): HoldRow {
  return {
    id: 'h1',
    booking_id: 'b1',
    venue_id: 'venue-1',
    fee_pence: 2500,
    stripe_payment_method_id: 'pm_1',
    late_cancellation_at: null,
    released_at: null,
    charged_at: null,
    terms_snapshot: { version: 2 },
    ...overrides,
  };
}

/** In-memory double for booking_card_holds + bookings + events with real filters. */
function makeAdmin(
  state: State,
  opts: { failHoldSelect?: boolean; failBookingSelect?: boolean; failStamp?: boolean } = {},
): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'events') {
        return {
          insert: async (rows: Array<Record<string, unknown>>) => {
            state.events.push(...rows);
            return { error: null };
          },
        };
      }
      if (table === 'bookings') {
        const filters: Array<(r: BookingRow) => boolean> = [];
        const builder = {
          select: () => builder,
          in: (col: string, vals: unknown[]) => {
            filters.push((r) => vals.includes(r[col as keyof BookingRow]));
            return builder;
          },
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            const run = () =>
              opts.failBookingSelect
                ? { data: null, error: { message: 'booking select failed' } }
                : { data: state.bookings.filter((r) => filters.every((f) => f(r))), error: null };
            return Promise.resolve().then(run).then(resolve, reject);
          },
        };
        return builder;
      }
      if (table !== 'booking_card_holds') throw new Error(`unexpected table ${table}`);

      const filters: Array<(r: HoldRow) => boolean> = [];
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
          filters.push((r) =>
            val === null ? r[col as keyof HoldRow] == null : r[col as keyof HoldRow] === val,
          );
          return builder;
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          const run = () => {
            if (updatePatch) {
              if (opts.failStamp) return { data: null, error: { message: 'stamp failed' } };
              const matched = state.holds.filter((r) => filters.every((f) => f(r)));
              for (const row of matched) Object.assign(row, updatePatch);
              return { data: matched.map((r) => ({ ...r })), error: null };
            }
            if (opts.failHoldSelect) return { data: null, error: { message: 'hold select failed' } };
            return { data: state.holds.filter((r) => filters.every((f) => f(r))), error: null };
          };
          return Promise.resolve().then(run).then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  releaseMock.mockImplementation(async (_admin: unknown, ids: string[]) => ({
    releasedBookingIds: ids,
    deletedCustomerIds: [],
  }));
});

describe('settleCardHoldsOnCancellation', () => {
  it('keeps a saved hold when the cancellation is after the deadline', async () => {
    const state: State = {
      holds: [holdRow({})],
      bookings: [{ id: 'b1', cancellation_deadline: PAST_DEADLINE }],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1'], { now: NOW });

    expect(result.keptHolds).toEqual([{ bookingId: 'b1', feePence: 2500 }]);
    expect(result.releasedBookingIds).toEqual([]);
    expect(releaseMock).not.toHaveBeenCalled();
    expect(state.holds[0]!.late_cancellation_at).not.toBeNull();
    expect(state.holds[0]!.released_at).toBeNull();
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      venue_id: 'venue-1',
      booking_id: 'b1',
      event_type: 'card_hold_kept_late_cancellation',
      payload: { booking_id: 'b1', fee_pence: 2500, cancellation_deadline: PAST_DEADLINE },
    });
  });

  it('releases a saved hold when the cancellation is before the deadline', async () => {
    const state: State = {
      holds: [holdRow({})],
      bookings: [{ id: 'b1', cancellation_deadline: FUTURE_DEADLINE }],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1'], { now: NOW });

    expect(result.keptHolds).toEqual([]);
    expect(result.releasedBookingIds).toEqual(['b1']);
    expect(releaseMock).toHaveBeenCalledWith(admin, ['b1'], 'cancelled');
    expect(state.holds[0]!.late_cancellation_at).toBeNull();
  });

  it('releases an UNSAVED hold even after the deadline (no card to charge)', async () => {
    const state: State = {
      holds: [holdRow({ stripe_payment_method_id: null })],
      bookings: [{ id: 'b1', cancellation_deadline: PAST_DEADLINE }],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1'], { now: NOW });

    expect(result.keptHolds).toEqual([]);
    expect(result.releasedBookingIds).toEqual(['b1']);
  });

  it('releases a version-1 hold even on a late cancel (its consent promised charge-free cancellation)', async () => {
    const state: State = {
      holds: [holdRow({ terms_snapshot: { version: 1 } })],
      bookings: [{ id: 'b1', cancellation_deadline: PAST_DEADLINE }],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1'], { now: NOW });

    expect(result.keptHolds).toEqual([]);
    expect(result.releasedBookingIds).toEqual(['b1']);
    expect(state.holds[0]!.late_cancellation_at).toBeNull();
  });

  it('releases a hold with no terms snapshot version at all', async () => {
    const state: State = {
      holds: [holdRow({ terms_snapshot: null })],
      bookings: [{ id: 'b1', cancellation_deadline: PAST_DEADLINE }],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1'], { now: NOW });

    expect(result.keptHolds).toEqual([]);
    expect(result.releasedBookingIds).toEqual(['b1']);
  });

  it('releases when the booking has no cancellation deadline', async () => {
    const state: State = {
      holds: [holdRow({})],
      bookings: [{ id: 'b1', cancellation_deadline: null }],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1'], { now: NOW });

    expect(result.keptHolds).toEqual([]);
    expect(result.releasedBookingIds).toEqual(['b1']);
  });

  it('partitions a group: late saved holds kept, the rest released', async () => {
    const state: State = {
      holds: [
        holdRow({ id: 'h1', booking_id: 'b1' }),
        holdRow({ id: 'h2', booking_id: 'b2', fee_pence: 1000 }),
        holdRow({ id: 'h3', booking_id: 'b3', stripe_payment_method_id: null }),
      ],
      bookings: [
        { id: 'b1', cancellation_deadline: PAST_DEADLINE },
        { id: 'b2', cancellation_deadline: FUTURE_DEADLINE },
        { id: 'b3', cancellation_deadline: PAST_DEADLINE },
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1', 'b2', 'b3'], { now: NOW });

    expect(result.keptHolds).toEqual([{ bookingId: 'b1', feePence: 2500 }]);
    expect(result.releasedBookingIds.sort()).toEqual(['b2', 'b3']);
    expect(releaseMock).toHaveBeenCalledWith(admin, ['b2', 'b3'], 'cancelled');
    expect(state.holds[0]!.late_cancellation_at).not.toBeNull();
    expect(state.holds[1]!.late_cancellation_at).toBeNull();
  });

  it('is idempotent: an already-kept hold is reported kept without duplicate events', async () => {
    const state: State = {
      holds: [holdRow({ late_cancellation_at: '2026-07-06T11:00:00.000Z' })],
      bookings: [{ id: 'b1', cancellation_deadline: PAST_DEADLINE }],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1'], { now: NOW });

    expect(result.keptHolds).toEqual([{ bookingId: 'b1', feePence: 2500 }]);
    expect(state.holds[0]!.late_cancellation_at).toBe('2026-07-06T11:00:00.000Z');
    expect(state.events).toHaveLength(0);
  });

  it('never touches released or charged holds', async () => {
    const state: State = {
      holds: [
        holdRow({ id: 'h1', booking_id: 'b1', released_at: '2026-07-01T00:00:00.000Z' }),
        holdRow({ id: 'h2', booking_id: 'b2', charged_at: '2026-07-01T00:00:00.000Z' }),
      ],
      bookings: [
        { id: 'b1', cancellation_deadline: PAST_DEADLINE },
        { id: 'b2', cancellation_deadline: PAST_DEADLINE },
      ],
      events: [],
    };
    const admin = makeAdmin(state);

    const result = await settleCardHoldsOnCancellation(admin, ['b1', 'b2'], { now: NOW });

    expect(result).toEqual({ releasedBookingIds: [], keptHolds: [] });
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('falls back to releasing everything when the booking deadlines cannot be read', async () => {
    const state: State = {
      holds: [holdRow({})],
      bookings: [{ id: 'b1', cancellation_deadline: PAST_DEADLINE }],
      events: [],
    };
    const admin = makeAdmin(state, { failBookingSelect: true });

    const result = await settleCardHoldsOnCancellation(admin, ['b1'], { now: NOW });

    expect(result.keptHolds).toEqual([]);
    expect(result.releasedBookingIds).toEqual(['b1']);
    expect(releaseMock).toHaveBeenCalledWith(admin, ['b1'], 'cancelled');
  });

  it('no-ops on empty input and bookings without holds', async () => {
    const state: State = { holds: [], bookings: [], events: [] };
    const admin = makeAdmin(state);

    expect(await settleCardHoldsOnCancellation(admin, [], { now: NOW })).toEqual({
      releasedBookingIds: [],
      keptHolds: [],
    });
    expect(await settleCardHoldsOnCancellation(admin, ['b-none'], { now: NOW })).toEqual({
      releasedBookingIds: [],
      keptHolds: [],
    });
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('throws when the hold load or the keep stamp fails', async () => {
    const state: State = {
      holds: [holdRow({})],
      bookings: [{ id: 'b1', cancellation_deadline: PAST_DEADLINE }],
      events: [],
    };

    await expect(
      settleCardHoldsOnCancellation(makeAdmin(state, { failHoldSelect: true }), ['b1'], { now: NOW }),
    ).rejects.toThrow(/Failed to load card holds/);

    await expect(
      settleCardHoldsOnCancellation(makeAdmin(state, { failStamp: true }), ['b1'], { now: NOW }),
    ).rejects.toThrow(/Failed to keep the card holds/);
  });
});
