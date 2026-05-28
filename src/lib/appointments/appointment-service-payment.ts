import type { AppointmentService } from '@/types/booking-models';
import type { ClassPaymentRequirement } from '@/types/booking-models';

/** Fields sufficient to compute online charge (e.g. catalog offer or merged service). */
export type AppointmentServicePaymentFields = Pick<
  AppointmentService,
  'payment_requirement' | 'deposit_pence' | 'price_pence'
>;

/**
 * Effective payment mode for a service row (handles pre-migration rows that only had deposit_pence).
 */
export function resolveAppointmentPaymentRequirement(
  svc: Pick<AppointmentService, 'payment_requirement' | 'deposit_pence'>,
): ClassPaymentRequirement {
  const raw = svc.payment_requirement;
  if (raw === 'deposit' || raw === 'full_payment' || raw === 'none') return raw;
  if (svc.deposit_pence != null && svc.deposit_pence > 0) return 'deposit';
  return 'none';
}

export type AppointmentOnlineCharge =
  | { amountPence: number; chargeLabel: 'deposit' | 'full_payment' }
  | null;

/**
 * Amount to collect online at booking for this service (after venue + practitioner merge).
 */
export function resolveAppointmentServiceOnlineCharge(svc: AppointmentServicePaymentFields): AppointmentOnlineCharge {
  const req = resolveAppointmentPaymentRequirement(svc);
  const price = svc.price_pence ?? 0;
  const dep = svc.deposit_pence ?? 0;
  if (req === 'none') return null;
  if (req === 'full_payment') {
    if (price <= 0) return null;
    return { amountPence: price, chargeLabel: 'full_payment' };
  }
  if (dep <= 0) return null;
  return { amountPence: dep, chargeLabel: 'deposit' };
}

/**
 * Compute the online charge when add-ons are part of the booking.
 *
 * Policy (matches Fresha): add-on prices roll into a `full_payment` charge, but
 * the deposit stays at the service+variant deposit — add-ons are paid at the
 * venue. Pass `svc` as the **base + variant** service (no addon price folded in);
 * pass the explicit `addons_total_price_pence`.
 */
export function resolveAppointmentServiceOnlineChargeWithAddons(params: {
  svc: AppointmentServicePaymentFields;
  addons_total_price_pence: number;
}): AppointmentOnlineCharge {
  const { svc, addons_total_price_pence } = params;
  const req = resolveAppointmentPaymentRequirement(svc);
  if (req === 'none') return null;
  if (req === 'full_payment') {
    const total = (svc.price_pence ?? 0) + Math.max(0, addons_total_price_pence);
    if (total <= 0) return null;
    return { amountPence: total, chargeLabel: 'full_payment' };
  }
  // Deposit: stays on the base+variant deposit; add-ons are not deposit-eligible.
  const dep = svc.deposit_pence ?? 0;
  if (dep <= 0) return null;
  return { amountPence: dep, chargeLabel: 'deposit' };
}
