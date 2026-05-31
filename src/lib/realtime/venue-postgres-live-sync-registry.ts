'use client';

import { createClient } from '@/lib/supabase/browser';
import { DASHBOARD_LIVE_POLL_MS } from '@/lib/realtime/dashboard-sync-constants';
import type { LiveSyncState, PostgresLiveSubscription } from '@/lib/realtime/useVenuePostgresLiveSync';

type Registration = {
  /** Read on each event so handlers stay current (matches prior subscriptionsRef pattern). */
  getSubscriptions: () => PostgresLiveSubscription[];
  onRefresh: () => void;
  pollMs: number;
};

type VenueRegistry = {
  venueId: string;
  registrations: Map<string, Registration>;
  channel: ReturnType<ReturnType<typeof createClient>['channel']> | null;
  pollRef: ReturnType<typeof setInterval> | null;
  connectionState: LiveSyncState;
  stateListeners: Map<string, (state: LiveSyncState) => void>;
  hasSubscribed: boolean;
  attachedSubscriptionKeys: string;
};

const venues = new Map<string, VenueRegistry>();

function subscriptionKey(sub: PostgresLiveSubscription): string {
  return `${sub.table}:${sub.filter ?? ''}`;
}

function collectUniqueSubscriptions(registrations: Iterable<Registration>): PostgresLiveSubscription[] {
  const seen = new Set<string>();
  const out: PostgresLiveSubscription[] = [];
  for (const reg of registrations) {
    for (const sub of reg.getSubscriptions()) {
      const key = subscriptionKey(sub);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sub);
    }
  }
  return out;
}

function subscriptionKeysSignature(registrations: Iterable<Registration>): string {
  return collectUniqueSubscriptions(registrations)
    .map(subscriptionKey)
    .sort()
    .join('|');
}

function dispatchPayload(
  venueId: string,
  table: string,
  filter: string | undefined,
  payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
) {
  const state = venues.get(venueId);
  if (!state) return;

  const filterKey = filter ?? '';

  for (const reg of state.registrations.values()) {
    let usedRefresh = false;
    for (const sub of reg.getSubscriptions()) {
      if (sub.table !== table) continue;
      if ((sub.filter ?? '') !== filterKey) continue;
      if (sub.handler) {
        sub.handler(payload);
      } else if (!usedRefresh) {
        reg.onRefresh();
        usedRefresh = true;
      }
    }
  }
}

function minPollMs(registrations: Iterable<Registration>): number {
  let min = DASHBOARD_LIVE_POLL_MS;
  for (const reg of registrations) {
    if (reg.pollMs > 0 && reg.pollMs < min) min = reg.pollMs;
  }
  return min;
}

function runPollFallback(venueId: string) {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return;
  }
  const state = venues.get(venueId);
  if (!state) return;
  const called = new Set<() => void>();
  for (const reg of state.registrations.values()) {
    if (called.has(reg.onRefresh)) continue;
    called.add(reg.onRefresh);
    reg.onRefresh();
  }
}

function clearPoll(state: VenueRegistry) {
  if (state.pollRef) {
    clearInterval(state.pollRef);
    state.pollRef = null;
  }
}

function ensurePoll(state: VenueRegistry) {
  if (state.registrations.size === 0) return;
  clearPoll(state);
  const venueId = state.venueId;
  const intervalMs = minPollMs(state.registrations.values());
  state.pollRef = setInterval(() => {
    runPollFallback(venueId);
  }, intervalMs);
}

function setConnectionState(state: VenueRegistry, next: LiveSyncState) {
  if (state.connectionState === next) return;
  state.connectionState = next;
  for (const listener of state.stateListeners.values()) {
    listener(next);
  }
}

function teardownChannel(state: VenueRegistry) {
  if (state.channel) {
    const supabase = createClient();
    void supabase.removeChannel(state.channel);
    state.channel = null;
  }
  state.hasSubscribed = false;
  state.attachedSubscriptionKeys = '';
}

function attachChannel(state: VenueRegistry) {
  const subscriptions = collectUniqueSubscriptions(state.registrations.values());
  const nextKeys = subscriptions.map(subscriptionKey).sort().join('|');

  if (nextKeys === state.attachedSubscriptionKeys && state.channel) {
    return;
  }

  teardownChannel(state);
  if (subscriptions.length === 0) return;

  const supabase = createClient();
  let channel = supabase.channel(`venue-postgres-live-shared-${state.venueId}`);

  for (const sub of subscriptions) {
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: sub.table,
        ...(sub.filter ? { filter: sub.filter } : {}),
      },
      (payload) => {
        dispatchPayload(
          state.venueId,
          sub.table,
          sub.filter,
          payload as {
            new?: Record<string, unknown>;
            old?: Record<string, unknown>;
          },
        );
      },
    );
  }

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      const hadConnectionBefore = state.hasSubscribed;
      state.hasSubscribed = true;
      setConnectionState(state, 'live');
      clearPoll(state);
      if (hadConnectionBefore) {
        runPollFallback(state.venueId);
      }
    } else {
      setConnectionState(state, 'reconnecting');
      ensurePoll(state);
    }
  });

  state.channel = channel;
  state.attachedSubscriptionKeys = nextKeys;
}

function getOrCreateVenue(venueId: string): VenueRegistry {
  let state = venues.get(venueId);
  if (!state) {
    state = {
      venueId,
      registrations: new Map(),
      channel: null,
      pollRef: null,
      connectionState: 'reconnecting',
      stateListeners: new Map(),
      hasSubscribed: false,
      attachedSubscriptionKeys: '',
    };
    venues.set(venueId, state);
  }
  return state;
}

export function registerVenuePostgresLiveSync(
  venueId: string,
  registrationId: string,
  registration: Registration,
): void {
  const state = getOrCreateVenue(venueId);
  state.registrations.set(registrationId, registration);
  attachChannel(state);
  if (state.connectionState === 'reconnecting') {
    ensurePoll(state);
  }
}

/** Keep onRefresh / getSubscriptions current without re-subscribing the channel. */
export function syncVenuePostgresLiveSyncRegistration(
  venueId: string,
  registrationId: string,
  registration: Registration,
): void {
  const state = venues.get(venueId);
  if (!state?.registrations.has(registrationId)) return;
  state.registrations.set(registrationId, registration);
  if (state.connectionState === 'reconnecting') {
    ensurePoll(state);
  }
}

export function unregisterVenuePostgresLiveSync(venueId: string, registrationId: string): void {
  const state = venues.get(venueId);
  if (!state) return;

  state.registrations.delete(registrationId);
  state.stateListeners.delete(registrationId);

  if (state.registrations.size === 0) {
    clearPoll(state);
    teardownChannel(state);
    venues.delete(venueId);
    return;
  }

  attachChannel(state);
  if (state.connectionState === 'reconnecting') {
    ensurePoll(state);
  }
}

export function subscribeVenuePostgresLiveSyncState(
  venueId: string,
  registrationId: string,
  listener: (state: LiveSyncState) => void,
): () => void {
  const state = getOrCreateVenue(venueId);
  state.stateListeners.set(registrationId, listener);
  listener(state.connectionState);
  return () => {
    state.stateListeners.delete(registrationId);
  };
}
