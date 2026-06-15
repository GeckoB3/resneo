/**
 * Auto-split combined name columns at mapping time.
 *
 * ResNeo stores names as separate first + surname columns. When a column maps
 * to a combined name field (`full_name` / `guest_full_name`), turn that mapping
 * into a `split` into the two name parts up front, so the Map step shows the
 * column already split into First name + Surname for the user to confirm —
 * rather than asking them to click "split into multiple fields" themselves.
 *
 * The split is skipped when a dedicated first- or last-name column is already
 * mapped (a field can only have one source column), leaving the combined column
 * as-is.
 */

/** Combined-name field → the [first, last] fields it splits into. */
const COMBINED_NAME_SPLITS: Record<string, [string, string]> = {
  full_name: ['first_name', 'last_name'],
  guest_full_name: ['guest_first_name', 'guest_last_name'],
};

export type NameSplittableRow = {
  target_field: string | null;
  action: string;
  split_config?: { separator?: string; parts?: Array<{ field: string }> } | null;
};

/**
 * Returns a copy of `rows` with any combined-name `map` converted to a `split`
 * into first/last parts (unless those parts are already provided by another
 * column). Other fields on each row are preserved.
 */
export function autoSplitCombinedNames<T extends NameSplittableRow>(rows: T[]): T[] {
  // Every field already produced by the current mappings (map targets + split parts).
  const claimed = new Set<string>();
  for (const r of rows) {
    if (r.action === 'map' && r.target_field) claimed.add(r.target_field);
    if (r.action === 'split' && r.split_config?.parts) {
      for (const p of r.split_config.parts) if (p.field) claimed.add(p.field);
    }
  }

  return rows.map((r) => {
    if (r.action !== 'map' || !r.target_field) return r;
    const parts = COMBINED_NAME_SPLITS[r.target_field];
    if (!parts) return r;
    const [first, last] = parts;
    // A dedicated first/last column already covers it — leave the combined map.
    if (claimed.has(first) || claimed.has(last)) return r;
    return {
      ...r,
      action: 'split',
      target_field: null,
      split_config: { separator: ' ', parts: [{ field: first }, { field: last }] },
    };
  });
}
