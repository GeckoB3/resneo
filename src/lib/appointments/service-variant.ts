import type { AppointmentService, ServiceVariant } from '@/types/booking-models';

/**
 * Returns true when the service has at least one active variant; the booking flow
 * must collect a `variant_id` before computing slots, deposits, etc.
 */
export function serviceRequiresVariantChoice(
  service: Pick<AppointmentService, 'variants'>,
): boolean {
  const variants = service.variants ?? [];
  return variants.some((v) => v.is_active);
}

/**
 * Pick a variant from a service by id. Returns null when not found, inactive, or when
 * the service is not variant-bearing. Inactive variants are rejected so a guest cannot
 * book a hidden option by guessing its id.
 */
export function findActiveVariant(
  service: Pick<AppointmentService, 'variants'> | null | undefined,
  variantId: string | null | undefined,
): ServiceVariant | null {
  if (!service || !variantId) return null;
  const variants = service.variants ?? [];
  const found = variants.find((v) => v.id === variantId);
  if (!found || !found.is_active) return null;
  return found;
}

/**
 * Apply a chosen variant's overrides on top of an already-merged service (venue + practitioner
 * link). Variant duration / buffer / price always replace the parent's bookable values; deposit
 * uses the variant when set, otherwise falls back to the parent's deposit. Display name combines
 * parent and variant ("Colour - Full Head") so summaries and confirmations are unambiguous.
 *
 * `payment_requirement` is preserved from the parent so admin payment policy keeps applying.
 */
export function applyVariantToService(
  service: AppointmentService,
  variant: ServiceVariant,
): AppointmentService {
  return {
    ...service,
    name: `${service.name} - ${variant.name}`,
    duration_minutes: variant.duration_minutes,
    buffer_minutes: variant.buffer_minutes,
    price_pence: variant.price_pence,
    deposit_pence: variant.deposit_pence ?? service.deposit_pence ?? null,
  };
}

/**
 * Convenience: applies the variant when one is selected, otherwise returns the service unchanged.
 * Centralises the "have I picked a variant for this booking?" branch in one place.
 */
export function resolveBookableServiceWithVariant(
  service: AppointmentService,
  variant: ServiceVariant | null | undefined,
): AppointmentService {
  if (!variant) return service;
  return applyVariantToService(service, variant);
}

/**
 * Swap the chosen variant's overrides into the engine input's `services` array in place.
 * The appointment engine then computes slot duration / occupancy from the variant directly
 * without any further changes. Returns false when the parent service was not in the input
 * (caller should reject the booking — slot is no longer offered for this practitioner).
 */
export function applyVariantToAppointmentInput(params: {
  services: AppointmentService[];
  serviceId: string;
  variant: ServiceVariant;
}): boolean {
  const { services, serviceId, variant } = params;
  const idx = services.findIndex((s) => s.id === serviceId);
  if (idx < 0) return false;
  services[idx] = applyVariantToService(services[idx]!, variant);
  return true;
}
