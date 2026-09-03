/**
 * Geometry for the quick-action buttons in the bottom-right corner of a calendar
 * booking bar.
 *
 * This lives here, apart from the calendar view, because two callers depend on it
 * agreeing with itself: the one that reserves the text gutter so booking info does
 * not run under the buttons, and the one that actually draws them. While each kept
 * its own copy of the arithmetic they drifted, and the symptoms were reported as
 * separate bugs (a clipped phone number, buttons floating mid-bar, buttons that
 * changed width when a client was marked arrived).
 */

/** Gap between stacked corner action buttons (`gap-1`). Must match the tray's class. */
export const BOOKING_RIGHT_GAP_PX = 4;

/**
 * Every action button on a booking bar is this wide, always.
 *
 * Width used to be intrinsic to the label, so a bar showing "Start" got 41px, one
 * showing "Arrived" 51px and a started one showing "Undo start" 67px. Four bars in
 * a column could carry four different widths, all right-aligned, and marking a
 * client arrived visibly shrank that bar's buttons while you watched. Wide enough
 * for the longest label in use ("Complete") so nothing truncates.
 */
export const BOOKING_ACTION_BUTTON_WIDTH_PX = 64;

/** Tray offset from the card's padding-box right edge. */
export const BOOKING_CORNER_TRAY_RIGHT_PX = 4;
/** The tray's own horizontal padding (`px-0.5`). */
export const BOOKING_CORNER_TRAY_PAD_X_PX = 2;
/** Clear space between the last character of a text row and the nearest button. */
export const BOOKING_CORNER_TRAY_TEXT_GAP_PX = 6;

/**
 * Horizontal inset so booking info does not run under the bottom-right buttons.
 *
 * Derived, not tuned. As a hand-set 68 it was 2px short of where the buttons
 * actually start, so the phone and time rows on a mid-height bar slid under the
 * "Arrived" button's left edge: visible as a clipped digit, and only on the bars
 * whose text happened to be long enough to reach it.
 */
export const BOOKING_ACTIONS_CORNER_RIGHT_PX =
  BOOKING_CORNER_TRAY_RIGHT_PX +
  BOOKING_CORNER_TRAY_PAD_X_PX +
  BOOKING_ACTION_BUTTON_WIDTH_PX +
  BOOKING_CORNER_TRAY_TEXT_GAP_PX;

/** Minimum gap between the booking bar's top edge and the action stack. */
export const BOOKING_ACTION_TRAY_TOP_GAP_PX = 8;
/** Gap between the action stack and the resize strip (or the card bottom when not resizable). */
export const BOOKING_ACTION_TRAY_BOTTOM_OFFSET_PX = 1;
/** Flush-to-corner inset for the stack, now that the resize strip stops short of it. */
export const BOOKING_ACTION_TRAY_CORNER_INSET_PX = 3;

/**
 * The tray's bottom inset, and so the height it cannot use. Must match the
 * `bottomPx` the tray is rendered with, or the plan sizes a stack that the tray's
 * own `maxHeight` then clips.
 */
export const BOOKING_CORNER_TRAY_BOTTOM_INSET_PX =
  BOOKING_ACTION_TRAY_CORNER_INSET_PX + BOOKING_ACTION_TRAY_BOTTOM_OFFSET_PX;

/** Internal tray padding above / below the buttons. */
export const BOOKING_CORNER_TRAY_PAD_TOP_PX = 4;
export const BOOKING_CORNER_TRAY_PAD_BOTTOM_PX = 2;
export const BOOKING_CORNER_TRAY_PAD_Y_PX =
  BOOKING_CORNER_TRAY_PAD_TOP_PX + BOOKING_CORNER_TRAY_PAD_BOTTOM_PX;

/**
 * Smallest button height that still renders its 10px label comfortably inside its
 * own border. A bar drops its SECOND button rather than draw two slivers, but
 * never its last one: see {@link BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX}.
 */
export const BOOKING_CORNER_BUTTON_MIN_HEIGHT_PX = 16;

/**
 * Absolute floor for the last button standing.
 *
 * A bar must never be left with no way to act on its booking, so once the tray is
 * down to a single button it shrinks past the preferred minimum rather than
 * vanishing. Reached only on bars under ~20px, where the alternative was a bar
 * showing a name, a service and a phone number and no way to start the visit.
 *
 * This is what the button can actually render at: a 10px label on a `lineHeight: 1`
 * line box, 1px of padding each side and its 1px border. Asking for less is a
 * number the DOM ignores, and the button then overhangs the bar it was sized for.
 */
