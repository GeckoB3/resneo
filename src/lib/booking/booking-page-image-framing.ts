/** Pan/zoom framing for booking-page images (logo badge, cover banner, etc.). */
export interface BookingPageImageFraming {
  /** Horizontal position 0–100 (50 = centred). */
  x?: number;
  /** Vertical position 0–100 (50 = centred). */
  y?: number;
  /** Scale 0.5–3: below 1 shows more of the image, above 1 zooms in. */
  zoom?: number;
}

export const DEFAULT_BOOKING_PAGE_IMAGE_FRAMING: Required<BookingPageImageFraming> = {
  x: 50,
  y: 50,
  zoom: 1,
};

export const BOOKING_PAGE_IMAGE_ZOOM_MIN = 0.5;
export const BOOKING_PAGE_IMAGE_ZOOM_MAX = 3;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function sanitizeBookingPageImageFraming(raw: unknown): BookingPageImageFraming | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const framing: BookingPageImageFraming = {};

  if (typeof src.x === 'number' && Number.isFinite(src.x)) {
    framing.x = round1(clamp(src.x, 0, 100));
  }
  if (typeof src.y === 'number' && Number.isFinite(src.y)) {
    framing.y = round1(clamp(src.y, 0, 100));
  }
  if (typeof src.zoom === 'number' && Number.isFinite(src.zoom)) {
    framing.zoom = round1(clamp(src.zoom, BOOKING_PAGE_IMAGE_ZOOM_MIN, BOOKING_PAGE_IMAGE_ZOOM_MAX));
  }

  const merged = resolveBookingPageImageFraming(framing);
  if (
    merged.x === DEFAULT_BOOKING_PAGE_IMAGE_FRAMING.x &&
    merged.y === DEFAULT_BOOKING_PAGE_IMAGE_FRAMING.y &&
    merged.zoom === DEFAULT_BOOKING_PAGE_IMAGE_FRAMING.zoom
  ) {
    return null;
  }
  return merged;
}

export function resolveBookingPageImageFraming(
  framing: BookingPageImageFraming | null | undefined,
): Required<BookingPageImageFraming> {
  return {
    x: typeof framing?.x === 'number' ? clamp(framing.x, 0, 100) : DEFAULT_BOOKING_PAGE_IMAGE_FRAMING.x,
    y: typeof framing?.y === 'number' ? clamp(framing.y, 0, 100) : DEFAULT_BOOKING_PAGE_IMAGE_FRAMING.y,
    zoom:
      typeof framing?.zoom === 'number'
        ? clamp(framing.zoom, BOOKING_PAGE_IMAGE_ZOOM_MIN, BOOKING_PAGE_IMAGE_ZOOM_MAX)
        : DEFAULT_BOOKING_PAGE_IMAGE_FRAMING.zoom,
  };
}

/** Map pointer drag (px) to position delta on the 0–100 scale. */
export function bookingPageImagePanFromPointerDelta(
  dx: number,
  dy: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): { dx: number; dy: number } {
  const w = Math.max(viewportWidthPx, 1);
  const h = Math.max(viewportHeightPx, 1);
  return { dx: dx * (100 / w), dy: dy * (100 / h) };
}

export function bookingPageImageFramingStyle(
  framing: BookingPageImageFraming | null | undefined,
): {
  objectFit: 'cover';
  objectPosition: string;
  transform: string;
  transformOrigin: string;
} {
  const { x, y, zoom } = resolveBookingPageImageFraming(framing);
  const tx = x - 50;
  const ty = y - 50;
  const parts: string[] = [];
  if (tx !== 0 || ty !== 0) {
    parts.push(`translate(${round1(tx)}%, ${round1(ty)}%)`);
  }
  if (zoom !== 1) {
    parts.push(`scale(${zoom})`);
  }
  return {
    objectFit: 'cover',
    objectPosition: 'center',
    transform: parts.length > 0 ? parts.join(' ') : 'none',
    transformOrigin: 'center',
  };
}
