import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';
import {
  bookingPageImageFramingStyle,
  DEFAULT_BOOKING_PAGE_IMAGE_FRAMING,
  resolveBookingPageImageFraming,
  sanitizeBookingPageImageFraming,
  type BookingPageImageFraming,
} from '@/lib/booking/booking-page-image-framing';

export type BookingPageCoverCrop = BookingPageImageFraming;

export const DEFAULT_BOOKING_PAGE_COVER_CROP = DEFAULT_BOOKING_PAGE_IMAGE_FRAMING;

/** Fixed banner height on the public booking page (`h-44` = 11rem). */
export const BOOKING_PAGE_COVER_PUBLIC_HEIGHT_PX = 176;

/** Reference width for settings preview crop (matches live preview mobile column). */
export const BOOKING_PAGE_COVER_REFERENCE_WIDTH_PX = 390;

/** Settings thumbnail aspect matches the public banner at the reference width. */
export const BOOKING_PAGE_COVER_ASPECT_CLASS = 'aspect-[390/176]';

/** Inline settings thumbnail width (`w-56`); height follows the banner aspect ratio. */
export const BOOKING_PAGE_COVER_SETTINGS_WIDTH_PX = 224;

/** Public `/book` — full-width strip with fixed height on all screen sizes. */
export const BOOKING_PAGE_COVER_PUBLIC_FRAME_CLASS = 'h-44 w-full overflow-hidden';

/** Public `/book` — fixed column width (matches `max-w-lg` content), same fixed height. */
export const BOOKING_PAGE_COVER_CONTAINED_PUBLIC_FRAME_CLASS =
  'h-44 w-full overflow-hidden rounded-xl ring-1 ring-slate-200/80';

/** Default is contained width; only `cover_full_width: true` uses the edge-to-edge banner. */
export function bookingPageCoverIsFullWidth(
  config: Pick<BookingPageConfig, 'cover_full_width'> | null | undefined,
): boolean {
  return config?.cover_full_width === true;
}

export const BOOKING_PAGE_COVER_SETTINGS_FRAME_CLASS = `${BOOKING_PAGE_COVER_ASPECT_CLASS} w-56 max-w-full shrink-0 overflow-hidden rounded-xl ring-1 ring-slate-200/80`;

export const BOOKING_PAGE_COVER_SETTINGS_PLACEHOLDER_FRAME_CLASS = `${BOOKING_PAGE_COVER_ASPECT_CLASS} w-56 max-w-full shrink-0 flex items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-500 ring-1 ring-slate-200`;

export function bookingPageCoverSettingsPreviewSize(): { width: number; height: number } {
  const width = BOOKING_PAGE_COVER_SETTINGS_WIDTH_PX;
  return {
    width,
    height: Math.round((width * BOOKING_PAGE_COVER_PUBLIC_HEIGHT_PX) / BOOKING_PAGE_COVER_REFERENCE_WIDTH_PX),
  };
}

export const sanitizeBookingPageCoverCrop = sanitizeBookingPageImageFraming;
export const resolveBookingPageCoverCrop = resolveBookingPageImageFraming;
export const bookingPageCoverImageStyle = bookingPageImageFramingStyle;

export function bookingPageCoverCropFromConfig(
  config: BookingPageConfig | null | undefined,
): Required<BookingPageCoverCrop> {
  return resolveBookingPageCoverCrop(config?.cover_crop ?? null);
}
