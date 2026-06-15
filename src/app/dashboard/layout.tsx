import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { requireDashboardIdentity } from '@/lib/auth/dashboard-session';
import { isPlatformSuperuserFromIdentity } from '@/lib/platform-auth';
import { getDashboardStaff, type ActiveSupportSessionContext } from '@/lib/venue-auth';
import { hasActiveVenueSupportSession } from '@/lib/support-session-server';
import { DashboardShell } from './DashboardShell';
import { Pill } from '@/components/ui/dashboard/Pill';
import { SessionTimeoutGuard } from '@/components/SessionTimeoutGuard';
import { BfcacheReloadGuard } from '@/components/BfcacheReloadGuard';
import { DashboardSWRProvider } from '@/components/providers/DashboardSWRProvider';
import { DashboardDetailCacheProvider } from '@/components/providers/DashboardDetailCacheProvider';
import { DashboardToolbarVenueProvider } from '@/components/dashboard/toolbar-guest-search/DashboardToolbarVenueProvider';
import { mergeVenueTerminology } from '@/lib/dashboard/merge-venue-terminology';
import {
  DashboardVenueBootstrapProvider,
  type DashboardVenueBootstrapValue,
} from '@/components/providers/DashboardVenueBootstrapProvider';
import type { OpeningHours } from '@/types/availability';
import {
  activeModelsToLegacyEnabledModels,
  appointmentPlanDefaultModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import type { BookingModel } from '@/types/booking-models';
import { APPOINTMENTS_LIGHT_PRICE } from '@/lib/pricing-constants';
import { SupportSessionControls } from '@/components/dashboard/SupportSessionControls';
import { StaffRebookBootstrapRouteCleanup } from '@/components/dashboard/StaffRebookBootstrapRouteCleanup';
import { isVenueSubscriptionExpiredCancelled } from '@/lib/billing/subscription-entitlement';
import { LinkedAccountBanner } from '@/components/linked-accounts/LinkedAccountBanner';
import { venueHasAcceptedLink } from '@/lib/linked-accounts/queries';
import { loadCollectiveBookingLinksForVenue } from '@/lib/linked-accounts/collectives';
import { WaitlistAvailabilityBanner } from '@/components/dashboard/waitlist/WaitlistAvailabilityBanner';
import { isRestaurantTableProductTier } from '@/lib/tier-enforcement';
import { DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS, parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags';
import { loadActiveAnnouncementsForUser, type ActiveAnnouncement } from '@/lib/platform/announcements';
import { PlatformAnnouncementBanners } from '@/components/dashboard/PlatformAnnouncementBanners';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { VenueFeatureFlagsProvider } from '@/components/providers/VenueFeatureFlagsProvider';
import type { ResolvedAppointmentsFeatureFlags } from '@/lib/feature-flags';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const identity = await requireDashboardIdentity(supabase, '/dashboard');

  if (isPlatformSuperuserFromIdentity(identity)) {
    const allowVenueShell = await hasActiveVenueSupportSession(supabase);
    if (!allowVenueShell) {
      redirect('/super');
    }
  }

  let email = identity.email ?? '';
  let supportSession: ActiveSupportSessionContext | undefined;
  let venueName: string | undefined;
  let venueSlug: string | undefined;
  let staffName: string | undefined;
  let tableManagementEnabled = false;
  let pricingTier = 'appointments';
  let bookingModel: BookingModel = 'table_reservation';
  let enabledModels: BookingModel[] = [];
  let venueId: string | undefined;
  let isAdmin = false;
  let hasLinkedAccounts = false;
  let collectiveBookingLinks: { id: string; name: string; url: string }[] = [];
  let planStatus: string = 'active';
  let subscriptionExpiredCancelled = false;
  let onboardingCompleted = true;
  let venueTerminology: Record<string, unknown> | null = null;
  let venueBootstrap: DashboardVenueBootstrapValue | null = null;
  let appointmentsFeatureFlags: ResolvedAppointmentsFeatureFlags =
    DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS;
  try {
    const staff = await getDashboardStaff(supabase);
    const admin = staff.db;
    const staffId = staff.id;
    const staffRole = staff.role;

    if (staff.support) {
      supportSession = staff.support;
      if (staff.email) {
        email = staff.email;
      }
    }

    if (!staff.venue_id) {
      if (isPlatformSuperuserFromIdentity(identity)) {
        redirect('/super');
      }
      redirect('/signup/business-type');
    }

    isAdmin = staffRole === 'admin';
    venueId = staff.venue_id ?? undefined;
    if (staffId) {
      const { data: selfRow } = await admin
        .from('staff')
        .select('name')
        .eq('id', staffId)
        .maybeSingle();
      staffName = selfRow?.name ?? undefined;
    }
    if (venueId) {
      const { data: venue } = await admin
        .from('venues')
        .select(
          'name, slug, table_management_enabled, booking_model, enabled_models, active_booking_models, plan_status, onboarding_completed, pricing_tier, terminology, timezone, currency, opening_hours, public_booking_area_mode, no_show_grace_minutes, billing_access_source, subscription_current_period_end, feature_flags',
        )
        .eq('id', venueId)
        .single();
      if (venue) {
        venueName = venue.name ?? undefined;
        venueSlug = venue.slug ?? undefined;
        tableManagementEnabled = venue.table_management_enabled ?? false;
        pricingTier = (venue.pricing_tier as string) ?? 'appointments';
        let activeModels = resolveActiveBookingModels({
          pricingTier,
          bookingModel: venue.booking_model as BookingModel | undefined,
          enabledModels: (venue as { enabled_models?: unknown }).enabled_models,
          activeBookingModels: (venue as { active_booking_models?: unknown }).active_booking_models,
        });
        onboardingCompleted = (venue.onboarding_completed as boolean) ?? true;
        if (
          isAppointmentPlanTier(pricingTier) &&
          activeModels.length === 0 &&
          onboardingCompleted
        ) {
          activeModels = appointmentPlanDefaultModels();
        }
        bookingModel = getDefaultBookingModelFromActive(
          activeModels,
          (venue.booking_model as BookingModel) ?? 'table_reservation',
        );
        enabledModels = activeModelsToLegacyEnabledModels(activeModels, bookingModel);
        appointmentsFeatureFlags = resolveAppointmentsFeatureFlags(
          parseVenueFeatureFlags((venue as { feature_flags?: unknown }).feature_flags),
        );
        planStatus = (venue.plan_status as string) ?? 'active';
        subscriptionExpiredCancelled = isVenueSubscriptionExpiredCancelled({
          plan_status: venue.plan_status as string | null,
          subscription_current_period_end: (venue as { subscription_current_period_end?: string | null })
            .subscription_current_period_end,
          billing_access_source: (venue as { billing_access_source?: string | null }).billing_access_source,
        });
        const rawTerms = (venue as { terminology?: unknown }).terminology;
        venueTerminology =
          rawTerms && typeof rawTerms === 'object' && rawTerms !== null && !Array.isArray(rawTerms)
            ? (rawTerms as Record<string, unknown>)
            : null;
        if (!onboardingCompleted) {
          redirect('/onboarding');
        }

        const tzRaw = (venue as { timezone?: string | null }).timezone;
        const tz = typeof tzRaw === 'string' && tzRaw.trim() !== '' ? tzRaw.trim() : 'Europe/London';
        const curRaw = (venue as { currency?: string | null }).currency;
        const currency = typeof curRaw === 'string' && curRaw.trim() !== '' ? curRaw.trim() : 'GBP';
        const oh = (venue as { opening_hours?: unknown }).opening_hours;
        const openingHours =
          oh && typeof oh === 'object' && !Array.isArray(oh) ? (oh as OpeningHours) : null;
        const pba = (venue as { public_booking_area_mode?: string | null }).public_booking_area_mode;
        const publicBookingAreaMode = pba === 'manual' ? 'manual' : 'auto';
        const nsg = (venue as { no_show_grace_minutes?: number | null }).no_show_grace_minutes;
        const noShowGraceMinutes =
          typeof nsg === 'number' && !Number.isNaN(nsg) && nsg >= 10 && nsg <= 60 ? nsg : 15;
        venueBootstrap = {
          timezone: tz,
          currency,
          openingHours,
          publicBookingAreaMode,
          noShowGraceMinutes,
        };
      } else {
        console.error('[dashboard/layout] Venue row missing for staff venue_id', { venueId });
      }
    }

    // The notification bell only surfaces for admins on appointment-type tiers, and
    // only when the venue is actually linked to another — skip the query otherwise.
    if (venueId && isAdmin && !isRestaurantTableProductTier(pricingTier)) {
      hasLinkedAccounts = await venueHasAcceptedLink(admin, venueId);
    }
    // Combined-page booking links for the sidebar (plan §23) — any staff sees them.
    if (venueId && !isRestaurantTableProductTier(pricingTier)) {
      collectiveBookingLinks = await loadCollectiveBookingLinksForVenue(admin, venueId);
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
  }

  let platformAnnouncements: ActiveAnnouncement[] = [];
  try {
    platformAnnouncements = await loadActiveAnnouncementsForUser(
      getSupabaseAdminClient(),
      identity.id,
    );
  } catch (e) {
    console.error('[dashboard/layout] announcements load failed:', e);
  }

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] overflow-hidden bg-slate-100">
      <DashboardShell
        venueId={venueId}
        initialTableManagementEnabled={tableManagementEnabled}
        initialAppointmentWaitlistEnabled={appointmentsFeatureFlags.waitlist_v2}
        supportSessionToolbar={
          supportSession ? (
            <SupportSessionControls expiresAtIso={supportSession.expiresAt} />
          ) : undefined
        }
        sidebarRest={{
          email,
          staffName,
          venueName,
          venueSlug,
          pricingTier,
          bookingModel,
          enabledModels,
          isAdmin,
          venueTerminology,
          complianceRecordsEnabled: appointmentsFeatureFlags.compliance_records_enabled,
          hasLinkedAccounts,
          collectiveBookingLinks,
        }}
      >
      <main className="dashboard-coarse-inputs min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain bg-slate-100/80 pt-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:pt-0">
        {isAdmin ? null : (
          <div className="sr-only" aria-hidden>
            Staff users do not have plan-management access.
          </div>
        )}
        {supportSession ? (
          <div className="border-b border-sky-300/90 bg-gradient-to-r from-sky-50 via-white to-sky-50/40 px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Pill variant="info" size="sm" className="mb-2 w-fit">
                  ResNeo support
                </Pill>
                <p className="text-sm font-medium text-slate-900">
                  ResNeo support ({supportSession.superuserDisplayName}) is currently signed in to your account
                  for troubleshooting. They can see your data and make changes.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Session reason on file: {supportSession.reason}
                </p>
              </div>
            </div>
          </div>
        ) : null}
        {subscriptionExpiredCancelled && planStatus !== 'past_due' && (
          <div className="border-b border-amber-200/80 bg-gradient-to-r from-amber-50 via-white to-amber-50/30 px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start">
                <Pill variant="warning" size="sm" className="w-fit shrink-0">
                  Subscription ended
                </Pill>
                <p className="min-w-0 text-sm text-amber-950">
                  Your subscription has ended. Editing and public online booking are paused until you resubscribe.
                </p>
              </div>
              {isAdmin ? (
                <a
                  href="/dashboard/settings?tab=plan"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-amber-800 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-amber-900 sm:w-auto sm:py-2 sm:text-xs"
                >
                  Resubscribe
                </a>
              ) : (
                <a
                  href="/dashboard/support"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-amber-800 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-amber-900 sm:w-auto sm:py-2 sm:text-xs"
                >
                  Contact admin
                </a>
              )}
            </div>
          </div>
        )}
        {planStatus === 'past_due' && (
          <div className="border-b border-rose-200/80 bg-gradient-to-r from-rose-50 via-white to-rose-50/30 px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start">
                <Pill variant="danger" size="sm" className="w-fit shrink-0">
                  Billing
                </Pill>
                <p className="min-w-0 text-sm text-rose-950">
                  {pricingTier === 'light'
                    ? `Your free period has ended. Add a payment method to continue using ResNeo at £${APPOINTMENTS_LIGHT_PRICE}/month. Your public booking page is paused until billing is active.`
                    : 'Your last payment failed. Please update your payment method to avoid service interruption.'}
                </p>
              </div>
              {isAdmin ? (
                <a
                  href="/dashboard/settings?tab=plan"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-rose-700 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-rose-800 sm:w-auto sm:py-2 sm:text-xs"
                >
                  {pricingTier === 'light' ? 'Add payment method' : 'Update billing'}
                </a>
              ) : (
                <a
                  href="/dashboard/support"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-rose-700 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-rose-800 sm:w-auto sm:py-2 sm:text-xs"
                >
                  Contact admin
                </a>
              )}
            </div>
          </div>
        )}
        <PlatformAnnouncementBanners announcements={platformAnnouncements} />
        {isAdmin && !isRestaurantTableProductTier(pricingTier) ? (
          <LinkedAccountBanner />
        ) : null}
        <WaitlistAvailabilityBanner />
        {venueId && !supportSession ? <SessionTimeoutGuard venueId={venueId} /> : null}
        <BfcacheReloadGuard />
        <StaffRebookBootstrapRouteCleanup />
        <VenueFeatureFlagsProvider flags={appointmentsFeatureFlags}>
        <DashboardVenueBootstrapProvider value={venueBootstrap}>
          <DashboardSWRProvider>
            <DashboardDetailCacheProvider>
              <DashboardToolbarVenueProvider
                value={
                  venueId && venueBootstrap
                    ? (() => {
                        const terminology = mergeVenueTerminology(bookingModel, venueTerminology);
                        return {
                          venueId,
                          bookingModel,
                          enabledModels,
                          currency: venueBootstrap.currency,
                          venueTimezone: venueBootstrap.timezone,
                          tableManagementEnabled,
                          isAdmin,
                          terminology,
                          clientLower: terminology.client.toLowerCase(),
                          clientWord: terminology.client,
                          bookingWord: terminology.booking,
                        };
                      })()
                    : null
                }
              >
                {children}
              </DashboardToolbarVenueProvider>
            </DashboardDetailCacheProvider>
          </DashboardSWRProvider>
        </DashboardVenueBootstrapProvider>
        </VenueFeatureFlagsProvider>
      </main>
      </DashboardShell>
    </div>
  );
}
