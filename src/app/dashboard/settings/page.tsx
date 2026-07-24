import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SettingsPageSkeleton, SettingsView } from './SettingsView';
import { StaffPersonalSettingsSection } from './sections/StaffPersonalSettingsSection';
import { getDashboardStaff } from '@/lib/venue-auth';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import {
  activeModelsToLegacyEnabledModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { DEFAULT_TERMINOLOGY } from '@/types/booking-models';
import { computeSmsMonthlyAllowance, updateVenueSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import type { VenueSettings } from './types';
import { backfillVenueEmailIfEmptyFromStaff } from '@/lib/venue-contact-email';
import { venueHasStripePaymentMethodForSms } from '@/lib/stripe/venue-customer-payment';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { countUnifiedCalendarColumns } from '@/lib/light-plan';
import { Suspense } from 'react';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import {
  getSmsMessagesSentThisMonthForVenue,
  reconcileSmsUsageFromLogsForVenue,
  resolveSmsBillingPeriod,
} from '@/lib/sms-usage';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags';
import { referralProgrammeEnabled } from '@/lib/referrals/constants';
import { loadReferralsDashboardForVenue } from '@/lib/referrals/load-dashboard';
import { loadVenueTrialBreakdown } from '@/lib/billing/trial-info';

function mergeVenueTerminology(model: BookingModel, raw: unknown): VenueTerminology {
  const base = DEFAULT_TERMINOLOGY[model];
  if (!raw || typeof raw !== 'object') return base;
  const t = raw as Partial<VenueTerminology>;
  return {
    client: typeof t.client === 'string' ? t.client : base.client,
    booking: typeof t.booking === 'string' ? t.booking : base.booking,
    staff: typeof t.staff === 'string' ? t.staff : base.staff,
  };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    upgraded?: string;
    downgraded?: string;
    resubscribed?: string;
    card_updated?: string;
    plan_changed?: string;
  }>;
}) {
  const supabase = await createClient();
  const staff = await getDashboardStaff(supabase);

  const venueId = staff.venue_id;
  if (!venueId || !staff.id) {
    return (
      <PageFrame maxWidthClass="max-w-lg">
        <SectionCard elevated>
          <SectionCard.Body className="py-10 text-center">
            <p className="text-slate-600">No venue linked to your account.</p>
          </SectionCard.Body>
        </SectionCard>
      </PageFrame>
    );
  }

  /** Staff users (all booking models): personal account only, not venue-wide configuration. */
  if (staff.role === 'staff') {
    return (
      <PageFrame maxWidthClass="max-w-3xl" className="space-y-6">
        <PageHeader
          eyebrow="Account"
          title="Account settings"
          subtitle="Update your name, email, phone, and password. Other venue settings are managed by an administrator."
        />
        <StaffPersonalSettingsSection />
      </PageFrame>
    );
  }

  if (staff.role !== 'admin') {
    redirect('/dashboard');
  }

  let venue = null;
  let hasServiceConfig = false;
  const { data: fullVenue, error: fullErr } = await staff.db
    .from('venues')
    .select('id, name, slug, address, phone, email, website_url, cover_photo_url, logo_url, cuisine_type, price_band, no_show_grace_minutes, kitchen_email, communication_templates, opening_hours, venue_opening_exceptions, booking_rules, deposit_config, availability_config, stripe_connected_account_id, timezone, table_management_enabled, combination_threshold, pricing_tier, plan_status, billing_access_source, free_access_granted_at, free_access_granted_by, free_access_reason, subscription_current_period_start, subscription_current_period_end, calendar_count, booking_model, enabled_models, active_booking_models, terminology, sms_monthly_allowance, stripe_subscription_id, created_at, require_account_login_for_bookings, in_person_payments_enabled, feature_flags, embed_accent_colour, booking_page_config')
    .eq('id', venueId)
    .single();

  if (fullVenue) {
    const activeCalendarCount = await countUnifiedCalendarColumns(staff.db, venueId);
    venue = {
      ...fullVenue,
      calendar_count: activeCalendarCount,
      venue_opening_exceptions: parseVenueOpeningExceptions(
        (fullVenue as { venue_opening_exceptions?: unknown }).venue_opening_exceptions,
      ),
    };
    const pt = ((fullVenue as { pricing_tier?: string | null }).pricing_tier ?? 'appointments') as string;
    const cc = activeCalendarCount;
    const expectedAllowance = computeSmsMonthlyAllowance(pt, cc);
    const stored = (fullVenue as { sms_monthly_allowance?: number | null }).sms_monthly_allowance;
    const storedCalendarCount = (fullVenue as { calendar_count?: number | null }).calendar_count ?? null;
    if (storedCalendarCount !== activeCalendarCount && venueId) {
      await staff.db.from('venues').update({ calendar_count: activeCalendarCount }).eq('id', venueId);
    }
    if (stored !== expectedAllowance && venueId) {
      await updateVenueSmsMonthlyAllowance(venueId);
      venue = { ...venue, sms_monthly_allowance: expectedAllowance };
    }
  } else {
    console.error('Settings page full venue query failed, trying basic columns:', fullErr?.message);
    const { data: basicVenue } = await staff.db
      .from('venues')
      .select('id, name, slug, address, phone, email, website_url, cover_photo_url, logo_url, opening_hours, booking_rules, deposit_config, availability_config, timezone, table_management_enabled, combination_threshold, booking_model, enabled_models, active_booking_models, pricing_tier, require_account_login_for_bookings')
      .eq('id', venueId)
      .single();
    if (basicVenue) {
      const activeModels = resolveActiveBookingModels({
        pricingTier: (basicVenue as { pricing_tier?: string | null }).pricing_tier,
        bookingModel: basicVenue.booking_model as BookingModel | undefined,
        enabledModels: (basicVenue as { enabled_models?: unknown }).enabled_models,
        activeBookingModels: (basicVenue as { active_booking_models?: unknown }).active_booking_models,
      });
      const bm = getDefaultBookingModelFromActive(
        activeModels,
        (basicVenue.booking_model as BookingModel) ?? 'table_reservation',
      );
      venue = {
        ...basicVenue,
        cuisine_type: null,
        price_band: null,
        no_show_grace_minutes: 15,
        kitchen_email: null,
        communication_templates: null,
        stripe_connected_account_id: null,
        table_management_enabled: basicVenue.table_management_enabled ?? false,
        combination_threshold: basicVenue.combination_threshold ?? 80,
        venue_opening_exceptions: [],
        booking_model: bm,
        active_booking_models: activeModels,
        enabled_models: activeModelsToLegacyEnabledModels(activeModels, bm),
      } as VenueSettings;
    }
  }

  if (venue) {
    const nextEmail = await backfillVenueEmailIfEmptyFromStaff(
      staff.db,
      venueId,
      (venue as { email?: string | null }).email,
      staff.email,
    );
    if (nextEmail) {
      venue = { ...(venue as object), email: nextEmail } as typeof venue;
    }
    const activeModels = resolveActiveBookingModels({
      pricingTier: (venue as { pricing_tier?: string | null }).pricing_tier,
      bookingModel: venue.booking_model as BookingModel | undefined,
      enabledModels: (venue as { enabled_models?: unknown }).enabled_models,
      activeBookingModels: (venue as { active_booking_models?: unknown }).active_booking_models,
    });
    const bm = getDefaultBookingModelFromActive(activeModels, (venue.booking_model as BookingModel) ?? 'table_reservation');
    const venueForModels = venue as VenueSettings;
    venue = {
      ...venueForModels,
      booking_model: bm,
      active_booking_models: activeModels,
      enabled_models: activeModelsToLegacyEnabledModels(activeModels, bm),
    };
  }
  const bookingModel = ((venue as Record<string, unknown>)?.booking_model as string) ?? 'table_reservation';
  if (venueId) {
    if (isUnifiedSchedulingVenue(bookingModel)) {
      const { count } = await staff.db
        .from('appointment_services')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .eq('is_active', true);
      hasServiceConfig = (count ?? 0) > 0;
    } else {
      const { count } = await staff.db
        .from('venue_services')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .eq('is_active', true);
      hasServiceConfig = (count ?? 0) > 0;
    }
  }

  const isAdmin = staff.role === 'admin';
  let smsMessagesSentThisMonth: number | null = null;
  let smsCountUsesStripePeriod = false;
  if (venueId && venue) {
    const venueForSms = venue as {
      pricing_tier?: string | null;
      subscription_current_period_start?: string | null;
      subscription_current_period_end?: string | null;
    };
    const smsPeriod = resolveSmsBillingPeriod(venueForSms);
    smsCountUsesStripePeriod = Boolean(smsPeriod.periodStartIso && smsPeriod.periodEndIso);
    await reconcileSmsUsageFromLogsForVenue(venueId);
    smsMessagesSentThisMonth = await getSmsMessagesSentThisMonthForVenue(venueId, venueForSms);
  }
  const sp = await searchParams;
  const { tab } = sp;
  let planCheckoutReturn: 'upgraded' | 'downgraded' | 'resubscribed' | 'card_updated' | 'plan_changed' | undefined;
  if (sp.upgraded === 'true') planCheckoutReturn = 'upgraded';
  else if (sp.downgraded === 'true') planCheckoutReturn = 'downgraded';
  else if (sp.resubscribed === 'true') planCheckoutReturn = 'resubscribed';
  else if (sp.plan_changed === '1' || sp.plan_changed === 'true') {
    planCheckoutReturn = 'plan_changed';
  }
  else if (sp.card_updated === '1' || sp.card_updated === 'true') {
    planCheckoutReturn = 'card_updated';
  }

  let initialLightHasPaymentMethod: boolean | undefined;
  if (venueId && venue && String((venue as { pricing_tier?: string | null }).pricing_tier ?? '').toLowerCase() === 'light') {
    initialLightHasPaymentMethod = await venueHasStripePaymentMethodForSms(venueId);
  }

  const publicBaseUrl = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);

  const featureFlagsRaw = parseVenueFeatureFlags(
    (venue as { feature_flags?: unknown } | null)?.feature_flags,
  );
  const featureFlagsResolved = resolveAppointmentsFeatureFlags(featureFlagsRaw);

  const bookingModelForReports = ((venue as { booking_model?: string } | null)?.booking_model ??
    'table_reservation') as BookingModel;
  const reportsContext =
    isAdmin && venueId
      ? {
          bookingModel: bookingModelForReports,
          terminology: mergeVenueTerminology(
            bookingModelForReports,
            (venue as { terminology?: unknown } | null)?.terminology,
          ),
          venueId,
          pricingTier: (venue as { pricing_tier?: string | null } | null)?.pricing_tier ?? null,
        }
      : null;

  const referralsProgrammeAvailable = isAdmin && referralProgrammeEnabled();
  const referralsDashboard =
    referralsProgrammeAvailable && venueId
      ? await loadReferralsDashboardForVenue(staff.db, venueId)
      : null;

  // Trial-window breakdown for the Plan tab — countdown + source (signup vs referral).
  // Only computed while the venue is trialing; otherwise null (Plan tab skips rendering).
  const trialBreakdown =
    venueId && venue
      ? await loadVenueTrialBreakdown(staff.db, {
          venueId,
          planStatus: (venue as { plan_status?: string | null }).plan_status ?? null,
          subscriptionCurrentPeriodStart:
            (venue as { subscription_current_period_start?: string | null }).subscription_current_period_start ??
            null,
          subscriptionCurrentPeriodEnd:
            (venue as { subscription_current_period_end?: string | null }).subscription_current_period_end ??
            null,
        })
      : null;

  return (
    <PageFrame maxWidthClass="max-w-5xl">
      <Suspense
        fallback={
          <SettingsPageSkeleton />
        }
      >
        <SettingsView
          initialVenue={
            venue
              ? { ...venue, sms_messages_sent_this_month: smsMessagesSentThisMonth }
              : null
          }
          isAdmin={isAdmin}
          initialTab={tab}
          planCheckoutReturn={planCheckoutReturn}
          hasServiceConfig={hasServiceConfig}
          bookingModel={bookingModel}
          smsCountUsesStripePeriod={smsCountUsesStripePeriod}
          initialLightHasPaymentMethod={initialLightHasPaymentMethod}
          publicBaseUrl={publicBaseUrl}
          initialFeatureFlagsRaw={featureFlagsRaw}
          initialFeatureFlagsResolved={featureFlagsResolved}
          reportsContext={reportsContext}
          referralsDashboard={referralsDashboard}
          referralsProgrammeAvailable={referralsProgrammeAvailable}
          trialBreakdown={trialBreakdown}
        />
      </Suspense>
    </PageFrame>
  );
}
