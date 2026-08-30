/** @vitest-environment happy-dom */
/**
 * P2-6 (G13): every destructive action in the portal names its consequence
 * before it happens.
 *
 * Two of these were browser confirm boxes, which state one sentence in a
 * system dialog nobody reads, and one, the membership, had nothing at all: a
 * single click on "Cancel at renewal" scheduled it. What they now share is a
 * `ConfirmDialog` stating what stops, when it stops, what money moves, and
 * whether it can be undone.
 *
 * The rows below assert the CONSEQUENCE COPY, not just that a dialog opened.
 * A dialog that says "Are you sure?" passes the first kind of test and is the
 * thing this task exists to remove.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AccountCoursesSection } from './AccountCoursesSection';
import { AccountMembershipsSection } from './AccountMembershipsSection';
import { AccountRecurringSection } from './AccountRecurringSection';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }));

/** Records every write, so "the dialog fired nothing yet" is assertable. */
function installApi(getPayload: Record<string, unknown>) {
  const mutations: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      mutations.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => getPayload } as unknown as Response;
  });
  return mutations;
}

const VENUES = [{ id: 'v1', name: 'The Wharf' }];

const MEMBERSHIPS = {
  venues: VENUES,
  products: [{ id: 'p1', name: 'Unlimited', venue_id: 'v1' }],
  purchase_catalog: { venues: [], products: [] },
  memberships: [
    {
      id: 'm1',
      venue_id: 'v1',
      product_id: 'p1',
      status: 'active',
      current_period_end: '2026-09-14T00:00:00Z',
      cancel_at_period_end: false,
      stripe_subscription_id: 'sub_1',
      allowance_status: { kind: 'finite', used: 1, starting_balance: 8 },
    },
  ],
};

const COURSES = {
  venues: VENUES,
  courses: [{ id: 'c1', name: 'Beginners Reformer', venue_id: 'v1' }],
  purchase_catalog: { venues: [], courses: [] },
  enrollments: [
    {
      id: 'e1',
      venue_id: 'v1',
      course_product_id: 'c1',
      status: 'active',
      first_session_date: '2026-10-01',
      cancel_by_date: '2026-09-24',
      can_cancel_now: true,
    },
  ],
};

