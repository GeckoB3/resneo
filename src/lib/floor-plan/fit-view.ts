import { getTableDimensions, tableDimensionsPercentToPixels } from '@/types/table-management';
import type { TableShape } from '@/types/table-management';

/** Default logical canvas size when `floor_plans.canvas_*` is unset (matches floor plan editor). */
export const FLOOR_PLAN_DEFAULT_LAYOUT_WIDTH = 2600;
export const FLOOR_PLAN_DEFAULT_LAYOUT_HEIGHT = 1950;

/** Minimal table fields needed to compute bounding box in stage coordinates. */
export interface FitViewTableLike {
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  height: number | null;
  max_covers: number;
  shape: string;
}

export interface ComputeStageFitOptions {
  /** Padding around the content bounding box (px). Default 48. */
  padding?: number;
  /** Upper cap on scale (matches wheel zoom max in canvases). Default 3. */
  maxScale?: number;
}

/**
 * Computes Konva Stage `scaleX`/`scaleY` and `x`/`y` so all tables are visible
 * and the plan fills the canvas as much as possible (same math as the booking mini picker).
 */
export function computeStageFitToView(
  tables: FitViewTableLike[],
  layoutW: number,
  layoutH: number,
  viewportW: number,
  viewportH: number,
  options?: ComputeStageFitOptions,
): { scale: number; x: number; y: number } {
  const pad = options?.padding ?? 48;
  const maxScale = options?.maxScale ?? 3;

  if (tables.length === 0 || layoutW < 1 || layoutH < 1 || viewportW < 1 || viewportH < 1) {
    return { scale: 1, x: 0, y: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const t of tables) {
    const fb = getTableDimensions(t.max_covers, t.shape as TableShape);
    const cx = t.position_x != null ? (t.position_x / 100) * layoutW : layoutW / 2;
    const cy = t.position_y != null ? (t.position_y / 100) * layoutH : layoutH / 2;
    const { w, h } = tableDimensionsPercentToPixels(
      t.width ?? fb.width,
      t.height ?? fb.height,
      layoutW,
      layoutH,
      t.shape,
    );
    minX = Math.min(minX, cx - w / 2);
    maxX = Math.max(maxX, cx + w / 2);
    minY = Math.min(minY, cy - h / 2);
    maxY = Math.max(maxY, cy + h / 2);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return { scale: 1, x: 0, y: 0 };
  }

  const bw = maxX - minX + pad * 2;
  const bh = maxY - minY + pad * 2;
  const scale = Math.min(viewportW / bw, viewportH / bh, maxScale);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return {
    scale,
    x: viewportW / 2 - midX * scale,
    y: viewportH / 2 - midY * scale,
  };
}

export interface FitFullLayoutOptions {
  /** Padding from viewport edges (px). Default 16. */
  padding?: number;
  maxScale?: number;
}

/**
 * Fits the entire logical layout rectangle (0,0 → layoutW × layoutH) into the
 * visible viewport. Use with a viewport-sized Konva Stage and a Group scaled by
 * `scale` at `x`/`y` so the whole floor plan area is visible on load.
 */
export function computeFitFullLayoutToViewport(
  layoutW: number,
  layoutH: number,
  viewportW: number,
  viewportH: number,
  options?: FitFullLayoutOptions,
): { scale: number; x: number; y: number } {
  const pad = options?.padding ?? 16;
  const maxScale = options?.maxScale ?? 3;
  if (layoutW < 1 || layoutH < 1 || viewportW < 1 || viewportH < 1) {
    return { scale: 1, x: 0, y: 0 };
  }
  const scale = Math.min(
    (viewportW - pad * 2) / layoutW,
    (viewportH - pad * 2) / layoutH,
    maxScale,
  );
  const midX = layoutW / 2;
  const midY = layoutH / 2;
  return {
    scale,
    x: viewportW / 2 - midX * scale,
    y: viewportH / 2 - midY * scale,
  };
}
