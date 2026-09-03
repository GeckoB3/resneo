import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAppointmentCatalog } from '@/lib/availability/appointment-catalog';
import { compareByCategoryThenServiceOrder } from '@/lib/booking/service-categories';
import type { BookingPagePublicService } from '@/lib/booking/booking-page-tabs';
import {
  sanitizeBookingPageImageFraming,
  type BookingPageImageFraming,
} from '@/lib/booking/booking-page-image-framing';

function parseServicePhotosFromConfig(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()),
    ),
  );
}

function parseServicePhotoCropsFromConfig(
  raw: unknown,
): Record<string, BookingPageImageFraming> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, BookingPageImageFraming> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const crop = sanitizeBookingPageImageFraming(value);
    if (crop) out[id] = crop;
  }
  return out;
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

  const bookingPageConfig = (
    venueRes.data as {
      booking_page_config?: { service_photos?: unknown; service_photo_crops?: unknown };
    } | null
  )?.booking_page_config;
  const servicePhotos = parseServicePhotosFromConfig(bookingPageConfig?.service_photos);
  const servicePhotoCrops = parseServicePhotoCropsFromConfig(
    bookingPageConfig?.service_photo_crops,
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
          image_crop: photo ? servicePhotoCrops[svc.id] ?? null : null,
          price_pence: svc.price_pence,
          duration_minutes: svc.duration_minutes,
          category: svc.category ?? null,
          sort_order: svc.sort_order ?? 0,
        });
        sortOrderById.set(svc.id, svc.sort_order ?? 0);
        continue;
      }
      if (!existing.description && svc.description?.trim()) {
        existing.description = svc.description.trim();
      }
      if (!existing.image_url && photo) {
        existing.image_url = photo;
        existing.image_crop = servicePhotoCrops[svc.id] ?? null;
      }
    }
  }

  return [...byId.values()].sort((a, b) =>
    compareByCategoryThenServiceOrder(
      { sort_order: sortOrderById.get(a.id), name: a.name, category: a.category },
      { sort_order: sortOrderById.get(b.id), name: b.name, category: b.category },
    ),
  );
}
