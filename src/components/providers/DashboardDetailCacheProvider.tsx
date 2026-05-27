'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { preload, unstable_serialize, useSWRConfig } from 'swr';
import type { GuestDetailResponse } from '@/types/contacts';
import {
  fetchVenueBookingDetail,
  fetchVenueBookingSummary,
  fetchVenueGuestDetail,
  GUEST_DETAIL_HISTORY_LIMIT_FULL,
  GUEST_DETAIL_HISTORY_LIMIT_PREFETCH,
  venueBookingDetailKey,
  venueBookingSummaryKey,
  venueGuestDetailKey,
} from '@/lib/dashboard/venue-detail-swr';

/** Cached GET `/api/venue/bookings/[id]` JSON — matches dashboard booking detail payloads. */
export type VenueBookingDetailPayload = Record<string, unknown>;

export interface DashboardDetailCacheApi {
  peekVenueBookingDetail: (id: string) => VenueBookingDetailPayload | undefined;
  primeVenueBookingDetail: (id: string, data: VenueBookingDetailPayload) => void;
  invalidateVenueBookingDetail: (id: string) => void;
  warmVenueBookingDetail: (id: string) => Promise<void>;
  peekGuestDetail: (id: string) => GuestDetailResponse | undefined;
  primeGuestDetail: (id: string, data: GuestDetailResponse) => void;
  invalidateGuestDetail: (id: string) => void;
  warmGuestDetail: (id: string) => Promise<void>;
}

export const DashboardDetailCacheContext = createContext<DashboardDetailCacheApi | null>(null);

/** Coalesce parallel warmVenueBookingDetail(id) calls (list prefetch races). */
const bookingDetailWarmInFlight = new Map<string, Promise<void>>();

function readCacheEntry<T>(cache: ReturnType<typeof useSWRConfig>['cache'], key: readonly unknown[]): T | undefined {
  const entry = cache.get(unstable_serialize(key));
  if (!entry || entry.data === undefined) return undefined;
  return entry.data as T;
}

export function DashboardDetailCacheProvider({ children }: { children: ReactNode }) {
  const { cache, mutate } = useSWRConfig();

  const peekVenueBookingDetail = useCallback(
    (id: string) => readCacheEntry<VenueBookingDetailPayload>(cache, venueBookingDetailKey(id)),
    [cache],
  );

  const primeVenueBookingDetail = useCallback(
    (id: string, data: VenueBookingDetailPayload) => {
      void mutate(venueBookingDetailKey(id), data, { revalidate: false });
    },
    [mutate],
  );

  const invalidateVenueBookingDetail = useCallback(
    (id: string) => {
      void mutate(venueBookingDetailKey(id), undefined, { revalidate: true });
      void mutate(venueBookingSummaryKey(id), undefined, { revalidate: true });
    },
    [mutate],
  );

  const warmVenueBookingDetail = useCallback(
    async (id: string) => {
      if (!id) return;
      const fullKey = venueBookingDetailKey(id);
      if (readCacheEntry<VenueBookingDetailPayload>(cache, fullKey)) return;

      const inFlight = bookingDetailWarmInFlight.get(id);
      if (inFlight) {
        await inFlight;
        return;
      }

      const run = async () => {
        if (readCacheEntry<VenueBookingDetailPayload>(cache, fullKey)) return;

        const summaryKey = venueBookingSummaryKey(id);
        if (!readCacheEntry<VenueBookingDetailPayload>(cache, summaryKey)) {
          try {
            await preload(summaryKey, () => fetchVenueBookingSummary(id));
            const summary = readCacheEntry<VenueBookingDetailPayload>(cache, summaryKey);
            if (summary && !readCacheEntry<VenueBookingDetailPayload>(cache, fullKey)) {
              void mutate(fullKey, summary, { revalidate: false });
            }
          } catch {
            /* summary prefetch is best-effort */
          }
        }

        try {
          await preload(fullKey, () => fetchVenueBookingDetail(id));
        } catch {
          /* best-effort prefetch */
        }
      };

      const promise = run().finally(() => {
        bookingDetailWarmInFlight.delete(id);
      });
      bookingDetailWarmInFlight.set(id, promise);
      await promise;
    },
    [cache, mutate],
  );

  const guestPrefetchLimit = GUEST_DETAIL_HISTORY_LIMIT_PREFETCH;

  const peekGuestDetail = useCallback(
    (id: string) => {
      const full = readCacheEntry<GuestDetailResponse>(cache, venueGuestDetailKey(id, GUEST_DETAIL_HISTORY_LIMIT_FULL));
      if (full) return full;
      return readCacheEntry<GuestDetailResponse>(cache, venueGuestDetailKey(id, guestPrefetchLimit));
    },
    [cache, guestPrefetchLimit],
  );

  const primeGuestDetail = useCallback(
    (id: string, data: GuestDetailResponse) => {
      const limit =
        data.booking_history.length > guestPrefetchLimit
          ? GUEST_DETAIL_HISTORY_LIMIT_FULL
          : guestPrefetchLimit;
      void mutate(venueGuestDetailKey(id, limit), data, { revalidate: false });
    },
    [guestPrefetchLimit, mutate],
  );

  const invalidateGuestDetail = useCallback(
    (id: string) => {
      void mutate(venueGuestDetailKey(id, GUEST_DETAIL_HISTORY_LIMIT_FULL), undefined, { revalidate: true });
      void mutate(venueGuestDetailKey(id, guestPrefetchLimit), undefined, { revalidate: true });
    },
    [guestPrefetchLimit, mutate],
  );

  const warmGuestDetail = useCallback(
    async (id: string) => {
      if (!id) return;
      const key = venueGuestDetailKey(id, guestPrefetchLimit);
      if (readCacheEntry<GuestDetailResponse>(cache, key)) return;
      try {
        await preload(key, () => fetchVenueGuestDetail(id, guestPrefetchLimit));
      } catch {
        /* best-effort prefetch */
      }
    },
    [cache, guestPrefetchLimit],
  );

  const value = useMemo(
    (): DashboardDetailCacheApi => ({
      peekVenueBookingDetail,
      primeVenueBookingDetail,
      invalidateVenueBookingDetail,
      warmVenueBookingDetail,
      peekGuestDetail,
      primeGuestDetail,
      invalidateGuestDetail,
      warmGuestDetail,
    }),
    [
      peekVenueBookingDetail,
      primeVenueBookingDetail,
      invalidateVenueBookingDetail,
      warmVenueBookingDetail,
      peekGuestDetail,
      primeGuestDetail,
      invalidateGuestDetail,
      warmGuestDetail,
    ],
  );

  return (
    <DashboardDetailCacheContext.Provider value={value}>{children}</DashboardDetailCacheContext.Provider>
  );
}

export function useDashboardDetailCache(): DashboardDetailCacheApi {
  const ctx = useContext(DashboardDetailCacheContext);
  if (!ctx) {
    throw new Error('useDashboardDetailCache must be used within DashboardDetailCacheProvider');
  }
  return ctx;
}

export function useOptionalDashboardDetailCache(): DashboardDetailCacheApi | null {
  return useContext(DashboardDetailCacheContext);
}
