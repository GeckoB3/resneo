/**
 * How tall the drop outline is while a booking is dragged on the diary.
 *
 * The outline mirrors what the grid PAINTS for the moved row: its card, which
 * stops at the last minute the practitioner is busy, and the buffer band when
 * that band sits directly under the card. Processing that runs into the end of
 * the service, or on past it, is free time on the grid (the card is cut there
 * and the slots are bookable), so the outline stops there too: a 3 hour row
 * whose last hour is developing time drags as a 2 hour box, exactly as it is
 * drawn. A buffer band that sits after such a wait is detached from the card
 * and is not part of the box either.
 */
export interface MovedRowFootprint {
  /** Minutes from the dragged bar's top to this row's start. */
  offsetMinutes: number;
  /** What the row's shell spans on the grid, before the trailing free time is cut. */
  displayMinutes: number;
  /** The row's own length (start to `booking_end_time`). */
  coreMinutes: number;
  /**
   * The last minute, from the row's start, at which the practitioner is busy:
   * the core less any processing that reaches its end. The card is cut here.
   */
  activeMinutes: number;
  /** Processing that runs on past the row's end. */
  tailMinutes: number;
  /** Turnover after that, drawn as the buffer band. */
  bufferMinutes: number;
}

/** Minutes from the dragged bar's top to the foot of the last thing drawn for the moved rows. */
export function bookingMoveFootprintMinutes(rows: readonly MovedRowFootprint[]): number {
  return rows.reduce((end, row) => {
    const trailingFree = Math.max(0, row.coreMinutes - row.activeMinutes);
    const drawn = Math.max(0, row.displayMinutes - trailingFree);
    // The band is drawn after the core and any tail, so it touches the card only
    // when the card runs to the very end of the core with no wait after it.
    const bandAttached = row.tailMinutes <= 0 && row.activeMinutes >= row.coreMinutes;
    const reach = drawn + (bandAttached ? Math.max(0, row.bufferMinutes) : 0);
    return Math.max(end, row.offsetMinutes + reach);
  }, 0);
}
