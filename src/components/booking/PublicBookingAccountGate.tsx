'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { RequireAuthModal } from '@/components/auth/RequireAuthModal';
import {
  noopPublicBookingAccountGate,
  usePublicBookingAccountGate,
  type PublicBookingAccountGateValue,
} from '@/lib/booking/public-booking-account-gate';
import type { VenuePublic } from '@/components/booking/types';

const PublicBookingAccountGateContext = createContext<PublicBookingAccountGateValue>(
  noopPublicBookingAccountGate,
);

export function usePublicBookingAccountGateContext(): PublicBookingAccountGateValue {
  return useContext(PublicBookingAccountGateContext);
}

export function PublicBookingAccountGateProvider({
  venue,
  children,
}: {
  venue: VenuePublic;
  children: ReactNode;
}) {
  const gate = usePublicBookingAccountGate(venue);

  return (
    <PublicBookingAccountGateContext.Provider value={gate}>
      {gate.requireLogin && !gate.authChecking && !gate.sessionEmail ? (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-950">
          <p className="font-medium">ReserveNI account required to book</p>
          <button
            type="button"
            onClick={() => gate.setAuthOpen(true)}
            className="mt-3 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Log in or sign up
          </button>
        </div>
      ) : null}
      {children}
      {gate.requireLogin ? (
        <RequireAuthModal
          open={gate.authOpen}
          redirectTo={gate.redirectTo}
          variant="booking"
          onClose={() => gate.setAuthOpen(false)}
        />
      ) : null}
    </PublicBookingAccountGateContext.Provider>
  );
}
