import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Minimal in-memory Supabase fake for unit-testing compliance service logic.
 * Supports the chain shapes the services use: select/insert/update/delete,
 * eq/in filters, order/limit, and the maybeSingle/single/await terminals.
 *
 * NOT a general Supabase emulator — only the operations exercised by tests.
 */

type Row = Record<string, unknown>;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

export interface FakeSupabaseOptions {
  /** Inject a one-off error for the next insert into `table`. */
  failNextInsert?: Record<string, { code?: string; message: string }>;
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  private failNextInsert: Record<string, { code?: string; message: string }>;

  constructor(seed: Record<string, Row[]> = {}, options: FakeSupabaseOptions = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
    this.failNextInsert = { ...(options.failNextInsert ?? {}) };
  }

  private ensure(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  consumeInsertFailure(table: string): { code?: string; message: string } | null {
    const f = this.failNextInsert[table];
    if (f) {
      delete this.failNextInsert[table];
      return f;
    }
    return null;
  }

  asClient(): SupabaseClient {
    return { from: (table: string) => new FakeQuery(this, table) } as unknown as SupabaseClient;
  }
}

type Filter = {
  col: string;
  op: 'eq' | 'ilike' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'is' | 'notnull';
  val: unknown;
};

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private returnRows = false;

  constructor(private db: FakeSupabase, private table: string) {}

  select(_cols?: string): this {
    if (this.op === 'select') this.op = 'select';
    this.returnRows = true;
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.op = 'insert';
    this.payload = payload;
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
  is(col: string, val: unknown): this {
    this.filters.push({ col, op: 'is', val });
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    // Only `not(col, 'is', null)` (IS NOT NULL) is used by compliance code.
    if (op === 'is' && val === null) this.filters.push({ col, op: 'notnull', val: null });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col, asc: opts?.ascending ?? true };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private match(row: Row): boolean {
    return this.filters.every((f) => {
      const cell = row[f.col];
      switch (f.op) {
        case 'eq':
          return cell === f.val;
        case 'ilike':
          return (
            typeof cell === 'string' &&
            typeof f.val === 'string' &&
            cell.toLowerCase() === (f.val as string).replace(/%/g, '').toLowerCase()
          );
        case 'in':
          return Array.isArray(f.val) && f.val.includes(cell);
        case 'gt':
          return (cell as number | string) > (f.val as number | string);
        case 'gte':
          return (cell as number | string) >= (f.val as number | string);
        case 'lt':
          return (cell as number | string) < (f.val as number | string);
        case 'lte':
          return (cell as number | string) <= (f.val as number | string);
        case 'is':
          return f.val === null ? cell === null || cell === undefined : cell === f.val;
        case 'notnull':
          return cell !== null && cell !== undefined;
        default:
          return false;
      }
    });
  }

  private applied(): Row[] {
    let rows = this.db.tables[this.table] ?? [];
    rows = rows.filter((r) => this.match(r));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[col] as number | string;
        const bv = b[col] as number | string;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  private run(): { data: unknown; error: unknown } {
    const store = this.db.tables;
    if (this.op === 'insert') {
      const failure = this.db.consumeInsertFailure(this.table);
      if (failure) return { data: null, error: failure };
      const arr = (store[this.table] = store[this.table] ?? []);
      const items = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const inserted = items.map((it) => {
        const row: Row = { id: nextId(), ...it };
        arr.push(row);
        return row;
      });
      return { data: this.returnRows ? inserted : null, error: null };
    }
    if (this.op === 'update') {
      const matched = (store[this.table] ?? []).filter((r) => this.match(r));
      for (const r of matched) Object.assign(r, this.payload);
      return { data: this.returnRows ? matched : null, error: null };
    }
    if (this.op === 'delete') {
      const keep = (store[this.table] ?? []).filter((r) => !this.match(r));
      const removed = (store[this.table] ?? []).length - keep.length;
      store[this.table] = keep;
      return { data: null, error: null, ...({ count: removed } as object) };
    }
    return { data: this.applied(), error: null };
  }

  async maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    const res = this.run();
    const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
    return { data, error: res.error };
  }
  async single(): Promise<{ data: unknown; error: unknown }> {
    const res = this.run();
    const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
    return { data, error: res.error };
  }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
