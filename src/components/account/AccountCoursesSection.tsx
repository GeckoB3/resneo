'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { Button, FormField } from '@/components/ui/primitives';

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
      <Button type="submit" disabled={!stripe} loading={loading}>
        {loading ? 'Processing…' : 'Pay and enroll'}
      </Button>
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
  const [error, setErrorState] = useState<string | null>(null);

  /** Announcing wrappers (P0-8); see the note in ProfileClient. */
  const { addToast } = useToast();
  const setError = useCallback(
    (m: string | null) => {
      setErrorState(m);
      if (m) addToast(m, 'error');
    },
    [addToast],
  );
  /**
   * In-flight guards (G30). All three call routes that create enrollments,
   * PaymentIntents or refunds, so a double tap was a double side effect.
   */
  const [enrolling, setEnrolling] = useState(false);
  const [startingPaid, setStartingPaid] = useState(false);
  const [cancellingEnrollment, setCancellingEnrollment] = useState<string | null>(null);
  const [msg, setMsgState] = useState<string | null>(null);
  const setMsg = useCallback(
    (m: string | null) => {
      setMsgState(m);
      if (m) addToast(m, 'success');
    },
    [addToast],
  );
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
  }, [deepLinkVenueId, setError]);

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

  /**
   * Enroll in an explicit venue and free course, defaulting to whatever the
   * form is showing. See the comment on the autostart effect for why the
   * arguments exist (P0-15, G25).
   */
  async function enrollFree(venueIdArg?: string, productIdArg?: string) {
    if (enrolling) return;
    setError(null);
    setMsg(null);
    const venue_id = venueIdArg || resolvedVenueId;
    const product_id = productIdArg || effectiveProductIdFree;
    if (!venue_id || !product_id) {
      setError('Choose a venue and a free (£0) course package.');
      return;
    }
    setEnrolling(true);
    try {
      const res = await fetch('/api/account/courses/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id, product_id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Enroll failed');
        return;
      }
      setMsg('Enrolled.');
      void load();
    } finally {
      setEnrolling(false);
    }
  }

  async function cancelEnrollment(id: string) {
    if (cancellingEnrollment) return;
    setError(null);
    setMsg(null);
    if (!window.confirm('Cancel this enrollment? If within the refund window your payment will be refunded.')) {
      return;
    }
    setCancellingEnrollment(id);
    try {
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
      setMsg(
        refunded > 0
          ? `Cancelled. Refund of £${(refunded / 100).toFixed(2)} is being processed.`
          : 'Cancelled.',
      );
      void load();
    } finally {
      setCancellingEnrollment(null);
    }
  }

  // Auto-start when arriving with ?venue=&course=&autostart=1.
  //
  // The venue and course are passed EXPLICITLY (P0-15, G25). They used not to
  // be: enrollFree() and startPaidCheckout() took no arguments and read the
  // state that the preselect effects above set in this same commit, so the
  // deferred call ran with the render's stale values and both fell through to
  // their fallbacks. A customer following a link to one venue's course was
  // charged for a different venue's, on that venue's Stripe Connect account.
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
        void enrollFree(deepLinkVenueId, deepLinkCourseId);
      } else {
        void startPaidCheckout(deepLinkVenueId, deepLinkCourseId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, deepLinkVenueId, deepLinkCourseId, purchaseCatalog.courses]);

  /**
   * Start payment for an explicit venue and paid course, defaulting to whatever
   * the form is showing.
   */
  async function startPaidCheckout(venueIdArg?: string, productIdArg?: string) {
    if (startingPaid) return;
    setError(null);
    setMsg(null);
    setPaidCheckout(null);
    const venue_id = venueIdArg || resolvedVenueId;
    const product_id = productIdArg || effectiveProductIdPaid;
    if (!venue_id || !product_id) {
      setError('Choose a venue and a paid course.');
      return;
    }
    // A course that is not at this venue would be charged on the wrong Stripe
    // Connect account, which is the whole failure this guard exists for.
    if (!purchaseCatalog.courses.some((c) => c.id === product_id && c.venue_id === venue_id)) {
      setError('That course is not available at this venue.');
      return;
    }
    setStartingPaid(true);
    try {
      const res = await fetch('/api/account/courses/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id, product_id }),
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
      venue_id,
      product_id,
        client_secret: data.client_secret,
        stripe_account_id: data.stripe_account_id,
        amount_pence: data.amount_pence ?? 0,
      });
    } finally {
      setStartingPaid(false);
    }
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
          <EmptyState size="compact" title="No enrollments yet" description="Courses you enroll in will appear here." />
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={cancellingEnrollment === e.id}
                      onClick={() => void cancelEnrollment(e.id)}
                      className="!border-amber-300 px-2 py-1 text-xs !text-amber-800 hover:!bg-amber-50"
                    >
                      Cancel enrollment
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {purchaseCatalog.venues.length === 0 ? (
        <EmptyState size="compact" title="No published course packages yet" description="When a venue publishes a course you can book, it will show up here." />
      ) : (
        <>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            {/*
              This was an EMPTY <label> wrapping the select, with the word
              "Venue" living in an <h2> above it, so the field had no
              accessible name at all: nothing to migrate, because it was never
              a label. FormField supplies a real one, which makes the heading
              redundant rather than duplicated.
            */}
            <FormField label="Venue" className="mt-1">
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
            </FormField>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-900">Free course</h2>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <FormField label="Package" className="min-w-0 flex-1">
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
              </FormField>
              <Button
                type="button"
                disabled={!effectiveProductIdFree}
                loading={enrolling}
                onClick={() => void enrollFree()}
              >
                Enroll free
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-900">Paid course</h2>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <FormField label="Package" className="min-w-0 flex-1">
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
                        {c.name} (£{(c.price_pence / 100).toFixed(2)})
                      </option>
                    ))
                  )}
                </select>
              </FormField>
              <Button
                type="button"
                disabled={!effectiveProductIdPaid}
                loading={startingPaid}
                onClick={() => void startPaidCheckout()}
                className="!bg-slate-900 hover:!bg-slate-800 disabled:!bg-slate-400"
              >
                Pay with card
              </Button>
            </div>

            {paidCheckout ? (
              <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">
                  Total: £{(paidCheckout.amount_pence / 100).toFixed(2)}. Complete payment to confirm your enrollment.
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
