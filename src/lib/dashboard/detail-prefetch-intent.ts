/**
 * Bind hover / pointer / keyboard intent handlers for dashboard detail prefetch.
 * `pointerdown` runs before `click`, so detail is often cached before expand.
 */
export function bindDetailPrefetchHandlers(
  id: string,
  warm: (id: string) => void,
): {
  onPointerEnter: () => void;
  onPointerDown: () => void;
  onFocus: () => void;
} {
  const run = () => {
    void warm(id);
  };
  return {
    onPointerEnter: run,
    onPointerDown: run,
    onFocus: run,
  };
}
