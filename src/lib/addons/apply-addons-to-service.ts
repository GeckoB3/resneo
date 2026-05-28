import type { Addon, AppointmentService } from '@/types/booking-models';

/**
 * Add-on selections sit on top of the merged variant/practitioner service. They never
 * replace anything — they extend `duration_minutes` and `price_pence`. `buffer_minutes`
 * is intentionally left alone (buffer is taken from the base service).
 *
 * `deposit_pence` is also unchanged here: deposit policy stays on base + variant.
 * For `payment_requirement='full_payment'`, the booking-create path computes the
 * online charge from the merged service via `resolveAppointmentServiceOnlineCharge`,
 * which uses the price after add-ons have been folded in.
 */
export interface ResolvedServiceWithAddons {
  service: AppointmentService;
  selected_addons: Addon[];
  total_addon_price_pence: number;
  total_addon_duration_minutes: number;
}

export function applyAddonsToResolvedService(
  resolved: AppointmentService,
  selected: Addon[],
): ResolvedServiceWithAddons {
  if (selected.length === 0) {
    return {
      service: resolved,
      selected_addons: [],
      total_addon_price_pence: 0,
      total_addon_duration_minutes: 0,
    };
  }

  let addPrice = 0;
  let addDuration = 0;
  for (const a of selected) {
    addPrice += a.additional_price_pence;
    addDuration += a.additional_duration_minutes;
  }

  const service: AppointmentService = {
    ...resolved,
    duration_minutes: resolved.duration_minutes + addDuration,
    price_pence:
      resolved.price_pence == null && addPrice === 0
        ? resolved.price_pence
        : (resolved.price_pence ?? 0) + addPrice,
  };

  return {
    service,
    selected_addons: selected,
    total_addon_price_pence: addPrice,
    total_addon_duration_minutes: addDuration,
  };
}
