import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { DEFAULT_TERMINOLOGY } from '@/types/booking-models';

const TABLE_WORDS = DEFAULT_TERMINOLOGY.table_reservation;

/**
 * A venue's terminology is written once, at signup, from the business type it
 * picked. Nothing rewrites it if the venue later moves to a different booking
 * model, so one that started as a restaurant and now takes appointments still
 * carries "Reservation" and "Guest" and greets its clients with "Reservation
 * confirmed".
 *
 * A stored word that is simply the table-booking default is drift of that kind
 * rather than a choice anyone made, so on any other model the model's own
 * default wins. Words a venue genuinely picked, including ones that happen to
 * match another model's default like "Booking", are left alone.
 */
function resolveWord<TBase extends string | undefined>(
  model: BookingModel,
  key: keyof VenueTerminology,
  stored: string | undefined,
  base: TBase,
): string | TBase {
  if (typeof stored !== 'string' || stored.trim() === '') return base;
  const isStaleTableWord = model !== 'table_reservation' && stored === TABLE_WORDS[key];
  return isStaleTableWord ? base : stored;
}

/** Merge venue terminology overrides with model defaults (safe for server and client). */
export function mergeVenueTerminology(
  model: BookingModel,
  raw: unknown,
): VenueTerminology {
  const base = DEFAULT_TERMINOLOGY[model];
  if (!raw || typeof raw !== 'object') return base;
  const t = raw as Partial<VenueTerminology>;
  return {
    client: resolveWord(model, 'client', t.client, base.client),
    booking: resolveWord(model, 'booking', t.booking, base.booking),
    staff: resolveWord(model, 'staff', t.staff, base.staff),
    area: resolveWord(model, 'area', t.area, base.area),
  };
}
