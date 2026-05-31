'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { DASHBOARD_LIVE_POLL_MS } from '@/lib/realtime/dashboard-sync-constants';
import {
  registerVenuePostgresLiveSync,
  subscribeVenuePostgresLiveSyncState,
  syncVenuePostgresLiveSyncRegistration,
  unregisterVenuePostgresLiveSync,
} from '@/lib/realtime/venue-postgres-live-sync-registry';

export type LiveSyncState = 'live' | 'reconnecting';

export type PostgresLiveSubscription = {
  table: string;
  /** Supabase realtime filter, e.g. `venue_id=eq.${venueId}` */
  filter?: string;
  /** When set, receives postgres change payloads instead of the shared `onRefresh`. */
  handler?: (payload: {
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
  }) => void;
};

export { DASHBOARD_LIVE_POLL_MS };

interface UseVenuePostgresLiveSyncOptions {
  venueId?: string;
  /** Called for subscription events without a custom handler, and during polling fallback. */
  onRefresh: () => void;
  subscriptions: PostgresLiveSubscription[];
  pollMs?: number;
  /** When false, skips subscribing (e.g. missing venue id). */
  enabled?: boolean;
}

/**
 * Subscribe to Supabase postgres changes for staff dashboard views.
 * One shared channel + one poll timer per venue (all dashboard views combined).
 */
export function useVenuePostgresLiveSync({
  venueId,
  onRefresh,
  subscriptions,
  pollMs = DASHBOARD_LIVE_POLL_MS,
  enabled = true,
}: UseVenuePostgresLiveSyncOptions): LiveSyncState {
  const [state, setState] = useState<LiveSyncState>('reconnecting');
  const registrationId = useId();
  const onRefreshRef = useRef(onRefresh);
  const subscriptionsRef = useRef(subscriptions);

  const subscriptionKey = subscriptions
    .map((sub) => `${sub.table}:${sub.filter ?? ''}:${sub.handler ? 'h' : 'r'}`)
    .join('|');

  const effectSignature = `${enabled ? '1' : '0'}|${venueId ?? ''}|${pollMs}|${subscriptionKey}`;

  const buildRegistration = () => ({
    getSubscriptions: () => subscriptionsRef.current,
    onRefresh: () => {
      onRefreshRef.current();
    },
    pollMs,
  });

  useLayoutEffect(() => {
    onRefreshRef.current = onRefresh;
    subscriptionsRef.current = subscriptions;
  });

  useLayoutEffect(() => {
    if (!enabled || !venueId || subscriptionsRef.current.length === 0) return;
    syncVenuePostgresLiveSyncRegistration(venueId, registrationId, buildRegistration());
  });

  useEffect(() => {
    if (!enabled || !venueId || subscriptionsRef.current.length === 0) {
      return undefined;
    }

    const stableVenueId = venueId;
    const stableRegistrationId = registrationId;

    registerVenuePostgresLiveSync(stableVenueId, stableRegistrationId, buildRegistration());

    const unsubscribeState = subscribeVenuePostgresLiveSyncState(
      stableVenueId,
      stableRegistrationId,
      setState,
    );

    return () => {
      unsubscribeState();
      unregisterVenuePostgresLiveSync(stableVenueId, stableRegistrationId);
    };
  }, [effectSignature, pollMs, registrationId, venueId]);

  return state;
}
