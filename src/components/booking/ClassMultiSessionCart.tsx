'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { VenuePublic } from './types';
import { classOfferingsUrl, bookingConfirmPaymentUrl } from '@/lib/booking/booking-flow-api';
import { RequireAuthModal } from '@/components/auth/RequireAuthModal';
import { createClient } from '@/lib/supabase/browser';
import { PaymentStep } from './PaymentStep';
import { type CardHoldPaymentMode } from './card-hold-copy';
import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';
import type { ClassOfferingCommerceCatalog } from '@/lib/class-commerce/enrich-class-offerings';

interface CartLine {
  class_instance_id: string;
  party_size: number;
  label: string;
}

interface InstanceRow {
  instance_id: string;
  class_name: string;
  instance_date: string;
  start_time: string;
  remaining: number;
}

interface PaymentSessionState {
  client_secret: string;
  stripe_account_id: string;
  primary_booking_id: string;
  total_amount_pence: number;
  /** Absent in setup mode (card hold: nothing is charged today). */
  checkout_charge_kind?: 'deposit' | 'full_payment';
  /** Card capture mode from the checkout response ('setup' = card hold, no payment today). */
  payment_mode?: CardHoldPaymentMode;
  card_hold_fee_pence?: number | null;
  card_hold_consent_text?: string | null;
  group_booking_id: string;
  total_party_size: number;
}

interface QuoteLine {
  class_instance_id: string;
  class_name: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  online_charge_pence: number;
  /** No-show fee the venue may charge later (card hold; nothing charged today). */
  card_hold_fee_pence?: number | null;
  ok: boolean;
  error?: string;
}

interface CartQuote {
  lines: QuoteLine[];
  total_online_charge_pence: number;
  /** Sum of the card-hold lines' no-show fees; null when no line holds a card. */
  card_hold_fee_pence?: number | null;
  all_ok: boolean;
}

/**
 * Multi-session class checkout (authenticated). Uses quote + checkout APIs.
 * Free-only carts complete immediately; paid carts open Stripe Elements on the venue Connect account.
 */
