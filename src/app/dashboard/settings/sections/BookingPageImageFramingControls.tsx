'use client';

import {
  BOOKING_PAGE_IMAGE_ZOOM_MAX,
  BOOKING_PAGE_IMAGE_ZOOM_MIN,
  DEFAULT_BOOKING_PAGE_IMAGE_FRAMING,
  resolveBookingPageImageFraming,
  type BookingPageImageFraming,
} from '@/lib/booking/booking-page-image-framing';

interface BookingPageImageFramingControlsProps {
  crop: BookingPageImageFraming;
  disabled?: boolean;
  onChange: (crop: BookingPageImageFraming) => void;
  /** Prefix for input ids (`logo` → `logo-zoom`). */
  controlId: string;
}

export function BookingPageImageFramingControls({
  crop,
  disabled = false,
  onChange,
  controlId,
}: BookingPageImageFramingControlsProps) {
  const resolved = resolveBookingPageImageFraming(crop);
  const zoomPercent = Math.round(resolved.zoom * 100);
  const zoomInputId = `${controlId}-zoom`;

  return (
    <>
      <div className="flex min-w-[10rem] flex-1 items-center gap-2 sm:max-w-xs">
        <label htmlFor={zoomInputId} className="shrink-0 text-sm font-medium text-slate-700">
          Scale
        </label>
        <input
          id={zoomInputId}
          type="range"
          min={Math.round(BOOKING_PAGE_IMAGE_ZOOM_MIN * 100)}
          max={Math.round(BOOKING_PAGE_IMAGE_ZOOM_MAX * 100)}
          step={5}
          disabled={disabled}
          value={zoomPercent}
          onChange={(e) =>
            onChange({
              ...resolveBookingPageImageFraming(crop),
              zoom: Number(e.target.value) / 100,
            })
          }
          className="min-w-[5rem] flex-1 accent-brand-600 disabled:opacity-50"
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">{zoomPercent}%</span>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange({ ...DEFAULT_BOOKING_PAGE_IMAGE_FRAMING })}
        className="shrink-0 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
      >
        Reset framing
      </button>
    </>
  );
}
