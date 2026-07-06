import type { AppointmentService, BookingModel } from '@/types/booking-models';
import type { ClassPaymentRequirement } from '@/types/booking-models';

/** Fields sufficient to compute online charge (e.g. catalog offer or merged service). */
export type AppointmentServicePaymentFields = Pick<
  AppointmentService,
  'payment_requirement' | 'deposit_pence' | 'price_pence'
>;

/**
 * Effective payment mode for a service row (handles pre-migration rows that only had deposit_pence).
 *
 * `'card_hold'` is honoured only when set explicitly (design doc §6.3): the legacy
 * `deposit_pence > 0` inference below always yields `'deposit'`, so a pre-migration row can
 * never resolve to a card hold the venue did not configure.
 */
export function resolveAppointmentPaymentRequirement(
  svc: Pick<AppointmentService, 'payment_requirement' | 'deposit_pence'>,
): ClassPaymentRequirement {
  const raw = svc.payment_requirement;
  if (raw === 'deposit' || raw === 'full_payment' || raw === 'none' || raw === 'card_hold') return raw;
  if (svc.deposit_pence != null && svc.deposit_pence > 0) return 'deposit';
  return 'none';
}

export type AppointmentOnlineCharge =
  | { amountPence: number; chargeLabel: 'deposit' | 'full_payment' | 'card_hold' }
  | null;

/**
 * Models card holds can be configured on in v1 (design doc §6.4). All current booking models
 * are supported; this guard exists so a future model added to `BookingModel` fails loudly at
 * card-hold resolution time instead of silently mis-charging.
 */
const CARD_HOLD_SUPPORTED_MODELS: ReadonlySet<BookingModel> = new Set<BookingModel>([
  'table_reservation',
  'practitioner_appointment',
  'unified_scheduling',
  'event_ticket',
  'class_session',
  'resource_booking',
]);

/** Throws when card-hold configuration resolution is not supported for the model (design doc §6.4). */
export function assertCardHoldSupportedForModel(model: BookingModel): void {
  if (!CARD_HOLD_SUPPORTED_MODELS.has(model)) {
    throw new Error(`Card holds are not supported for booking model "${model}" in v1`);
  }
}

/**
 * Card-hold fee resolution shared by both charge resolvers. The fee is the (variant-adjusted)
 * `deposit_pence` on the merged service; add-ons are never included (same rule as deposits).
 * Zero-fee safety (design doc §6.3): a resolved fee <= 0 degrades to `'none'` with a warning,
 * because inserting a hold with fee 0 would violate the hold table CHECK at booking time.
 */
function resolveCardHoldCharge(svc: AppointmentServicePaymentFields): AppointmentOnlineCharge {
  const fee = svc.deposit_pence ?? 0;
  if (fee <= 0) {
    console.warn(
      '[appointment-service-payment] card_hold configured with fee <= 0; treating as none',
    );
    return null;
  }
  return { amountPence: fee, chargeLabel: 'card_hold' };
}

/**
 * Amount to collect online at booking for this service (after venue + practitioner merge).
 *
 * `chargeLabel: 'card_hold'` means no money is due at booking: `amountPence` is the no-show
 * fee to authorise for a later off-session charge. Callers must branch on the label. This
 * resolver is deliberately flag-independent; the `card_hold_deposits` gate lives at the write
 * paths (config acceptance) and the booking create routes.
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
  if (req === 'card_hold') return resolveCardHoldCharge(svc);
  if (dep <= 0) return null;
  return { amountPence: dep, chargeLabel: 'deposit' };
}

/**
 * Compute the online charge when add-ons are part of the booking.
 *
 * Policy (matches Fresha): add-on prices roll into a `full_payment` charge, but
 * the deposit stays at the service+variant deposit — add-ons are paid at the
 * venue. Card-hold fees follow the deposit rule: add-ons are never included.
 * Pass `svc` as the **base + variant** service (no addon price folded in);
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
  // Card hold: fee stays on the base+variant deposit_pence; add-ons never included.
  if (req === 'card_hold') return resolveCardHoldCharge(svc);
  // Deposit: stays on the base+variant deposit; add-ons are not deposit-eligible.
  const dep = svc.deposit_pence ?? 0;
  if (dep <= 0) return null;
  return { amountPence: dep, chargeLabel: 'deposit' };
}
