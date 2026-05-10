'use client';

import { useCallback, useEffect, useRef } from 'react';
import { BookPublicBookingFlow } from '@/components/booking/BookPublicBookingFlow';
import type { VenuePublic } from '@/components/booking/types';
import { EMBED_IFRAME_MIN_REPORTED_HEIGHT_PX } from '@/lib/embed/widget-frame';

let lastSentHeight = 0;
function sendHeight(height: number) {
  if (typeof window === 'undefined' || !window.parent) return;
  if (height === lastSentHeight) return;
  lastSentHeight = height;
  window.parent.postMessage({ type: 'reserve-ni-height', height }, '*');
}

/**
 * Descendants of a vertical scrollport report getBoundingClientRect() for their full layout
 * box, not the clipped scroll viewport — e.g. every row in a max-height time list. Skipping
 * those nodes keeps overlay measurement tight while still counting the scroll container box.
 */
function isInsideVerticalScrollport(el: HTMLElement, root: HTMLElement): boolean {
  let p: HTMLElement | null = el.parentElement;
  while (p && p !== root) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') {
      return true;
    }
    p = p.parentElement;
  }
  return false;
}

/**
 * Includes overflow from `position: absolute` popovers (e.g. date picker), which do not
 * always increase `scrollHeight` of the root but still need to fit inside the iframe height.
 */
function measureEmbedMain(root: HTMLElement): number {
  const rootRect = root.getBoundingClientRect();
  let maxBottomFromRootTop = 0;
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (isInsideVerticalScrollport(el, root)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const bottom = r.bottom - rootRect.top;
    if (bottom > maxBottomFromRootTop) maxBottomFromRootTop = bottom;
  }
  const fromScroll = Math.ceil(root.scrollHeight);
  const fromOverflow = Math.ceil(maxBottomFromRootTop);
  return Math.max(fromScroll, fromOverflow, EMBED_IFRAME_MIN_REPORTED_HEIGHT_PX);
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
    <main ref={contentRef} className="bg-white px-4 pb-4 pt-4" style={accentStyle}>
      <p className="mb-3 text-center text-[11px] font-medium tracking-wide text-slate-500">
        Powered by{' '}
        <span className="text-slate-700">ReserveNI</span>
      </p>
      <BookPublicBookingFlow
        venue={venue}
        embed
        onHeightChange={bumpEmbedHeight}
        accentColour={accentColour ?? undefined}
      />
    </main>
  );
}