export const BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX = 14;

/**
 * Preferred per-button height; only shrink below this when the bar cannot fit it.
 *
 * A 10px label on its 1.2 line box, 4px of padding each side and a 1px border
 * comes to 22px, so 24 is the label's natural height with a pixel of air. The
 * old 28 was six pixels of empty padding on every button, and the stack read
 * as chunky against the text beside it.
 */
export const BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX = 24;

/**
 * Most of a bar's height a single button may take.
 *
 * Without this a 25px bar drew a 23px button, which left roughly a pixel above it
 * and read as a button jammed against the top edge rather than one sitting in the
 * corner. Binds only below about 39px; taller bars are capped by the comfortable
 * height long before this.
 */
export const BOOKING_CORNER_BUTTON_MAX_BAR_SHARE = 0.72;

/** Tallest a button may be on a bar of this height, before any other constraint. */
export function bookingCornerButtonCapPx(blockHeightPx: number): number {
  return Math.floor(Math.max(0, blockHeightPx) * BOOKING_CORNER_BUTTON_MAX_BAR_SHARE);
}

/** The spacing around the stack, once the button itself is accounted for. */
export interface BookingCornerTraySpacing {
  topGapPx: number;
  bottomInsetPx: number;
  padTopPx: number;
  padBottomPx: number;
}

/** The least the tray can occupy: one pixel clear of the top and bottom edges. */
const BARE_TRAY_SPACING_PX = 2;

const FULL_TRAY_SPACING_PX =
  BOOKING_ACTION_TRAY_TOP_GAP_PX + BOOKING_CORNER_TRAY_BOTTOM_INSET_PX + BOOKING_CORNER_TRAY_PAD_Y_PX;

/**
 * Order in which a growing bar buys its spacing back: clearance from the bottom
 * edge first, then the tray's internal padding, and the generous top gap last.
 */
const TRAY_SPACING_LADDER = [
  BOOKING_CORNER_TRAY_BOTTOM_INSET_PX - 1,
  BOOKING_CORNER_TRAY_PAD_TOP_PX,
  BOOKING_CORNER_TRAY_PAD_BOTTOM_PX,
  BOOKING_ACTION_TRAY_TOP_GAP_PX - 1,
] as const;

/**
 * How much room the tray's spacing gets on a bar of this height.
 *
 * Spacing is bought only out of height the button does not need. A 25px bar spent
 * 18px of itself on the gap above the stack, the inset below it and the tray's own
 * padding, which left nothing for a button: the booking at 10:22 showed a name, a
 * service and a phone number and no way to start the appointment.
 *
 * Buying it back in this order also keeps the button MONOTONIC in the bar height.
 * A flat threshold did not: a 33px bar got a 28px button and a 34px bar only 19px,
 * so nudging a booking taller visibly shrank its controls.
 */
export function bookingCornerTraySpacing(blockHeightPx: number): BookingCornerTraySpacing {
  const spare = Math.max(
    0,
    blockHeightPx - BARE_TRAY_SPACING_PX - BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX,
  );
  let budget = Math.min(FULL_TRAY_SPACING_PX - BARE_TRAY_SPACING_PX, spare);

  const [bottomExtra, padTop, padBottom, topExtra] = TRAY_SPACING_LADDER.map((step) => {
    const taken = Math.min(step, budget);
    budget -= taken;
    return taken;
  }) as [number, number, number, number];

  return {
    topGapPx: 1 + topExtra,
    bottomInsetPx: BOOKING_ACTION_TRAY_BOTTOM_OFFSET_PX + bottomExtra,
    padTopPx: padTop,
    padBottomPx: padBottom,
  };
}

/** True when the bar cannot afford the tray's full spacing alongside a button. */
export function bookingCornerTrayIsTight(blockHeightPx: number): boolean {
  const s = bookingCornerTraySpacing(blockHeightPx);
  return s.topGapPx + s.bottomInsetPx + s.padTopPx + s.padBottomPx < FULL_TRAY_SPACING_PX;
}

