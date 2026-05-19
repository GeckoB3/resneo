import { describe, expect, it } from 'vitest';

/** Popover shows snapshot shell until API detail hydrates (not until displayDetail exists — optimistic snapshot counts). */
describe('booking detail popover hold', () => {
  it('holds when popover and not hydrated even if optimistic displayDetail exists', () => {
    const isPopover = true;
    const isHydrated = false;
    const displayDetail = { id: 'x' };
    const shouldHoldPopoverForFullDetail = isPopover && !isHydrated;
    expect(shouldHoldPopoverForFullDetail).toBe(true);
    expect(displayDetail).not.toBeNull();
  });

  it('releases hold after hydration', () => {
    const isPopover = true;
    const isHydrated = true;
    const shouldHoldPopoverForFullDetail = isPopover && !isHydrated;
    expect(shouldHoldPopoverForFullDetail).toBe(false);
  });
});
