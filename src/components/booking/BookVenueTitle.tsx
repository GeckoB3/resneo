'use client';

import { useCallback, type MouseEvent } from 'react';
import { APPOINTMENT_BOOKING_RESET_EVENT } from './appointment-booking-events';

interface BookVenueTitleProps {
  name: string;
  /** When true, the title restarts the appointment booking flow (Model B). */
  isAppointment: boolean;
  className?: string;
  /** 'light' = white text on dark hero (default); 'dark' = dark text on white bg. */
  variant?: 'light' | 'dark';
}

function scrollToBookingFormStart() {
  document.getElementById('booking-form-start')?.scrollIntoView({ behavior: 'smooth' });
}

const titleControlClassName =
  'block w-full max-w-full cursor-pointer text-left no-underline ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

const titleVariants = {
  light:
    'text-white/70 hover:text-white transition-colors focus-visible:ring-white/70 focus-visible:ring-offset-slate-900',
  dark:
    'text-slate-900 hover:text-slate-700 transition-colors focus-visible:ring-brand-500 focus-visible:ring-offset-white',
};

/**
 * Public book page venue name. Links to the start of the booking form; for appointment businesses, also restarts the flow.
 */
export function BookVenueTitle({ name, isAppointment, className, variant = 'light' }: BookVenueTitleProps) {
  const defaultHeading =
    variant === 'dark'
      ? 'tracking-tight text-slate-900 text-2xl font-bold sm:text-3xl'
      : 'text-2xl font-bold sm:text-3xl';
  const headingClass = className ? `${defaultHeading} ${className}` : defaultHeading;

  const onTitleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (isAppointment) {
        window.dispatchEvent(new CustomEvent(APPOINTMENT_BOOKING_RESET_EVENT));
      }
      scrollToBookingFormStart();
    },
    [isAppointment],
  );

  return (
    <h1 className={headingClass}>
      <a
        href="#booking-form-start"
        onClick={onTitleClick}
        className={`${titleControlClassName} ${titleVariants[variant]}`}
        title={isAppointment ? 'Start booking again' : 'Back to booking form'}
      >
        <span className="block min-w-0 break-words">{name}</span>
      </a>
    </h1>
  );
}
