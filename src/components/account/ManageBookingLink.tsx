'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/primitives';

/**
 * "Manage" affordance on the account booking surfaces (P0-3).
 *
 * The manage link used to be minted for every row while the page rendered, so a
 * GET wrote a `booking_short_links` row per booking. This asks for the link at
 * the moment a customer wants it, so the read path writes nothing.
 *
 * A button rather than an anchor, because there is no URL until the request
 * comes back. Failure is visible and retryable: showing nothing, or navigating
 * to a broken URL, would leave a customer stuck with no way to cancel.
 */
export function ManageBookingLink({
  bookingId,
  label,
  className,
}: {
  bookingId: string;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');

  async function open() {
    if (state === 'loading') return;
    setState('loading');
    try {
      const res = await fetch(`/api/account/bookings/${bookingId}/manage-link`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { url?: unknown };
      if (typeof body.url !== 'string' || body.url === '') throw new Error('No link returned');
      window.location.assign(body.url);
    } catch {
      setState('failed');
    }
  }

  return (
    // `variant="link"` keeps the primitive's focus and disabled handling while
    // leaving the caller's className in charge of appearance: these render
    // inline in a list row and as a filled CTA on the detail page, and forcing
    // one variant on both would change the look of one of them.
    <Button
      type="button"
      variant="link"
      onClick={open}
      loading={state === 'loading'}
      aria-busy={state === 'loading'}
      className={className}
    >
      {state === 'loading' ? 'Opening…' : state === 'failed' ? 'Try again' : label}
    </Button>
  );
}
