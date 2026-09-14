import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The collective column registry (supabase/migrations/20270211120000_collective_column_classes.sql):
 * which columns of the tables a collective copies may travel from one business to another.
 */
export type ColumnClass = 'host' | 'identity' | 'venue' | 'not_copied' | 'derived';

export type RegistryTable =
  | 'service_items'
  | 'service_variants'
  | 'addon_groups'
  | 'addons'
  | 'service_addon_groups'
  | 'service_categories'
  | 'compliance_types'
  | 'compliance_type_versions'
  | 'service_compliance_requirements';

export type ColumnRegistry = ReadonlyMap<string, ReadonlyMap<string, ColumnClass>>;

/** What a plain copy takes from the origin: host columns, venue columns (seeded) and derived ones. */
const COPIED_CLASSES: ReadonlySet<ColumnClass> = new Set(['host', 'venue', 'derived']);

const TTL_MS = 5 * 60_000;
let cache: { registry: ColumnRegistry; expires: number } | null = null;

/**
 * The registry, cached per server instance for a few minutes: it changes only with a migration.
 * Throws when it cannot be read, so a copy fails rather than falling back to copying everything.
 */
export async function loadColumnRegistry(admin: SupabaseClient): Promise<ColumnRegistry> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.registry;
  const { data, error } = await admin.from('collective_column_classes').select('table_name, column_name, class');
  if (error) throw new Error(`collective column registry unavailable: ${error.message}`);
  const registry = new Map<string, Map<string, ColumnClass>>();
  for (const row of (data ?? []) as Array<{ table_name: string; column_name: string; class: ColumnClass }>) {
    const table = registry.get(row.table_name) ?? new Map<string, ColumnClass>();
    table.set(row.column_name, row.class);
    registry.set(row.table_name, table);
  }
  if (registry.size === 0) throw new Error('collective column registry is empty');
  cache = { registry, expires: now + TTL_MS };
  return registry;
}

/** Test seam: forget the cached registry. */
export function resetColumnRegistryCache(): void {
  cache = null;
}

const warned = new Set<string>();

/**
 * The columns of `row` a copy may take, per the registry, minus any the caller recomputes
 * itself. A column the registry does not know is left behind and logged once: deciding that
 * it may travel between businesses is a migration, not a default.
 */
export function copyableColumns(
  registry: ColumnRegistry,
  table: RegistryTable,
  row: Record<string, unknown>,
  recomputed: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const classes = registry.get(table);
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (recomputed.has(column)) continue;
    const cls = classes?.get(column);
    if (!cls) {
      const key = `${table}.${column}`;
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`[column-registry] ${key} is not classified, so it is not copied between venues`);
      }
      continue;
    }
    if (COPIED_CLASSES.has(cls)) out[column] = value;
  }
  return out;
}
