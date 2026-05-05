'use client';

/**
 * Dashboard settings shell. For `unified_scheduling` venues, sections map broadly to plan §9.1:
 * business profile → ProfileSection / VenueProfileSection; opening hours & closures → Business Hours tab;
 * bookable calendars & staff → StaffSection;
 * services → `/dashboard/appointment-services` (linked from staff flow); communications →
 * CommunicationTemplatesSection + venue notification APIs; plan & billing → StripeConnectSection;
 * booking page URL/widgets → dashboard home / embed docs elsewhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { VenueSettings } from './types';
import { ProfileSection } from './sections/ProfileSection';
import { VenueProfileSection } from './sections/VenueProfileSection';
import { OpeningHoursSection } from './sections/OpeningHoursSection';
import { StaffSection } from './sections/StaffSection';
import { CommunicationTemplatesSection } from './sections/CommunicationTemplatesSection';
import { StripeConnectSection } from './sections/StripeConnectSection';
import { BookingTypesSection } from './sections/BookingTypesSection';
import { RequireAccountLoginSection } from './sections/RequireAccountLoginSection';
import { StaffPersonalSettingsSection } from './sections/StaffPersonalSettingsSection';
import { isAppointmentsProductVenue } from '@/lib/booking/unified-scheduling';
import { computeSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { isSuperuserFreeBillingAccess } from '@/lib/billing/billing-access-source';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  planDisplayName,
  RESTAURANT_PRICE,
  SMS_LIGHT_GBP_PER_MESSAGE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from '@/lib/subscription-cancellation-copy';
import { planCalendarLimit } from '@/lib/plan-limits';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';
import type { BookingModel } from '@/types/booking-models';
import { isRestaurantTableProductTier } from '@/lib/tier-enforcement';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { SettingsSaveProvider } from './SettingsSaveContext';
import { SettingsSaveStrip } from './SettingsSaveStrip';
import { SettingsProfileGroup } from './SettingsProfileGroup';
import { WidgetSection } from './widget/WidgetSection';
import { Skeleton } from '@/components/ui/Skeleton';
interface SettingsViewProps {
  initialVenue: VenueSettings | null;
  isAdmin: boolean;
  initialTab?: string;
  /** Set after Stripe checkout for plan changes (webhook may lag behind redirect). */
  planCheckoutReturn?: 'upgraded' | 'downgraded' | 'resubscribed' | 'card_updated' | 'plan_changed';
  hasServiceConfig?: boolean;
  bookingModel?: string;
  /** Light plan: SMS count matches Stripe subscription period (sms_log). */
  smsCountUsesStripePeriod?: boolean;
  /** Server: Stripe customer has invoice default payment method (Light plan). */
  initialLightHasPaymentMethod?: boolean;
  /** Normalized origin for embed / QR links (from `NEXT_PUBLIC_BASE_URL`). */
  publicBaseUrl: string;
}

const TABS = [
  {
    key: 'profile',
    label: 'Profile',
    description: 'Your account, venue details, booking models, and embeds for your public page.',
  },
  {
    key: 'business-hours',
    label: 'Business hours',
    description: 'Weekly opening hours and one-off closures or exceptions.',
  },
  {
    key: 'plan',
    label: 'Plan',
    description: 'Subscription tier, SMS allowance, upgrades, and cancellations.',
  },
  {
    key: 'payments',
    label: 'Payments',
    description: 'Stripe Connect for taking card payments from guests.',
  },
  {
    key: 'comms',
    label: 'Communications',
    description: 'Email and SMS templates, timing, and guest notification policies.',
  },
  {
    key: 'staff',
    label: 'Staff',
    description: 'Team logins, roles, calendar access, and session security.',
  },
  {
    key: 'data-import',
    label: 'Data import',
    description: 'CSV imports for clients and bookings with validation and undo.',
  },
] as const;

type TabKey = typeof TABS[number]['key'];
type SettingsWarmupKey = 'profile-account' | 'business-closures' | 'payments' | 'comms' | 'staff';

function resolveInitialTab(initialTab: string | undefined, isAdmin: boolean): TabKey {
  const t = initialTab as TabKey | undefined;
  if (t && TABS.some((x) => x.key === t)) {
    if (t === 'staff' && !isAdmin) return 'profile';
    if (t === 'data-import' && !isAdmin) return 'profile';
    return t;
  }
  return 'profile';
}

type LightPlanStatusPayload = {
  plan_status: string | null;
  stripe_subscription_id: string | null;
  has_default_payment_method: boolean;
  stripe_subscription_status: string | null;
  subscription_current_period_start: string | null;
  subscription_current_period_end: string | null;
};

type AppointmentsPlanStatusPayload = {
  pricing_tier: string | null;
  plan_status: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  subscription_current_period_start: string | null;
  subscription_current_period_end: string | null;
  calendar_count?: number | null;
};

type MoneyPayload = {
  amount_pence: number;
  currency: string;
  formatted: string;
};

type AppointmentsPlanPreviewPayload = {
  current_tier: string;
  target_tier: AppointmentsPlanTier;
  is_upgrade: boolean;
  proration_behavior: 'always_invoice' | 'create_prorations';
  amount_due: MoneyPayload;
  proration_total: MoneyPayload;
  total: MoneyPayload;
  subtotal: MoneyPayload;
  proration_lines: Array<MoneyPayload & { description: string | null }>;
};

