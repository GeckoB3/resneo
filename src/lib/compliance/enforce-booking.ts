import type { SupabaseClient } from '@supabase/supabase-js';
import { complianceEnabledForVenue } from '@/lib/compliance/venue-enabled';
import {
  bookingDatetime,
  loadAndResolveServiceRequirements,
  summariseBlocking,
  type ComplianceWarningSeverity,
  type EnforcementContext,
} from '@/lib/compliance/resolve-requirements';
import { COMPLIANCE_REQUIREMENT_UNMET } from '@/lib/compliance/constants';

export { COMPLIANCE_REQUIREMENT_UNMET };

export interface ComplianceDetailBrief {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  state: string;
  /** `required` for a block_all rule, `advisory` otherwise (see resolve-requirements). */
  severity: ComplianceWarningSeverity;
}

export interface BookingComplianceCheck {
  blocked: boolean;
  /** Unmet requirements that block creation in this context. */
  details: ComplianceDetailBrief[];
  /**
   * Unmet requirements that do not block here, `required` first. For staff that is every
   * unmet requirement, since staff are never blocked (plan §5); online it is the warn_* rules.
   */
  warnings: ComplianceDetailBrief[];
}

const ALLOWED: BookingComplianceCheck = { blocked: false, details: [], warnings: [] };

/**
 * Friendly, guest-safe message for a blocked booking (improvement plan Phase 2).
 * Returned alongside the `error` code so any client (esp. the public booking page)
 * can surface something actionable instead of a raw code.
 */
export function complianceUnmetMessage(
  details: ReadonlyArray<Pick<ComplianceDetailBrief, 'compliance_type_name'>>,
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
 * Only the online context can be blocked (`block_online` / `block_all`). Staff always
 * proceed and receive the unmet requirements as `warnings` (plan §5, 2026-09-01).
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
  if (!(await complianceEnabledForVenue(admin, params.venueId))) return ALLOWED;

  const resolution = await loadAndResolveServiceRequirements(admin, {
    venueId: params.venueId,
    guestId: params.guestId,
    appointmentServiceId: params.appointmentServiceId,
    serviceItemId: params.serviceItemId,
    bookingDatetime: bookingDatetime(params.bookingDate, params.bookingTime),
  });
  if (!resolution.applicable) return ALLOWED;

  const summary = summariseBlocking(resolution.resolved, params.context);
  const toBrief = (b: (typeof summary.warnings)[number]): ComplianceDetailBrief => ({
    compliance_type_id: b.compliance_type_id,
    compliance_type_name: b.compliance_type_name,
    enforcement: b.enforcement,
    state: b.state,
    severity: b.severity,
  });
  const warnings = summary.warnings.map(toBrief);
  if (!summary.blocked) return { blocked: false, details: [], warnings };

  return { blocked: true, details: summary.unmet.map(toBrief), warnings };
}

export interface ComplianceGateInput {
  venueId: string;
  guestId: string | null;
  appointmentServiceId: string | null;
  serviceItemId: string | null;
  bookingDate: string;
  bookingTime: string | null;
  context: EnforcementContext;
}

export interface ComplianceGateResult {
  /** True when the write must be rejected. Never true in the staff context (plan §5). */
  blocked: boolean;
  details: BookingComplianceCheck['details'];
  /** Non-blocking unmet requirements, `required` first; staff surfaces show these. */
  warnings: BookingComplianceCheck['warnings'];
  /** Canonical 409 JSON body to return when `blocked`; undefined otherwise. */
  body?: {
    error: typeof COMPLIANCE_REQUIREMENT_UNMET;
    message: string;
    details: BookingComplianceCheck['details'];
  };
}

/**
 * Single gate every Model B booking write path should call (spec §5.1). Wraps
 * {@link checkBookingCompliance} and prepares the canonical 409 body so call sites
 * cannot drift on shape. Callers that gate multiple segments (multi-service / group)
 * should call this per segment, collect `details` from results where `blocked` is
 * true, and merge `warnings` by type for the staff response.
 *
 * There is no staff override any more: staff are never blocked, so nothing is left
 * to override (the former `override_compliance` request field was removed 2026-09-01).
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
  if (!check.blocked) {
    return { blocked: false, details: check.details, warnings: check.warnings };
  }
  return {
    blocked: true,
    details: check.details,
    warnings: check.warnings,
    body: {
      error: COMPLIANCE_REQUIREMENT_UNMET,
      message: complianceUnmetMessage(check.details, input.context),
      details: check.details,
    },
  };
}
