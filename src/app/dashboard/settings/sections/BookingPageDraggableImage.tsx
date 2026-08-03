'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  bookingPageImageFramingStyle,
  bookingPageImagePanFromPointerDelta,
  resolveBookingPageImageFraming,
  type BookingPageImageFraming,
} from '@/lib/booking/booking-page-image-framing';

interface BookingPageDraggableImageProps {
  imageUrl: string;
  crop: BookingPageImageFraming | null | undefined;
  onCropChange: (crop: BookingPageImageFraming) => void;
  /** Rendered frame size in px; also the drag sensitivity basis. */
  sizePx: number;
  /** Circle for people, rounded square for everything else. */
  shape?: 'circle' | 'rounded';
  disabled?: boolean;
  /** Announced to screen readers, e.g. "Reposition photo for Alex". */
  label: string;
  /**
   * Render the framed image yourself (the logo badge has its own chrome). It must size itself
   * to `sizePx`, clip its own overflow, and apply the framing style.
   */
  children?: ReactNode;
}

/** Arrow-key step on the 0–100 position scale (Shift for a coarser move). */
const NUDGE = 2;
const NUDGE_LARGE = 10;

const clampPosition = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));

/**
 * Photo thumbnail with drag-to-reposition, matching the frame the photo appears in publicly.
 *
 * The image is clipped by this frame: zoom is a CSS transform, which would otherwise paint
 * outside the box. Arrow keys nudge the position, so framing is not mouse-only.
 */
export function BookingPageDraggableImage({
  imageUrl,
  crop,
  onCropChange,
  sizePx,
  shape = 'rounded',
  disabled = false,
  label,
  children,
}: BookingPageDraggableImageProps) {
  const resolved = resolveBookingPageImageFraming(crop);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; cropX: number; cropY: number } | null>(
    null,
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        cropX: resolved.x,
        cropY: resolved.y,
      };
      setDragging(true);
    },
    [disabled, resolved.x, resolved.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current || disabled) return;
      const { dx, dy } = bookingPageImagePanFromPointerDelta(
        e.clientX - dragRef.current.startX,
        e.clientY - dragRef.current.startY,
        sizePx,
        sizePx,
      );
      onCropChange({
        ...resolveBookingPageImageFraming(crop),
        x: clampPosition(dragRef.current.cropX + dx),
        y: clampPosition(dragRef.current.cropY + dy),
      });
    },
    [crop, disabled, onCropChange, sizePx],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be released
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const step = e.shiftKey ? NUDGE_LARGE : NUDGE;
      const current = resolveBookingPageImageFraming(crop);
      let { x, y } = current;
      switch (e.key) {
        case 'ArrowLeft':
          x -= step;
          break;
        case 'ArrowRight':
          x += step;
          break;
        case 'ArrowUp':
          y -= step;
          break;
        case 'ArrowDown':
          y += step;
          break;
        default:
          return;
      }
      e.preventDefault();
      onCropChange({ ...current, x: clampPosition(x), y: clampPosition(y) });
    },
    [crop, disabled, onCropChange],
  );

  const hint = disabled ? undefined : `${label}. Drag, or use the arrow keys.`;

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      title={hint}
      aria-label={hint}
      style={children ? undefined : { width: sizePx, height: sizePx }}
      className={`shrink-0 touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        shape === 'circle' ? 'rounded-full' : 'rounded-lg'
      } ${children ? '' : 'overflow-hidden bg-slate-100 ring-1 ring-slate-200'} ${
        disabled ? 'cursor-not-allowed opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {children ?? (
        <img
          src={imageUrl}
          alt=""
          className="pointer-events-none h-full w-full select-none"
          style={bookingPageImageFramingStyle(crop)}
          draggable={false}
        />
      )}
    </div>
  );
}
