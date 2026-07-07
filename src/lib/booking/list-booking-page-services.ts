import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAppointmentCatalog } from '@/lib/availability/appointment-catalog';
import { compareByVenueServiceOrder } from '@/lib/booking/service-display-order';
import type { BookingPagePublicService } from '@/lib/booking/booking-page-tabs';

function parseServicePhotosFromConfig(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()),
    ),
  );
}

/**
 * Bookable services for the public booking page Services tab (deduped across staff columns).
 * Photos come only from `booking_page_config.service_photos`, not the booking form catalog.
 */
export async function listBookingPageServices(
  supabase: SupabaseClient,
  venueId: string,
): Promise<BookingPagePublicService[]> {
  const [{ practitioners }, venueRes] = await Promise.all([
    fetchAppointmentCatalog(supabase, venueId),
    supabase.from('venues').select('booking_page_config').eq('id', venueId).maybeSingle(),
  ]);

  const servicePhotos = parseServicePhotosFromConfig(
    (venueRes.data as { booking_page_config?: { service_photos?: unknown } } | null)?.booking_page_config
      ?.service_photos,
  );

  const byId = new Map<string, BookingPagePublicService>();
  const sortOrderById = new Map<string, number>();

  for (const practitioner of practitioners) {
    for (const svc of practitioner.services) {
      const photo = servicePhotos[svc.id]?.trim() || null;
      const existing = byId.get(svc.id);
      if (!existing) {
        byId.set(svc.id, {
          id: svc.id,
          name: svc.name,
          description: svc.description?.trim() ? svc.description.trim() : null,
          image_url: photo,
          price_pence: svc.price_pence,
          duration_minutes: svc.duration_minutes,
        });
        sortOrderById.set(svc.id, svc.sort_order ?? 0);
        continue;
      }
      if (!existing.description && svc.description?.trim()) {
        existing.description = svc.description.trim();
      }
      if (!existing.image_url && photo) {
        existing.image_url = photo;
      }
    }
  }

  return [...byId.values()].sort((a, b) =>
    compareByVenueServiceOrder(
      { sort_order: sortOrderById.get(a.id), name: a.name },
      { sort_order: sortOrderById.get(b.id), name: b.name },
    ),
  );
}
