'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

interface EnrollmentRow {
  id: string;
  venue_id: string;
  course_product_id: string;
  status: string;
  first_session_date: string | null;
  cancel_by_date: string | null;
  can_cancel_now: boolean;
}

interface CatalogCourse {
  id: string;
  name: string;
  venue_id: string;
  price_pence: number;
  currency: string;
}

function CoursePurchaseForm({
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
        await fetch('/api/account/courses/fulfill', {
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
        {loading ? 'Processing…' : 'Pay and enroll'}
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

export function AccountCoursesSection() {
  const searchParams = useSearchParams();
  const deepLinkVenueId = searchParams?.get('venue') ?? null;
  const deepLinkCourseId = searchParams?.get('course') ?? null;
  const autostart = searchParams?.get('autostart') === '1';
  const autoStartedRef = useRef(false);

  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string; venue_id: string; price_pence: number }>>([]);
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [purchaseCatalog, setPurchaseCatalog] = useState<{
    venues: Array<{ id: string; name: string }>;
    courses: CatalogCourse[];
  }>({ venues: [], courses: [] });
  const [venueId, setVenueId] = useState('');
  const [productIdFree, setProductIdFree] = useState('');
  const [productIdPaid, setProductIdPaid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [paidCheckout, setPaidCheckout] = useState<{
    venue_id: string;
    product_id: string;
    client_secret: string;
    stripe_account_id: string;
    amount_pence: number;
  } | null>(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    setError(null);
    const qs = deepLinkVenueId ? `?venue=${encodeURIComponent(deepLinkVenueId)}` : '';
    const res = await fetch(`/api/account/courses${qs}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not load');
      return;
    }
    setEnrollments((data.enrollments ?? []) as EnrollmentRow[]);
    setProducts((data.products ?? []) as Array<{ id: string; name: string; venue_id: string; price_pence: number }>);
    setVenues((data.venues ?? []) as Array<{ id: string; name: string }>);
    const pc = (data as { purchase_catalog?: { venues?: unknown[]; courses?: unknown[] } }).purchase_catalog;
    setPurchaseCatalog({
      venues: (pc?.venues ?? []) as Array<{ id: string; name: string }>,
      courses: (pc?.courses ?? []) as CatalogCourse[],
    });
  }, [deepLinkVenueId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id.slice(0, 8);
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Course';

  // Preselect venue/course from deep-link query.
  useEffect(() => {
    if (deepLinkVenueId && purchaseCatalog.venues.some((v) => v.id === deepLinkVenueId)) {
      setVenueId(deepLinkVenueId);
    }
  }, [deepLinkVenueId, purchaseCatalog.venues]);
  useEffect(() => {
    if (!deepLinkCourseId) return;
    const course = purchaseCatalog.courses.find((c) => c.id === deepLinkCourseId);
    if (!course) return;
    if (course.price_pence === 0) setProductIdFree(course.id);
    else setProductIdPaid(course.id);
  }, [deepLinkCourseId, purchaseCatalog.courses]);

  const resolvedVenueId = venueId || purchaseCatalog.venues[0]?.id || '';

  const courseChoicesFree = useMemo(
    () => purchaseCatalog.courses.filter((c) => c.venue_id === resolvedVenueId && c.price_pence === 0),
    [purchaseCatalog.courses, resolvedVenueId],
  );

  const courseChoicesPaid = useMemo(
    () => purchaseCatalog.courses.filter((c) => c.venue_id === resolvedVenueId && c.price_pence > 0),
    [purchaseCatalog.courses, resolvedVenueId],
  );

  const firstFreeId = courseChoicesFree[0]?.id ?? '';
  const firstPaidId = courseChoicesPaid[0]?.id ?? '';
  const effectiveProductIdFree =
    productIdFree && courseChoicesFree.some((c) => c.id === productIdFree) ? productIdFree : firstFreeId;
  const effectiveProductIdPaid =
    productIdPaid && courseChoicesPaid.some((c) => c.id === productIdPaid) ? productIdPaid : firstPaidId;

  async function enrollFree() {
    setError(null);
    setMsg(null);
    if (!resolvedVenueId || !effectiveProductIdFree) {
      setError('Choose a venue and a free (£0) course package.');
      return;
    }
    const res = await fetch('/api/account/courses/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: resolvedVenueId, product_id: effectiveProductIdFree }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Enroll failed');
      return;
    }
    setMsg('Enrolled.');
    void load();
  }

  async function cancelEnrollment(id: string) {
    setError(null);
    setMsg(null);
    if (!window.confirm('Cancel this enrollment? If within the refund window your payment will be refunded.')) {
      return;
    }
    const res = await fetch('/api/account/courses/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollment_id: id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Cancel failed');
      return;
    }
    const refunded = (data as { refund_amount_pence?: number }).refund_amount_pence ?? 0;
    setMsg(refunded > 0 ? `Cancelled. Refund of £${(refunded / 100).toFixed(2)} is being processed.` : 'Cancelled.');
    void load();
  }

  // Auto-start when arriving with ?venue=&course=&autostart=1 — deferred out of
  // the effect body so the setState cascade inside enrollFree/startPaidCheckout
  // runs after this render commits.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!autostart || !deepLinkVenueId || !deepLinkCourseId) return;
    const course = purchaseCatalog.courses.find(
      (c) => c.id === deepLinkCourseId && c.venue_id === deepLinkVenueId,
    );
    if (!course) return;
    autoStartedRef.current = true;
    queueMicrotask(() => {
      if (course.price_pence === 0) {
        void enrollFree();
      } else {
        void startPaidCheckout();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, deepLinkVenueId, deepLinkCourseId, purchaseCatalog.courses]);

  async function startPaidCheckout() {
    setError(null);
    setMsg(null);
    setPaidCheckout(null);
    if (!resolvedVenueId || !effectiveProductIdPaid) {
      setError('Choose a venue and a paid course.');
      return;
    }
    const res = await fetch('/api/account/courses/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: resolvedVenueId, product_id: effectiveProductIdPaid }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Checkout failed');
      return;
    }
    if (!data.client_secret || !data.stripe_account_id) {
      setError('Could not start payment');
      return;
    }
    setPaidCheckout({
      venue_id: resolvedVenueId,
      product_id: effectiveProductIdPaid,
      client_secret: data.client_secret,
      stripe_account_id: data.stripe_account_id,
      amount_pence: data.amount_pence ?? 0,
    });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Courses"
        subtitle="Enroll in free course packages instantly, or pay for paid courses with your card (processed on the venue’s Stripe account)."
      />
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      {msg ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg}</div> : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Enrollments</h2>
        {enrollments.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {enrollments.map((e) => {
              const active = e.status === 'active';
              return (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{productName(e.course_product_id)}</div>
                    <div className="text-xs text-slate-600">
                      {venueName(e.venue_id)} · {e.status}
                      {e.first_session_date ? ` · starts ${e.first_session_date}` : ''}
                    </div>
                    {active ? (
                      <div className="mt-0.5 text-xs text-slate-500">
                        {e.cancel_by_date == null
                          ? 'This course is non-refundable.'
                          : e.can_cancel_now
                            ? `You can cancel for a full refund until ${e.cancel_by_date}.`
                            : 'Past the cancellation window. Contact the venue.'}
                      </div>
                    ) : null}
                  </div>
                  {active && e.can_cancel_now ? (
                    <button
                      type="button"
                      onClick={() => void cancelEnrollment(e.id)}
                      className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                    >
                      Cancel enrollment
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {purchaseCatalog.venues.length === 0 ? (
        <p className="text-sm text-slate-500">No published course packages yet.</p>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-900">Venue</h2>
            <label className="mt-3 block text-xs text-slate-600">
              <select
                value={resolvedVenueId}
                onChange={(e) => {
                  setVenueId(e.target.value);
                  setProductIdFree('');
                  setProductIdPaid('');
                }}
                className="mt-1 w-full max-w-md rounded border border-slate-300 px-2 py-2 text-sm"
              >
                {purchaseCatalog.venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-900">Free course</h2>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-xs text-slate-600">
                Package
                <select
                  value={effectiveProductIdFree}
                  onChange={(e) => setProductIdFree(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                >
                  {courseChoicesFree.length === 0 ? (
                    <option value="">No free courses at this venue</option>
                  ) : (
                    courseChoicesFree.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                type="button"
                disabled={!effectiveProductIdFree}
                onClick={() => void enrollFree()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Enroll free
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-900">Paid course</h2>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-xs text-slate-600">
                Package
                <select
                  value={effectiveProductIdPaid}
                  onChange={(e) => setProductIdPaid(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                >
                  {courseChoicesPaid.length === 0 ? (
                    <option value="">No paid courses at this venue</option>
                  ) : (
                    courseChoicesPaid.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — £{(c.price_pence / 100).toFixed(2)}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                type="button"
                disabled={!effectiveProductIdPaid}
                onClick={() => void startPaidCheckout()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Pay with card
              </button>
            </div>

            {paidCheckout ? (
              <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">
                  Total: £{(paidCheckout.amount_pence / 100).toFixed(2)} — complete payment to confirm your enrollment.
                </p>
                <Elements
                  stripe={stripeForAccount(paidCheckout.stripe_account_id)}
                  options={{
                    clientSecret: paidCheckout.client_secret,
                    appearance: { theme: 'stripe' },
                  }}
                >
                  <CoursePurchaseForm
                    clientSecret={paidCheckout.client_secret}
                    stripeAccountId={paidCheckout.stripe_account_id}
                    onDone={() => {
                      setPaidCheckout(null);
                      setMsg('Enrollment confirmed.');
                      void load();
                    }}
                  />
                </Elements>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
