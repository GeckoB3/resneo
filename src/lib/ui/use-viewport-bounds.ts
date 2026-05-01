'use client';

import { useEffect, useState } from 'react';
import { getViewportBounds } from '@/lib/ui/viewport-bounds';

/** Updates when the visual/layout viewport changes (resize, mobile chrome, pinch-zoom). */
export function useViewportBounds(): { width: number; height: number } {
  const [bounds, setBounds] = useState(() =>
    typeof window === 'undefined' ? { width: 1024, height: 768 } : getViewportBounds(),
  );

  useEffect(() => {
    const sync = () => setBounds(getViewportBounds());
    sync();
    window.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
    };
  }, []);

  return bounds;
}
