'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS,
  type ResolvedAppointmentsFeatureFlags,
} from '@/lib/feature-flags';

const DEFAULT_FLAGS: ResolvedAppointmentsFeatureFlags = DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS;

const VenueFeatureFlagsContext = createContext<ResolvedAppointmentsFeatureFlags>(DEFAULT_FLAGS);

/**
 * Updater for the flags context, used by the settings Feature flags section so
 * a toggle takes effect across the dashboard immediately. The dashboard layout
 * (a server component) supplies the flags once per server render; without this,
 * client-side navigation keeps every `useAppointmentsFeatureFlag` consumer on
 * the value from the initial page load until a hard refresh.
 */
const VenueFeatureFlagsUpdaterContext = createContext<
  ((flags: ResolvedAppointmentsFeatureFlags) => void) | null
>(null);

export function useVenueFeatureFlags(): ResolvedAppointmentsFeatureFlags {
  return useContext(VenueFeatureFlagsContext);
}

export function useAppointmentsFeatureFlag(
  flag: keyof ResolvedAppointmentsFeatureFlags,
): boolean {
  const flags = useVenueFeatureFlags();
  return flags[flag];
}

/** Push freshly-saved flags into the provider; null outside the dashboard provider. */
export function useUpdateVenueFeatureFlags():
  | ((flags: ResolvedAppointmentsFeatureFlags) => void)
  | null {
  return useContext(VenueFeatureFlagsUpdaterContext);
}

export function VenueFeatureFlagsProvider({
  flags,
  children,
}: {
  flags: ResolvedAppointmentsFeatureFlags;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState(flags);

  // A server re-render (full load, router.refresh) supplies fresh flags: adopt
  // them as the new baseline. Adjust-state-during-render, not an effect, so
  // children never see one frame of the stale value.
  const [prevServerFlags, setPrevServerFlags] = useState(flags);
  if (flags !== prevServerFlags) {
    setPrevServerFlags(flags);
    setCurrent(flags);
  }

  return (
    <VenueFeatureFlagsUpdaterContext.Provider value={setCurrent}>
      <VenueFeatureFlagsContext.Provider value={current}>
        {children}
      </VenueFeatureFlagsContext.Provider>
    </VenueFeatureFlagsUpdaterContext.Provider>
  );
}
