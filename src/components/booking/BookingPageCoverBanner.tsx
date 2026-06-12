import type { BookingPageCoverCropBox } from '@/lib/booking/booking-page-cover';
import { bookingPageCoverPublicFrameClass } from '@/lib/booking/booking-page-cover';
import { BookingPageCoverPhoto } from '@/components/booking/BookingPageCoverPhoto';

interface BookingPageCoverBannerProps {
  coverUrl: string;
  /** Chosen crop region; absent shows the whole photo at its natural aspect ratio. */
  cropBox?: BookingPageCoverCropBox | null;
  /** When false, cover is constrained to the booking content column width. */
  fullWidth?: boolean;
}

/** Cover strip on the public booking page (natural height — whole photo or the chosen crop). */
export function BookingPageCoverBanner({
  coverUrl,
  cropBox,
  fullWidth = true,
}: BookingPageCoverBannerProps) {
  return (
    <div className={bookingPageCoverPublicFrameClass(fullWidth)}>
      <BookingPageCoverPhoto coverUrl={coverUrl} cropBox={cropBox} />
    </div>
  );
}
