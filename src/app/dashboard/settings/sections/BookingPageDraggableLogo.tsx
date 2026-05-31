'use client';

import { useCallback, useRef, useState } from 'react';
import { BookingPageLogo } from '@/components/booking/BookingPageLogo';
import {
  BOOKING_PAGE_LOGO_SIZE_PX,
  bookingPageLogoPanFromPointerDelta,
  resolveBookingPageLogoCrop,
  type BookingPageLogoCrop,
} from '@/lib/booking/booking-page-logo';

interface BookingPageDraggableLogoProps {
  logoUrl: string;
  crop: BookingPageLogoCrop;
  disabled?: boolean;
  onCropChange: (crop: BookingPageLogoCrop) => void;
}

/** Settings-row logo with drag-to-reposition (same circle as on the booking page). */
export function BookingPageDraggableLogo({
  logoUrl,
  crop,
  disabled = false,
  onCropChange,
}: BookingPageDraggableLogoProps) {
  const resolved = resolveBookingPageLogoCrop(crop);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    cropX: number;
    cropY: number;
  } | null>(null);

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
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const { dx: panDx, dy: panDy } = bookingPageLogoPanFromPointerDelta(
        dx,
        dy,
        BOOKING_PAGE_LOGO_SIZE_PX.md,
      );
      const nextX = Math.min(100, Math.max(0, dragRef.current.cropX + panDx));
      const nextY = Math.min(100, Math.max(0, dragRef.current.cropY + panDy));
      onCropChange({
        ...resolveBookingPageLogoCrop(crop),
        x: Math.round(nextX * 10) / 10,
        y: Math.round(nextY * 10) / 10,
      });
    },
    [crop, disabled, onCropChange],
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

  return (
    <div
      role="presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`shrink-0 touch-none rounded-full ${
        disabled ? 'cursor-not-allowed opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      title={disabled ? undefined : 'Drag to reposition the logo'}
      aria-label={disabled ? undefined : 'Drag to reposition the logo'}
    >
      <BookingPageLogo logoUrl={logoUrl} alt="Logo" crop={crop} size="md" />
    </div>
  );
}
