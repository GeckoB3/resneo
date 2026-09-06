'use client';

import { AssistantProvider } from '@/components/assistant/AssistantProvider';
import { AssistantSheet } from '@/components/assistant/AssistantSheet';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DashboardSidebar, type DashboardSidebarProps } from './DashboardSidebar';
import type { BookingModel } from '@/types/booking-models';

export type DashboardShellSidebarRest = Omit<
  DashboardSidebarProps,
  'tableManagementEnabled' | 'appointmentWaitlistEnabled'
>;

type NavSyncContextValue = {
  setTableManagementEnabled: (value: boolean) => void;
  /** Align sidebar booking-model links with server-derived primary + secondaries (matches dashboard layout). */
  setNavBookingSurface: (next: { bookingModel: BookingModel; enabledModels: BookingModel[] }) => void;
  /** Settings → Features → Appointment waitlist; updates Waitlist nav without reload. */
  setAppointmentWaitlistEnabled: (value: boolean) => void;
};

const DashboardNavSyncContext = createContext<NavSyncContextValue | null>(null);

type DashboardTransitionContextValue = {
  beginTransition: (label?: string) => void;
};

const DashboardTransitionContext = createContext<DashboardTransitionContextValue | null>(null);

/** Call after toggling advanced table management so the left nav updates without a full reload. */
export function useDashboardTableManagementNavSync() {
  return useContext(DashboardNavSyncContext);
}

/** Same context as table-management sync; use after changing enabled booking models in settings. */
export function useDashboardBookingModelsNavSync() {
  return useContext(DashboardNavSyncContext);
}

/** Call after toggling Appointment waitlist in settings so the Waitlist nav item updates immediately. */
export function useDashboardWaitlistNavSync() {
  return useContext(DashboardNavSyncContext);
}

export function useDashboardTransition() {
  return useContext(DashboardTransitionContext);
}

/**
 * Client bridge: sidebar `table_management_enabled` comes from the server layout, but toggling the mode
 * in settings only updates the DB — `router.refresh()` may not re-run the root layout fetch. Keep a
 * client copy so nav items (Table Grid / Floor Plan) appear or hide immediately.
 */