/** Tray padding above / below the buttons on a bar of this height. */
export function bookingCornerTrayPadYPx(blockHeightPx: number): number {
  const s = bookingCornerTraySpacing(blockHeightPx);
  return s.padTopPx + s.padBottomPx;
}

/** Tray offset from the bar's bottom edge on a bar of this height. */
export function bookingCornerTrayBottomInsetPx(blockHeightPx: number): number {
  return bookingCornerTraySpacing(blockHeightPx).bottomInsetPx;
}

/** When every action would get less than this, omit secondary rows (Arrived / Undo start). */
export const BOOKING_CORNER_ACTION_OMIT_RAW_PER_ROW_PX = 22;

/**
 * Gap above the action stack. It anchors the stack to the bottom of a tall bar,
 * but a flat 8px is a third of a compact 15 minute bar, so it shrinks with the box.
 */
export function bookingCornerTrayTopGapPx(blockHeightPx: number): number {
  return bookingCornerTraySpacing(blockHeightPx).topGapPx;
}

export function bookingCornerLayoutBudgetPx(blockHeightPx: number): number {
  return Math.max(
    0,
    blockHeightPx -
      bookingCornerTrayTopGapPx(blockHeightPx) -
      bookingCornerTrayBottomInsetPx(blockHeightPx),
  );
}

export function cornerActionRawPerRowPx(
  layoutBudgetPx: number,
  actionCount: number,
  padYPx = BOOKING_CORNER_TRAY_PAD_Y_PX,
): number {
  if (actionCount <= 0) return layoutBudgetPx;
  const gapTotal = Math.max(0, actionCount - 1) * BOOKING_RIGHT_GAP_PX;
  return (layoutBudgetPx - padYPx - gapTotal) / actionCount;
}

/** Height a stack of `count` buttons occupies at `perButtonPx`, tray padding included. */
export function cornerStackHeightPx(
  count: number,
  perButtonPx: number,
  padYPx = BOOKING_CORNER_TRAY_PAD_Y_PX,
): number {
  if (count <= 0) return 0;
  const gapTotal = Math.max(0, count - 1) * BOOKING_RIGHT_GAP_PX;
  return count * perButtonPx + gapTotal + padYPx;
}

/**
 * How many stacked buttons fit in the budget at the preferred minimum height.
 *
 * Never returns zero for a booking that has an action available. A bar with no
 * button at all leaves staff no way to act on that booking from the calendar, so
 * the last one shrinks past the preferred height (down to
 * {@link BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX}) instead of disappearing, and the
 * text alongside it gives up a row.
 */
export function cornerActionCountThatFits(
  layoutBudgetPx: number,
  desiredCount: number,
  padYPx = BOOKING_CORNER_TRAY_PAD_Y_PX,
): number {
  for (let count = desiredCount; count > 1; count -= 1) {
    if (cornerStackHeightPx(count, BOOKING_CORNER_BUTTON_MIN_HEIGHT_PX, padYPx) <= layoutBudgetPx) {
      return count;
    }
  }
  return desiredCount > 0 ? 1 : 0;
}

export interface BookingCornerActionSizing {
  fontSizePx: number;
  buttonMinHeightPx: number;
  stackHeightPx: number;
  /** True once buttons had to shrink below the comfortable height. */
  compact: boolean;
}

/** Sizes corner actions: comfort height by default, shrink only when the bar cannot fit it. */
export function bookingCornerActionLayout(
  layoutBudgetPx: number,
  actionCount: number,
  padYPx = BOOKING_CORNER_TRAY_PAD_Y_PX,
  maxButtonHeightPx = BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX,
): BookingCornerActionSizing {
  // Font size stays constant so a button's WIDTH never changes as the bar gets
  // shorter; only its height compresses, via tighter vertical padding.
  const fontSizePx = 10;
  if (actionCount <= 0) {
    return { fontSizePx, buttonMinHeightPx: 0, stackHeightPx: 0, compact: false };
  }

  // Where two or more buttons are shown they cleared the preferred minimum, so
  // that is what binds. The absolute floor only comes into play for the single
  // button a very short bar keeps rather than showing none.
  const rawPer = cornerActionRawPerRowPx(layoutBudgetPx, actionCount, padYPx);
  const buttonMinHeightPx = Math.min(
    BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX,
    Math.max(
      BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX,
      Math.min(maxButtonHeightPx, Math.floor(rawPer)),
    ),
  );

  return {
    fontSizePx,
    buttonMinHeightPx,
    stackHeightPx: cornerStackHeightPx(actionCount, buttonMinHeightPx, padYPx),
    compact: buttonMinHeightPx < BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX,
  };
}

