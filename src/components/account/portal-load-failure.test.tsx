/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';

import { AccountCoursesSection } from './AccountCoursesSection';
import { AccountCreditsSection } from './AccountCreditsSection';
import { AccountMembershipsSection } from './AccountMembershipsSection';
import { AccountPaymentMethodsSection } from './AccountPaymentMethodsSection';
import { AccountRecurringSection } from './AccountRecurringSection';

/**
 * P0-5 acceptance: a forced fetch rejection renders a retry, not an empty state.
 *
 * THE DEFECT. Every section's `load()` parsed the body before checking
 * `res.ok`, with no try/catch:
 *
 *     const res = await fetch(url);
 *     const data = await res.json();     // throws on a 500 HTML page
 *     if (!res.ok) { setError(...); }    // never reached
 *
 * So a dropped connection or a non-JSON error page rejected the load silently
 * and the section rendered its EMPTY state. A customer with a network problem
 * was told they had no credits, no memberships and no saved cards, and the
 * payment-methods section went furthest: it told them to go and make a
 * purchase to fix a server error.
 *
 * Two failure modes are forced separately because they are different bugs. A
 * REJECTED fetch is the network case, which the missing try/catch swallowed. A
 * 500 with an HTML body is the case the ordering bug swallowed: `res.ok` was
 * false, but `res.json()` threw before anything looked at it.
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

/** The network is gone: fetch rejects outright. */
function installRejectingFetch() {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch');
  });
}

/** The server is broken: 500 with an HTML body, so res.json() throws. */
function installHtmlErrorFetch() {
  vi.stubGlobal('fetch', async () => ({
    ok: false,
    status: 500,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  }) as unknown as Response);
}

const withToast = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

const SECTIONS: Array<[string, () => React.ReactElement]> = [
  ['credits', () => <AccountCreditsSection />],
  ['courses', () => <AccountCoursesSection />],
  ['memberships', () => <AccountMembershipsSection />],
  ['recurring', () => <AccountRecurringSection />],
  ['payment methods', () => <AccountPaymentMethodsSection />],
];

beforeEach(() => {
  searchParams.current = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a rejected fetch renders a retry, not an empty state', () => {
  for (const [name, render_] of SECTIONS) {
    it(name, async () => {
      installRejectingFetch();
      withToast(render_());

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument(),
      );
      expect(screen.getByText('We could not load this')).toBeInTheDocument();
    });
  }
});

describe('a 500 with an HTML body renders a retry too', () => {
  for (const [name, render_] of SECTIONS) {
    it(name, async () => {
      // The ordering bug: res.ok was false, but res.json() threw before any
      // branch looked at it, so nothing ever set an error.
      installHtmlErrorFetch();
      withToast(render_());

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument(),
      );
    });
  }
});

describe('a failed load does not claim the customer has nothing', () => {
  it('memberships shows no empty state while failed', async () => {
    // The confusion this closes: the amber failure panel above a panel saying
    // "No memberships yet" is two claims, and the empty one is the more
    // believable and the one a customer would act on.
    installRejectingFetch();
    withToast(<AccountMembershipsSection />);

    await waitFor(() => expect(screen.getByText('We could not load this')).toBeInTheDocument());
    expect(screen.queryByText('No memberships yet')).toBeNull();
    expect(screen.queryByText('No membership plans yet')).toBeNull();
  });

  it('courses shows no empty state while failed', async () => {
    installRejectingFetch();
    withToast(<AccountCoursesSection />);

    await waitFor(() => expect(screen.getByText('We could not load this')).toBeInTheDocument());
    expect(screen.queryByText('No enrollments yet')).toBeNull();
    expect(screen.queryByText('No published course packages yet')).toBeNull();
  });

  it('payment methods does not tell the customer to go and buy something', async () => {
    // The line the plan singles out. A server error is not a reason to send a
    // customer off to make a purchase.
    installRejectingFetch();
    withToast(<AccountPaymentMethodsSection />);

    await waitFor(() => expect(screen.getByText('We could not load this')).toBeInTheDocument());
    expect(screen.queryByText(/Book or buy credits at a venue first/)).toBeNull();
  });
});

describe('the empty state is not shown before the load finishes', () => {
  it('memberships renders no empty state while still loading', async () => {
    // G7's false empty state: the section used to claim "None yet." for as
    // long as the fetch took, so a slow connection looked like an empty
    // account.
    let release: (() => void) | null = null;
    vi.stubGlobal('fetch', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    withToast(<AccountMembershipsSection />);
    await waitFor(() => expect(release).not.toBeNull());
    expect(screen.queryByText('No memberships yet')).toBeNull();
  });
});
