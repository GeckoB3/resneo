import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Focused in-memory Supabase stub for the data-import engine integration tests.
 *
 * It is NOT a general Supabase emulator. It implements only the chained
 * query-builder surface that `runExtractBookingReferences` and the staged-bookings
 * phase of `runImportExecuteBatch` actually call:
 *
 *   from(t).select(cols).eq().is().in().ilike().order().limit().range()
 *           .single() / .maybeSingle() / await
 *   from(t).insert(rowOrRows)               (optionally .select().single())
 *   from(t).upsert(rows, { onConflict, ignoreDuplicates })
 *   from(t).update(patch).eq()
 *   from(t).delete().eq()
 *   rpc(name, args)                          (handlers provided per test)
 *   storage.from(bucket).download(path)      (CSV text provided per storage_path)
 *
 * Anything not implemented throws loudly so coverage gaps are obvious rather than
 * silently returning empty/wrong data.
 *
 * Tables are plain arrays keyed by name; tests seed them via the constructor and
 * read them back with `db.rows(table)`.
 */

export type Row = Record<string, unknown>;

let idCounter = 0;
function nextId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Reset the shared id counter so ids are stable/predictable within a test. */
export function resetStubIds(): void {
  idCounter = 0;
}

export type RpcHandler = (args: Record<string, unknown>) => { data: unknown; error: unknown };

export interface StubOptions {
  /**
   * Map of storage_path -> CSV text. `storage.from(bucket).download(path)` returns
   * a Blob-like object whose `.text()` resolves to this string.
   */
  files?: Record<string, string>;
  /** Per-name `rpc()` handlers. Unhandled rpc names throw. */
  rpc?: Record<string, RpcHandler>;
  /** Inject a one-off error for the next insert into the named table. */
  failNextInsert?: Record<string, { code?: string; message: string }>;
}

export class SupabaseStub {
  readonly tables: Record<string, Row[]> = {};
  private readonly files: Record<string, string>;
  private readonly rpcHandlers: Record<string, RpcHandler>;
  private readonly failNextInsert: Record<string, { code?: string; message: string }>;
  /** Records every rpc call for assertions: [name, args]. */
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(seed: Record<string, Row[]> = {}, options: StubOptions = {}) {
    for (const [t, rows] of Object.entries(seed)) {
      this.tables[t] = rows.map((r) => ({ ...r }));
    }
    this.files = { ...(options.files ?? {}) };
    this.rpcHandlers = { ...(options.rpc ?? {}) };
    this.failNextInsert = { ...(options.failNextInsert ?? {}) };
  }

  /** Read a table's current rows (clone) for assertions. */
  rows(table: string): Row[] {
    return (this.tables[table] ?? []).map((r) => ({ ...r }));
  }

  ensure(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table]!;
  }

  consumeInsertFailure(table: string): { code?: string; message: string } | null {
    const f = this.failNextInsert[table];
    if (f) {
      delete this.failNextInsert[table];
      return f;
    }
    return null;
  }

  callRpc(name: string, args: Record<string, unknown>): { data: unknown; error: unknown } {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcHandlers[name];
    if (!handler) {
      throw new Error(`[supabase-stub] rpc("${name}") is not stubbed — add a handler in StubOptions.rpc`);
    }
    return handler(args);
  }

  download(bucket: string, path: string): { data: { text: () => Promise<string> } | null; error: unknown } {
    const text = this.files[path];
    if (text == null) {
      return {
        data: null,
        error: { message: `[supabase-stub] no file seeded for storage path "${path}" (bucket "${bucket}")` },
      };
    }
    return { data: { text: () => Promise.resolve(text) }, error: null };
  }

  asClient(): SupabaseClient {
    // Arrow functions capture `this` lexically, so no `self` alias is needed.
    return {
      from: (table: string) => new StubQuery(this, table),
      rpc: (name: string, args?: Record<string, unknown>) =>
        Promise.resolve(this.callRpc(name, args ?? {})),
      storage: {
        from: (bucket: string) => ({
          download: (path: string) => Promise.resolve(this.download(bucket, path)),
        }),
      },
    } as unknown as SupabaseClient;
  }
}

type FilterOp = 'eq' | 'ilike' | 'in' | 'is' | 'gt' | 'gte' | 'lt' | 'lte';
type Filter = { col: string; op: FilterOp; val: unknown };

type CountMode = { count: 'exact'; head: boolean } | null;

