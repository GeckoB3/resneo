'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

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

  // Auto-start Stripe Checkout when arriving with ?venue=&plan=&autostart=1 —
  // deferred so the setState cascade inside startCheckout runs after commit.
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
      void startCheckout();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, deepLinkVenueId, deepLinkPlanId, purchaseCatalog.products]);

  async function startCheckout() {
    setError(null);
    setMsg(null);
    if (!resolvedCheckoutVenue || !effectiveCheckoutProduct) {
      setError('Choose a venue and membership plan.');
      return;
    }
    const res = await fetch('/api/account/memberships/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: resolvedCheckoutVenue, product_id: effectiveCheckoutProduct }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Checkout failed');
      return;
    }
    if (data.url) window.location.href = data.url as string;
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
        <h2 className="text-sm font-semibold text-slate-900">Start membership (Stripe Checkout)</h2>
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
              Go to checkout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
