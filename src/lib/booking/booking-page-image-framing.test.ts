import { describe, expect, it } from 'vitest';
import {
  bookingPageImageFramingStyle,
  bookingPageImagePanFromPointerDelta,
  DEFAULT_BOOKING_PAGE_IMAGE_FRAMING,
  resolveBookingPageImageFraming,
  sanitizeBookingPageImageFraming,
} from '@/lib/booking/booking-page-image-framing';
import {
  bookingPageCoverSettingsPreviewSize,
  BOOKING_PAGE_COVER_PUBLIC_HEIGHT_PX,
  BOOKING_PAGE_COVER_REFERENCE_WIDTH_PX,
  BOOKING_PAGE_COVER_SETTINGS_WIDTH_PX,
  sanitizeBookingPageCoverCrop,
} from '@/lib/booking/booking-page-cover';
import { sanitizeBookingPageLogoCrop } from '@/lib/booking/booking-page-logo';
import { sanitizeBookingPageConfig } from '@/lib/booking/booking-page-theme';

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

describe('bookingPageCoverSettingsPreviewSize', () => {
  it('matches the public full-width banner aspect at the reference width', () => {
    const { width, height } = bookingPageCoverSettingsPreviewSize();
    expect(width).toBe(BOOKING_PAGE_COVER_SETTINGS_WIDTH_PX);
    expect(height).toBe(
      Math.round((width * BOOKING_PAGE_COVER_PUBLIC_HEIGHT_PX) / BOOKING_PAGE_COVER_REFERENCE_WIDTH_PX),
    );
  });
});

describe('logo and cover crop sanitizers', () => {
  it('share behaviour', () => {
    expect(sanitizeBookingPageLogoCrop({ zoom: 0.8 })).toMatchObject({ zoom: 0.8 });
    expect(sanitizeBookingPageCoverCrop({ zoom: 0.8 })).toMatchObject({ zoom: 0.8 });
  });
});

describe('sanitizeBookingPageConfig cover_crop', () => {
  it('persists cover_crop when set', () => {
    const out = sanitizeBookingPageConfig({
      cover_crop: { x: 20, y: 80, zoom: 1.2 },
    });
    expect(out.cover_crop).toMatchObject({ x: 20, y: 80, zoom: 1.2 });
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
