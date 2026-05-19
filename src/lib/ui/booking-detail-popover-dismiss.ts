/**
 * Popover booking detail installs capture-phase outside-click handlers so the
 * calendar grid does not receive the gesture. Portaled dialogs (modify / new / rebook)
 * render outside the panel DOM subtree and must be treated as inside the chrome.
 */
export function isBookingDetailPopoverDismissExempt(
  target: EventTarget | null,
  panelRoot: HTMLElement | null,
): boolean {
  if (!(target instanceof Node)) return false;
  if (panelRoot?.contains(target)) return true;
  if (!(target instanceof Element)) return false;

  return Boolean(
    target.closest('[data-booking-detail-dismiss-exempt]') ??
      target.closest('[role="dialog"]') ??
      target.closest('[role="alertdialog"]'),
  );
}
