import type { CSSProperties } from 'react';
import { viewportMarginPx } from '@/lib/ui/viewport-margin';

/** Below Tailwind `md` — calendar booking popovers use a centered, full-height layout. */
export const MOBILE_POPOVER_MAX_VIEWPORT_WIDTH_PX = 768;

function computeMobilePopoverPanelStyle(params: {
  viewportWidth: number;
  viewportHeight: number;
}): CSSProperties {
  const margin = viewportMarginPx(params.viewportWidth);
  const vw = params.viewportWidth;
  const vh = params.viewportHeight;
  const panelWidth = vw - 2 * margin;
  const maxHeight = vh - 2 * margin;

  return {
    width: panelWidth,
    maxWidth: panelWidth,
    boxSizing: 'border-box',
    left: margin,
    top: '50%',
    transform: 'translateY(-50%)',
    maxHeight,
    overflow: 'hidden',
  };
}

export function computePopoverPanelStyle(params: {
  anchorX: number;
  anchorY: number;
  viewportWidth: number;
  viewportHeight: number;
  maxPanelWidth?: number;
}): CSSProperties {
  const margin = viewportMarginPx(params.viewportWidth);
  const vw = params.viewportWidth;
  const vh = params.viewportHeight;

  if (vw < MOBILE_POPOVER_MAX_VIEWPORT_WIDTH_PX) {
    return computeMobilePopoverPanelStyle({
      viewportWidth: vw,
      viewportHeight: vh,
    });
  }

  const panelWidth = Math.min(params.maxPanelWidth ?? 640, vw - 2 * margin);

  const { anchorX, anchorY } = params;
  const canOpenRight = anchorX + panelWidth + 22 <= vw;
  const leftCandidate = canOpenRight ? anchorX + 10 : anchorX - panelWidth - 10;
  const left = Math.min(Math.max(margin, leftCandidate), Math.max(margin, vw - panelWidth - margin));

  const top = Math.max(margin, anchorY + 10);
  const spaceAbove = anchorY - margin - 18;
  const spaceBelow = vh - top - margin;
  const openAbove = spaceBelow < 520 && spaceAbove > spaceBelow;

  const base: CSSProperties = {
    width: panelWidth,
    maxWidth: panelWidth,
    boxSizing: 'border-box',
    left,
    overflow: 'hidden',
  };

  if (openAbove) {
    return {
      ...base,
      bottom: Math.max(margin, vh - anchorY + 10),
      maxHeight: Math.max(220, spaceAbove),
    };
  }

  return {
    ...base,
    top,
    maxHeight: Math.max(220, spaceBelow),
  };
}

/** Context / right-click menus anchored to a pointer position. */
export function computePointAnchoredMenuStyle(params: {
  anchorX: number;
  anchorY: number;
  viewportWidth: number;
  viewportHeight: number;
  minWidth?: number;
  maxWidth?: number;
  maxHeightFraction?: number;
  gapPx?: number;
}): CSSProperties {
  const margin = viewportMarginPx(params.viewportWidth);
  const vw = params.viewportWidth;
  const vh = params.viewportHeight;
  const gap = params.gapPx ?? 6;
  const maxW = Math.min(params.maxWidth ?? 320, vw - 2 * margin);
  const minW = Math.min(params.minWidth ?? 200, maxW);
  const width = Math.max(minW, maxW);

  let left = params.anchorX;
  left = Math.min(Math.max(margin, left), vw - width - margin);

  const anchorY = params.anchorY;
  const maxMenuH = Math.min(
    Math.floor(vh * (params.maxHeightFraction ?? 0.72)),
    vh - 2 * margin,
  );

  let top = anchorY + gap;
  const spaceBelow = vh - top - margin;
  const spaceAbove = anchorY - margin;

  if (spaceBelow < 140 && spaceAbove > spaceBelow) {
    const maxH = Math.max(120, Math.min(maxMenuH, spaceAbove - gap));
    return {
      position: 'fixed',
      left,
      bottom: Math.max(margin, vh - anchorY + gap),
      width,
      minWidth: minW,
      maxWidth: maxW,
      maxHeight: maxH,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      boxSizing: 'border-box',
    };
  }

  top = Math.max(margin, top);
  const maxH = Math.max(120, Math.min(maxMenuH, vh - top - margin));
  return {
    position: 'fixed',
    left,
    top,
    width,
    minWidth: minW,
    maxWidth: maxW,
    maxHeight: maxH,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    boxSizing: 'border-box',
  };
}

/** Toolbar / trigger-anchored dropdowns (fixed, scrollable). */
export function computeAnchoredDropdownStyle(params: {
  triggerRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
  viewportWidth: number;
  viewportHeight: number;
  maxWidthPx: number;
  gapPx?: number;
  align: 'start' | 'end';
  /**
   * Anchor vertical placement to this rect's bottom/top (e.g. full operations toolbar card).
   * Defaults to trigger bottom when omitted.
   */
  verticalAnchorRect?: Pick<DOMRect, 'top' | 'bottom'>;
  /** Horizontal center across the viewport instead of aligning to trigger X. */
  horizontalCenter?: boolean;
}): CSSProperties {
  const margin = viewportMarginPx(params.viewportWidth);
  const vw = params.viewportWidth;
  const vh = params.viewportHeight;
  const gap = params.gapPx ?? 6;
  const width = Math.min(params.maxWidthPx, vw - 2 * margin);

  const vertical = params.verticalAnchorRect ?? params.triggerRect;

  let left = params.horizontalCenter
    ? (vw - width) / 2
    : params.align === 'end'
      ? params.triggerRect.right - width
      : params.triggerRect.left;
  left = Math.min(Math.max(margin, left), vw - width - margin);

  let top = vertical.bottom + gap;
  const spaceBelow = vh - top - margin;
  const spaceAbove = vertical.top - margin;
  const maxPanelHeight = Math.min(Math.floor(vh * 0.72), 520);

  if (spaceBelow < 120 && spaceAbove > spaceBelow) {
    const maxH = Math.max(140, Math.min(maxPanelHeight, vertical.top - margin - gap));
    return {
      position: 'fixed',
      left,
      bottom: Math.max(margin, vh - vertical.top + gap),
      width,
      maxHeight: maxH,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      boxSizing: 'border-box',
    };
  }

  top = Math.min(Math.max(margin, top), vh - margin - 80);
  const maxH = Math.max(140, Math.min(maxPanelHeight, vh - top - margin));
  return {
    position: 'fixed',
    left,
    top,
    width,
    maxHeight: maxH,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    boxSizing: 'border-box',
  };
}
