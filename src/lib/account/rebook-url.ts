/**
 * "Book again" links (P3-1).
 *
 * Built from what a past booking already carries: the venue's slug, the
 * service, and the practitioner's calendar slug. Everything here is an
 * existing part of the public booking contract, which is the point: the
 * portal composes documented parameters rather than inventing a private
 * protocol between two halves of the same product.
 *
 * See `Docs/Embed_Public_Booking_URL_Contract.md`.
 */

export type RebookTarget = {
  /** The venue's public slug. Without it there is no booking page to point at. */
  venueSlug: string | null | undefined;
  /** `service_items.id`, straight from the booking. */
  serviceItemId?: string | null;
  /** `unified_calendars.slug` for the practitioner, when the venue has one. */
  practitionerSlug?: string | null;
};

/**
 * The URL, or null when there is not enough to build an honest one.
 *
 * Null rather than a bare `/book/<venue>` fallback: a "Book again" button that
 * silently drops the service and the practitioner is not booking again, it is
 * starting over, and the customer would not know which they got. The caller
 * hides the control instead.
 */
export function rebookUrl(target: RebookTarget): string | null {
  const venue = target.venueSlug?.trim();
  if (!venue) return null;

  const practitioner = target.practitionerSlug?.trim();
  const path = practitioner
    ? `/book/${encodeURIComponent(venue)}/${encodeURIComponent(practitioner)}`
    : `/book/${encodeURIComponent(venue)}`;

  const service = target.serviceItemId?.trim();
  if (!service) {
    /*
      Practitioner but no service: still worth offering, and `start=service`
      is the honest step to open on, because the service is exactly what is
      still unknown. Without a practitioner either there is nothing to carry
      over at all.
    */
    return practitioner ? `${path}?start=service` : null;
  }

  const params = new URLSearchParams({ service_id: service, start: 'time' });
  return `${path}?${params.toString()}`;
}
