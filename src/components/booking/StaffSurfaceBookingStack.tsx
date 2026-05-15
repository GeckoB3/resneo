'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StaffBookingSurfaceTabsBar } from '@/components/booking/StaffBookingSurfaceTabsBar';
import { UnifiedBookingForm } from '@/components/booking/UnifiedBookingForm';
import { WalkInModal } from '@/app/dashboard/bookings/WalkInModal';
import { AppointmentBookingFlow } from '@/components/booking/AppointmentBookingFlow';
import { EventBookingFlow } from '@/components/booking/EventBookingFlow';
import { ClassBookingFlow } from '@/components/booking/ClassBookingFlow';
import { ResourceBookingFlow } from '@/components/booking/ResourceBookingFlow';
import type { VenuePublic } from '@/components/booking/types';
import { mapApiVenueToVenuePublic } from '@/lib/booking/map-api-venue-to-public';
import {
  defaultStaffBookingSurfaceTab,
  getStaffBookingSurfaceTabs,
  type StaffBookingSurfaceTab,
  type StaffBookingSurfaceTabId,
} from '@/lib/booking/staff-booking-modal-options';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import type { BookingModel } from '@/types/booking-models';
import type { StaffRebookBootstrapPayloadV1 } from '@/lib/booking/staff-rebook-bootstrap';

export function staffSurfaceBookingWidthClass(
  surfaceTabs: StaffBookingSurfaceTab[],
  activeTab: StaffBookingSurfaceTabId,
  options?: { tableAdvancedMode?: boolean },
): string {
  const tableWidth = options?.tableAdvancedMode ? 'max-w-2xl' : 'max-w-lg';
  if (surfaceTabs.length > 1 && activeTab === 'table_reservation') return tableWidth;
  if (surfaceTabs.length > 1) return 'max-w-3xl';
  return activeTab === 'table_reservation' ? tableWidth : 'max-w-3xl';
}

export interface StaffSurfaceBookingStackProps {
  bookingModel: BookingModel;
  enabledModels: BookingModel[];
  venueId: string;
  /** When omitted (e.g. dashboard modals), loaded once from GET /api/venue. */
  venue?: VenuePublic;
  currency: string;
  advancedMode?: boolean;
  onCreated: () => void;
  onClose?: () => void;
  initialDate?: string;
  initialTime?: string;
  preselectedPractitionerId?: string;
  /**
   * `walk-in`: table tab shows day-sheet/floor-plan hint instead of the table form; appointment tab uses walk-in flow.
   * `new`: full create flows (default).
   */
  bookingIntent?: 'new' | 'walk-in';
  /** Controlled tab (e.g. URL sync on /dashboard/bookings/new). Omit for internal state only. */
  activeTab?: StaffBookingSurfaceTabId;
  onActiveTabChange?: (id: StaffBookingSurfaceTabId) => void;
  /** Day sheet: show remaining covers banner on the table walk-in tab. */
  walkInRemainingCapacity?: number | null;
  /** One-shot payload from guest history “Rebook” (session cleared by the new-booking page). */
  staffRebookBootstrap?: StaffRebookBootstrapPayloadV1 | null;
  /**
   * First tab to show when the stack mounts — only applied if {@link StaffBookingSurfaceTabId}
   * is exposed for this venue (e.g. calendar empty-slot flows prefer Appointment over Table default).
   */
  initialStaffSurfaceTabId?: StaffBookingSurfaceTabId;
}

function staffSurfacePropsKey(bookingModel: BookingModel, enabledModels: BookingModel[]): string {
  return `${bookingModel}:${[...enabledModels].sort().join(',')}`;
}

function resolveInitialStaffSurfaceTab(
  bookingModel: BookingModel,
  enabledModels: BookingModel[],
  preferredTabId?: StaffBookingSurfaceTabId,
): StaffBookingSurfaceTabId {
  const tabs = getStaffBookingSurfaceTabs(bookingModel, enabledModels);
  if (preferredTabId && tabs.some((t) => t.id === preferredTabId)) {
    return preferredTabId;
  }
  return defaultStaffBookingSurfaceTab(bookingModel, enabledModels);
}

/**
 * Tabbed booking-type selector when the venue exposes more than one staff booking surface; otherwise a single form.
 * Remounts when booking surfaces change so internal tab state resets without `useEffect`.
 */
export function StaffSurfaceBookingStack(props: StaffSurfaceBookingStackProps) {
  const k = staffSurfacePropsKey(props.bookingModel, props.enabledModels);
  return <StaffSurfaceBookingStackInner key={k} {...props} />;
}

