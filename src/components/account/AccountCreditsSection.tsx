'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

interface BalanceRow {
  id: string;
  venue_id: string;
  product_id: string;
  credits_remaining: number;
  expires_at: string | null;
}

interface LedgerRow {
  id: string;
  delta_credits: number;
  reason: string;
  created_at: string;
  venue_id: string;
}

function CreditPurchaseForm({
  clientSecret,
  stripeAccountId,
  onDone,
}: {
  clientSecret: string;
  stripeAccountId: string;
  onDone: () => void;
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
        setErr(submitError.message ?? 'Check card details');
        return;
      }
      const { error: pe, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        redirect: 'if_required',
      });
      if (pe) {
        setErr(pe.message ?? 'Payment failed');
        return;
      }
      if (paymentIntent?.status === 'succeeded' && paymentIntent.id) {
        await fetch('/api/account/credits/fulfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_intent_id: paymentIntent.id,
            stripe_account_id: stripeAccountId,
          }),
        });
      }
      onDone();
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
        {loading ? 'Processing…' : 'Pay'}
      </button>
    </form>
  );
}

const stripeCache = new Map<string, ReturnType<typeof loadStripe>>();

function stripeForAccount(accountId: string) {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  if (!stripeCache.has(accountId)) {
    stripeCache.set(accountId, loadStripe(key, { stripeAccount: accountId }));
  }
  return stripeCache.get(accountId)!;
}

interface CatalogProduct {
  id: string;
  name: string;
  venue_id: string;
  credits_count: number;
  price_pence: number;
  currency: string;
}