class StubQuery implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private filters: Filter[] = [];
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: Row | Row[] | null = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private orderBys: Array<{ col: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private rangeFromTo: { from: number; to: number } | null = null;
  private returnRows = false;
  private countMode: CountMode = null;

  constructor(
    private db: SupabaseStub,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: 'exact'; head?: boolean }): this {
    this.returnRows = true;
    if (opts?.count) this.countMode = { count: 'exact', head: Boolean(opts.head) };
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = 'upsert';
    this.payload = payload;
    this.upsertOpts = opts ?? {};
    return this;
  }
  update(payload: Row): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }
  ilike(col: string, val: string): this {
    this.filters.push({ col, op: 'ilike', val });
    return this;
  }
  in(col: string, val: unknown[]): this {
    this.filters.push({ col, op: 'in', val });
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push({ col, op: 'is', val });
    return this;
  }
  gt(col: string, val: unknown): this {
    this.filters.push({ col, op: 'gt', val });
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters.push({ col, op: 'gte', val });
    return this;
  }
  lt(col: string, val: unknown): this {
    this.filters.push({ col, op: 'lt', val });
    return this;
  }
  lte(col: string, val: unknown): this {
    this.filters.push({ col, op: 'lte', val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBys.push({ col, asc: opts?.ascending ?? true });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.rangeFromTo = { from, to };
    return this;
  }

  private match(row: Row): boolean {
    return this.filters.every((f) => {
      const cell = row[f.col];
      switch (f.op) {
        case 'eq':
          return cell === f.val;
        case 'is':
          return f.val === null ? cell === null || cell === undefined : cell === f.val;
        case 'in':
          return Array.isArray(f.val) && f.val.includes(cell);
        case 'ilike': {
          // Postgres ILIKE with `%` wildcards, used by name-match. Anchor unless
          // a leading/trailing `%` is present; treat interior `%` as wildcards.
          if (typeof cell !== 'string' || typeof f.val !== 'string') return false;
          const pat = f.val.toLowerCase();
          const cellLc = cell.toLowerCase();
          const hasLead = pat.startsWith('%');
          const hasTrail = pat.endsWith('%');
          const core = pat.replace(/^%/, '').replace(/%$/, '');
          if (hasLead && hasTrail) return cellLc.includes(core);
          if (hasTrail) return cellLc.startsWith(core);
          if (hasLead) return cellLc.endsWith(core);
          return cellLc === core;
        }
        case 'gt':
          return (cell as number | string) > (f.val as number | string);
        case 'gte':
          return (cell as number | string) >= (f.val as number | string);
        case 'lt':
          return (cell as number | string) < (f.val as number | string);
        case 'lte':
          return (cell as number | string) <= (f.val as number | string);
        default:
          return false;
      }
    });
  }

  private applied(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.match(r));
    for (const ob of [...this.orderBys].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = a[ob.col] as number | string;
        const bv = b[ob.col] as number | string;
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (ob.asc ? 1 : -1);
      });
    }
    if (this.rangeFromTo) rows = rows.slice(this.rangeFromTo.from, this.rangeFromTo.to + 1);
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  /** Builds a conflict-key string from a row given an `onConflict` column list. */
  private conflictKey(row: Row, cols: string[]): string {
    return cols.map((c) => String(row[c] ?? '')).join(' ');
  }

  private run(): { data: unknown; error: unknown; count?: number | null } {
    const store = this.db.tables;

    if (this.op === 'insert') {
      const failure = this.db.consumeInsertFailure(this.table);
      if (failure) return { data: null, error: failure };
      const arr = this.db.ensure(this.table);
      const items = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const inserted = items.map((it) => {
        const row: Row = { id: it.id ?? nextId(`${this.table}`), ...it };
        arr.push(row);
        return row;
      });
      return { data: this.returnRows ? inserted : null, error: null };
    }

    if (this.op === 'upsert') {
      const arr = this.db.ensure(this.table);
      const items = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const cols = (this.upsertOpts.onConflict ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const result: Row[] = [];
      for (const it of items) {
        if (cols.length) {
          const key = this.conflictKey(it, cols);
          const existing = arr.find((r) => this.conflictKey(r, cols) === key);
          if (existing) {
            if (this.upsertOpts.ignoreDuplicates) {
              // Skip silently — mirrors `ignoreDuplicates: true` (DO NOTHING).
              continue;
            }
            Object.assign(existing, it);
            result.push(existing);
            continue;
          }
        }
        const row: Row = { id: it.id ?? nextId(`${this.table}`), ...it };
        arr.push(row);
        result.push(row);
      }
      return { data: this.returnRows ? result : null, error: null };
    }

    if (this.op === 'update') {
      const matched = (store[this.table] ?? []).filter((r) => this.match(r));
      for (const r of matched) Object.assign(r, this.payload);
      return { data: this.returnRows ? matched : null, error: null };
    }

    if (this.op === 'delete') {
      const before = store[this.table] ?? [];
      const keep = before.filter((r) => !this.match(r));
      const removed = before.length - keep.length;
      store[this.table] = keep;
      return { data: null, error: null, count: removed };
    }

    // select
    const rows = this.applied();
    if (this.countMode) {
      const count = (store[this.table] ?? []).filter((r) => this.match(r)).length;
      return { data: this.countMode.head ? null : rows, error: null, count };
    }
    return { data: rows, error: null };
  }

  async single(): Promise<{ data: unknown; error: unknown }> {
    const res = this.run();
    const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
    return { data, error: res.error };
  }
  async maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    const res = this.run();
    const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
    return { data, error: res.error };
  }

  then<TResult1 = { data: unknown; error: unknown; count?: number | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown; count?: number | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
