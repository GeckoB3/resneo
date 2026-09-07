'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Google's keyless map embed only shows its place card (business name, address, star rating)
 * when the iframe is at least this wide AND this tall in CSS pixels; smaller embeds collapse to
 * a bare pin with an "Open in Maps" button. Measured in the browser: 400x300 shows the card;
 * 380x300, 400x280, 450x281 and 500x260 do not.
 */
const MIN_EMBED_WIDTH = 400;
const MIN_EMBED_HEIGHT = 300;

/**
 * The About tab's map. Wherever the container is under Google's card threshold in either
 * dimension (a 343px phone panel, or a 16:10 map between roughly 400px and 480px wide, which is
 * under 300px tall), the iframe is laid out at the threshold size and scaled down with a
 * transform to fit. Google measures the layout size, so the card stays; the customer sees the
 * same map slightly smaller. The iframe is not rendered until the container has been measured,
 * so Google never lays it out too small first.
 */
export function BookingPageMapEmbed({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0) return;
      setSize((prev) =>
        prev && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Shrink just enough that the laid-out iframe is at least the threshold in both dimensions.
  const scale = size ? Math.min(1, size.width / MIN_EMBED_WIDTH, size.height / MIN_EMBED_HEIGHT) : 1;

  return (
    <div ref={frameRef} className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 sm:aspect-[16/10]">
      {size ? (
        <iframe
          title={title}
          src={src}
          className="absolute left-0 top-0 border-0"
          style={
            scale < 1
              ? {
                  width: `${size.width / scale}px`,
                  height: `${size.height / scale}px`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }
              : { width: '100%', height: '100%' }
          }
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : null}
    </div>
  );
}
