-- Resneo: Booking Site Studio (Phase 2) — storage bucket for per-service booking-page photos.
-- Uploads are server-side via API (admin client); public read for display on /book pages.
-- Image URLs are stored in venues.booking_page_config.service_photos (serviceId → public URL).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'venue-service-photos',
  'venue-service-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "venue_service_photo_public_read" ON storage.objects;

CREATE POLICY "venue_service_photo_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-service-photos');