export function DashboardShell({
  venueId,
  initialTableManagementEnabled,
  initialAppointmentWaitlistEnabled = false,
  sidebarRest,
  supportSessionToolbar,
  assistantEnabled = false,
  children,
}: {
  venueId?: string;
  initialTableManagementEnabled: boolean;
  initialAppointmentWaitlistEnabled?: boolean;
  sidebarRest: DashboardShellSidebarRest;
  /** Shown above main content when a platform superuser has an active venue support session. */
  supportSessionToolbar?: ReactNode;
  /** Server-side assistantEnabledFor(venueId): renders the Ask ResNeo launcher and drawer when true. */
  assistantEnabled?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    bookingModel: serverBookingModel = 'table_reservation',
    enabledModels: serverEnabledModels = [],
    isAdmin = false,
    ...sidebarRestWithoutBookingNav
  } = sidebarRest;

  const [tableManagementEnabled, setTableManagementEnabled] = useState(initialTableManagementEnabled);
  const [appointmentWaitlistEnabled, setAppointmentWaitlistEnabled] = useState(initialAppointmentWaitlistEnabled);
  const [bookingModel, setBookingModel] = useState<BookingModel>(serverBookingModel);
  const [enabledModels, setEnabledModels] = useState<BookingModel[]>(serverEnabledModels ?? []);
  const [transitionLabel, setTransitionLabel] = useState<string | null>(null);

  useEffect(() => {
    setTableManagementEnabled(initialTableManagementEnabled);
  }, [initialTableManagementEnabled]);

  useEffect(() => {
    setAppointmentWaitlistEnabled(initialAppointmentWaitlistEnabled);
  }, [initialAppointmentWaitlistEnabled]);

  const serverBookingNavKey = useMemo(
    () => `${serverBookingModel}\u0000${JSON.stringify(serverEnabledModels ?? [])}`,
    [serverBookingModel, serverEnabledModels],
  );

  useEffect(() => {
    setBookingModel(serverBookingModel);
    setEnabledModels([...(serverEnabledModels ?? [])]);
  }, [serverBookingNavKey, serverBookingModel, serverEnabledModels]);

  const setFlag = useCallback((value: boolean) => {
    setTableManagementEnabled(value);
  }, []);

  const setNavBookingSurface = useCallback((next: { bookingModel: BookingModel; enabledModels: BookingModel[] }) => {
    setBookingModel(next.bookingModel);
    setEnabledModels(next.enabledModels);
  }, []);

  const setWaitlistNavEnabled = useCallback((value: boolean) => {
    setAppointmentWaitlistEnabled(value);
  }, []);

  const ctx = useMemo(
    () => ({
      setTableManagementEnabled: setFlag,
      setNavBookingSurface,
      setAppointmentWaitlistEnabled: setWaitlistNavEnabled,
    }),
    [setFlag, setNavBookingSurface, setWaitlistNavEnabled],
  );

  const beginTransition = useCallback((label = 'Loading…') => {
    setTransitionLabel(label);
  }, []);

  const transitionCtx = useMemo(() => ({ beginTransition }), [beginTransition]);

  const routeKey = `${pathname ?? ''}?${searchParams?.toString() ?? ''}`;

  useEffect(() => {
    if (!transitionLabel) return;
    const timer = window.setTimeout(() => setTransitionLabel(null), 180);
    return () => window.clearTimeout(timer);
  }, [routeKey, transitionLabel]);

  useEffect(() => {
    if (!transitionLabel) return;
    const timeout = window.setTimeout(() => setTransitionLabel(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [transitionLabel]);

  useEffect(() => {
    if (!venueId) return;
    const today = new Date().toISOString().slice(0, 10);
    router.prefetch('/dashboard');
    router.prefetch('/dashboard/bookings');
    router.prefetch('/dashboard/bookings/new');
    router.prefetch('/dashboard/contacts');
    router.prefetch('/dashboard/calendar');
    router.prefetch('/dashboard/day-sheet');
    router.prefetch('/dashboard/settings');
    if (isAdmin) {
      router.prefetch('/dashboard/settings?tab=reports');
      router.prefetch('/dashboard/settings?tab=refer-earn');
      router.prefetch('/dashboard/appointment-services');
      router.prefetch('/dashboard/calendar-availability');
    }

    const hasAppointmentSurface =
      serverBookingModel === 'unified_scheduling' ||
      serverBookingModel === 'practitioner_appointment' ||
      (serverEnabledModels ?? []).some(
        (m) => m === 'unified_scheduling' || m === 'practitioner_appointment',
      );

    const warmAppointmentLists = () => {
      void fetch('/api/venue/appointment-services', { credentials: 'same-origin' }).catch(() => {});
      void fetch('/api/venue/practitioners?roster=1', { credentials: 'same-origin' }).catch(() => {});
    };

    if (hasAppointmentSurface) {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(warmAppointmentLists, { timeout: 4000 });
      } else {
        window.setTimeout(warmAppointmentLists, 2000);
      }
    }

    void fetch(`/api/venue/bookings/list?date=${encodeURIComponent(today)}`, { credentials: 'same-origin' }).catch(
      () => {},
    );
  }, [venueId, router, isAdmin, serverBookingModel, serverEnabledModels]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== '_self') return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      beginTransition('Loading…');
    }

    document.addEventListener('click', onDocumentClick, true);
    return () => document.removeEventListener('click', onDocumentClick, true);
  }, [beginTransition]);

  return (
    <DashboardTransitionContext.Provider value={transitionCtx}>
      <DashboardNavSyncContext.Provider value={ctx}>
        <AssistantProvider enabled={assistantEnabled}>
        <DashboardTransitionIndicator label={transitionLabel} />
        <DashboardSidebar
          {...sidebarRestWithoutBookingNav}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          tableManagementEnabled={tableManagementEnabled}
          appointmentWaitlistEnabled={appointmentWaitlistEnabled}
          isAdmin={isAdmin}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {supportSessionToolbar}
          {children}
        </div>
        <AssistantSheet />
        </AssistantProvider>
      </DashboardNavSyncContext.Provider>
    </DashboardTransitionContext.Provider>
  );
}

function DashboardTransitionIndicator({ label }: { label: string | null }) {
  return (
    <div
      className={`pointer-events-none fixed top-0 right-0 left-0 z-[80] transition-opacity duration-150 ${
        label ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={!label}
    >
      <div className="h-1 w-full overflow-hidden bg-brand-100/80">
        <div className="h-full w-1/2 animate-dashboard-progress rounded-r-full bg-brand-600 shadow-sm shadow-brand-600/30" />
      </div>
      {label ? (
        <div className="absolute top-2 left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-lg shadow-slate-900/10 backdrop-blur sm:flex">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-600" />
          {label}
        </div>
      ) : null}
    </div>
  );
}
