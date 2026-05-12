/** How many rows to process before persisting import progress counters to `import_sessions`. */
export const IMPORT_PROGRESS_DB_FLUSH_INTERVAL = 25;

/**
 * After each processed row, decide whether to flush counters to the DB.
 * Always flush when the batch budget is exhausted so the UI and checkpoint stay aligned.
 */
export function shouldFlushImportProgressToDb(
  rowsSinceLastFlush: number,
  budgetRemainingAfterThisRow: number,
  flushEvery: number = IMPORT_PROGRESS_DB_FLUSH_INTERVAL,
): boolean {
  return rowsSinceLastFlush >= flushEvery || budgetRemainingAfterThisRow <= 0;
}
