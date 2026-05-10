import { parse, isValid } from 'date-fns';
import { normalizeToE164, normalizeToE164Lenient } from '@/lib/phone/e164';

const DATE_FORMATS_TRY = [
  'dd/MM/yyyy',
  'd/M/yyyy',
  'MM/dd/yyyy',
  'M/d/yyyy',
  'yyyy-MM-dd',
  'dd-MM-yyyy',
  'd MMMM yyyy',
  'MMMM d, yyyy',
] as const;

export function normaliseEmail(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return t.toLowerCase();
}

export function normalisePhoneUk(raw: string | null | undefined): { e164: string | null; warning: boolean } {
  const t = raw?.trim();
  if (!t) return { e164: null, warning: false };
  const strict = normalizeToE164(t, 'GB');
  if (strict) return { e164: strict, warning: false };
  const lenient = normalizeToE164Lenient(t, 'GB');
  if (lenient) return { e164: lenient, warning: false };
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
    if (isValid(p)) return { iso: p.toISOString().slice(0, 10), ambiguous: false };
  }

  for (const fmt of DATE_FORMATS_TRY) {
    const p = parse(t, fmt, new Date());
    if (isValid(p)) {
      const iso = p.toISOString().slice(0, 10);
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
    return { iso: d.toISOString().slice(0, 10), ambiguous: false };
  }

  return { iso: null, ambiguous: false };
}

export function parseTimeString(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
    const [h, m] = t.split(':');
    return `${String(Number(h)).padStart(2, '0')}:${String(Number(m)).padStart(2, '0')}:00`;
  }
  if (t.includes('T')) {
    const part = (t.split('T')[1] ?? '').slice(0, 8);
    if (part.length >= 5) return `${part.slice(0, 2)}:${part.slice(3, 5)}:00`;
  }
  return null;
}

export function parseCurrencyPence(raw: string | null | undefined): number | null {
  const t = raw?.trim();
  if (!t) return null;
  const cleaned = t.replace(/[£$,]/g, '').trim();
  const n = Number.parseFloat(cleaned);
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
  const sp = t.indexOf(' ');
  if (sp === -1) return { first: t, last: '' };
  return { first: t.slice(0, sp).trim(), last: t.slice(sp + 1).trim() };
}

export function mapBookingStatus(raw: string | null | undefined): string {
  const t = raw?.trim().toLowerCase() ?? '';
  if (!t) return 'Booked';
  if (t.includes('cancel')) return 'Cancelled';
  if (t.includes('no-show') || t.includes('no show')) return 'No-Show';
  if (t.includes('complete') || t.includes('completed')) return 'Completed';
  if (t.includes('seat')) return 'Seated';
  if (t.includes('pending') || t.includes('unconfirmed')) return 'Pending';
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
