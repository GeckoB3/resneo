import { describe, expect, it } from 'vitest';
import {
  BOOKING_ACTIONS_CORNER_RIGHT_PX,
  BOOKING_ACTION_BUTTON_WIDTH_PX,
  BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX,
  BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX,
  BOOKING_CORNER_BUTTON_MIN_HEIGHT_PX,
  BOOKING_CORNER_TRAY_PAD_X_PX,
  BOOKING_CORNER_TRAY_RIGHT_PX,
  bookingCornerLayoutBudgetPx,
  bookingCornerTrayPadYPx,
  bookingCornerTrayTopGapPx,
  cornerStackHeightPx,
  planBookingActionClearance,
  planBookingCornerActions,
  type BookingCornerActionInput,
} from './booking-corner-actions';

/**
 * The statuses a bar can be in, in the terms this module understands. Mirrors
 * `countBookingRightColumnActions` / `bookingHasArrivalToggleInRightColumn` /
 * `bookingShowsSeatedUndoInRightColumn` in PractitionerCalendarView.
 */
const STATUSES: Array<{ name: string; input: BookingCornerActionInput }> = [
  { name: 'Pending', input: { fullActionCount: 2, hasArrivalToggle: true, showsSeatedUndo: false } },
  { name: 'Booked', input: { fullActionCount: 2, hasArrivalToggle: true, showsSeatedUndo: false } },
  { name: 'Confirmed', input: { fullActionCount: 2, hasArrivalToggle: true, showsSeatedUndo: false } },
  { name: 'Seated', input: { fullActionCount: 2, hasArrivalToggle: false, showsSeatedUndo: true } },
  { name: 'Completed', input: { fullActionCount: 1, hasArrivalToggle: false, showsSeatedUndo: false } },
  { name: 'Cancelled', input: { fullActionCount: 0, hasArrivalToggle: false, showsSeatedUndo: false } },
];

/** Every bar height the calendar can produce, from a 15 minute compact row up. */
const HEIGHTS = Array.from({ length: 601 }, (_, h) => h);

