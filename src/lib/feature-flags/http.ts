import { NextResponse } from 'next/server';
import type { AppointmentsFeatureFlagKey } from '@/lib/feature-flags/types';
import { resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';
import type { VenueFeatureFlags } from '@/lib/feature-flags/types';

export class FeatureFlagDisabledError extends Error {
  readonly flag: AppointmentsFeatureFlagKey;

  constructor(flag: AppointmentsFeatureFlagKey) {
    super(`Feature "${flag}" is not enabled for this venue`);
    this.name = 'FeatureFlagDisabledError';
    this.flag = flag;
  }
}

export function assertAppointmentsFeatureEnabled(
  flag: AppointmentsFeatureFlagKey,
  venueFlags: VenueFeatureFlags | null | undefined,
): void {
  if (!resolveAppointmentsFeatureFlag(flag, venueFlags)) {
    throw new FeatureFlagDisabledError(flag);
  }
}

export function featureFlagDisabledResponse(flag: AppointmentsFeatureFlagKey): NextResponse {
  return NextResponse.json(
    {
      error: 'Feature not available',
      code: 'feature_disabled',
      feature: flag,
    },
    { status: 403 },
  );
}
