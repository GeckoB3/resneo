import type { BookingPageCoverCropBox } from '@/lib/booking/booking-page-cover';
import { bookingPageCoverCropRenderStyle } from '@/lib/booking/booking-page-cover';

interface BookingPageCoverPhotoProps {
  coverUrl: string;
  alt?: string;
  /** The chosen crop region; when absent the whole photo shows at its natural aspect ratio. */
  cropBox?: BookingPageCoverCropBox | null;
}

/**
 * Cover image. With no crop, the whole uploaded photo renders at its natural aspect ratio
 * (never cropped). With a crop box, only the selected region is shown — the box takes the
 * crop's aspect ratio and the image is offset to reveal exactly that rectangle.
 */
export function BookingPageCoverPhoto({ coverUrl, alt = '', cropBox }: BookingPageCoverPhotoProps) {
  if (!cropBox) {
    return (
      <img
        src={coverUrl}
        alt={alt}
        className="pointer-events-none block h-auto w-full select-none"
        draggable={false}
      />
    );
  }

  const { container, image } = bookingPageCoverCropRenderStyle(cropBox);
  return (
    <div style={container}>
      <img
        src={coverUrl}
        alt={alt}
        className="pointer-events-none select-none"
        style={image}
        draggable={false}
      />
    </div>
  );
}
