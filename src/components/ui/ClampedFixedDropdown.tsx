'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { computeAnchoredDropdownStyle } from '@/lib/ui/clamped-floating-styles';
import { getViewportBounds } from '@/lib/ui/viewport-bounds';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

/**
 * Fixed-position dropdown clamped to the visual viewport, aligned to a trigger element.
 * Use for toolbars where `absolute` panels are clipped or overflow horizontally on mobile.
 */
export function ClampedFixedDropdown({
  open,
  triggerRef,
  verticalAnchorRef,
  horizontalCenter,
  align,
  maxWidthPx,
  gapPx,
  className,
  children,
  id,
  onDismiss,
  ignoreDismissIf,
  'aria-label': ariaLabel,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  /** Toolbar surface under the triggers (positions dropdown just beneath this rect). */
  verticalAnchorRef?: RefObject<HTMLElement | null>;
  horizontalCenter?: boolean;
  align: 'start' | 'end';
  maxWidthPx: number;
  gapPx?: number;
  className?: string;
  children: ReactNode;
  id?: string;
  onDismiss?: () => void;
  /** Targets inside nested portaled panels (still inside this dropdown logically) won't dismiss */
  ignoreDismissIf?: (target: EventTarget | null) => boolean;
  'aria-label'?: string;
}) {
  const [style, setStyle] = useState<CSSProperties>({});
  const panelRef = useRef<HTMLDivElement>(null);

  useDismissibleLayer({
    open: open && Boolean(onDismiss),
    refs: [triggerRef, panelRef],
    onDismiss: onDismiss ?? (() => {}),
    ignoreDismissIf,
  });

  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const anchorEl = verticalAnchorRef?.current;
      const verticalAnchorRect =
        anchorEl && typeof anchorEl.getBoundingClientRect === 'function'
          ? anchorEl.getBoundingClientRect()
          : undefined;
      const { width: vw, height: vh } = getViewportBounds();
      setStyle(
        computeAnchoredDropdownStyle({
          triggerRect: rect,
          verticalAnchorRect:
            verticalAnchorRect != null ? { top: verticalAnchorRect.top, bottom: verticalAnchorRect.bottom } : undefined,
          horizontalCenter,
          viewportWidth: vw,
          viewportHeight: vh,
          maxWidthPx,
          gapPx,
          align,
        }),
      );
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [horizontalCenter, gapPx, open, align, maxWidthPx, triggerRef, verticalAnchorRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={ariaLabel}
      className={className}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
