import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags/resolve';

export type ClassCommerceAuthFailure =
  | 'wrong_tier'
  | 'model_not_enabled'
  | 'flag_disabled'
  | 'not_found';

export type ClassCommerceAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse; reason: ClassCommerceAuthFailure };

/**
 * Phase 2 §5.1 — gate every class-commerce staff entry point on:
 *   1. Appointment-plan tier (light/plus/appointments — not restaurant SKUs).
 *   2. `class_session` model exposed (primary or secondary).
 *   3. Per-venue `class_commerce_enabled` feature flag (staged rollout).
 *
 * Always pass the **admin** Supabase client; this function only reads venue rows
 * via service role to keep the gate consistent with the rest of the subsystem.
 */
export async function requireClassCommercePlan(
  admin: SupabaseClient,
  venueId: string,
): Promise<ClassCommerceAuthResult> {
  const { data: venue, error } = await admin
    .from('venues')
    .select('pricing_tier, feature_flags')
    .eq('id', venueId)
    .maybeSingle();

  if (error || !venue) {
    return {
      ok: false,
      reason: 'not_found',
      response: NextResponse.json({ error: 'Venue not found' }, { status: 404 }),
    };
  }

  const pricingTier = (venue as { pricing_tier?: string | null }).pricing_tier ?? '';
  if (!isAppointmentPlanTier(pricingTier)) {
    return {
      ok: false,
      reason: 'wrong_tier',
      response: NextResponse.json(
        { error: 'Class commerce is available on Appointments plans only.' },
        { status: 403 },
      ),
    };
  }

  const modelGate = await requireVenueExposesSecondaryModel(admin, venueId, 'class_session');
  if (!modelGate.ok) {
    return { ok: false, reason: 'model_not_enabled', response: modelGate.response };
  }

  const flags = parseVenueFeatureFlags((venue as { feature_flags?: unknown }).feature_flags);
  const flagOn = resolveAppointmentsFeatureFlag('class_commerce_enabled', flags);
  if (!flagOn) {
    return {
      ok: false,
      reason: 'flag_disabled',
      response: NextResponse.json(
        { error: 'Class commerce is not enabled for this venue.' },
        { status: 403 },
      ),
    };
  }

  return { ok: true };
}

/**
 * Lighter helper for server components that just need to know whether to render
 * class-commerce surfaces. No NextResponse; returns true/false.
 */
export async function venueHasClassCommerceEnabled(
  admin: SupabaseClient,
  venueId: string,
): Promise<boolean> {
  const result = await requireClassCommercePlan(admin, venueId);
  return result.ok;
}
