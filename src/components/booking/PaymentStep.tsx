'use client';

import { useMemo, useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import { renderCardHoldConsentText } from '@/lib/booking/card-hold-terms';
import {
  CARD_HOLD_SETUP_HEADING,
  CARD_HOLD_SETUP_SUBHEADING,
  CARD_HOLD_SETUP_SUBMIT_LABEL,
  cardHoldPaymentWithSetupBodyText,
  cardHoldSetupBodyText,
  isCardHoldPaymentMode,
  type CardHoldPaymentMode,
} from './card-hold-copy';

interface PaymentStepProps {
  clientSecret: string;
  stripeAccountId?: string;
  amountPence: number;
  partySize: number;
  onComplete: () => void;
  onBack: () => void;
  cancellationPolicy?: string;
  /** Show total only (e.g. Model B fixed service deposit), not per-person split */
  summaryMode?: 'per_person' | 'total';
  /** Guest booking: distinguishes deposit vs pay-in-full wording */
  chargeKind?: 'deposit' | 'full_payment';
  /**
   * Card capture mode (card holds, design doc 7.3). `setup` confirms a SetupIntent and takes
   * no payment; `payment_with_setup` charges the amount and also stores the card.
   */
  mode?: CardHoldPaymentMode;
  /** No-show fee (pence) shown to the guest in the hold modes. */
  cardHoldFeePence?: number | null;
  /** Venue name for the card-hold consent and body copy. */
  venueName?: string;
  /**
   * The exact consent line the server snapshotted onto the hold
   * (`card_hold_consent_text` on the create/checkout response, §7.5). Shown
   * verbatim so the displayed text cannot drift from the stored dispute
   * evidence; the local render is only a fallback for older responses.
   */
  cardHoldConsentText?: string | null;
}

function PaymentForm({
  clientSecret,
  onComplete,
  onBack,
  payButtonLabel,
  mode,
  consentText,
}: {
  clientSecret: string;
  onComplete: () => void;
  onBack: () => void;
  payButtonLabel: string;
  mode: CardHoldPaymentMode;
  consentText: string | null;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failureFallback = mode === 'setup' ? 'Could not save your card' : 'Payment failed';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError(null);
    setLoading(true);
    try {
      // Required by Stripe Payment Element: collect and validate the payment
      // method details before calling confirmPayment / confirmSetup.
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message ?? 'Please check your payment details');
        setLoading(false);
        return;
      }

      const confirmOptions = {
        elements,
        clientSecret,
        confirmParams: {
          return_url: `${typeof window !== 'undefined' ? window.location.origin : ''}/pay/success`,
        },
        // Stay on page for standard cards; only redirect when required
        // (e.g. 3D Secure bank authentication flows).
        redirect: 'if_required',
      } as const;

      // Setup mode saves the card without taking a payment (SetupIntent secret);
      // both payment modes confirm a PaymentIntent.
      const { error: confirmError } =
        mode === 'setup'
          ? await stripe.confirmSetup(confirmOptions)
          : await stripe.confirmPayment(confirmOptions);
      if (confirmError) {
        setError(confirmError.message ?? failureFallback);
        setLoading(false);
        return;
      }
      // Succeeded without a redirect - advance to confirmation step.
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : failureFallback);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement options={{ layout: 'tabs' }} />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {consentText && (
        <p className="text-xs leading-relaxed text-slate-500">{consentText}</p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onBack} aria-label="Go back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <button
          type="submit"
          disabled={!stripe || loading}
          className="flex-1 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            {loading ? 'Processing…' : payButtonLabel}
          </span>
        </button>
      </div>
    </form>
  );
}

// Cache per-account Stripe instances to avoid re-loading on each render.
const stripeInstanceCache = new Map<string, Promise<Stripe | null>>();

function getStripeForAccount(stripeAccountId?: string): Promise<Stripe | null> {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  const cacheKey = stripeAccountId ?? '__platform__';
  if (!stripeInstanceCache.has(cacheKey)) {
    stripeInstanceCache.set(
      cacheKey,
      loadStripe(publishableKey, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined),
    );
  }
  return stripeInstanceCache.get(cacheKey)!;
}

