import type { SupabaseClient } from '@supabase/supabase-js';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';
import {
  bookingDatetime,
  loadAndResolveServiceRequirements,
  summariseBlocking,
  type EnforcementContext,
} from '@/lib/compliance/resolve-requirements';
import { COMPLIANCE_REQUIREMENT_UNMET } from '@/lib/compliance/constants';

export { COMPLIANCE_REQUIREMENT_UNMET };

export interface BookingComplianceCheck {
  blocked: boolean;
  details: Array<{
    compliance_type_id: string;
    compliance_type_name: string;
    enforcement: string;
    state: string;
  }>;
}

const ALLOWED: BookingComplianceCheck = { blocked: false, details: [] };

/**
 * Friendly, guest-safe message for a blocked booking (improvement plan Phase 2).
 * Returned alongside the `error` code so any client (esp. the public booking page)
 * can surface something actionable instead of a raw code.
 */
export function complianceUnmetMessage(
  details: BookingComplianceCheck['details'],
  context: EnforcementContext,
): string {
  const names = [...new Set(details.map((d) => d.compliance_type_name))];
  if (names.length === 0) {
    return 'This booking needs a compliance record that isn’t on file yet.';
  }
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  if (context === 'online') {
    return `Before booking online, the following must be completed: ${list}. Please contact the venue if you’ve already done this or need help.`;
  }
  return `This booking requires the following on file: ${list}.`;
}

/**
 * Gate booking creation/edit on unmet compliance requirements (spec §5.1).
 *
 * Short-circuits (returns allowed) whenever compliance does not apply:
 *   - the booking is not Model B (no service FK) — §5.0
 *   - the venue is not on an Appointments tier, or the feature flag is off
 *   - the service has no requirements, or none are blocking in this context
 *
 * Only `block_online` (online context) and `block_all` (any context) block.
 */
export async function checkBookingCompliance(
  admin: SupabaseClient,
  params: {
    venueId: string;
    guestId: string | null;
    appointmentServiceId: string | null;
    serviceItemId: string | null;
    bookingDate: string;
    bookingTime: string | null;
    context: EnforcementContext;
  },
): Promise<BookingComplianceCheck> {
  if (!params.appointmentServiceId && !params.serviceItemId) return ALLOWED;

  // Compliance must be active for the venue (tier + flag).
  const { data: venue } = await admin
    .from('venues')
    .select('pricing_tier, feature_flags')
    .eq('id', params.venueId)
    .maybeSingle();
  if (!venue) return ALLOWED;
  const tier = (venue as { pricing_tier?: string | null }).pricing_tier ?? null;
  if (!isAppointmentPlanTier(tier)) return ALLOWED;
  const flags = parseVenueFeatureFlags((venue as { feature_flags?: unknown }).feature_flags);
  if (!resolveAppointmentsFeatureFlag('compliance_records_enabled', flags)) return ALLOWED;

  const resolution = await loadAndResolveServiceRequirements(admin, {
    venueId: params.venueId,
    guestId: params.guestId,
    appointmentServiceId: params.appointmentServiceId,
    serviceItemId: params.serviceItemId,
    bookingDatetime: bookingDatetime(params.bookingDate, params.bookingTime),
  });
  if (!resolution.applicable) return ALLOWED;

  const summary = summariseBlocking(resolution.resolved, params.context);
  if (!summary.blocked) return ALLOWED;

  return {
    blocked: true,
    details: summary.unmet.map((u) => ({
      compliance_type_id: u.compliance_type_id,
      compliance_type_name: u.compliance_type_name,
      enforcement: u.enforcement,
      state: u.state,
    })),
  };
}
