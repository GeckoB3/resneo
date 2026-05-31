'use client';

import type { BookingPageLogoCrop } from '@/lib/booking/booking-page-logo';
import { BookingPageImageFramingControls } from './BookingPageImageFramingControls';

interface BookingPageLogoFramingControlsProps {
  crop: BookingPageLogoCrop;
  disabled?: boolean;
  onChange: (crop: BookingPageLogoCrop) => void;
}

export function BookingPageLogoFramingControls(props: BookingPageLogoFramingControlsProps) {
  return <BookingPageImageFramingControls {...props} controlId="logo" />;
}
