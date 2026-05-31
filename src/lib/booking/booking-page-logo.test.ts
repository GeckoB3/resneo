import { describe, expect, it } from 'vitest';
import {
  bookingPageLogoImageStyle,
  bookingPageLogoPanFromPointerDelta,
  resolveBookingPageLogoCrop,
  sanitizeBookingPageLogoCrop,
} from '@/lib/booking/booking-page-logo';

describe('booking page logo framing', () => {
  it('sanitizes via shared framing rules', () => {
    expect(sanitizeBookingPageLogoCrop({ zoom: 0.4 })).toMatchObject({ zoom: 0.5 });
  });

  it('maps circular viewport drag', () => {
    const { dx } = bookingPageLogoPanFromPointerDelta(96, 0, 96);
    expect(dx).toBe(100);
  });

  it('applies image style', () => {
    const style = bookingPageLogoImageStyle({ x: 30, y: 70, zoom: 1.5 });
    expect(style.transform).toBe('translate(-20%, 20%) scale(1.5)');
  });

  it('resolves defaults', () => {
    expect(resolveBookingPageLogoCrop({ x: 10 }).x).toBe(10);
  });
});
