'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import type { GuestDetails, VenuePublic } from '@/components/booking/types';

export function venueRequiresAccountLoginForBooking(venue: VenuePublic): boolean {
  return venue.require_account_login_for_bookings === true;
}

export function isBookingAccountLoginError(status: number, message?: string): boolean {
  if (status === 401) return true;
  const normalized = (message ?? '').toLowerCase();
  return status === 403 && normalized.includes('signed-in account');
}

export interface PublicBookingAccountGateValue {
  requireLogin: boolean;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
  authChecking: boolean;
  sessionEmail: string | null;
  redirectTo: string;
  guestDetailsPrefill: Partial<GuestDetails> | undefined;
  emailReadOnly: boolean;
  ensureSignedIn: () => Promise<boolean>;
  validateGuestEmail: (email: string) => string | null;
  handleCreateResponseError: (status: number, message?: string) => boolean;
}

export const noopPublicBookingAccountGate: PublicBookingAccountGateValue = {
  requireLogin: false,
  authOpen: false,
  setAuthOpen: () => {},
  authChecking: false,
  sessionEmail: null,
  redirectTo: '/book',
  guestDetailsPrefill: undefined,
  emailReadOnly: false,
  ensureSignedIn: async () => true,
  validateGuestEmail: () => null,
  handleCreateResponseError: () => false,
};

export function mergeGuestDetailsPrefill(
  base: Partial<GuestDetails> | undefined,
  prefill: Partial<GuestDetails> | undefined,
): Partial<GuestDetails> | undefined {
  if (!base && !prefill) return undefined;
  return { ...base, ...prefill };
}

export function usePublicBookingAccountGate(venue: VenuePublic): PublicBookingAccountGateValue {
  const pathname = usePathname() ?? '/book';
  const searchParams = useSearchParams();
  const redirectTo = useMemo(() => {
    const query = searchParams?.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const requireLogin = venueRequiresAccountLoginForBooking(venue);
  const [authOpen, setAuthOpen] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(requireLogin);

  const refreshSession = useCallback(async () => {
    if (!requireLogin) {
      setSessionEmail(null);
      setAuthChecking(false);
      return null;
    }
    setAuthChecking(true);
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email?.trim().toLowerCase() ?? null;
    setSessionEmail(email);
    setAuthChecking(false);
    return data.user ?? null;
  }, [requireLogin]);

  useEffect(() => {
    void refreshSession();
    if (!requireLogin) return;
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refreshSession();
      setAuthOpen(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [requireLogin, refreshSession]);

  const ensureSignedIn = useCallback(async (): Promise<boolean> => {
    if (!requireLogin) return true;
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email?.trim().toLowerCase() ?? null;
    if (email) {
      setSessionEmail(email);
      return true;
    }
    setAuthOpen(true);
    return false;
  }, [requireLogin]);

  const guestDetailsPrefill = useMemo(
    () => (sessionEmail ? { email: sessionEmail } : undefined),
    [sessionEmail],
  );

  const validateGuestEmail = useCallback(
    (email: string): string | null => {
      if (!requireLogin || !sessionEmail) return null;
      if (email.trim().toLowerCase() !== sessionEmail) {
        return 'Booking email must match your signed-in account.';
      }
      return null;
    },
    [requireLogin, sessionEmail],
  );

  const handleCreateResponseError = useCallback((status: number, message?: string): boolean => {
    if (!isBookingAccountLoginError(status, message)) return false;
    setAuthOpen(true);
    return true;
  }, []);

  return {
    requireLogin,
    authOpen,
    setAuthOpen,
    authChecking,
    sessionEmail,
    redirectTo,
    guestDetailsPrefill,
    emailReadOnly: requireLogin && Boolean(sessionEmail),
    ensureSignedIn,
    validateGuestEmail,
    handleCreateResponseError,
  };
}
