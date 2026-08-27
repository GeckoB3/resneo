'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

/**
 * Confirming the card for a membership (P0-17, closes C9).
 *
 * This replaced `window.location.href = session.url`. The hosted Checkout page
 * sent the customer back to `/account/memberships?checkout=success`, which
 * middleware protects: in an app webview with no cookie that redirected to
 * `/login`, so a completed purchase read as a failure. Confirming in place
 * removes the round trip entirely, and the `return_url` below is a public page
 * for the 3DS case that still redirects.
 *
 * The card is all that is confirmed here. The subscription is created by the
 * `setup_intent.succeeded` webhook, which is why the copy says "setting up"
 * rather than claiming the membership is live.
 */
function MembershipCardForm({
  clientSecret,
  onComplete,
}: {
  clientSecret: string;
  onComplete: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setErr(null);
    setLoading(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setErr(submitError.message ?? 'Check your card details.');
        return;
      }
      const { error: se } = await stripe.confirmSetup({
        elements,
        clientSecret,
        confirmParams: {
          // Public, so a webview with no cookie lands somewhere that renders.
          return_url: `${window.location.origin}/membership/complete`,
        },
        redirect: 'if_required',
      });
      if (se) {
        setErr(se.message ?? 'We could not confirm your card.');
        return;
      }
      onComplete();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(ev) => void onSubmit(ev)} className="mt-3 space-y-3">
      <PaymentElement options={{ layout: 'tabs' }} />
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      <button
        type="submit"
        disabled={!stripe || loading}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {loading ? 'Confirming…' : 'Confirm and subscribe'}
      </button>
    </form>
  );
}

/** One Stripe instance per connected account, as the other money sections do. */
const stripeCache = new Map<string, ReturnType<typeof loadStripe>>();

function stripeForAccount(accountId: string) {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  if (!stripeCache.has(accountId)) {
    stripeCache.set(accountId, loadStripe(key, { stripeAccount: accountId }));
  }
  return stripeCache.get(accountId)!;
}

interface AllowanceStatusUnlimited {
  unlimited: true;
}
interface AllowanceStatusFinite {
  unlimited: false;
  allowance_per_period: number;
  starting_balance: number;
  used: number;
  remaining: number;
  rollover: boolean;
  rollover_limit: number | null;
}
type AllowanceStatus = AllowanceStatusUnlimited | AllowanceStatusFinite;

interface MembershipRow {
  id: string;
  venue_id: string;
  product_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
  allowance_status: AllowanceStatus | null;
}

interface CatalogProduct {
  id: string;
  name: string;
  venue_id: string;
  currency: string;
  stripe_price_id: string | null;
}

