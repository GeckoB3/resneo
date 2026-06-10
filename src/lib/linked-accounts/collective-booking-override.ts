/**
 * Server-side resolution of a combined-page (unified catalogue) booking's
 * effective price/duration override (plan §6.3, §16 verification).
 *
 * SECURITY: overrides are resolved here from the `collective_service_providers`
 * row — NEVER trusted from the client. The customer-facing flow only sends
 * `collective_id` + `collective_service_item_id`; the booking's price and the
 * slot length it occupies come from the active provider record. A forged or
 * stale id resolves to `null` and the booking proceeds at the venue's own terms.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CollectiveServiceOverride {
  /** The collective offering id, to record on the booking for attribution. */
  collectiveServiceItemId: string;
  /** Effective price the customer is charged/deposited against (null = unset). */
  pricePence: number | null;
  /** Effective duration the slot must occupy (null = use the source service's). */
  durationMinutes: number | null;
}

export interface ResolveOverrideParams {
  collectiveId: string | null | undefined;
  collectiveServiceItemId: string | null | undefined;
  venueId: string;
  sourceServiceId: string;
  practitionerId: string | null;
}

/**
 * Resolve the effective override for a combined-page booking, or `null` when it
 * isn't a (valid, bookable) combined offering. Requires: a live `unified_catalog`
 * collective the venue actively belongs to; an `active` item; and an `active`
 * provider for (item, venue, source service) — matching the chosen practitioner,
 * or a venue-wide ("all practitioners") provider. Host assignments go live
 * immediately (per-service member consent was removed), so `approval_status`
 * is deliberately NOT consulted — legacy `pending` rows are bookable too.
 */
export async function resolveCollectiveServiceOverride(
  admin: SupabaseClient,
  params: ResolveOverrideParams,
): Promise<CollectiveServiceOverride | null> {
  const { collectiveId, collectiveServiceItemId, venueId, sourceServiceId, practitionerId } = params;
  if (!collectiveId || !collectiveServiceItemId) return null;

  // The item must belong to a live combined collective the venue is active in.
  const { data: item } = await admin
    .from('collective_service_items')
    .select('id, collective_id, status')
    .eq('id', collectiveServiceItemId)
    .eq('collective_id', collectiveId)
    .eq('status', 'active')
    .maybeSingle();
  if (!item) return null;

  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, status, page_mode')
    .eq('id', collectiveId)
    .eq('status', 'active')
    .eq('page_mode', 'unified_catalog')
    .maybeSingle();
  if (!collective) return null;

  const { data: membership } = await admin
    .from('venue_collective_members')
    .select('id')
    .eq('collective_id', collectiveId)
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) return null;

  // Bookable provider rows for this (item, venue, source service). Prefer one
  // pinned to the chosen practitioner; fall back to a venue-wide ("all") row.
  const { data: providers } = await admin
    .from('collective_service_providers')
    .select('id, practitioner_id')
    .eq('item_id', collectiveServiceItemId)
    .eq('venue_id', venueId)
    .eq('source_service_id', sourceServiceId)
    .eq('status', 'active');
  const rows = providers ?? [];
  const provider =
    (practitionerId ? rows.find((r) => r.practitioner_id === practitionerId) : null) ??
    rows.find((r) => r.practitioner_id == null) ??
    null;
  if (!provider) return null;

  // Source service price/duration as the base for the COALESCE chain, resolved
  // model-agnostically: a unified venue's service is a `service_items` row; a
  // legacy venue's is an `appointment_services` row (distinct id spaces).
  let source: { price_pence: number | null; duration_minutes: number | null } | null = null;
  const { data: serviceItem } = await admin
    .from('service_items')
    .select('price_pence, duration_minutes')
    .eq('id', sourceServiceId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (serviceItem) {
    source = serviceItem as { price_pence: number | null; duration_minutes: number | null };
  } else {
    const { data: legacy } = await admin
      .from('appointment_services')
      .select('price_pence, duration_minutes')
      .eq('id', sourceServiceId)
      .eq('venue_id', venueId)
      .maybeSingle();
    source = (legacy as { price_pence: number | null; duration_minutes: number | null } | null) ?? null;
  }

  // Each venue owns its service's price/duration; the combined page never overrides
  // them. The booking occupies — and is charged at — the source service's own terms.
  return {
    collectiveServiceItemId,
    pricePence: (source?.price_pence as number | null) ?? null,
    durationMinutes: (source?.duration_minutes as number | null) ?? null,
  };
}
