/**
 * Layout viewport dimensions (visualViewport when available — better on mobile Safari).
 */
export function getViewportBounds(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  const vv = window.visualViewport;
  if (vv) return { width: vv.width, height: vv.height };
  return { width: window.innerWidth, height: window.innerHeight };
}
