'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { discardStaffRebookBootstrapCaches } from '@/lib/booking/staff-rebook-bootstrap';

const STAFF_NEW_BOOKING_PATH = '/dashboard/bookings/new';

/**
 * When staff leave `/dashboard/bookings/new` without finishing the flow here, drop rebook hydrate
 * + session payloads so the next visit is not pre-filled from someone else's “Rebook” click.
 *
 * Mounted once under `/dashboard` so SPA navigations behave correctly (not tied to faux-unmounts
 * inside the new-booking page alone).
 */
export function StaffRebookBootstrapRouteCleanup() {
  const pathname = usePathname();
  const previousPathRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = previousPathRef.current;
    previousPathRef.current = pathname;

    if (prev === STAFF_NEW_BOOKING_PATH && pathname !== STAFF_NEW_BOOKING_PATH) {
      discardStaffRebookBootstrapCaches();
    }
  }, [pathname]);

  return null;
}
