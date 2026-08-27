/**
 * IANA timezone validation, shared by the customer profile and the venue
 * settings form (P0-2, closes G23).
 *
 * The problem this closes: `timezone` was free text on both sides, validated
 * only for length. A customer could save `GMT+1`, `EST`, or a typo, and every
 * subsequent `toLocaleDateString({ timeZone })` call with that value throws a
 * RangeError, which in a server component means the page fails to render. The
 * customer then cannot reach the profile screen to correct the value that
 * broke it.
 *
 * Two halves, deliberately different:
 *
 *  - WRITES are constrained to `Intl.supportedValuesOf('timeZone')`. That is
 *    the canonical set the runtime will actually accept, so anything that
 *    passes here is guaranteed to format.
 *  - READS degrade. Values already stored predate this validation and may be
 *    legacy aliases (`Europe/Kiev`, `US/Eastern`) that are absent from the
 *    canonical list but that Intl still accepts, so `resolveDisplayTimeZone`
 *    probes rather than looking up, and falls back rather than throwing. A
 *    stored value must never be able to take a page down.
 */

/**
 * The canonical zones this runtime supports, sorted. Computed once: the list is
 * ~420 entries and is rebuilt on every call otherwise.
 *
 * `supportedValuesOf` is ES2022 and present in every runtime this app targets,
 * but it is guarded anyway: if it were ever missing, an empty list would make
 * `isValidIanaTimeZone` reject everything, and a customer could no longer save
 * a timezone at all. Falling back to probing keeps writes working.
 */
let cachedZones: string[] | null = null;

/**
 * `UTC` is added explicitly. It is a zone every runtime formats in and a
 * perfectly reasonable thing for a venue to be on, but Node's
 * `supportedValuesOf('timeZone')` returns 418 region names and NOT `UTC`,
 * `Etc/UTC` or any `Etc/*` alias. Without this line a venue that wanted UTC
 * could not save it, which is a worse failure than the free text this
 * validation replaces.
 */
const EXTRA_ZONES = ['UTC'];

export function supportedTimeZones(): string[] {
  if (cachedZones) return cachedZones;
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    cachedZones =
      Array.isArray(supported) && supported.length > 0
        ? [...new Set([...supported, ...EXTRA_ZONES])].sort()
        : [];
  } catch {
    cachedZones = [];
  }
  return cachedZones;
}

/**
 * Probe results, cached. `resolveDisplayTimeZone` runs on every booking row on
 * every render, and the only way to ask this question is to construct an
 * `Intl.DateTimeFormat` and see whether it throws, which is expensive twice
 * over when it does. The answer for a given string never changes within a
 * process.
 */
const probeCache = new Map<string, boolean>();

/** True if `timeZone` is a zone this runtime can actually format in. */
export function canFormatInTimeZone(timeZone: string): boolean {
  const cached = probeCache.get(timeZone);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    ok = true;
  } catch {
    ok = false;
  }
  probeCache.set(timeZone, ok);
  return ok;
}

/**
 * Validation for WRITES. Trims, then requires membership of the canonical set.
 *
 * Deliberately stricter than `canFormatInTimeZone`: Intl accepts `UTC`, `GMT`
 * and a long tail of legacy aliases, and letting new rows in with those spreads
 * names that will not appear in any picker. When the canonical list is
 * unavailable, falls back to probing rather than rejecting everything.
 */
export function isValidIanaTimeZone(timeZone: string | null | undefined): boolean {
  const value = timeZone?.trim();
  if (!value) return false;
  const zones = supportedTimeZones();
  if (zones.length === 0) return canFormatInTimeZone(value);
  return zones.includes(value);
}

/**
 * The zone to FORMAT in, given a stored value that may be anything.
 *
 * Order: the stored value if the runtime can format in it, then the fallback,
 * then `Europe/London`. Never throws, so a bad stored value costs a customer
 * the right timezone and nothing else.
 */
export function resolveDisplayTimeZone(
  stored: string | null | undefined,
  fallback?: string | null,
): string {
  const value = stored?.trim();
  if (value && canFormatInTimeZone(value)) return value;
  const fb = fallback?.trim();
  if (fb && canFormatInTimeZone(fb)) return fb;
  return 'Europe/London';
}
