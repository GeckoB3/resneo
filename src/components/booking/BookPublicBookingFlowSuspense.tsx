'use client';

import { Suspense, type ComponentProps } from 'react';
import { BookPublicBookingFlow } from '@/components/booking/BookPublicBookingFlow';
import { BrandSpinner } from '@/components/ui/primitives';

function BookPublicBookingFlowFallback() {
  return (
    <div
      className="flex min-h-[14rem] items-center justify-center"
      aria-busy="true"
      aria-label="Loading booking form"
    >
      <BrandSpinner />
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
