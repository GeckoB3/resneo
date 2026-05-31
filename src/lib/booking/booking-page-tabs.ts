import type { BookingPageConfig, BookingTeamProfile } from '@/lib/booking/booking-page-theme';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import type { BookingModel } from '@/types/booking-models';

export type BookingPageTabId = 'book' | 'services' | 'team' | 'about';

export interface BookingPagePublicService {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price_pence: number | null;
  duration_minutes: number;
}

export interface BookingPageTeamMember {
  id: string;
  name: string;
  profile: BookingTeamProfile;
}

export function bookingPageShowsServicesTab(config: BookingPageConfig | null | undefined): boolean {
  return config?.show_services_tab === true;
}

export function bookingPageShowsTeamTab(config: BookingPageConfig | null | undefined): boolean {
  return config?.show_team_tab === true;
}

export function bookingPageShowsAboutTab(
  config: BookingPageConfig | null | undefined,
  bookingModel: BookingModel | string | null | undefined,
): boolean {
  if (!isUnifiedSchedulingVenue(bookingModel)) return false;
  return config?.show_about_tab === true;
}

export function resolveBookingPageTabs(
  config: BookingPageConfig | null | undefined,
  bookingModel: BookingModel | string | null | undefined,
): BookingPageTabId[] {
  const tabs: BookingPageTabId[] = ['book'];
  if (!isUnifiedSchedulingVenue(bookingModel)) return tabs;
  if (bookingPageShowsServicesTab(config)) tabs.push('services');
  if (bookingPageShowsTeamTab(config)) tabs.push('team');
  if (bookingPageShowsAboutTab(config, bookingModel)) tabs.push('about');
  return tabs;
}

export function bookingPageHasExtraTabs(
  config: BookingPageConfig | null | undefined,
  bookingModel: BookingModel | string | null | undefined,
): boolean {
  return resolveBookingPageTabs(config, bookingModel).length > 1;
}

/**
 * About-tab copy and media must not appear in the header when the About tab is off,
 * or when appointment venues use tabbed layout (content lives on the About tab only).
 */
export function bookingPageHideAboutTabContentFromHeader(
  config: BookingPageConfig | null | undefined,
  bookingModel: BookingModel | string | null | undefined,
): boolean {
  if (!isUnifiedSchedulingVenue(bookingModel)) return false;
  const showAboutTab = bookingPageShowsAboutTab(config, bookingModel);
  const hasExtraTabs = bookingPageHasExtraTabs(config, bookingModel);
  return !showAboutTab || hasExtraTabs;
}

/** Visible team members for the public Meet the team tab. */
export function resolveBookingPageTeamMembers(
  team: Array<{ id: string; name: string }>,
  teamProfiles: Record<string, BookingTeamProfile>,
): BookingPageTeamMember[] {
  return team
    .map((m) => ({ ...m, profile: teamProfiles[m.id] }))
    .filter(
      (m): m is BookingPageTeamMember =>
        Boolean(
          m.profile &&
            !m.profile.hidden &&
            (m.profile.photo?.trim() || m.profile.bio?.trim() || m.profile.specialties?.trim()),
        ),
    );
}

export function formatBookingPagePrice(pence: number | null, currency = 'GBP'): string | null {
  if (pence == null) return null;
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(pence / 100);
}

export function formatBookingPageDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return hours === 1 ? '1 hr' : `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}
