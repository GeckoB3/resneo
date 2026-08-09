'use client';

import { bookingPageImageFramingStyle } from '@/lib/booking/booking-page-image-framing';
import type { BookingTeamProfile } from '@/lib/booking/booking-page-theme';
import { APPOINTMENT_PUBLIC_CHEVRON_SM } from '@/components/booking/appointment-public-ui';

/** Specialties beyond this many collapse into a "+N" chip so a card stays one glance. */
const MAX_SPECIALTY_CHIPS = 3;

function specialtyList(profile: BookingTeamProfile | undefined): string[] {
  return (profile?.specialties ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface StaffChoiceCardProps {
  name: string;
  /** Combined pages: which venue this person works at, shown under their name. */
  venueName?: string | null;
  /** Their "Meet the team" profile, when the venue has filled one in. */
  profile?: BookingTeamProfile;
  onClick: () => void;
  className: string;
}

/**
 * One person on the staff-first picker: the first choice a guest makes, before
 * any service is in play, so it carries who they are rather than what anything
 * costs.
 *
 * A profile marked hidden is still bookable and still listed, but shows only an
 * initial and a name. Hiding is a "keep me off the marketing page" setting, and
 * honouring it for the photo while still showing the bio would leak exactly what
 * the venue asked to withhold.
 */
export function StaffChoiceCard({
  name,
  venueName,
  profile,
  onClick,
  className,
}: StaffChoiceCardProps) {
  const marketingHidden = profile?.hidden === true;
  const photo = marketingHidden ? '' : (profile?.photo?.trim() ?? '');
  const bio = marketingHidden ? '' : (profile?.bio?.trim() ?? '');
  const specialties = marketingHidden ? [] : specialtyList(profile);
  const shownSpecialties = specialties.slice(0, MAX_SPECIALTY_CHIPS);
  const overflowCount = specialties.length - shownSpecialties.length;

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
          <div className="min-w-0">
            <div className="font-medium text-slate-900">{name}</div>
            {venueName?.trim() ? (
              <div className="truncate text-xs text-slate-500">{venueName.trim()}</div>
            ) : null}
            {shownSpecialties.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {shownSpecialties.map((s, i) => (
                  <span
                    key={`${s}-${i}`}
                    className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
                  >
                    {s}
                  </span>
                ))}
                {overflowCount > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    +{overflowCount}
                  </span>
                ) : null}
              </div>
            ) : null}
            {bio ? <p className="mt-1 truncate text-xs text-slate-500">{bio}</p> : null}
          </div>
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

/**
 * Sized to a real card so the picker does not jump as the catalog lands. Venues
 * that have filled in team profiles get slightly taller cards; this matches the
 * common case of a name and an initial.
 */
export function StaffChoiceCardSkeleton() {
  return <div className="h-[86px] animate-pulse rounded-xl bg-slate-100" />;
}
