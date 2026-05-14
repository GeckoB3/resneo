'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD } from '@/lib/booking-funds-copy';
import { readResponseJson } from '@/lib/http/read-response-json';

interface StripeConnectSectionProps {
  stripeAccountId: string | null;
  isAdmin: boolean;
  /**
   * When set, Stripe Connect return/refresh URLs use these paths (same-origin) instead of
   * Settings → Payments — e.g. onboarding so users return to the wizard after Stripe.
   */
  stripeAccountLinkPaths?: { return: string; refresh: string };
  /** When true, omit the inner "Stripe payments" title (parent page already explains the step). */
  hideSectionTitle?: boolean;
  onInitialLoadComplete?: () => void;
}

interface StripeStatus {
  connected: true;
  charges_enabled: boolean;
  details_submitted: boolean;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'not_connected' }
  | { kind: 'step1_pending'; accountId: string }
  | { kind: 'step2_pending'; accountId: string }
  | { kind: 'active'; accountId: string }
  | { kind: 'error'; message: string };

const CheckIcon = () => (
  <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

const PendingIcon = ({ active }: { active?: boolean }) => (
  <div className={`h-4 w-4 rounded-full border-2 ${active ? 'border-brand-600' : 'border-slate-300'}`}>
    {active && <div className="m-auto mt-0.5 h-1.5 w-1.5 rounded-full bg-brand-600" />}
  </div>
);

function StripeStepIndicator({ step1Done, step2Done }: { step1Done: boolean; step2Done: boolean }) {
  return (
    <div className="mb-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm">
            {step1Done ? <CheckIcon /> : <PendingIcon active={!step1Done} />}
          </div>
          <div className={`h-6 w-0.5 ${step1Done ? 'bg-green-300' : 'bg-slate-200'}`} />
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm">
            {step2Done ? <CheckIcon /> : <PendingIcon active={step1Done && !step2Done} />}
          </div>
        </div>
        <div className="flex-1 space-y-3 pt-0.5">
          <div>
            <p className={`text-sm font-medium ${step1Done ? 'text-green-700' : 'text-slate-800'}`}>
              Step 1: Business &amp; bank details
            </p>
            <p className="text-xs text-slate-500">
              {step1Done ? 'Completed' : 'Provide your business information and bank account details'}
            </p>
          </div>
          <div>
            <p className={`text-sm font-medium ${step2Done ? 'text-green-700' : step1Done ? 'text-slate-800' : 'text-slate-400'}`}>
              Step 2: Identity verification
            </p>
            <p className="text-xs text-slate-500">
              {step2Done
                ? 'Completed'
                : step1Done
                  ? 'Verify the identity of the account representative'
                  : 'Available after Step 1 is complete'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StripeConnectSection({
  stripeAccountId,
  isAdmin,
  stripeAccountLinkPaths,
  hideSectionTitle = false,
  onInitialLoadComplete,
}: StripeConnectSectionProps) {
  const [state, setState] = useState<ViewState>(
    stripeAccountId ? { kind: 'loading' } : { kind: 'not_connected' },
  );
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!stripeAccountId) {
      onInitialLoadComplete?.();
      return;
    }

    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/venue/stripe-connect');
        const body = await readResponseJson<StripeStatus & { error?: string }>(res);
        if (!res.ok) {
          if (!cancelled) setState({ kind: 'error', message: body.error ?? 'Failed to load status' });
          return;
        }
        const data = body;
        if (cancelled) return;

        if (data.charges_enabled && data.details_submitted) {
          setState({ kind: 'active', accountId: stripeAccountId! });
        } else if (data.details_submitted && !data.charges_enabled) {
          setState({ kind: 'step2_pending', accountId: stripeAccountId! });
        } else {
          setState({ kind: 'step1_pending', accountId: stripeAccountId! });
        }
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'Failed to check Stripe status' });
      } finally {
        if (!cancelled) onInitialLoadComplete?.();
      }
    }

    fetchStatus();
    return () => { cancelled = true; };
  }, [stripeAccountId, onInitialLoadComplete]);

  const startOnboarding = useCallback(async () => {
    setRedirecting(true);
    try {
      const res = await fetch('/api/venue/stripe-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          stripeAccountLinkPaths
            ? {
                return_path: stripeAccountLinkPaths.return,
                refresh_path: stripeAccountLinkPaths.refresh,
              }
            : {},
        ),
      });
      const body = await readResponseJson<{ error?: string; url?: string }>(res);
      if (!res.ok) {
        setState({ kind: 'error', message: body.error ?? 'Failed to start onboarding' });
        setRedirecting(false);
        return;
      }
      if (!body.url) {
        setState({ kind: 'error', message: 'Failed to start onboarding' });
        setRedirecting(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setState({ kind: 'error', message: 'Network error. Please try again.' });
      setRedirecting(false);
    }
  }, [stripeAccountLinkPaths]);

  return (
    <SectionCard elevated>
      {!hideSectionTitle ? <SectionCard.Header eyebrow="Payments" title="Stripe payments" /> : null}
      <SectionCard.Body>

      {state.kind === 'loading' && (
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-48 rounded bg-neutral-200" />
          <div className="h-4 w-32 rounded bg-neutral-200" />
        </div>
      )}

      {state.kind === 'not_connected' && (
        <div>
          {!hideSectionTitle ? (
            <p className="mb-4 text-sm text-neutral-600">
              Connect your Stripe account. {RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD} The setup is a two-step process:
            </p>
          ) : (
            <p className="mb-4 text-sm text-neutral-600">Two steps with Stripe: business and bank details, then identity verification.</p>
          )}
          <StripeStepIndicator step1Done={false} step2Done={false} />
          {isAdmin ? (
            <button
              onClick={startOnboarding}
              disabled={redirecting}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {redirecting ? 'Redirecting to Stripe…' : 'Start Stripe setup'}
            </button>
          ) : (
            <p className="text-sm text-neutral-500">Ask an admin to connect Stripe.</p>
          )}
        </div>
      )}

      {state.kind === 'step1_pending' && (
        <div>
          <StripeStepIndicator step1Done={false} step2Done={false} />
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800">Step 1 incomplete</p>
              <p className="text-sm text-amber-700">Please complete your business information and bank account details with Stripe.</p>
            </div>
          </div>
          {isAdmin ? (
            <button
              onClick={startOnboarding}
              disabled={redirecting}
              className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {redirecting ? 'Redirecting to Stripe…' : 'Continue Stripe setup'}
            </button>
          ) : (
            <p className="text-sm text-neutral-500">Ask an admin to complete Stripe setup.</p>
          )}
          <p className="mt-2 text-xs text-neutral-400">Account: {state.accountId}</p>
        </div>
      )}

      {state.kind === 'step2_pending' && (
        <div>
          <StripeStepIndicator step1Done={true} step2Done={false} />
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-800">Step 2: Identity verification required</p>
              <p className="text-sm text-blue-700 mt-1">
                Your business and bank details have been submitted. You now need to verify the identity of the account representative.
              </p>
              <p className="text-sm text-blue-600 mt-2">
                <strong>Note:</strong> It can take a few minutes for Stripe&apos;s verification system to be ready after completing Step 1.
                If the verification page is not yet available, please wait a moment and try again.
              </p>
            </div>
          </div>
          {isAdmin ? (
            <button
              onClick={startOnboarding}
              disabled={redirecting}
              className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {redirecting ? 'Redirecting to Stripe…' : 'Complete identity verification'}
            </button>
          ) : (
            <p className="text-sm text-neutral-500">Ask an admin to complete identity verification.</p>
          )}
          <p className="mt-2 text-xs text-neutral-400">Account: {state.accountId}</p>
        </div>
      )}

      {state.kind === 'active' && (
        <div>
          <StripeStepIndicator step1Done={true} step2Done={true} />
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="text-sm font-medium text-green-700">Stripe connected; charges enabled</span>
          </div>
          <p className="mt-2 text-xs text-neutral-400">Account: {state.accountId}</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div>
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{state.message}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Retry
          </button>
        </div>
      )}
      </SectionCard.Body>
    </SectionCard>
  );
}
