'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ResolvedAppointmentsFeatureFlags } from '@/lib/feature-flags';

const DEFAULT_FLAGS: ResolvedAppointmentsFeatureFlags = {
  waitlist_v2: false,
  guest_self_reschedule: false,
  any_available_practitioner: false,
};

const VenueFeatureFlagsContext = createContext<ResolvedAppointmentsFeatureFlags>(DEFAULT_FLAGS);

export function useVenueFeatureFlags(): ResolvedAppointmentsFeatureFlags {
  return useContext(VenueFeatureFlagsContext);
}

export function useAppointmentsFeatureFlag(
  flag: keyof ResolvedAppointmentsFeatureFlags,
): boolean {
  const flags = useVenueFeatureFlags();
  return flags[flag];
}

export function VenueFeatureFlagsProvider({
  flags,
  children,
}: {
  flags: ResolvedAppointmentsFeatureFlags;
  children: ReactNode;
}) {
  return (
    <VenueFeatureFlagsContext.Provider value={flags}>{children}</VenueFeatureFlagsContext.Provider>
  );
}