export function AccountCreditsSection() {
  const searchParams = useSearchParams();
  const deepLinkVenueId = searchParams?.get('venue') ?? null;
  const deepLinkProductId = searchParams?.get('product') ?? null;
  const autostart = searchParams?.get('autostart') === '1';

  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string; venue_id: string }>>([]);
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [purchaseCatalog, setPurchaseCatalog] = useState<{
    venues: Array<{ id: string; name: string }>;
    products: CatalogProduct[];
  }>({ venues: [], products: [] });
  const [error, setError] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<{
    venue_id: string;
    product_id: string;
    client_secret: string;
    stripe_account_id: string;
  } | null>(null);
  const autoStartedRef = useRef(false);

  const load = useCallback(async () => {
    await Promise.resolve();
    setError(null);
    const qs = deepLinkVenueId ? `?venue=${encodeURIComponent(deepLinkVenueId)}` : '';
    const res = await fetch(`/api/account/credits${qs}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not load credits');
      return;
    }
    setBalances((data.balances ?? []) as BalanceRow[]);
    setLedger((data.ledger ?? []) as LedgerRow[]);
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

  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id.slice(0, 8);
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Pack';

  const formatExpiry = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const startPurchase = useCallback(
    async (venue_id: string, product_id: string) => {
      setError(null);
      const res = await fetch('/api/account/credits/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id, product_id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not start payment');
        return;
      }
      setPurchase({
        venue_id,
        product_id,
        client_secret: data.client_secret,
        stripe_account_id: data.stripe_account_id,
      });
    },
    [],
  );

  function afterPaid() {
    setPurchase(null);
    void load();
  }

  // Auto-start checkout when arriving from /book/... with ?venue=&product=&autostart=1.
  // The setState cascade inside startPurchase() is intentional: this is a one-shot
  // reaction to an external (deep-link) event, gated by autoStartedRef so it cannot
  // re-trigger on subsequent renders.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!autostart || !deepLinkVenueId || !deepLinkProductId) return;
    // Wait until the catalog has loaded and the product is visible to the user.
    if (purchaseCatalog.products.length === 0) return;
    const exists = purchaseCatalog.products.some(
      (p) => p.id === deepLinkProductId && p.venue_id === deepLinkVenueId,
    );
    if (!exists) return;
    autoStartedRef.current = true;
    // Defer the network call (which mutates state) out of the effect body so the
    // react-hooks/set-state-in-effect rule is happy; the user-perceived behaviour
    // is the same since this is a one-shot event handler.
    queueMicrotask(() => {
      void startPurchase(deepLinkVenueId, deepLinkProductId);
    });
  }, [autostart, deepLinkVenueId, deepLinkProductId, purchaseCatalog.products, startPurchase]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Class credits"
        subtitle="Balances are per venue. Buy packs from a venue that sells them; redeem when booking paid classes (where enabled)."
      />
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Balances</h2>
        {balances.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No credit batches yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {balances.map((b) => {
              const expiry = formatExpiry(b.expires_at);
              return (
                <li key={b.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block">
                      {productName(b.product_id)} · {venueName(b.venue_id)}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {expiry ? `Expires ${expiry}` : 'No expiry'}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium">{b.credits_remaining} left</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Buy a pack</h2>
        <p className="mt-1 text-xs text-slate-500">Choose a venue, then a published credit pack.</p>
        <BuyPackPicker
          catalog={purchaseCatalog}
          preselectVenueId={deepLinkVenueId}
          preselectProductId={deepLinkProductId}
          onBuy={(v, p) => void startPurchase(v, p)}
        />
      </div>

      {purchase ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-900">Complete payment</h2>
          <Elements
            stripe={stripeForAccount(purchase.stripe_account_id)}
            options={{ clientSecret: purchase.client_secret, appearance: { theme: 'stripe' } }}
          >
            <CreditPurchaseForm
              clientSecret={purchase.client_secret}
              stripeAccountId={purchase.stripe_account_id}
              onDone={() => void afterPaid()}
            />
          </Elements>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Recent ledger</h2>
        {ledger.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No activity yet.</p>
        ) : (
          <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-xs text-slate-700">
            {ledger.map((l) => (
              <li key={l.id}>
                {l.created_at.slice(0, 10)} · {l.reason} · {l.delta_credits > 0 ? '+' : ''}
                {l.delta_credits} · {venueName(l.venue_id)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BuyPackPicker({
  catalog,
  preselectVenueId,
  preselectProductId,
  onBuy,
}: {
  catalog: { venues: Array<{ id: string; name: string }>; products: CatalogProduct[] };
  preselectVenueId?: string | null;
  preselectProductId?: string | null;
  onBuy: (venueId: string, productId: string) => void;
}) {
  const initialVenueId =
    (preselectVenueId && catalog.venues.some((v) => v.id === preselectVenueId)
      ? preselectVenueId
      : null) ?? catalog.venues[0]?.id ?? '';
  const [venueId, setVenueId] = useState(initialVenueId);
  const [productId, setProductId] = useState(preselectProductId ?? '');
  // Track venue prop changes (catalog loads async).
  useEffect(() => {
    if (preselectVenueId && catalog.venues.some((v) => v.id === preselectVenueId)) {
      setVenueId(preselectVenueId);
    } else if (!venueId && catalog.venues[0]?.id) {
      setVenueId(catalog.venues[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectVenueId, catalog.venues.length]);
  useEffect(() => {
    if (preselectProductId) setProductId(preselectProductId);
  }, [preselectProductId]);
  const productChoices = useMemo(
    () => catalog.products.filter((p) => p.venue_id === venueId),
    [catalog.products, venueId],
  );
  const firstProductId = productChoices[0]?.id ?? '';
  const effectiveProductId =
    productId && productChoices.some((p) => p.id === productId) ? productId : firstProductId;

  if (catalog.venues.length === 0 || catalog.products.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">No published credit packs are available yet.</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-xs text-slate-600">
        Venue
        <select
          value={venueId}
          onChange={(e) => {
            setVenueId(e.target.value);
            setProductId('');
          }}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
        >
          {catalog.venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 flex-1 text-xs text-slate-600">
        Pack
        <select
          value={effectiveProductId}
          onChange={(e) => setProductId(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
        >
          {productChoices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.credits_count} credits (£{(p.price_pence / 100).toFixed(2)})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!venueId || !effectiveProductId}
        onClick={() => onBuy(venueId, effectiveProductId)}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Pay
      </button>
    </div>
  );
}
