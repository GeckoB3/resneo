import type { BookingPageCoverCrop } from '@/lib/booking/booking-page-cover';
import { bookingPageCoverImageStyle } from '@/lib/booking/booking-page-cover';

interface BookingPageCoverPhotoProps {
  coverUrl: string;
  alt?: string;
  crop?: BookingPageCoverCrop | null;
  className?: string;
}

/** Cover banner image with optional pan/zoom framing. */
export function BookingPageCoverPhoto({
  coverUrl,
  alt = '',
  crop,
  className = 'h-full w-full',
}: BookingPageCoverPhotoProps) {
  const imageStyle = bookingPageCoverImageStyle(crop);

  return (
    <img
      src={coverUrl}
      alt={alt}
      className={`pointer-events-none select-none ${className}`}
      style={imageStyle}
      draggable={false}
    />
  );
}
