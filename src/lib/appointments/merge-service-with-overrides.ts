import type { AppointmentService, PractitionerService } from '@/types/booking-models';

/**
 * Effective service definition for a practitioner: venue defaults plus optional
 * practitioner_services overrides (price, duration, display name, etc.).
 */
export function mergeAppointmentServiceWithPractitionerLink(
  base: AppointmentService,
  link: PractitionerService | null | undefined,
): AppointmentService {
  if (!link) return base;
  return {
    ...base,
    name: link.custom_name ?? base.name,
    description: link.custom_description ?? base.description,
    duration_minutes: link.custom_duration_minutes ?? base.duration_minutes,
    buffer_minutes: link.custom_buffer_minutes ?? base.buffer_minutes ?? 0,
    processing_time_minutes: base.processing_time_minutes,
    processing_time_blocks: base.processing_time_blocks,
    price_pence: link.custom_price_pence ?? base.price_pence,
    deposit_pence: link.custom_deposit_pence ?? base.deposit_pence,
    colour: link.custom_colour ?? base.colour,
  };
}
