/**
 * A PostgREST-shaped fake for tests that need to drive a real fetcher rather than mock it out.
 *
 * The house pattern is `vi.fn().mockReturnThis()` chains with a terminal resolver. That is fine
 * for asserting "the route called the engine", but it cannot model *which* rows a filter would
 * return, so it is useless for the scheduling parity harness, where the whole point is that
 * `.is('service_id', null)` and a `date_start`/`date_end` window decide the answer.
 *
 * This fake holds rows per table and actually applies the filters. Only the operators the
 * availability fetchers use are supported: eq, neq, in, is, gte, lte, gt, lt, order, limit,
 * `not(col, 'is', null)`, and `or()` restricted to comma-separated `col.eq.value` disjunctions.
 * Anything else throws rather than silently returning everything, because a filter that is
 * quietly ignored is exactly the failure this exists to prevent.
 *
 * `select()` does not project columns; rows are returned whole. Tests that care about the
 * projection should assert on `calls` instead.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md Stage 0a.
 */

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;
export interface FakeError {
  message: string;
  code?: string;
}
export interface FakeResult {
  data: FakeRow[] | null;
  error: FakeError | null;
}
export interface FakeSingleResult {
  data: FakeRow | null;
  error: FakeError | null;
}

export interface FakeQueryCall {
  table: string;
  select: string | null;
  filters: string[];
}

export interface SupabaseFakeOptions {
  /** Rows per table name. A table with no entry resolves to an empty array, not an error. */
  tables?: FakeTables;
  /**
   * Tables that should resolve `{ data: null, error }`, for exercising the fail-open and
   * fail-closed read paths (the four visibility tiers in the resolver plan's §1.2 item 11).
   */
  errors?: Record<string, FakeError>;
}

export interface SupabaseFake {
  /** Typed for direct use in tests. Pass it to production fetchers via {@link asSupabaseClient}. */
  client: { from(table: string): FakeQuery };
  /**
   * The same object, cast to whatever the fetcher's parameter type is. Keeps the unavoidable
   * structural cast in one documented place instead of at every call site.
   */
  asSupabaseClient<T>(): T;
  /** Every query issued, in order, for asserting which tables and filters a path touched. */
  calls: FakeQueryCall[];
  /** Replace a table's rows between assertions without rebuilding the fake. */
  setRows: (table: string, rows: FakeRow[]) => void;
}

type Predicate = (row: FakeRow) => boolean;

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // PostgREST compares as text over the wire, so 5 and '5' match. Mirror that rather than
  // making fixtures depend on whether a column happens to be numeric.
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export class FakeQuery implements PromiseLike<FakeResult> {
  private predicates: Predicate[] = [];
  private orderBy: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private selectCols: string | null = null;
  private readonly filterLog: string[] = [];

  constructor(
    private readonly table: string,
    private readonly rows: FakeRow[],
    private readonly error: FakeError | undefined,
    private readonly record: (call: FakeQueryCall) => void,
  ) {}

  select(cols?: string): this {
    this.selectCols = cols ?? '*';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filterLog.push(`eq(${column})`);
    this.predicates.push((r) => valuesEqual(r[column], value));
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filterLog.push(`neq(${column})`);
    this.predicates.push((r) => !valuesEqual(r[column], value));
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.filterLog.push(`in(${column})`);
    this.predicates.push((r) => values.some((v) => valuesEqual(r[column], v)));
    return this;
  }

  is(column: string, value: null | boolean): this {
    this.filterLog.push(`is(${column},${String(value)})`);
    if (value === null) {
      this.predicates.push((r) => r[column] == null);
    } else {
      this.predicates.push((r) => r[column] === value);
    }
    return this;
  }

  not(column: string, operator: string, value: null): this {
    if (operator !== 'is' || value !== null) {
      throw new Error(`supabase-fake: not(${column}, '${operator}', ...) is not supported; only not(col, 'is', null)`);
    }
    this.filterLog.push(`not(${column},is,null)`);
    this.predicates.push((r) => r[column] != null);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filterLog.push(`gte(${column})`);
    this.predicates.push((r) => compare(r[column], value) >= 0);
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filterLog.push(`lte(${column})`);
    this.predicates.push((r) => compare(r[column], value) <= 0);
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filterLog.push(`gt(${column})`);
    this.predicates.push((r) => compare(r[column], value) > 0);
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filterLog.push(`lt(${column})`);
    this.predicates.push((r) => compare(r[column], value) < 0);
    return this;
  }

  /** Only `col.eq.value` disjunctions, which is all the availability fetchers use. */
  or(expression: string): this {
    this.filterLog.push(`or(${expression})`);
    const clauses = expression.split(',').map((c) => c.trim()).filter(Boolean);
    const parsed = clauses.map((clause) => {
      const [column, operator, ...rest] = clause.split('.');
      if (!column || operator !== 'eq') {
        throw new Error(`supabase-fake: or() supports only 'col.eq.value' clauses, got '${clause}'`);
      }
      return { column, value: rest.join('.') };
    });
    this.predicates.push((r) => parsed.some((p) => valuesEqual(r[p.column], p.value)));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: opts?.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  private resolveRows(): FakeRow[] {
    let out = this.rows.filter((row) => this.predicates.every((p) => p(row)));
    for (const { column, ascending } of [...this.orderBy].reverse()) {
      out = [...out].sort((a, b) => (ascending ? compare(a[column], b[column]) : compare(b[column], a[column])));
    }
    if (this.limitCount != null) out = out.slice(0, this.limitCount);
    return out;
  }

  private finish(): FakeResult {
    this.record({ table: this.table, select: this.selectCols, filters: [...this.filterLog] });
    if (this.error) return { data: null, error: this.error };
    return { data: this.resolveRows(), error: null };
  }

  async maybeSingle(): Promise<FakeSingleResult> {
    const res = this.finish();
    if (res.error) return { data: null, error: res.error };
    return { data: res.data?.[0] ?? null, error: null };
  }

  async single(): Promise<FakeSingleResult> {
    const res = this.finish();
    if (res.error) return { data: null, error: res.error };
    const rows = res.data ?? [];
    if (rows.length !== 1) {
      // Mirrors PostgREST: single() is an error unless exactly one row matched.
      return { data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${rows.length}` } };
    }
    return { data: rows[0]!, error: null };
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.finish()).then(onfulfilled, onrejected);
  }
}

export function createSupabaseFake(options: SupabaseFakeOptions = {}): SupabaseFake {
  const tables: FakeTables = { ...(options.tables ?? {}) };
  const errors = options.errors ?? {};
  const calls: FakeQueryCall[] = [];

  const client = {
    from(table: string) {
      return new FakeQuery(table, tables[table] ?? [], errors[table], (call) => calls.push(call));
    },
  };

  return {
    client,
    asSupabaseClient<T>(): T {
      return client as T;
    },
    calls,
    setRows(table: string, rows: FakeRow[]) {
      tables[table] = rows;
    },
  };
}