type AppointmentsPlanTier = 'light' | 'plus' | 'appointments';

const APPOINTMENTS_PLAN_ORDER: Record<AppointmentsPlanTier, number> = {
  light: 0,
  plus: 1,
  appointments: 2,
};

const APPOINTMENTS_PLAN_DETAILS: Record<
  AppointmentsPlanTier,
  { price: number; calendars: string; team: string; sms: string }
> = {
  light: {
    price: APPOINTMENTS_LIGHT_PRICE,
    calendars: '1 bookable calendar',
    team: '1 team login',
    sms: `0 included SMS; pay-as-you-go SMS at £${SMS_LIGHT_GBP_PER_MESSAGE.toFixed(2)} each`,
  },
  plus: {
    price: APPOINTMENTS_PLUS_PRICE,
    calendars: 'Up to 5 bookable calendars',
    team: 'Up to 5 team logins',
    sms: '300 included SMS per month',
  },
  appointments: {
    price: APPOINTMENTS_PRO_PRICE,
    calendars: 'Unlimited bookable calendars',
    team: 'Unlimited team logins',
    sms: '800 included SMS per month',
  },
};

function isAppointmentsPlanTierValue(tier: string): tier is AppointmentsPlanTier {
  return tier === 'light' || tier === 'plus' || tier === 'appointments';
}

export function SettingsPageSkeleton({ tabCount = 8 }: { tabCount?: number }) {
  return (
    <div className="space-y-8" role="status" aria-label="Loading settings">
      <header className="space-y-5">
        <div className="space-y-2">
          <Skeleton.Line className="w-16" />
          <Skeleton.Line className="h-8 w-40" />
          <Skeleton.Line className="h-3 w-full max-w-2xl" />
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-1">
            {Array.from({ length: tabCount }).map((_, i) => (
              <Skeleton.Block key={i} className="h-10 w-24" />
            ))}
          </div>
          <Skeleton.Line className="h-3 w-full max-w-xl" />
        </div>
      </header>
      <SettingsTabSkeleton />
    </div>
  );
}

function SettingsTabSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading settings tab">
      <Skeleton.Card className="p-0">
        <div className="border-b border-slate-100/90 bg-gradient-to-r from-slate-50/80 to-white px-4 py-4 sm:px-6 sm:py-5">
          <Skeleton.Line className="w-24" />
          <Skeleton.Line className="mt-3 h-6 w-56" />
          <Skeleton.Line className="mt-3 h-3 w-full max-w-xl" />
        </div>
        <div className="space-y-4 px-4 py-5 sm:px-6 sm:py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton.Block className="h-11" />
            <Skeleton.Block className="h-11" />
          </div>
          <Skeleton.Block className="h-24" />
          <div className="flex flex-wrap gap-2">
            <Skeleton.Block className="h-10 w-28" />
            <Skeleton.Block className="h-10 w-32" />
          </div>
        </div>
      </Skeleton.Card>
      <Skeleton.Card>
        <div className="space-y-3">
          <Skeleton.Line className="h-5 w-44" />
          <Skeleton.Line className="w-full max-w-lg" />
          <Skeleton.Block className="h-20" />
        </div>
      </Skeleton.Card>
    </div>
  );
}

