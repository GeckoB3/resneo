/**
 * value_map transform (H6).
 *
 * Some columns hold provider-specific enum CODES (booking statuses like CXL / NS /
 * DNA, deposit states) that keyword guessing maps unreliably. Instead the AI
 * proposes an explicit raw->canonical lookup per provider, the user reviews/edits
 * it on the Review step, and the importer applies it deterministically before the
 * normaliser runs. Because the normalisers are idempotent on canonical values, a
 * value_map output (e.g. "Cancelled") passes through downstream mapping unchanged;
 * any raw value the table doesn't cover falls back to the existing normaliser.
 */

/** Target fields that support a reviewed value map, with their canonical vocabulary. */
export const VALUE_MAP_TARGETS: Record<string, { label: string; canonical: readonly string[] }> = {
  status: {
    label: 'Booking status',
    canonical: ['Booked', 'Pending', 'Confirmed', 'Cancelled', 'No-Show', 'Completed', 'Seated'],
  },
  deposit_status: {
    label: 'Deposit status',
    canonical: ['Not Required', 'Pending', 'Paid', 'Refunded', 'Forfeited', 'Waived'],
  },
};

export function isValueMapTarget(field: string | null | undefined): boolean {
  return Boolean(field && Object.prototype.hasOwnProperty.call(VALUE_MAP_TARGETS, field));
}

export function canonicalValuesForTarget(field: string | null | undefined): readonly string[] {
  return field ? (VALUE_MAP_TARGETS[field]?.canonical ?? []) : [];
}

/** True when `value` is one of the canonical values allowed for `field`. */
export function isCanonicalValueFor(field: string | null | undefined, value: string): boolean {
  return canonicalValuesForTarget(field).some((c) => c === value);
}

/**
 * Translate a raw cell via a stored value map. Tries an exact key, then a
 * case-insensitive match (value maps are tiny — a handful of enum values — so the
 * linear scan is cheap even per row). Returns the raw value unchanged when there's
 * no map or no match, so unmapped values fall through to the normaliser.
 */
export function applyValueMap(
  raw: string,
  valueMap: Record<string, string> | null | undefined,
): string {
  if (!valueMap) return raw;
  const t = raw.trim();
  if (!t) return raw;
  if (valueMap[t] != null) return valueMap[t];
  const lower = t.toLowerCase();
  for (const [k, v] of Object.entries(valueMap)) {
    if (k.trim().toLowerCase() === lower) return v;
  }
  return raw;
}

/**
 * Sanitises an AI- or user-supplied value map for a target: drops blank keys,
 * keeps only entries whose canonical value is valid for the field, and de-dupes
 * keys case-insensitively (last wins). Returns null when nothing valid remains.
 */
export function sanitiseValueMap(
  field: string | null | undefined,
  entries: Array<{ from: string; to: string }> | null | undefined,
): Record<string, string> | null {
  if (!field || !entries?.length || !isValueMapTarget(field)) return null;
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const e of entries) {
    const from = e?.from?.trim();
    const to = e?.to?.trim();
    if (!from || !to || !isCanonicalValueFor(field, to)) continue;
    const key = from.toLowerCase();
    if (seen.has(key)) {
      // last wins: remove the earlier-cased duplicate
      for (const k of Object.keys(out)) {
        if (k.toLowerCase() === key) delete out[k];
      }
    }
    seen.add(key);
    out[from] = to;
  }
  return Object.keys(out).length ? out : null;
}
