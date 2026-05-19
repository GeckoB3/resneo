/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { isBookingDetailPopoverDismissExempt } from './booking-detail-popover-dismiss';

describe('isBookingDetailPopoverDismissExempt', () => {
  it('returns true for nodes inside the panel root', () => {
    const panel = document.createElement('div');
    const child = document.createElement('button');
    panel.appendChild(child);
    expect(isBookingDetailPopoverDismissExempt(child, panel)).toBe(true);
  });

  it('returns true for portaled dialog content', () => {
    const panel = document.createElement('div');
    const overlay = document.createElement('div');
    overlay.setAttribute('data-booking-detail-dismiss-exempt', '');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    overlay.appendChild(dialog);
    const input = document.createElement('input');
    dialog.appendChild(input);
    expect(isBookingDetailPopoverDismissExempt(input, panel)).toBe(true);
  });

  it('returns false for calendar grid outside panel and dialogs', () => {
    const panel = document.createElement('div');
    const grid = document.createElement('div');
    expect(isBookingDetailPopoverDismissExempt(grid, panel)).toBe(false);
  });
});
