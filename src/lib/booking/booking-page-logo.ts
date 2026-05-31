import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';
import {
  BOOKING_PAGE_IMAGE_ZOOM_MAX,
  BOOKING_PAGE_IMAGE_ZOOM_MIN,
  bookingPageImageFramingStyle,
  bookingPageImagePanFromPointerDelta,
  DEFAULT_BOOKING_PAGE_IMAGE_FRAMING,
  resolveBookingPageImageFraming,
  sanitizeBookingPageImageFraming,
  type BookingPageImageFraming,
} from '@/lib/booking/booking-page-image-framing';

export type BookingPageLogoCrop = BookingPageImageFraming;

export const DEFAULT_BOOKING_PAGE_LOGO_CROP = DEFAULT_BOOKING_PAGE_IMAGE_FRAMING;
export const BOOKING_PAGE_LOGO_ZOOM_MIN = BOOKING_PAGE_IMAGE_ZOOM_MIN;
export const BOOKING_PAGE_LOGO_ZOOM_MAX = BOOKING_PAGE_IMAGE_ZOOM_MAX;

/** Outer diameter of `BookingPageLogo` per size (for drag sensitivity). */
export const BOOKING_PAGE_LOGO_SIZE_PX = {
  md: 96,
  lg: 128,
} as const;

export const sanitizeBookingPageLogoCrop = sanitizeBookingPageImageFraming;
export const resolveBookingPageLogoCrop = resolveBookingPageImageFraming;

export function bookingPageLogoCropFromConfig(
  config: BookingPageConfig | null | undefined,
): Required<BookingPageLogoCrop> {
  return resolveBookingPageLogoCrop(config?.logo_crop ?? null);
}

export function bookingPageLogoPanFromPointerDelta(
  dx: number,
  dy: number,
  viewportPx: number = BOOKING_PAGE_LOGO_SIZE_PX.md,
): { dx: number; dy: number } {
  return bookingPageImagePanFromPointerDelta(dx, dy, viewportPx, viewportPx);
}

export const bookingPageLogoImageStyle = bookingPageImageFramingStyle;
