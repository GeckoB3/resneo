/**
 * Table label font fitting — shared so all tables on a floor can use one unified size
 * (the minimum size needed by any table for its name/capacity lines).
 */

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function circleHalfChordAtY(radius: number, yFromCentre: number): number {
  const y = Math.min(Math.abs(yFromCentre), radius * 0.999);
  return Math.sqrt(Math.max(0, radius * radius - y * y));
}

function ellipseHalfChordAtY(radiusX: number, radiusY: number, yFromCentre: number): number {
  const y = Math.min(Math.abs(yFromCentre), radiusY * 0.999);
  return radiusX * Math.sqrt(Math.max(0, 1 - (y / radiusY) ** 2));
}

/**
 * Horizontal chord length inside a simple polygon at y = y0 (table-local coords, origin = table centre).
 * Intersections use parity pairing on sorted x (works for convex and typical concave dining polygons).
 */
export function polygonHorizontalChordWidthAtY(
  pts: { x: number; y: number }[],
  y0: number,
): number {
  if (pts.length < 3) return 0;
  const n = pts.length;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const y1 = p1.y;
    const y2 = p2.y;
    if (Math.abs(y1 - y2) < 1e-12) continue;
    if ((y1 < y0 && y2 >= y0) || (y2 < y0 && y1 >= y0)) {
      const t = (y0 - y1) / (y2 - y1);
      if (t >= 0 && t <= 1) {
        xs.push(p1.x + t * (p2.x - p1.x));
      }
    }
  }
  if (xs.length < 2) return 0;
  xs.sort((a, b) => a - b);
  let maxSpan = 0;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    maxSpan = Math.max(maxSpan, xs[k + 1]! - xs[k]!);
  }
  return maxSpan;
}

function polygonMinChordAcrossVerticalBandAtY(
  pts: { x: number; y: number }[],
  centerY: number,
  halfHeight: number,
  curveInset: number,
  insetX: number,
): number {
  const samples =
    halfHeight <= 1e-6
      ? [centerY]
      : [
          centerY - halfHeight,
          centerY - halfHeight * 0.5,
          centerY,
          centerY + halfHeight * 0.5,
          centerY + halfHeight,
        ];
  let minChord = Infinity;
  for (const y0 of samples) {
    const chord = polygonHorizontalChordWidthAtY(pts, y0);
    if (chord > 0) minChord = Math.min(minChord, chord);
  }
  if (!Number.isFinite(minChord) || minChord <= 0) return 0;
  return Math.max(0, minChord * curveInset - insetX * 2);
}

export function computeBestPolygonLabelBand(args: {
  polygonPixelPts: { x: number; y: number }[];
  labelHalfHeight: number;
  insetXLocal: number;
  curveInsetFactor?: number;
}): { centerY: number; innerWidth: number } {
  const curveInset = args.curveInsetFactor ?? 0.96;
  const minY = Math.min(...args.polygonPixelPts.map((p) => p.y));
  const maxY = Math.max(...args.polygonPixelPts.map((p) => p.y));
  const hh = Math.max(0, args.labelHalfHeight);
  const baseCenter = (minY + maxY) / 2;
  const low = minY + hh;
  const high = maxY - hh;

  if (low > high) {
    return {
      centerY: baseCenter,
      innerWidth: polygonMinChordAcrossVerticalBandAtY(
        args.polygonPixelPts,
        baseCenter,
        hh,
        curveInset,
        args.insetXLocal,
      ),
    };
  }

  const steps = 18;
  let bestCenter = clamp(0, low, high);
  let bestWidth = -1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const centerY = low + (high - low) * t;
    const w = polygonMinChordAcrossVerticalBandAtY(
      args.polygonPixelPts,
      centerY,
      hh,
      curveInset,
      args.insetXLocal,
    );
    if (w > bestWidth) {
      bestWidth = w;
      bestCenter = centerY;
    }
  }

  return { centerY: bestCenter, innerWidth: Math.max(0, bestWidth) };
}

