'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import Image from 'next/image';
import { isDepositRefundAvailableAt } from '@/lib/booking/cancellation-deadline';
import { renderCardHoldConsentText, formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';

const stripeCache = new Map<string, Promise<Stripe | null>>();

function getStripeForAccount(stripeAccountId?: string): Promise<Stripe | null> {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  const cacheKey = stripeAccountId ?? '__platform__';
  if (!stripeCache.has(cacheKey)) {
    stripeCache.set(cacheKey, loadStripe(key, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined));
  }
  return stripeCache.get(cacheKey)!;
}

type PayMode = 'payment' | 'setup';

interface BookingInfo {
  booking_id: string;
  payment_mode: PayMode;
  venue_name: string;
  venue_address: string | null;
  booking_date: string;
  booking_time: string;
  party_size: number;
  deposit_amount_pence: number | null;
  card_hold_fee_pence: number | null;
  card_hold_consent_text: string | null;
  guest_name: string;
  guest_email: string;
  refund_cutoff: string | null;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.slice(0, 5).split(':').map(Number);
    const ampm = (h ?? 0) >= 12 ? 'pm' : 'am';
    const h12 = (h ?? 0) % 12 || 12;
    return `${h12}:${String(m ?? 0).padStart(2, '0')}${ampm}`;
  } catch {
    return timeStr;
  }
}

function formatRefundCutoff(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${day} at ${time}`;
  } catch {
    return iso;
  }
}

function BookingDetailsCard({ info }: { info: BookingInfo }) {
  const deposit = info.deposit_amount_pence ? (info.deposit_amount_pence / 100).toFixed(2) : null;
  const isSetup = info.payment_mode === 'setup';
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
      <h3 className="text-sm font-semibold text-slate-800">{info.venue_name}</h3>
      <div className="grid gap-1.5 text-sm text-slate-600">
        <div className="flex items-center gap-2">
          <span className="text-base">&#128197;</span>
          <span>{formatDate(info.booking_date)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base">&#128336;</span>
          <span>{formatTime(info.booking_time)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base">&#128101;</span>
          <span>{info.party_size} guest{info.party_size !== 1 ? 's' : ''}</span>
        </div>
        {info.venue_address && (
          <div className="flex items-start gap-2">
            <span className="text-base">&#128205;</span>
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.venue_address)}`} target="_blank" rel="noopener noreferrer" className="min-w-0 break-words text-brand-600 hover:underline">{info.venue_address}</a>
          </div>
        )}
      </div>
      {isSetup ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
          <span className="font-semibold">No payment is taken today.</span>{' '}
          No-show fee of up to {formatCardHoldFeePence(info.card_hold_fee_pence ?? 0)} if you do not attend.
        </div>
      ) : (
        deposit && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <span className="font-semibold">Deposit required: &pound;{deposit}</span>
          </div>
        )
      )}
    </div>
  );
}

function RefundPolicy({ refundCutoff }: { refundCutoff: string | null }) {
  const body = (() => {
    if (refundCutoff) {
      if (isDepositRefundAvailableAt(refundCutoff)) {
        return (
          <>
            Your deposit is fully refundable if you cancel before <strong>{formatRefundCutoff(refundCutoff)}</strong>. After this time, the deposit is non-refundable. Deposits are non-refundable for no-shows.
          </>
        );
      }
      return (
        <>
          Under this venue&apos;s policy, the time by which you needed to cancel for a full deposit refund has already passed. Your deposit is not refundable if you cancel. Deposits are non-refundable for no-shows.
        </>
      );
    }
    return (
      <>
        Deposit refund rules are set by the venue (typically based on how far in advance you cancel). Check your booking confirmation for the exact refund deadline. Deposits are non-refundable for no-shows.
      </>
    );
  })();

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 leading-relaxed">
      <span className="font-semibold">Refund policy:</span> {body}
    </div>
  );
}

