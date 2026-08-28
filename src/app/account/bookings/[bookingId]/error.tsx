'use client';

import { PortalErrorState } from '@/components/account/PortalErrorState';

/**
 * Route-local error boundary (P0-5, G7). Without one, a data error unwinds to
 * `src/app/error.tsx`, which is outside the account layout: the customer loses
 * the portal chrome and every route they might go to instead.
 */
export default function AccountBookingDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PortalErrorState title="Booking" reset={reset} error={error} />;
}
