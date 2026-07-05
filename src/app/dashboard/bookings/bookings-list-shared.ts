/**
 * Shared, pure helpers for the two bookings dashboards
 * ({@link BookingsDashboard} / {@link AppointmentBookingsDashboard}).
 *
 * These dashboards intentionally remain two separate components (a full merge is
 * risky — see review §5.5 / T6), but the small CDE-related derivations below were
 * duplicated and had already drifted. Centralising them removes the divergence and
 * gives a single home for the CDE list rules (type-pill colour, deposit-badge colour,
 * the "keep historical rows" predicate, and the calendar deep-link contract).
 */
import type { PillVariant } from '@/components/ui/dashboard/Pill';
import type { BookingModel } from '@/types/booking-models';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';

/** Class / event / resource — the "CDE" trio that is venue-wide rather than tied to one calendar. */
export const CDE_MODELS: ReadonlySet<BookingModel> = new Set<BookingModel>([
  'event_ticket',
  'class_session',
  'resource_booking',
]);

export function isCdeModel(model: BookingModel): boolean {
  return CDE_MODELS.has(model);
}

/** Pill colour for the booking "type" chip (Appointment / Event / Class / Resource / Table). */
export function bookingTypePillVariant(model: BookingModel): PillVariant {
  switch (model) {
    case 'unified_scheduling':
    case 'practitioner_appointment':
      return 'brand';
    case 'event_ticket':
      return 'info';
    case 'class_session':
      return 'success';
    case 'resource_booking':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Pill colour for the deposit / payment-status chip on a booking row. */
export function depositPillVariant(status: string): PillVariant {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'captured') return 'success';
  if (s === 'pending' || s === 'requires_action') return 'warning';
  if (s === 'refunded' || s === 'cancelled' || s === 'failed') return 'danger';
  if (s === 'card held') return 'info';
  if (s === 'charged') return 'warning';
  return 'neutral';
}

/** Minimal row shape needed to infer a booking's model. */
export type BookingModelRowFields = Parameters<typeof inferBookingRowModel>[0];

/**
 * Whether a fetched booking row should appear in the dashboard list.
 *
 * Rows for the venue's primary or an enabled secondary model always show. A
 * **CDE** row whose model is no longer enabled is still shown (it gets a type
 * pill so it reads correctly) — disabling a model must not hide a guest's real,
 * historical event/class/resource booking from staff (review §5.5 F18). Only
 * non-CDE rows (e.g. a leftover appointment for a model the venue turned off)
 * are filtered out.
 */
export function shouldShowBookingRowInList(
  row: BookingModelRowFields,
  primary: BookingModel,
  enabledModels: BookingModel[],
): boolean {
  const model = inferBookingRowModel(row);
  if (venueExposesBookingModel(primary, enabledModels, model)) return true;
  return isCdeModel(model);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A CDE session/entity deep-link target read from the dashboard URL. */
export interface CdeDeepLinkFilter {
  param: 'experience_event_id' | 'class_instance_id' | 'resource_id';
  id: string;
}

/**
 * Reads a CDE deep-link from the dashboard query string. The calendar detail
 * sheets link to `/dashboard/bookings?experience_event_id=…` (and ideally the
 * class/resource equivalents) so staff can jump from a calendar block to that
 * entity's bookings. Returns the first recognised, well-formed param, or `null`.
 *
 * @param get reader over the current search params (e.g. `URLSearchParams.get`).
 */
export function readCdeDeepLinkFilter(get: (key: string) => string | null): CdeDeepLinkFilter | null {
  const candidates: CdeDeepLinkFilter['param'][] = [
    'experience_event_id',
    'class_instance_id',
    'resource_id',
  ];
  for (const param of candidates) {
    const raw = get(param);
    if (raw && UUID_RE.test(raw)) return { param, id: raw };
  }
  return null;
}

/** Human label for the CDE deep-link banner ("event" / "class" / "resource"). */
export function cdeDeepLinkEntityLabel(param: CdeDeepLinkFilter['param']): string {
  switch (param) {
    case 'experience_event_id':
      return 'event';
    case 'class_instance_id':
      return 'class';
    case 'resource_id':
      return 'resource';
    default:
      return 'session';
  }
}