export function AccountMembershipsSection() {
  const searchParams = useSearchParams();
  const deepLinkVenueId = searchParams?.get('venue') ?? null;
  const deepLinkPlanId = searchParams?.get('plan') ?? null;
  const autostart = searchParams?.get('autostart') === '1';
  const autoStartedRef = useRef(false);

  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string; venue_id: string }>>([]);
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [purchaseCatalog, setPurchaseCatalog] = useState<{
    venues: Array<{ id: string; name: string }>;
    products: CatalogProduct[];
  }>({ venues: [], products: [] });
  const [checkoutVenue, setCheckoutVenue] = useState('');
  const [checkoutProduct, setCheckoutProduct] = useState('');
  const [cardSetup, setCardSetup] = useState<{
    client_secret: string;
    stripe_account_id: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    setError(null);
    const qs = deepLinkVenueId ? `?venue=${encodeURIComponent(deepLinkVenueId)}` : '';
    const res = await fetch(`/api/account/memberships${qs}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not load');
      return;
    }
    setMemberships((data.memberships ?? []) as MembershipRow[]);
    setProducts((data.products ?? []) as Array<{ id: string; name: string; venue_id: string }>);
    setVenues((data.venues ?? []) as Array<{ id: string; name: string }>);
    const pc = (data as { purchase_catalog?: { venues?: unknown[]; products?: unknown[] } }).purchase_catalog;
    setPurchaseCatalog({
      venues: (pc?.venues ?? []) as Array<{ id: string; name: string }>,
      products: (pc?.products ?? []) as CatalogProduct[],
    });
  }, [deepLinkVenueId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const resolvedCheckoutVenue = checkoutVenue || purchaseCatalog.venues[0]?.id || '';

  const productChoices = useMemo(
    () => purchaseCatalog.products.filter((p) => p.venue_id === resolvedCheckoutVenue && p.stripe_price_id),
    [purchaseCatalog.products, resolvedCheckoutVenue],
  );

  const firstProductId = productChoices[0]?.id ?? '';
  const effectiveCheckoutProduct =
    checkoutProduct && productChoices.some((p) => p.id === checkoutProduct) ? checkoutProduct : firstProductId;

  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id.slice(0, 8);
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Plan';

  // Preselect from deep-link.
  useEffect(() => {
    if (deepLinkVenueId && purchaseCatalog.venues.some((v) => v.id === deepLinkVenueId)) {
      setCheckoutVenue(deepLinkVenueId);
    }
  }, [deepLinkVenueId, purchaseCatalog.venues]);
  useEffect(() => {
    if (!deepLinkPlanId) return;
    if (purchaseCatalog.products.some((p) => p.id === deepLinkPlanId)) {
      setCheckoutProduct(deepLinkPlanId);
    }
  }, [deepLinkPlanId, purchaseCatalog.products]);

  // Auto-start Stripe Checkout when arriving with ?venue=&plan=&autostart=1.
  //
  // The venue and plan are passed EXPLICITLY (P0-15, G25). They used not to be:
  // startCheckout() took no arguments and read the two pieces of state that the
  // preselect effects above set in this same commit, so the deferred call ran
  // with the render's stale values and both fell through to their fallbacks.
  // A customer following a link to one venue's plan was charged for a
  // different venue's, on that venue's Stripe Connect account.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!autostart || !deepLinkVenueId || !deepLinkPlanId) return;
    if (!purchaseCatalog.products.some(
      (p) => p.id === deepLinkPlanId && p.venue_id === deepLinkVenueId,
    )) {
      return;
    }
    autoStartedRef.current = true;
    queueMicrotask(() => {
      void startCheckout(deepLinkVenueId, deepLinkPlanId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, deepLinkVenueId, deepLinkPlanId, purchaseCatalog.products]);

  /**
   * Start checkout for an explicit venue and plan, defaulting to whatever the
   * form is showing. The button passes nothing and gets the selects; the deep
   * link passes what the URL asked for and does not depend on state that may
   * not have committed yet.
   */
  async function startCheckout(venueIdArg?: string, productIdArg?: string) {
    setError(null);
    setMsg(null);
    const venueId = venueIdArg || resolvedCheckoutVenue;
    const productId = productIdArg || effectiveCheckoutProduct;
    if (!venueId || !productId) {
      setError('Choose a venue and membership plan.');
      return;
    }
    // A plan that is not on this venue would be charged on the wrong Stripe
    // Connect account, which is the whole failure this guard exists for.
    if (!purchaseCatalog.products.some((p) => p.id === productId && p.venue_id === venueId)) {
      setError('That membership plan is not available at this venue.');
      return;
    }
    setCardSetup(null);
    const res = await fetch('/api/account/memberships/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: venueId, product_id: productId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Checkout failed');
      return;
    }
    if (!data.client_secret || !data.stripe_account_id) {
      setError('Could not start checkout');
      return;
    }
    setCardSetup({
      client_secret: data.client_secret as string,
      stripe_account_id: data.stripe_account_id as string,
    });
  }

  /**
   * After the card confirms, the subscription is created by the webhook, so the
   * membership is not in the list yet. Reloading once immediately and once a
   * few seconds later covers the usual case without pretending to be live.
   */
  function onCardConfirmed() {
    setCardSetup(null);
    setMsg('Card confirmed. We are setting up your membership now.');
    void load();
    window.setTimeout(() => void load(), 4000);
  }

  async function cancelMembership(id: string) {
    setError(null);
    setMsg(null);
    const res = await fetch('/api/account/memberships/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membership_id: id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Cancel failed');
      return;
    }
    setMsg('Cancellation scheduled at period end.');
    void load();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Memberships"
        subtitle="Subscriptions bill on each venue’s Stripe Connect account."
      />
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      {msg ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg}</div> : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Your memberships</h2>
        {memberships.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {memberships.map((m) => {
              const allowance = m.allowance_status;
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <div>
                    <div className="font-medium">{productName(m.product_id)}</div>
                    <div className="text-xs text-slate-500">
                      {venueName(m.venue_id)} · {m.status}
                      {m.current_period_end ? ` · renews ${m.current_period_end.slice(0, 10)}` : ''}
                      {m.cancel_at_period_end ? ' · cancelling' : ''}
                    </div>
                    {allowance ? (
                      <div className="mt-1 text-xs text-slate-700">
                        {allowance.unlimited ? (
                          <span className="font-medium">Unlimited classes.</span>
                        ) : (
                          <>
                            <span className="font-medium">
                              {allowance.used} / {allowance.starting_balance} classes used this period.
                            </span>
                            {m.current_period_end ? (
                              <span className="ml-1 text-slate-500">
                                Resets {m.current_period_end.slice(0, 10)}.
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                  {m.stripe_subscription_id && !m.cancel_at_period_end ? (
                    <button
                      type="button"
                      onClick={() => void cancelMembership(m.id)}
                      className="text-xs font-semibold text-amber-800 hover:underline"
                    >
                      Cancel at period end
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Start a membership</h2>
        <p className="mt-1 text-xs text-slate-500">Plans listed here have Stripe prices configured on the venue account.</p>
        {purchaseCatalog.venues.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No membership products with Stripe prices yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-xs text-slate-600">
              Venue
              <select
                value={resolvedCheckoutVenue}
                onChange={(e) => {
                  setCheckoutVenue(e.target.value);
                  setCheckoutProduct('');
                }}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              >
                {purchaseCatalog.venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 text-xs text-slate-600">
              Plan
              <select
                value={effectiveCheckoutProduct}
                onChange={(e) => setCheckoutProduct(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              >
                {productChoices.length === 0 ? (
                  <option value="">No plans at this venue</option>
                ) : (
                  productChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              type="button"
              disabled={!effectiveCheckoutProduct}
              onClick={() => void startCheckout()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {cardSetup ? (
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Confirm your card</h3>
            <p className="mt-1 text-xs text-slate-500">
              Your card is charged by the venue on their own Stripe account. You can cancel the
              membership at any time from this page.
            </p>
            <Elements
              stripe={stripeForAccount(cardSetup.stripe_account_id)}
              options={{ clientSecret: cardSetup.client_secret, appearance: { theme: 'stripe' } }}
            >
              <MembershipCardForm
                clientSecret={cardSetup.client_secret}
                onComplete={onCardConfirmed}
              />
            </Elements>
          </div>
        ) : null}
      </div>
    </div>
  );
}
