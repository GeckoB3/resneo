import type { BookingPageCoverCrop } from '@/lib/booking/booking-page-cover';
import {
  BOOKING_PAGE_COVER_CONTAINED_PUBLIC_FRAME_CLASS,
  BOOKING_PAGE_COVER_PUBLIC_FRAME_CLASS,
} from '@/lib/booking/booking-page-cover';
import { BookingPageCoverPhoto } from '@/components/booking/BookingPageCoverPhoto';

interface BookingPageCoverBannerProps {
  coverUrl: string;
  crop?: BookingPageCoverCrop | null;
  /** When false, cover is constrained to the booking content column width. */
  fullWidth?: boolean;
}

/** Cover strip on the public booking page (fixed height; full width or contained). */
export function BookingPageCoverBanner({
  coverUrl,
  crop,
  fullWidth = true,
}: BookingPageCoverBannerProps) {
  const frameClass = fullWidth
    ? BOOKING_PAGE_COVER_PUBLIC_FRAME_CLASS
    : BOOKING_PAGE_COVER_CONTAINED_PUBLIC_FRAME_CLASS;

  return (
    <div className={frameClass}>
      <BookingPageCoverPhoto coverUrl={coverUrl} crop={crop} className="h-full w-full" />
    </div>
  );
}
