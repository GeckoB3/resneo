'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

function SetupForm({ clientSecret, stripeAccountId: _stripeAccountId, onComplete }: { clientSecret: string; stripeAccountId: string; onComplete: () => void }) {
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
        setErr(submitError.message ?? 'Check card');
        return;
      }
      const { error: se } = await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: 'if_required',
      });
      if (se) {
        setErr(se.message ?? 'Setup failed');
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
      <button type="submit" disabled={!stripe || loading} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {loading ? 'Saving…' : 'Save card'}
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

export function AccountPaymentMethodsSection() {
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [venueId, setVenueId] = useState('');
  const [methods, setMethods] = useState<Array<{ id: string; brand: string | null; last4: string | null }>>([]);
  const [setup, setSetup] = useState<{ client_secret: string; stripe_account_id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadVenues = useCallback(async () => {
    const res = await fetch('/api/account/class-commerce-venues');
    const data = await res.json();
    if (res.ok) setVenues((data.venues ?? []) as Array<{ id: string; name: string }>);
  }, []);

  const loadMethods = useCallback(async (vid: string) => {
    setError(null);
    const res = await fetch(`/api/account/payment-methods?venue_id=${encodeURIComponent(vid)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not list cards');
      return;
    }
    setMethods((data.payment_methods ?? []) as Array<{ id: string; brand: string | null; last4: string | null }>);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadVenues();
    });
  }, [loadVenues]);

  async function startSetup() {
    setError(null);
    setSetup(null);
    if (!venueId) {
      setError('Pick a venue.');
      return;
    }
    const res = await fetch('/api/account/payment-methods/setup-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: venueId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not start setup');
      return;
    }
    setSetup({ client_secret: data.client_secret, stripe_account_id: data.stripe_account_id });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Payment methods"
        subtitle="Cards are saved per venue on that venue’s Stripe Connect account (not platform-wide). Only venues where you have class credits, courses, or memberships appear below."
      />
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <label className="text-sm font-medium text-slate-800">Venue</label>
        <select
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={venueId}
          onChange={(e) => {
            const v = e.target.value;
            setVenueId(v);
            if (v) void loadMethods(v);
            else setMethods([]);
          }}
        >
          <option value="">Select…</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {venues.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No linked venues yet — book or buy credits at a venue first.</p>
        ) : null}
      </div>

      {venueId ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-900">Saved cards</h2>
          {methods.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No saved cards for this venue yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {methods.map((m) => (
                <li key={m.id}>
                  {m.brand ?? 'Card'} ·••• {m.last4}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => void startSetup()}
            className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Add card
          </button>
        </div>
      ) : null}

      {setup ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-900">Add card</h2>
          <Elements stripe={stripeForAccount(setup.stripe_account_id)} options={{ clientSecret: setup.client_secret, appearance: { theme: 'stripe' } }}>
            <SetupForm
              clientSecret={setup.client_secret}
              stripeAccountId={setup.stripe_account_id}
              onComplete={() => {
                setSetup(null);
                void loadMethods(venueId);
              }}
            />
          </Elements>
        </div>
      ) : null}
    </div>
  );
}
