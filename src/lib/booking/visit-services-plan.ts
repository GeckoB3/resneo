/**
 * What a visit's rows must become when its SERVICE LIST changes.
 *
 * Adding, removing or swapping a service rewrites the visit: every service after
 * the one that changed shifts, because a visit is contiguous apart from the gaps
 * its services are entitled to. The schedule planner
 * ({@link ./visit-schedule-plan}) answers "where does this visit go"; this one
 * answers "what is in it", and hands back the same kind of laid-out plan so the
 * endpoint can check every service before writing any.
 *
 * Decisions this encodes, from Docs/multi-service-visit-plan.md:
 * - A service is appended at the end and extends the visit; removing one shrinks
 *   it. The total follows the services rather than being held fixed.
 * - Removing the last remaining service is refused. Ending a booking is a
 *   deliberate cancellation with its own refund and notification rules, and must
 *   not happen by way of an edit.
 * - A swapped service takes the NEW service's duration. A kept one keeps the
 *   duration it has, which may be one staff set by hand.
 */

const MIN_SERVICE_MINUTES = 5;

/** One row of the visit as it stands. */
export interface VisitServiceRowState {
  id: string;
  serviceId: string | null;
  variantId: string | null;
  name: string | null;
  startHm: string;
  durationMinutes: number;
}

/** One line of the visit as the caller wants it. Order is the visit's order. */
export interface RequestedVisitService {
  /** An existing row to keep or re-service. Omit to add a service. */
  bookingId?: string | null;
  serviceId: string;
  variantId?: string | null;
}

export interface CatalogueServiceForVisit {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  variants?: Array<{ id: string; durationMinutes: number; isActive: boolean }>;
}

export interface PlannedVisitServiceEntry {
  kind: 'keep' | 'swap' | 'add';
  /** null for a service being added, which has no row yet. */
  bookingId: string | null;
  serviceId: string;
  variantId: string | null;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  startHm: string;
  endHm: string;
  /** Where the row sits today, for keep and swap. */
  previous: { startHm: string; endHm: string; durationMinutes: number; serviceId: string | null } | null;
  /** True when this line's slot, length or service differs from the row's. */
  changed: boolean;
}

export interface VisitServicesPlan {
  entries: PlannedVisitServiceEntry[];
  /** Rows of the visit the request left out: no longer part of it. */
  removedRowIds: string[];
  startHm: string;
  endHm: string;
  totalMinutes: number;
  changed: boolean;
}

export type VisitServicesPlanResult =
  | { ok: true; plan: VisitServicesPlan }
  | { ok: false; reason: string };

function hmToMinutes(hm: string): number {
  const [h, m] = hm.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToHm(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * The length a line runs for: the chosen variant's, else the service's, except
 * for a line that is staying on the service it already has, which keeps the
 * duration it has (staff may have set it by hand, and re-listing the services is
 * not an instruction to reset it).
 */
function durationForEntry(params: {
  keepingSameService: boolean;
  row: VisitServiceRowState | null;
  service: CatalogueServiceForVisit;
  variantId: string | null;
}): number {
  const { keepingSameService, row, service, variantId } = params;
  if (keepingSameService && row) return row.durationMinutes;
  const variant = variantId
    ? (service.variants ?? []).find((v) => v.id === variantId && v.isActive)
    : null;
  return Math.max(MIN_SERVICE_MINUTES, variant?.durationMinutes ?? service.durationMinutes);
}

export function planVisitServices(params: {
  rows: readonly VisitServiceRowState[];
  requested: readonly RequestedVisitService[];
  catalogue: ReadonlyMap<string, CatalogueServiceForVisit>;
  /** Visit start, HH:mm. Defaults to the earliest row's. */
  startHm?: string | null;
}): VisitServicesPlanResult {
  const { rows, requested, catalogue } = params;

  if (rows.length === 0) {
    return { ok: false, reason: 'This visit has no services to change.' };
  }
  if (requested.length === 0) {
    return {
      ok: false,
      reason:
        'A visit has to keep at least one service. To end the booking altogether, cancel it instead.',
    };
  }

  const ordered = [...rows].sort((a, b) => hmToMinutes(a.startHm) - hmToMinutes(b.startHm));
  const rowById = new Map(ordered.map((r) => [r.id, r]));
  const startHm =
    typeof params.startHm === 'string' && params.startHm.trim() !== ''
      ? params.startHm.slice(0, 5)
      : ordered[0]!.startHm.slice(0, 5);

  const seen = new Set<string>();
  const entries: PlannedVisitServiceEntry[] = [];
  let cursor = hmToMinutes(startHm);

  for (const want of requested) {
    const service = catalogue.get(want.serviceId);
    if (!service) {
      return { ok: false, reason: 'One of the services chosen is not in the catalogue.' };
    }
    const variantId = want.variantId ?? null;
    if (variantId && !(service.variants ?? []).some((v) => v.id === variantId && v.isActive)) {
      return { ok: false, reason: `Choose an available option for ${service.name}.` };
    }

    let row: VisitServiceRowState | null = null;
    if (want.bookingId) {
      row = rowById.get(want.bookingId) ?? null;
      if (!row) {
        return { ok: false, reason: 'One of the services listed is not part of this visit.' };
      }
      if (seen.has(want.bookingId)) {
        return { ok: false, reason: 'A service of this visit was listed twice.' };
      }
      seen.add(want.bookingId);
    }

    const keepingSameService =
      row != null && row.serviceId === want.serviceId && (row.variantId ?? null) === variantId;
    const durationMinutes = durationForEntry({ keepingSameService, row, service, variantId });
    const start = cursor;
    const end = start + durationMinutes;
    cursor = end + Math.max(0, service.bufferMinutes);

    const startHmForEntry = minutesToHm(start);
    const endHmForEntry = minutesToHm(end);
    const previous = row
      ? {
          startHm: row.startHm.slice(0, 5),
          endHm: minutesToHm(hmToMinutes(row.startHm) + row.durationMinutes),
          durationMinutes: row.durationMinutes,
          serviceId: row.serviceId,
        }
      : null;

    entries.push({
      kind: row ? (keepingSameService ? 'keep' : 'swap') : 'add',
      bookingId: row?.id ?? null,
      serviceId: want.serviceId,
      variantId,
      name: service.name,
      durationMinutes,
      bufferMinutes: Math.max(0, service.bufferMinutes),
      startHm: startHmForEntry,
      endHm: endHmForEntry,
      previous,
      changed:
        row == null ||
        !keepingSameService ||
        previous!.startHm !== startHmForEntry ||
        previous!.endHm !== endHmForEntry,
    });
  }

  const removedRowIds = ordered.filter((r) => !seen.has(r.id)).map((r) => r.id);
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const span = hmToMinutes(last.endHm) - hmToMinutes(first.startHm);

  return {
    ok: true,
    plan: {
      entries,
      removedRowIds,
      startHm: first.startHm,
      endHm: last.endHm,
      totalMinutes: span < 0 ? span + 1440 : span,
      changed: removedRowIds.length > 0 || entries.some((e) => e.changed),
    },
  };
}
