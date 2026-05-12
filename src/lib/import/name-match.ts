import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Escapes Postgres `LIKE`/`ILIKE` wildcards in a literal value so that user-
 * supplied names containing `%` or `_` do not match unintended rows.
 */
export function escapeIlikeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export interface NamedMatchOptions {
  table: 'unified_calendars' | 'service_items';
  venueId: string;
  name: string;
  isActiveOnly?: boolean;
}

export interface NamedMatchResult {
  id: string | null;
  ambiguous: boolean;
}

/**
 * Resolves a venue-scoped active row by name with three strategies in order:
 *   1. exact case-insensitive match (`ilike '<name>'`)
 *   2. escaped `%name%` contains match
 *   3. ambiguity flagging when more than one row matches
 *
 * Returns `{ id: null, ambiguous: false }` when nothing matched, or
 * `{ id, ambiguous: true }` when multiple rows matched at the contains step
 * so the caller can audit the choice.
 */
export async function resolveNamedRowId(
  admin: SupabaseClient,
  options: NamedMatchOptions,
): Promise<NamedMatchResult> {
  const trimmed = options.name.trim();
  if (!trimmed) return { id: null, ambiguous: false };
  const literal = escapeIlikeLiteral(trimmed);

  let exact = admin
    .from(options.table)
    .select('id')
    .eq('venue_id', options.venueId)
    .ilike('name', literal)
    .order('id', { ascending: true })
    .limit(2);
  if (options.isActiveOnly) exact = exact.eq('is_active', true);
  const exactRes = await exact;
  const exactRows = (exactRes.data ?? []) as Array<{ id: string }>;
  if (exactRows.length > 0) {
    return { id: exactRows[0]!.id, ambiguous: exactRows.length > 1 };
  }

  let contains = admin
    .from(options.table)
    .select('id')
    .eq('venue_id', options.venueId)
    .ilike('name', `%${literal}%`)
    .order('id', { ascending: true })
    .limit(2);
  if (options.isActiveOnly) contains = contains.eq('is_active', true);
  const containsRes = await contains;
  const containsRows = (containsRes.data ?? []) as Array<{ id: string }>;
  if (containsRows.length > 0) {
    return { id: containsRows[0]!.id, ambiguous: containsRows.length > 1 };
  }

  return { id: null, ambiguous: false };
}
