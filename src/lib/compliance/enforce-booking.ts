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

interface ComplianceDetailBrief {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  state: string;
}

export interface BookingComplianceCheck {
  blocked: boolean;
  /** Unmet requirements that block creation in this context. */
  details: ComplianceDetailBrief[];
  /** Unmet warn_staff / warn_client requirements: non-blocking, surfaced to staff (audit M2). */
  warnings: ComplianceDetailBrief[];
}

const ALLOWED: BookingComplianceCheck = { blocked: false, details: [], warnings: [] };

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
  const warnings = summary.warnings.map((w) => ({
    compliance_type_id: w.compliance_type_id,
    compliance_type_name: w.compliance_type_name,
    enforcement: w.enforcement,
    state: w.state,
  }));
  if (!summary.blocked) return { blocked: false, details: [], warnings };

  return {
    blocked: true,
    details: summary.unmet.map((u) => ({
      compliance_type_id: u.compliance_type_id,
      compliance_type_name: u.compliance_type_name,
      enforcement: u.enforcement,
      state: u.state,
    })),
    warnings,
  };
}

export interface ComplianceGateInput {
  venueId: string;
  guestId: string | null;
  appointmentServiceId: string | null;
  serviceItemId: string | null;
  bookingDate: string;
  bookingTime: string | null;
  context: EnforcementContext;
  /**
   * Staff context only: when true (the CALLER must have verified the actor is an
   * admin) a block is acknowledged and the booking proceeds (§5.2). Ignored in the
   * online context, where a guest can never override a block.
   */
  adminOverride?: boolean;
}

export interface ComplianceGateResult {
  /** True when the write must be rejected (blocked and not overridden). */
  blocked: boolean;
  details: BookingComplianceCheck['details'];
  /** Canonical 409 JSON body to return when `blocked`; undefined otherwise. */
  body?: {
    error: typeof COMPLIANCE_REQUIREMENT_UNMET;
    message: string;
    details: BookingComplianceCheck['details'];
  };
}

/**
 * Single gate every Model B booking write path should call (spec §5.1). Wraps
 * {@link checkBookingCompliance}, applies the staff admin-override (§5.2), and
 * prepares the canonical 409 body so call sites cannot drift on shape. Callers
 * that gate multiple segments (multi-service / group) should call this per
 * segment and collect `details` from results where `blocked` is true.
 */
export async function enforceBookingCompliance(
  admin: SupabaseClient,
  input: ComplianceGateInput,
): Promise<ComplianceGateResult> {
  const check = await checkBookingCompliance(admin, {
    venueId: input.venueId,
    guestId: input.guestId,
    appointmentServiceId: input.appointmentServiceId,
    serviceItemId: input.serviceItemId,
    bookingDate: input.bookingDate,
    bookingTime: input.bookingTime,
    context: input.context,
  });
  const overridden = input.context === 'staff' && input.adminOverride === true;
  if (!check.blocked || overridden) {
    return { blocked: false, details: check.details };
  }
  return {
    blocked: true,
    details: check.details,
    body: {
      error: COMPLIANCE_REQUIREMENT_UNMET,
      message: complianceUnmetMessage(check.details, input.context),
      details: check.details,
    },
  };
}
