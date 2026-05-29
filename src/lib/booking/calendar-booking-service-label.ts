/** Minimal booking fields needed to render a calendar bar service line. */
export interface CalendarBookingServiceLabelBooking {
  booking_item_name?: string | null;
  service_variant_id?: string | null;
  booking_addon_labels?: string[] | null;
}

export interface CalendarBookingServiceCatalogRef {
  name?: string | null;
  variants?: Array<{ id: string; name?: string | null }>;
}

function variantNameForBooking(
  variantId: string | null | undefined,
  variants: CalendarBookingServiceCatalogRef['variants'],
): string | null {
  if (!variantId?.trim() || !variants?.length) return null;
  return variants.find((v) => v.id === variantId)?.name?.trim() ?? null;
}

/**
 * Guest-facing service line for dashboard calendar booking bars: base service,
 * optional variant, and chosen add-ons (+ name per extra).
 */
export function calendarBookingServiceDisplayLine(params: {
  booking: CalendarBookingServiceLabelBooking;
  catalogService?: CalendarBookingServiceCatalogRef | null;
  resourceName?: string | null;
}): string | null {
  const base =
    params.booking.booking_item_name?.trim() || params.catalogService?.name?.trim() || null;
  const variantName = variantNameForBooking(
    params.booking.service_variant_id,
    params.catalogService?.variants,
  );

  let serviceLabel = base;
  if (base && variantName && !base.includes(variantName)) {
    serviceLabel = `${base} – ${variantName}`;
  }

  const addonLabels = (params.booking.booking_addon_labels ?? [])
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  const parts: string[] = [];
  const resource = params.resourceName?.trim();
  if (resource) parts.push(resource);
  if (serviceLabel) parts.push(serviceLabel);
  if (addonLabels.length > 0) {
    parts.push(addonLabels.map((n) => `+ ${n}`).join(', '));
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Tooltip / multi-service stack title: one segment per booking, joined with → */
export function calendarMultiServiceDisplayTitle(
  items: Array<{
    booking: CalendarBookingServiceLabelBooking;
    catalogService?: CalendarBookingServiceCatalogRef | null;
  }>,
): string {
  return items
    .map(({ booking, catalogService }) =>
      calendarBookingServiceDisplayLine({ booking, catalogService, resourceName: null }),
    )
    .filter((line): line is string => Boolean(line?.trim()))
    .join(' → ');
}