/**
 * The exact consent line (spec 7.5), rendered verbatim above the save button.
 * Prefers the stored terms snapshot text (the dispute evidence the accepted_at
 * stamp attaches to); the re-render from live venue name and fee is only a
 * fallback for holds created before the snapshot carried text.
 */
function CardHoldConsent({
  venueName,
  feePence,
  consentText,
}: {
  venueName: string;
  feePence: number;
  consentText: string | null;
}) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 leading-relaxed">
      {consentText ?? renderCardHoldConsentText(venueName, feePence)}
    </div>
  );
}

function PayForm({
  mode,
  clientSecret,
  bookingId,
  email,
  onEmailChange,
  onSuccess,
}: {
  mode: PayMode;
  clientSecret: string;
  bookingId: string;
  email: string;
  onEmailChange: (v: string) => void;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isSetup = mode === 'setup';
  const confirmFallbackError = isSetup ? 'Card could not be saved' : 'Payment failed';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    if (!stripe || !elements) return;
    if (!emailValid) {
      setError('Please enter a valid email address');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message ?? 'Please check your payment details');
        setLoading(false);
        return;
      }

      // booking_id rides along in the return_url so /pay/success can run the
      // best-effort confirm after a 3DS redirect (Stripe appends its own params).
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const returnUrl = `${origin}/pay/success?booking_id=${encodeURIComponent(bookingId)}`;

      const { error: confirmError } = isSetup
        ? await stripe.confirmSetup({
            elements,
            clientSecret,
            confirmParams: {
              return_url: returnUrl,
            },
            redirect: 'if_required',
          })
        : await stripe.confirmPayment({
            elements,
            clientSecret,
            confirmParams: {
              return_url: returnUrl,
              receipt_email: email.trim(),
            },
            redirect: 'if_required',
          });
      if (confirmError) {
        setError(confirmError.message ?? confirmFallbackError);
        setLoading(false);
        return;
      }

      try {
        await fetch('/api/booking/confirm-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: bookingId, guest_email: email.trim() }),
        });
      } catch {
        // Non-critical - webhook will handle if this fails.
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : confirmFallbackError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="pay-email" className="mb-1.5 block text-sm font-medium text-slate-700">
          Email address <span className="text-red-500">*</span>
        </label>
        <input
          id="pay-email"
          type="email"
          required
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          placeholder="your@email.com"
          className={`min-h-[44px] w-full rounded-xl border bg-white px-3.5 py-3 text-sm transition-colors focus:outline-none focus:ring-2 ${
            emailTouched && !emailValid
              ? 'border-red-300 focus:border-red-400 focus:ring-red-500/20'
              : 'border-slate-200 focus:border-brand-500 focus:ring-brand-500/20'
          }`}
        />
        {emailTouched && !emailValid && (
          <p className="mt-1 text-xs text-red-500">Please enter a valid email so we can send your confirmation</p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          We&rsquo;ll send your {isSetup ? 'booking' : 'deposit'} confirmation to this address
        </p>
      </div>

      <PaymentElement options={{ layout: 'tabs' }} />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Processing…' : isSetup ? 'Save card' : 'Pay deposit'}
      </button>
    </form>
  );
}

function PayContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('t');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | undefined>(undefined);
  const [bookingInfo, setBookingInfo] = useState<BookingInfo | null>(null);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'success' | 'error'>(() =>
    token ? 'loading' : 'error',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(() =>
    !token ? 'This link is not valid. Please open the link from your email or text message again.' : null,
  );

  useEffect(() => {
    if (!token) return;
    fetch(`/api/booking/pay?t=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok)
          return r
            .json()
            .then((j) =>
              Promise.reject(
                new Error(j.error ?? 'Something went wrong loading this link. Please try again.'),
              ),
            );
        return r.json();
      })
      .then((data) => {
        setClientSecret(data.client_secret);
        setStripeAccountId(data.stripe_account_id);
        setBookingInfo({
          booking_id: data.booking_id,
          payment_mode: data.payment_mode === 'setup' ? 'setup' : 'payment',
          venue_name: data.venue_name ?? '',
          venue_address: data.venue_address ?? null,
          booking_date: data.booking_date ?? '',
          booking_time: data.booking_time ?? '',
          party_size: data.party_size ?? 0,
          deposit_amount_pence: data.deposit_amount_pence ?? null,
          card_hold_fee_pence: data.card_hold_fee_pence ?? null,
          card_hold_consent_text: data.card_hold_consent_text ?? null,
          guest_name: data.guest_name ?? '',
          guest_email: data.guest_email ?? '',
          refund_cutoff: data.refund_cutoff ?? null,
        });
        if (data.guest_email) setEmail(data.guest_email);
        setStatus('ready');
      })
      .catch((e) => {
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : 'Invalid or expired link');
      });
  }, [token]);

  const onSuccess = useCallback(() => {
    setStatus('success');
  }, []);

  const stripePromise = useMemo(() => getStripeForAccount(stripeAccountId), [stripeAccountId]);

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <Image src="/Logo.png" alt="ResNeo" width={120} height={36} className="mx-auto mb-8 h-8 w-auto" />
          <div className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-red-600">{errorMsg}</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    const isSetup = bookingInfo?.payment_mode === 'setup';
    const deposit = bookingInfo?.deposit_amount_pence ? (bookingInfo.deposit_amount_pence / 100).toFixed(2) : null;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <Image src="/Logo.png" alt="ResNeo" width={120} height={36} className="mx-auto mb-8 h-8 w-auto" />
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-5">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            {isSetup ? (
              <div>
                <h2 className="text-xl font-bold text-slate-900">Card saved</h2>
                <p className="mt-1 text-sm text-slate-500">Your booking is confirmed. No payment has been taken.</p>
              </div>
            ) : (
              <div>
                <h2 className="text-xl font-bold text-slate-900">Deposit paid</h2>
                {deposit && <p className="mt-1 text-sm text-slate-500">&pound;{deposit} received</p>}
              </div>
            )}
            {email && (
              <p className="text-sm text-slate-600">
                A confirmation email has been sent to <strong className="text-slate-800">{email}</strong>
              </p>
            )}
            {bookingInfo && (
              <div className="text-left">
                <BookingDetailsCard info={bookingInfo} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'loading' || !clientSecret || !bookingInfo) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const isSetup = bookingInfo.payment_mode === 'setup';

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-md space-y-5">
        <Image src="/Logo.png" alt="ResNeo" width={120} height={36} className="h-8 w-auto" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {isSetup ? 'Secure your booking' : 'Pay your deposit'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {isSetup
                ? `Hi ${bookingInfo.guest_name || 'there'}, save your card to confirm your booking.`
                : `Hi ${bookingInfo.guest_name || 'there'}, please pay your deposit to confirm your booking.`}
            </p>
          </div>

          <BookingDetailsCard info={bookingInfo} />
          {isSetup ? (
            <CardHoldConsent
              venueName={bookingInfo.venue_name}
              feePence={bookingInfo.card_hold_fee_pence ?? 0}
              consentText={bookingInfo.card_hold_consent_text}
            />
          ) : (
            <RefundPolicy refundCutoff={bookingInfo.refund_cutoff} />
          )}

          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: { theme: 'stripe', variables: { colorPrimary: '#003B6F', borderRadius: '12px' } },
            }}
          >
            <PayForm
              mode={bookingInfo.payment_mode}
              clientSecret={clientSecret}
              bookingId={bookingInfo.booking_id}
              email={email}
              onEmailChange={setEmail}
              onSuccess={onSuccess}
            />
          </Elements>
        </div>
        <p className="text-center text-xs text-slate-400">
          Powered by <a href="https://www.resneo.com" className="hover:text-brand-600">ResNeo</a>
        </p>
      </div>
    </div>
  );
}

export default function PayPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        </div>
      }
    >
      <PayContent />
    </Suspense>
  );
}