export function ClassMultiSessionCart({ venue }: { venue: VenuePublic }) {
  const pathname = usePathname() ?? '/book';
  const redirectTo = pathname;

  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quote, setQuote] = useState<unknown>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paymentSession, setPaymentSession] = useState<PaymentSessionState | null>(null);
  const [commerce, setCommerce] = useState<ClassOfferingCommerceCatalog | null>(null);

  const quoteSummary = quote as CartQuote | null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(classOfferingsUrl('public', venue.id));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load classes');
      const raw = (data.instances ?? []) as Record<string, unknown>[];
      setCommerce((data.commerce as ClassOfferingCommerceCatalog | undefined) ?? null);
      setInstances(
        raw
          .filter((r) => (r.remaining as number) > 0)
          .map((r) => ({
            instance_id: r.instance_id as string,
            class_name: r.class_name as string,
            instance_date: r.instance_date as string,
            start_time: (r.start_time as string).slice(0, 5),
            remaining: r.remaining as number,
          })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [venue.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const instanceOptions = useMemo(() => {
    return instances.filter((i) => !cart.some((c) => c.class_instance_id === i.instance_id));
  }, [instances, cart]);

  async function ensureUser(): Promise<boolean> {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setAuthOpen(true);
      return false;
    }
    return true;
  }

  async function runQuote() {
    setError(null);
    if (cart.length === 0) {
      setError('Add at least one session to the cart.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/booking/class-cart/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venue.id,
          lines: cart.map((c) => ({ class_instance_id: c.class_instance_id, party_size: c.party_size })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Quote failed');
      setQuote(data.quote ?? data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Quote failed');
    } finally {
      setBusy(false);
    }
  }

  const handlePaymentComplete = useCallback(async () => {
    if (!paymentSession) return;
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const guestEmail = auth.user?.email?.trim() ?? undefined;
      await fetch(bookingConfirmPaymentUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: paymentSession.primary_booking_id,
          ...(guestEmail ? { guest_email: guestEmail } : {}),
        }),
      });
    } catch {
      /* webhook fallback */
    }
    const savedCardOnly = paymentSession.payment_mode === 'setup';
    setPaymentSession(null);
    setCart([]);
    setQuote(null);
    setError(null);
    alert(
      savedCardOnly
        ? 'Card saved. No payment has been taken.'
        : 'Payment successful. Your class bookings are confirmed.',
    );
  }, [paymentSession]);

  async function runCheckout() {
    setError(null);
    if (!(await ensureUser())) return;
    setBusy(true);
    try {
      const totalParty = cart.reduce((s, c) => s + c.party_size, 0);
      const res = await fetch('/api/booking/class-cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venue.id,
          lines: cart.map((c) => ({ class_instance_id: c.class_instance_id, party_size: c.party_size })),
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (res.status === 401) {
        setAuthOpen(true);
        return;
      }
      if (!res.ok) throw new Error((data.error as string) ?? 'Checkout failed');

      const status = data.status as string | undefined;
      if (status === 'payment_required') {
        const cs = data.client_secret as string | null;
        if (!cs) throw new Error('Missing payment client secret');
        setPaymentSession({
          client_secret: cs,
          stripe_account_id: data.stripe_account_id as string,
          primary_booking_id: data.primary_booking_id as string,
          total_amount_pence: data.total_amount_pence as number,
          checkout_charge_kind: data.checkout_charge_kind as 'deposit' | 'full_payment' | undefined,
          payment_mode: (data.payment_mode as CardHoldPaymentMode | undefined) ?? 'payment',
          card_hold_fee_pence: (data.card_hold_fee_pence as number | null | undefined) ?? null,
          card_hold_consent_text: (data.card_hold_consent_text as string | null | undefined) ?? null,
          group_booking_id: data.group_booking_id as string,
          total_party_size: totalParty,
        });
        return;
      }

      setCart([]);
      setQuote(null);
      setError(null);
      alert(
        `Booked ${(data.booking_ids as string[] | undefined)?.length ?? 0} session(s). Reference group: ${(data.group_booking_id as string) ?? ''}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">Want to book multiple sessions?</h3>
      <p className="mt-1 text-sm text-slate-600">
        Use account checkout for baskets, packs, and saved purchases. Single classes above can still be booked as a guest.
      </p>

      {error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      {commerce && (commerce.credit_products.length > 0 || commerce.course_products.length > 0) ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Also at this venue</p>
          {commerce.viewer_credits_remaining != null ? (
            <p className="mt-2 text-slate-700">
              Your class credits here: <span className="font-semibold">{commerce.viewer_credits_remaining}</span>
            </p>
          ) : null}
          {commerce.credit_products.length > 0 ? (
            <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
              {commerce.credit_products.slice(0, 5).map((p) => (
                <li key={p.id}>
                  {p.name}: {p.credits_count} credits (£{(p.price_pence / 100).toFixed(2)})
                </li>
              ))}
            </ul>
          ) : null}
          {commerce.course_products.length > 0 ? (
            <p className="mt-2 text-xs text-slate-600">
              {commerce.course_products.length} course package{commerce.course_products.length === 1 ? '' : 's'}. See
              your account or venue for full enrollment.
            </p>
          ) : null}
        </div>
      ) : null}

      {paymentSession ? (
        <div className="mt-6">
          <p className="mb-3 text-sm text-slate-600">
            Complete payment for group <span className="font-mono text-xs">{paymentSession.group_booking_id}</span>
          </p>
          <PaymentStep
            clientSecret={paymentSession.client_secret}
            stripeAccountId={paymentSession.stripe_account_id}
            amountPence={paymentSession.total_amount_pence}
            partySize={Math.max(1, paymentSession.total_party_size)}
            onComplete={() => void handlePaymentComplete()}
            onBack={() => {
              setPaymentSession(null);
              setError(
                'Payment was not completed. Pending holds may still apply. Refresh the page or contact the venue if you need help.',
              );
            }}
            cancellationPolicy={undefined}
            summaryMode="total"
            chargeKind={paymentSession.checkout_charge_kind ?? 'deposit'}
            mode={paymentSession.payment_mode ?? 'payment'}
            cardHoldFeePence={paymentSession.card_hold_fee_pence}
            cardHoldConsentText={paymentSession.card_hold_consent_text}
            venueName={venue.name}
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add session</p>
              {loading ? (
                <p className="mt-2 text-sm text-slate-500">Loading…</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    id="multi-add-instance"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                    defaultValue=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const row = instances.find((i) => i.instance_id === id);
                      if (!row) return;
                      setCart((c) => [
                        ...c,
                        {
                          class_instance_id: row.instance_id,
                          party_size: 1,
                          label: `${row.class_name} · ${row.instance_date} ${row.start_time}`,
                        },
                      ]);
                      e.target.value = '';
                    }}
                  >
                    <option value="">Choose a session…</option>
                    {instanceOptions.map((i) => (
                      <option key={i.instance_id} value={i.instance_id}>
                        {i.class_name}: {i.instance_date} {i.start_time} ({i.remaining} left)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cart</p>
              {cart.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No sessions yet.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm text-slate-800">
                  {cart.map((line) => (
                    <li
                      key={line.class_instance_id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <span className="min-w-0 truncate">{line.label}</span>
                      <button
                        type="button"
                        className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                        onClick={() => setCart((c) => c.filter((x) => x.class_instance_id !== line.class_instance_id))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || cart.length === 0}
              onClick={() => void runQuote()}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Quote
            </button>
            <button
              type="button"
              disabled={busy || cart.length === 0}
              onClick={() => void runCheckout()}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              Checkout (sign in required)
            </button>
          </div>

          {quote ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Basket quote</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-800">
                {(quoteSummary?.lines ?? []).map((line) => (
                  <li key={line.class_instance_id} className="flex justify-between gap-3">
                    <span>
                      {line.class_name} · {line.booking_date} {line.booking_time} · {line.party_size} spot
                      {line.party_size !== 1 ? 's' : ''}
                      {!line.ok && line.error ? <span className="text-red-700"> · {line.error}</span> : null}
                      {line.ok && line.card_hold_fee_pence != null ? (
                        <span className="block text-xs text-slate-500">
                          No-show fee up to {formatCardHoldFeePence(line.card_hold_fee_pence)}. Nothing is charged
                          today.
                        </span>
                      ) : null}
                    </span>
                    <span className="font-semibold">£{(line.online_charge_pence / 100).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-900">
                <span>Due now</span>
                <span>£{((quoteSummary?.total_online_charge_pence ?? 0) / 100).toFixed(2)}</span>
              </div>
              {quoteSummary?.card_hold_fee_pence != null ? (
                <div className="mt-1.5 flex justify-between text-xs text-slate-600">
                  <span>No-show fee up to</span>
                  <span>{formatCardHoldFeePence(quoteSummary.card_hold_fee_pence)}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <RequireAuthModal open={authOpen} redirectTo={redirectTo} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