/** What a bar's status offers, independent of how it will be drawn. */
export interface BookingCornerActionInput {
  /** Total actions the status offers (`countBookingRightColumnActions`). */
  fullActionCount: number;
  /** Status shows Arrived / Clear before the primary transition; droppable when tight. */
  hasArrivalToggle: boolean;
  /** Status shows Undo start before Complete; droppable when tight. */
  showsSeatedUndo: boolean;
}

export interface BookingCornerActionPlan {
  omitArrivalActions: boolean;
  omitSeatedUndoActions: boolean;
  layout: BookingCornerActionSizing;
  /** Zero when the bar is too short to show even one legible button. */
  actionCount: number;
}

/**
 * The one decision about a bar's corner actions: which rows it can afford, how
 * tall they are, and whether it can afford any at all.
 */
export function planBookingCornerActions(
  input: BookingCornerActionInput,
  blockHeightPx: number,
): BookingCornerActionPlan {
  const { fullActionCount, hasArrivalToggle, showsSeatedUndo } = input;
  const layoutBudgetPx = bookingCornerLayoutBudgetPx(blockHeightPx);
  const padYPx = bookingCornerTrayPadYPx(blockHeightPx);
  const capPx = bookingCornerButtonCapPx(blockHeightPx);

  if (fullActionCount <= 0) {
    return {
      omitArrivalActions: false,
      omitSeatedUndoActions: false,
      layout: bookingCornerActionLayout(layoutBudgetPx, 0, padYPx, capPx),
      actionCount: 0,
    };
  }

  const cramped =
    cornerActionRawPerRowPx(layoutBudgetPx, fullActionCount, padYPx) <
    BOOKING_CORNER_ACTION_OMIT_RAW_PER_ROW_PX;

  let omitArrivalActions = hasArrivalToggle && fullActionCount > 1 && cramped;
  let omitSeatedUndoActions = showsSeatedUndo && fullActionCount > 1 && cramped;
  let desired = fullActionCount - (omitArrivalActions ? 1 : 0) - (omitSeatedUndoActions ? 1 : 0);

  // Still over budget: shed the secondary row (arrival toggle / undo start) so the
  // primary transition survives at a legible height rather than both being squashed.
  if (cornerActionCountThatFits(layoutBudgetPx, desired, padYPx) < desired) {
    omitArrivalActions = hasArrivalToggle;
    omitSeatedUndoActions = showsSeatedUndo;
    desired = fullActionCount - (omitArrivalActions ? 1 : 0) - (omitSeatedUndoActions ? 1 : 0);
  }

  const actionCount = cornerActionCountThatFits(layoutBudgetPx, desired, padYPx);
  return {
    omitArrivalActions,
    omitSeatedUndoActions,
    layout: bookingCornerActionLayout(layoutBudgetPx, actionCount, padYPx, capPx),
    actionCount,
  };
}

/**
 * Narrowest text column worth keeping BESIDE the tray.
 *
 * The gutter reserves the tray's full width for the whole height of the bar,
 * which is the right trade on a full-width column (the text loses 76px of ~300)
 * and the wrong one in an overlap lane: three bookings sharing a column left
 * each text column about 30px wide, and every bar in the cluster read as a
 * single initial, "J...", above three rows of ellipsis. Below this width the
 * buttons move UNDER the text instead, and the text runs the full lane.
 */
export const BOOKING_ACTIONS_BESIDE_MIN_TEXT_WIDTH_PX = 128;
/**
 * A text column this narrow shows nothing legible, so the buttons go below it
 * even when that leaves only a single row of text above them.
 */
export const BOOKING_ACTIONS_BESIDE_UNUSABLE_TEXT_WIDTH_PX = 72;
/** Clear space between the last text row and the top of a tray stacked below it. */
export const BOOKING_ACTIONS_BELOW_GAP_PX = 2;

/** Where a bar's text stays clear of its corner action tray. */
export type BookingActionClearanceMode = 'beside' | 'below' | 'none';

