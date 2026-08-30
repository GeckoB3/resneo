/**
 * A Supabase test double that both RECORDS and accepts WRITES (P0-0 of
 * Docs/Resneo_Customer_Portal_World_Class_Plan.md; blocks P0-3, P0-9, P0-11, P1-1).
 *
 * Neither existing double does both jobs. `supabase-fake.ts` applies real filters
 * and records calls but is read-only: no insert, update, delete, rpc or joins.
 * `src/lib/compliance/test-utils/fake-supabase.ts` writes state but has no call
 * log. Every complex route test hand-rolls its own recorder; this module is the
 * `makeDb(responder)` recorder from
 * `src/app/api/venue/bookings/[id]/charge/route.test.ts`, extracted and grown to
 * the method surface the guest-action call graph actually uses.
 *
 * Responder-driven, not row-driven: the test supplies one function that receives
 * every call (table, op, payload, filters, in order) and decides the result.
 * That keeps fixtures next to assertions and makes "the third read of bookings
 * fails with 23505" a one-line injection rather than a stateful fixture dance.
 *
 * What a call records:
 *   - `table`   the table name, or `rpc:<fn>` for rpc()
 *   - `op`      select | insert | update | upsert | delete | rpc
 *   - `payload` insert/update/upsert payload, or rpc args
 *   - `columns` the select() projection string, when one was given
 *   - `filters` every chained modifier in call order, e.g.
 *               ['eq','venue_id','v1'], ['in','id',[...]], ['order','booking_date',{...}]
 *
 * Unmatched calls (responder returns undefined) resolve to REALISTIC empties
 * rather than nulls that no live client would produce:
 *   - awaited select        -> { data: [],   error: null }
 *   - maybeSingle()         -> { data: null, error: null }
 *   - single()              -> { data: null, error: PG_ERRORS.noRows }  (a real
 *     single() can never yield data:null,error:null; a default that did would
 *     let a suite pass while testing nothing)
 *   - awaited write / rpc   -> { data: null, error: null }
 *
 * The after() stub: P0-9's route calls `after()` from next/server at five
 * sites, and every deferred email, SMS and push assertion lives inside those
 * callbacks. `makeAfterStub()` returns `vi.fn((cb) => cb())`, which RUNS the
 * callback. Do not replace it with a bare vi.fn(): that silently swallows the
 * deferred work and the suite passes while asserting nothing. Assert on the
 * observable outcome (email queued, refund issued), never on this stub's shape;
 * AD1 changes the mechanism and outcome-coupled tests survive that.
 */
import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

export type RecordedOp = 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';

export interface RecordedCall {
  table: string;
  op: RecordedOp;
  payload?: unknown;
  columns?: string;
  filters: Array<[string, ...unknown[]]>;
}

export interface ResponderResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

export type Responder = (call: RecordedCall) => ResponderResult | undefined;

/**
 * The Postgres/PostgREST errors the portal work injects (P0-3: short-link 23505
 * re-select; P2-3a: 23P01 exclusion overlap; P0-9: PGRST116 and both of the
 * above). Shaped like real PostgrestError objects so `error.code` checks in
 * production code match.
 */
export const PG_ERRORS = {
  /** 23505 unique_violation. */
  uniqueViolation: {
    code: '23505',
    message: 'duplicate key value violates unique constraint',
    details: '',
    hint: '',
  },
  /** 23P01 exclusion_violation (slot overlap). */
  exclusionViolation: {
    code: '23P01',
    message: 'conflicting key value violates exclusion constraint',
    details: '',
    hint: '',
  },
  /** PostgREST: single() over zero (or many) rows. */
  noRows: {
    code: 'PGRST116',
    message: 'JSON object requested, multiple (or no) rows returned',
    details: 'The result contains 0 rows',
    hint: '',
  },
} as const;

interface Injection {
  matches: (call: RecordedCall) => boolean;
  error: unknown;
  remaining: number;
}

