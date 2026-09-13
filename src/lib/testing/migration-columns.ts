/**
 * Projection guard: check the columns a query names against the columns the
 * migrations leave its table with.
 *
 * The Supabase doubles hand back whatever a test seeds and never read the SELECT,
 * so a query naming a dropped column passes its tests and fails live with 42703.
 * That is how `guests.name` outlived 20260810120000_guest_first_last_names.sql, in
 * the compliance dashboard and again in the venue CSV export.
 *
 * Migrations are read as text in filename order: the CREATE TABLE body, then each
 * ALTER TABLE's ADD, DROP and RENAME COLUMN. Conditions around a statement (a DO
 * block, IF EXISTS) are ignored, so a guarded drop counts as a drop. Tables only: a
 * view has no CREATE TABLE, so every column read from one reports as missing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecordedCall } from './recording-supabase';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/** CREATE TABLE body lines that open with a keyword rather than a column name. */
const TABLE_CONSTRAINT_WORDS = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude']);

/** Recorded modifiers whose first argument is a column, e.g. ['order', 'last_name', {...}]. */
const COLUMN_MODIFIERS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'overlaps', 'not', 'filter', 'order',
]);

const columnsByTable = new Map<string, Set<string>>();

export function tableColumnsFromMigrations(table: string): Set<string> {
  const cached = columnsByTable.get(table);
  if (cached) return cached;

  const createTable = new RegExp(
    String.raw`CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?${table}\s*\(([\s\S]*?)\n\);`,
    'i',
  );
  const alterTable = new RegExp(
    String.raw`ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?${table}\s([\s\S]*?);`,
    'gi',
  );
  const columns = new Set<string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const created = sql.match(createTable);
    if (created) {
      for (const line of created[1]!.split('\n')) {
        const column = line.trim().match(/^([a-z_][a-z0-9_]*)\s/i)?.[1]?.toLowerCase();
        if (column && !TABLE_CONSTRAINT_WORDS.has(column)) columns.add(column);
      }
    }
    for (const statement of sql.matchAll(alterTable)) {
      // One pattern for all three, so a statement's clauses apply in the order written.
      const clauses = statement[1]!.matchAll(
        /\b(ADD|DROP|RENAME)\s+COLUMN\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([a-z_][a-z0-9_]*)(?:\s+TO\s+([a-z_][a-z0-9_]*))?/gi,
      );
      for (const [, action, column, renamedTo] of clauses) {
        const verb = action!.toUpperCase();
        if (verb === 'ADD') columns.add(column!.toLowerCase());
        else columns.delete(column!.toLowerCase());
        if (verb === 'RENAME' && renamedTo) columns.add(renamedTo.toLowerCase());
      }
    }
  }
  columnsByTable.set(table, columns);
  return columns;
}

/**
 * Every column a PostgREST select names, paired with the table it is read from. An
 * embed reads from its own table: on bookings, `id, guests!inner ( first_name )`
 * names bookings.id and guests.first_name. Embeds must be named by table (optionally
 * as `alias:table!hint`), which is how this codebase writes them.
 */
function selectedColumns(table: string, select: string): Array<[table: string, column: string]> {
  const named: Array<[string, string]> = [];
  const take = (item: string) => {
    const text = item.trim();
    if (!text || text === '*') return;
    const open = text.indexOf('(');
    if (open === -1) {
      // `alias:column`, `column::text` and `column->>key` all read `column`.
      named.push([table, text.replace(/::\w+$/, '').split(':').pop()!.split('->')[0]!.trim()]);
      return;
    }
    const embedded = text.slice(0, open).split(':').pop()!.split('!')[0]!.trim();
    named.push(...selectedColumns(embedded, text.slice(open + 1, text.lastIndexOf(')'))));
  };

  let depth = 0;
  let item = '';
  for (const ch of select) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      take(item);
      item = '';
    } else {
      item += ch;
    }
  }
  take(item);
  return named;
}

/**
 * `table.column` for every column the recorded calls name, in a select projection or
 * a column modifier such as eq or order, that the migrations do not give that table.
 * A modifier on an embedded column (`.eq('guests.email', x)`) is checked against the
 * embedded table.
 */
export function columnsMissingFromMigrations(calls: RecordedCall[]): string[] {
  const missing = new Set<string>();
  const check = (table: string, column: string) => {
    if (!tableColumnsFromMigrations(table).has(column.toLowerCase())) missing.add(`${table}.${column}`);
  };
  for (const call of calls) {
    if (call.op === 'rpc') continue;
    if (call.op === 'select' && call.columns) {
      for (const [table, column] of selectedColumns(call.table, call.columns)) check(table, column);
    }
    for (const [modifier, column] of call.filters) {
      if (!COLUMN_MODIFIERS.has(modifier) || typeof column !== 'string') continue;
      const dot = column.lastIndexOf('.');
      if (dot === -1) check(call.table, column);
      else check(column.slice(0, dot), column.slice(dot + 1));
    }
  }
  return [...missing];
}
