/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccountNav } from './AccountNav';
import { RETIRED_ACCOUNT_ROUTES } from './retired-routes';

/**
 * P1-3's first acceptance check: exactly four items, plus the conditional
 * dashboard link.
 *
 * The count is the point. G18 is "three navigation systems", and the nav was
 * the largest of them at twelve items plus a thirteenth, roughly eight of them
 * off-screen at 375px with no scroll cue. A test that only asserted the four
 * labels were present would pass with all twelve still there.
 */

const pathname = { current: '/account/bookings' };

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

afterEach(() => {
  cleanup();
  pathname.current = '/account/bookings';
});

function navLinks() {
  return screen.getAllByRole('link');
}

describe('the account nav', () => {
  it('renders exactly four items for a customer', () => {
    render(<AccountNav showVenueDashboard={false} />);
    expect(navLinks().map((a) => a.textContent)).toEqual([
      'Bookings',
      'Passes and plans',
      'Profile',
      'Help',
    ]);
  });

  it('adds the dashboard link, and only for a dual-role user', () => {
    render(<AccountNav showVenueDashboard />);
    expect(navLinks()).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Venue dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('points at no route that has been retired', () => {
    // The regression this catches is quiet rather than loud: a nav item aimed
    // at a redirected path still works, so nothing fails, but the customer
    // pays a redirect on every click and `linkActive` compares pathnames, so
    // the item it points at can never be marked current. That is how P1-5
    // nearly shipped a portal page with no nav item highlighted.
    render(<AccountNav showVenueDashboard />);
    const retired = new Set(RETIRED_ACCOUNT_ROUTES.map((r) => r.from));
    for (const link of navLinks()) {
      expect(retired.has(link.getAttribute('href') ?? ''), link.textContent ?? '').toBe(false);
    }
  });

  it('marks the item the customer is on, and only that one', () => {
    pathname.current = '/account/passes';
    render(<AccountNav showVenueDashboard={false} />);
    const current = navLinks().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Passes and plans']);
  });

  it('marks the parent item on a nested route', () => {
    // A customer reading one booking is still under Bookings.
    pathname.current = '/account/bookings/1b1d6f0a-0000-4000-8000-000000000000';
    render(<AccountNav showVenueDashboard={false} />);
    const current = navLinks().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Bookings']);
  });

  it('marks nothing on the hub, which is reached from the wordmark', () => {
    // Overview is deliberately not an item, so nothing should claim to be
    // current here. Note what this does NOT cover: `linkActive` prefix-matches,
    // so an `/account` item would mark itself current on every route in the
    // portal. That is why it needs an exact-match guard if it ever comes back,
    // and why the guard was deleted rather than left in place unexercised.
    pathname.current = '/account';
    render(<AccountNav showVenueDashboard={false} />);
    expect(navLinks().filter((a) => a.getAttribute('aria-current') === 'page')).toEqual([]);
  });
});
