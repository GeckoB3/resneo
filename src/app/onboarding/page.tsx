'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BookingModel } from '@/types/booking-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';
import { buildAddress, parseAddress } from '@/lib/venue/address-format';
import { slugFromBusinessNameOrFallback } from '@/lib/venue/slug-from-business-name';
import { resolvePreviewCatalogState } from '@/lib/venue/onboarding-preview-catalog';
import {
  type AppointmentPlanModel,
  buildAppointmentsPlanModelSteps,
  buildCatalogueAppointmentsPlanSteps,
  buildGenericNonRestaurantOnboardingSteps,
  buildLegacyAppointmentsPlanModelSteps,
  buildLegacyGenericNonRestaurantOnboardingSteps,
  buildRestaurantOnboardingSteps,
  isAppointmentPlanModel,
  migrateOnboardingStepToCurrentLayout,
  unifiedTeamStepLabel,
} from '@/lib/venue/onboarding-steps';
import { defaultCalendarWorkingHoursFromOpeningHours } from '@/lib/availability/opening-hours-to-working-hours';
import { isDefaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import type { WorkingHours } from '@/types/booking-models';
import type { OpeningHoursSettings } from '@/app/dashboard/settings/types';
import { OpeningHoursControl, defaultOpeningHoursSettings } from '@/components/scheduling/OpeningHoursControl';
import { WorkingHoursControl } from '@/components/scheduling/WorkingHoursControl';
import { OnboardingStaffInviteStep, type StaffInviteDraft } from '@/components/onboarding/OnboardingStaffInviteStep';
import { StripeConnectSection } from '@/app/dashboard/settings/sections/StripeConnectSection';
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from '@/lib/booking-funds-copy';
import { AppointmentsWelcomeStep } from '@/components/onboarding/AppointmentsWelcomeStep';
import { AppointmentsDashboardStep } from '@/components/onboarding/AppointmentsDashboardStep';
import { WelcomeStep as RestaurantWelcomeStep } from './steps/restaurant/WelcomeStep';
import { OpeningHoursStep } from './steps/restaurant/OpeningHoursStep';
import { ServicesStep } from './steps/restaurant/ServicesStep';
import { TableModeStep } from './steps/restaurant/TableModeStep';
import { TableSetupStep } from './steps/restaurant/TableSetupStep';
import { DashboardOrientationStep } from './steps/restaurant/DashboardOrientationStep';
import { useCalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import { isAppointmentPlanTier, isPlusPlanTier } from '@/lib/tier-enforcement';
import { planDisplayName } from '@/lib/pricing-constants';
import { isValidWebsiteUrlInput } from '@/lib/urls/website-url';
import { ONBOARDING_CARD_PADDING_CLASS } from '@/lib/onboarding/layout-constants';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';

type Currency = 'GBP' | 'EUR';

const CURRENCY_OPTIONS: { code: Currency; symbol: string; label: string }[] = [
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
];

interface VenueOnboarding {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  booking_model: BookingModel;
  active_booking_models?: BookingModel[] | null;
  /** Secondary C/D/E models; onboarding wizard stays primary-first - full setup for add-ons is on the dashboard checklist. */
  enabled_models?: BookingModel[] | null;
  business_type: string | null;
  terminology: { client: string; booking: string; staff: string };
  pricing_tier: string;
  calendar_count: number | null;
  onboarding_step: number;
  onboarding_completed: boolean;
  /** When true, `onboarding_step` uses the unified appointments wizard (Stripe near the end). */
  appointments_onboarding_unified_flow?: boolean;
  /** When true, `onboarding_step` uses the lean wizard (no catalogue or Stripe steps). */
  appointments_onboarding_lean_flow?: boolean;
  currency: Currency;
  stripe_connected_account_id: string | null;
  /** True when the signed-in user is a venue admin (only admins can run Stripe Connect). */
  is_admin: boolean;
}

interface PractitionerDraft {
  name: string;
  email: string;
}


const APPOINTMENTS_MODEL_LABEL: Record<AppointmentPlanModel, string> = {
  unified_scheduling: 'Appointments',
  class_session: 'Classes',
  event_ticket: 'Events',
  resource_booking: 'Bookable resources',
};

/** Roster GET is cached for 5 minutes; onboarding must always see calendars saved on the prior step. */
function fetchOnboardingPractitioners(options?: { roster?: boolean }): Promise<Response> {
  const params = new URLSearchParams();
  if (options?.roster) params.set('roster', '1');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetch(`/api/venue/practitioners${suffix}`, { cache: 'no-store' });
}

function onboardingRosterFromPractitioners(
  practitioners: Array<{ id: string; name: string; calendar_type?: string | null }> | undefined,
): Array<{ id: string; name: string }> {
  return (practitioners ?? [])
    .filter((p) => (p.calendar_type ?? 'practitioner') !== 'resource')
    .map((p) => ({ id: p.id, name: p.name }));
}

export default function OnboardingPage() {
  const router = useRouter();
  const [venue, setVenue] = useState<VenueOnboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [maxCompletedStep, setMaxCompletedStep] = useState(0);
  const stripeReturnStatusRef = useRef<string | null | undefined>(undefined);
  const handledStripeReturnRef = useRef(false);
  if (stripeReturnStatusRef.current === undefined && typeof window !== 'undefined') {
    stripeReturnStatusRef.current = new URLSearchParams(window.location.search).get('stripe');
  }
  /** Step index the user navigated back to; forces save on Continue instead of skipping persistence. */
  const [revisitedStepIndex, setRevisitedStepIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { entitlement } = useCalendarEntitlement(Boolean(venue?.is_admin));

  // Step 1: Business profile (address fields match Settings → Venue profile)
  const [name, setName] = useState('');
  const [addressName, setAddressName] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressTown, setAddressTown] = useState('');
  const [addressPostcode, setAddressPostcode] = useState('');
  const [phone, setPhone] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessWebsiteUrl, setBusinessWebsiteUrl] = useState('');
  const [currency, setCurrency] = useState<Currency>('GBP');

  // Model B: Practitioners + services
  const [practitioners, setPractitioners] = useState<PractitionerDraft[]>([{ name: '', email: '' }]);
  /** Unified onboarding: calendar roster for service assignment + hours step */
  const [rosterList, setRosterList] = useState<Array<{ id: string; name: string }>>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [openingHoursDraft, setOpeningHoursDraft] = useState<OpeningHoursSettings>(() => defaultOpeningHoursSettings());
  const [calendarWorkingDraft, setCalendarWorkingDraft] = useState<Record<string, WorkingHours>>({});

  /** Restaurant plan: tracks simple vs advanced table management (drives dynamic step list). */
  const [tableManagementEnabled, setTableManagementEnabled] = useState(false);

  useEffect(() => {
    if (!venue || venue.booking_model !== 'table_reservation') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/tables/settings');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { settings?: { table_management_enabled?: boolean } };
        if (!cancelled) {
          setTableManagementEnabled(Boolean(data.settings?.table_management_enabled));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-sync when venue identity / model changes, not whole venue object (frequent PATCHes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id, venue?.booking_model]);

  const [staffInvites, setStaffInvites] = useState<StaffInviteDraft[]>([{ email: '', role: 'staff' }]);

  useEffect(() => {
    async function loadVenue() {
      try {
        const res = await fetch('/api/venue/onboarding');
        if (!res.ok) {
          if (res.status === 401) {
            router.push('/login?redirectTo=/onboarding');
            return;
          }
          if (res.status === 404) {
            router.push('/signup/business-type');
            return;
          }
          throw new Error('Failed to load venue');
        }
        const data = await res.json();
        const v = data.venue as VenueOnboarding;
        setVenue(v);
        setName(v.name === 'My Business' ? '' : v.name);
        const parsed = parseAddress(v.address);
        setAddressName(parsed.name);
        setAddressStreet(parsed.street);
        setAddressTown(parsed.town);
        setAddressPostcode(parsed.postcode);
        setPhone(v.phone ?? '');
        setBusinessEmail(v.email ?? '');
        setBusinessWebsiteUrl(v.website_url ?? '');
        setCurrency(v.currency ?? 'GBP');

        if (v.onboarding_completed) {
          router.push('/dashboard');
          return;
        }

        if (isAppointmentPlanTier(v.pricing_tier) && (!v.active_booking_models || v.active_booking_models.length === 0)) {
          router.push('/signup/booking-models');
          return;
        }

        let initialStep = v.onboarding_step;
        let initialMaxStep = v.onboarding_step;
        let restaurantTableMgmt = false;

        if (v.booking_model === 'table_reservation') {
          try {
            const tsRes = await fetch('/api/venue/tables/settings');
            if (tsRes.ok) {
              const tsBody = (await tsRes.json()) as { settings?: { table_management_enabled?: boolean } };
              restaurantTableMgmt = Boolean(tsBody.settings?.table_management_enabled);
            }
          } catch {
            /* non-blocking */
          }
          setTableManagementEnabled(restaurantTableMgmt);
          // The stored index is taken at face value: it already refers to this layout. Any index
          // past the end is clamped by the effect that syncs `step` against `modelSteps`.
        }

        if (isAppointmentPlanTier(v.pricing_tier)) {
          const active = (v.active_booking_models ?? []).filter(isAppointmentPlanModel) as AppointmentPlanModel[];
          if (active.length > 0) {
            const currentSteps = buildAppointmentsPlanModelSteps(active, {
              omitOtherUsersStep: v.pricing_tier === 'light',
            });
            const unifiedFlow = Boolean(v.appointments_onboarding_unified_flow);
            const leanFlow = Boolean(v.appointments_onboarding_lean_flow);

            // Two one-shot remaps, each gated by its own marker column. `!unifiedFlow`
            // covers venues still on the pre-unified layout; `!leanFlow` covers venues
            // mid-flow when the catalogue and Stripe steps were dropped. A venue needing
            // the first also gets the second for free, since the target is already lean.
            if (!unifiedFlow || !leanFlow) {
              const legacySteps = !unifiedFlow
                ? isPlusPlanTier(v.pricing_tier)
                  ? buildLegacyGenericNonRestaurantOnboardingSteps(v.booking_model, v.terminology)
                  : buildLegacyAppointmentsPlanModelSteps(active)
                : buildCatalogueAppointmentsPlanSteps(active, {
                    omitOtherUsersStep: v.pricing_tier === 'light',
                  });
              initialStep = migrateOnboardingStepToCurrentLayout(
                v.onboarding_step,
                legacySteps,
                currentSteps,
              );
              initialMaxStep = initialStep;
              const patch: Record<string, unknown> = {
                appointments_onboarding_unified_flow: true,
                appointments_onboarding_lean_flow: true,
              };
              if (initialStep !== v.onboarding_step) {
                patch.onboarding_step = initialStep;
              }
              void fetch('/api/venue/onboarding', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
              });
            }
          }
        } else if (v.booking_model !== 'table_reservation') {
          // Restaurant / founding tier on a non-table booking model: signup takes the
          // booking model from the business type, not the plan, so this combination is
          // reachable. Same one-shot remap, reusing the lean marker column, for the
          // catalogue steps dropped from this flow too.
          if (!v.appointments_onboarding_lean_flow) {
            const migrated = migrateOnboardingStepToCurrentLayout(
              v.onboarding_step,
              buildLegacyGenericNonRestaurantOnboardingSteps(v.booking_model, v.terminology),
              buildGenericNonRestaurantOnboardingSteps(v.booking_model, v.terminology),
            );
            initialStep = migrated;
            initialMaxStep = migrated;
            const patch: Record<string, unknown> = { appointments_onboarding_lean_flow: true };
            if (migrated !== v.onboarding_step) {
              patch.onboarding_step = migrated;
            }
            void fetch('/api/venue/onboarding', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patch),
            });
          }
        }
        setStep(initialStep);
        setMaxCompletedStep(initialMaxStep);


        // Model B: merge existing calendars (retry / refresh after partial save).
        // Appointments Light is capped at one calendar; higher tiers can add more.
        if (isUnifiedSchedulingVenue(v.booking_model) || isAppointmentPlanTier(v.pricing_tier)) {
          try {
            const prRes = await fetchOnboardingPractitioners();
            if (prRes.ok) {
              const body = (await prRes.json()) as {
                practitioners?: Array<{ name: string; email: string | null; sort_order: number }>;
              };
              const list = body.practitioners ?? [];
              const sorted = [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
              if (sorted.length === 0) {
                setPractitioners([{ name: '', email: '' }]);
              } else {
                const visibleCalendars = v.pricing_tier === 'light' ? sorted.slice(0, 1) : sorted;
                setPractitioners(
                  visibleCalendars.map((row) => ({
                    name: row.name ?? '',
                    email: row.email?.trim() ? row.email : '',
                  })),
                );
              }
            } else {
              setPractitioners([{ name: '', email: '' }]);
            }
          } catch {
            setPractitioners([{ name: '', email: '' }]);
          }
        }

      } catch {
        setError('Failed to load venue data.');
      } finally {
        setLoading(false);
      }
    }
    loadVenue();
  }, [router]);

  /** Strip ?stripe= from URL after returning from Stripe Connect (same data as initial GET). */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('stripe')) return;
    router.replace('/onboarding', { scroll: false });
  }, [router]);

  const terms = useMemo(
    () => venue?.terminology ?? { client: 'Client', booking: 'Booking', staff: 'Staff' },
    [venue?.terminology],
  );

  const isAppointmentsPlanVenue = isAppointmentPlanTier(venue?.pricing_tier);
  const isLightPlanVenue = venue?.pricing_tier === 'light';

  /**
   * Per-plan calendar limit (Infinity for unlimited plans).
   * Compared against the DRAFT array length so the UI blocks before any API call.
   */
  const calendarPlanLimit: number = entitlement?.calendar_limit ?? Infinity;
  const calendarDraftAtLimit =
    calendarPlanLimit !== Infinity && practitioners.length >= calendarPlanLimit;

  /**
   * Per-plan staff limit (Infinity for unlimited plans).
   * Used both to gate the invite form and to pre-validate on submit.
   */
  const staffPlanLimit: number = entitlement?.staff_limit ?? Infinity;

  const activeAppointmentsModels: AppointmentPlanModel[] = useMemo(
    () => (venue?.active_booking_models ?? []).filter(isAppointmentPlanModel),
    [venue?.active_booking_models],
  );

  /**
   * Whether guests can actually book anything, read on the final step only. Null while
   * loading or if the call fails, in which case the copy stays neutral rather than
   * claiming a catalogue that may not exist. `booking_model` comes from the same
   * response so it matches the model the flag was computed for.
   */
  const [previewStatus, setPreviewStatus] = useState<{
    bookingReady: boolean;
    bookingModel: BookingModel;
  } | null>(null);

  /** Normalised secondaries (e.g. restaurant + events). Primary flow is unchanged; checklist on dashboard covers catalogue for each enabled add-on. */
  const enabledSecondaryModels = useMemo(
    () =>
      venue
        ? normalizeEnabledModels(venue.enabled_models, venue.booking_model)
        : [],
    [venue],
  );

  const modelSteps = useMemo(() => {
    if (!venue) return [];
    if (isAppointmentPlanTier(venue.pricing_tier)) {
      return buildAppointmentsPlanModelSteps(activeAppointmentsModels, {
        omitOtherUsersStep: venue.pricing_tier === 'light',
      });
    }

    if (venue.booking_model === 'table_reservation') {
      return buildRestaurantOnboardingSteps(tableManagementEnabled);
    }

    return buildGenericNonRestaurantOnboardingSteps(venue.booking_model, terms);
  }, [activeAppointmentsModels, venue, terms, tableManagementEnabled]);

  const currentStepKey = modelSteps[step]?.key ?? 'profile';
  const totalSteps = modelSteps.length;

  /**
   * The final screen used to assert that services were set and hand over the booking
   * link regardless. Read the same `guest_booking_ready` flag the dashboard checklist
   * uses so the copy matches what a guest would actually find on the page.
   *
   * Fetched from the `dashboard` step onwards (two steps ahead of `preview`) so the
   * final screen does not visibly flip from "You're all set!" to the corrected
   * heading once the answer arrives. Flows without a `dashboard` step just resolve on
   * arrival. The previous value is deliberately kept while refetching, for the same reason.
   */
  useEffect(() => {
    if (currentStepKey !== 'preview' && currentStepKey !== 'dashboard') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/venue/setup-status');
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          guest_booking_ready?: boolean;
          booking_model?: BookingModel;
        };
        if (cancelled || !body.booking_model) return;
        setPreviewStatus({
          bookingReady: body.guest_booking_ready === true,
          bookingModel: body.booking_model,
        });
      } catch {
        /* non-blocking: status stays null and the copy stays neutral */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStepKey]);

  const previewCatalog = resolvePreviewCatalogState(previewStatus);
  /** Non-null only once we know nothing is bookable yet, and what is missing. */
  const previewMissing = previewCatalog.kind === 'missing' ? previewCatalog : null;
  /** Only claim a catalogue exists when the server confirmed it. */
  const previewCatalogConfirmed = previewCatalog.kind === 'ready';

  useEffect(() => {
    if (handledStripeReturnRef.current) return;
    if (loading || !venue || venue.onboarding_completed || modelSteps.length === 0) return;
    if (stripeReturnStatusRef.current !== 'success') return;

    const stripeIndex = modelSteps.findIndex((s) => s.key === 'stripe_onboarding');
    if (stripeIndex < 0) {
      handledStripeReturnRef.current = true;
      return;
    }

    const nextStep = Math.min(stripeIndex + 1, modelSteps.length - 1);
    handledStripeReturnRef.current = true;
    setStep(nextStep);
    setMaxCompletedStep((prev) => Math.max(prev, nextStep));
    void fetch('/api/venue/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboarding_step: nextStep }),
    });
  }, [loading, modelSteps, step, venue]);


  useEffect(() => {
    if (!venue) return;
    /** Prefetch roster on the steps that need calendars loaded. */
    if (
      !['team', 'stripe_onboarding', 'users', 'hours'].includes(currentStepKey)
    ) {
      return;
    }
    let cancelled = false;
    setRosterLoading(true);
    (async () => {
      try {
        const prRes = await fetchOnboardingPractitioners({ roster: true });
        if (!prRes.ok || cancelled) return;
        const body = (await prRes.json()) as {
          practitioners?: Array<{ id: string; name: string; calendar_type?: string | null }>;
        };
        if (!cancelled) setRosterList(onboardingRosterFromPractitioners(body.practitioners));
      } catch {
        /* non-blocking */
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, currentStepKey]);

  useEffect(() => {
    if (!venue) return;
    if (currentStepKey !== 'hours' && currentStepKey !== 'opening_hours') return;
    const isAppointmentsTier = isAppointmentPlanTier(venue.pricing_tier);
    if (
      currentStepKey === 'hours' &&
      !isUnifiedSchedulingVenue(venue.booking_model) &&
      !isAppointmentsTier
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const venueRequest = fetch('/api/venue');
        const practitionerRequest =
          currentStepKey === 'opening_hours'
            ? Promise.resolve(new Response(JSON.stringify({ practitioners: [] }), { status: 200 }))
            : fetchOnboardingPractitioners({ roster: true });
        const [vRes, pRes] = await Promise.all([venueRequest, practitionerRequest]);
        if (!vRes.ok || !pRes.ok || cancelled) return;
        const venueRow = (await vRes.json()) as { opening_hours?: OpeningHoursSettings | null };
        const prBody = (await pRes.json()) as {
          practitioners?: Array<{ id: string; name: string; working_hours?: WorkingHours; calendar_type?: string | null }>;
        };
        const pracs = prBody.practitioners ?? [];
        if (currentStepKey === 'hours' && !cancelled) {
          setRosterList(onboardingRosterFromPractitioners(prBody.practitioners));
        }
        let mergedOpening: OpeningHoursSettings;
        if (venueRow.opening_hours && typeof venueRow.opening_hours === 'object') {
          mergedOpening = {
            ...defaultOpeningHoursSettings(),
            ...venueRow.opening_hours,
          } as OpeningHoursSettings;
          if (!cancelled) setOpeningHoursDraft(mergedOpening);
        } else {
          mergedOpening = defaultOpeningHoursSettings();
          if (!cancelled) setOpeningHoursDraft(mergedOpening);
        }
        const fromOpening = defaultCalendarWorkingHoursFromOpeningHours(mergedOpening);
        const byId: Record<string, WorkingHours> = {};
        for (const p of pracs) {
          const wh = p.working_hours;
          const hasCustom =
            wh &&
            typeof wh === 'object' &&
            Object.keys(wh).length > 0 &&
            !isDefaultNewUnifiedCalendarWorkingHours(wh);
          byId[p.id] = hasCustom ? (wh as WorkingHours) : fromOpening;
        }
        if (!cancelled) setCalendarWorkingDraft(byId);
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, currentStepKey]);

  const saveProgress = useCallback(
    async (nextStep: number) => {
      const res = await fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_step: nextStep }),
      });
      if (!res.ok) throw new Error('Failed to save progress');
    },
    []
  );

  /** Latest step for unload / tab backgrounding (must survive React commit timing). */
  const stepRef = useRef(step);
  stepRef.current = step;

  /**
   * Keep `venues.onboarding_step` aligned with the visible step so users resume here after closing the tab,
   * navigating away, or logging in again, not only after clicking Continue.
   */
  useEffect(() => {
    if (!venue || venue.onboarding_completed) return;
    if (modelSteps.length === 0) return;
    const maxIdx = modelSteps.length - 1;
    const clamped = Math.min(Math.max(0, step), maxIdx);
    if (clamped !== step) {
      setStep(clamped);
    }
  }, [venue, modelSteps.length, step, venue?.onboarding_completed]);

  useEffect(() => {
    if (!venue || venue.onboarding_completed) return;
    if (modelSteps.length === 0) return;
    const maxIdx = modelSteps.length - 1;
    if (step < 0 || step > maxIdx) return;

    const t = setTimeout(() => {
      void fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_step: step }),
      });
    }, 400);
    return () => clearTimeout(t);
  }, [step, venue, modelSteps.length]);

  useEffect(() => {
    if (!venue || venue.onboarding_completed) return;

    const persistNow = () => {
      const idx = stepRef.current;
      void fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_step: idx }),
        keepalive: true,
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        persistNow();
      }
    };

    window.addEventListener('pagehide', persistNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', persistNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [venue]);

  /** Each step should start at the top; retained scroll position on shorter next steps felt like a jump to the bottom. */
  useEffect(() => {
    if (loading || !venue) return;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo(0, 0);
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [step, loading, venue]);

  async function handleNext() {
    setError(null);

    if (currentStepKey === 'welcome') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      setSaving(true);
      try {
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save your progress. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'dashboard') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      setSaving(true);
      try {
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save your progress. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'stripe_onboarding') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      setSaving(true);
      try {
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save progress. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'profile') {
      if (!name.trim()) {
        setError('Please enter your business name.');
        return;
      }
      const street = addressStreet.trim();
      const town = addressTown.trim();
      const postcode = addressPostcode.trim();
      if (!street || !town || !postcode) {
        setError('Please enter street, town or city, and postcode for your business address.');
        return;
      }
      const email = businessEmail.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError('Enter a valid business email address, or leave it blank.');
        return;
      }
      const websiteUrl = businessWebsiteUrl.trim();
      if (websiteUrl && !isValidWebsiteUrlInput(websiteUrl)) {
        setError('Enter a valid business website URL, or leave it blank.');
        return;
      }
      const combinedAddress = buildAddress({
        name: addressName.trim(),
        street,
        town,
        postcode,
      });
      setSaving(true);
      try {
        const finalSlug = slugFromBusinessNameOrFallback(name, () => `venue-${Date.now()}`);
        const nextStep = Math.max(step + 1, maxCompletedStep);
        const res = await fetch('/api/venue/onboarding', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            address: combinedAddress,
            phone: phone.trim(),
            email,
            website_url: websiteUrl,
            slug: finalSlug,
            currency,
            onboarding_step: nextStep,
          }),
        });
        const resBody = (await res.json().catch(() => ({}))) as { error?: string; slug?: string };
        if (!res.ok) {
          throw new Error(resBody.error ?? 'Failed to save profile');
        }
        // A business name that clashes with another venue no longer errors: the server picks a
        // unique booking-page URL automatically (e.g. drops the hyphen or appends a number) and
        // it can be changed later in venue settings. Use whatever slug the server actually saved.
        const savedSlug =
          typeof resBody.slug === 'string' && resBody.slug ? resBody.slug : finalSlug;
        setVenue((prev) =>
          prev
            ? {
                ...prev,
                name: name.trim(),
                address: combinedAddress,
                phone: phone.trim(),
                email: email || null,
                website_url: websiteUrl || null,
                slug: savedSlug,
                currency,
              }
            : prev
        );
      } catch {
        setError('Failed to save. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'opening_hours') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const hasVenueOpenDay = Object.values(openingHoursDraft).some((d) => {
        if (!d) return false;
        if ('closed' in d && d.closed === true) return false;
        if ('periods' in d && Array.isArray(d.periods) && d.periods.length > 0) return true;
        return false;
      });
      if (!hasVenueOpenDay) {
        setError('Choose at least one day when the business is open.');
        return;
      }
      setSaving(true);
      try {
        const ohRes = await fetch('/api/venue/opening-hours', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(openingHoursDraft),
        });
        if (!ohRes.ok) throw new Error('Failed to save opening hours');
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save opening hours. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'team') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const unnamed = practitioners.find((p) => !p.name.trim());
      if (unnamed) {
        setError(`Enter a name for each ${terms.staff.toLowerCase()}.`);
        return;
      }
      if (calendarPlanLimit !== Infinity && practitioners.length > calendarPlanLimit) {
        setError(
          `Your ${planDisplayName(venue?.pricing_tier)} plan includes up to ${calendarPlanLimit} calendars. Please remove some before continuing.`,
        );
        return;
      }
      setSaving(true);
      try {
        const listRes = await fetchOnboardingPractitioners();
        if (!listRes.ok) {
          const errBody = (await listRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? 'Could not load your team. Please refresh and try again.');
        }
        const listBody = (await listRes.json()) as {
          practitioners?: Array<{ id: string; sort_order: number }>;
        };
        const sortedExisting = [...(listBody.practitioners ?? [])].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
        );

        const savedRoster: Array<{ id: string; name: string }> = [];
        for (let i = 0; i < practitioners.length; i++) {
          const p = practitioners[i];
          const existing = sortedExisting[i];
          if (existing?.id) {
            const res = await fetch('/api/venue/practitioners', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: existing.id,
                name: p.name.trim(),
                sort_order: i,
                ...(p.email.trim() ? { email: p.email.trim() } : {}),
              }),
            });
            if (!res.ok) {
              const errBody = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
              throw new Error(
                typeof errBody.error === 'string'
                  ? errBody.error
                  : `Could not update ${terms.staff.toLowerCase()} ${i + 1}.`,
              );
            }
            const json = (await res.json()) as { id?: string; name?: string };
            savedRoster.push({
              id: json.id ?? existing.id,
              name: typeof json.name === 'string' ? json.name : p.name.trim(),
            });
          } else {
            const res = await fetch('/api/venue/practitioners', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: p.name.trim(),
                sort_order: i,
                ...(p.email.trim() ? { email: p.email.trim() } : {}),
              }),
            });
            if (!res.ok) {
              const errBody = (await res.json().catch(() => ({}))) as {
                error?: string;
                upgrade_required?: boolean;
                limit?: number;
              };
              if (errBody.upgrade_required) {
                throw new Error(
                  'Could not add team member. Please check your plan under Settings \u2192 Plan.',
                );
              }
              throw new Error(
                typeof errBody.error === 'string'
                  ? errBody.error
                  : `Could not add ${terms.staff.toLowerCase()} ${i + 1}.`,
              );
            }
            const json = (await res.json()) as { id?: string; name?: string };
            if (!json.id) {
              throw new Error(`Could not add ${terms.staff.toLowerCase()} ${i + 1}. Please try again.`);
            }
            savedRoster.push({
              id: json.id,
              name: typeof json.name === 'string' ? json.name : p.name.trim(),
            });
          }
        }

        setRosterList(savedRoster);

        if (sortedExisting.length > practitioners.length) {
          const toRemove = sortedExisting.slice(practitioners.length);
          for (const row of toRemove) {
            if (!row?.id) continue;
            const delRes = await fetch('/api/venue/practitioners', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: row.id }),
            });
            if (!delRes.ok) {
              const errBody = (await delRes.json().catch(() => ({}))) as { error?: string };
              throw new Error(
                typeof errBody.error === 'string'
                  ? errBody.error
                  : `Could not remove an extra ${terms.staff.toLowerCase()} record. Try again or manage team under Settings.`,
              );
            }
          }
        }

        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save team. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'users') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const validInvites = staffInvites
        .map((invite) => ({ email: invite.email.trim().toLowerCase(), role: invite.role }))
        .filter((invite) => invite.email.length > 0);
      for (const invite of validInvites) {
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email);
        if (!emailOk) {
          setError(`Enter a valid email address for ${invite.email || 'each user'}.`);
          return;
        }
      }
      if (staffPlanLimit !== Infinity) {
        const existingCount = entitlement?.active_staff ?? 1;
        const uniqueNewInvites = [...new Set(validInvites.map((i) => i.email))].length;
        if (existingCount + uniqueNewInvites > staffPlanLimit) {
          setError(
            `Your ${planDisplayName(venue?.pricing_tier)} plan includes up to ${staffPlanLimit} team logins (you currently have ${existingCount}). Please remove some invites to continue.`,
          );
          return;
        }
      }
      setSaving(true);
      try {
        const staffListRes = await fetch('/api/venue/staff');
        if (!staffListRes.ok) {
          const errBody = (await staffListRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? 'Could not load staff list');
        }
        const staffBody = (await staffListRes.json()) as {
          staff?: Array<{ email: string }>;
        };
        const existingEmails = new Set(
          (staffBody.staff ?? []).map((r) => r.email.toLowerCase().trim()),
        );
        for (const invite of validInvites) {
          if (existingEmails.has(invite.email)) {
            continue;
          }
          const res = await fetch('/api/venue/staff/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(invite),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Failed to invite ${invite.email}`);
          }
          existingEmails.add(invite.email);
        }
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save users. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }


    if (currentStepKey === 'hours') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      if (rosterList.length === 0) {
        setError('No calendars found. Go back and save your team first.');
        return;
      }
      const hasVenueOpenDay = Object.values(openingHoursDraft).some((d) => {
        if (!d) return false;
        if ('closed' in d && d.closed === true) return false;
        if ('periods' in d && Array.isArray(d.periods) && d.periods.length > 0) return true;
        return false;
      });
      if (!hasVenueOpenDay) {
        setError('Choose at least one day when the business is open, or adjust opening hours below.');
        return;
      }

      setSaving(true);
      try {
        if (!isAppointmentsPlanVenue) {
          const ohRes = await fetch('/api/venue/opening-hours', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(openingHoursDraft),
          });
          if (!ohRes.ok) throw new Error('Failed to save opening hours');
        }
        for (const cal of rosterList) {
          const wh =
            calendarWorkingDraft[cal.id] ??
            defaultCalendarWorkingHoursFromOpeningHours(openingHoursDraft);
          const hasDay = Object.values(wh).some((ranges) => Array.isArray(ranges) && ranges.length > 0);
          if (!hasDay) {
            throw new Error(
              `Set at least one working day for ${cal.name} (or adjust their weekly schedule below).`,
            );
          }
          const patchRes = await fetch('/api/venue/practitioners', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cal.id, working_hours: wh }),
          });
          if (!patchRes.ok) throw new Error(`Failed to save working hours for ${cal.name}`);
        }
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save hours.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }




    if (currentStepKey === 'restaurant_setup') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      setSaving(true);
      try {
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    // Restaurant-specific steps delegate saving to the child component via advanceRestaurantStep.
    // handleNext is not used for these steps; the standard Continue button is hidden.
    if (
      currentStepKey === 'r_welcome' ||
      currentStepKey === 'r_opening_hours' ||
      currentStepKey === 'r_services' ||
      currentStepKey === 'r_table_mode' ||
      currentStepKey === 'r_table_setup' ||
      currentStepKey === 'r_dashboard'
    ) {
      return;
    }

    if (revisitedStepIndex === step) {
      setRevisitedStepIndex(null);
    }
    setStep((s) => s + 1);
  }

  /**
   * Called by restaurant step components when they finish (save or skip).
   * Saves the onboarding step progress index then advances to the next step.
   */
  async function advanceRestaurantStep() {
    setSaving(true);
    setError(null);
    try {
      const nextStep = Math.max(step + 1, maxCompletedStep);
      await saveProgress(nextStep);
      setMaxCompletedStep(nextStep);
      setStep((s) => s + 1);
    } catch {
      setError('Failed to save progress. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleGoLive() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onboarding_completed: true,
          onboarding_step: totalSteps,
        }),
      });
      if (!res.ok) throw new Error('Failed to complete onboarding');
      router.push('/dashboard');
    } catch {
      setError('Failed to complete setup. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <OnboardingShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        </div>
      </OnboardingShell>
    );
  }

  if (!venue) {
    return (
      <OnboardingShell>
        <p className="text-center text-slate-500">Unable to load your venue. Please try refreshing.</p>
      </OnboardingShell>
    );
  }

  const RESTAURANT_SELF_MANAGED_STEPS = new Set([
    'r_welcome',
    'r_opening_hours',
    'r_services',
    'r_table_mode',
    'r_table_setup',
    'r_dashboard',
  ]);

  return (
    <OnboardingShell stepKey={currentStepKey}>
      {/* Progress */}
      <div className="mb-6 sm:mb-8">
        <div className="mb-2 flex flex-col gap-1 text-xs font-medium text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 break-words">
            Step {step + 1} of {totalSteps} · {modelSteps[step]?.label}
          </span>
          <span className="shrink-0">{Math.round(((step + 1) / totalSteps) * 100)}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-200">
          <div
            className="h-2 rounded-full bg-brand-600 transition-all"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
        {step > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Use <span className="font-medium text-slate-600">Back</span> to change a previous step. Your entries stay in
            this session and are saved to your venue when you choose Continue.
          </p>
        )}
      </div>

      <div
        className={`min-w-0 overflow-x-hidden break-words rounded-2xl border border-slate-200 bg-white shadow-sm [&_button]:max-w-full [&_input]:max-w-full [&_input]:min-w-0 [&_select]:max-w-full [&_select]:min-w-0 [&_textarea]:max-w-full [&_textarea]:min-w-0 ${ONBOARDING_CARD_PADDING_CLASS}`}
      >
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {currentStepKey === 'welcome' && (
          <AppointmentsWelcomeStep
            isLightPlan={isLightPlanVenue}
            activeModels={activeAppointmentsModels as AppointmentPlanModel[]}
            modelLabel={APPOINTMENTS_MODEL_LABEL}
            staffTerm={terms.staff}
          />
        )}

        {currentStepKey === 'dashboard' && (
          <AppointmentsDashboardStep
            activeModels={activeAppointmentsModels as AppointmentPlanModel[]}
            isLightPlan={isLightPlanVenue}
            staffTerm={terms.staff}
            hasTeamCalendars={rosterList.length > 0}
          />
        )}

        {currentStepKey === 'stripe_onboarding' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">Payments (Stripe)</h2>
            <p className="mb-3 text-sm text-slate-600">
              Use this step to connect Stripe so you can <strong className="font-medium text-slate-800">accept payments from your customers</strong>{' '}
              (for example deposits, tickets, or paid bookings). Payments are processed by Stripe.{' '}
              {RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}
            </p>
            <p className="mb-4 text-sm text-slate-600">
              This setup is only for customer payments. Your <strong className="font-medium text-slate-800">ResNeo subscription</strong>{' '}
              is billed separately. Manage your plan and payment method under{' '}
              <Link
                href="/dashboard/settings?tab=plan"
                className="font-medium text-brand-600 underline hover:text-brand-700"
              >
                Settings → Plan &amp; billing
              </Link>
              .
            </p>
            <p className="mb-4 text-sm text-slate-500">
              Optional: use <span className="font-medium text-slate-700">Continue</span> to skip for now and connect later in{' '}
              <Link href="/dashboard/settings?tab=payments" className="font-medium text-brand-600 underline hover:text-brand-700">
                Settings → Payments
              </Link>
              .
            </p>
            <StripeConnectSection
              stripeAccountId={venue.stripe_connected_account_id ?? null}
              isAdmin={venue.is_admin}
              hideSectionTitle
              stripeAccountLinkPaths={{
                return: '/onboarding?stripe=success',
                refresh: '/onboarding?stripe=refresh',
              }}
            />
          </div>
        )}

        {/* Profile step */}
        {currentStepKey === 'profile' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">Tell us about your business</h2>
            <p className="mb-6 text-sm text-slate-500">
              This information will appear on your booking page.
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Business name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Business name"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <fieldset className="space-y-3">
                <legend className="mb-1.5 block text-sm font-medium text-slate-700">Business address</legend>
                <p className="text-xs text-slate-500">
                  Same format as Settings → Venue profile. You can add a building name if you like.
                </p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Building / venue name (optional)</label>
                  <input
                    type="text"
                    value={addressName}
                    onChange={(e) => setAddressName(e.target.value)}
                    placeholder="e.g. The Old Mill"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Street *</label>
                  <input
                    type="text"
                    value={addressStreet}
                    onChange={(e) => setAddressStreet(e.target.value)}
                    placeholder="e.g. 12 Main Street"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Town / city *</label>
                    <input
                      type="text"
                      value={addressTown}
                      onChange={(e) => setAddressTown(e.target.value)}
                      placeholder="e.g. Belfast"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Postcode *</label>
                    <input
                      type="text"
                      value={addressPostcode}
                      onChange={(e) => setAddressPostcode(e.target.value)}
                      placeholder="e.g. BT1 1AA"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      autoComplete="postal-code"
                    />
                  </div>
                </div>
              </fieldset>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Phone
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Business email <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={businessEmail}
                    onChange={(e) => setBusinessEmail(e.target.value)}
                    placeholder="hello@example.com"
                    autoComplete="email"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Used as the venue contact and reply-to address for guest emails.
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Business website <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    inputMode="url"
                    value={businessWebsiteUrl}
                    onChange={(e) => setBusinessWebsiteUrl(e.target.value)}
                    placeholder="example.com or https://example.com"
                    autoComplete="url"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Shown on your public booking page when set.
                  </p>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                >
                  {CURRENCY_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {currentStepKey === 'opening_hours' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">Set your opening hours</h2>
            <p className="mb-4 text-sm text-slate-500">
              These are the broad weekly hours when your business accepts online bookings. Set them generously, and
              you can always narrow per-calendar hours in the next step.
            </p>
            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-sm font-medium text-slate-800">How booking availability works</p>
              <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm text-slate-600">
                <li>
                  <strong className="text-slate-800">Business opening hours</strong> (this step) are the outer
                  limit for all online bookings.
                </li>
                <li>
                  <strong className="text-slate-800">Calendar availability</strong> (next step) narrows that down
                  per person, room, or resource.
                </li>
                <li>A time is bookable only when <strong>both</strong> are open.</li>
              </ul>
              <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
                <p>
                  Example: business 09:00–18:00, therapist 10:00–16:00 → bookable times for that therapist are
                  10:00–16:00.
                </p>
                <p>
                  Example: business open all day, but Room A blocked 14:00–15:00 → Room A is not bookable in that
                  hour.
                </p>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Tip: closing for a holiday or a day off? Toggle the day to <strong>Closed</strong>. You can also
                add date-specific closures from Calendar availability later.
              </p>
            </div>
            <OpeningHoursControl value={openingHoursDraft} onChange={setOpeningHoursDraft} />
          </div>
        )}

        {/* Restaurant plan steps */}
        {currentStepKey === 'r_welcome' && (
          <RestaurantWelcomeStep onContinue={() => void advanceRestaurantStep()} />
        )}

        {currentStepKey === 'r_opening_hours' && (
          <OpeningHoursStep onDone={advanceRestaurantStep} />
        )}

        {currentStepKey === 'r_services' && (
          <ServicesStep onDone={advanceRestaurantStep} />
        )}

        {currentStepKey === 'r_table_mode' && (
          <TableModeStep
            onDone={advanceRestaurantStep}
            onModeSelected={(advanced) => setTableManagementEnabled(advanced)}
          />
        )}

        {currentStepKey === 'r_table_setup' && (
          <TableSetupStep onDone={advanceRestaurantStep} />
        )}

        {currentStepKey === 'r_dashboard' && (
          <DashboardOrientationStep
            onDone={advanceRestaurantStep}
            tableManagementEnabled={tableManagementEnabled}
          />
        )}

        {/* Legacy restaurant_setup step (no longer reached by new signups) */}
        {currentStepKey === 'restaurant_setup' && (
          <div className="text-center">
            <h2 className="mb-2 text-lg font-bold text-slate-900">Restaurant setup</h2>
            <p className="mb-4 text-sm text-slate-500">
              Next you&apos;ll see a short summary and your booking link. After that, a dedicated step on your
              dashboard will set up service periods, table capacity, party sizes, and deposit rules for your
              reservations.
            </p>
          </div>
        )}

        {/* Model B: Team / calendars (all appointment-style plans: same add/remove UI) */}
        {currentStepKey === 'team' && venue && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">
              {isAppointmentsPlanVenue ? 'Set up your calendars' : unifiedTeamStepLabel(terms)}
            </h2>
            {isLightPlanVenue ? (
              <p className="mb-4 text-sm text-slate-500">
                Appointments Light is limited to one bookable calendar and one user. Give your calendar a name
                (usually your name or business name), and you’ll set its working hours next. Need more calendars or
                team logins? Upgrade under{' '}
                <Link href="/dashboard/settings?tab=plan" className="font-medium text-brand-600 underline hover:text-brand-700">
                  Settings → Plan
                </Link>
                .
              </p>
            ) : isPlusPlanTier(venue.pricing_tier) ? (
              <p className="mb-4 text-sm text-slate-500">
                Add a <strong>calendar column</strong> for each lane on your schedule. Your Appointments
                Plus plan includes up to <strong>5 calendar columns</strong>. You can add or remove columns
                any time from{' '}
                <Link
                  href="/dashboard/calendar-availability"
                  className="font-medium text-brand-600 underline hover:text-brand-700"
                >
                  Calendar availability
                </Link>
                .
              </p>
            ) : (
              <p className="mb-4 text-sm text-slate-500">
                Add a <strong>calendar column</strong> for each lane on your schedule. You can add or remove
                columns any time from{' '}
                <Link
                  href="/dashboard/calendar-availability"
                  className="font-medium text-brand-600 underline hover:text-brand-700"
                >
                  Calendar availability
                </Link>
                .
              </p>
            )}

            {!isLightPlanVenue && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                <p className="mb-2 font-medium text-slate-800">What’s a calendar column?</p>
                <p className="mb-3 text-slate-600">
                  Think of it as a lane on your daily schedule. Each column has its own working hours and its own
                  bookings. Columns usually represent one of:
                </p>
                <ul className="list-inside list-disc space-y-1 text-slate-600">
                  <li>
                    <strong className="text-slate-800">A person</strong>, e.g. a therapist, stylist, tutor, or
                    practitioner.
                  </li>
                  <li>
                    <strong className="text-slate-800">A room or chair</strong>, e.g. Treatment room 1, Chair A.
                  </li>
                  <li>
                    <strong className="text-slate-800">A resource or category</strong>, e.g. Court 1, Studio, or
                    “Walk-ins”.
                  </li>
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  Tip: many businesses mirror their physical space (one column per chair, one per room). You can
                  change the setup later without losing history.
                </p>
              </div>
            )}
            <div className="mb-6 space-y-3">
              {practitioners.map((p, i) => (
                <div
                  key={i}
                  className="min-w-0 max-w-full rounded-xl border border-slate-200 p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Calendar {i + 1}
                    </span>
                    {!isLightPlanVenue && practitioners.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPractitioners(practitioners.filter((_, j) => j !== i))}
                        className="shrink-0 text-xs font-medium text-slate-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {isAppointmentsPlanVenue ? (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={p.name}
                        onChange={(e) => {
                          const updated = [...practitioners];
                          updated[i] = { ...p, name: e.target.value };
                          setPractitioners(updated);
                        }}
                        placeholder="Calendar name or resource label"
                        className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:gap-3">
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) => {
                            const updated = [...practitioners];
                            updated[i] = { ...p, name: e.target.value };
                            setPractitioners(updated);
                          }}
                          placeholder="e.g. Staff name or room label"
                          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Email <span className="font-normal text-slate-400">(optional)</span>
                        </label>
                        <input
                          type="email"
                          value={p.email}
                          onChange={(e) => {
                            const updated = [...practitioners];
                            updated[i] = { ...p, email: e.target.value };
                            setPractitioners(updated);
                          }}
                          placeholder="name@example.com"
                          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {isPlusPlanTier(venue.pricing_tier) && calendarPlanLimit !== Infinity && (
                <p className="mb-2 text-right text-xs text-slate-500">
                  {practitioners.length} / {calendarPlanLimit} calendars
                </p>
              )}
              {isLightPlanVenue && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-950">
                  Appointments Light includes <strong>1 calendar</strong>, so additional calendars cannot be
                  created during onboarding. You can upgrade later if you need separate calendars for extra staff,
                  rooms, or resources.
                </div>
              )}
              {!isLightPlanVenue && !calendarDraftAtLimit && (
                <button
                  type="button"
                  onClick={() => setPractitioners([...practitioners, { name: '', email: '' }])}
                  className="w-full rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-brand-300 hover:text-brand-600"
                >
                  + Add calendar
                </button>
              )}
              {isPlusPlanTier(venue.pricing_tier) && calendarDraftAtLimit && (
                <p className="mt-1 text-center text-xs text-slate-500">
                  You&apos;ve reached the {calendarPlanLimit}-calendar limit on your Appointments Plus
                  plan. Remove one above to add a different calendar, or upgrade from{' '}
                  <Link href="/dashboard/settings?tab=plan" className="font-medium text-brand-600 underline hover:text-brand-700">
                    Settings → Plan
                  </Link>
                  .
                </p>
              )}
            </div>
          </div>
        )}

        {currentStepKey === 'users' && (
          <OnboardingStaffInviteStep
            invites={staffInvites}
            setInvites={setStaffInvites}
            staffLimit={entitlement?.staff_limit ?? null}
            existingStaffCount={entitlement?.active_staff}
          />
        )}


        {currentStepKey === 'hours' &&
          (isAppointmentsPlanVenue || isUnifiedSchedulingVenue(venue.booking_model)) && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">
              {isAppointmentsPlanVenue ? 'Set calendar availability' : 'Opening hours & schedules'}
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              {isAppointmentsPlanVenue
                ? `Set when each calendar can take bookings. Guests see a time slot only when business opening hours and the calendar’s working hours both allow it.`
                : `Set when the business accepts appointments and when each ${terms.staff.toLowerCase()} is available. You can adjust breaks, day-off, and custom schedules any time from Calendar availability.`
              }
            </p>

            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
              <p className="mb-2 font-medium text-slate-800">How the hours fit together</p>
              <ul className="list-inside list-disc space-y-1.5 text-slate-600">
                <li>
                  <strong className="text-slate-800">Business opening hours</strong> are the outer window for all
                  bookings.
                </li>
                <li>
                  <strong className="text-slate-800">Calendar working hours</strong> narrow that down per column
                  (for example, one therapist works mornings, another evenings).
                </li>
                <li>A time is bookable only where <strong>both</strong> are open.</li>
              </ul>
              <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
                <p>Example: business 09:00–18:00, therapist 10:00–16:00 → guests can book 10:00–16:00.</p>
                <p>Example: business 09:00–18:00, Room A blocked 14:00–15:00 → no bookings in Room A in that hour.</p>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Breaks, day-off, and date-specific closures can be added from{' '}
                <Link
                  href="/dashboard/calendar-availability"
                  className="font-medium text-brand-600 underline hover:text-brand-700"
                >
                  Calendar availability
                </Link>{' '}
                any time.
              </p>
            </div>
            {!isAppointmentsPlanVenue && (
              <div className="mb-8">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Business opening hours</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Guest booking slots are limited to times when you are open and when staff are working.
                </p>
                <OpeningHoursControl value={openingHoursDraft} onChange={setOpeningHoursDraft} />
              </div>
            )}
            {rosterLoading && rosterList.length === 0 ? (
              <p className="text-sm text-slate-500">Loading your calendars…</p>
            ) : rosterList.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-medium">No calendars loaded</p>
                <p className="mt-1">
                  Go back to the Calendars step, ensure each column has a name, and click Continue to save them.
                  Then return here to set working hours.
                </p>
              </div>
            ) : (
              <div className="space-y-10">
                {rosterList.map((cal) => (
                  <div key={cal.id} className="min-w-0 max-w-full">
                    <h3 className="mb-3 break-words text-sm font-semibold text-slate-800">
                      {cal.name}: working hours
                    </h3>
                    <WorkingHoursControl
                      value={
                        calendarWorkingDraft[cal.id] ??
                        defaultCalendarWorkingHoursFromOpeningHours(openingHoursDraft)
                      }
                      onChange={(wh) =>
                        setCalendarWorkingDraft((prev) => ({
                          ...prev,
                          [cal.id]: wh,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Model C: First event: aligned with dashboard Event manager → Create event */}

        {/* Model D: Classes: class types only (timetable & sessions: dashboard → Class timetable) */}

        {/* Model E: Resources: aligned with dashboard Resource timeline (no date-exception calendar) */}

        {/* Preview & Go Live */}
        {currentStepKey === 'preview' && (
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full ${
                  previewMissing ? 'bg-amber-50' : 'bg-brand-50'
                }`}
              >
                <svg
                  className={`h-8 w-8 ${previewMissing ? 'text-amber-600' : 'text-brand-600'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  {previewMissing ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                    />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  )}
                </svg>
              </div>
            </div>
            <h2 className="mb-2 text-lg font-bold text-slate-900">
              {previewMissing ? 'Your calendars are ready' : "You're all set!"}
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              {previewMissing ? (
                <>
                  Your business details, opening hours, and calendars are saved. There is one thing left
                  before guests can book.
                </>
              ) : venue.booking_model === 'table_reservation' ? (
                <>
                  Your restaurant is ready. Share your booking link below and guests can start making reservations
                  straight away. Refine settings any time from the Availability dashboard.
                </>
              ) : isAppointmentsPlanVenue ? (
                <>
                  Your business is configured and your selected booking models are ready to review in the dashboard.
                  Share the booking link below once you&apos;re happy with how each model looks.
                </>
              ) : (
                <>
                  Your booking page is ready. Share the link below with your {terms.client.toLowerCase()}s.
                </>
              )}
            </p>
            {isAppointmentsPlanVenue && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/90 p-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Ready in this venue
                </p>
                <div className="flex flex-wrap gap-2">
                  {activeAppointmentsModels.map((model) => (
                    <span
                      key={model}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700"
                    >
                      {APPOINTMENTS_MODEL_LABEL[model as AppointmentPlanModel]}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  You can add or remove booking models later from Settings if your business needs change.
                </p>
              </div>
            )}
            {venue.booking_model === 'table_reservation' && (
              <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                  You&apos;re ready to take bookings
                </p>
                <p className="text-sm text-slate-700">
                  Your restaurant is configured. Fine-tune services, capacity, booking rules, and table management
                  any time from your <strong>Availability</strong> dashboard.
                </p>
              </div>
            )}
            {/* `previewMissing` also opens this block for models outside the appointments plan,
                so a venue with an empty catalogue is always told what is left. */}
            {(isAppointmentsPlanVenue || isUnifiedSchedulingVenue(venue.booking_model) || previewMissing) && (
              <div className="mb-6 rounded-xl border border-amber-100 bg-amber-50/80 p-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900/80">
                  {previewMissing ? 'One more thing before guests can book' : 'Before you go live'}
                </p>
                <p className="mb-3 text-sm text-slate-700">
                  {previewMissing
                    ? `Add at least one ${previewMissing.noun} and your booking page goes live straight away. Your dashboard has a short checklist with everything that is left:`
                    : previewCatalogConfirmed &&
                        (!isAppointmentsPlanVenue ||
                          activeAppointmentsModels.includes('unified_scheduling'))
                      ? 'You have already set services, opening hours, and working hours. Before taking paid bookings, finish Stripe Connect and any advanced availability rules in the dashboard:'
                      : 'You have already set opening hours and calendar availability for your team columns. Before taking paid bookings, finish Stripe Connect and refine availability in the dashboard:'}
                </p>
                <ul className="list-inside list-disc space-y-1.5 text-sm text-slate-600">
                  {previewMissing && (
                    <li>
                      <Link href={previewMissing.href} className="font-medium text-brand-600 underline hover:text-brand-700">
                        {previewMissing.linkLabel}
                      </Link>
                      : add your first {previewMissing.noun}
                    </li>
                  )}
                  <li>
                    <Link href="/dashboard/settings" className="font-medium text-brand-600 underline hover:text-brand-700">
                      Settings
                    </Link>
                    : Stripe Connect and venue payment options
                  </li>
                  <li>
                    <Link href="/dashboard/calendar-availability" className="font-medium text-brand-600 underline hover:text-brand-700">
                      Calendar availability
                    </Link>
                    : breaks, closures, and fine-tune schedules anytime
                  </li>
                </ul>
              </div>
            )}
            {!isAppointmentsPlanVenue && enabledSecondaryModels.length > 0 && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/90 p-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Additional booking types enabled
                </p>
                <p className="mb-3 text-sm text-slate-700">
                  You have extra bookable types on this venue. Finish their catalogues from the dashboard - the setup
                  checklist will link to Events, Classes, or Resources as needed.
                </p>
                <ul className="list-inside list-disc space-y-1.5 text-sm text-slate-600">
                  {enabledSecondaryModels.includes('event_ticket') && (
                    <li>
                      <Link href="/dashboard/event-manager" className="font-medium text-brand-600 underline hover:text-brand-700">
                        Events
                      </Link>
                    </li>
                  )}
                  {enabledSecondaryModels.includes('class_session') && (
                    <li>
                      <Link href="/dashboard/class-timetable" className="font-medium text-brand-600 underline hover:text-brand-700">
                        Classes & timetable
                      </Link>
                    </li>
                  )}
                  {enabledSecondaryModels.includes('resource_booking') && (
                    <li>
                      <Link href="/dashboard/resource-timeline" className="font-medium text-brand-600 underline hover:text-brand-700">
                        Resources
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            )}
            {venue.slug && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-400 mb-1">
                  {previewMissing ? 'Your booking page address' : 'Your booking page'}
                </p>
                <p className="text-sm font-medium text-brand-600 break-all">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/book/
                  {venue.slug}
                </p>
                {previewMissing && (
                  <p className="mt-2 text-xs text-slate-500">
                    Guests will see an empty page until you add your first {previewMissing.noun}.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Back button for restaurant self-managed steps */}
        {RESTAURANT_SELF_MANAGED_STEPS.has(currentStepKey) && step > 0 && !saving && (
          <div className="mt-6 flex">
            <button
              type="button"
              onClick={() => {
                setRevisitedStepIndex(step - 1);
                setStep(step - 1);
              }}
              className="min-h-11 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto"
            >
              Back
            </button>
          </div>
        )}

        {/* Navigation: hidden for restaurant self-managed steps (they render their own CTAs) */}
        {!RESTAURANT_SELF_MANAGED_STEPS.has(currentStepKey) && (
          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            {step > 0 && !saving ? (
              <button
                type="button"
                onClick={() => {
                  setRevisitedStepIndex(step - 1);
                  setStep(step - 1);
                }}
                className="min-h-11 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto"
              >
                Back
              </button>
            ) : (
              <div className="hidden sm:block" />
            )}
            {currentStepKey === 'preview' ? (
              <button
                type="button"
                onClick={handleGoLive}
                disabled={saving}
                className="min-h-11 w-full rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
              >
                {saving ? 'Finishing...' : 'Go to Dashboard'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving}
                className="min-h-11 w-full rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
              >
                {saving ? 'Saving...' : 'Continue'}
              </button>
            )}
          </div>
        )}
      </div>

    </OnboardingShell>
  );
}
