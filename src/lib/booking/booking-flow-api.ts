/**
 * Centralises public vs staff dashboard URLs for shared booking flows.
 * Read paths that accept `venue_id` stay on /api/booking/* for both audiences where equivalent.
 * Staff-only routes use cookies (venue context) and omit venue_id.
 */

export type BookingFlowAudience = 'public' | 'staff';

export function localTodayISO(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function appointmentCatalogUrl(
  venueId: string,
  practitionerSlug?: string,
  includeHidden?: boolean,
): string {
  const qs = new URLSearchParams({ venue_id: venueId });
  if (practitionerSlug) qs.set('practitioner_slug', practitionerSlug);
  // Staff booking surface needs hidden_from_online add-on groups; the route only
  // honours this for an authenticated staff session for the same venue.
  if (includeHidden) qs.set('include_hidden', 'true');
  return `/api/booking/appointment-catalog?${qs}`;
}

export function bookingAvailabilityUrl(params: URLSearchParams): string {
  return `/api/booking/availability?${params}`;
}

/**
 * Month view of appointment availability (dates with at least one bookable slot
 * for a given practitioner + service). Powers the visual date picker.
 *
 * `variantId` narrows availability to a chosen sub-option's duration so the calendar
 * never shows dates that fit the base service but not the longer variant.
 */
export function appointmentCalendarUrl(
  audience: BookingFlowAudience,
  venueId: string,
  practitionerId: string,
  serviceId: string,
  year: number,
  month: number,
  variantId?: string | null,
  durationMinutes?: number | null,
  anyAvailable?: boolean,
  ownerVenueId?: string | null,
  excludeBookingId?: string | null,
  addonIds?: string[] | null,
): string {
  const params = new URLSearchParams({
    practitioner_id: practitionerId,
    service_id: serviceId,
    year: String(year),
    month: String(month),
  });
  if (anyAvailable) {
    params.set('any_available', '1');
  }
  if (variantId) {
    params.set('variant_id', variantId);
  }
  if (durationMinutes != null) {
    params.set('duration_minutes', String(durationMinutes));
  }
  if (excludeBookingId) {
    params.set('exclude_booking_id', excludeBookingId);
  }
  if (addonIds && addonIds.length > 0) {
    for (const id of addonIds) params.append('addon_ids', id);
  }
  if (audience === 'public') {
    params.set('venue_id', venueId);
    return `/api/booking/appointment-calendar?${params}`;
  }
  if (ownerVenueId) {
    params.set('owner_venue_id', ownerVenueId);
  }
  return `/api/venue/appointment-calendar?${params}`;
}

/** Staff day-level appointment slots (same rules as staff month calendar). */
export function staffAppointmentAvailabilityUrl(
  params: URLSearchParams,
  linkedOwnerVenueId?: string | null,
): string {
  if (linkedOwnerVenueId) {
    params.set('owner_venue_id', linkedOwnerVenueId);
  }
  return `/api/venue/appointment-availability?${params}`;
}

export function appointmentCalendarCacheKey(
  practitionerId: string,
  serviceId: string,
  year: number,
  month: number,
  variantId?: string | null,
  durationMinutes?: number | null,
  addonIds?: string[] | null,
): string {
  const v = variantId ? `:${variantId}` : '';
  const d = durationMinutes != null ? `:${durationMinutes}m` : '';
  const a = addonIds && addonIds.length > 0 ? `:a-${[...addonIds].sort().join('-')}` : '';
  return `${practitionerId}:${serviceId}${v}${d}${a}:${year}:${month}`;
}

export function validateAppointmentSlotUrl(): string {
  return '/api/booking/validate-appointment-slot';
}

export function validateResourceBookingModificationUrl(bookingId: string): string {
  return `/api/venue/bookings/${bookingId}/validate-resource-modification`;
}

export function bookingCreateUrl(): string {
  return '/api/booking/create';
}

export function bookingCreateMultiServiceUrl(): string {
  return '/api/booking/create-multi-service';
}

export function bookingCreateGroupUrl(): string {
  return '/api/booking/create-group';
}

export function venueBookingsCreateUrl(): string {
  return '/api/venue/bookings';
}

export function bookingConfirmPaymentUrl(): string {
  return '/api/booking/confirm-payment';
}

export function eventOfferingsUrl(
  audience: BookingFlowAudience,
  venueId: string,
  ownerVenueId?: string | null,
  options?: { from?: string; days?: number },
): string {
  const from = options?.from ?? localTodayISO();
  const days = options?.days ?? 90;
  if (audience === 'staff') {
    const params = new URLSearchParams({ from, days: String(days) });
    if (ownerVenueId) params.set('owner_venue_id', ownerVenueId);
    return `/api/venue/event-offerings?${params}`;
  }
  return `/api/booking/event-offerings?venue_id=${encodeURIComponent(venueId)}&from=${from}&days=${days}`;
}

export function classOfferingsUrl(
  audience: BookingFlowAudience,
  venueId: string,
  ownerVenueId?: string | null,
): string {
  const from = localTodayISO();
  if (audience === 'staff') {
    const params = new URLSearchParams({ from, days: '90' });
    if (ownerVenueId) params.set('owner_venue_id', ownerVenueId);
    return `/api/venue/class-offerings?${params}`;
  }
  return `/api/booking/class-offerings?venue_id=${encodeURIComponent(venueId)}&from=${from}&days=90`;
}

export function resourceOptionsUrl(
  audience: BookingFlowAudience,
  venueId: string,
  ownerVenueId?: string | null,
): string {
  if (audience === 'staff') {
    const params = new URLSearchParams();
    if (ownerVenueId) params.set('owner_venue_id', ownerVenueId);
    const qs = params.toString();
    return qs ? `/api/venue/resource-options?${qs}` : '/api/venue/resource-options';
  }
  return `/api/booking/resource-options?venue_id=${encodeURIComponent(venueId)}`;
}

/**
 * Calendar month: use duration `any` before the guest picks a concrete duration (public + staff unified).
 */
export function resourceCalendarUrl(
  audience: BookingFlowAudience,
  venueId: string,
  resourceId: string,
  year: number,
  month: number,
  duration: 'any' | number,
  options?: { excludeBookingId?: string | null; skipPastSlots?: boolean },
): string {
  const params = new URLSearchParams({
    resource_id: resourceId,
    year: String(year),
    month: String(month),
  });
  if (duration === 'any') {
    params.set('duration', 'any');
  } else {
    params.set('duration', String(duration));
  }
  if (options?.excludeBookingId) {
    params.set('exclude_booking_id', options.excludeBookingId);
  }
  if (options?.skipPastSlots) {
    params.set('skip_past_slots', '1');
  }
  if (audience === 'public') {
    params.set('venue_id', venueId);
  }
  return audience === 'staff'
    ? `/api/venue/resource-calendar?${params}`
    : `/api/booking/resource-calendar?${params}`;
}

/** Time slots for a chosen date + duration. */
export function resourceSlotsUrl(
  audience: BookingFlowAudience,
  venueId: string,
  date: string,
  durationMinutes: number,
  resourceId: string,
  options?: { excludeBookingId?: string | null; skipPastSlots?: boolean },
): string {
  if (audience === 'staff') {
    const qs = new URLSearchParams({
      date,
      duration: String(durationMinutes),
      resource_id: resourceId,
    });
    if (options?.excludeBookingId) {
      qs.set('exclude_booking_id', options.excludeBookingId);
    }
    if (options?.skipPastSlots) {
      qs.set('skip_past_slots', '1');
    }
    return `/api/venue/resource-availability?${qs}`;
  }
  const params = new URLSearchParams({
    venue_id: venueId,
    date,
    duration: String(durationMinutes),
    booking_model: 'resource_booking',
    resource_id: resourceId,
  });
  return `/api/booking/availability?${params}`;
}
