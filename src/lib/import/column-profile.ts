/**
 * Deterministic column profiling for import files.
 *
 * Computed over the whole file (capped) at upload time and stored on the
 * import_files row. Powers:
 *  - AI column mapping (far stronger signal than 5 sample rows),
 *  - automatic DD/MM vs MM/DD inference (any value with a component > 12 is
 *    unambiguous evidence), removing the "ambiguous date" prompt in most cases.
 */

export interface ColumnTypeCounts {
  date: number;
  time: number;
  datetime: number;
  email: number;
  phone: number;
  number: number;
  boolean: number;
  text: number;
}

export interface ColumnProfile {
  column: string;
  /** Fraction of non-empty cells, 0..1 (2dp). */
  fill_rate: number;
  /** Distinct non-empty values, capped at 1000 ("1000+" semantics). */
  distinct_count: number;
  /** Up to 5 most frequent non-empty values, truncated to 40 chars. */
  top_values: string[];
  type_counts: ColumnTypeCounts;
  /**
   * For slash/dash/dot-separated numeric dates (x/y/zzzz): how many values had
   * first component > 12 (proves day-first) vs second component > 12 (proves
   * month-first). Null when the column has no such values.
   */
  date_evidence: { first_gt_12: number; second_gt_12: number } | null;
  max_len: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A bare clock time, e.g. "9:30", "09:30:00", "2:30 PM". Shared with the irregularity detector. */
export const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?(\s?[AaPp][Mm])?$/;
/** A numeric date "d/m/yyyy" (slash, dot, or dash separated). */
export const NUMERIC_DATE_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;
/** An ISO date "yyyy-MM-dd". */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A "d-MMM-yy" / "d-MMM-yyyy" dash-month date, e.g. "12-May-26". */
export const DASH_MONTH_DATE_RE = /^\d{1,2}-[A-Za-z]{3,}-\d{2,4}$/;
/** A combined date+time value, e.g. "2026-03-14 14:30" or "14/03/2026 2:30 PM". */
export const DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[T ]\d{1,2}:\d{2}(:\d{2})?(\s?[AaPp][Mm])?$/;
const PHONE_RE = /^[+()0-9][0-9()\s./-]{6,19}$/;
const NUMBER_RE = /^-?[£$€]?\s?\d{1,3}([,. ]\d{3})*([.,]\d+)?%?$/;
const BOOLEAN_VALUES = new Set([
  'yes', 'no', 'true', 'false', 'y', 'n', '1', '0', 'on', 'off', 'opted in', 'opted out',
]);

function classifyValue(v: string): keyof ColumnTypeCounts {
  const t = v.trim();
  if (DATETIME_RE.test(t)) return 'datetime';
  if (ISO_DATE_RE.test(t) || NUMERIC_DATE_RE.test(t)) return 'date';
  if (TIME_RE.test(t)) return 'time';
  if (EMAIL_RE.test(t)) return 'email';
  if (BOOLEAN_VALUES.has(t.toLowerCase())) return 'boolean';
  if (NUMBER_RE.test(t)) return 'number';
  if (PHONE_RE.test(t) && /\d{7,}/.test(t.replace(/[^\d]/g, ''))) return 'phone';
  return 'text';
}

/** Extract day-first/month-first evidence from a numeric date or datetime string. */
function dateComponentEvidence(v: string): 'first' | 'second' | 'neither' | null {
  const t = v.trim();
  const m = t.match(NUMERIC_DATE_RE) ?? t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})[T ]/);
  if (!m) return null;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a > 12 && b <= 12) return 'first';
  if (b > 12 && a <= 12) return 'second';
  return 'neither';
}

export const PROFILE_MAX_ROWS = 5000;
const DISTINCT_CAP = 1000;

export function profileColumns(
  headers: string[],
  rows: Array<Record<string, string>>,
  opts?: { maxRows?: number },
): ColumnProfile[] {
  const maxRows = opts?.maxRows ?? PROFILE_MAX_ROWS;
  const sampled = rows.length > maxRows ? rows.slice(0, maxRows) : rows;
  const total = sampled.length;

  return headers.filter(Boolean).map((column) => {
    const counts: ColumnTypeCounts = {
      date: 0, time: 0, datetime: 0, email: 0, phone: 0, number: 0, boolean: 0, text: 0,
    };
    const freq = new Map<string, number>();
    let filled = 0;
    let maxLen = 0;
    let firstGt12 = 0;
    let secondGt12 = 0;
    let sawNumericDate = false;

    for (const row of sampled) {
      const raw = row[column];
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!v) continue;
      filled += 1;
      if (v.length > maxLen) maxLen = v.length;
      const kind = classifyValue(v);
      counts[kind] += 1;
      if (kind === 'date' || kind === 'datetime') {
        const ev = dateComponentEvidence(v);
        if (ev !== null) {
          sawNumericDate = true;
          if (ev === 'first') firstGt12 += 1;
          else if (ev === 'second') secondGt12 += 1;
        }
      }
      if (freq.size < DISTINCT_CAP || freq.has(v)) {
        freq.set(v, (freq.get(v) ?? 0) + 1);
      }
    }

    const top = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([v]) => (v.length > 40 ? `${v.slice(0, 40)}…` : v));

    return {
      column,
      fill_rate: total > 0 ? Math.round((filled / total) * 100) / 100 : 0,
      distinct_count: freq.size,
      top_values: top,
      type_counts: counts,
      date_evidence: sawNumericDate ? { first_gt_12: firstGt12, second_gt_12: secondGt12 } : null,
      max_len: maxLen,
    };
  });
}

/**
 * Infer the day/month order for ambiguous numeric dates across a whole file.
 * Returns a format only when the evidence is one-sided (some values prove one
 * order and none prove the other); mixed or absent evidence returns null and
 * the user is asked, as before.
 */
export function inferDateFormatFromProfiles(
  profiles: ColumnProfile[],
): 'dd/MM/yyyy' | 'MM/dd/yyyy' | null {
  let first = 0;
  let second = 0;
  for (const p of profiles) {
    if (!p.date_evidence) continue;
    first += p.date_evidence.first_gt_12;
    second += p.date_evidence.second_gt_12;
  }
  if (first > 0 && second === 0) return 'dd/MM/yyyy';
  if (second > 0 && first === 0) return 'MM/dd/yyyy';
  return null;
}
