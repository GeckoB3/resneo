/**
 * Put the length a booking will actually occupy onto the engine input, before
 * the availability check runs.
 *
 * Two adjustments stack, and the order is load-bearing: applying a variant
 * REPLACES the service's duration, so folding add-on minutes in first and
 * applying the variant afterwards silently discards them. `booking/create`
 * records having been bitten by exactly that, in the comment above its
 * `reservedDurationMinutes`.
 *
 * The guest reschedule path in `api/confirm` applied both to the write and
 * neither to the check, so the engine was asked about the parent service's
 * duration and the row was written with the variant's: a 150-minute variant of
 * a 30-minute parent passed a check for 16:30-17:00 and was written ending at
 * 19:00, through the next client, through a break and past closing (SA-C2).
 */

import { applyVariantToService } from '@/lib/appointments/service-variant';
import type { AppointmentService, ServiceVariant } from '@/types/booking-models';

/**
 * Applies the chosen variant and any extra minutes to `services` in place, and
 * returns the resulting duration so the caller can write the same number it
 * reserved.
 *
 * Returns null when the service is not in the input, which is the caller's
 * signal that there is nothing to reserve.
 */
export function applyReservedDurationToInput(params: {
  /** The engine input's service list. Mutated in place, as the engine expects. */
  services: AppointmentService[];
  serviceId: string;
  /** The variant being kept or chosen, if any. Replaces the parent duration. */
  variant?: ServiceVariant | null;
  /** Add-on minutes, which extend whatever duration applies after the variant. */
  extraMinutes?: number;
}): number | null {
  const { services, serviceId, variant, extraMinutes } = params;

  const idx = services.findIndex((s) => s.id === serviceId);
  if (idx < 0) return null;

  if (variant) {
    services[idx] = applyVariantToService(services[idx]!, variant);
  }

  const extra = Math.max(0, Math.round(extraMinutes ?? 0));
  if (extra > 0) {
    services[idx] = {
      ...services[idx]!,
      duration_minutes: services[idx]!.duration_minutes + extra,
    };
  }

  return services[idx]!.duration_minutes;
}