function formatSubscriptionDateLabel(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function planPriceLabel(pricingTier: string): string {
  if (pricingTier === 'light') return `£${APPOINTMENTS_LIGHT_PRICE}/month`;
  if (pricingTier === 'plus') return `£${APPOINTMENTS_PLUS_PRICE}/month`;
  if (pricingTier === 'appointments') return `£${APPOINTMENTS_PRO_PRICE}/month`;
  if (pricingTier === 'restaurant' || pricingTier === 'founding') return `£${RESTAURANT_PRICE}/month`;
  return `£${APPOINTMENTS_PRO_PRICE}/month`;
}

function PlanSection({
  venue,
  smsCountUsesStripePeriod = false,
  onVenueUpdate,
}: {
  venue: VenueSettings;
  smsCountUsesStripePeriod?: boolean;
  onVenueUpdate: (patch: Partial<VenueSettings>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [planPreviews, setPlanPreviews] = useState<Partial<Record<AppointmentsPlanTier, AppointmentsPlanPreviewPayload>>>({});
  const [selectedPlanChange, setSelectedPlanChange] = useState<AppointmentsPlanTier | null>(null);
  const planSuccessLoaded = useRef(false);

  const tier = venue.pricing_tier ?? 'appointments';
  const planStatus = venue.plan_status ?? 'active';
  const isFreeAccess = isSuperuserFreeBillingAccess(venue.billing_access_source);
  const isLight = tier === 'light';
  const appointmentsTier = isAppointmentsPlanTierValue(tier) ? tier : null;
  const isAppointmentsPlan = appointmentsTier !== null;
  const currentPlanDetails = appointmentsTier ? APPOINTMENTS_PLAN_DETAILS[appointmentsTier] : null;
  const tierLabel = planDisplayName(tier);
  const planPrice = planPriceLabel(tier);
  const periodEndLabel = formatSubscriptionDateLabel(venue.subscription_current_period_end);
  const periodStartLabel = formatSubscriptionDateLabel(venue.subscription_current_period_start);
  const nextBillingPrimaryLabel = isFreeAccess ? 'Free Access Granted' : periodEndLabel ?? 'Not available yet';
  const billingActive = planStatus === 'active' || planStatus === 'trialing';
  const isCancelling = planStatus === 'cancelling';
  const hasStripeSub = Boolean(venue.stripe_subscription_id?.trim());
  const smsUsed = venue.sms_messages_sent_this_month ?? 0;
  const smsIncludedMonthly = computeSmsMonthlyAllowance(tier, null);
  const smsUsagePercent =
    !isLight && smsIncludedMonthly > 0
      ? Math.max(0, Math.min(100, Math.round((smsUsed / smsIncludedMonthly) * 100)))
      : null;
  const calendarLimit = planCalendarLimit(tier);
  const calendarUsed = typeof venue.calendar_count === 'number' ? venue.calendar_count : null;
  const calendarUsagePercent =
    Number.isFinite(calendarLimit) && calendarUsed !== null && calendarLimit > 0
      ? Math.max(0, Math.min(100, Math.round((calendarUsed / calendarLimit) * 100)))
      : null;

  const applyLightStatus = useCallback(
    (data: LightPlanStatusPayload) => {
      onVenueUpdate({
        plan_status: data.plan_status ?? undefined,
        stripe_subscription_id: data.stripe_subscription_id,
        subscription_current_period_start: data.subscription_current_period_start ?? undefined,
        subscription_current_period_end: data.subscription_current_period_end ?? undefined,
      });
    },
    [onVenueUpdate],
  );

  const fetchLightPlanStatus = useCallback(async () => {
    const res = await fetch('/api/venue/light-plan/status');
    if (!res.ok) return;
    const data = (await res.json()) as LightPlanStatusPayload;
    applyLightStatus(data);
  }, [applyLightStatus]);

  useEffect(() => {
    if (!isLight || isFreeAccess) return;
    const t = window.setTimeout(() => void fetchLightPlanStatus(), 0);
    return () => clearTimeout(t);
  }, [isLight, isFreeAccess, fetchLightPlanStatus]);

  useEffect(() => {
    if (!isAppointmentsPlan || !appointmentsTier || !hasStripeSub || !billingActive || isCancelling) {
      return;
    }

    let cancelled = false;
    const targets = (Object.keys(APPOINTMENTS_PLAN_DETAILS) as AppointmentsPlanTier[]).filter(
      (targetTier) => targetTier !== appointmentsTier,
    );

    void (async () => {
      const entries = await Promise.all(
        targets.map(async (targetTier) => {
          try {
            const res = await fetch('/api/venue/appointments-plan/preview', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target_tier: targetTier }),
            });
            if (!res.ok) return [targetTier, null] as const;
            const data = (await res.json()) as AppointmentsPlanPreviewPayload;
            return [targetTier, data] as const;
          } catch {
            return [targetTier, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Partial<Record<AppointmentsPlanTier, AppointmentsPlanPreviewPayload>> = {};
      for (const [targetTier, preview] of entries) {
        if (preview) next[targetTier] = preview;
      }
      setPlanPreviews(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [appointmentsTier, billingActive, hasStripeSub, isAppointmentsPlan, isCancelling, planStatus]);

  useEffect(() => {
    if (planSuccessLoaded.current) return;
    planSuccessLoaded.current = true;
    try {
      const msg = sessionStorage.getItem('planSuccess');
      if (msg) {
        sessionStorage.removeItem('planSuccess');
        queueMicrotask(() => setPlanSuccess(msg));
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function openManageBilling() {
    setLoading(true);
    setActionError(null);
    try {
      const res = await fetch('/api/billing/portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setActionError(data.error || 'Could not open Stripe billing portal. Please try again.');
        return;
      }
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setActionError('Network error. Please check your connection and try again.');
    }
    setLoading(false);
  }

  async function handleAction(action: 'resume_subscription') {
    setLoading(true);
    setActionError(null);
    setPlanSuccess(null);
    try {
      const res = await fetch('/api/venue/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { redirect_url?: string; ok?: boolean; message?: string; error?: string };
      if (data.redirect_url) {
        window.location.assign(data.redirect_url);
        return;
      }
      if (data.ok) {
        if (typeof data.message === 'string' && data.message.length > 0) {
          try {
            sessionStorage.setItem('planSuccess', data.message);
          } catch {
            /* ignore */
          }
        }
        window.location.reload();
        return;
      }
      setActionError(data.error || 'Something went wrong. Please try again.');
    } catch {
      setActionError('Network error. Please check your connection and try again.');
    }
    setLoading(false);
  }

  async function changeAppointmentsPlan(targetTier: AppointmentsPlanTier) {
    setLoading(true);
    setActionError(null);
    setPlanSuccess(null);
    try {
      const res = await fetch('/api/venue/appointments-plan/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_tier: targetTier }),
      });
      const data = (await res.json()) as { ok?: boolean; redirect_url?: string; message?: string; error?: string };
      if (data.redirect_url) {
        window.location.assign(data.redirect_url);
        return;
      }
      if (data.ok) {
        if (typeof data.message === 'string' && data.message.length > 0) {
          try {
            sessionStorage.setItem('planSuccess', data.message);
          } catch {
            /* ignore */
          }
        }
        window.location.reload();
        return;
      }
      setActionError(data.error || 'Something went wrong. Please try again.');
    } catch {
      setActionError('Network error. Please check your connection and try again.');
    }
    setLoading(false);
  }

  const tierPillVariant: 'success' | 'brand' | 'neutral' =
    tier === 'founding' ? 'success' : tier === 'restaurant' ? 'brand' : 'neutral';
  const planPillVariant: 'success' | 'danger' | 'warning' | 'neutral' = billingActive
    ? 'success'
    : planStatus === 'past_due'
      ? 'danger'
      : planStatus === 'cancelling'
        ? 'warning'
        : 'neutral';
  const planPillLabel = billingActive
    ? 'Active'
    : planStatus === 'past_due'
      ? 'Payment due'
      : planStatus === 'cancelling'
        ? 'Cancelling'
        : planStatus === 'cancelled'
          ? 'Cancelled'
          : planStatus;
  const selectedPreview = selectedPlanChange ? planPreviews[selectedPlanChange] : undefined;
  const selectedPlanIsUpgrade =
    Boolean(selectedPlanChange && appointmentsTier) &&
    APPOINTMENTS_PLAN_ORDER[selectedPlanChange as AppointmentsPlanTier] >
      APPOINTMENTS_PLAN_ORDER[appointmentsTier as AppointmentsPlanTier];

  return (
    <SectionCard elevated>
      <SectionCard.Header eyebrow="Billing" title="Your plan" />
      <SectionCard.Body className="space-y-4">
      <p className="text-sm text-slate-600 leading-relaxed">
        {isFreeAccess ? (
          <>
            This venue has <strong className="font-medium text-slate-800">complimentary ReserveNI access</strong> (no
            subscription billing). Plan limits and SMS caps still apply.
          </>
        ) : (
          <>
            Manage plan changes here in ReserveNI. For billing administration (card details, invoices, receipts, billing
            address, and cancellation), use Stripe Customer Portal.
          </>
        )}
      </p>
      {!isFreeAccess ? (
        <p className="text-xs text-slate-600 leading-relaxed">{SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}</p>
      ) : null}
      {planSuccess ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2.5 text-sm text-emerald-950">
          <Pill variant="success" size="sm" dot>
            Update
          </Pill>
          <span>{planSuccess}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Pill variant={tierPillVariant}>{tierLabel}</Pill>
        <Pill variant={planPillVariant} size="sm" dot>
          {planPillLabel}
        </Pill>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Current plan</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{tierLabel}</p>
          <p className="text-xs text-slate-600">{planPrice}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Next billing</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{nextBillingPrimaryLabel}</p>
          {isFreeAccess ? (
            <p className="text-xs text-slate-600">No subscription charges. SMS is capped at your plan allowance.</p>
          ) : (
            <p className="text-xs text-slate-600">
              {planPrice} base charge{isLight ? '; SMS usage billed separately.' : '; metered overage may be added.'}
            </p>
          )}
          {!isFreeAccess && periodStartLabel ? (
            <p className="mt-1 text-xs text-slate-500">Current period: {periodStartLabel} – {periodEndLabel}</p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">SMS usage</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {smsUsed}
            {isLight ? ' segments used' : ` / ${smsIncludedMonthly} segments included`}
          </p>
          {isLight ? (
            <p className="mt-2 text-xs text-slate-600">
              {isFreeAccess
                ? 'Free access: outbound SMS is blocked once you reach your plan allowance (0 included on Light).'
                : `Light is pay-as-you-go at £${SMS_LIGHT_GBP_PER_MESSAGE.toFixed(2)} per Twilio segment.`}
            </p>
          ) : (
            <>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${smsUsagePercent ?? 0}%` }}
                  aria-hidden
                />
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {smsUsagePercent ?? 0}% of included allowance used.
                {isFreeAccess
                  ? ' Free access: no paid overage — sends stop at the cap.'
                  : ` Overage is £${SMS_OVERAGE_GBP_PER_MESSAGE.toFixed(2)} per Twilio segment.`}
              </p>
            </>
          )}
          {smsCountUsesStripePeriod ? (
            <p className="mt-1 text-xs text-slate-500">Usage window follows your Stripe billing period.</p>
          ) : null}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Calendar usage</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {calendarUsed ?? 'Not available'}
            {' / '}
            {Number.isFinite(calendarLimit) ? calendarLimit : 'Unlimited'}
          </p>
          {calendarUsagePercent !== null ? (
            <>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{ width: `${calendarUsagePercent}%` }}
                  aria-hidden
                />
              </div>
              <p className="mt-2 text-xs text-slate-600">{calendarUsagePercent}% of calendar limit used.</p>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-600">
              {Number.isFinite(calendarLimit)
                ? 'Calendar usage syncs after subscription updates.'
                : 'Your current plan has no calendar cap.'}
            </p>
          )}
        </div>
      </div>
      {!isFreeAccess ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void openManageBilling()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Manage Billing
          </button>
          <p className="text-xs text-slate-500">Opens Stripe Customer Portal in a new tab.</p>
        </div>
      ) : null}
      {planStatus === 'past_due' && hasStripeSub && periodEndLabel && !isFreeAccess ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-3 text-sm text-rose-950">
          <p className="font-semibold">Payment required</p>
          <p className="mt-1 leading-relaxed">
            Your last payment failed. Update your payment method in Stripe so invoicing can retry and keep your plan active.
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void openManageBilling()}
            className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
          >
            Update payment method
          </button>
        </div>
      ) : null}
      {currentPlanDetails ? (
        <p className="text-sm text-slate-600">
          {currentPlanDetails.calendars}, {currentPlanDetails.team}, {currentPlanDetails.sms}.
        </p>
      ) : null}
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}
      {isCancelling && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Plan ends</p>
          <p className="mt-1 text-amber-800">
            {periodEndLabel ? (
              <>
                Your subscription is cancelled, but you keep full access until{' '}
                <span className="font-semibold">{periodEndLabel}</span> (end of this billing period). Stripe will not
                charge again after that date.
              </>
            ) : (
              <>
                Your subscription is cancelled, but you keep full access until the end of your current billing period.
                Stripe will not charge again after that.
              </>
            )}
            {isLight ? <> On Appointments Light, SMS remains pay-as-you-go until then.</> : null}
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleAction('resume_subscription')}
            className="mt-3 rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
          >
            Keep my plan
          </button>
        </div>
      )}
      {isAppointmentsPlan && appointmentsTier && !isFreeAccess && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/80 px-3 py-3 text-sm text-brand-950">
          <p className="font-medium">Change Appointments plan</p>
          <p className="mt-1 text-brand-900">
            Move between Light, Plus, and Pro without starting a new checkout. We update your existing Stripe subscription
            and use the card already on file. Downgrades are available when your active calendars and team logins fit the
            target plan limits.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {(Object.keys(APPOINTMENTS_PLAN_DETAILS) as AppointmentsPlanTier[])
              .filter((targetTier) => targetTier !== appointmentsTier)
              .map((targetTier) => {
                const details = APPOINTMENTS_PLAN_DETAILS[targetTier];
                const isUpgrade = APPOINTMENTS_PLAN_ORDER[targetTier] > APPOINTMENTS_PLAN_ORDER[appointmentsTier];
                const disabled = loading || !hasStripeSub || isCancelling || planStatus === 'past_due' || planStatus === 'cancelled';
                const preview = disabled ? undefined : planPreviews[targetTier];
                return (
                  <div key={targetTier} className="rounded-xl border border-brand-100 bg-white/80 p-3">
                    <p className="font-medium text-brand-950">{planDisplayName(targetTier)}</p>
                    <p className="mt-1 text-xs text-brand-900">
                      &pound;{details.price}/month. {details.calendars}; {details.team}; {details.sms}.
                    </p>
                    <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
                      {preview ? (
                        isUpgrade ? (
                          <>
                            Pay the difference for the rest of this billing period:{' '}
                            <span className="font-semibold text-slate-950">{preview.amount_due.formatted}</span>{' '}
                            today.
                          </>
                        ) : (
                          <>
                            Credit for unused time on your current plan:{' '}
                            <span className="font-semibold text-slate-950">{preview.proration_total.formatted}</span>.
                          </>
                        )
                      ) : disabled ? (
                        <>Billing adjustment unavailable until this plan can be selected.</>
                      ) : (
                        <>Checking the estimated billing adjustment…</>
                      )}
                    </p>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setActionError(null);
                        setPlanSuccess(null);
                        setSelectedPlanChange(targetTier);
                      }}
                      className={`mt-2 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50 ${
                        isUpgrade
                          ? 'bg-brand-600 text-white hover:bg-brand-700'
                          : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                      }`}
                    >
                      {isUpgrade ? 'Upgrade' : 'Downgrade'} to {planDisplayName(targetTier).replace('Appointments ', '')}
                    </button>
                  </div>
                );
              })}
          </div>
          {selectedPlanChange ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-semibold">
                    Confirm {selectedPlanIsUpgrade ? 'upgrade' : 'downgrade'} to {planDisplayName(selectedPlanChange)}
                  </p>
                  <p className="text-amber-900">
                    This changes your existing subscription immediately. You do not need to go through the Stripe payment
                    portal because Stripe will use the card already saved for your subscription.
                  </p>
                  {selectedPreview ? (
                    selectedPlanIsUpgrade ? (
                      <p className="text-amber-900">
                        Because you are moving to a higher plan part-way through the month, Stripe will charge only the
                        difference for the remaining days in this billing period. Estimated amount due today:{' '}
                        <span className="font-semibold text-amber-950">{selectedPreview.amount_due.formatted}</span>.
                      </p>
                    ) : (
                      <p className="text-amber-900">
                        Because you are moving to a lower plan part-way through the month, Stripe will work out the unused
                        time on your current plan and apply it as credit on your subscription. Estimated credit:{' '}
                        <span className="font-semibold text-amber-950">{selectedPreview.proration_total.formatted}</span>.
                      </p>
                    )
                  ) : (
                    <p className="text-amber-900">
                      Stripe will calculate the exact billing adjustment when the change is confirmed.
                    </p>
                  )}
                  <p className="text-xs text-amber-800">
                    Your new plan limits and SMS allowance will apply as soon as the change is confirmed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPlanChange(null)}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void changeAppointmentsPlan(selectedPlanChange)}
                  className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  Confirm {selectedPlanIsUpgrade ? 'upgrade' : 'downgrade'}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setSelectedPlanChange(null)}
                  className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  Keep current plan
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      </SectionCard.Body>
    </SectionCard>
  );
}

function SettingsViewInner({
  initialVenue,
  isAdmin,
  initialTab,
  planCheckoutReturn,
  hasServiceConfig = false,
  bookingModel = 'table_reservation',
  smsCountUsesStripePeriod = false,
  publicBaseUrl,
}: SettingsViewProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '/dashboard/settings';
  const searchParams = useSearchParams();
  const [venue, setVenue] = useState<VenueSettings | null>(initialVenue);
  const isAppointmentsProduct = isAppointmentsProductVenue(venue?.pricing_tier ?? null);
  const [selectedTab, setSelectedTab] = useState<TabKey>(() => resolveInitialTab(initialTab, isAdmin));
  const [completedWarmup, setCompletedWarmup] = useState<Set<SettingsWarmupKey>>(() => new Set());
  const showRestaurantTableProfileSections =
    isAdmin && isRestaurantTableProductTier(venue?.pricing_tier ?? null);
  const visibleTabs = useMemo(
    () =>
      isAdmin ? [...TABS] : TABS.filter((x) => x.key !== 'data-import'),
    [isAdmin],
  );
  const tabBarTabs = useMemo(
    (): { id: TabKey; label: string; description?: string }[] =>
      visibleTabs.map((t) => ({ id: t.key, label: t.label, description: t.description })),
    [visibleTabs],
  );
  const activeTabFromUrl = useMemo(
    () => resolveInitialTab(searchParams.get('tab') ?? initialTab, isAdmin),
    [searchParams, initialTab, isAdmin],
  );
  const [planBannerDismissed, setPlanBannerDismissed] = useState(false);
  const warmupKeys = useMemo<SettingsWarmupKey[]>(() => {
    if (!venue) return [];
    const keys: SettingsWarmupKey[] = ['business-closures', 'comms'];
    if (isAppointmentsProduct && isAdmin) keys.push('profile-account');
    if (isAdmin) keys.push('staff');
    if (venue.stripe_connected_account_id) keys.push('payments');
    return keys;
  }, [isAdmin, isAppointmentsProduct, venue]);
  const settingsReady = venue ? warmupKeys.every((key) => completedWarmup.has(key)) : false;
  const markWarmupComplete = useCallback((key: SettingsWarmupKey) => {
    setCompletedWarmup((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);
  const markProfileWarmupComplete = useCallback(
    () => markWarmupComplete('profile-account'),
    [markWarmupComplete],
  );
  const markBusinessClosuresWarmupComplete = useCallback(
    () => markWarmupComplete('business-closures'),
    [markWarmupComplete],
  );
  const markPaymentsWarmupComplete = useCallback(
    () => markWarmupComplete('payments'),
    [markWarmupComplete],
  );
  const markCommsWarmupComplete = useCallback(
    () => markWarmupComplete('comms'),
    [markWarmupComplete],
  );
  const markStaffWarmupComplete = useCallback(
    () => markWarmupComplete('staff'),
    [markWarmupComplete],
  );

  const replaceWithTab = useCallback(
    (tab: TabKey) => {
      if (tab === selectedTab) return;
      setSelectedTab(tab);
      const p =
        typeof window === 'undefined'
          ? new URLSearchParams(searchParams.toString())
          : new URLSearchParams(window.location.search);
      p.set('tab', tab);
      const qs = p.toString();
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : `${pathname}?tab=${tab}`);
      }
    },
    [selectedTab, pathname, searchParams],
  );

  useEffect(() => {
    setVenue(initialVenue);
  }, [initialVenue]);

  useEffect(() => {
    setCompletedWarmup(new Set());
  }, [initialVenue?.id, isAdmin, bookingModel, venue?.pricing_tier]);

  useEffect(() => {
    setSelectedTab(activeTabFromUrl);
  }, [activeTabFromUrl]);

  /** Refresh Appointments plan row from Stripe after checkout (webhook may lag behind redirect). */
  useEffect(() => {
    const tier = String(venue?.pricing_tier ?? '').toLowerCase();
    if (!isAppointmentsPlanTierValue(tier) || !venue?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/appointments-plan/status');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as AppointmentsPlanStatusPayload;
        if (cancelled) return;
        setVenue((v) =>
          v
            ? {
                ...v,
                pricing_tier: data.pricing_tier ?? v.pricing_tier,
                plan_status: data.plan_status ?? v.plan_status,
                stripe_subscription_id: data.stripe_subscription_id ?? v.stripe_subscription_id,
                subscription_current_period_start:
                  data.subscription_current_period_start ?? v.subscription_current_period_start,
                subscription_current_period_end:
                  data.subscription_current_period_end ?? v.subscription_current_period_end,
                calendar_count: data.calendar_count ?? v.calendar_count,
              }
            : null,
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue?.id, venue?.pricing_tier]);

  useEffect(() => {
    if (!isAdmin) {
      const raw = searchParams.get('tab');
      if (raw === 'staff' || raw === 'data-import') {
        replaceWithTab('profile');
      }
    }
  }, [isAdmin, searchParams, replaceWithTab]);

  useEffect(() => {
    if (selectedTab !== 'profile') return;
    const timer = window.setTimeout(() => {
      if (typeof window === 'undefined') return;
      const hash = window.location.hash;
      if (hash === '#additional-booking-types') {
        document.getElementById('additional-booking-types')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      } else if (hash === '#booking-widget') {
        document.getElementById('booking-widget')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [selectedTab]);

  useEffect(() => {
    if (!planCheckoutReturn) return;
    setPlanBannerDismissed(false);
    setSelectedTab('plan');
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      p.set('tab', 'plan');
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }
    const delays = [400, 2500, 5000];
    const timeouts = delays.map((ms) => setTimeout(() => router.refresh(), ms));
    const cleanUrl = setTimeout(() => {
      router.replace(`${pathname}?tab=plan`, { scroll: false });
    }, 5200);
    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(cleanUrl);
    };
  }, [planCheckoutReturn, router, pathname]);

  const onUpdate = useCallback((patch: Partial<VenueSettings>) => {
    setVenue((v) => (v ? { ...v, ...patch } : null));
  }, []);

  const showPlanCheckoutBanner = Boolean(planCheckoutReturn) && !planBannerDismissed;
  const planBannerMessage =
    planCheckoutReturn === 'upgraded'
      ? 'Payment received. We are confirming your upgrade. The Plan tab will update in a few seconds. You can also refresh the page if it still shows your old plan.'
      : planCheckoutReturn === 'downgraded'
        ? 'We are confirming your plan change. Details on the Plan tab will update shortly.'
        : planCheckoutReturn === 'card_updated'
          ? 'Payment method updated. Stripe will retry any open invoices shortly.'
          : 'We are confirming your subscription. The Plan tab will update shortly.';

  if (!venue) {
    return (
      <SettingsPageSkeleton tabCount={isAdmin ? TABS.length : TABS.length - 2} />
    );
  }

  return (
    <>
      {!settingsReady ? <SettingsPageSkeleton tabCount={isAdmin ? TABS.length : TABS.length - 2} /> : null}
      <div className={settingsReady ? 'space-y-8' : 'hidden'}>
      <header className="space-y-5">
        <PageHeader
          eyebrow="Venue"
          title="Settings"
          subtitle="Manage your venue profile, hours, billing, payments, communications, and team. Simple fields save automatically; hours, staff invites, and Stripe actions use explicit saves."
        />
        <div className="space-y-3">
          <div className="overflow-x-auto pb-0.5">
            <TabBar tabs={tabBarTabs} value={selectedTab} onChange={(id) => replaceWithTab(id)} />
          </div>
          <SettingsSaveStrip />
        </div>
      </header>
      {showPlanCheckoutBanner && (
        <div className="flex flex-col gap-3 rounded-2xl border border-brand-200/80 bg-brand-50/80 px-4 py-3 text-sm text-brand-950 shadow-sm shadow-slate-900/5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start">
            <Pill variant="brand" size="sm" dot>
              Checkout
            </Pill>
            <p className="min-w-0 flex-1 leading-relaxed">{planBannerMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPlanBannerDismissed(true);
              router.replace(`${pathname}?tab=plan`, { scroll: false });
            }}
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100 sm:px-3 sm:py-2 sm:text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-10">
        <div className={selectedTab === 'profile' ? 'space-y-10' : 'hidden'} aria-hidden={selectedTab !== 'profile'}>
          {isAppointmentsProduct && isAdmin ? (
            <SettingsProfileGroup
              eyebrow="Your account"
              title="Personal details & security"
              description="Your display name, sign-in email, phone, and password apply only to your login. Venue-wide options are in the sections below."
            >
              <StaffPersonalSettingsSection onInitialLoadComplete={markProfileWarmupComplete} />
            </SettingsProfileGroup>
          ) : (
            <SettingsProfileGroup
              eyebrow="Your account"
              title="Personal profile"
              description="How you appear in the dashboard. Contact your administrator to change venue-wide settings."
            >
              <ProfileSection />
            </SettingsProfileGroup>
          )}

          <SettingsProfileGroup
            eyebrow="Business identity"
            title="Venue profile & public details"
            description="Business name, booking URL slug, address, contact channels, and cover image. These power your public booking page and guest communications."
          >
            <VenueProfileSection
              venue={venue}
              onUpdate={onUpdate}
              isAdmin={isAdmin}
              bookingModel={bookingModel}
              isAppointmentsProduct={isAppointmentsProduct}
            />
          </SettingsProfileGroup>

          <SettingsProfileGroup
            id="additional-booking-types"
            eyebrow="Booking types"
            title="Models on your public page"
            description="Choose which booking experiences are active for guests and which tools appear in your dashboard."
          >
            <BookingTypesSection venue={venue} onUpdate={onUpdate} isAdmin={isAdmin} />
            <RequireAccountLoginSection venue={venue} onUpdate={onUpdate} isAdmin={isAdmin} />
          </SettingsProfileGroup>

          {showRestaurantTableProfileSections && !isAppointmentsProduct && (
            <SettingsProfileGroup
              eyebrow="Dining"
              title="Table management & availability"
              description="Floor plan, table combinations, legacy availability, and related deposit options for restaurant service."
            >
              <SectionCard elevated>
                <SectionCard.Body className="space-y-2 text-sm text-slate-700">
                  <p>
                    Floor plan, table combinations, legacy availability, and related deposit options are under{' '}
                    <Link
                      href="/dashboard/availability?tab=table"
                      className="font-medium text-brand-600 underline hover:text-brand-700"
                    >
                      Dining Availability → Table Management
                    </Link>
                    .
                  </p>
                </SectionCard.Body>
              </SectionCard>
            </SettingsProfileGroup>
          )}

          <SettingsProfileGroup
            id="booking-widget"
            eyebrow="Public booking page"
            title="Widget, embed & QR"
            description="Share your booking page on your website with a snippet or printable QR code."
          >
            <SectionCard elevated>
              <SectionCard.Header
                eyebrow="Embeds"
                title="Booking widget & QR code"
                description="Copy the iframe snippet for your site and download a QR code that opens your public booking page."
              />
              <SectionCard.Body className="pt-0">
                <WidgetSection venueName={venue.name ?? 'Venue'} venueSlug={venue.slug} baseUrl={publicBaseUrl} />
              </SectionCard.Body>
            </SectionCard>
          </SettingsProfileGroup>
        </div>

        <div className={selectedTab === 'business-hours' ? '' : 'hidden'} aria-hidden={selectedTab !== 'business-hours'}>
          <OpeningHoursSection
            venue={venue}
            onUpdate={onUpdate}
            isAdmin={isAdmin}
            bookingModel={bookingModel ?? 'table_reservation'}
            onInitialLoadComplete={markBusinessClosuresWarmupComplete}
          />
        </div>

        <div className={selectedTab === 'plan' ? '' : 'hidden'} aria-hidden={selectedTab !== 'plan'}>
          <PlanSection
            key={`plan-${venue.id}-${venue.pricing_tier ?? ''}`}
            venue={venue}
            smsCountUsesStripePeriod={smsCountUsesStripePeriod}
            onVenueUpdate={onUpdate}
          />
        </div>

        <div className={selectedTab === 'payments' ? '' : 'hidden'} aria-hidden={selectedTab !== 'payments'}>
          <StripeConnectSection
            stripeAccountId={venue.stripe_connected_account_id}
            isAdmin={isAdmin}
            onInitialLoadComplete={markPaymentsWarmupComplete}
          />
        </div>

        <div className={selectedTab === 'comms' ? '' : 'hidden'} aria-hidden={selectedTab !== 'comms'}>
          <CommunicationTemplatesSection
            venue={venue}
            isAdmin={isAdmin}
            pricingTier={venue.pricing_tier ?? 'appointments'}
            bookingModel={bookingModel}
            enabledModels={normalizeEnabledModels(venue.enabled_models, (bookingModel as BookingModel) ?? 'table_reservation')}
            depositConfig={venue.deposit_config}
            serviceEngineTable={showRestaurantTableProfileSections && !isAppointmentsProduct && hasServiceConfig}
            hasStripeSubscription={Boolean(venue.stripe_subscription_id?.trim())}
            onInitialLoadComplete={markCommsWarmupComplete}
          />
        </div>

        {isAdmin ? (
          <div className={selectedTab === 'staff' ? '' : 'hidden'} aria-hidden={selectedTab !== 'staff'}>
            <StaffSection
              venueId={venue.id}
              isAdmin={isAdmin}
              bookingModel={bookingModel}
              enabledModels={normalizeEnabledModels(venue.enabled_models, (bookingModel as BookingModel) ?? 'table_reservation')}
              pricingTier={venue.pricing_tier ?? null}
              onInitialLoadComplete={markStaffWarmupComplete}
            />
          </div>
        ) : null}

        {isAdmin ? (
          <div className={selectedTab === 'data-import' ? '' : 'hidden'} aria-hidden={selectedTab !== 'data-import'}>
            <SectionCard elevated>
              <SectionCard.Header
                eyebrow="Operations"
                title="Data import"
                description="Import clients and bookings from CSV exports (Fresha, Booksy, Vagaro, ResDiary, and more). The tool runs column mapping, validation, and a reversible import with a 24-hour undo window."
              />
              <SectionCard.Body>
                <Link
                  href="/dashboard/import"
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
                >
                  Open Data Import
                </Link>
              </SectionCard.Body>
            </SectionCard>
          </div>
        ) : null}
      </div>
      </div>
    </>
  );
}

export function SettingsView(props: SettingsViewProps) {
  return (
    <SettingsSaveProvider>
      <SettingsViewInner {...props} />
    </SettingsSaveProvider>
  );
}
