/**
 * How tall the drop outline is while a booking is dragged on the diary.
 *
 * The outline mirrors everything the grid draws for the rows that move
 * together: a visit's every service (the bar spans them all, waits and gaps
 * included) and, for each, the buffer band drawn under it. It used to be sized
 * from the first service alone, so a visit's green box stopped where its first
 * service did and never reached the turnover after the last one.
 */
export interface MovedRowFootprint {
  /** Minutes from the dragged bar's top to this row's start. */
  offsetMinutes: number;
  /** What the row's bar spans on the grid. */
  displayMinutes: number;
  /** The row's own length (start to `booking_end_time`). */
  coreMinutes: number;
  /** Processing that runs on past its end. */
  tailMinutes: number;
  /** Turnover after that, drawn as the buffer band. */
  bufferMinutes: number;
}

/** Minutes from the dragged bar's top to the foot of the last thing drawn for the moved rows. */
export function bookingMoveFootprintMinutes(rows: readonly MovedRowFootprint[]): number {
  return rows.reduce((end, row) => {
    const reach = row.coreMinutes + Math.max(0, row.tailMinutes) + Math.max(0, row.bufferMinutes);
    return Math.max(end, row.offsetMinutes + Math.max(row.displayMinutes, reach));
  }, 0);
}
