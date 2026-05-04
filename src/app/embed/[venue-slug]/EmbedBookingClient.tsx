'use client';

import { useCallback, useEffect, useRef } from 'react';
import { BookPublicBookingFlow } from '@/components/booking/BookPublicBookingFlow';
import type { VenuePublic } from '@/components/booking/types';

let lastSentHeight = 0;
function sendHeight(height: number) {
  if (typeof window === 'undefined' || !window.parent) return;
  if (height === lastSentHeight) return;
  lastSentHeight = height;
  window.parent.postMessage({ type: 'reserve-ni-height', height }, '*');
}

function measureEmbedMain(root: HTMLElement): number {
  return Math.ceil(root.scrollHeight);
}

export function EmbedBookingClient({
  venue,
  accentColour,
}: {
  venue: VenuePublic;
  accentColour: string | null;
}) {
  const contentRef = useRef<HTMLElement>(null);

  /** Re-measure the widget shell after flows change step or async layout; avoids iframe viewport bleed. */
  const bumpEmbedHeight = useCallback(() => {
    requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      sendHeight(measureEmbedMain(root));
    });
  }, []);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => bumpEmbedHeight());
    observer.observe(root);
    bumpEmbedHeight();
    return () => observer.disconnect();
  }, [bumpEmbedHeight]);

  const accentStyle = accentColour
    ? ({ '--accent': `#${accentColour.replace(/^#/, '')}` } as React.CSSProperties)
    : undefined;

  return (
    <main ref={contentRef} className="bg-white px-4 pb-4 pt-6" style={accentStyle}>
      <BookPublicBookingFlow
        venue={venue}
        embed
        onHeightChange={bumpEmbedHeight}
        accentColour={accentColour ?? undefined}
      />
    </main>
  );
}
