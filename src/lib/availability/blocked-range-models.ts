/**
 * Which model-owned windows may block appointment availability.
 *
 * Resource windows, scheduled classes and scheduled events are all folded into the
 * engine's `practitionerBlockedRanges`. They used to be folded in unconditionally, so
 * switching a booking model off stopped the calendar DRAWING it but never stopped it
 * BLOCKING: staff met an invisible wall the engine reported only as "Blocked time".
 * A model that is off has to be inert on both counts.
 *
 * Manual blocks (`calendar_blocks`, `practitioner_calendar_blocks`) and staff leave are
 * deliberately absent here. They belong to no booking model and keep blocking regardless.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveActiveBookingModels, venueSupportsBookingModel } from '@/lib/booking/active-models';
import type { BookingModel } from '@/types/booking-models';

export interface ModelOwnedBlockSources {
  /** Bookable resources occupying their host calendar (`resource_booking`). */
  resources: boolean;
  /** Scheduled class sessions on this column (`class_session`). */
  classes: boolean;
  /** Scheduled experience events on this column (`event_ticket`). */
  events: boolean;
}

/**
 * Every source blocking, which is what the engine did before models were consulted.
 *
 * This is the fallback whenever the venue's models cannot be read. Failing this way
 * refuses a booking that should have been allowed, which is visible and recoverable;
 * failing the other way accepts a booking onto occupied time, which is neither.
 */
export const ALL_MODEL_OWNED_BLOCK_SOURCES: ModelOwnedBlockSources = {
  resources: true,
  classes: true,
  events: true,
};

/**
 * Every `venues` column `resolveActiveBookingModels` reads, as one string so no engine
 * can resolve models from a partial row and silently get a different answer.
 */
export const VENUE_BOOKING_MODEL_COLUMNS =
  'pricing_tier, booking_model, enabled_models, active_booking_models';

export function modelOwnedBlockSources(activeModels: BookingModel[]): ModelOwnedBlockSources {
  return {
    resources: venueSupportsBookingModel(activeModels, 'resource_booking'),
    classes: venueSupportsBookingModel(activeModels, 'class_session'),
    events: venueSupportsBookingModel(activeModels, 'event_ticket'),
  };
}

/**
 * Resolve from a `venues` row selected with `VENUE_BOOKING_MODEL_COLUMNS`.
 * A null row means the read failed, so every source stays on (see the constant above).
 */
export function blockSourcesFromVenueRow(row: unknown): ModelOwnedBlockSources {
  if (row === null || row === undefined) return { ...ALL_MODEL_OWNED_BLOCK_SOURCES };
  const venue = row as {
    pricing_tier?: string | null;
    booking_model?: string | null;
    enabled_models?: unknown;
    active_booking_models?: unknown;
  };
  return modelOwnedBlockSources(
    resolveActiveBookingModels({
      pricingTier: venue.pricing_tier,
      bookingModel: venue.booking_model,
      enabledModels: venue.enabled_models,
      activeBookingModels: venue.active_booking_models,
    }),
  );
}

/**
 * Read the venue's models for callers that are not already selecting from `venues`.
 *
 * Deliberately NOT routed through `resolveVenueMode`, which caches for 30 seconds. The
 * whole point of this work is that switching a model off makes it inert, and a window
 * that keeps blocking for another half-minute after the toggle fails that outright.
 */
export async function fetchModelOwnedBlockSources(
  supabase: SupabaseClient,
  venueId: string,
): Promise<ModelOwnedBlockSources> {
  const { data, error } = await supabase
    .from('venues')
    .select(VENUE_BOOKING_MODEL_COLUMNS)
    .eq('id', venueId)
    .maybeSingle();
  if (error) {
    console.warn('[blocked-range-models] venues:', error.message);
    return { ...ALL_MODEL_OWNED_BLOCK_SOURCES };
  }
  return blockSourcesFromVenueRow(data);
}
