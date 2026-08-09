'use client';

import { bookingPageImageFramingStyle } from '@/lib/booking/booking-page-image-framing';
import type { BookingTeamProfile } from '@/lib/booking/booking-page-theme';
import { APPOINTMENT_PUBLIC_CHEVRON_SM } from '@/components/booking/appointment-public-ui';

interface StaffChoiceCardProps {
  name: string;
  /** Their "Meet the team" profile, read only for the photo. */
  profile?: BookingTeamProfile;
  onClick: () => void;
  className: string;
}

/**
 * One person on the staff-first picker: the first choice a guest makes, before
 * any service is in play.
 *
 * Deliberately just a face and a name. Bios and specialties belong on the Meet
 * the team tab, where someone has gone looking for them; here they turn a quick
 * choice into a page of reading.
 *
 * A profile marked hidden is still bookable and still listed, but shows an
 * initial rather than their photo, since hiding is a "keep me off the public
 * page" setting.
 */
export function StaffChoiceCard({ name, profile, onClick, className }: StaffChoiceCardProps) {
  const photo = profile?.hidden === true ? '' : (profile?.photo?.trim() ?? '');

  return (
    <button type="button" onClick={onClick} className={className} aria-label={name}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {photo ? (
            <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
              <img
                src={photo}
                alt=""
                loading="lazy"
                className="h-full w-full"
                style={bookingPageImageFramingStyle(profile?.photo_crop)}
              />
            </div>
          ) : (
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-700">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 truncate font-medium text-slate-900">{name}</div>
        </div>
        <svg
          className={`${APPOINTMENT_PUBLIC_CHEVRON_SM} flex-shrink-0`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </button>
  );
}

/** Sized to a real card so the picker does not jump as the catalog lands. */
export function StaffChoiceCardSkeleton() {
  return <div className="h-[86px] animate-pulse rounded-xl bg-slate-100" />;
}
