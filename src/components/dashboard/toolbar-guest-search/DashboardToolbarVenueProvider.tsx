'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';

export interface DashboardToolbarVenueContextValue {
  venueId: string;
  bookingModel: BookingModel;
  enabledModels: BookingModel[];
  currency: string;
  venueTimezone: string;
  tableManagementEnabled: boolean;
  isAdmin: boolean;
  terminology: VenueTerminology;
  clientLower: string;
  clientWord: string;
  bookingWord: string;
}

const DashboardToolbarVenueContext = createContext<DashboardToolbarVenueContextValue | null>(null);

export function useDashboardToolbarVenue(): DashboardToolbarVenueContextValue {
  const ctx = useContext(DashboardToolbarVenueContext);
  if (!ctx) {
    throw new Error('useDashboardToolbarVenue must be used within DashboardToolbarVenueProvider');
  }
  return ctx;
}

export function useDashboardToolbarVenueOptional(): DashboardToolbarVenueContextValue | null {
  return useContext(DashboardToolbarVenueContext);
}

export function DashboardToolbarVenueProvider({
  value,
  children,
}: {
  value: DashboardToolbarVenueContextValue | null;
  children: ReactNode;
}) {
  if (!value) {
    return <>{children}</>;
  }
  return (
    <DashboardToolbarVenueContext.Provider value={value}>
      {children}
    </DashboardToolbarVenueContext.Provider>
  );
}
