/**
 * Public booking URL for waitlist offer emails — pre-fills date/service and enables offer bypass.
 */
export interface WaitlistOfferBookingUrlInput {
  venueSlug: string;
  desiredDate: string;
  /** service_item_id or appointment_service_id */
  serviceId: string | null;
  waitlistEntryId: string;
  /** Specific offered slot (HH:mm) when known */
  offeredSlotHm?: string | null;
}

export function buildWaitlistOfferBookingUrl(input: WaitlistOfferBookingUrlInput): string | null {
  const slug = input.venueSlug?.trim();
  if (!slug) return null;

  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.resneo.com').replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('date', input.desiredDate);
  if (input.serviceId) {
    params.set('service_id', input.serviceId);
  }
  params.set('waitlist_offer', input.waitlistEntryId);
  if (input.offeredSlotHm?.trim()) {
    params.set('time', input.offeredSlotHm.trim().slice(0, 5));
  }

  return `${base}/book/${encodeURIComponent(slug)}?${params.toString()}`;
}