describe('planBookingCornerActions', () => {
  it('never plans a stack taller than the bar itself', () => {
    for (const { name, input } of STATUSES) {
      for (const h of HEIGHTS) {
        const plan = planBookingCornerActions(input, h);
        if (plan.actionCount === 0) continue;
        expect(
          plan.layout.stackHeightPx,
          `${name} at ${h}px: stack ${plan.layout.stackHeightPx}px overflows a ${h}px bar`,
        ).toBeLessThanOrEqual(Math.max(h, BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX));
      }
    }
  });

  it('fits the height budget whenever the bar can afford it', () => {
    for (const { name, input } of STATUSES) {
      for (const h of HEIGHTS) {
        const plan = planBookingCornerActions(input, h);
        // The single last-resort button is allowed to exceed the budget; anything
        // the bar could actually afford must sit inside it.
        if (plan.actionCount === 0) continue;
        if (plan.layout.buttonMinHeightPx < BOOKING_CORNER_BUTTON_MIN_HEIGHT_PX) continue;
        const budget = bookingCornerLayoutBudgetPx(h);
        expect(
          plan.layout.stackHeightPx,
          `${name} at ${h}px: stack ${plan.layout.stackHeightPx}px exceeds budget ${budget}px`,
        ).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('never renders a button below the absolute floor', () => {
    for (const { name, input } of STATUSES) {
      for (const h of HEIGHTS) {
        const plan = planBookingCornerActions(input, h);
        if (plan.actionCount === 0) continue;
        expect(
          plan.layout.buttonMinHeightPx,
          `${name} at ${h}px got a ${plan.layout.buttonMinHeightPx}px button`,
        ).toBeGreaterThanOrEqual(BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX);
      }
    }
  });

  /**
   * The rule this pins, reported against a 25px bar at 10:22 that showed a name, a
   * service and a phone number and no way to act on the booking: dropping to one
   * button is fine, dropping to none is not. Text yields, the button does not.
   */
  it('always keeps one button for a status that has one, at any height', () => {
    for (const { name, input } of STATUSES) {
      if (input.fullActionCount === 0) continue;
      for (const h of HEIGHTS) {
        expect(
          planBookingCornerActions(input, h).actionCount,
          `${name} at ${h}px has no button at all`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('never plans more actions than the status offers', () => {
    for (const { name, input } of STATUSES) {
      for (const h of HEIGHTS) {
        const plan = planBookingCornerActions(input, h);
        expect(plan.actionCount, `${name} at ${h}px`).toBeLessThanOrEqual(input.fullActionCount);
      }
    }
  });

  it('sheds the secondary row before the primary transition', () => {
    // A bar with room for exactly one legible button must keep the transition
    // (Confirm / Start / Complete), not the arrival toggle or Undo start.
    for (const { name, input } of STATUSES) {
      if (input.fullActionCount < 2) continue;
      const oneButtonHeight =
        cornerStackHeightPx(1, BOOKING_CORNER_BUTTON_MIN_HEIGHT_PX, bookingCornerTrayPadYPx(40)) +
        bookingCornerTrayTopGapPx(40) +
        4;
      const plan = planBookingCornerActions(input, oneButtonHeight);
      expect(plan.actionCount, `${name}`).toBe(1);
      expect(
        plan.omitArrivalActions || plan.omitSeatedUndoActions,
        `${name} kept two rows in a one-row budget`,
      ).toBe(true);
    }
  });

  it('gives tall bars the full comfortable stack', () => {
    for (const { name, input } of STATUSES) {
      if (input.fullActionCount === 0) continue;
      const plan = planBookingCornerActions(input, 480);
      expect(plan.actionCount, name).toBe(input.fullActionCount);
      expect(plan.layout.buttonMinHeightPx, name).toBe(BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX);
      expect(plan.omitArrivalActions, name).toBe(false);
      expect(plan.omitSeatedUndoActions, name).toBe(false);
    }
  });

  it('offers no actions at all for a status with none', () => {
    for (const h of HEIGHTS) {
      expect(
        planBookingCornerActions(
          { fullActionCount: 0, hasArrivalToggle: false, showsSeatedUndo: false },
          h,
        ).actionCount,
      ).toBe(0);
    }
  });

  it('grows monotonically with bar height', () => {
    // A taller bar must never show FEWER buttons, or shorter ones, than a shorter
    // bar: resizing a booking would make its controls flicker between layouts.
    for (const { name, input } of STATUSES) {
      let lastCount = 0;
      let lastHeight = 0;
      for (const h of HEIGHTS) {
        const plan = planBookingCornerActions(input, h);
        expect(
          plan.actionCount,
          `${name}: ${h}px shows ${plan.actionCount} but ${h - 1}px showed ${lastCount}`,
        ).toBeGreaterThanOrEqual(lastCount);
        if (plan.actionCount === lastCount) {
          expect(plan.layout.buttonMinHeightPx, `${name} at ${h}px shrank`).toBeGreaterThanOrEqual(
            lastHeight,
          );
        }
        lastCount = plan.actionCount;
        lastHeight = plan.layout.buttonMinHeightPx;
      }
    }
  });
});

describe('the text gutter clears the buttons', () => {
  /**
   * The bug this pins: the gutter was a hand-set 68px while the buttons actually
   * began 70px in from the card's padding-box right edge, so the phone and time
   * rows slid 2px under the "Arrived" button on any bar whose text reached that
   * far. Anything that changes the button width or the tray insets must move the
   * gutter with it.
   */
  it('reserves more width than the tray column occupies', () => {
    const trayColumnPx =
      BOOKING_CORNER_TRAY_RIGHT_PX + BOOKING_CORNER_TRAY_PAD_X_PX + BOOKING_ACTION_BUTTON_WIDTH_PX;
    expect(BOOKING_ACTIONS_CORNER_RIGHT_PX).toBeGreaterThan(trayColumnPx);
  });
});

describe('bookingCornerTrayTopGapPx', () => {
  it('never eats more than a sliver of a short compact bar', () => {
    for (let h = 0; h <= 60; h++) {
      expect(bookingCornerTrayTopGapPx(h)).toBeLessThanOrEqual(Math.max(2, h * 0.2));
    }
  });

  it('settles at the full gap on comfortable bars', () => {
    expect(bookingCornerTrayTopGapPx(96)).toBe(8);
    expect(bookingCornerTrayTopGapPx(480)).toBe(8);
  });

  it('collapses the tray padding only on bars that cannot spare it', () => {
    expect(bookingCornerTrayPadYPx(25)).toBe(0);
    expect(bookingCornerTrayPadYPx(96)).toBeGreaterThan(0);
  });
});

describe('planBookingActionClearance', () => {
  const twoActions: BookingCornerActionInput = {
    fullActionCount: 2,
    hasArrivalToggle: true,
    showsSeatedUndo: false,
  };
  const clearance = (blockHeightPx: number, rowWidthPx: number | null) =>
    planBookingActionClearance(twoActions, blockHeightPx, rowWidthPx, 12, 20);

  it('keeps the tray beside the text until the row has been measured', () => {
    expect(clearance(280, null).mode).toBe('beside');
    expect(clearance(280, null).right).toBe(BOOKING_ACTIONS_CORNER_RIGHT_PX);
  });

  it('keeps the tray beside the text on a full-width column', () => {
    const c = clearance(94, 300);
    expect(c.mode).toBe('beside');
    expect(c.bottom).toBe(0);
  });

  /**
   * The bug this pins: three overlapping 90 minute bookings gave each lane about
   * 110px, so 76px of gutter left 34px of text and every bar showed "J..." and
   * three rows of ellipsis. The buttons now drop below the text instead.
   */
  it('moves the tray below the text in a narrow overlap lane on a tall bar', () => {
    const c = clearance(280, 110);
    expect(c.mode).toBe('below');
    expect(c.right).toBe(0);
    expect(c.bottom).toBeGreaterThan(0);
    // Two comfortable buttons, their gap, tray padding, inset and the text gap.
    expect(c.bottom).toBeLessThan(90);
    expect(280 - c.bottom - 12).toBeGreaterThanOrEqual(2 * 20);
  });

  it('stays beside on a short bar in a narrow lane when nothing would fit below', () => {
    expect(clearance(24, 110).mode).toBe('beside');
  });

  it('accepts a single row below when the column beside would be unusable', () => {
    // 34px of text beside is unreadable; one full-width row is better. Two
    // comfortable buttons do not fit under it, so the tray is planned against
    // what is left and sheds its secondary button.
    const c = clearance(94, 110);
    expect(c.mode).toBe('below');
    expect(94 - c.bottom - 12).toBeGreaterThanOrEqual(20);
    expect(c.trayBlockHeightPx).toBeLessThan(94);
    expect(planBookingCornerActions(twoActions, c.trayBlockHeightPx).actionCount).toBe(1);
  });

  it('keeps the full bar height for the tray when the stack already fits below', () => {
    expect(clearance(280, 110).trayBlockHeightPx).toBe(280);
  });

  it('wants two rows below before giving up a readable-but-tight column', () => {
    // 190px lane: 114px beside is tight but readable, so only stack below when
    // the bar can show at least two full-width rows above the FULL stack. It
    // never sheds a button to get there.
    expect(clearance(94, 190).mode).toBe('beside');
    expect(clearance(150, 190).mode).toBe('below');
  });

  it('reports no clearance for a bar with no actions', () => {
    expect(
      planBookingActionClearance(
        { fullActionCount: 0, hasArrivalToggle: false, showsSeatedUndo: false },
        120,
        110,
        12,
        20,
      ),
    ).toEqual({ right: 0, bottom: 0, hasActions: false, mode: 'none', trayBlockHeightPx: 120 });
  });
});
