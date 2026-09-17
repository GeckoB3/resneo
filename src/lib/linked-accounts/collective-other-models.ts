/**
 * What else a venue runs besides appointments (plan §6.14, D44; UX spec `bm.join.otherModels`,
 * `bm.redirect.otherModels`, `bm.members.alsoRuns`; W20).
 *
 * A collective page carries appointments only, so a member's classes, events and bookable rooms
 * stay on its own booking page. The member is told before it accepts, and the host sees the line
 * against the member, so neither assumes the page carries them.
 */
import { resolveActiveBookingModels } from '@/lib/booking/active-models';
import type { BookingModel } from '@/types/booking-models';
import { formatVenueList } from '@/lib/linked-accounts/collective-copy';

const MODEL_WORDS: ReadonlyArray<[BookingModel, string]> = [
  ['class_session', 'classes'],
  ['event_ticket', 'events'],
  ['resource_booking', 'bookable rooms'],
];

/** The venue columns this reads. */
export const OTHER_MODEL_COLUMNS = 'pricing_tier, booking_model, enabled_models, active_booking_models';

export interface VenueModelColumns {
  pricing_tier?: unknown;
  booking_model?: unknown;
  enabled_models?: unknown;
  active_booking_models?: unknown;
}

/** The venue's other active models, in words, in a fixed order. */
export function otherBookingModelWords(venue: VenueModelColumns | null | undefined): string[] {
  if (!venue) return [];
  const models = resolveActiveBookingModels({
    pricingTier: (venue.pricing_tier as string | null | undefined) ?? null,
    bookingModel: (venue.booking_model as string | null | undefined) ?? null,
    enabledModels: venue.enabled_models,
    activeBookingModels: venue.active_booking_models,
  });
  return MODEL_WORDS.filter(([model]) => models.includes(model)).map(([, words]) => words);
}

/** "classes and events", or null when the venue runs appointments alone. */
export function otherBookingModelList(venue: VenueModelColumns | null | undefined): string | null {
  const words = otherBookingModelWords(venue);
  return words.length > 0 ? formatVenueList(words, 3) : null;
}
