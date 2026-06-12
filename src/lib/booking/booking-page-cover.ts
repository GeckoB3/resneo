import type { CSSProperties } from 'react';
import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';

/**
 * Free-form cover crop. The uploaded photo is never altered; we store the region the venue
 * chose to display as fractions of the natural image (`x`/`y` top-left, `w`/`h` size, all
 * 0–1) plus the source aspect ratio `ar` (natural width ÷ height). That's enough to size the
 * display box and offset the image with pure CSS — no server-side image processing, no
 * client measurement at render time. No crop stored → the whole photo shows at its own shape.
 */
export interface BookingPageCoverCropBox {
  /** Left edge as a fraction of the source width (0–1). */
  x: number;
  /** Top edge as a fraction of the source height (0–1). */
  y: number;
  /** Crop width as a fraction of the source width (>0–1). */
  w: number;
  /** Crop height as a fraction of the source height (>0–1). */
  h: number;
  /** Source image aspect ratio (natural width ÷ height), used to size the display box. */
  ar: number;
}

/** A crop covering essentially the whole frame is treated as "no crop". */
const FULL_FRAME_EPS = 0.999;
const MIN_CROP_FRACTION = 0.02;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Normalise a stored/posted crop box. Clamps the rectangle inside the image, drops a
 * full-frame crop to `null` (so the default "whole photo" path is taken), and rejects
 * anything malformed.
 */
export function sanitizeBookingPageCoverCropBox(raw: unknown): BookingPageCoverCropBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const read = (k: string): number =>
    typeof src[k] === 'number' && Number.isFinite(src[k]) ? (src[k] as number) : Number.NaN;

  const ar = read('ar');
  if (!(ar > 0) || !Number.isFinite(ar)) return null;

  const x = clamp01(read('x'));
  const y = clamp01(read('y'));
  let w = read('w');
  let h = read('h');
  if (!(w > 0) || !(h > 0)) return null;
  w = Math.min(clamp01(w), 1 - x);
  h = Math.min(clamp01(h), 1 - y);
  if (w < MIN_CROP_FRACTION || h < MIN_CROP_FRACTION) return null;

  // Whole image selected → no crop needed; let the natural-aspect path render it.
  if (x === 0 && y === 0 && w >= FULL_FRAME_EPS && h >= FULL_FRAME_EPS) return null;

  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h), ar: round4(ar) };
}

/** Returns the crop box only when it is a real (non-full-frame) crop, else `null`. */
export function resolveBookingPageCoverCropBox(
  raw: BookingPageCoverCropBox | null | undefined,
): BookingPageCoverCropBox | null {
  return sanitizeBookingPageCoverCropBox(raw);
}

/** Display aspect ratio (width ÷ height) of the visible cover for a given crop. */
export function bookingPageCoverDisplayAspect(box: BookingPageCoverCropBox): number {
  return (box.w / box.h) * box.ar;
}

/**
 * Inline styles that show exactly the crop region: a box at the crop's aspect ratio, with the
 * image scaled and offset so the selected rectangle fills it. Derivation: scaling the image so
 * `w` of its width spans the box width makes box-aspect = (w/h)·ar, image width = 100/w% of the
 * box, and the crop's top-left sits at −x/w, −y/h (as % of box width/height).
 */
export function bookingPageCoverCropRenderStyle(box: BookingPageCoverCropBox): {
  container: CSSProperties;
  image: CSSProperties;
} {
  return {
    container: {
      position: 'relative',
      width: '100%',
      aspectRatio: `${round4(bookingPageCoverDisplayAspect(box))}`,
      overflow: 'hidden',
    },
    image: {
      position: 'absolute',
      top: `${round4(-(box.y / box.h) * 100)}%`,
      left: `${round4(-(box.x / box.w) * 100)}%`,
      width: `${round4(100 / box.w)}%`,
      height: 'auto',
      maxWidth: 'none',
    },
  };
}

/**
 * Public `/book` cover wrapper. Full width spans the screen; contained sits in the content
 * column with a rounded ring. Height is driven by the photo (whole) or the crop's shape — no
 * fixed banner height, so nothing is ever forced-cropped.
 */
export function bookingPageCoverPublicFrameClass(fullWidth: boolean): string {
  return fullWidth
    ? 'w-full overflow-hidden'
    : 'w-full overflow-hidden rounded-xl ring-1 ring-slate-200/80';
}

/** Settings-row thumbnail frame (bounded width; height follows the photo/crop). */
export const BOOKING_PAGE_COVER_SETTINGS_FRAME_CLASS =
  'w-72 max-w-full shrink-0 overflow-hidden rounded-xl ring-1 ring-slate-200/80';

/** Placeholder shown before any cover is uploaded. */
export const BOOKING_PAGE_COVER_SETTINGS_PLACEHOLDER_FRAME_CLASS =
  'aspect-[3/1] w-72 max-w-full shrink-0 flex items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-500 ring-1 ring-slate-200';

/** Default is contained width; only `cover_full_width: true` uses the edge-to-edge banner. */
export function bookingPageCoverIsFullWidth(
  config: Pick<BookingPageConfig, 'cover_full_width'> | null | undefined,
): boolean {
  return config?.cover_full_width === true;
}

export function bookingPageCoverCropBoxFromConfig(
  config: Pick<BookingPageConfig, 'cover_crop_box'> | null | undefined,
): BookingPageCoverCropBox | null {
  return resolveBookingPageCoverCropBox(config?.cover_crop_box ?? null);
}
