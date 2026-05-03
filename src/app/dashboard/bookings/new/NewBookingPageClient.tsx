'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import {
  StaffSurfaceBookingStack,
  staffSurfaceBookingWidthClass,
} from '@/components/booking/StaffSurfaceBookingStack';
import {
  defaultStaffBookingSurfaceTab,
  getStaffBookingSurfaceTabs,
  parseStaffBookingSurfaceTabIdFromQuery,
  staffBookingSurfaceTabIdToQueryParam,
  type StaffBookingSurfaceTabId,
} from '@/lib/booking/staff-booking-modal-options';
import type { VenuePublic } from '@/components/booking/types';
import type { BookingModel } from '@/types/booking-models';

export function NewBookingPageClient({
  venueId,
  venue,
  advancedMode,
  bookingModel = 'table_reservation',
  currency = 'GBP',
  enabledModels = [],
}: {
  venueId: string;
  venue: VenuePublic;
  advancedMode: boolean;
  bookingModel?: BookingModel;
  currency?: string;
  enabledModels?: BookingModel[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const surfaceTabs = useMemo(
    () => getStaffBookingSurfaceTabs(bookingModel, enabledModels),
    [bookingModel, enabledModels],
  );

  const defaultTab = useMemo(
    () => defaultStaffBookingSurfaceTab(bookingModel, enabledModels),
    [bookingModel, enabledModels],
  );

  const tabFromQuery = useMemo(
    () => parseStaffBookingSurfaceTabIdFromQuery(searchParams.get('tab'), surfaceTabs),
    [searchParams, surfaceTabs],
  );

  /** When `?tab=` is absent, remember last choice so we do not fight controlled URL sync. */
  const [persistedTab, setPersistedTab] = useState<StaffBookingSurfaceTabId | null>(null);

  const activeTab = useMemo(() => {
    if (tabFromQuery) return tabFromQuery;
    const candidate = persistedTab ?? defaultTab;
    if (surfaceTabs.some((t) => t.id === candidate)) return candidate;
    return defaultTab;
  }, [tabFromQuery, persistedTab, surfaceTabs, defaultTab]);

  const onDone = useCallback(() => {
    void router.push('/dashboard/bookings');
  }, [router]);

  const handleTabChange = useCallback(
    (id: StaffBookingSurfaceTabId) => {
      if (id === activeTab) return;
      setPersistedTab(id);
      router.replace(`/dashboard/bookings/new?tab=${staffBookingSurfaceTabIdToQueryParam(id)}`, { scroll: false });
    },
    [router, activeTab],
  );

  const outerMaxClass = staffSurfaceBookingWidthClass(surfaceTabs, activeTab, {
    tableAdvancedMode: advancedMode,
  });

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <ToastProvider>
        <div className={`mx-auto ${outerMaxClass}`}>
          <h1 className="mb-6 text-2xl font-semibold text-slate-900">New Booking</h1>
          <StaffSurfaceBookingStack
            bookingModel={bookingModel}
            enabledModels={enabledModels}
            venueId={venueId}
            venue={venue}
            currency={currency}
            advancedMode={advancedMode}
            onCreated={onDone}
            activeTab={activeTab}
            onActiveTabChange={handleTabChange}
            bookingIntent="new"
          />
        </div>
      </ToastProvider>
    </div>
  );
}