export function computeInnerLabelWidthRounded(args: {
  w: number;
  h: number;
  insetXLocal: number;
  isCircular: boolean;
  isOval: boolean;
  labelHalfHeight: number;
  curveInsetFactor?: number;
  /** When set (pixel coords, origin = table centre), cap label width to polygon cross-sections. */
  polygonPixelPts?: { x: number; y: number }[] | null;
}): number {
  const minInner = 14;
  const rectCap = Math.max(minInner, args.w - args.insetXLocal * 2);
  const curveInset = args.curveInsetFactor ?? 0.96;

  if (args.polygonPixelPts && args.polygonPixelPts.length >= 3) {
    const { innerWidth: polyW } = computeBestPolygonLabelBand({
      polygonPixelPts: args.polygonPixelPts,
      labelHalfHeight: args.labelHalfHeight,
      insetXLocal: args.insetXLocal,
      curveInsetFactor: curveInset,
    });
    if (polyW > 0) {
      return Math.max(minInner, Math.min(rectCap, polyW));
    }
    return Math.max(minInner, Math.min(rectCap, args.w * 0.28));
  }

  if (!args.isCircular && !args.isOval) {
    return rectCap;
  }

  const pad = 1.5;
  const yUse = args.labelHalfHeight + pad;

  let chordHalf: number;
  if (args.isCircular) {
    const r = Math.min(args.w, args.h) / 2 - 0.75;
    chordHalf = circleHalfChordAtY(Math.max(1, r), yUse);
  } else {
    const rX = args.w / 2 - 0.75;
    const rY = args.h / 2 - 0.75;
    chordHalf = ellipseHalfChordAtY(rX, rY, yUse);
  }

  const chordW = Math.max(minInner, 2 * chordHalf * curveInset);
  return Math.min(rectCap, chordW);
}

export interface TableLabelFitInput {
  w: number;
  h: number;
  shape: string;
  topLabel: string;
  bottomLabel: string;
  compactLabels: boolean;
  layoutScale?: number | null;
  /** Normalised polygon vertices (0–100 in table bbox), same as `venue_tables.polygon_points`. */
  polygon_points?: { x: number; y: number }[] | null;
}

export interface TableLabelFitResult {
  fontName: number;
  fontCap: number;
  gap: number;
}

/** Single-line box height for Konva Text (bold needs extra headroom vs raw fontSize). */
function compactLineBox(fs: number, bold: boolean): number {
  return Math.ceil(fs * (bold ? 1.32 : 1.24)) + 2;
}

/**
 * Per-table shrink loop — must stay in sync with `TableShape` label layout.
 */
