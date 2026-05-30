/**
 * Lightweight signal for "the user clicked a sidebar link for the page they are
 * already on". Next.js does not remount a route when you navigate to it again, so
 * a page that wants to reset its in-memory state (e.g. the multi-step New Booking
 * form) can listen for this event and reset itself.
 */

export const NAV_RESELECT_EVENT = 'resneo:nav-reselect';

export interface NavReselectDetail {
  /** The pathname that was re-selected, e.g. "/dashboard/bookings/new". */
  href: string;
}

/** Fire when a nav link to the current pathname is clicked. */
export function dispatchNavReselect(href: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<NavReselectDetail>(NAV_RESELECT_EVENT, { detail: { href } }));
}

/** Subscribe to nav re-selection. Returns an unsubscribe function. */
export function onNavReselect(handler: (href: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<NavReselectDetail>).detail;
    if (detail?.href) handler(detail.href);
  };
  window.addEventListener(NAV_RESELECT_EVENT, listener);
  return () => window.removeEventListener(NAV_RESELECT_EVENT, listener);
}
