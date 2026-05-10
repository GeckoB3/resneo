/**
 * Shared booking-move validation logic used by both the Table Grid and Floor Plan.
 *
 * Extracts the "which tables can this booking move to?" computation so both
 * views produce identical valid-target sets and follow the same conflict rules.
 * Combo candidates are scored using the same spatial-compactness algorithm as
 * the booking/walk-in suggestion engine (scoreCombination from combination-engine).
 */

import { scoreCombination, type CombinationTable } from './combination-engine';

export interface TableInfo {
  id: string;
  name: string;
  max_covers: number;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
}

interface CellInfo {
  table_id: string;
  time: string;
  booking_id: string | null;
  is_blocked?: boolean;
  booking_details?: {
    start_time: string;
    end_time?: string | null;
  } | null;
}

export interface CombinationInfo {
  id: string;
  name: string;
  combined_min_covers?: number;
  combined_max_covers: number;
  table_ids: string[];
}

export interface BookingMoveContext {
  id: string;
  party_size: number;
  start_time: string;
  end_time: string;
}

export interface ValidMoveTargets {
  validTableIds: Set<string>;
  comboLabels: Map<string, string>;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function endMinutesAfterStart(start: string, end: string | null | undefined, fallbackMinutes = 90): number {
  const startMin = timeToMinutes(start.slice(0, 5));
  if (!end) return startMin + fallbackMinutes;
  let endMin = timeToMinutes(end.slice(0, 5));
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return endMin;
}

function timelineMinutesForWallTime(time: string, startMinutes: number): number {
  const minutes = timeToMinutes(time.slice(0, 5));
  return minutes < startMinutes ? minutes + 24 * 60 : minutes;
}

function isTableFree(
  tableId: string,
  bookingId: string,
  blockStart: number,
  blockEnd: number,
  cells: CellInfo[],
): boolean {
  for (const cell of cells) {
    if (cell.table_id !== tableId) continue;
    if (cell.is_blocked) {
      const cTime = timelineMinutesForWallTime(cell.time, blockStart);
      if (blockStart <= cTime && cTime < blockEnd) return false;
    }
    if (!cell.booking_id || !cell.booking_details) continue;
    if (cell.booking_id === bookingId) continue;
    const cStart = timelineMinutesForWallTime(cell.booking_details.start_time, blockStart);
    const cEnd = cStart + (endMinutesAfterStart(cell.booking_details.start_time, cell.booking_details.end_time) - timeToMinutes(cell.booking_details.start_time));
    if (blockStart < cEnd && blockEnd > cStart) return false;
  }
  return true;
}

function toComboTable(t: TableInfo): CombinationTable {
  return {
    id: t.id,
    name: t.name,
    max_covers: t.max_covers,
    position_x: t.position_x,
    position_y: t.position_y,
    width: t.width,
    height: t.height,
    rotation: t.rotation,
  };
}

function scoreComboIds(
  tableIds: string[],
  partySize: number,
  tableMap: Map<string, CombinationTable>,
  isManual: boolean,
): number {
  return scoreCombination(tableIds, partySize, tableMap, isManual).score;
}

/**
 * Compute which tables / combinations are valid move targets for a booking.
 * Returns a set of valid table IDs and a map of table ID -> combo label
 * for tables that are reachable only via a combination.
 */
export function computeValidMoveTargets(
  context: BookingMoveContext,
  tables: TableInfo[],
  cells: CellInfo[],
  combinations: CombinationInfo[],
): ValidMoveTargets {
  const valid = new Set<string>();
  const comboLabels = new Map<string, string>();

  const blockStart = timeToMinutes(context.start_time);
  const blockEnd = endMinutesAfterStart(context.start_time, context.end_time);

  const tableMap = new Map<string, CombinationTable>(
    tables.map((t) => [t.id, toComboTable(t)]),
  );

  for (const table of tables) {
    if (context.party_size <= table.max_covers && isTableFree(table.id, context.id, blockStart, blockEnd, cells)) {
      valid.add(table.id);
      continue;
    }

    const comboCandidates = combinations
      .filter((combo) => combo.table_ids.includes(table.id))
      .filter((combo) =>
        combo.combined_max_covers >= context.party_size &&
        (combo.combined_min_covers ?? 0) <= context.party_size,
      )
      .filter((combo) =>
        combo.table_ids.every((tid) =>
          isTableFree(tid, context.id, blockStart, blockEnd, cells),
        ),
      );

    if (comboCandidates.length === 0) continue;

    const isManual = (c: CombinationInfo) => !c.id.startsWith('auto_');
    comboCandidates.sort(
      (a, b) =>
        scoreComboIds(a.table_ids, context.party_size, tableMap, isManual(a)) -
        scoreComboIds(b.table_ids, context.party_size, tableMap, isManual(b)),
    );

    const best = comboCandidates[0]!;
    valid.add(table.id);
    const tableNames = best.table_ids.map((tid) => {
      const t = tables.find((tbl) => tbl.id === tid);
      return t?.name ?? tid;
    });
    comboLabels.set(table.id, tableNames.join(' + '));
    for (const tid of best.table_ids) {
      valid.add(tid);
    }
  }

  return { validTableIds: valid, comboLabels };
}

/**
 * Resolve the actual table IDs that should be assigned when a booking is
 * dropped on a specific table. Returns null if the drop is invalid.
 */
export function resolveDropTarget(
  targetTableId: string,
  context: BookingMoveContext,
  tables: TableInfo[],
  cells: CellInfo[],
  combinations: CombinationInfo[],
): string[] | null {
  const targetTable = tables.find((t) => t.id === targetTableId);
  if (!targetTable) return null;

  const blockStart = timeToMinutes(context.start_time);
  const blockEnd = context.end_time ? timeToMinutes(context.end_time) : blockStart + 90;

  if (
    context.party_size <= targetTable.max_covers &&
    isTableFree(targetTableId, context.id, blockStart, blockEnd, cells)
  ) {
    return [targetTableId];
  }

  const tableMap = new Map<string, CombinationTable>(
    tables.map((t) => [t.id, toComboTable(t)]),
  );

  const isManual = (c: CombinationInfo) => !c.id.startsWith('auto_');

  const validCombos = combinations
    .filter((combo) => combo.table_ids.includes(targetTableId))
    .filter((combo) =>
      combo.combined_max_covers >= context.party_size &&
      (combo.combined_min_covers ?? 0) <= context.party_size,
    )
    .filter((combo) =>
      combo.table_ids.every((tid) =>
        isTableFree(tid, context.id, blockStart, blockEnd, cells),
      ),
    );

  if (validCombos.length === 0) return null;

  validCombos.sort(
    (a, b) =>
      scoreComboIds(a.table_ids, context.party_size, tableMap, isManual(a)) -
      scoreComboIds(b.table_ids, context.party_size, tableMap, isManual(b)),
  );

  return validCombos[0]!.table_ids;
}
