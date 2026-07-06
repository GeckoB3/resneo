import { format, parse, isValid } from 'date-fns';
import { normalizeToE164, normalizeToE164Lenient, type CountryCode } from '@/lib/phone/e164';

const DATE_FORMATS_TRY = [
  'dd/MM/yyyy',
  'd/M/yyyy',
  'MM/dd/yyyy',
  'M/d/yyyy',
  'yyyy-MM-dd',
  'dd-MM-yyyy',
  'd MMMM yyyy',
  'MMMM d, yyyy',
  // Salon/report exports often use a dash-month-name date, e.g. "12-May-26".
  'd-MMM-yy',
  'd-MMM-yyyy',
  'dd-MMM-yy',
  'dd-MMM-yyyy',
] as const;

export function normaliseEmail(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return t.toLowerCase();
}

export interface NormalisedPhone {
  e164: string | null;
  warning: boolean;
}

/**
 * Normalise a raw imported phone value to E.164.
 *
 * `defaultCountry` is the venue's likely calling region (see
 * `defaultPhoneCountryFromCurrency`); it only matters for national-format
 * numbers that carry no country code. International numbers (with + or a
 * country code) parse regardless. Defaults to GB for backward compatibility.
 */
export function normalisePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = 'GB',
): NormalisedPhone {
  let t = raw?.trim();
  if (!t) return { e164: null, warning: false };

  // Excel artifacts: numeric coercion ("447725002233.0") and stray trailing ".0".
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '');
  // International dialling prefix written as 00 (e.g. "0033 6 12 34 56 78").
  if (/^00\s*[1-9]/.test(t)) t = `+${t.replace(/^00\s*/, '')}`;

  const strict = normalizeToE164(t, defaultCountry);
  if (strict) return { e164: strict, warning: false };
  const lenient = normalizeToE164Lenient(t, defaultCountry);
  if (lenient) return { e164: lenient, warning: false };

  // Exports often drop the "+" from full international numbers ("447725002233",
  // "353871234567"). National numbers start with 0 (or are shorter), so a long
  // digit string with no leading 0 is worth retrying with "+".
  const digits = t.replace(/[^\d]/g, '');
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith('0')) {
    const intl = normalizeToE164(`+${digits}`);
    if (intl) return { e164: intl, warning: false };
  }

  return { e164: t, warning: true };
}

export function normaliseBoolean(raw: string | null | undefined): boolean | null {
  const t = raw?.trim().toLowerCase();
  if (!t) return null;
  if (['yes', 'true', '1', 'y', 'on', 'opted in'].includes(t)) return true;
  if (['no', 'false', '0', 'n', 'off', 'opted out'].includes(t)) return false;
  return null;
}

/** Local calendar date YYYY-MM-DD (matches extract-references future-row logic). */
export function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateString(
  raw: string | null | undefined,
  preferred?: 'dd/MM/yyyy' | 'MM/dd/yyyy' | null,
): { iso: string | null; ambiguous: boolean } {
  const t = raw?.trim();
  if (!t) return { iso: null, ambiguous: false };

  if (preferred === 'dd/MM/yyyy' || preferred === 'MM/dd/yyyy') {
    const p = parse(t, preferred, new Date());
    if (isValid(p)) return { iso: format(p, 'yyyy-MM-dd'), ambiguous: false };
  }

  for (const fmt of DATE_FORMATS_TRY) {
    const p = parse(t, fmt, new Date());
    if (isValid(p)) {
      const iso = format(p, 'yyyy-MM-dd');
      if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) {
        const parts = t.split(/[/.-]/);
        if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
          const a = Number.parseInt(parts[0], 10);
          const b = Number.parseInt(parts[1], 10);
          if (a <= 12 && b <= 12 && a !== b) {
            return { iso, ambiguous: true };
          }
        }
      }
      return { iso, ambiguous: false };
    }
  }

  const native = Date.parse(t);
  if (!Number.isNaN(native)) {
    const d = new Date(native);
    return { iso: format(d, 'yyyy-MM-dd'), ambiguous: false };
  }

  return { iso: null, ambiguous: false };
}

export function parseTimeString(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;

  // Combined date+time ("2026-03-14 14:30", "14/03/2026 2:30 PM", ISO "T"):
  // parse the time component.
  const dt = t.match(/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[T ](.+)$/);
  if (dt?.[1]) return parseTimeString(dt[1]);

  // 12-hour clock: "2:30 PM", "2.30pm", "12 AM", "11:15:30 p.m."
  const ampm = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(?:[:.](\d{2}))?\s*([AaPp])\.?\s?[Mm]\.?$/);
  if (ampm) {
    let h = Number.parseInt(ampm[1]!, 10);
    const m = ampm[2] ? Number.parseInt(ampm[2], 10) : 0;
    if (h >= 1 && h <= 12 && m >= 0 && m <= 59) {
      const isPm = ampm[4]!.toLowerCase() === 'p';
      if (h === 12) h = isPm ? 12 : 0;
      else if (isPm) h += 12;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    }
    return null;
  }

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
    const [h, m] = t.split(':');
    const hour = Number(h);
    const minute = Number(m);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  }
  return null;
}

