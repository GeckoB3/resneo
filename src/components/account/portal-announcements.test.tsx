/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';

import { AccountCoursesSection } from './AccountCoursesSection';
import { AccountCreditsSection } from './AccountCreditsSection';
import { AccountMembershipsSection } from './AccountMembershipsSection';
import { AccountPaymentMethodsSection } from './AccountPaymentMethodsSection';
import { AccountRecurringSection } from './AccountRecurringSection';
import { AccountSecuritySection } from './AccountSecuritySection';

/**
 * P0-8: async outcomes have to be announced (WCAG 4.1.3, Status Messages).
 *
 * The portal reported success and failure by rendering a coloured paragraph
 * and nothing else. A sighted user sees it appear; a screen-reader user gets
 * silence, because nothing tells the AT that a region changed. Every outcome
 * now goes through Toast, which is a polite live region carrying
 * `role="alert"` for errors and `role="status"` for confirmations.
 *
 * These tests assert the ROLE, not the text styling: the requirement is that
 * an assistive technology is told, and the role is what does the telling.
 */

const searchParams = { current: new URLSearchParams() };
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.current,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }));

/** GETs succeed with `payload`; every mutation fails with `error`. */
function installFailingApi(payload: Record<string, unknown>, error = 'Something went wrong') {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') {
      return { ok: false, status: 500, json: async () => ({ error }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  });
}

/** GETs and mutations both succeed. */
function installPassingApi(payload: Record<string, unknown>) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') {
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  });
}

const withToast = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

const VENUES = [{ id: 'v1', name: 'The Wharf' }];

const PAYLOADS: Record<string, Record<string, unknown>> = {
  credits: {
    balances: [],
    products: [],
    venues: VENUES,
    purchase_catalog: {
      venues: VENUES,
      products: [{ id: 'p1', name: 'Ten pack', venue_id: 'v1', price_pence: 5000, credits_count: 10 }],
    },
  },
  memberships: {
    memberships: [],
    products: [],
    venues: VENUES,
    purchase_catalog: {
      venues: VENUES,
      products: [{ id: 'p1', name: 'Monthly', venue_id: 'v1', currency: 'gbp', stripe_price_id: 'price_1' }],
    },
  },
  courses: {
    enrollments: [],
    courses: [],
    venues: VENUES,
    purchase_catalog: {
      venues: VENUES,
      courses: [
        { id: 'free1', name: 'Intro', venue_id: 'v1', price_pence: 0 },
        { id: 'paid1', name: 'Six week', venue_id: 'v1', price_pence: 6000 },
      ],
    },
  },
  paymentMethods: { venues: VENUES, payment_methods: [] },
  recurring: {
    reservations: [],
    class_types: [{ id: 'ct1', name: 'Reformer' }],
    venues: VENUES,
    recurring_catalog: {
      venues: VENUES,
      class_types: [{ id: 'ct1', name: 'Reformer', venue_id: 'v1' }],
      timetable_slots: [{ id: 'ts1', class_type_id: 'ct1', venue_id: 'v1', weekday: 1, start_time: '09:00' }],
    },
  },
};

beforeEach(() => {
  searchParams.current = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a forced failure is announced with role="alert"', () => {
  it('credits', async () => {
    installFailingApi(PAYLOADS.credits, 'Could not start payment');
    withToast(<AccountCreditsSection />);
    // Two controls are named "Pay": one per venue balance row and one in the
    // buy panel. The buy panel's is last, and it is the one that calls a route.
    // The button exists before the catalogue loads and is disabled until a
    // venue and pack resolve, so querying it is not the same as being able to
    // press it. Clicking it early would assert nothing and pass tomorrow.
    const pay = await screen.findByRole('button', { name: 'Pay' });
    await waitFor(() => expect(pay).not.toBeDisabled());
    pay.click();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not start payment'));
  });

  it('memberships', async () => {
    installFailingApi(PAYLOADS.memberships, 'Checkout failed');
    withToast(<AccountMembershipsSection />);
    (await screen.findByRole('button', { name: 'Continue' })).click();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Checkout failed'));
  });

  it('courses', async () => {
    installFailingApi(PAYLOADS.courses, 'Enroll failed');
    withToast(<AccountCoursesSection />);
    (await screen.findByRole('button', { name: 'Enroll free' })).click();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Enroll failed'));
  });

  it('payment methods', async () => {
    installFailingApi(PAYLOADS.paymentMethods, 'Could not start setup');
    withToast(<AccountPaymentMethodsSection />);
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'v1' } });
    (await screen.findByRole('button', { name: 'Add card' })).click();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not start setup'));
  });

  it('recurring', async () => {
    installFailingApi(PAYLOADS.recurring, 'Create failed');
    withToast(<AccountRecurringSection />);
    const create = await screen.findByRole('button', { name: 'Set up repeat booking' });
    create.click();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Create failed'));
  });

  it('security', async () => {
    installFailingApi({}, 'Could not sign out everywhere');
    withToast(<AccountSecuritySection />);
    (await screen.findByRole('button', { name: 'Sign out everywhere' })).click();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});

describe('a forced success is announced with role="status"', () => {
  it('courses enrollment', async () => {
    installPassingApi(PAYLOADS.courses);
    withToast(<AccountCoursesSection />);
    (await screen.findByRole('button', { name: 'Enroll free' })).click();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enrolled.'));
  });

  it('and NOT with role="alert", which would interrupt for good news', async () => {
    // The distinction the plan draws: errors that block progress assert
    // themselves, confirmations wait their turn. Getting this backwards means
    // a screen reader cuts the user off to say "Enrolled."
    installPassingApi(PAYLOADS.courses);
    withToast(<AccountCoursesSection />);
    (await screen.findByRole('button', { name: 'Enroll free' })).click();
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the live region is polite and does not duplicate itself', () => {
  it('announces once, not once per rendering of the same message', async () => {
    // The inline paragraph is kept for persistent visual feedback and
    // deliberately carries no aria-live: two live regions holding the same
    // string announce it twice, which is worse than announcing it once.
    installFailingApi(PAYLOADS.courses, 'Enroll failed');
    withToast(<AccountCoursesSection />);
    (await screen.findByRole('button', { name: 'Enroll free' })).click();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
  });
});
