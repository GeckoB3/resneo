import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import AvailabilitySettingsClient from './AvailabilitySettingsClient';
import type { BookingModel } from '@/types/booking-models';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';
import { shouldShowAppointmentAvailabilitySettings } from '@/lib/booking/schedule-calendar-eligibility';
import {
  activeModelsToLegacyEnabledModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { computeSmsMonthlyAllowance, updateVenueSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { loadVenueFeatureFlags } from '@/lib/feature-flags/venue';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import type { VenueSettings } from '@/app/dashboard/settings/types';
import { isRestaurantTableProductTier } from '@/lib/tier-enforcement';

const VALID_TABS = ['services', 'table', 'layout', 'tables', 'combinations'] as const;
type ValidTab = (typeof VALID_TABS)[number];

const VALID_FLOOR_PLAN_TABS = ['layout', 'tables', 'combinations'] as const;
type ValidFloorPlanTab = (typeof VALID_FLOOR_PLAN_TABS)[number];

/** Legacy URLs (?tab=capacity|duration|rules) map to the consolidated Services workspace. */
function resolveSearchTab(tab: string | undefined, fp: string | undefined): ValidTab | undefined {
  // Legacy nested floor URLs: ?tab=table&fp=layout → layout (same row as Services).
  if (tab === 'table' && fp && VALID_FLOOR_PLAN_TABS.includes(fp as ValidFloorPlanTab)) {
    return fp as ValidFloorPlanTab;
  }
  if (!tab) return undefined;
  if (tab === 'capacity' || tab === 'duration' || tab === 'rules') return 'services';
  return VALID_TABS.includes(tab as ValidTab) ? (tab as ValidTab) : undefined;
}

/** Drop layout/combinations when the venue is in simple covers mode; non-table tiers → services. */
function normalizeTabForVenue(
  tab: ValidTab | undefined,
  venue: VenueSettings | null,
  isRestaurantTableTier: boolean,
): ValidTab {
  const fallback: ValidTab = 'services';
  if (!venue) return tab ?? fallback;
  if (!isRestaurantTableTier) return fallback;
  const resolved = tab ?? fallback;
  if (!venue.table_management_enabled && (resolved === 'layout' || resolved === 'combinations')) {
    return 'tables';
  }
  return resolved;
}

export default async function AvailabilitySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; fp?: string }>;
}) {
  const supabase = await createClient();

  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    redirect('/dashboard');
  }

  const admin = getSupabaseAdminClient();
  const { data: venueRow } = await admin
    .from('venues')
    .select('booking_model, enabled_models')
    .eq('id', staff.venue_id)
    .single();
  const bookingModel = (venueRow?.booking_model as BookingModel) ?? 'table_reservation';
  const enabledModels = normalizeEnabledModels(
    (venueRow as { enabled_models?: unknown } | null)?.enabled_models,
    bookingModel,
  );

  if (bookingModel !== 'table_reservation') {
    if (shouldShowAppointmentAvailabilitySettings(bookingModel, enabledModels)) {
      redirect('/dashboard/calendar-availability');
    }
    redirect('/dashboard');
  }

  if (staff.role !== 'admin') {
    redirect('/dashboard');
  }

  const venueId = staff.venue_id;
  let venue: VenueSettings | null = null;
  let hasServiceConfig = false;

  const { data: fullVenue, error: fullErr } = await staff.db
    .from('venues')
    .select(
      'id, name, slug, address, phone, email, website_url, cover_photo_url, logo_url, cuisine_type, price_band, no_show_grace_minutes, kitchen_email, communication_templates, opening_hours, venue_opening_exceptions, booking_rules, deposit_config, availability_config, stripe_connected_account_id, timezone, table_management_enabled, combination_threshold, pricing_tier, plan_status, subscription_current_period_end, calendar_count, booking_model, enabled_models, active_booking_models, sms_monthly_allowance, public_booking_area_mode',
    )
    .eq('id', venueId)
    .single();

  if (fullVenue) {
    venue = {
      ...fullVenue,
      venue_opening_exceptions: parseVenueOpeningExceptions(
        (fullVenue as { venue_opening_exceptions?: unknown }).venue_opening_exceptions,
      ),
    } as VenueSettings;
    const pt = ((fullVenue as { pricing_tier?: string | null }).pricing_tier ?? 'appointments') as string;
    const cc = (fullVenue as { calendar_count?: number | null }).calendar_count ?? null;
    const expectedAllowance = computeSmsMonthlyAllowance(pt, cc);
    const stored = (fullVenue as { sms_monthly_allowance?: number | null }).sms_monthly_allowance;
    if (stored !== expectedAllowance && venueId) {
      await updateVenueSmsMonthlyAllowance(venueId);
      venue = { ...venue, sms_monthly_allowance: expectedAllowance };
    }
  } else {
    console.error('Availability page full venue query failed, trying basic columns:', fullErr?.message);
    const { data: basicVenue } = await staff.db
      .from('venues')
      .select(
        'id, name, slug, address, phone, email, website_url, cover_photo_url, logo_url, opening_hours, booking_rules, deposit_config, availability_config, timezone, table_management_enabled, combination_threshold, booking_model, enabled_models, active_booking_models, pricing_tier',
      )
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
    const activeModels = resolveActiveBookingModels({
      pricingTier: (venue as { pricing_tier?: string | null }).pricing_tier,
      bookingModel: venue.booking_model as BookingModel | undefined,
      enabledModels: (venue as { enabled_models?: unknown }).enabled_models,
      activeBookingModels: (venue as { active_booking_models?: unknown }).active_booking_models,
    });
    const bm = getDefaultBookingModelFromActive(
      activeModels,
      (venue.booking_model as BookingModel) ?? 'table_reservation',
    );
    venue = {
      ...venue,
      booking_model: bm,
      active_booking_models: activeModels,
      enabled_models: activeModelsToLegacyEnabledModels(activeModels, bm),
    };
  }

  const { count } = await staff.db
    .from('venue_services')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('is_active', true);
  hasServiceConfig = (count ?? 0) > 0;

  const sp = await searchParams;
  const isRestaurantTableTier =
    venue != null && isRestaurantTableProductTier(venue.pricing_tier);
  const rawTab = resolveSearchTab(sp.tab, sp.fp);
  const initialTab = normalizeTabForVenue(rawTab, venue, Boolean(isRestaurantTableTier));

  const { resolved: featureFlags } = await loadVenueFeatureFlags(admin, venueId);

  return (
    <AvailabilitySettingsClient
      initialVenue={venue}
      hasServiceConfig={hasServiceConfig}
      initialTab={initialTab}
      cardHoldDepositsEnabled={featureFlags.card_hold_deposits}
    />
  );
}