export function PaymentStep({
  clientSecret,
  stripeAccountId,
  amountPence,
  partySize,
  onComplete,
  onBack,
  cancellationPolicy,
  summaryMode = 'per_person',
  chargeKind = 'deposit',
  mode = 'payment',
  cardHoldFeePence,
  venueName,
  cardHoldConsentText,
}: PaymentStepProps) {
  const amount = (amountPence / 100).toFixed(2);
  const perPerson = partySize > 0 ? (amountPence / 100 / partySize).toFixed(2) : amount;
  const stripePromise = useMemo(() => getStripeForAccount(stripeAccountId), [stripeAccountId]);
  const showSplit = summaryMode === 'per_person' && partySize > 1;
  const amountTitle = chargeKind === 'full_payment' ? 'Total due now' : 'Deposit required';
  const payButtonLabel =
    mode === 'setup'
      ? CARD_HOLD_SETUP_SUBMIT_LABEL
      : chargeKind === 'full_payment'
        ? 'Pay now'
        : 'Pay deposit';
  const holdMode = isCardHoldPaymentMode(mode);
  const holdFeePence = holdMode ? cardHoldFeePence ?? 0 : 0;
  const holdVenueName = venueName?.trim() || 'The venue';
  // Consent line above the submit button in both hold modes (design doc 7.3 / 7.5):
  // the server's snapshotted text when provided, so shown text and stored
  // dispute evidence cannot drift.
  const consentText =
    holdMode && holdFeePence > 0
      ? (cardHoldConsentText ?? renderCardHoldConsentText(holdVenueName, holdFeePence))
      : null;

  return (
    <div className="space-y-5">
      {mode === 'setup' ? (
        // Setup mode: no payment today, the card is stored for a possible no-show fee.
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-lg font-bold text-slate-900">{CARD_HOLD_SETUP_HEADING}</p>
          <p className="mt-1 text-sm font-medium text-slate-700">{CARD_HOLD_SETUP_SUBHEADING}</p>
          {holdFeePence > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {cardHoldSetupBodyText(holdVenueName, holdFeePence)}
            </p>
          )}
        </div>
      ) : (
        // Payment breakdown card (payment and payment_with_setup modes)
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className={`flex items-center gap-3 ${showSplit ? 'justify-between' : ''}`}>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">{amountTitle}</p>
              <p className="text-2xl font-bold text-slate-900">&pound;{amount}</p>
              {summaryMode === 'total' && partySize > 1 && (
                <p className="mt-1 text-xs text-slate-500">Total for {partySize} appointments</p>
              )}
            </div>
            {showSplit && (
              <div className="shrink-0 whitespace-nowrap text-right">
                <p className="text-xs text-slate-400">{partySize} &times; &pound;{perPerson}</p>
                <p className="text-xs text-slate-400">per person</p>
              </div>
            )}
          </div>
          {mode === 'payment_with_setup' && holdFeePence > 0 && (
            <p className="mt-2 border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-600">
              {cardHoldPaymentWithSetupBodyText(holdVenueName, holdFeePence)}
            </p>
          )}
        </div>
      )}

      {/* Legacy deposit refund copy is suppressed in the hold modes (design doc 7.3):
          the consent line above the submit button states the cancellation rule. */}
      {cancellationPolicy && !holdMode && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{cancellationPolicy}</div>
      )}

      {/* Trust indicators */}
      <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          {mode === 'setup' ? 'Card stored securely' : 'Secure payment'}
        </span>
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
          </svg>
          Powered by Stripe
        </span>
      </div>

      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#003B6F', borderRadius: '12px' } } }}>
        <PaymentForm
          clientSecret={clientSecret}
          onComplete={onComplete}
          onBack={onBack}
          payButtonLabel={payButtonLabel}
          mode={mode}
          consentText={consentText}
        />
      </Elements>
    </div>
  );
}
