import type { BookingModel } from '@/types/booking-models';
import {
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';

/** Human-facing labels for booking models on the platform subscriber report. */
export const SUBSCRIBER_MODEL_LABELS: Record<string, string> = {
  table_reservation: 'Tables',
  practitioner_appointment: 'Appointments',
  unified_scheduling: 'Appointments',
  class_session: 'Classes',
  event_ticket: 'Events',
  resource_booking: 'Resources',
};

export function labelForBookingModelKey(model: string): string {
  return SUBSCRIBER_MODEL_LABELS[model] ?? model.replace(/_/g, ' ');
}

export function resolveVenueEnabledModelLabels(input: {
  pricing_tier: string | null;
  booking_model: string | null;
  enabled_models: unknown;
  active_booking_models: unknown;
}): string[] {
  const active = resolveActiveBookingModels({
    pricingTier: input.pricing_tier,
    bookingModel: (input.booking_model as BookingModel | null) ?? undefined,
    enabledModels: input.enabled_models,
    activeBookingModels: input.active_booking_models,
  });
  const primary = getDefaultBookingModelFromActive(
    active,
    (input.booking_model as BookingModel) ?? 'table_reservation',
  );
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const m of active.length > 0 ? active : [primary]) {
    const label = labelForBookingModelKey(m);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export function formatPeriodByModelSummary(periodByModel: Record<string, number> | null | undefined): string {
  if (!periodByModel || Object.keys(periodByModel).length === 0) return '—';
  const parts = Object.entries(periodByModel)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${labelForBookingModelKey(k)}: ${n}`);
  return parts.join(' · ');
}
