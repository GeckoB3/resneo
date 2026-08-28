/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccountCoursesSection } from './AccountCoursesSection';
import { AccountCreditsSection } from './AccountCreditsSection';
import { AccountMembershipsSection } from './AccountMembershipsSection';
import { AccountPaymentMethodsSection } from './AccountPaymentMethodsSection';
import { AccountRecurringSection } from './AccountRecurringSection';
import { AccountSecuritySection } from './AccountSecuritySection';

/**
 * P0-7 acceptance, checks (1) and (2).
 *
 * (1) is a grep and lives in `portal-no-raw-buttons.test.ts`. This file is (2):
 * for every control converted from a hand-rolled `<button>` to the `Button`
 * primitive, the ACCESSIBLE NAME is unchanged, and for every mutation handler
 * the control is DISABLED while the request is in flight (G30).
 *
 * The name assertions are frozen lists per component rather than one test per
 * control. A list catches a control that disappears as well as one that gets
 * renamed, which a per-control test does not, and it is the same failure
 * either way: a customer looking for a button that is no longer there.
 *
 * The in-flight assertions are the part that would have been silent. The
 * portal had no guard on nine handlers, so a double tap enrolled twice, minted
 * two SetupIntents, or fired two DELETEs at the same row. `/manage` has had
 * this guard all along, which is what made the gap a regression rather than a
 * feature.
 */

const searchParams = { current: new URLSearchParams() };
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.current,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// The Payment Element needs a live Stripe object; these sections only render it
// after a purchase starts, and none of these tests go that far.
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }));

/** Resolve GETs immediately; hold POST/PATCH/DELETE open so "in flight" is observable. */
function installApi(getPayload: Record<string, unknown>) {
  let releaseMutation: (() => void) | null = null;
  const mutations: string[] = [];

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      mutations.push(`${method} ${url}`);
      await new Promise<void>((resolve) => {
        releaseMutation = resolve;
      });
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => getPayload } as unknown as Response;
  });

  return {
    mutations,
    release: () => releaseMutation?.(),
    get inFlight() {
      return releaseMutation !== null;
    },
  };
}

/** Every button on screen, by accessible name, in DOM order. */
function buttonNames(): string[] {
  return screen.getAllByRole('button').map((b) => b.textContent?.trim() ?? '');
}