const RECURRING = {
  venues: VENUES,
  class_types: [{ id: 'ct1', name: 'Reformer' }],
  recurring_catalog: { venues: VENUES, class_types: [], timetable_slots: [] },
  reservations: [
    {
      id: 'r1',
      venue_id: 'v1',
      class_type_id: 'ct1',
      status: 'active',
      next_materialize_on: '2026-09-20',
      last_error: null,
      rule: { weekday: 1, start_time: '09:00' },
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openDialogFrom(name: RegExp) {
  const trigger = await screen.findByRole('button', { name });
  await userEvent.click(trigger);
  return screen.findByRole('dialog');
}

describe('cancelling a membership', () => {
  beforeEach(() => installApi(MEMBERSHIPS));

  it('NAMES THE DATE access actually ends', async () => {
    /*
      The stated acceptance. Cancellation is scheduled, not immediate, and the
      only warning used to be the button's own label "Cancel at renewal": the
      renewal date lived in a different line of the row and nothing tied the
      two together. A customer could not tell whether they had just lost the
      classes they had already paid for.
    */
    render(<AccountMembershipsSection />);
    const dialog = await openDialogFrom(/cancel at renewal/i);
    expect(dialog).toHaveTextContent('14 September 2026');
    expect(dialog).toHaveTextContent(/stays active until/i);
  });

  it('says the classes stop, and that nothing more is charged', async () => {
    render(<AccountMembershipsSection />);
    const dialog = await openDialogFrom(/cancel at renewal/i);
    expect(dialog).toHaveTextContent(/classes included in your membership stop/i);
    expect(dialog).toHaveTextContent(/will not be charged again/i);
  });

  it('promises the change of mind that P2-6 made possible', async () => {
    // Only honest since the resume route exists. Before it, no surface
    // anywhere could undo this.
    render(<AccountMembershipsSection />);
    const dialog = await openDialogFrom(/cancel at renewal/i);
    expect(dialog).toHaveTextContent(/change your mind/i);
  });

  it('cancels nothing until the customer confirms', async () => {
    const mutations = installApi(MEMBERSHIPS);
    render(<AccountMembershipsSection />);
    await openDialogFrom(/cancel at renewal/i);
    expect(mutations).toEqual([]);
  });

  it('posts the cancellation once confirmed', async () => {
    const mutations = installApi(MEMBERSHIPS);
    render(<AccountMembershipsSection />);
    await openDialogFrom(/cancel at renewal/i);
    await userEvent.click(screen.getByRole('button', { name: /yes, cancel at renewal/i }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]).toMatchObject({
      method: 'POST',
      url: '/api/account/memberships/cancel',
      body: { membership_id: 'm1' },
    });
  });
});

describe('undoing a scheduled membership cancellation', () => {
  const CANCELLING = {
    ...MEMBERSHIPS,
    memberships: [{ ...MEMBERSHIPS.memberships[0], cancel_at_period_end: true }],
  };

  it('offers the way back where the cancellation was scheduled', async () => {
    installApi(CANCELLING);
    render(<AccountMembershipsSection />);
    expect(await screen.findByRole('button', { name: /keep my membership/i })).toBeInTheDocument();
    // And the cancel control is gone, so the two cannot both be offered.
    expect(screen.queryByRole('button', { name: /cancel at renewal/i })).not.toBeInTheDocument();
  });

  it('does not offer it on a membership that is not cancelling', async () => {
    // The vacuity guard: a control shown always would pass the row above.
    installApi(MEMBERSHIPS);
    render(<AccountMembershipsSection />);
    await screen.findByRole('button', { name: /cancel at renewal/i });
    expect(screen.queryByRole('button', { name: /keep my membership/i })).not.toBeInTheDocument();
  });

  it('posts to the resume route, with no dialog in the way', async () => {
    // Confirming that you want to keep paying for something you already had is
    // friction pointed the wrong way: this is the SAFE direction.
    const mutations = installApi(CANCELLING);
    render(<AccountMembershipsSection />);
    await userEvent.click(await screen.findByRole('button', { name: /keep my membership/i }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]).toMatchObject({
      method: 'POST',
      url: '/api/account/memberships/resume',
      body: { membership_id: 'm1' },
    });
  });
});

describe('cancelling a course enrollment', () => {
  it('states the refund and that it cannot be undone', async () => {
    installApi(COURSES);
    render(<AccountCoursesSection />);
    const dialog = await openDialogFrom(/cancel enrollment/i);
    expect(dialog).toHaveTextContent(/a refund is due/i);
    expect(dialog).toHaveTextContent(/24 September 2026/);
    expect(dialog).toHaveTextContent(/cannot be undone/i);
  });

  it('cancels nothing until confirmed, then posts once', async () => {
    const mutations = installApi(COURSES);
    render(<AccountCoursesSection />);
    await openDialogFrom(/cancel enrollment/i);
    expect(mutations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: /yes, cancel my place/i }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]).toMatchObject({
      url: '/api/account/courses/cancel',
      body: { enrollment_id: 'e1' },
    });
  });
});

describe('deleting a repeat booking', () => {
  it('says the sessions already booked are NOT cancelled', async () => {
    /*
      The half the old confirm box left out, and the one a customer worries
      about. Reading "delete" as "cancel everything" would have them turn up
      expecting a refund, or not turn up at all.
    */
    installApi(RECURRING);
    render(<AccountRecurringSection />);
    const dialog = await openDialogFrom(/^delete$/i);
    expect(dialog).toHaveTextContent(/already booked are NOT cancelled/i);
    expect(dialog).toHaveTextContent(/20 September 2026/);
  });

  it('deletes nothing until confirmed, then sends one DELETE', async () => {
    const mutations = installApi(RECURRING);
    render(<AccountRecurringSection />);
    await openDialogFrom(/^delete$/i);
    expect(mutations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: /yes, delete the repeat/i }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]).toMatchObject({
      method: 'DELETE',
      url: '/api/account/class-recurring/r1',
    });
  });
});