export interface BookingActionClearance {
  /** Right padding the text gives up so it never runs under the tray. */
  right: number;
  /** Bottom padding the text gives up so it never runs under the tray. */
  bottom: number;
  hasActions: boolean;
  mode: BookingActionClearanceMode;
  /**
   * Height the tray must be planned and drawn against. The bar's own height in
   * `beside` mode; in `below` mode it may be less, so that a short bar sheds its
   * secondary button and keeps a row of text above the one it keeps. The tray
   * renderer re-plans from this number, so both sides agree.
   */
  trayBlockHeightPx: number;
}

/**
 * Height the tray occupies from the bar's bottom edge, gap above it included, on
 * a bar of this height. This is what the text has to stay above when the tray
 * sits below it rather than beside it.
 */
export function bookingCornerTrayFootprintPx(
  plan: BookingCornerActionPlan,
  trayBlockHeightPx: number,
): number {
  if (plan.actionCount <= 0) return 0;
  return (
    bookingCornerTrayBottomInsetPx(trayBlockHeightPx) +
    plan.layout.stackHeightPx +
    BOOKING_ACTIONS_BELOW_GAP_PX
  );
}

/**
 * Decides whether a bar's text clears the tray by giving up width (the tray
 * beside it) or by giving up height (the tray below it).
 *
 * Beside is the default and the only option until the text row has been
 * measured. Below is chosen only when the column left beside the tray would be
 * too narrow to read AND the bar can show text above the stack: at least two
 * rows, or one row when the column beside would be unusable. In that unusable
 * case, if the full stack leaves no room for even one row, the tray is
 * re-planned against the height that remains once the text has its row, which
 * lets it shed the secondary button the way it already does on a short bar.
 *
 * @param rowWidthPx measured width of the text-plus-tray row, `null` before layout
 * @param textPaddingPx vertical padding the text box spends on itself
 * @param minRowPx height of one row of card text
 */
export function planBookingActionClearance(
  input: BookingCornerActionInput,
  blockHeightPx: number,
  rowWidthPx: number | null | undefined,
  textPaddingPx: number,
  minRowPx: number,
): BookingActionClearance {
  const fullPlan = planBookingCornerActions(input, blockHeightPx);
  if (fullPlan.actionCount <= 0) {
    return { right: 0, bottom: 0, hasActions: false, mode: 'none', trayBlockHeightPx: blockHeightPx };
  }
  const beside: BookingActionClearance = {
    right: BOOKING_ACTIONS_CORNER_RIGHT_PX,
    bottom: 0,
    hasActions: true,
    mode: 'beside',
    trayBlockHeightPx: blockHeightPx,
  };
  if (rowWidthPx == null || rowWidthPx <= 0) return beside;

  const besideTextWidthPx = rowWidthPx - BOOKING_ACTIONS_CORNER_RIGHT_PX;
  if (besideTextWidthPx >= BOOKING_ACTIONS_BESIDE_MIN_TEXT_WIDTH_PX) return beside;

  const rowsNeeded = besideTextWidthPx < BOOKING_ACTIONS_BESIDE_UNUSABLE_TEXT_WIDTH_PX ? 1 : 2;
  const textNeedsPx = rowsNeeded * minRowPx + textPaddingPx;

  const fullFootprintPx = bookingCornerTrayFootprintPx(fullPlan, blockHeightPx);
  if (blockHeightPx - fullFootprintPx >= textNeedsPx) {
    return { right: 0, bottom: fullFootprintPx, hasActions: true, mode: 'below', trayBlockHeightPx: blockHeightPx };
  }

  // A tight-but-readable column is still worth more than a shed button, so only
  // an unusable column pays for its text row with the tray's secondary action.
  if (rowsNeeded > 1) return beside;

  // Give the tray only what the text can spare and let it shrink into that.
  const trayBlockHeightPx = Math.max(0, blockHeightPx - textNeedsPx);
  const tightPlan = planBookingCornerActions(input, trayBlockHeightPx);
  if (tightPlan.actionCount <= 0) return beside;
  const tightFootprintPx = bookingCornerTrayFootprintPx(tightPlan, trayBlockHeightPx);
  if (blockHeightPx - tightFootprintPx < textNeedsPx) return beside;

  return { right: 0, bottom: tightFootprintPx, hasActions: true, mode: 'below', trayBlockHeightPx };
}