export function computeFittedTableLabelFonts(input: TableLabelFitInput): TableLabelFitResult {
  const { w, h, shape, topLabel, bottomLabel, compactLabels, layoutScale, polygon_points } = input;
  const hasBottomLabel = bottomLabel.trim().length > 0;
  const bottomLines = hasBottomLabel ? Math.max(1, bottomLabel.split('\n').length) : 0;
  const isCircular = shape === 'circle';
  const isOval = shape === 'oval';
  const isPolygon = shape === 'polygon';
  const polygonPixelPts =
    isPolygon && polygon_points && polygon_points.length >= 3
      ? polygon_points.map((pt) => ({
          x: (pt.x / 100 - 0.5) * w,
          y: (pt.y / 100 - 0.5) * h,
        }))
      : null;

  const minDim = Math.min(w, h);
  let topEdge = isCircular ? -Math.min(w, h) / 2 : -h / 2;
  let bottomEdge = isCircular ? Math.min(w, h) / 2 : h / 2;
  if (polygonPixelPts) {
    topEdge = Math.min(...polygonPixelPts.map((p) => p.y));
    bottomEdge = Math.max(...polygonPixelPts.map((p) => p.y));
  }

  const widthNeed = (txt: string, fs: number, bold: boolean) =>
    txt.length * (bold ? fs * 0.56 : fs * 0.52);

  const maxLineWidthNeed = (txt: string, fs: number, bold: boolean) => {
    if (!txt) return 0;
    const widths = txt.split('\n').map((line) => widthNeed(line, fs, bold));
    return widths.length > 0 ? Math.max(...widths) : 0;
  };

  if (compactLabels) {
    const insetXLocal = clamp(w * 0.03, 1, 6);
    const innerH = Math.max(0, bottomEdge - topEdge);

    let fn = Math.round(clamp(minDim * 0.4, 11, 18));
    let fc = Math.round(clamp(minDim * 0.36, 10, 17));
    let gap = 2;

    const measureBlock = (nameFs: number, capFs: number, g: number) => {
      const nh = nameFs + 1;
      const ch = hasBottomLabel ? capFs + 1 : 0;
      const lineGap = bottomLines > 1 ? bottomLines - 1 : 0;
      const capBlock = hasBottomLabel ? ch * bottomLines + lineGap : 0;
      return { blockH: nh + (hasBottomLabel ? g + capBlock : 0), nameBox: nh, capBox: capBlock };
    };

    let { blockH } = measureBlock(fn, fc, gap);
    let computedInnerW = computeInnerLabelWidthRounded({
      w,
      h,
      insetXLocal,
      isCircular,
      isOval,
      labelHalfHeight: blockH / 2,
      curveInsetFactor: 0.97,
      polygonPixelPts,
    });
    let iter = 0;
    while (iter < 120) {
      const fitsHeight = blockH <= innerH;
      const fitsWidth =
        widthNeed(topLabel, fn, true) <= computedInnerW &&
        maxLineWidthNeed(bottomLabel, fc, false) <= computedInnerW;
      if (fitsHeight && fitsWidth) break;

      if (gap > 0) gap -= 1;
      else if (fn >= fc && fn > 4) fn -= 1;
      else if (fc > 4) fc -= 1;
      else break;

      ({ blockH } = measureBlock(fn, fc, gap));
      computedInnerW = computeInnerLabelWidthRounded({
        w,
        h,
        insetXLocal,
        isCircular,
        isOval,
        labelHalfHeight: blockH / 2,
        curveInsetFactor: 0.97,
        polygonPixelPts,
      });
      iter += 1;
    }

    return { fontName: fn, fontCap: fc, gap };
  }

  const insetY = clamp(minDim * 0.032, 2, 6);
  const insetXLocal = clamp(w * 0.032, 2, 7);
  const innerTop = topEdge + insetY;
  const innerBottom = bottomEdge - insetY;
  const innerH = Math.max(0, innerBottom - innerTop);

  const zoomReadabilityBoost =
    layoutScale != null && layoutScale > 0 ? clamp(0.52 / layoutScale, 1, 2.6) : 1;

  let fn = Math.round(clamp(minDim * 0.46, 14, 30) * zoomReadabilityBoost);
  let fc = Math.round(clamp(minDim * 0.4, 12, 26) * zoomReadabilityBoost);
  fn = Math.min(fn, 42);
  fc = Math.min(fc, 36);
  let gap = 2;

    const measureBlock = (nameFs: number, capFs: number, g: number) => {
      const nh = compactLineBox(nameFs, true);
      const lineH = hasBottomLabel ? compactLineBox(capFs, false) : 0;
      const betweenSub =
        hasBottomLabel && bottomLines > 1 ? (bottomLines - 1) * Math.max(1, Math.round(capFs * 0.12)) : 0;
      const ch = hasBottomLabel ? lineH * bottomLines + betweenSub : 0;
      return { blockH: nh + (hasBottomLabel ? g + ch : 0), nameBox: nh, capBox: ch };
    };

  let { blockH } = measureBlock(fn, fc, gap);
  let computedInnerW = computeInnerLabelWidthRounded({
    w,
    h,
    insetXLocal,
    isCircular,
    isOval,
    labelHalfHeight: blockH / 2,
    curveInsetFactor: 0.97,
    polygonPixelPts,
  });
  let iter = 0;
  while (iter < 140) {
    const fitsHeight = blockH <= innerH;
    const fitsWidth =
      widthNeed(topLabel, fn, true) <= computedInnerW &&
      maxLineWidthNeed(bottomLabel, fc, false) <= computedInnerW;
    if (fitsHeight && fitsWidth) break;

    if (gap > 0) gap -= 1;
    else if (fn >= fc && fn > 7) fn -= 1;
    else if (fc > 7) fc -= 1;
    else break;

    ({ blockH } = measureBlock(fn, fc, gap));
    computedInnerW = computeInnerLabelWidthRounded({
      w,
      h,
      insetXLocal,
      isCircular,
      isOval,
      labelHalfHeight: blockH / 2,
      curveInsetFactor: 0.97,
      polygonPixelPts,
    });
    iter += 1;
  }

  return { fontName: fn, fontCap: fc, gap };
}

/** Minimum font sizes across all tables so labels look consistent on one floor. */
export function computeGlobalUnifiedLabelFonts(
  inputs: TableLabelFitInput[],
): TableLabelFitResult | null {
  if (inputs.length === 0) return null;
  const fits = inputs.map(computeFittedTableLabelFonts);
  return {
    fontName: Math.min(...fits.map((f) => f.fontName)),
    fontCap: Math.min(...fits.map((f) => f.fontCap)),
    gap: Math.min(...fits.map((f) => f.gap)),
  };
}
