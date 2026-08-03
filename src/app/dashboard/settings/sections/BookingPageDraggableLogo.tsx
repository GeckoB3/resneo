'use client';

import { BookingPageLogo } from '@/components/booking/BookingPageLogo';
import { BookingPageDraggableImage } from './BookingPageDraggableImage';
import {
  BOOKING_PAGE_LOGO_SIZE_PX,
  type BookingPageLogoCrop,
} from '@/lib/booking/booking-page-logo';

interface BookingPageDraggableLogoProps {
  logoUrl: string;
  crop: BookingPageLogoCrop;
  disabled?: boolean;
  onCropChange: (crop: BookingPageLogoCrop) => void;
}

/** Settings-row logo with drag-to-reposition (same circle as on the booking page). */
export function BookingPageDraggableLogo({
  logoUrl,
  crop,
  disabled = false,
  onCropChange,
}: BookingPageDraggableLogoProps) {
  return (
    <BookingPageDraggableImage
      imageUrl={logoUrl}
      crop={crop}
      onCropChange={onCropChange}
      sizePx={BOOKING_PAGE_LOGO_SIZE_PX.md}
      shape="circle"
      disabled={disabled}
      label="Reposition the logo"
    >
      <BookingPageLogo logoUrl={logoUrl} alt="Logo" crop={crop} size="md" />
    </BookingPageDraggableImage>
  );
}
