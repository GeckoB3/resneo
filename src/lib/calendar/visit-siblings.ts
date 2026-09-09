/**
 * A multi-service visit on the diary, drawn as one bar per service.
 *
 * Services of a visit are independent rows (Docs/visit-services-independent-plan.md):
 * each has its own bar, grip, handle and tray. What still says "these belong together"
 * is identity rather than geometry: a chip on every bar ("1/2"), the earliest
 * service's colour shared by all of them, and siblings lit together on hover. This
 * module is the pure part: which rows form a visit, their order, and whether a moved
 * service now overlaps one of its own siblings.
 */

export interface VisitSiblingRow {
  id: string;
  group_booking_id?: string | null;
  /** Set on a multi-PERSON party, which shares a group id but is not a visit. */
  person_label?: string | null;
  /** Set on a class cart row, which shares a group id but is not a visit. */
  class_instance_id?: string | null;
  booking_date: string;
  booking_time: string;
  status: string;
}

export interface VisitPosition {
  groupId: string;
  /** 0-based place among the visit's live services, by date then time. */
  index: number;
  count: number;
  /** The earliest live service: the one whose colour the whole visit takes. */
  anchorId: string;
}

const TERMINAL = new Set(['Cancelled', 'No-Show']);

function isVisitRow(row: VisitSiblingRow): boolean {
  return Boolean(row.group_booking_id?.trim()) && !row.person_label?.trim() && !row.class_instance_id;
}

function startKey(row: VisitSiblingRow): string {
  return `${row.booking_date}T${row.booking_time.slice(0, 8)}#${row.id}`;
}

/**
 * Where each row stands in its visit, for every row that is one live service of a visit
 * with at least two live services in `rows`. Rows the grid does not hold (another day,
 * a hidden column) are simply not counted, which is the honest answer for a chip drawn
 * from what is on screen.
 */
export function visitSiblingIndex(rows: readonly VisitSiblingRow[]): Map<string, VisitPosition> {
  const byGroup = new Map<string, VisitSiblingRow[]>();
  for (const row of rows) {
    if (!isVisitRow(row) || TERMINAL.has(row.status)) continue;
    const gid = row.group_booking_id!.trim();
    const list = byGroup.get(gid) ?? [];
    list.push(row);
    byGroup.set(gid, list);
  }
  const out = new Map<string, VisitPosition>();
  for (const [groupId, list] of byGroup) {
    if (list.length < 2) continue;
    const ordered = [...list].sort((a, b) => startKey(a).localeCompare(startKey(b)));
    ordered.forEach((row, index) => {
      out.set(row.id, { groupId, index, count: ordered.length, anchorId: ordered[0]!.id });
    });
  }
  return out;
}

export function visitChipLabel(position: VisitPosition): string {
  return `${position.index + 1}/${position.count}`;
}

/**
 * Whether a service meets a sibling of its own visit edge to edge in the same column:
 * `top` when a sibling ends exactly where this one starts, `bottom` when one starts
 * exactly where this one ends. The grid draws a short spine across each such seam,
 * so two touching bars read as one booking without merging them.
 */
export function visitTouchingEdges(params: {
  row: VisitSiblingRow;
  rows: readonly VisitSiblingRow[];
  columnIdOf: (row: VisitSiblingRow) => string | null;
  /** Minutes the row occupies on the grid, from its start. */
  spanMinutesOf: (row: VisitSiblingRow) => number;
  toMinutes: (hhmm: string) => number;
}): { top: boolean; bottom: boolean } {
  const gid = params.row.group_booking_id?.trim();
  const out = { top: false, bottom: false };
  if (!gid || TERMINAL.has(params.row.status)) return out;
  const column = params.columnIdOf(params.row);
  const start = params.toMinutes(params.row.booking_time.slice(0, 5));
  const end = start + params.spanMinutesOf(params.row);
  for (const other of params.rows) {
    if (other.id === params.row.id) continue;
    if (other.group_booking_id?.trim() !== gid || TERMINAL.has(other.status)) continue;
    if (other.booking_date !== params.row.booking_date || params.columnIdOf(other) !== column) continue;
    const s = params.toMinutes(other.booking_time.slice(0, 5));
    const e = s + params.spanMinutesOf(other);
    if (e === start) out.top = true;
    if (s === end) out.bottom = true;
  }
  return out;
}

/**
 * How many of a service's own siblings the window `[startMin, endMin)` on `columnId`,
 * `dateStr` would overlap. A visit's services may overlap each other, and staff may do
 * it on purpose, but it is never silent.
 */
export function ownSiblingOverlapCount(params: {
  moved: Pick<VisitSiblingRow, 'id' | 'group_booking_id'>;
  startMin: number;
  endMin: number;
  columnId: string;
  dateStr: string;
  rows: readonly VisitSiblingRow[];
  columnIdOf: (row: VisitSiblingRow) => string | null;
  /** Minutes the row occupies on the grid, from its start. */
  spanMinutesOf: (row: VisitSiblingRow) => number;
  toMinutes: (hhmm: string) => number;
}): number {
  const gid = params.moved.group_booking_id?.trim();
  if (!gid) return 0;
  let count = 0;
  for (const row of params.rows) {
    if (row.id === params.moved.id) continue;
    if (row.group_booking_id?.trim() !== gid || TERMINAL.has(row.status)) continue;
    if (row.booking_date !== params.dateStr || params.columnIdOf(row) !== params.columnId) continue;
    const s = params.toMinutes(row.booking_time.slice(0, 5));
    const e = s + params.spanMinutesOf(row);
    if (params.startMin < e && s < params.endMin) count += 1;
  }
  return count;
}
