import type { BookingPageLogoCrop } from '@/lib/booking/booking-page-logo';
import { bookingPageLogoImageStyle } from '@/lib/booking/booking-page-logo';

const SIZE_CLASS = {
  sm: 'h-16 w-16 sm:h-20 sm:w-20',
  md: 'h-24 w-24',
  lg: 'h-32 w-32',
} as const;

interface BookingPageLogoProps {
  logoUrl: string;
  alt?: string;
  crop?: BookingPageLogoCrop | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
  ringClassName?: string;
}

/** Venue logo badge — matches the circular frame on the public booking page. */
export function BookingPageLogo({
  logoUrl,
  alt = '',
  crop,
  size = 'sm',
  className = '',
  ringClassName = 'ring-1 ring-slate-200 shadow-[0_2px_10px_rgba(15,23,42,0.08)]',
}: BookingPageLogoProps) {
  const imageStyle = bookingPageLogoImageStyle(crop);

  return (
    <div
      className={`${SIZE_CLASS[size]} shrink-0 rounded-full bg-white p-1 ${ringClassName} ${className}`}
    >
      <div className="h-full w-full overflow-hidden rounded-full bg-white">
        <img
          src={logoUrl}
          alt={alt}
          className="pointer-events-none h-full w-full select-none"
          style={imageStyle}
          draggable={false}
        />
      </div>
    </div>
  );
}
