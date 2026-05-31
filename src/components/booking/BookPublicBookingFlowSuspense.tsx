'use client';

import { Suspense, type ComponentProps } from 'react';
import { BookPublicBookingFlow } from '@/components/booking/BookPublicBookingFlow';

function BookPublicBookingFlowFallback() {
  return (
    <div
      className="flex min-h-[14rem] items-center justify-center"
      aria-busy="true"
      aria-label="Loading booking form"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
    </div>
  );
}

/**
 * Public booking flow wrapped for SSR: {@link BookPublicBookingFlow} reads `useSearchParams()`.
 */
export function BookPublicBookingFlowSuspense(props: ComponentProps<typeof BookPublicBookingFlow>) {
  return (
    <Suspense fallback={<BookPublicBookingFlowFallback />}>
      <BookPublicBookingFlow {...props} />
    </Suspense>
  );
}
