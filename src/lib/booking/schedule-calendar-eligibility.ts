import type { BookingModel } from '@/types/booking-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';

/** Models that contribute to the staff Schedule calendar (excludes Model A table rows). */
const SCHEDULE_CALENDAR_MODELS: BookingModel[] = ['unified_scheduling', 'event_ticket', 'class_session', 'resource_booking'];

/**
 * Whether `/dashboard/calendar` should be available - Docs/Resneo_Unified_Booking_Functionality.md §4.2 entry rule.
 * Table-only venues (no C/D/E primary or secondary) use day sheet / table tools instead.
 */
export function isVenueScheduleCalendarEligible(
  bookingModel: BookingModel,
  enabledModels: BookingModel[],
): boolean {
  if (isUnifiedSchedulingVenue(bookingModel)) return true;
  if (SCHEDULE_CALENDAR_MODELS.includes(bookingModel)) return true;
  return enabledModels.some((m) => SCHEDULE_CALENDAR_MODELS.includes(m));
}

/**
 * Venues that use the calendar availability UI at `/dashboard/calendar-availability`
 * (team hours, calendars, booking rules for schedule-backed models).
 * Same scope as {@link isVenueScheduleCalendarEligible}: unified/practitioner primary, or any
 * schedule model (unified, events, classes, resources) as primary or enabled secondary — including
 * restaurants with table primary plus one or more of those models.
 */
export function shouldShowAppointmentAvailabilitySettings(
  bookingModel: BookingModel,
  enabledModels: BookingModel[],
): boolean {
  return isVenueScheduleCalendarEligible(bookingModel, enabledModels);
}

/**
 * Full appointments calendar grid (`PractitionerCalendarView`) for every venue that is schedule-calendar eligible.
 * Event-only, resource-only, class, and unified combinations all use the same column-based calendar; table-only
 * venues stay ineligible (see {@link isVenueScheduleCalendarEligible}).
 */
export function isPractitionerScheduleCalendar(
  bookingModel: BookingModel,
  enabledModels: BookingModel[],
): boolean {
  return isVenueScheduleCalendarEligible(bookingModel, enabledModels);
}
