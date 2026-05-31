'use client';

import { useCallback, useRef, useState } from 'react';
import { BookingPageCoverPhoto } from '@/components/booking/BookingPageCoverPhoto';
import { bookingPageImagePanFromPointerDelta } from '@/lib/booking/booking-page-image-framing';
import {
  BOOKING_PAGE_COVER_SETTINGS_FRAME_CLASS,
  bookingPageCoverSettingsPreviewSize,
  resolveBookingPageCoverCrop,
  type BookingPageCoverCrop,
} from '@/lib/booking/booking-page-cover';

interface BookingPageDraggableCoverProps {
  coverUrl: string;
  crop: BookingPageCoverCrop;
  disabled?: boolean;
  onCropChange: (crop: BookingPageCoverCrop) => void;
}

/** Settings-row cover thumbnail with drag-to-reposition. */
export function BookingPageDraggableCover({
  coverUrl,
  crop,
  disabled = false,
  onCropChange,
}: BookingPageDraggableCoverProps) {
  const resolved = resolveBookingPageCoverCrop(crop);
  const frameRef = useRef<HTMLDivElement>(null);
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
      const rect = frameRef.current?.getBoundingClientRect();
      const fallback = bookingPageCoverSettingsPreviewSize();
      const w = rect?.width ?? fallback.width;
      const h = rect?.height ?? fallback.height;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const { dx: panDx, dy: panDy } = bookingPageImagePanFromPointerDelta(dx, dy, w, h);
      const nextX = Math.min(100, Math.max(0, dragRef.current.cropX + panDx));
      const nextY = Math.min(100, Math.max(0, dragRef.current.cropY + panDy));
      onCropChange({
        ...resolveBookingPageCoverCrop(crop),
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
      ref={frameRef}
      role="presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`${BOOKING_PAGE_COVER_SETTINGS_FRAME_CLASS} touch-none ${
        disabled ? 'cursor-not-allowed opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      title={disabled ? undefined : 'Drag to reposition the cover photo'}
      aria-label={disabled ? undefined : 'Drag to reposition the cover photo'}
    >
      <BookingPageCoverPhoto coverUrl={coverUrl} crop={crop} className="h-full w-full" />
    </div>
  );
}
