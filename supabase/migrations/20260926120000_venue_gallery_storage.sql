-- Resneo: Booking Site Studio (Phase 2) — storage bucket for booking-page gallery photos.
-- Uploads are server-side via API (admin client); public read for display on /book pages.
-- Image URLs are stored in venues.booking_page_config.gallery (array of public URLs).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'venue-gallery',
  'venue-gallery',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "venue_gallery_public_read" ON storage.objects;

CREATE POLICY "venue_gallery_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-gallery');
