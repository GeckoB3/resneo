import { describe, expect, it } from 'vitest';
import {
  bookingPageImageFramingStyle,
  bookingPageImagePanFromPointerDelta,
  DEFAULT_BOOKING_PAGE_IMAGE_FRAMING,
  resolveBookingPageImageFraming,
  sanitizeBookingPageImageFraming,
} from '@/lib/booking/booking-page-image-framing';
import {
  bookingPageCoverCropRenderStyle,
  bookingPageCoverDisplayAspect,
  bookingPageCoverPublicFrameClass,
  sanitizeBookingPageCoverCropBox,
} from '@/lib/booking/booking-page-cover';
import { sanitizeBookingPageLogoCrop } from '@/lib/booking/booking-page-logo';
import {
  mergeBookingPageConfigPatch,
  sanitizeBookingPageConfig,
} from '@/lib/booking/booking-page-theme';

describe('sanitizeBookingPageImageFraming', () => {
  it('returns null for defaults', () => {
    expect(sanitizeBookingPageImageFraming({})).toBeNull();
    expect(sanitizeBookingPageImageFraming(DEFAULT_BOOKING_PAGE_IMAGE_FRAMING)).toBeNull();
  });

  it('clamps zoom and position', () => {
    expect(sanitizeBookingPageImageFraming({ x: 120, y: -5, zoom: 4 })).toMatchObject({
      x: 100,
      y: 0,
      zoom: 3,
    });
  });
});

describe('bookingPageImagePanFromPointerDelta', () => {
  it('scales x and y by viewport dimensions', () => {
    const { dx, dy } = bookingPageImagePanFromPointerDelta(224, 128, 224, 128);
    expect(dx).toBe(100);
    expect(dy).toBe(100);
  });
});

describe('bookingPageImageFramingStyle', () => {
  it('applies translate and scale', () => {
    const style = bookingPageImageFramingStyle({ x: 60, y: 40, zoom: 1.5 });
    expect(style.transform).toBe('translate(10%, -10%) scale(1.5)');
  });
});

describe('resolveBookingPageImageFraming', () => {
  it('fills missing fields', () => {
    expect(resolveBookingPageImageFraming({ x: 10 })).toEqual({
      x: 10,
      y: 50,
      zoom: 1,
    });
  });
});

describe('logo crop sanitizer', () => {
  it('keeps a non-default zoom', () => {
    expect(sanitizeBookingPageLogoCrop({ zoom: 0.8 })).toMatchObject({ zoom: 0.8 });
  });
});

describe('sanitizeBookingPageCoverCropBox', () => {
  it('drops a full-frame crop (whole photo is the default)', () => {
    expect(sanitizeBookingPageCoverCropBox({ x: 0, y: 0, w: 1, h: 1, ar: 1.5 })).toBeNull();
  });

  it('keeps a real crop and clamps it inside the image', () => {
    expect(sanitizeBookingPageCoverCropBox({ x: 0.5, y: 0, w: 1, h: 1, ar: 1.5 })).toEqual({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 1,
      ar: 1.5,
    });
  });

  it('rejects malformed boxes', () => {
    expect(sanitizeBookingPageCoverCropBox({ x: 0, y: 0, w: 0.5, h: 0.5, ar: 0 })).toBeNull();
    expect(sanitizeBookingPageCoverCropBox({ x: 0, y: 0, w: 0, h: 0.5, ar: 2 })).toBeNull();
    expect(sanitizeBookingPageCoverCropBox(null)).toBeNull();
  });
});

describe('cover crop render geometry', () => {
  it('takes the crop region aspect ratio', () => {
    // a 0.5×1 slice of a 2:1 image is square
    expect(bookingPageCoverDisplayAspect({ x: 0.25, y: 0, w: 0.5, h: 1, ar: 2 })).toBe(1);
  });

  it('offsets and scales the image to reveal exactly the crop', () => {
    const { container, image } = bookingPageCoverCropRenderStyle({ x: 0.25, y: 0, w: 0.5, h: 1, ar: 2 });
    expect(container.aspectRatio).toBe('1');
    expect(image.width).toBe('200%');
    expect(image.left).toBe('-50%');
    expect(image.top).toBe('0%');
  });
});

describe('bookingPageCoverPublicFrameClass', () => {
  it('has no fixed height and rings only when contained', () => {
    const full = bookingPageCoverPublicFrameClass(true);
    expect(full).not.toMatch(/\bh-44\b/);
    expect(full).not.toContain('ring-1');
    expect(bookingPageCoverPublicFrameClass(false)).toContain('ring-1');
  });
});

describe('sanitizeBookingPageConfig cover_crop_box', () => {
  it('persists a real crop and drops a full-frame one', () => {
    expect(
      sanitizeBookingPageConfig({ cover_crop_box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, ar: 1.6 } }).cover_crop_box,
    ).toMatchObject({ x: 0.1, y: 0.1, w: 0.5, h: 0.5, ar: 1.6 });
    expect(
      sanitizeBookingPageConfig({ cover_crop_box: { x: 0, y: 0, w: 1, h: 1, ar: 1.6 } }).cover_crop_box,
    ).toBeUndefined();
  });

  it('clears the stored crop when the patch resets it', () => {
    const merged = mergeBookingPageConfigPatch(
      { cover_crop_box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, ar: 1.6 } },
      { cover_crop_box: null },
    );
    expect(merged.cover_crop_box).toBeUndefined();
  });
});
