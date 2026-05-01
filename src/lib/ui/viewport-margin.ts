/** Horizontal / edge inset for clamped overlays (slightly tighter on very narrow phones). */
export function viewportMarginPx(viewportWidth: number): number {
  return viewportWidth < 400 ? 8 : 12;
}
