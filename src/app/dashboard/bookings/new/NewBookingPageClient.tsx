'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { onNavReselect } from '@/lib/ui/nav-reselect';
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
import {
  discardStaffRebookBootstrapCaches,
  hydrateStaffRebookBootstrapOnce,
  type StaffRebookBootstrapPayloadV1,
} from '@/lib/booking/staff-rebook-bootstrap';
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
  const routerRef = useRef(router);

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

  /** Bumped to force a fresh mount of the booking stack (full form reset). */
  const [resetKey, setResetKey] = useState(0);

  const [staffRebookFromSession, setStaffRebookFromSession] = useState(() =>
    hydrateStaffRebookBootstrapOnce(),
  );

  useLayoutEffect(() => {
    routerRef.current = router;
  }, [router]);

  useLayoutEffect(() => {
    if (!staffRebookFromSession) return;
    if (!surfaceTabs.some((t) => t.id === staffRebookFromSession.surface)) return;
    const desiredParam = staffBookingSurfaceTabIdToQueryParam(staffRebookFromSession.surface);
    const raw = searchParams.get('tab');
    if ((raw ?? '').trim().toLowerCase() === desiredParam.toLowerCase()) {
      return;
    }
    routerRef.current.replace(`/dashboard/bookings/new?tab=${desiredParam}`, { scroll: false });
  }, [staffRebookFromSession, surfaceTabs, searchParams]);

  const activeTab = useMemo(() => {
    /**
     * If we have a rebook bootstrap but `parseStaffBookingSurfaceTabIdFromQuery` has not hydrated yet
     * (`tabFromQuery === null`), keep the appointment/table surface stable so stacks are not remounted.
     */
    if (
      staffRebookFromSession &&
      surfaceTabs.some((t) => t.id === staffRebookFromSession.surface)
    ) {
      const wantSurface = staffRebookFromSession.surface;
      if (tabFromQuery == null) return wantSurface;
    }

    if (tabFromQuery) return tabFromQuery;
    const candidate = persistedTab ?? defaultTab;
    if (surfaceTabs.some((t) => t.id === candidate)) return candidate;
    return defaultTab;
  }, [staffRebookFromSession, surfaceTabs, tabFromQuery, persistedTab, defaultTab]);

  const staffRebookBootstrap = useMemo((): StaffRebookBootstrapPayloadV1 | null => {
    if (!staffRebookFromSession) return null;
    if (!surfaceTabs.some((t) => t.id === staffRebookFromSession.surface)) return null;
    if (staffRebookFromSession.surface !== activeTab) return null;
    return staffRebookFromSession;
  }, [staffRebookFromSession, surfaceTabs, activeTab]);

  const onDone = useCallback(() => {
    discardStaffRebookBootstrapCaches();
    void router.push('/dashboard/bookings');
  }, [router]);

  /**
   * Reset the form to the start when "New Booking" is re-selected in the sidebar
   * while already on this page. Clears any rebook pre-fill, the remembered tab, the
   * `?tab=` query, and remounts the booking stack so every step starts blank.
   */
  const resetToStart = useCallback(() => {
    discardStaffRebookBootstrapCaches();
    setStaffRebookFromSession(null);
    setPersistedTab(null);
    setResetKey((key) => key + 1);
    routerRef.current.replace('/dashboard/bookings/new', { scroll: false });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);

  useEffect(
    () =>
      onNavReselect((href) => {
        if (href === '/dashboard/bookings/new') resetToStart();
      }),
    [resetToStart],
  );

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
            key={resetKey}
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
            staffRebookBootstrap={staffRebookBootstrap}
          />
        </div>
      </ToastProvider>
    </div>
  );
}
