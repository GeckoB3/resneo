import type { AppointmentService, PractitionerService } from '@/types/booking-models';
import { fitProcessingBlocksToDuration } from '@/lib/appointments/processing-time';

/**
 * Effective service definition for a practitioner: venue defaults plus optional
 * practitioner_services overrides (price, duration, display name, etc.).
 */
export function mergeAppointmentServiceWithPractitionerLink(
  base: AppointmentService,
  link: PractitionerService | null | undefined,
): AppointmentService {
  if (!link) return base;
  const duration = link.custom_duration_minutes ?? base.duration_minutes;
  return {
    ...base,
    name: link.custom_name ?? base.name,
    description: link.custom_description ?? base.description,
    duration_minutes: duration,
    buffer_minutes: link.custom_buffer_minutes ?? base.buffer_minutes ?? 0,
    processing_time_minutes: base.processing_time_minutes,
    // The pattern was drawn against the venue's length; a custom length moves
    // any wait after the service along with its end.
    processing_time_blocks:
      duration === base.duration_minutes
        ? base.processing_time_blocks
        : fitProcessingBlocksToDuration(base.processing_time_blocks ?? [], {
            fromDurationMinutes: base.duration_minutes,
            toDurationMinutes: duration,
          }).blocks,
    price_pence: link.custom_price_pence ?? base.price_pence,
    deposit_pence: link.custom_deposit_pence ?? base.deposit_pence,
    colour: link.custom_colour ?? base.colour,
  };
}
