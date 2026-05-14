import type { VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { hasServiceConfig } from '@/lib/availability';
import { computeGuestBookingReady } from '@/lib/setup-guest-booking-ready';
import type { BookingModel } from '@/types/booking-models';
import {
  activeModelsToLegacyEnabledModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';

export interface SetupStatus {
  /** True when this staff row has dismissed the dashboard checklist (X) or it was recorded on completion. */
  setup_checklist_dismissed: boolean;
  onboarding_completed: boolean;
  pricing_tier: string | null;
  profile_complete: boolean;
  availability_set: boolean;
  guest_booking_ready: boolean;
  stripe_connected: boolean;
  first_booking_made: boolean;
  is_admin: boolean;
  booking_model: BookingModel;
  active_booking_models: BookingModel[];
  enabled_models: BookingModel[];
  secondary_event_catalog_ready: boolean;
  secondary_class_catalog_ready: boolean;
  secondary_resource_catalog_ready: boolean;
}

async function checkAvailabilitySet(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  model: BookingModel,
): Promise<boolean> {
  switch (model) {
    case 'practitioner_appointment':
    case 'unified_scheduling': {
      const { count: prCount } = await admin
        .from('practitioners')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId);
      if ((prCount ?? 0) > 0) return true;
      const { count: ucCount } = await admin
        .from('unified_calendars')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .neq('calendar_type', 'resource');
      return (ucCount ?? 0) > 0;
    }
    case 'event_ticket': {
      const { count } = await admin
        .from('experience_events')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId);
      return (count ?? 0) > 0;
    }
    case 'class_session': {
      const { count } = await admin
        .from('class_types')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId);
      return (count ?? 0) > 0;
    }
    case 'resource_booking': {
      const { count } = await admin
        .from('unified_calendars')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .eq('calendar_type', 'resource');
      return (count ?? 0) > 0;
    }
    default: {
      return hasServiceConfig(admin, venueId);
    }
  }
}

/** Build setup checklist payload for the authenticated staff member (same as GET /api/venue/setup-status). */
export async function computeSetupStatus(staff: VenueStaff): Promise<SetupStatus> {
  const venueId = staff.venue_id;

  const { data: venue } = await staff.db
    .from('venues')
    .select(
      'name, address, phone, stripe_connected_account_id, booking_model, enabled_models, active_booking_models, pricing_tier, onboarding_completed',
    )
    .eq('id', venueId)
    .single();

  if (!venue) {
    throw new Error('Venue not found');
  }

  const activeModels = resolveActiveBookingModels({
    pricingTier: (venue as { pricing_tier?: string | null }).pricing_tier,
    bookingModel: venue.booking_model as BookingModel | undefined,
    enabledModels: (venue as { enabled_models?: unknown }).enabled_models,
    activeBookingModels: (venue as { active_booking_models?: unknown }).active_booking_models,
  });
  const bookingModel = getDefaultBookingModelFromActive(
    activeModels,
    (venue.booking_model as BookingModel) ?? 'table_reservation',
  );
  const enabledModels = activeModelsToLegacyEnabledModels(activeModels, bookingModel);
  const profileComplete = Boolean(venue.name && venue.address && venue.phone);

  const admin = getSupabaseAdminClient();
  const availabilitySet = await checkAvailabilitySet(admin, venueId, bookingModel);

  const guestBookingReady = await computeGuestBookingReady(
    admin,
    venueId,
    bookingModel,
    availabilitySet,
  );

  async function secondaryCatalogReady(m: BookingModel): Promise<boolean> {
    if (!enabledModels.includes(m)) return true;
    return checkAvailabilitySet(admin, venueId, m);
  }

  const [secondaryEventCatalogReady, secondaryClassCatalogReady, secondaryResourceCatalogReady] =
    await Promise.all([
      secondaryCatalogReady('event_ticket'),
      secondaryCatalogReady('class_session'),
      secondaryCatalogReady('resource_booking'),
    ]);

  let stripeConnected = false;
  if (venue.stripe_connected_account_id) {
    try {
      const account = await stripe.accounts.retrieve(venue.stripe_connected_account_id);
      stripeConnected = account.charges_enabled === true && account.details_submitted === true;
    } catch {
      /* Stripe fetch failed */
    }
  }

  const { count: bookingCount } = await staff.db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);

  const firstBookingMade = (bookingCount ?? 0) > 0;

  const { data: staffDismissRow } = await staff.db
    .from('staff')
    .select('dashboard_setup_checklist_dismissed_at')
    .eq('id', staff.id)
    .maybeSingle();

  const setupChecklistDismissed =
    (staffDismissRow as { dashboard_setup_checklist_dismissed_at?: string | null } | null)
      ?.dashboard_setup_checklist_dismissed_at != null;

  return {
    setup_checklist_dismissed: setupChecklistDismissed,
    onboarding_completed: (venue as { onboarding_completed?: boolean }).onboarding_completed === true,
    pricing_tier: ((venue as { pricing_tier?: string | null }).pricing_tier ?? null) as string | null,
    profile_complete: profileComplete,
    availability_set: availabilitySet,
    guest_booking_ready: guestBookingReady,
    stripe_connected: stripeConnected,
    first_booking_made: firstBookingMade,
    is_admin: staff.role === 'admin',
    booking_model: bookingModel,
    active_booking_models: activeModels,
    enabled_models: enabledModels,
    secondary_event_catalog_ready: secondaryEventCatalogReady,
    secondary_class_catalog_ready: secondaryClassCatalogReady,
    secondary_resource_catalog_ready: secondaryResourceCatalogReady,
  };
}