export interface RecordingDb {
  /** Cast ready for handing to code typed against SupabaseClient. */
  db: SupabaseClient;
  /** Every call, in order. Mutated live; assert after awaiting the code under test. */
  calls: RecordedCall[];
  /** Query count, optionally narrowed: queryCount({ table: 'bookings', op: 'select' }). */
  queryCount(filter?: { table?: string; op?: RecordedOp }): number;
  /**
   * Force the next matching call(s) to fail with `error`, before the responder
   * is consulted. `times` defaults to 1, so a retry loop sees the failure once
   * and then reaches the responder: exactly the 23505-then-re-select shape
   * P0-3's short-link fix is tested with.
   */
  inject(
    matches: (call: RecordedCall) => boolean,
    error: unknown,
    opts?: { times?: number },
  ): void;
}

/** Fresh per test: a shared instance would accumulate calls across tests. */
export function makeAfterStub() {
  return vi.fn((cb: () => unknown) => cb());
}

/** Modifiers recorded into `filters` and returning the builder for chaining. */
const CHAINED_MODIFIERS = [
  'eq', 'neq', 'in', 'is', 'not', 'gte', 'gt', 'lte', 'lt',
  'like', 'ilike', 'or', 'filter', 'match', 'contains', 'overlaps',
  'order', 'limit', 'range',
] as const;

export function makeRecordingDb(responder: Responder = () => undefined): RecordingDb {
  const calls: RecordedCall[] = [];
  const injections: Injection[] = [];

  const takeInjection = (call: RecordedCall): unknown | undefined => {
    for (const inj of injections) {
      if (inj.remaining > 0 && inj.matches(call)) {
        inj.remaining -= 1;
        return inj.error;
      }
    }
    return undefined;
  };

  const resolve = (
    call: RecordedCall,
    terminator: 'list' | 'single' | 'maybeSingle',
  ): { data: unknown; error: unknown; count: number | null } => {
    const injected = takeInjection(call);
    if (injected !== undefined) return { data: null, error: injected, count: null };

    const res = responder(call);
    if (res !== undefined) {
      return { data: res.data ?? null, error: res.error ?? null, count: res.count ?? null };
    }
    if (terminator === 'single') return { data: null, error: PG_ERRORS.noRows, count: null };
    if (terminator === 'list' && call.op === 'select') return { data: [], error: null, count: null };
    return { data: null, error: null, count: null };
  };

  const makeBuilder = (call: RecordedCall) => {
    const builder: Record<string, unknown> = {};
    const chain = (fn: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        fn(...args);
        return builder;
      };

    builder.select = chain((cols) => {
      if (call.op === 'select') {
        call.columns = typeof cols === 'string' ? cols : '*';
      } else {
        // .insert(x).select('id') asks for RETURNING; it does not start a read.
        call.filters.push(['returning', cols ?? '*']);
      }
    });
    builder.insert = chain((payload) => { call.op = 'insert'; call.payload = payload; });
    builder.update = chain((payload) => { call.op = 'update'; call.payload = payload; });
    builder.upsert = chain((payload) => { call.op = 'upsert'; call.payload = payload; });
    builder.delete = chain(() => { call.op = 'delete'; });
    for (const m of CHAINED_MODIFIERS) {
      builder[m] = chain((...args) => call.filters.push([m, ...args]));
    }
    builder.maybeSingle = () => Promise.resolve(resolve(call, 'maybeSingle'));
    builder.single = () => Promise.resolve(resolve(call, 'single'));
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(resolve(call, 'list')).then(onFulfilled, onRejected);
    return builder;
  };

  const db = {
    from(table: string) {
      const call: RecordedCall = { table, op: 'select', filters: [] };
      calls.push(call);
      return makeBuilder(call);
    },
    rpc(fn: string, args?: unknown) {
      const call: RecordedCall = { table: `rpc:${fn}`, op: 'rpc', payload: args, filters: [] };
      calls.push(call);
      return makeBuilder(call);
    },
  } as unknown as SupabaseClient;

  return {
    db,
    calls,
    queryCount(filter) {
      return calls.filter(
        (c) => (!filter?.table || c.table === filter.table) && (!filter?.op || c.op === filter.op),
      ).length;
    },
    inject(matches, error, opts) {
      injections.push({ matches, error, remaining: opts?.times ?? 1 });
    },
  };
}