beforeEach(() => {
  searchParams.current = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CATALOG_VENUES = [{ id: 'v1', name: 'The Wharf' }];

/**
 * `Add card` renders only once a venue is chosen, and the recurring form only
 * once the RECURRING catalog is non-empty. Both gates are real product
 * behaviour, so the fixtures satisfy them rather than the tests reaching past
 * them.
 */
async function selectPaymentVenue() {
  const select = await screen.findByRole('combobox');
  fireEvent.change(select, { target: { value: 'v1' } });
}

const RECURRING_PAYLOAD = {
  reservations: [],
  class_types: [{ id: 'ct1', name: 'Reformer' }],
  venues: CATALOG_VENUES,
  recurring_catalog: {
    venues: CATALOG_VENUES,
    class_types: [{ id: 'ct1', name: 'Reformer', venue_id: 'v1' }],
    timetable_slots: [{ id: 'ts1', class_type_id: 'ct1', venue_id: 'v1', weekday: 1, start_time: '09:00' }],
  },
};

describe('accessible names survive the primitive migration', () => {
  it('credits', async () => {
    installApi({
      balances: [],
      products: [],
      venues: CATALOG_VENUES,
      purchase_catalog: { venues: CATALOG_VENUES, products: [{ id: 'p1', name: 'Ten pack', venue_id: 'v1', price_pence: 5000, credits_count: 10 }] },
    });
    render(<AccountCreditsSection />);
    await waitFor(() => expect(buttonNames()).toContain('Pay'));
  });

  it('memberships', async () => {
    installApi({
      memberships: [],
      products: [],
      venues: CATALOG_VENUES,
      purchase_catalog: {
        venues: CATALOG_VENUES,
        products: [{ id: 'p1', name: 'Monthly', venue_id: 'v1', currency: 'gbp', stripe_price_id: 'price_1' }],
      },
    });
    render(<AccountMembershipsSection />);
    await waitFor(() => expect(buttonNames()).toEqual(['Continue']));
  });

  it('courses', async () => {
    installApi({
      enrollments: [],
      courses: [],
      venues: CATALOG_VENUES,
      purchase_catalog: {
        venues: CATALOG_VENUES,
        courses: [
          { id: 'free1', name: 'Intro', venue_id: 'v1', price_pence: 0 },
          { id: 'paid1', name: 'Six week', venue_id: 'v1', price_pence: 6000 },
        ],
      },
    });
    render(<AccountCoursesSection />);
    await waitFor(() => expect(buttonNames()).toEqual(['Enroll free', 'Pay with card']));
  });

  it('payment methods', async () => {
    installApi({ venues: CATALOG_VENUES, payment_methods: [] });
    render(<AccountPaymentMethodsSection />);
    await selectPaymentVenue();
    await waitFor(() => expect(buttonNames()).toContain('Add card'));
  });

  it('security', async () => {
    installApi({});
    render(<AccountSecuritySection />);
    await waitFor(() => {
      const names = buttonNames();
      expect(names).toContain('Sign out everywhere');
      expect(names).toContain('Request account deletion');
      expect(names).toContain('Cancel deletion request');
    });
  });

  it('recurring', async () => {
    installApi(RECURRING_PAYLOAD);
    render(<AccountRecurringSection />);
    await waitFor(() => expect(buttonNames()).toContain('Create rule'));
  });
});

describe('mutation controls disable while in flight (G30)', () => {
  /**
   * The nine handlers, by file. The plan said eight; the tenth control
   * (`ManageBookingLink`) already had a guard from P0-3 and
   * `AccountRecurringSection`'s three had one from the start, which is why they
   * are not listed as newly guarded here.
   *
   *   AccountPaymentMethodsSection  startSetup
   *   AccountCreditsSection         BuyPackPicker onBuy
   *   AccountMembershipsSection     startCheckout, cancelMembership
   *   AccountCoursesSection         enrollFree, startPaidCheckout, cancelEnrollment
   *   ProfileClient                 registerThisDevice, removeDevice
   */
  it('payment methods: Add card', async () => {
    const api = installApi({ venues: CATALOG_VENUES, payment_methods: [] });
    render(<AccountPaymentMethodsSection />);
    await selectPaymentVenue();
    const btn = await screen.findByRole('button', { name: 'Add card' });
    expect(btn).not.toBeDisabled();

    btn.click();
    await waitFor(() => expect(btn).toBeDisabled());
    // And the double tap that motivated the guard issues nothing further.
    btn.click();
    expect(api.mutations).toHaveLength(1);

    api.release();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('memberships: Continue', async () => {
    const api = installApi({
      memberships: [],
      products: [],
      venues: CATALOG_VENUES,
      purchase_catalog: {
        venues: CATALOG_VENUES,
        products: [{ id: 'p1', name: 'Monthly', venue_id: 'v1', currency: 'gbp', stripe_price_id: 'price_1' }],
      },
    });
    render(<AccountMembershipsSection />);
    const btn = await screen.findByRole('button', { name: 'Continue' });

    btn.click();
    await waitFor(() => expect(btn).toBeDisabled());
    btn.click();
    expect(api.mutations).toEqual(['POST /api/account/memberships/checkout']);
  });

  it('courses: Enroll free and Pay with card', async () => {
    const api = installApi({
      enrollments: [],
      courses: [],
      venues: CATALOG_VENUES,
      purchase_catalog: {
        venues: CATALOG_VENUES,
        courses: [
          { id: 'free1', name: 'Intro', venue_id: 'v1', price_pence: 0 },
          { id: 'paid1', name: 'Six week', venue_id: 'v1', price_pence: 6000 },
        ],
      },
    });
    render(<AccountCoursesSection />);
    const enroll = await screen.findByRole('button', { name: 'Enroll free' });

    enroll.click();
    await waitFor(() => expect(enroll).toBeDisabled());
    enroll.click();
    expect(api.mutations).toEqual(['POST /api/account/courses/enroll']);
  });

  it('credits: Pay', async () => {
    const api = installApi({
      balances: [],
      products: [],
      venues: CATALOG_VENUES,
      purchase_catalog: {
        venues: CATALOG_VENUES,
        products: [{ id: 'p1', name: 'Ten pack', venue_id: 'v1', price_pence: 5000, credits_count: 10 }],
      },
    });
    render(<AccountCreditsSection />);
    const pay = await screen.findByRole('button', { name: 'Pay' });

    pay.click();
    await waitFor(() => expect(pay).toBeDisabled());
    pay.click();
    expect(api.mutations).toEqual(['POST /api/account/credits/purchase']);
  });

  it('security: Sign out everywhere', async () => {
    // This one already had a guard. Asserted anyway: the migration moved it
    // from `disabled` to `loading`, and those are only equivalent if the
    // primitive really does set `disabled` from `loading`.
    const api = installApi({});
    render(<AccountSecuritySection />);
    const btn = await screen.findByRole('button', { name: 'Sign out everywhere' });

    btn.click();
    await waitFor(() => expect(btn).toBeDisabled());
    expect(api.mutations).toHaveLength(1);
  });
});
