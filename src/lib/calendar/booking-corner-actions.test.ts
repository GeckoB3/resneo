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
