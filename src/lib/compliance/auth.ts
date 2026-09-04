import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VenueStaff } from '@/lib/venue-auth';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';
import type { VenueFeatureFlags } from '@/lib/feature-flags/types';
import { parseComplianceConfig, type ComplianceConfig } from '@/lib/compliance/config';

/**
 * Context returned once a venue has passed the compliance plan + flag gate.
 * Routes use `config` for defaults (link expiry, lock period, auto-send, …).
 */
export interface CompliancePlanContext {
  venueId: string;
  pricingTier: string | null;
  config: ComplianceConfig;
  featureFlags: VenueFeatureFlags;
}

export type CompliancePlanGate =
  | { ok: true; ctx: CompliancePlanContext }
  | { ok: false; response: NextResponse };

/**
 * The plan + flag gate for one venue's compliance data (spec §9.3): an
 * Appointments plan tier AND the `compliance_records_enabled` feature flag.
 *
 * Takes the venue rather than the caller so a read through a link can gate on
 * the venue that OWNS the records; `requireCompliancePlan` is the caller's-own
 * case. On failure returns a ready-to-send 403 response.
 */
export async function requireCompliancePlanForVenue(
  db: SupabaseClient,
  venueId: string,
): Promise<CompliancePlanGate> {
  const { data: venue, error } = await db
    .from('venues')
    .select('id, pricing_tier, feature_flags')
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.error('[requireCompliancePlan] venue lookup failed:', error.message, { venueId });
    return {
      ok: false,
      response: NextResponse.json({ error: 'Could not verify plan availability.' }, { status: 500 }),
    };
  }

  const tier = (venue as { pricing_tier?: string | null } | null)?.pricing_tier ?? null;
  if (!isAppointmentPlanTier(tier)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Feature not available on this plan.' }, { status: 403 }),
    };
  }

  const raw = parseVenueFeatureFlags((venue as { feature_flags?: unknown } | null)?.feature_flags);
  if (!resolveAppointmentsFeatureFlag('compliance_records_enabled', raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Feature not available', code: 'feature_disabled', feature: 'compliance_records_enabled' },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      venueId,
      pricingTier: tier,
      config: parseComplianceConfig(raw),
      featureFlags: raw,
    },
  };
}

/** Single-line guard for every `/api/venue/compliance/*` route: the caller's own venue. */
export async function requireCompliancePlan(staff: VenueStaff): Promise<CompliancePlanGate> {
  return requireCompliancePlanForVenue(staff.db, staff.venue_id);
}
