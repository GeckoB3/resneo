/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { PassesClient } from './PassesClient';

/**
 * P1-5 acceptance, the parts a unit test can decide: the right section is on
 * the right tab, only one section is mounted at a time, and `?tab=` follows the
 * customer so the URL stays shareable.
 *
 * The load-bearing test is the last one. Four sections on one page is an
 * obvious invitation to render all four and hide three with CSS, and that
 * would be a money bug rather than a layout one: `AccountMembershipsSection`
 * and `AccountCoursesSection` run an `autostart=1` effect on mount that posts
 * to a checkout route. A customer arriving from a membership deep link and
 * landing on the credits tab would have a card charged for a hidden tab they
 * never looked at. The fixture below is a real membership deep link, and the
 * test asserts first that nothing is posted, then that the same fixture DOES
 * post once the customer opens that tab, so it cannot pass by simply failing
 * to reach the section.
 */

const searchParams = { current: new URLSearchParams() };

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.current,
}));

const MEMBERSHIP_DEEP_LINK = 'venue=venue-target&plan=plan-target&autostart=1';

/** Enough of each endpoint's shape for the section to reach its ready state. */
const PAYLOADS: Record<string, Record<string, unknown>> = {
  '/api/account/credits': {
    balances: [],
    ledger: [],
    venues: [],
    purchase_catalog: { venues: [], products: [] },
  },
  '/api/account/courses': {
    enrollments: [],
    courses: [],
    venues: [],
    purchase_catalog: { venues: [], courses: [] },
  },
  '/api/account/memberships': {
    memberships: [],
    products: [],
    venues: [{ id: 'venue-target', name: 'Zebra Wellness' }],
    purchase_catalog: {
      venues: [
        { id: 'venue-first', name: 'Aardvark Studio' },
        { id: 'venue-target', name: 'Zebra Wellness' },
      ],
      products: [
        {
          id: 'plan-first',
          name: 'Aardvark Monthly',
          venue_id: 'venue-first',
          currency: 'gbp',
          stripe_price_id: 'price_a',
        },
        {
          id: 'plan-target',
          name: 'Zebra Unlimited',
          venue_id: 'venue-target',
          currency: 'gbp',
          stripe_price_id: 'price_z',
        },
      ],
    },
  },
  '/api/account/class-recurring': { rules: [], catalog: { venues: [], class_types: [], slots: [] } },
};

function installApi() {
  const posts: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (init?.method === 'POST') {
      posts.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ client_secret: 'cs_test', stripe_account_id: 'acct_test' }),
      } as unknown as Response;
    }
    const key = Object.keys(PAYLOADS).find((k) => url.startsWith(k));
    return {
      ok: true,
      status: 200,
      json: async () => (key ? PAYLOADS[key] : {}),
    } as unknown as Response;
  });
  return posts;
}

beforeEach(() => {
  searchParams.current = new URLSearchParams();
  window.history.replaceState({}, '', '/account/passes');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Each section is identified by its own `PageHeader` title. */
const HEADING = {
  credits: 'Class credits',
  courses: 'Courses',
  memberships: 'Memberships',
  recurring: 'Repeat class bookings',
} as const;

describe('the passes tabs', () => {
  it('opens on the tab it was given, for every tab', async () => {
    for (const [tab, heading] of Object.entries(HEADING)) {
      installApi();
      render(<PassesClient initialTab={tab as keyof typeof HEADING} />);
      expect(
        await screen.findByRole('heading', { name: heading, level: 1 }),
        `${tab} should render ${heading}`,
      ).toBeInTheDocument();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('mounts only the active section', async () => {
    installApi();
    render(<PassesClient initialTab="credits" />);
    await screen.findByRole('heading', { name: HEADING.credits, level: 1 });

    for (const heading of [HEADING.courses, HEADING.memberships, HEADING.recurring]) {
      expect(screen.queryByRole('heading', { name: heading, level: 1 })).not.toBeInTheDocument();
    }
  });

  it('switches section when a tab is clicked, and unmounts the old one', async () => {
    installApi();
    render(<PassesClient initialTab="credits" />);
    await screen.findByRole('heading', { name: HEADING.credits, level: 1 });

    screen.getByRole('tab', { name: 'Recurring' }).click();

    expect(
      await screen.findByRole('heading', { name: HEADING.recurring, level: 1 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: HEADING.credits, level: 1 }),
      ).not.toBeInTheDocument(),
    );
  });

  it('names the tab panel after the tab, so it is not an unlabelled group', () => {
    installApi();
    render(<PassesClient initialTab="courses" />);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-label', 'Courses');
  });

  it('writes the tab into the URL, keeping the rest of the query, without a history entry', async () => {
    window.history.replaceState({}, '', '/account/passes?venue=venue-target&tab=credits');
    searchParams.current = new URLSearchParams('venue=venue-target&tab=credits');
    installApi();
    const lengthBefore = window.history.length;

    render(<PassesClient initialTab="credits" />);
    await screen.findByRole('heading', { name: HEADING.credits, level: 1 });
    screen.getByRole('tab', { name: 'Memberships' }).click();

    await waitFor(() => {
      const url = new URL(window.location.href);
      expect(url.pathname).toBe('/account/passes');
      expect(url.searchParams.getAll('tab')).toEqual(['memberships']);
      // The deep-link argument must survive a tab click: it is what scopes the
      // section to the venue the customer came from.
      expect(url.searchParams.get('venue')).toBe('venue-target');
    });
    // `replaceState`, not `pushState`: a tab is not a place, and stacking four
    // entries would make Back walk the tabs instead of leaving the page.
    expect(window.history.length).toBe(lengthBefore);
  });

  it('does not start a checkout for a deep link on a tab the customer is not on', async () => {
    searchParams.current = new URLSearchParams(MEMBERSHIP_DEEP_LINK);
    const posts = installApi();

    render(<PassesClient initialTab="credits" />);
    await screen.findByRole('heading', { name: HEADING.credits, level: 1 });
    // Let the queued effects and microtasks run: the autostart path is a
    // microtask, so asserting too early would pass whatever the code did.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Memberships' })).toBeEnabled());
    expect(posts, 'a hidden tab started a card payment').toEqual([]);

    // The guard above is only meaningful if this fixture can fire at all.
    screen.getByRole('tab', { name: 'Memberships' }).click();
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toContain('/api/account/memberships/checkout');
  });
});
