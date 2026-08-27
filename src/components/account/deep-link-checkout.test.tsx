/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AccountMembershipsSection } from './AccountMembershipsSection';
import { AccountCoursesSection } from './AccountCoursesSection';

/**
 * G25 / P0-15: a deep link to a specific venue and plan charged a DIFFERENT
 * venue and plan.
 *
 * `startCheckout()` took no arguments and read `resolvedCheckoutVenue` and
 * `effectiveCheckoutProduct` out of the closure of the render that scheduled
 * it. The preselect effects that would have set those values are queued in the
 * same commit, so the microtask ran first and both fell through to their
 * fallbacks: the FIRST venue in the catalogue and the FIRST plan at it. The
 * customer is then charged for a plan they did not choose, on a venue's Stripe
 * Connect account that is not the one they came from.
 *
 * The fixtures below put the deep-linked target SECOND in both catalogues,
 * which is what makes these tests able to fail. With the target first, the
 * broken code and the fixed code agree.
 */

const searchParams = { current: new URLSearchParams() };

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.current,
}));

interface PostCall {
  url: string;
  body: Record<string, unknown>;
}

const MEMBERSHIP_CATALOG = {
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
    // A second plan at the target venue, so "first plan at the right venue" is
    // also distinguishable from "the plan the customer actually asked for".
    {
      id: 'plan-target-other',
      name: 'Zebra Off-Peak',
      venue_id: 'venue-target',
      currency: 'gbp',
      stripe_price_id: 'price_z2',
    },
  ],
};

const COURSE_CATALOG = {
  venues: [
    { id: 'venue-first', name: 'Aardvark Studio' },
    { id: 'venue-target', name: 'Zebra Wellness' },
  ],
  courses: [
    { id: 'course-first', name: 'Aardvark Six Week', venue_id: 'venue-first', price_pence: 6000 },
    { id: 'course-target', name: 'Zebra Twelve Week', venue_id: 'venue-target', price_pence: 12000 },
    { id: 'course-target-other', name: 'Zebra Taster', venue_id: 'venue-target', price_pence: 500 },
    { id: 'course-free-first', name: 'Aardvark Intro', venue_id: 'venue-first', price_pence: 0 },
    { id: 'course-free-target', name: 'Zebra Intro', venue_id: 'venue-target', price_pence: 0 },
  ],
};

function installApi(payload: Record<string, unknown>) {
  const posts: PostCall[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: 'https://checkout.stripe.test/session',
          client_secret: 'cs_test',
          stripe_account_id: 'acct_test',
          amount_pence: 12000,
        }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  });
  return posts;
}

beforeEach(() => {
  searchParams.current = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('memberships deep link (G25)', () => {
  it('charges the venue and plan in the URL, not the first in the catalogue', async () => {
    searchParams.current = new URLSearchParams({
      venue: 'venue-target',
      plan: 'plan-target',
      autostart: '1',
    });
    const posts = installApi({
      memberships: [],
      products: [],
      venues: MEMBERSHIP_CATALOG.venues,
      purchase_catalog: MEMBERSHIP_CATALOG,
    });

    render(<AccountMembershipsSection />);
    await waitFor(() => expect(posts.length).toBe(1));

    expect(posts[0].url).toContain('/api/account/memberships/checkout');
    // Before P0-15 this was { venue_id: 'venue-first', product_id: 'plan-first' }:
    // a subscription on the wrong venue's Stripe Connect account.
    expect(posts[0].body).toEqual({ venue_id: 'venue-target', product_id: 'plan-target' });
  });

  it('picks the plan asked for, not the first plan at the right venue', async () => {
    searchParams.current = new URLSearchParams({
      venue: 'venue-target',
      plan: 'plan-target-other',
      autostart: '1',
    });
    const posts = installApi({
      memberships: [],
      products: [],
      venues: MEMBERSHIP_CATALOG.venues,
      purchase_catalog: MEMBERSHIP_CATALOG,
    });

    render(<AccountMembershipsSection />);
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].body).toEqual({ venue_id: 'venue-target', product_id: 'plan-target-other' });
  });

  it('does not autostart when the plan is not at the linked venue', async () => {
    // A stale or hand-edited link must not charge anything at all.
    searchParams.current = new URLSearchParams({
      venue: 'venue-target',
      plan: 'plan-first',
      autostart: '1',
    });
    const posts = installApi({
      memberships: [],
      products: [],
      venues: MEMBERSHIP_CATALOG.venues,
      purchase_catalog: MEMBERSHIP_CATALOG,
    });

    render(<AccountMembershipsSection />);
    await screen.findByText('Start membership (Stripe Checkout)');
    expect(posts).toEqual([]);
  });

  it('does not autostart without autostart=1', async () => {
    searchParams.current = new URLSearchParams({ venue: 'venue-target', plan: 'plan-target' });
    const posts = installApi({
      memberships: [],
      products: [],
      venues: MEMBERSHIP_CATALOG.venues,
      purchase_catalog: MEMBERSHIP_CATALOG,
    });

    render(<AccountMembershipsSection />);
    await screen.findByText('Start membership (Stripe Checkout)');
    expect(posts).toEqual([]);
  });

  it('still charges what the manual form shows when there is no deep link', async () => {
    const posts = installApi({
      memberships: [],
      products: [],
      venues: MEMBERSHIP_CATALOG.venues,
      purchase_catalog: MEMBERSHIP_CATALOG,
    });

    render(<AccountMembershipsSection />);
    const button = await screen.findByRole('button', { name: 'Go to checkout' });
    button.click();
    await waitFor(() => expect(posts.length).toBe(1));
    // No deep link: the selects show the first venue and its first plan, and
    // that is what must be charged.
    expect(posts[0].body).toEqual({ venue_id: 'venue-first', product_id: 'plan-first' });
  });
});

describe('courses deep link (G25)', () => {
  it('checks out the paid course in the URL, not the first in the catalogue', async () => {
    searchParams.current = new URLSearchParams({
      venue: 'venue-target',
      course: 'course-target',
      autostart: '1',
    });
    const posts = installApi({
      enrollments: [],
      courses: [],
      venues: COURSE_CATALOG.venues,
      purchase_catalog: COURSE_CATALOG,
    });

    render(<AccountCoursesSection />);
    await waitFor(() => expect(posts.length).toBe(1));

    expect(posts[0].url).toContain('/api/account/courses/checkout');
    expect(posts[0].body).toEqual({ venue_id: 'venue-target', product_id: 'course-target' });
  });

  it('enrolls in the free course in the URL, not the first free one', async () => {
    searchParams.current = new URLSearchParams({
      venue: 'venue-target',
      course: 'course-free-target',
      autostart: '1',
    });
    const posts = installApi({
      enrollments: [],
      courses: [],
      venues: COURSE_CATALOG.venues,
      purchase_catalog: COURSE_CATALOG,
    });

    render(<AccountCoursesSection />);
    await waitFor(() => expect(posts.length).toBe(1));

    expect(posts[0].url).toContain('/api/account/courses/enroll');
    expect(posts[0].body).toEqual({ venue_id: 'venue-target', product_id: 'course-free-target' });
  });

  it('does not autostart when the course is not at the linked venue', async () => {
    searchParams.current = new URLSearchParams({
      venue: 'venue-target',
      course: 'course-first',
      autostart: '1',
    });
    const posts = installApi({
      enrollments: [],
      courses: [],
      venues: COURSE_CATALOG.venues,
      purchase_catalog: COURSE_CATALOG,
    });

    render(<AccountCoursesSection />);
    await screen.findByText('Enrollments');
    expect(posts).toEqual([]);
  });
});
