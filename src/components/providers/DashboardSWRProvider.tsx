'use client';

import { SWRConfig } from 'swr';
import { VENUE_DETAIL_STALE_MS } from '@/lib/dashboard/venue-detail-swr';

/**
 * Shared SWR defaults for staff dashboard: dedupe requests and avoid refetch on every tab focus.
 */
export function DashboardSWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        /** Coalesce duplicate in-flight requests; aligns with ~60s “fresh enough” staff dashboard reads. */
        dedupingInterval: VENUE_DETAIL_STALE_MS,
        errorRetryCount: 2,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