function StaffSurfaceBookingStackInner({
  bookingModel,
  enabledModels,
  venueId,
  venue: venueProp,
  currency,
  advancedMode = false,
  onCreated,
  onClose,
  initialDate,
  initialTime,
  preselectedPractitionerId,
  bookingIntent = 'new',
  activeTab: controlledActiveTab,
  onActiveTabChange,
  walkInRemainingCapacity,
  staffRebookBootstrap = null,
  initialStaffSurfaceTabId,
}: StaffSurfaceBookingStackProps) {
  const surfaceTabs = useMemo(
    () => getStaffBookingSurfaceTabs(bookingModel, enabledModels),
    [bookingModel, enabledModels],
  );

  const isControlled =
    typeof controlledActiveTab !== 'undefined' && typeof onActiveTabChange === 'function';

  const [internalTab, setInternalTab] = useState<StaffBookingSurfaceTabId>(() =>
    resolveInitialStaffSurfaceTab(bookingModel, enabledModels, initialStaffSurfaceTabId),
  );

  const activeTab = isControlled ? controlledActiveTab! : internalTab;

  const setActiveTab = (id: StaffBookingSurfaceTabId) => {
    if (isControlled) {
      onActiveTabChange!(id);
    } else {
      setInternalTab(id);
    }
  };

  /** Venue from parent when provided; otherwise filled by GET /api/venue in the effect below. */
  const [fetchedVenue, setFetchedVenue] = useState<VenuePublic | null>(null);
  const [venueError, setVenueError] = useState<string | null>(null);
  const resolvedVenue = venueProp ?? fetchedVenue;

  useEffect(() => {
    if (venueProp) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/venue');
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          if (!cancelled) setVenueError(typeof data.error === 'string' ? data.error : 'Could not load venue');
          return;
        }
        if (!cancelled) {
          setFetchedVenue(mapApiVenueToVenuePublic(data));
          setVenueError(null);
        }
      } catch {
        if (!cancelled) setVenueError('Could not load venue');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueProp]);

  const showTabs = surfaceTabs.length > 1;
  const tabsForBar = showTabs ? surfaceTabs : [];
  const walkInDefaultSource = bookingIntent === 'walk-in' ? ('walk-in' as const) : undefined;
  const staffBookingSource = walkInDefaultSource ?? 'phone';
  const isAppointmentPlan = isUnifiedSchedulingVenue(bookingModel);

  const body = (): ReactNode => {
    if (venueError) {
      return <p className="text-sm text-red-600">{venueError}</p>;
    }
    if (!resolvedVenue) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        </div>
      );
    }

    const v = resolvedVenue;

    switch (activeTab) {
      case 'table_reservation':
        if (!surfaceTabs.some((t) => t.id === 'table_reservation')) return null;
        if (bookingIntent === 'walk-in') {
          return (
            <WalkInModal
              embedded
              suppressTitle
              advancedMode={advancedMode}
              venueCurrency={currency}
              initialDate={initialDate}
              initialTime={initialTime}
              remainingCapacity={walkInRemainingCapacity}
              onClose={onClose ?? (() => {})}
              onCreated={onCreated}
            />
          );
        }
        return (
          <UnifiedBookingForm
            venueId={venueId}
            advancedMode={advancedMode}
            venueCurrency={currency}
            initialDate={initialDate}
            initialTime={initialTime}
            onCreated={onCreated}
            onClose={onClose}
            staffRebookBootstrap={activeTab === 'table_reservation' ? staffRebookBootstrap : null}
          />
        );
      case 'unified_scheduling':
        if (!surfaceTabs.some((t) => t.id === 'unified_scheduling')) return null;
        return (
          <AppointmentBookingFlow
            venue={v}
            bookingAudience="staff"
            staffBookingSource={staffBookingSource}
            onBookingCreated={onCreated}
            initialDate={initialDate}
            initialTime={initialTime}
            preselectedPractitionerId={preselectedPractitionerId}
            staffRebookBootstrap={activeTab === 'unified_scheduling' ? staffRebookBootstrap : null}
          />
        );
      case 'event_ticket':
        if (!surfaceTabs.some((t) => t.id === 'event_ticket')) return null;
        return (
          <EventBookingFlow
            venue={v}
            bookingAudience="staff"
            staffBookingSource={staffBookingSource}
            onBookingCreated={onCreated}
          />
        );
      case 'class_session':
        if (!surfaceTabs.some((t) => t.id === 'class_session')) return null;
        return (
          <ClassBookingFlow
            venue={v}
            bookingAudience="staff"
            staffBookingSource={staffBookingSource}
            onBookingCreated={onCreated}
          />
        );
      case 'resource_booking':
        if (!surfaceTabs.some((t) => t.id === 'resource_booking')) return null;
        return (
          <ResourceBookingFlow
            venue={v}
            bookingAudience="staff"
            staffBookingSource={staffBookingSource}
            onBookingCreated={onCreated}
          />
        );
      default:
        return null;
    }
  };

  const contentWidthClass = staffSurfaceBookingWidthClass(surfaceTabs, activeTab, {
    tableAdvancedMode: advancedMode,
  });

  return (
    <>
      <StaffBookingSurfaceTabsBar
        tabs={tabsForBar}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel={
          isAppointmentPlan
            ? 'Booking type — appointments, events, classes, resources'
            : 'Booking type — table, appointments, events, classes, resources'
        }
      />
      <div className={`mx-auto w-full ${contentWidthClass}`}>{body()}</div>
    </>
  );
}
