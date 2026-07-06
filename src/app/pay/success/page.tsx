'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  bookingIdFromParams,
  redirectModeFromParams,
  redirectStatusFromParams,
  setupIntentIdFromParams,
} from './redirect-params';

function SuccessContent() {
  const searchParams = useSearchParams();
  const status = redirectStatusFromParams(searchParams.get('redirect_status'));
  const mode = redirectModeFromParams(searchParams);
  const bookingId = bookingIdFromParams(searchParams);
  const setupIntentId = setupIntentIdFromParams(searchParams);
  const confirmSent = useRef(false);

  // A 3DS-challenged card save redirects here without the /pay page's inline
  // confirm call ever running, so fire it best-effort on mount. The webhook
  // remains the guaranteed path; errors are swallowed silently. When the
  // return_url carried no booking_id, fall back to Stripe's own setup_intent
  // param: the confirm route resolves the hold's bookings from it.
  useEffect(() => {
    if (mode !== 'setup' || status !== 'succeeded' || confirmSent.current) return;
    const body = bookingId
      ? { booking_id: bookingId }
      : setupIntentId
        ? { setup_intent_id: setupIntentId }
        : null;
    if (!body) return;
    confirmSent.current = true;
    fetch('/api/booking/confirm-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      // Non-critical - webhook will handle if this fails.
    });
  }, [mode, status, bookingId, setupIntentId]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image src="/Logo.png" alt="ResNeo" width={140} height={42} className="h-10 w-auto" />
          </Link>
        </div>

        {status === 'succeeded' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            {mode === 'setup' ? (
              <>
                <h1 className="text-xl font-bold text-slate-900">Card saved</h1>
                <p className="mt-2 text-sm text-slate-600">
                  No payment has been taken. You&rsquo;ll get a confirmation by email or text shortly.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-slate-900">Deposit paid</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Your deposit has been received. You&rsquo;ll get a confirmation by email or text shortly.
                </p>
              </>
            )}
            <p className="mt-4 text-xs text-slate-400">
              Didn&rsquo;t receive a confirmation? Check your spam folder or contact the venue directly.
            </p>
          </div>
        )}

        {status === 'pending' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
              <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            {mode === 'setup' ? (
              <>
                <h1 className="text-xl font-bold text-slate-900">Almost done</h1>
                <p className="mt-2 text-sm text-slate-600">
                  We are confirming your card details. You&rsquo;ll receive a confirmation shortly.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-slate-900">Payment processing</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Your payment is being processed. This can take a few minutes for some payment methods.
                  You&rsquo;ll receive a confirmation once it clears.
                </p>
              </>
            )}
          </div>
        )}

        {status === 'failed' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <svg className="h-7 w-7 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            {mode === 'setup' ? (
              <>
                <h1 className="text-xl font-bold text-slate-900">Card not saved</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Your card details could not be saved, so your booking is not secured yet. Please go
                  back and try again, or use a different card.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-slate-900">Payment failed</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Your payment was not completed. Please go back and try again with a different card.
                </p>
              </>
            )}
            <button
              onClick={() => window.history.back()}
              className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Try again
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          Powered by{' '}
          <a href="https://www.resneo.com" className="hover:text-brand-600">ResNeo</a>
        </p>
      </div>
    </div>
  );
}

export default function PaySuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