export function parseCurrencyPence(raw: string | null | undefined): number | null {
  const t = raw?.trim();
  if (!t) return null;
  const cleaned = t.replace(/[£$€\s]/g, '');
  if (!cleaned) return null;

  // Decide which of '.' / ',' is the decimal separator so European formats
  // ("1.234,56", "12,50") parse to the right VALUE rather than a wrong one.
  let normalized = cleaned;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // "1.234,56" — dots are thousands, last comma is the decimal point.
      const noDots = cleaned.replace(/\./g, '');
      const li = noDots.lastIndexOf(',');
      normalized = `${noDots.slice(0, li).replace(/,/g, '')}.${noDots.slice(li + 1)}`;
    } else {
      // "1,234.56" — commas are thousands.
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const digitsAfter = cleaned.length - lastComma - 1;
    const single = cleaned.indexOf(',') === lastComma;
    normalized =
      single && digitsAfter === 2
        ? cleaned.replace(',', '.') // "12,50" decimal comma
        : cleaned.replace(/,/g, ''); // "1,234" / "1,234,567" thousands
  } else if (lastDot > -1 && cleaned.indexOf('.') !== lastDot) {
    // "1.234.567" — multiple dots are thousands grouping.
    normalized = cleaned.replace(/\./g, '');
  }

  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function parseIntSafe(raw: string | null | undefined): number | null {
  const t = raw?.trim();
  if (!t) return null;
  const n = Number.parseInt(t.replace(/[, ]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function splitFullName(full: string): { first: string; last: string } {
  const t = full.trim();
  if (!t) return { first: '', last: '' };
  const commaIdx = t.indexOf(',');
  if (commaIdx > 0) {
    const last = t.slice(0, commaIdx).trim();
    const first = t.slice(commaIdx + 1).trim();
    if (last && first) return { first, last };
  }
  const sp = t.indexOf(' ');
  if (sp === -1) return { first: t, last: '' };
  return { first: t.slice(0, sp).trim(), last: t.slice(sp + 1).trim() };
}

/**
 * Common provider status abbreviations, matched against the WHOLE trimmed value so
 * short codes (ns, cx, dna) can't false-match inside longer words. Salon/clinic
 * exports use a wide vocabulary of short codes that keyword substrings miss.
 */
const BOOKING_STATUS_CODES: Record<string, string> = {
  // Cancelled
  cxl: 'Cancelled', cxld: 'Cancelled', cx: 'Cancelled', canc: 'Cancelled',
  cancel: 'Cancelled', canceled: 'Cancelled', cancelled: 'Cancelled', void: 'Cancelled',
  // No-Show / did-not-attend
  ns: 'No-Show', 'n/s': 'No-Show', dna: 'No-Show', noshow: 'No-Show', 'no-show': 'No-Show',
  // Completed / attended
  done: 'Completed', fin: 'Completed', finished: 'Completed', attended: 'Completed',
  complete: 'Completed', completed: 'Completed', paid: 'Completed', fulfilled: 'Completed',
  // Seated / arrived / checked-in
  seated: 'Seated', arrived: 'Seated', 'checked-in': 'Seated', checkedin: 'Seated',
  'checked in': 'Seated', 'in-progress': 'Seated', started: 'Seated',
  // Pending / unconfirmed / requested
  pending: 'Pending', unconfirmed: 'Pending', requested: 'Pending', request: 'Pending',
  new: 'Pending', provisional: 'Pending', hold: 'Pending',
  // Booked / confirmed
  booked: 'Booked', confirmed: 'Booked', confirm: 'Booked', conf: 'Booked', active: 'Booked',
};

export function mapBookingStatus(raw: string | null | undefined): string {
  const t = raw?.trim().toLowerCase() ?? '';
  if (!t) return 'Booked';
  // Whole-value provider code first (so "ns"/"cx"/"dna" map correctly), then
  // substring heuristics for longer descriptive statuses.
  const code = BOOKING_STATUS_CODES[t];
  if (code) return code;
  if (t.includes('cancel')) return 'Cancelled';
  if (t.includes('no-show') || t.includes('no show') || t.includes('did not attend') || t.includes('did not arrive')) {
    return 'No-Show';
  }
  if (t.includes('complete') || t.includes('finished') || t.includes('attend')) return 'Completed';
  if (t.includes('seat') || t.includes('arriv') || t.includes('checked')) return 'Seated';
  if (t.includes('pending') || t.includes('unconfirmed') || t.includes('request')) return 'Pending';
  return 'Booked';
}

/** Minutes between two same-day times (HH:mm or HH:mm:ss); negative span wraps +24h (overnight). */
export function durationMinutesBetweenTimes(startHHMMSS: string, endHHMMSS: string): number | null {
  const toMins = (t: string) => {
    const p = t.trim().split(':').map((x) => Number.parseInt(x, 10));
    if (p.length < 2 || Number.isNaN(p[0]!) || Number.isNaN(p[1]!)) return Number.NaN;
    const h = p[0]!;
    const m = p[1]!;
    const s = p[2] ?? 0;
    return h * 60 + m + Math.round(s / 60);
  };
  const s = toMins(startHHMMSS);
  const e = toMins(endHHMMSS);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  let d = e - s;
  if (d < 0) d += 24 * 60;
  return d;
}

/**
 * Maps salon export enums (e.g. Phorest appointment state / activation) then falls back to generic status text.
 */
export function mapImportBookingStatus(params: {
  rawStatus?: string | null;
  activationState?: string | null;
  deletedFlag?: string | null;
}): string {
  const del = params.deletedFlag?.trim().toLowerCase();
  if (del === 'true' || del === 'yes' || del === '1') return 'Cancelled';
  const act = params.activationState?.trim().toUpperCase();
  if (act === 'CANCELED' || act === 'CANCELLED') return 'Cancelled';
  const st = params.rawStatus?.trim().toUpperCase();
  if (st === 'PAID') return 'Completed';
  if (st === 'CHECKED_IN') return 'Seated';
  if (st === 'BOOKED') return 'Booked';
  return mapBookingStatus(params.rawStatus);
}

// Card-hold statuses ('Card Held', 'Charged') are intentionally excluded: imports must never produce them (they require a real booking_card_holds row).
const DEPOSIT_STATUS_ENUMS = [
  'Not Required',
  'Pending',
  'Paid',
  'Refunded',
  'Forfeited',
  'Waived',
] as const;

/**
 * Maps CSV deposit columns to `bookings.deposit_status` and `deposit_amount_pence`.
 * Prefer mapping **Deposit status** when the export uses explicit statuses; otherwise
 * **Deposit amount** + **Deposit paid** (boolean) are combined.
 */
export function resolveDepositFromImport(params: {
  amountRaw: string | null | undefined;
  paidRaw: string | null | undefined;
  statusRaw: string | null | undefined;
}): { deposit_status: (typeof DEPOSIT_STATUS_ENUMS)[number]; deposit_amount_pence: number | null } {
  const amountPence = parseCurrencyPence(params.amountRaw ?? null);
  const statusText = params.statusRaw?.trim();

  if (statusText) {
    const t = statusText.toLowerCase();
    if (t.includes('refund')) {
      return { deposit_status: 'Refunded', deposit_amount_pence: amountPence };
    }
    if (t.includes('forfeit')) {
      return { deposit_status: 'Forfeited', deposit_amount_pence: amountPence };
    }
    if (t.includes('waiv')) {
      return { deposit_status: 'Waived', deposit_amount_pence: amountPence };
    }
    if (t.includes('not required') || t === 'n/a' || t === 'na' || t === 'none') {
      return { deposit_status: 'Not Required', deposit_amount_pence: null };
    }
    if (t.includes('pending') || t.includes('due') || t.includes('unpaid') || t.includes('owing')) {
      return { deposit_status: 'Pending', deposit_amount_pence: amountPence };
    }
    if (t.includes('paid') || t.includes('collected') || t === 'complete' || t === 'yes') {
      return { deposit_status: 'Paid', deposit_amount_pence: amountPence };
    }
    const exact = DEPOSIT_STATUS_ENUMS.find((e) => e.toLowerCase() === t);
    if (exact) {
      return {
        deposit_status: exact,
        deposit_amount_pence: exact === 'Not Required' ? null : amountPence,
      };
    }
  }

  if (amountPence != null && amountPence > 0) {
    const paid = normaliseBoolean(params.paidRaw);
    if (paid === true) return { deposit_status: 'Paid', deposit_amount_pence: amountPence };
    if (paid === false) return { deposit_status: 'Pending', deposit_amount_pence: amountPence };
    return { deposit_status: 'Paid', deposit_amount_pence: amountPence };
  }

  if (normaliseBoolean(params.paidRaw) === true) {
    return { deposit_status: 'Pending', deposit_amount_pence: null };
  }

  return { deposit_status: 'Not Required', deposit_amount_pence: null };
}
